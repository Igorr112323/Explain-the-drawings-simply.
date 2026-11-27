"""Сквозной QA-прогон корпуса: файл → vision-api → builder → PDF → проверка PDF.

Что делает:
  1. поднимает настоящий `services/vision-api` (uvicorn на локальном порту);
  2. гонит через `/v1/recognize` каждый файл корпуса, замеряет время и следит за живостью сервера
     (после каждого 500-го запроса и после мусорных файлов пингует `/health`);
  3. собирает документы и PDF настоящими `@ikguide/builder` и `@ikguide/pdf-exporter`
     (`scripts/qa/build_docs.ts` через esbuild);
  4. проверяет каждый PDF через PyMuPDF: заголовок, страницы, кириллицу, наложения текста,
     корректность подписей «Стр. X из N», декодируемость картинок;
  5. фаззит ГОСТ-переводчик 2 000+ строками (`scripts/qa/fuzz_gost.ts`);
  6. пишет `qa/output/results.jsonl` и `qa/output/summary.json`.

Честность: ни один кейс не подменяется моком — PDF рендерится настоящим jsPDF+svg2pdf,
распознавание идёт через настоящий HTTP-сервис.

    python scripts/qa/run_qa.py --corpus qa/corpus --out qa/output
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[2]
VISION_DIR = ROOT / "services" / "vision-api"
PYTHON = VISION_DIR / ".venv" / "bin" / "python"
ESBUILD = ROOT / "node_modules" / ".bin" / "esbuild"

PAGE_RE = re.compile(r"Стр\.\s*(\d+)\s*из\s*(\d+)")
BAD_TEXT = re.compile(r"[\ufffd\ufffe]|(?:Ã.|Ð.){3,}")


# ---------------------------------------------------------------------------- инфраструктура


def wait_for_health(base: str, timeout: float = 90.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/health", timeout=3) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("vision-api не поднялся за отведённое время")


def post_file(base: str, path: Path, timeout: float) -> tuple[int, dict | str, float]:
    """POST /v1/recognize с настоящим файлом. Возвращает (статус, тело, секунды)."""
    boundary = f"----QA{uuid.uuid4().hex}"
    name = path.name
    data = path.read_bytes()
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="{name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    request = urllib.request.Request(
        f"{base}/v1/recognize",
        data=head + data + tail,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
            return response.status, body, time.time() - started
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            detail = json.loads(raw).get("detail", raw[:400])
        except Exception:
            detail = raw[:400]
        return error.code, detail, time.time() - started
    except Exception as error:  # таймаут, обрыв соединения, зависание
        return 0, f"{type(error).__name__}: {error}", time.time() - started


def rss_mb(pid: int) -> float:
    try:
        status = Path(f"/proc/{pid}/status").read_text()
        match = re.search(r"VmRSS:\s+(\d+) kB", status)
        return round(int(match.group(1)) / 1024, 1) if match else 0.0
    except Exception:
        return 0.0


def bundle(entry: Path, out: Path) -> Path:
    """Собирает TS-скрипт esbuild'ом: TS-пакеты подключаются как в приложении."""
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            str(ESBUILD),
            str(entry),
            "--bundle",
            "--platform=node",
            # CJS: react-dom внутри pdf-exporter тянет динамический require('stream') — в ESM-бандле
            # он падает с «Dynamic require of "stream" is not supported».
            "--format=cjs",
            "--target=node20",
            f"--outfile={out}",
            "--log-level=warning",
        ],
        check=True,
        cwd=ROOT,
    )
    return out


# ---------------------------------------------------------------------------- проверка PDF


