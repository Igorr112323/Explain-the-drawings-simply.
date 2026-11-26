"""Recognition-level cleanup of OCR artifacts.

Scope is deliberately narrow: this module repairs characters that OCR confuses (Latin/Cyrillic,
Ø, ×, decimal comma) and it never interprets GOST rules. Deciding that «М8 = отверстие Ø6,8 +
метчик М8» stays in the TypeScript translator — the single source of truth.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Cyrillic letters that look like Latin ones are mapped only in notations where the letter is fixed
# by GOST: fit fields (H7, h6, K5…) are always Latin, threads are always Cyrillic М.
FIT_LETTERS = "HhKkGgFfDd"

THREAD_PATTERN = re.compile(r"^[МM]\s*\d")
FIT_PATTERN = re.compile(r"^(?:Ø\s*)?\d+(?:[.,]\d+)?\s*([A-Za-zА-Яа-я]{1,2})\s*\d{1,2}(?:\s*/\s*[A-Za-zА-Яа-я]{1,2}\s*\d{1,2})?$")
ROUGHNESS_PATTERN = re.compile(r"^[РPpP][аaА]\s*\d", re.IGNORECASE)
WELD_PATTERN = re.compile(r"^[TТt]\s*\d{1,2}(?:\s*-\s*[КK]\s*\d+)?")

DIAMETER_LEADERS = "Фф0ОoOДдDdQq"

# Only a whole value is ambiguous: «20» is not «26», but «6» really can be «8».
AMBIGUOUS_TOKENS: dict[str, list[str]] = {
    "6": ["8"],
    "8": ["6"],
    "12": ["18"],
    "18": ["12"],
    "3": ["8"],
    "5": ["6"],
    "9": ["6"],
}


@dataclass
class NormalizedText:
    text: str
    applied: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.applied)


def _fix_decimal_comma(text: str) -> str:
    """3.2 → 3,2 (Russian drawings use a comma) while keeping codes like 04.100.000 intact."""

    def repair(match: re.Match[str]) -> str:
        token = match.group(0)
        digits = re.sub(r"\D", "", token)
        return token.replace(".", ",") if len(digits) <= 5 else token

    return re.sub(r"\d+(?:\.\d+)+", repair, text)


DIAMETER_TOKEN = re.compile(
    r"^(?:\d+(?:[.,]\d+)?)(?:\s*(?:±\s*\d+(?:[.,]\d+)?|мм|[HhНнКк]\d{1,2}|отв\.?.*|глуб\..*))?$"
)


def _fix_diameter(text: str) -> tuple[str, bool]:
    """Restores Ø from Ф/0/O/D, but never from a material code such as 09Г2С."""
    stripped = text.strip()
    if not stripped:
        return text, False
    if stripped[0] in "⌀∅":
        return "Ø" + stripped[1:].lstrip(), True
    if stripped[0] == "Ø":
        return text, False
    if stripped[0] not in DIAMETER_LEADERS or len(stripped) < 2:
        return text, False

    candidate = stripped[1:].lstrip()
    if not candidate[:1].isdigit():
        return text, False
    if not DIAMETER_TOKEN.match(candidate):
        return text, False
    # A leading zero is only a stand-in for Ø when the value looks like a diameter (Ø20, not 0,5).
    if stripped[0] == "0" and candidate.startswith(("0", ",")):
        return text, False
    return "Ø" + candidate, True


def _fix_fit_letters(text: str) -> tuple[str, bool]:
    match = FIT_PATTERN.match(text.strip())
    if not match:
        return text, False
    repaired = text
    changed = False
    for cyrillic, latin in (("Н", "H"), ("н", "h"), ("К", "K"), ("к", "k"), ("С", "C"), ("с", "c"), ("Д", "D"), ("д", "d")):
        if cyrillic in repaired:
            repaired = repaired.replace(cyrillic, latin)
            changed = True
    return repaired, changed


def _fix_notation_letters(text: str) -> tuple[str, bool]:
    repaired = text
    changed = False
    if THREAD_PATTERN.match(repaired) and repaired[0] == "M":
        repaired = "М" + repaired[1:]
        changed = True
    if WELD_PATTERN.match(repaired.strip()) and repaired.lstrip()[:1] == "T":
        index = repaired.index("T")
        repaired = repaired[:index] + "Т" + repaired[index + 1 :]
        changed = True
    if ROUGHNESS_PATTERN.match(repaired.strip()):
        head = re.sub(r"^\s*[РPp][аaА]", "Ra", repaired)
        if head != repaired:
            changed = True
            repaired = head
    return repaired, changed


def _fix_multiplication(text: str) -> tuple[str, bool]:
    repaired = re.sub(r"(?<=\d)\s*[xXхХ]\s*(?=\d)", "×", text)
    repaired = replaced = re.sub(r"(?<=\d)\s*[×*]\s*(?=\d)", "×", repaired)
    return repaired, replaced != text


def _tidy_punctuation(text: str) -> str:
    tidied = text
    tidied = re.sub(r"\bотв\s*[,;:]?", "отв.", tidied, flags=re.IGNORECASE)
    tidied = re.sub(r"\bглуб\s*[,;]?", "глуб.", tidied, flags=re.IGNORECASE)
    tidied = re.sub(r"\s*[|_~`\"'«»]+\s*", " ", tidied)
    tidied = re.sub(r"\s{2,}", " ", tidied).strip(" .,;:-")
    return tidied


def normalize_text(raw: str) -> NormalizedText:
    """Repairs one OCR line. Deterministic: the same input always gives the same output."""
    applied: list[str] = []
    text = (raw or "").replace("\n", " ").strip()
    if not text:
        return NormalizedText(text="", applied=applied)

    text = re.sub(r"\s+", " ", text)
    before = text
    text = _fix_decimal_comma(text)
    if text != before:
        applied.append("decimal_comma")

    text, changed = _fix_diameter(text)
    if changed:
        applied.append("diameter_symbol")

    text, changed = _fix_fit_letters(text)
    if changed:
        applied.append("fit_letter")

    text, changed = _fix_notation_letters(text)
    if changed:
        applied.append("notation_letter")

    text, changed = _fix_multiplication(text)
    if changed:
        applied.append("multiplication_sign")

    tidied = _tidy_punctuation(text)
    if tidied != text:
        applied.append("punctuation")
        text = tidied

    return NormalizedText(text=text, applied=applied)


def ambiguity_options(raw: str, normalized: str) -> list[str]:
    """Alternative readings of a visually ambiguous token, best reading first."""
    if not normalized:
        return []

    options: list[str] = [normalized]
    raw_stripped = (raw or "").strip()

    if normalized.startswith("Ø") and raw_stripped:
        first = raw_stripped[0]
        if first in DIAMETER_LEADERS or first in "Фф0ОoO":
            options.append("R" + normalized[1:])
            options.append(normalized[1:] + " (без символа)")
            return options

    token_match = re.search(r"\d+(?:,\d+)?", normalized)
    if not token_match:
        return options

    numeric = token_match.group(0)
    variants = [variant for variant in AMBIGUOUS_TOKENS.get(numeric, []) if variant != numeric]

    for variant in variants:
        if variant == numeric:
            continue
        candidate = normalized[: token_match.start()] + variant + normalized[token_match.end() :]
        if candidate not in options:
            options.append(candidate)

    return options[:3]


def calibrate_confidence(
    base: float,
    normalized: NormalizedText,
    *,
    rotation: int = 0,
    ambiguous: bool = False,
    text_height_px: int = 0,
) -> float:
    """Turns a raw engine score into an honest calibrated confidence (never optimistic)."""
    value = min(0.99, max(0.0, base))
    value -= 0.02 * len(normalized.applied)
    if rotation:
        value -= 0.03
    if ambiguous:
        value = min(value, 0.92)
    if 0 < text_height_px < 12:
        value -= 0.03
    if len(normalized.text) <= 1:
        value -= 0.05
    return round(min(0.99, max(0.05, value)), 3)


def looks_like_engineering_text(text: str) -> bool:
    """Filters OCR garbage before it reaches the translator."""
    stripped = text.strip()
    if len(stripped) < 2:
        return False
    if len(re.findall(r"[A-Za-zА-Яа-я0-9]", stripped)) < 2:
        return False
    if re.search(r"\d", stripped):
        return True
    return bool(re.search(r"(Ra|Rz|отв|фаск|свар|Ø|R\d|М)", stripped, re.IGNORECASE))


TOLERANCE_FIELD = re.compile(r"^(?:JS|js|H|h|K|k|G|g|F|f|D|d|Н|н|К|к)\s*\d{1,2}$")


def merge_fragments(left: str, right: str) -> str:
    """Joins split OCR lines such as «4 отв.» + «М8-7H» that belong to one callout."""
    left = left.strip()
    right = right.strip()
    if not left:
        return right
    if not right:
        return left
    if left.endswith(("Ø", "М", "R", "Н", "H", "К", "K", "/", "-", "+", "±", "×")):
        return left + right
    if right[0] in "×°/+-":
        return left + right
    if left[-1].isdigit() and TOLERANCE_FIELD.match(right):
        return left + right  # Ø20 + H7 → Ø20H7
    return f"{left} {right}"
