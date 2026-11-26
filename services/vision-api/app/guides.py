"""Опубликованные цеховые инструкции: короткая ссылка вместо мегабайтов в QR.

Инженер нажимает «Опубликовать в цех» — студия отправляет сюда весь `IkGuideDocument`
(включая `assembly3d` с `.glb` и SVG-схемы), сервис кладёт его на диск цехового ПК и
возвращает короткий `id`. В QR уезжает только ссылка `/?guideId=<id>&api=http://<ip>:8000`,
поэтому код читается с трёх метров и с экрана телефона, а телефон рабочего забирает полную
инструкцию уже по Wi-Fi цеха и сохраняет её в офлайн-память.

Ключевые решения:
  * файлы, а не база: `data/guides/{id}.json` + `{id}.summary.json` рядом — цеховой ПК
    можно просто скопировать на флешку;
  * `id` — 8 символов `[a-z0-9]`, проверяется регуляркой **до** обращения к файловой
    системе, а итоговый путь дополнительно проверяется на выход за пределы каталога
    (защита от path traversal вида `../../etc/passwd`);
  * дедупликация по SHA-256: повторная публикация той же инструкции возвращает тот же
    `id`, а не плодит копии по 40 МБ;
  * лимит размера и количества: старые инструкции вытесняются, диск цеха не забивается.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from . import config

# Только эти символы допустимы в идентификаторе: ни слэшей, ни точек, ни пробелов.
GUIDE_ID_RE = re.compile(r"^[a-z0-9]{6,12}$")
# Алфавит без похожих символов (0/o, 1/l), чтобы код можно было продиктовать по телефону.
GUIDE_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

REQUIRED_KEYS = ("schemaVersion", "id", "metadata", "steps", "bom", "tools", "qcChecklist")


class GuideError(Exception):
    """Ошибка публикации с HTTP-статусом и русским текстом для интерфейса."""

    def __init__(self, status: int, message: str, code: str = "guide_error") -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


@dataclass(frozen=True)
class StoredGuide:
    """Краткая карточка опубликованной инструкции."""

    id: str
    title: str
    drawingCode: str
    createdAt: str
    sizeBytes: int
    has3d: bool
    revision: str
    steps: int
    sha256: str
    # Монотонный номер публикации: сортировка и вытеснение не зависят от точности mtime ФС.
    seq: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "drawingCode": self.drawingCode,
            "revision": self.revision,
            "createdAt": self.createdAt,
            "sizeBytes": self.sizeBytes,
            "has3d": self.has3d,
            "steps": self.steps,
            "url": f"/v1/guides/{self.id}",
            "seq": self.seq,
        }


def validate_document(document: Any) -> dict[str, Any]:
    """Проверяет то, без чего инструкция не откроется у рабочего.

    Полную проверку схемы делает TypeScript (`@ikguide/schema`) — здесь только конверт:
    сервис на Python не должен дублировать 800 строк Zod-схемы, но обязан не пускать
    мусор в QR-ссылку, которую цех будет открывать неделями.
    """

    if not isinstance(document, dict):
        raise GuideError(422, "Инструкция должна быть JSON-объектом.", "invalid_document")

    missing = [key for key in REQUIRED_KEYS if key not in document]
    if missing:
        raise GuideError(
            422,
            f"В инструкции нет обязательных полей: {', '.join(missing)}.",
            "invalid_document",
        )

    if not isinstance(document.get("steps"), list) or not document["steps"]:
        raise GuideError(422, "В инструкции нет ни одного шага.", "invalid_document")
    if not isinstance(document.get("bom"), list) or not document["bom"]:
        raise GuideError(422, "В инструкции нет комплектации.", "invalid_document")
    if not isinstance(document.get("tools"), list) or not document["tools"]:
        raise GuideError(422, "В инструкции нет списка инструмента.", "invalid_document")
    if not isinstance(document.get("qcChecklist"), list) or not document["qcChecklist"]:
        raise GuideError(422, "В инструкции нет чек-листа ОТК.", "invalid_document")

    metadata = document.get("metadata")
    if not isinstance(metadata, dict):
        raise GuideError(422, "В инструкции нет блока metadata.", "invalid_document")
    for field, label in (("title", "название"), ("drawingCode", "шифр чертежа")):
        value = metadata.get(field)
        if not isinstance(value, str) or not value.strip():
            raise GuideError(422, f"В инструкции не заполнено поле «{label}».", "invalid_document")

    if not isinstance(document.get("id"), str) or not document["id"].strip():
        raise GuideError(422, "В инструкции нет идентификатора документа.", "invalid_document")

    return document


def document_fingerprint(document: dict[str, Any]) -> str:
    """SHA-256 канонического JSON: одинаковые инструкции не дублируются на диске."""

    canonical = json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def summarize(
    guide_id: str,
    document: dict[str, Any],
    size_bytes: int,
    created_at: str,
    seq: int = 0,
) -> StoredGuide:
    metadata = document.get("metadata") or {}
    assembly = document.get("assembly3d")
    has3d = isinstance(assembly, dict) and bool(assembly.get("parts"))
    return StoredGuide(
        id=guide_id,
        title=str(metadata.get("title") or "Без названия").strip(),
        drawingCode=str(metadata.get("drawingCode") or "—").strip(),
        revision=str(metadata.get("revision") or "").strip(),
        createdAt=created_at,
        sizeBytes=size_bytes,
        has3d=has3d,
        steps=len(document.get("steps") or []),
        sha256=document_fingerprint(document),
        seq=seq,
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_id(guide_id: str) -> str:
    """Проверяет идентификатор до любых операций с файлами."""

    candidate = (guide_id or "").strip().lower()
    if not GUIDE_ID_RE.match(candidate):
        raise GuideError(400, "Некорректный идентификатор инструкции: ожидается 6–12 символов a–z и 0–9.", "invalid_id")
    return candidate


class GuideStore:
    """Каталог опубликованных инструкций на диске цехового ПК."""

    def __init__(
        self,
        root: Path | str | None = None,
        max_guides: int = config.MAX_STORED_GUIDES,
        max_bytes: int = config.MAX_GUIDE_BYTES,
        id_length: int = config.GUIDE_ID_LENGTH,
    ) -> None:
        if root is None:
            # По умолчанию — рядом с сервисом, чтобы каталог не зависел от того, откуда запущен uvicorn.
            override = os.environ.get("IKGUIDE_GUIDES_DIR", "").strip()
            root = Path(override).expanduser() if override else Path(__file__).resolve().parents[1] / config.GUIDES_SUBDIR
        self.root = Path(root).resolve()
        self.max_guides = max(1, max_guides)
        self.max_bytes = max(1024, max_bytes)
        self.id_length = min(12, max(6, id_length))
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ служебное

    def ensure(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        return self.root

    def _path(self, guide_id: str) -> Path:
        safe = _safe_id(guide_id)
        path = (self.root / f"{safe}.json").resolve()
        # Вторая линия обороны: даже если регулярка когда-нибудь ослабнет, выйти из каталога нельзя.
        if self.root not in path.parents:
            raise GuideError(400, "Некорректный идентификатор инструкции.", "invalid_id")
        return path

    def _summary_path(self, guide_id: str) -> Path:
        safe = _safe_id(guide_id)
        path = (self.root / f"{safe}.summary.json").resolve()
        if self.root not in path.parents:
            raise GuideError(400, "Некорректный идентификатор инструкции.", "invalid_id")
        return path

    def _new_id(self) -> str:
        for _ in range(64):
            candidate = "".join(secrets.choice(GUIDE_ID_ALPHABET) for _ in range(self.id_length))
            if not self._path(candidate).exists():
                return candidate
        raise GuideError(503, "Не удалось подобрать свободный идентификатор. Очистите старые публикации.")

    # ------------------------------------------------------------------ запись/чтение

    def save(self, document: Any, raw_size: int | None = None) -> StoredGuide:
        document = validate_document(document)
        payload = json.dumps(document, ensure_ascii=False).encode("utf-8")
        size = raw_size if raw_size is not None else len(payload)
        if size > self.max_bytes:
            limit_mb = self.max_bytes // (1024 * 1024)
            raise GuideError(
                413,
                f"Инструкция больше {limit_mb} МБ. Сожмите 3D-модель или опубликуйте версию без .glb.",
                "guide_too_large",
            )

        with self._lock:
            self.ensure()
            fingerprint = document_fingerprint(document)
            for existing in self.summaries(limit=self.max_guides):
                if existing.sha256 == fingerprint:
                    return existing

            guide_id = self._new_id()
            created_at = _now_iso()
            summary = summarize(guide_id, document, len(payload), created_at, seq=time.time_ns())
            target = self._path(guide_id)
            temporary = target.with_suffix(".json.tmp")
            temporary.write_bytes(payload)
            temporary.replace(target)
            self._summary_path(guide_id).write_text(
                # В файле карточки хранится и отпечаток: по нему работает дедупликация.
                json.dumps(summary.as_dict() | {"sha256": summary.sha256}, ensure_ascii=False),
                encoding="utf-8",
            )
            self.prune(keep=self.max_guides)
            return summary

    def get(self, guide_id: str) -> dict[str, Any] | None:
        path = self._path(guide_id)
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise GuideError(500, "Файл инструкции повреждён на диске цехового сервера.", "guide_corrupted") from None

    def summaries(self, limit: int = config.GUIDES_LIST_LIMIT) -> list[StoredGuide]:
        if not self.root.is_dir():
            return []
        guides: list[StoredGuide] = []
        for path in self.root.glob("*.summary.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            try:
                guides.append(
                    StoredGuide(
                        id=str(data["id"]),
                        title=str(data.get("title") or "Без названия"),
                        drawingCode=str(data.get("drawingCode") or "—"),
                        revision=str(data.get("revision") or ""),
                        createdAt=str(data.get("createdAt") or ""),
                        sizeBytes=int(data.get("sizeBytes") or 0),
                        has3d=bool(data.get("has3d")),
                        steps=int(data.get("steps") or 0),
                        sha256=str(data.get("sha256") or ""),
                        seq=int(data.get("seq") or 0),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        # Свежие — первыми: сначала монотонный номер, затем ISO-время (для старых файлов).
        guides.sort(key=lambda guide: (guide.seq, guide.createdAt), reverse=True)
        return guides[: max(1, limit)]

    def prune(self, keep: int | None = None) -> int:
        """Оставляет `keep` самых свежих инструкций, остальные удаляет."""

        limit = keep if keep is not None else self.max_guides
        sequence = {summary.id: summary.seq for summary in self.summaries(limit=self.max_guides * 4 + 16)}
        documents = sorted(
            (path for path in self.root.glob("*.json") if not path.name.endswith(".summary.json")),
            key=lambda path: (sequence.get(path.stem, 0), path.stat().st_mtime_ns),
            reverse=True,
        )
        removed = 0
        for path in documents[limit:]:
            guide_id = path.stem
            try:
                self._summary_path(guide_id).unlink(missing_ok=True)
                path.unlink(missing_ok=True)
                removed += 1
            except OSError:
                continue
        return removed

    def count(self) -> int:
        if not self.root.is_dir():
            return 0
        return sum(1 for path in self.root.glob("*.json") if not path.name.endswith(".summary.json"))

    def iter_ids(self) -> Iterable[str]:
        for path in self.root.glob("*.json"):
            if path.name.endswith(".summary.json"):
                continue
            yield path.stem