def check_pdf(path: Path, expected_pages: int | None, expected_images: bool = False) -> dict:
    """Проверяет настоящий PDF: страницы, кириллицу, подписи, наложения, картинки."""
    result: dict = {"slug": path.stem, "ok": True, "problems": []}
    try:
        data = path.read_bytes()
    except Exception as error:
        return {"slug": path.stem, "ok": False, "problems": [f"pdf_unreadable:{error}"]}

    if not data.startswith(b"%PDF-"):
        return {"slug": path.stem, "ok": False, "problems": ["pdf_no_header"]}
    if len(data) < 4000:
        result["problems"].append(f"pdf_too_small:{len(data)}")

    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as error:
        return {"slug": path.stem, "ok": False, "problems": [f"pdf_broken:{error}"]}

    pages = document.page_count
    result["pages"] = pages
    if pages < 2:
        result["problems"].append(f"pdf_pages:{pages}")
    if expected_pages is not None and pages != expected_pages:
        result["problems"].append(f"plan_mismatch:{pages}!={expected_pages}")

    captions: list[tuple[int, int]] = []
    text_total = 0
    cyrillic_total = 0
    images = 0
    drawn = 0
    seen_images: set[int] = set()
    broken_images = 0
    overlaps = 0
    out_of_bounds = 0
    for page_index in range(pages):
        page = document.load_page(page_index)
        text = page.get_text("text")
        text_total += len(text)
        cyrillic_total += len(re.findall(r"[А-Яа-яЁё]", text))
        if BAD_TEXT.search(text):
            result["problems"].append(f"pdf_bad_encoding:p{page_index + 1}")
        for number, total in PAGE_RE.findall(text):
            captions.append((int(number), int(total)))

        # Границы A4 с допуском 1 pt: текст не должен вылезать за лист.
        for block in page.get_text("blocks"):
            x0, y0, x1, y1 = block[:4]
            if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                out_of_bounds += 1

        # Наложения считаем по строкам, а не по «блокам» PyMuPDF: блок — это абзац, и его
        # рамка честно накрывает соседние абзацы, хотя тексты не пересекаются.
        blocks = [
            (span_line["bbox"][0], span_line["bbox"][1], span_line["bbox"][2], span_line["bbox"][3])
            for block in page.get_text("dict")["blocks"]
            for span_line in block.get("lines", [])
            if any(span.get("text", "").strip() for span in span_line.get("spans", []))
        ]
        for first in range(len(blocks)):
            for second in range(first + 1, len(blocks)):
                ax0, ay0, ax1, ay1 = blocks[first]
                bx0, by0, bx1, by1 = blocks[second]
                width = min(ax1, bx1) - max(ax0, bx0)
                height = min(ay1, by1) - max(ay0, by0)
                if width <= 0 or height <= 0:
                    continue
                intersection = width * height
                smaller = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0)) or 1
                if intersection / smaller > 0.35:
                    overlaps += 1

        drawn += len(page.get_image_info())
        for info in page.get_images(full=True):
            xref = info[0]
            if xref in seen_images:
                continue
            seen_images.add(xref)
            images += 1
            try:
                pix = pymupdf.Pixmap(document, xref)
                if pix.width < 2 or pix.height < 2:
                    broken_images += 1
            except Exception:
                broken_images += 1

    result["captions"] = len(captions)
    result["textChars"] = text_total
    result["cyrillic"] = cyrillic_total
    result["images"] = images
    result["drawn"] = drawn
    if expected_images and drawn == 0:
        result["problems"].append("pdf_no_drawing_crops")
    if overlaps:
        result["problems"].append(f"pdf_text_overlap:{overlaps}")
    if out_of_bounds:
        result["problems"].append(f"pdf_text_out_of_page:{out_of_bounds}")
    if broken_images:
        result["problems"].append(f"pdf_broken_images:{broken_images}")
    if captions:
        numbers = [number for number, _ in captions]
        totals = {total for _, total in captions}
        if numbers != sorted(numbers) or len(set(numbers)) != len(numbers):
            result["problems"].append(f"pdf_caption_order:{numbers[:8]}")
        if len(totals) > 1:
            result["problems"].append(f"pdf_caption_totals:{sorted(totals)}")
    result["ok"] = not result["problems"]
    document.close()
    return result


CONFUSABLES = str.maketrans("МХНКСРОАВЕТмхнксроавет", "MXHKCPOAВЕТmxhkcpoaвeт")
TOKEN_NOISE = re.compile(r"[\s·]")


def normalize_token(value: str) -> str:
    """Приводит обозначение к сравнимому виду: латиница/кириллица-двойники и пробелы не считаем."""
    return TOKEN_NOISE.sub("", str(value).translate(CONFUSABLES)).lower()


