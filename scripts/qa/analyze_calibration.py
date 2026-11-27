"""Калибровка уверенности OCR: чем выше `confidence`, тем чаще обозначение настоящее?

Берём ответы движка из `qa/output/vision/*.json` и ground truth из `qa/corpus/index.jsonl`:
кандидат считается верным, если нормализованная строка совпала с ожидаемым обозначением листа
(в любую сторону, без учёта пробелов и путаницы латиницы/кириллицы).

    python scripts/qa/analyze_calibration.py --corpus qa/corpus --vision qa/output/vision
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

CONFUSABLES = str.maketrans("МХНКСРОАВЕТмхнксроавет", "MXHKCPOAВЕТmxhkcpoaвeт")
NOISE = re.compile(r"[\s·]")
BANDS = ((0.0, 0.6), (0.6, 0.8), (0.8, 0.95), (0.95, 1.01))


def norm(value: str) -> str:
    return NOISE.sub("", str(value).translate(CONFUSABLES)).lower()


def main() -> None:
    parser = argparse.ArgumentParser(description="Калибровка confidence по корпусу")
    parser.add_argument("--corpus", type=Path, default=Path("qa/corpus"))
    parser.add_argument("--vision", type=Path, default=Path("qa/output/vision"))
    parser.add_argument("--out", type=Path, default=Path("qa/output/calibration.json"))
    args = parser.parse_args()

    expected_by_slug: dict[str, list[str]] = {}
    for line in (args.corpus / "index.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        expected_by_slug[Path(case["slug"]).stem] = [
            norm(token) for token in (case.get("expect", {}).get("tokens") or [])
        ]

    bands: dict[str, dict[str, int]] = {
        f"{low:.2f}–{min(high, 1.0):.2f}": {"candidates": 0, "matched": 0, "sheets": 0} for low, high in BANDS
    }
    per_sheet: list[dict] = []

    for path in sorted(args.vision.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        body = payload.get("body") or {}
        expected = expected_by_slug.get(path.stem, [])
        candidates = body.get("candidates") or []
        matched = 0
        for candidate in candidates:
            text = norm(candidate.get("normalizedText") or candidate.get("rawText") or "")
            if not text:
                continue
            confidence = float(candidate.get("confidence") or 0.0)
            is_true = any(token and (token in text or text in token) for token in expected)
            matched += int(is_true)
            for low, high in BANDS:
                if low <= confidence < high:
                    key = f"{low:.2f}–{min(high, 1.0):.2f}"
                    bands[key]["candidates"] += 1
                    bands[key]["matched"] += int(is_true)
                    bands[key]["sheets"] += 1
                    break
        if expected and candidates:
            per_sheet.append(
                {
                    "slug": path.stem,
                    "expected": len(expected),
                    "candidates": len(candidates),
                    "matched": matched,
                    "meanConfidence": round(
                        sum(float(item.get("confidence") or 0.0) for item in candidates) / max(1, len(candidates)),
                        3,
                    ),
                }
            )

    summary = {
        "bands": {
            key: {
                "candidates": value["candidates"],
                "matched": value["matched"],
                "precision": round(value["matched"] / value["candidates"] * 100, 1) if value["candidates"] else None,
            }
            for key, value in bands.items()
        },
        "sheets": {
            "count": len(per_sheet),
            "meanCandidates": round(sum(item["candidates"] for item in per_sheet) / max(1, len(per_sheet)), 2),
            "meanMatched": round(sum(item["matched"] for item in per_sheet) / max(1, len(per_sheet)), 2),
            "meanConfidence": round(sum(item["meanConfidence"] for item in per_sheet) / max(1, len(per_sheet)), 3),
        },
        "confidenceHistogram": dict(sorted(Counter(round(item["meanConfidence"], 1) for item in per_sheet).items())),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
