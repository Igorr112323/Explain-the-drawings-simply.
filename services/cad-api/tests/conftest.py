from __future__ import annotations

import sys
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))


@pytest.fixture(autouse=True)
def clean_sessions():
    from app.session import store

    store.clear()
    yield
    store.clear()


@pytest.fixture()
def glb_assembly() -> bytes:
    """A 12-part GLB assembly with real part names."""
    from tests import synthetic

    return synthetic.glb_bytes()
