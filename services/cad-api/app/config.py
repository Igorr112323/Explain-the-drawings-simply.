"""Shared settings for the CAD service. All limits are explicit so tests can reason about them."""

from __future__ import annotations

SERVICE_NAME = "ikguide-cad-api"
SERVICE_VERSION = "1.0.0"

# Upload limits
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
MAX_PARTS = 240
MAX_TRIANGLES = 400_000

# SVG budget: a step diagram must stay a lightweight, printable vector
MAX_SVG_FACES_PER_PART = 900
MAX_SVG_TOTAL_FACES = 6000

# Sessions live in memory; the browser keeps the GLB, the server keeps meshes for re-rendering
SESSION_TTL_SECONDS = 60 * 60
MAX_SESSIONS = 8

# Three meaningful colours of the IKEA 2.0 house style
COLOR_INK = "#1D1D1F"
COLOR_PAPER = "#FFFFFF"
COLOR_PAPER_SHADE = "#F2F4F7"
COLOR_ACTIVE_FILL = "#E8F2FF"
COLOR_ACTIVE_LINE = "#007AFF"
COLOR_ATTENTION = "#FF3B30"
COLOR_GHOST = "#C7CBD1"

SVG_WIDTH = 720
SVG_HEIGHT = 520
SVG_MARGIN = 42

SUPPORTED_FORMATS = ("step", "stp", "stl", "obj", "glb", "gltf")
MESH_FORMATS = ("stl", "obj", "glb", "gltf")
STEP_FORMATS = ("step", "stp")

# Geometry heuristics
CONTACT_TOLERANCE_MM = 1.0
EXPLODE_FACTOR = 0.45
CREASE_ANGLE_DEGREES = 24.0
FASTENER_VOLUME_SHARE = 0.02
