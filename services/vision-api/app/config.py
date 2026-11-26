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
MAX_WORKING_SIDE = 2200
MAX_DATA_URL_SIDE = 1700
# Сколько памяти OCR-движок получает на вход: только больше не даём, иначе onnxruntime
# раздувает арены и процесс убивает OOM (проверено на 1 000-кейсовом прогоне).
OCR_MAX_SIDE = 1600

# --- upscale of small sheets -----------------------------------------------------------
# Фото с телефона и старые копии часто мельче 1400 px по ширине: мелкий шрифт (таблица
# позиций, подписи видов) на них не читается. Такие листы увеличиваем в 2–3 раза.
SMALL_SHEET_WIDTH = 1400
UPSCALE_FACTOR_MIN = 2.0
UPSCALE_FACTOR_MAX = 3.0
UPSCALE_SHARPEN_AMOUNT = 0.55

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
PAGE_TTL_SECONDS = 10 * 60
MAX_STORED_PAGES = 8
# Главный предохранитель: страницы держим не «по штукам», а по реальной памяти.
MAX_STORED_BYTES = 320 * 1024 * 1024
# Если процесс всё же распух (чужие большие сканы, фрагментация) — кэш очищается целиком.
MEMORY_SOFT_LIMIT_BYTES = 1400 * 1024 * 1024