# ---------------------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description="Сквозной QA-прогон корпуса чертежей")
    parser.add_argument("--corpus", default="qa/corpus", type=Path)
    parser.add_argument("--out", default="qa/output", type=Path)
    parser.add_argument("--port", default=8011, type=int)
    parser.add_argument("--limit", default=0, type=int, help="0 — весь корпус")
    parser.add_argument("--timeout", default=120.0, type=float)
    parser.add_argument("--skip-node", action="store_true")
    parser.add_argument(
        "--reuse-vision",
        action="store_true",
        help="не гонять vision-api заново: взять уже сохранённые ответы из <out>/vision и results.jsonl",
    )
    parser.add_argument("--skip-gost", action="store_true")
    args = parser.parse_args()

    corpus: Path = args.corpus
    out: Path = args.out
    if not (corpus / "index.jsonl").exists():
        raise SystemExit(f"Нет индекса корпуса: {corpus / 'index.jsonl'}. Запустите generate_corpus.py")

    vision_dir = out / "vision"
    pdf_dir = out / "pdf"
    if pdf_dir.exists():
        shutil.rmtree(pdf_dir)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    if args.reuse_vision:
        if not (out / "results.jsonl").exists() or not vision_dir.exists():
            raise SystemExit(f"Нет сохранённых ответов для --reuse-vision: {out / 'results.jsonl'}")
    else:
        if vision_dir.exists():
            shutil.rmtree(vision_dir)
        vision_dir.mkdir(parents=True, exist_ok=True)

    cases = [json.loads(line) for line in (corpus / "index.jsonl").read_text().splitlines() if line.strip()]
    # В индексе slug — это имя файла с расширением, а в отчётах — без: сводим к одному ключу.
    expect_by_slug: dict[str, dict] = {
        Path(case["slug"]).stem: case.get("expect", {}) for case in cases
    }
    if args.limit:
        cases = cases[: args.limit]

    base = f"http://127.0.0.1:{args.port}"
    environment = dict(os.environ)
    environment["IKGUIDE_OCR_ENGINE"] = environment.get("IKGUIDE_OCR_ENGINE", "auto")
    server = None
    if not args.reuse_vision:
        server = subprocess.Popen(
            [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(args.port), "--log-level", "warning"],
            cwd=VISION_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=environment,
        )
    try:
        results: list[dict] = []
        started_all = time.time()
        rss_peak_mb = 0.0
        if args.reuse_vision:
            results = [json.loads(line) for line in (out / "results.jsonl").read_text().splitlines() if line.strip()]
            results = results[: len(cases)]
            print(f"▸ vision-api: берём готовые ответы ({len(results)} кейсов), документы и PDF собираем заново")
            cases = cases[: len(results)]
        else:
            health = wait_for_health(base)
            print(f"▸ vision-api: OCR={health.get('ocr')} engines={health.get('ocrEngines')}")

        for index, case in enumerate(cases if server else [], 1):
            path = corpus / case["slug"]
            if not path.exists():
                results.append({"slug": case["slug"], "category": case.get("category"), "status": -1, "error": "missing_file"})
                continue
            status, body, elapsed = post_file(base, path, args.timeout)
            record = {
                "slug": case["slug"],
                "category": case.get("category"),
                "expect": case.get("expect", {}),
                "status": status,
                "ms": round(elapsed * 1000),
                "error": body if isinstance(body, str) else None,
            }
            (vision_dir / f"{path.stem}.json").write_text(
                json.dumps({"__status": status, "body": body if isinstance(body, dict) else None, "__error": record["error"]}, ensure_ascii=False),
                encoding="utf-8",
            )
            if isinstance(body, dict):
                record["candidates"] = len(body.get("candidates", []))
                record["bomRows"] = len(body.get("bomRows", []))
                record["views"] = len(body.get("views", []))
                record["pages"] = len(body.get("pages", []))
                record["upscale"] = (body.get("pages") or [{}])[0].get("upscale", 1)
                record["warnings"] = body.get("warnings", [])[:6]
                record["tokens"] = [item.get("normalizedText", "") for item in body.get("candidates", [])][:40]
            results.append(record)

            if status >= 500 or status == 0:
                print(f"  ! {path.name}: status={status} {record['error']}")
            # Сервер обязан оставаться живым, особенно после мусора.
            if index % 100 == 0 or case.get("category", "").startswith("fuzz"):
                alive, _, _ = post_file(base, corpus / "_health", 5) if False else (True, None, 0)
                try:
                    with urllib.request.urlopen(f"{base}/health", timeout=4) as response:
                        alive = response.status == 200
                except Exception:
                    alive = False
                record["server_alive"] = alive
                if not alive:
                    print(f"  ! сервер умер на {index}-м кейсе ({path.name})")
            if index % 50 == 0:
                current_rss = rss_mb(server.pid) if server else 0.0
                rss_peak_mb = max(rss_peak_mb, current_rss)
                print(f"  … {index}/{len(cases)}  rss={current_rss} МБ")

        vision_seconds = time.time() - started_all
        (out / "results.jsonl").write_text(
            "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in results), encoding="utf-8"
        )
        print(f"✓ vision: {len(results)} кейсов за {vision_seconds:.1f} с")

        # Движок держит в памяти до 1,4 ГБ страниц: его надо остановить до сборки PDF,
        # иначе Node с jsPDF и Python вместе упираются в OOM (SIGKILL на ~290-м PDF).
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
            server = None

        # ------------------------------------------------------------- документы и PDF
        stats: list[dict] = []
        if not args.skip_node:
            bundle(ROOT / "scripts" / "qa" / "build_docs.ts", out / "build_docs.cjs")
            print("▸ build_docs (builder + pdf-exporter)…")
            chunks = 6
            stats_path = out / "stats.jsonl"
            if stats_path.exists():
                stats_path.unlink()
            for chunk in range(chunks):
                subprocess.run(
                    [
                        "node",
                        str(out / "build_docs.cjs"),
                        "--vision",
                        str(vision_dir),
                        "--pdf",
                        str(pdf_dir),
                        "--stats",
                        str(stats_path),
                        "--chunk",
                        f"{chunk}/{chunks}",
                        "--append",
                    ],
                    check=True,
                    cwd=ROOT,
                )
            stats = [json.loads(line) for line in (out / "stats.jsonl").read_text().splitlines() if line.strip()]

        # ------------------------------------------------------------- проверка PDF
        pdf_reports = []
        for record in stats:
            pdf_path = pdf_dir / f"{record['slug']}.pdf"
            if not pdf_path.exists():
                continue
            fragments = record.get("fragments") or {}
            expects_images = bool(fragments.get("fragments"))
            pdf_reports.append(check_pdf(pdf_path, record.get("planPages"), expects_images))
        print(f"✓ PDF: {len(pdf_reports)} проверено, битых {sum(1 for item in pdf_reports if not item['ok'])}")

        # ------------------------------------------------------------- фаззинг ГОСТ
        gost: dict | None = None
        if not args.skip_gost:
            bundle(ROOT / "scripts" / "qa" / "fuzz_gost.ts", out / "fuzz_gost.cjs")
            print("▸ фаззинг ГОСТ-переводчика…")
            environment_gost = dict(os.environ, GOST_OUT=str(out / "gost.json"))
            subprocess.run(["node", str(out / "fuzz_gost.cjs")], cwd=ROOT, check=True, env=environment_gost)
            gost = json.loads((out / "gost.json").read_text())
            print(f"✓ ГОСТ: {gost['total']} строк, провалов {gost['fails']}")

        (out / "results.jsonl").write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in results), encoding="utf-8")

        summary = {
            "cases": len(results),
            "vision": summarize_vision(results),
            "docs": summarize_docs(results, stats, expect_by_slug),
            "pdf": summarize_pdf(pdf_reports),
            "gost": gost,
            "rssMb": rss_mb(server.pid) if server else 0,
            "rssPeakMb": round(rss_peak_mb, 1),
            "visionSeconds": round(vision_seconds, 1),
        }
        (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({key: summary[key] for key in ("cases", "vision", "pdf", "rssMb")}, ensure_ascii=False, indent=2))
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
            stderr = server.stderr.read().decode("utf-8", "replace") if server.stderr else ""
            if stderr.strip():
                (out / "server_stderr.log").write_text(stderr, encoding="utf-8")
                print(f"! stderr сервера сохранён: {out / 'server_stderr.log'} ({len(stderr)} символов)")


