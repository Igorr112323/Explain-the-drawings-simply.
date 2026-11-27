"""Сводные таблицы для отчёта `qa/QA_REPORT_1000.md`.

Читает `qa/output/summary.json`, `qa/output/results.jsonl`, `qa/output/stats.jsonl` и
`qa/output/gost.json` и печатает markdown-таблицы по категориям корпуса.

    python scripts/qa/report_tables.py --out qa/output
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Таблицы для QA-отчёта")
    parser.add_argument("--out", type=Path, default=Path("qa/output"))
    parser.add_argument("--corpus", type=Path, default=Path("qa/corpus"))
    args = parser.parse_args()

    summary = json.loads((args.out / "summary.json").read_text(encoding="utf-8"))
    results = [json.loads(line) for line in (args.out / "results.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    stats = {}
    stats_path = args.out / "stats.jsonl"
    if stats_path.exists():
        for line in stats_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                stats[record["slug"]] = record

    categories: dict[str, dict] = defaultdict(lambda: {"files": 0, "ok200": 0, "rejected": 0, "failed": 0})
    for record in results:
        slug = Path(record["slug"]).stem
        category = record.get("category") or "unknown"
        categories[category]["files"] += 1
        status = record.get("status", 0)
        if status == 200:
            categories[category]["ok200"] += 1
        elif status in (400, 413, 415, 422):
            categories[category]["rejected"] += 1
        else:
            categories[category]["failed"] += 1

    doc_rows: dict[str, dict] = defaultdict(lambda: {"built": 0, "stub": 0, "crops": 0, "unique": 0, "fragments": 0, "pages": 0})
    for slug, record in stats.items():
        if record.get("builder") != "ok":
            continue
        category = record.get("category_hint") or next(
            (item.get("category") for item in results if Path(item["slug"]).stem == slug), "unknown"
        )
        row = doc_rows[category]
        row["built"] += 1
        row["stub"] += int(bool(record.get("placeholder")))
        row["crops"] += int(record.get("crops") or 0)
        row["unique"] += int(record.get("uniqueCrops") or 0)
        row["fragments"] += int((record.get("fragments") or {}).get("fragments") or 0)
        row["pages"] += int(record.get("planPages") or 0)

    order = ["gost_mech", "assembly_bom", "welded", "construction", "small_web", "phone_photo", "pdf_family", "fuzz"]
    print("| Категория | Файлов | 200 OK | 422 (мусор) | Ошибок |")
    print("|---|---|---|---|---|")
    for category in order:
        row = categories.get(category)
        if not row:
            continue
        print(f"| {category} | {row['files']} | {row['ok200']} | {row['rejected']} | {row['failed']} |")
    total = {key: sum(categories[cat][key] for cat in categories) for key in ("files", "ok200", "rejected", "failed")}
    print(f"| **итого** | **{total['files']}** | **{total['ok200']}** | **{total['rejected']}** | **{total['failed']}** |")

    print()
    print("| Категория | Инструкций | Двухшаговых | Кропов | Уникальных | Фрагментов в PDF | Страниц PDF |")
    print("|---|---|---|---|---|---|---|")
    for category in order:
        row = doc_rows.get(category)
        if not row:
            continue
        print(
            f"| {category} | {row['built']} | {row['stub']} | {row['crops']} | {row['unique']} | "
            f"{row['fragments']} | {row['pages']} |"
        )
    print(
        "| **итого** | "
        + " | ".join(
            f"**{sum(doc_rows[c][key] for c in doc_rows)}**"
            for key in ("built", "stub", "crops", "unique", "fragments", "pages")
        )
        + " |"
    )

    pdf = summary["pdf"]
    gost = summary.get("gost") or {}
    print()
    print(f"PDF: проверено {pdf['checked']}, без замечаний {pdf['ok']}, страниц {pdf.get('avgPages')} в среднем.")
    print(f"ГОСТ-фаззинг: {gost.get('fails')} провалов на {gost.get('total')} строках.")


if __name__ == "__main__":
    main()
