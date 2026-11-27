"""Shared fixtures for the vision-api test suite.

All inputs are generated in-process (OpenCV + PyMuPDF): the suite must pass on a machine with no
internet access and no fixture images in the repository.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from synthetic import (  # noqa: E402  (path must be configured first)
    build_bom_sheet_pdf,
    build_vector_pdf,
    multipage_pdf,
    photo_of,
    render_drawing,
    scanned_pdf,
)


@pytest.fixture(scope="session")
def drawing():
    return render_drawing(150)


@pytest.fixture(scope="session")
def photo():
    return photo_of(render_drawing(160))


@pytest.fixture(scope="session")
def vector_pdf() -> bytes:
    return build_vector_pdf()


@pytest.fixture(scope="session")
def bom_pdf() -> bytes:
    return build_bom_sheet_pdf()


@pytest.fixture(scope="session")
def spec_pdf() -> bytes:
    return multipage_pdf()


@pytest.fixture(scope="session")
def scan_pdf() -> bytes:
    return scanned_pdf(120)


@pytest.fixture(scope="session")
def ocr_engine():
    from app.ocr import create_ocr_engine

    engine, _attempted, _warnings = create_ocr_engine("auto")
    if engine.name == "none":
        pytest.skip("OCR engine is not installed in this environment")
    return engine


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
