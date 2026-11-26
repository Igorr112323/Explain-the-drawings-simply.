"""Service-wide constants.

Values are deliberately explicit: every confidence threshold and quality gate is part of the
product contract (anti-hallucination), so it must be reviewable in one place.
"""

from __future__ import annotations

SERVICE_NAME = "ikguide-vision-api"
SERVICE_VERSION = "1.0.0"

# --- upload limits -------------------------------------------------------------------
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FILES_PER_REQUEST = 6
MAX_PAGES = 8

# --- rasterization -------------------------------------------------------------------
PDF_RASTER_DPI = 300
PDF_PREVIEW_DPI = 140
MAX_WORKING_SIDE = 2600
MAX_DATA_URL_SIDE = 1700

# --- quality gates (0..255 grayscale) -------------------------------------------------
DARK_MEAN = 95.0
BRIGHT_MEAN = 252.0
LOW_CONTRAST_STD = 28.0
BLUR_LAPLACIAN_VARIANCE = 90.0
MIN_TEXT_HEIGHT_PX = 9

# --- text extraction ------------------------------------------------------------------
VECTOR_TEXT_MIN_CHARS = 12
OCR_MIN_CONFIDENCE = 0.30
CONFIDENCE_THRESHOLD = 0.95
MIN_ENGINEERING_TEXT_LENGTH = 2
MERGE_HORIZONTAL_GAP_RATIO = 1.4

# --- ROI ------------------------------------------------------------------------------
ROI_PADDING_RATIO = 0.02
ROI_UPSCALE = 2.0

# --- page storage for ROI follow-ups --------------------------------------------------
PAGE_TTL_SECONDS = 30 * 60
MAX_STORED_PAGES = 32

# --- published workshop guides (stage 5) ----------------------------------------------
# Полная инструкция вместе с 3D-моделью весит десятки мегабайт, поэтому хранится на диске
# цехового ПК, а в QR уезжает только короткая ссылка.
MAX_GUIDE_BYTES = 64 * 1024 * 1024
MAX_STORED_GUIDES = 200
GUIDE_ID_LENGTH = 8
GUIDES_SUBDIR = "data/guides"
# Сколько последних инструкций отдавать в списке цеха.
GUIDES_LIST_LIMIT = 50
