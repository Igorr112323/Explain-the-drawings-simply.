"""OCR behind a narrow interface with automatic engine selection and a safe fallback.

No OCR engine is mandatory for the service to boot: when nothing is installed the API keeps
working (layout, geometry, vector PDF text) and reports `engine.ocr = "none"` with a warning.
Every recognition call is bounded by a timeout so a stuck native call cannot freeze uvicorn.
"""

from __future__ import annotations

import os
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

    def __init__(self, max_side: int = 2200, timeout: float = OCR_TIMEOUT_SECONDS) -> None:
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

    def _prepare(self, image: np.ndarray) -> np.ndarray:
        gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape[:2]
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
        future = self._executor.submit(self._run, prepared)
        try:
            return future.result(timeout=self._timeout)
        except FutureTimeout:
            self._degraded = True
            return []
        except Exception:
            return []


def create_ocr_engine(preferred: str | None = None) -> tuple[OcrEngine, list[str], list[str]]:
    """Returns (engine, attempted, warnings). Never raises: OCR is optional."""
    attempts = ["rapidocr"] if not preferred else ([preferred] if preferred != "auto" else ["rapidocr"])
    warnings: list[str] = []

    for candidate in attempts:
        if candidate == "rapidocr":
            try:
                engine = RapidOcrEngine()
                return engine, attempts, warnings
            except Exception as error:  # missing model/dependency/broken wheel
                warnings.append(f"ocr_engine_failed:rapidocr:{type(error).__name__}")
                continue
        warnings.append(f"ocr_engine_unknown:{candidate}")

    warnings.append("ocr_unavailable")
    return NoopOcrEngine(), attempts, warnings