def summarize_vision(results: list[dict]) -> dict:
    statuses = Counter(item["status"] for item in results)
    by_category: dict[str, dict] = {}
    for item in results:
        bucket = by_category.setdefault(item["category"], {"count": 0, "ok": 0, "candidates": 0, "bom": 0, "views": 0, "fivexx": 0})
        bucket["count"] += 1
        if 200 <= item["status"] < 300:
            bucket["ok"] += 1
        if item["status"] >= 500:
            bucket["fivexx"] += 1
        bucket["candidates"] += item.get("candidates", 0)
        bucket["bom"] += item.get("bomRows", 0)
        bucket["views"] += item.get("views", 0)
    times = sorted(item["ms"] for item in results if item["status"] != -1)
    return {
        "statuses": dict(statuses),
        "byCategory": by_category,
        "p50Ms": times[len(times) // 2] if times else 0,
        "p95Ms": times[int(len(times) * 0.95)] if times else 0,
        "maxMs": times[-1] if times else 0,
        "serverDeaths": sum(1 for item in results if item.get("server_alive") is False),
    }


def summarize_docs(results: list[dict], stats: list[dict], expect_by_slug: dict[str, dict]) -> dict:
    if not stats:
        return {}
    built = [item for item in stats if item.get("builder") == "ok"]
    failed = [item for item in stats if item.get("builder") == "failed"]
    placeholders = [item for item in built if item.get("placeholder")]
    step_counts = [item["steps"] for item in built]
    crops_all = [item for item in built if (item.get("crops") or 0) > 0]
    crops_same = [item for item in crops_all if (item.get("uniqueCrops") or 0) <= 1 and (item.get("steps") or 0) > 2]
    pdf_ok = [item for item in built if item.get("pdfHeader") == "%PDF-"]
    by_category: dict[str, dict] = {}
    expect = expect_by_slug
    for item in built:
        category = expect.get(item["slug"], {}).get("kind", "unknown")
        bucket = by_category.setdefault(category, {"count": 0, "steps": 0, "placeholder": 0})
        bucket["count"] += 1
        bucket["steps"] += item.get("steps", 0)
        if item.get("placeholder"):
            bucket["placeholder"] += 1

    # Совпадение с ground truth: сколько ожидаемых обозначений дошло до документа.
    token_hits = 0
    token_total = 0
    for item in built:
        expected = expect.get(item["slug"], {}).get("tokens") or []
        if not expected:
            continue
        text = normalize_token(item.get("docText") or " ".join(item.get("titles") or []))
        for token in expected:
            head = normalize_token(str(token).split()[0])
            if not head:
                continue
            token_total += 1
            if head in text:
                token_hits += 1

    return {
        "built": len(built),
        "failed": len(failed),
        "failedReasons": Counter(item.get("reason", "")[:80] for item in failed).most_common(8),
        "placeholders": len(placeholders),
        "placeholderShare": round(len(placeholders) / max(1, len(built)) * 100, 1),
        "avgSteps": round(statistics.fmean(step_counts), 2) if step_counts else 0,
        "minSteps": min(step_counts) if step_counts else 0,
        "maxSteps": max(step_counts) if step_counts else 0,
        "pdfRendered": len(pdf_ok),
        "cropUniqueShare": round((len(crops_all) - len(crops_same)) / max(1, len(crops_all)) * 100, 1),
        "cropsIdentical": len(crops_same),
        "tokenRecall": round(token_hits / token_total * 100, 1) if token_total else 0,
        "byKind": by_category,
    }


def summarize_pdf(reports: list[dict]) -> dict:
    if not reports:
        return {}
    problems = Counter(problem.split(":")[0] for item in reports for problem in item["problems"])
    cyrillic_ok = sum(1 for item in reports if item.get("cyrillic", 0) > 0)
    return {
        "checked": len(reports),
        "ok": sum(1 for item in reports if item["ok"]),
        "problems": dict(problems),
        "withCyrillic": cyrillic_ok,
        "withImages": sum(1 for item in reports if item.get("images", 0) > 0),
        "avgPages": round(statistics.fmean(item.get("pages", 0) for item in reports), 2),
    }


if __name__ == "__main__":
    main()
