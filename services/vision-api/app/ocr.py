"""OCR behind a narrow interface with automatic engine selection and a safe fallback.

No OCR engine is mandatory for the service to boot: when nothing is installed the API keeps
working (layout, geometry, vector PDF text) and reports `engine.ocr = "none"` with a warning.
Every recognition call is bounded by a timeout so a stuck native call cannot freeze uvicorn.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import cv2
import numpy as np

from . import config

OCR_TIMEOUT_SECONDS = 90.0


@dataclass
class OcrLine:
    text: str
    confidence: float
    box: tuple[int, int, int, int]
    polygon: list[tuple[float, float]]

    @property
    def height(self) -> int:
        return self.box[3]

    @property
    def width(self) -> int:
        return self.box[2]


@runtime_checkable
class OcrEngine(Protocol):
    name: str

    @property
    def version(self) -> str: ...

    def recognize(self, image: np.ndarray) -> list[OcrLine]: ...


class NoopOcrEngine:
    """Used when no engine is installed or when the installed one keeps failing."""

    name = "none"
    version = "0"

    def recognize(self, image: np.ndarray) -> list[OcrLine]:
        return []


class RapidOcrEngine:
    """RapidOCR (PP-OCR models on onnxruntime, CPU only)."""

    name = "rapidocr"

    def __init__(self, max_side: int = config.OCR_MAX_SIDE, timeout: float = OCR_TIMEOUT_SECONDS) -> None:
        from rapidocr_onnxruntime import RapidOCR  # imported lazily: keeps boot time low

        os.environ.setdefault("OMP_NUM_THREADS", "2")
        # RapidOCR ships Latin/Chinese recognition models. A shop that owns a Cyrillic PP-OCR
        # model can drop the two files in and point the service at them — no network needed.
        kwargs: dict[str, str] = {}
        rec_model = os.environ.get("IKGUIDE_OCR_REC_MODEL", "").strip()
        rec_keys = os.environ.get("IKGUIDE_OCR_REC_KEYS", "").strip()
        if rec_model:
            kwargs["rec_model_path"] = rec_model
        if rec_keys:
            kwargs["rec_keys_path"] = rec_keys
        self._engine = RapidOCR(**kwargs)
        self._cyrillic_model = bool(rec_model)
        self._max_side = max_side
        self._timeout = timeout
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ikguide-ocr")
        self._degraded = False
        self._version = self._read_version()

    @staticmethod
    def _read_version() -> str:
        try:
            from importlib.metadata import version

            return version("rapidocr-onnxruntime")
        except Exception:  # pragma: no cover - metadata is optional
            return "unknown"

    @property
    def version(self) -> str:
        return self._version

    @property
    def name(self) -> str:  # type: ignore[override]
        return "rapidocr-cyrillic" if self._cyrillic_model else "rapidocr"

    def _prepare(self, image: np.ndarray) -> np.ndarray | None:
        gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape[:2]
        # Вырожденные картинки (полоска 1200×1, иконка 8×8) валят нативный детектор RapidOCR
        # вместе со всем процессом: SIGSEGV не перехватить, поэтому просто не зовём движок.
        if min(height, width) < 8 or max(height, width) < 24:
            return None
        if max(height, width) / max(1, min(height, width)) > 60:
            return None
        longest = max(height, width)
        if longest > self._max_side:
            factor = self._max_side / longest
            gray = cv2.resize(gray, (max(1, int(width * factor)), max(1, int(height * factor))), interpolation=cv2.INTER_AREA)
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    def _run(self, image: np.ndarray) -> list[OcrLine]:
        result, _elapsed = self._engine(image)
        lines: list[OcrLine] = []
        if not result:
            return lines
        for item in result:
            if len(item) < 3:
                continue
            box, text, score = item[0], str(item[1]), float(item[2])
            if score < config.OCR_MIN_CONFIDENCE or not text.strip():
                continue
            polygon = [(float(point[0]), float(point[1])) for point in box]
            xs = [point[0] for point in polygon]
            ys = [point[1] for point in polygon]
            x0, y0 = int(min(xs)), int(min(ys))
            x1, y1 = int(max(xs)), int(max(ys))
            lines.append(
                OcrLine(
                    text=text.strip(),
                    confidence=round(min(0.999, max(0.0, score)), 4),
                    box=(x0, y0, max(1, x1 - x0), max(1, y1 - y0)),
                    polygon=polygon,
                )
            )
        return lines

    def recognize(self, image: np.ndarray) -> list[OcrLine]:
        if self._degraded:
            return []
        prepared = self._prepare(image)
        if prepared is None:
            return []
        future = self._executor.submit(self._run, prepared)
        try:
            lines = future.result(timeout=self._timeout)
            # Детектор работал на уменьшенной картинке, а вызывающий код ожидает
            # координаты исходного изображения (иначе пины и кропы съезжают).
            sx = image.shape[1] / prepared.shape[1]
            sy = image.shape[0] / prepared.shape[0]
            if sx != 1 or sy != 1:
                for line in lines:
                    x, y, w, h = line.box
                    line.box = (round(x * sx), round(y * sy), max(1, round(w * sx)), max(1, round(h * sy)))
                    line.polygon = [(x * sx, y * sy) for x, y in line.polygon]
            return lines
        except FutureTimeout:
            self._degraded = True
            return []
        except Exception:
            return []


class TesseractOcrEngine:
    """Russian+English OCR; only advertises Russian when both traineddata files load."""

    name = "tesseract-rus-eng"

    def __init__(self, timeout: float = OCR_TIMEOUT_SECONDS) -> None:
        import pytesseract
        self._tesseract = pytesseract
        self._timeout = timeout
        explicit = os.getenv("IKGUIDE_TESSERACT", "").strip()
        base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
        candidates = [base / "vision-engine" / "tesseract.exe", base / "tesseract" / "tesseract.exe"]
        binary = explicit or next((str(p) for p in candidates if p.is_file()), "") or shutil.which("tesseract")
        if not binary:
            raise FileNotFoundError("tesseract binary not found")
        pytesseract.pytesseract.tesseract_cmd = binary
        bundled = Path(binary).parent / "tessdata"
        if bundled.is_dir():
            os.environ["TESSDATA_PREFIX"] = str(bundled)
        languages = set(pytesseract.get_languages(config=""))
        if not {"rus", "eng"}.issubset(languages):
            raise RuntimeError(f"Tesseract requires rus and eng traineddata: {sorted(languages)}")
        self._version = str(pytesseract.get_tesseract_version())

    @property
    def version(self) -> str:
        return self._version

    def recognize(self, image: np.ndarray) -> list[OcrLine]:
        if min(image.shape[:2]) < 8:
            return []
        result = self._recognize_region(image)
        # A dense frame/hatching can make Tesseract segment the entire sheet as one object.
        # Retry overlapping quadrants only when the whole-page pass found almost nothing.
        h, w = image.shape[:2]
        if len(result) < 3 and min(h, w) >= 800:
            for x0, x1 in [(0, int(w * .58)), (int(w * .42), w)]:
                for y0, y1 in [(0, int(h * .58)), (int(h * .42), h)]:
                    for line in self._recognize_region(image[y0:y1, x0:x1]):
                        x, y, bw, bh = line.box
                        line.box = (x + x0, y + y0, bw, bh)
                        line.polygon = [(px + x0, py + y0) for px, py in line.polygon]
                        duplicate = False
                        for previous in result:
                            ax, ay, aw, ah = previous.box
                            overlap = max(0, min(x+x0+bw, ax+aw)-max(x+x0, ax)) * max(0, min(y+y0+bh, ay+ah)-max(y+y0, ay))
                            if overlap / max(1, min(aw*ah, bw*bh)) > .7:
                                duplicate = True
                                break
                        if not duplicate:
                            result.append(line)
        return result

    def _recognize_region(self, image: np.ndarray) -> list[OcrLine]:
        height, width = image.shape[:2]
        longest = max(width, height)
        factor = min(1.0, 2600 / longest)
        resized = cv2.resize(image, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA) if factor < 1 else image
        gray = resized if resized.ndim == 2 else cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        # Remove only very pale marks, retaining dark drawing strokes and all midtones.
        gray = gray.copy()
        gray[gray > 238] = 255
        data = self._tesseract.image_to_data(gray, lang="rus+eng", config="--psm 11", timeout=self._timeout,
                                             output_type=self._tesseract.Output.DICT)
        groups: dict[tuple[int, int, int], list[int]] = {}
        for i, value in enumerate(data['text']):
            try: score = float(data['conf'][i])
            except (ValueError, TypeError): continue
            if value.strip() and score >= 0:
                groups.setdefault((data['block_num'][i], data['par_num'][i], data['line_num'][i]), []).append(i)
        result: list[OcrLine] = []
        sx, sy = width / gray.shape[1], height / gray.shape[0]
        for ids in groups.values():
            x0 = min(data['left'][i] for i in ids); y0 = min(data['top'][i] for i in ids)
            x1 = max(data['left'][i] + data['width'][i] for i in ids)
            y1 = max(data['top'][i] + data['height'][i] for i in ids)
            x, y = round(x0 * sx), round(y0 * sy)
            w, h = max(1, round((x1-x0)*sx)), max(1, round((y1-y0)*sy))
            result.append(OcrLine(' '.join(data['text'][i].strip() for i in ids),
                                  min(.999, max(0., sum(float(data['conf'][i]) for i in ids) / len(ids) / 100)),
                                  (x, y, w, h), [(x,y), (x+w,y), (x+w,y+h), (x,y+h)]))
        return result


class HybridOcrEngine:
    """Tesseract is primary for Russian; RapidOCR adds non-overlapping detections."""
    name = "tesseract-rus-eng+rapidocr"

    def __init__(self, tesseract: TesseractOcrEngine, rapid: RapidOcrEngine):
        self.tesseract, self.rapid = tesseract, rapid
        self.version = f"{tesseract.version}+{rapid.version}"

    def recognize(self, image: np.ndarray) -> list[OcrLine]:
        try: primary = self.tesseract.recognize(image)
        except Exception: primary = []
        secondary = self.rapid.recognize(image)
        def overlaps(a: OcrLine, b: OcrLine) -> bool:
            ax, ay, aw, ah = a.box; bx, by, bw, bh = b.box
            area = max(0, min(ax+aw,bx+bw)-max(ax,bx)) * max(0, min(ay+ah,by+bh)-max(ay,by))
            return area / max(1, min(aw*ah, bw*bh)) > .5
        return primary + [line for line in secondary if not any(overlaps(line, existing) for existing in primary)]


def create_ocr_engine(preferred: str | None = None) -> tuple[OcrEngine, list[str], list[str]]:
    """Returns (engine, attempted, warnings). Never raises: OCR is optional."""
    if preferred in (None, "auto", "hybrid"):
        attempts = ["tesseract-rus-eng", "rapidocr"]
        warnings: list[str] = []
        tesseract = rapid = None
        try: tesseract = TesseractOcrEngine()
        except Exception as error: warnings.append(f"ocr_engine_failed:tesseract:{type(error).__name__}")
        try: rapid = RapidOcrEngine()
        except Exception as error: warnings.append(f"ocr_engine_failed:rapidocr:{type(error).__name__}")
        if tesseract and rapid: return HybridOcrEngine(tesseract, rapid), attempts, warnings
        if tesseract: return tesseract, attempts, warnings
        if rapid: return rapid, attempts, warnings
        return NoopOcrEngine(), attempts, warnings + ["ocr_unavailable"]
    attempts = [preferred]
    try:
        if preferred == "rapidocr": return RapidOcrEngine(), attempts, []
        if preferred == "tesseract": return TesseractOcrEngine(), attempts, []
    except Exception as error:
        return NoopOcrEngine(), attempts, [f"ocr_engine_failed:{preferred}:{type(error).__name__}", "ocr_unavailable"]
    return NoopOcrEngine(), attempts, [f"ocr_engine_unknown:{preferred}", "ocr_unavailable"]
