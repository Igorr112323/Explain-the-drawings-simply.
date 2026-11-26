"""In-memory sessions: the browser keeps the GLB, the service keeps meshes for instant re-renders."""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

from .config import MAX_SESSIONS, SESSION_TTL_SECONDS
from .models import AssemblyStep, CadPart


@dataclass
class CadSession:
    id: str
    filename: str
    parts: list[CadPart]
    steps: list[AssemblyStep]
    glb_data_url: str
    assembly_name: str
    size_mm: tuple[float, float, float]
    mass_kg: float
    source_format: str
    unit_scale: float
    warnings: list[str] = field(default_factory=list)
    overview_svg: str = ""
    created_at: float = field(default_factory=time.time)


class SessionStore:
    """Small LRU of imported assemblies with a time-to-live."""

    def __init__(self, ttl_seconds: float = SESSION_TTL_SECONDS, limit: int = MAX_SESSIONS) -> None:
        self._ttl = ttl_seconds
        self._limit = limit
        self._items: dict[str, CadSession] = {}
        self._lock = threading.Lock()

    def put(self, session: CadSession) -> CadSession:
        with self._lock:
            self._prune_locked()
            self._items[session.id] = session
            while len(self._items) > self._limit:
                oldest = min(self._items.values(), key=lambda item: item.created_at)
                self._items.pop(oldest.id, None)
        return session

    def create(self, **kwargs) -> CadSession:
        session_id = f"cad-{uuid.uuid4().hex[:12]}"
        return self.put(CadSession(id=session_id, **kwargs))

    def get(self, session_id: str) -> CadSession | None:
        with self._lock:
            self._prune_locked()
            return self._items.get(session_id)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def _prune_locked(self) -> None:
        now = time.time()
        expired = [key for key, item in self._items.items() if now - item.created_at > self._ttl]
        for key in expired:
            self._items.pop(key, None)


store = SessionStore()
