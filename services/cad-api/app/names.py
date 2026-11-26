"""Part naming helpers: readable display names, stable node names, fastener notations."""

from __future__ import annotations

import re

_TRANSLITERATION = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
}

_GENERIC_SUFFIX = re.compile(r"\.(step|stp|stl|obj|glb|gltf)$", re.IGNORECASE)
_SPACES = re.compile(r"[\s_]+")

THREAD_NOTATION = re.compile(
    r"\bM\s?(\d{1,2}(?:[.,]\d)?)\s*(?:[x×х]\s*(\d{1,2}(?:[.,]\d)?))?",
    re.IGNORECASE,
)
STANDARD_NOTATION = re.compile(r"\b(DIN|ISO|ГОСТ|GOST)\s*[- ]?\s*(\d{2,5}(?:-\d{2,4})?)\b", re.IGNORECASE)


def humanize(raw: str | None, fallback: str = "Деталь") -> str:
    """Turns ``Bolt_M6x20_Solid`` into ``Bolt M6x20`` without inventing anything."""
    if not raw:
        return fallback
    name = _GENERIC_SUFFIX.sub("", str(raw)).strip()
    name = name.replace("\u00a0", " ")
    name = _SPACES.sub(" ", name)
    name = re.sub(r"^(solid|body|part|shell|compound|mesh|object)[\s\-_]*", "", name, flags=re.IGNORECASE)
    name = name.strip(" -_.")
    if not name:
        return fallback
    return name


def slugify(raw: str, fallback: str = "part") -> str:
    """ASCII, lowercase, dashes: node names stay stable across revisions."""
    lowered = (raw or "").strip().lower()
    out: list[str] = []
    for char in lowered:
        if char in _TRANSLITERATION:
            out.append(_TRANSLITERATION[char])
        elif char.isalnum():
            out.append(char)
        else:
            out.append("-")
    slug = re.sub(r"-{2,}", "-", "".join(out)).strip("-")
    slug = slug[:40].strip("-")
    return slug or fallback


def unique_slug(base: str, used: set[str]) -> str:
    slug = base
    index = 2
    while slug in used:
        slug = f"{base}-{index}"
        index += 1
    used.add(slug)
    return slug


def extract_notation(raw: str | None) -> str | None:
    """Pulls «М6×20» or «DIN 912» out of a part name, without guessing."""
    if not raw:
        return None
    thread = THREAD_NOTATION.search(raw)
    if thread:
        size = thread.group(1).replace(",", ".")
        length = thread.group(2)
        diameter = size.split(".")[0]
        if not length:
            return f"М{diameter}"
        return f"М{diameter}×{length.replace(',', '.')}"
    standard = STANDARD_NOTATION.search(raw)
    if standard:
        return f"{standard.group(1).upper()} {standard.group(2)}"
    return None


def group_key(name: str, notation: str | None, size: tuple[float, float, float]) -> str:
    """Fasteners of one node with the same size share a single step."""
    stem = re.sub(r"\d+", "", name.lower())
    stem = re.sub(r"[\s\-_.]+", " ", stem).strip()
    rounded = ",".join(f"{round(value)}" for value in sorted(size))
    return f"{stem}|{notation or ''}|{rounded}"


_PLURALS = (
    ("болт", ("болт", "болта", "болтов")),
    ("винт", ("винт", "винта", "винтов")),
    ("гайк", ("гайка", "гайки", "гаек")),
    ("шайб", ("шайба", "шайбы", "шайб")),
    ("шпильк", ("шпилька", "шпильки", "шпилек")),
    ("саморез", ("саморез", "самореза", "саморезов")),
    ("закл", ("заклёпка", "заклёпки", "заклёпок")),
    ("bolt", ("bolt", "bolts", "bolts")),
    ("screw", ("screw", "screws", "screws")),
    ("nut", ("nut", "nuts", "nuts")),
    ("washer", ("washer", "washers", "washers")),
)


def _russian_form(count: int, forms: tuple[str, str, str]) -> str:
    if count % 10 == 1 and count % 100 != 11:
        return forms[0]
    if 2 <= count % 10 <= 4 and not 12 <= count % 100 <= 14:
        return forms[1]
    return forms[2]


def _matched_head(name: str) -> tuple[str, str] | None:
    """Returns (head word, tail) when the head word is a hardware noun."""
    head, separator, tail = name.partition(" ")
    lowered = head.lower()
    for stem, _forms in _PLURALS:
        if stem in lowered:
            return head, (separator + tail if separator else "")
    return None


def pluralize_fastener(name: str, count: int) -> str:
    """«Шайба 6» + 4 → «Шайбы 6»: replaces the head noun, keeps everything else."""
    if count == 1:
        return name
    matched = _matched_head(name)
    if matched is None:
        return name
    head, tail = matched
    lowered = head.lower()
    for stem, forms in _PLURALS:
        if stem not in lowered:
            continue
        if stem in ("bolt", "screw", "nut", "washer"):
            return forms[1] + tail
        return _match_case(_russian_form(count, forms), head) + tail
    return name


def _match_case(value: str, reference: str) -> str:
    """Keeps the capitalisation of the original word."""
    if not value or not reference:
        return value
    if reference[0].isupper():
        return value[0].upper() + value[1:]
    return value


ACCUSATIVE_EXCEPTIONS = {
    "крышка": "крышку",
    "крышечка": "крышечку",
    "планка": "планку",
    "втулка": "втулку",
    "пружина": "пружину",
    "плита": "плиту",
    "пластина": "пластину",
    "прокладка": "прокладку",
    "муфта": "муфту",
}


def accusative(name: str) -> str:
    """«Установи крышку», «Уложи плиту» — a light-touch accusative for the head noun."""
    head, separator, tail = (name or "").partition(" ")
    if not head:
        return name
    lowered = head.lower()
    if lowered in ACCUSATIVE_EXCEPTIONS:
        replacement = ACCUSATIVE_EXCEPTIONS[lowered]
    elif lowered.endswith("а"):
        replacement = lowered[:-1] + "у"
    elif lowered.endswith("я"):
        replacement = lowered[:-1] + "ю"
    else:
        replacement = head
    return _match_case(replacement, head) + (separator + tail if separator else "")


def fastener_verb(name: str) -> str:
    """Washers are put on, nuts and screws are tightened."""
    lowered = (name or "").lower()
    if "шайб" in lowered or "washer" in lowered:
        return "Надень"
    if "гайк" in lowered or "nut" in lowered:
        return "Закрути"
    if "штифт" in lowered or "pin" in lowered:
        return "Забей"
    return "Закрути"


def has_notation(name: str, notation: str | None) -> bool:
    if not notation:
        return True
    normalized_name = (name or "").lower().replace("х", "x").replace("×", "x").replace(" ", "")
    normalized_notation = notation.lower().replace("м", "m").replace("х", "x").replace("×", "x").replace(" ", "")
    core = normalized_notation.lstrip("m")
    return core in normalized_name or normalized_notation in normalized_name
