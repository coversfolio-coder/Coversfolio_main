"""
Standalone OCR module for Coversfolio.

Deliberately independent of any specific feature (policies, claims, evidence,
documents) - this module's only job is "given some bytes and a content type,
return the text that's visible in it." Anything that needs text out of an
image or a scanned/photographed document can call extract_text() without
knowing or caring which domain it's being used from.

Two engines, tried in order:
  1. Gemini vision  - handles real-world messy phone photos well (skewed,
     rotated, uneven lighting, handwriting) since it's a full vision-language
     model, not pattern-matching against character shapes. Small per-call
     cost, needs network + an API key.
  2. Tesseract       - free, fully offline, no API key or network needed.
     Lower quality on messy real-world photos than Gemini, but keeps text
     extraction working even if Gemini is unconfigured, over quota, or the
     provider has an outage.

Every extraction reports which method actually produced the result, so a
caller (or a person looking at the result) can judge how much to trust it -
"gemini_vision" and "tesseract" are meaningfully different confidence levels,
and callers should treat them differently rather than pretend both are equally
reliable.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image

try:
    import pillow_heif
    pillow_heif.register_heif_opener()  # lets PIL.Image.open() read .heic/.heif bytes
except ImportError:
    pass

logger = logging.getLogger(__name__)

MAX_OCR_PAGES = 15  # a hard ceiling on scanned-PDF page rendering, so a mistakenly-uploaded 300-page file can't hang a request


class OCRError(Exception):
    """Raised when no engine could extract any text at all."""


def _render_pdf_pages_to_png_bytes(data: bytes, max_pages: int = MAX_OCR_PAGES) -> list[bytes]:
    """Rasterizes PDF pages to PNG image bytes. Needed because neither OCR
    engine reads PDF structure directly - Tesseract only understands raster
    images, and this keeps the two engines' input handling consistent."""
    images: list[bytes] = []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pixmap = page.get_pixmap(dpi=200)
            images.append(pixmap.tobytes("png"))
    return images


def _tesseract_ocr_image_bytes(data: bytes) -> str:
    image = Image.open(io.BytesIO(data))
    return pytesseract.image_to_string(image)


def ocr_with_tesseract(filename: str, content_type: str, data: bytes) -> str:
    """Synchronous, CPU-bound - callers on an async request path should run
    this via asyncio.to_thread rather than calling it directly, the same way
    every other blocking call in this codebase is handled."""
    ext = Path(filename or "").suffix.lower()
    is_pdf = content_type == "application/pdf" or ext == ".pdf"
    if is_pdf:
        pages = _render_pdf_pages_to_png_bytes(data)
        if not pages:
            return ""
        return "\n\n".join(_tesseract_ocr_image_bytes(p) for p in pages)
    return _tesseract_ocr_image_bytes(data)


def ocr_with_gemini(data: bytes, mime_type: str, api_key: str, model: str) -> str:
    """Synchronous - same reasoning as ocr_with_tesseract: this does blocking
    network I/O and must be run via asyncio.to_thread by the caller, not
    called directly inside an async route (see server.py's Gemini analysis
    call for why - a direct call would freeze the whole server for every user
    for the duration of every single OCR request)."""
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=api_key, http_options=genai_types.HttpOptions(timeout=45_000))
    response = client.models.generate_content(
        model=model,
        contents=[
            genai_types.Part.from_bytes(data=data, mime_type=mime_type),
            (
                "Transcribe every piece of text visible in this document or image, exactly as written. "
                "Preserve line breaks and layout as closely as reasonably possible. "
                "Output ONLY the transcribed text - no commentary, no markdown formatting, no summary."
            ),
        ],
    )
    return (response.text or "").strip()


def extract_text(
    filename: str,
    content_type: str,
    data: bytes,
    *,
    gemini_api_key: str | None = None,
    gemini_model: str = "gemini-flash-latest",
    existing_text_layer: str | None = None,
) -> dict:
    """The one general-purpose entry point.

    If the caller already has a PDF's embedded text layer (e.g. from pypdf),
    pass it as existing_text_layer - a real text layer is exact and free, so
    there's no reason to spend a Gemini call or CPU time re-deriving it from
    pixels. Otherwise this tries Gemini first (if a key is configured), then
    falls back to Tesseract.

    This function itself does blocking work (via the engines above) and must
    be called through asyncio.to_thread from an async route.

    Returns {"text": str, "method": "pdf_text_layer" | "gemini_vision" | "tesseract"}.
    Raises OCRError if nothing could extract any text at all.
    """
    if existing_text_layer and existing_text_layer.strip():
        return {"text": existing_text_layer, "method": "pdf_text_layer"}

    ext = Path(filename or "").suffix.lower()
    is_pdf = content_type == "application/pdf" or ext == ".pdf"
    mime_type = "application/pdf" if is_pdf else (content_type or "application/octet-stream")

    if gemini_api_key:
        try:
            text = ocr_with_gemini(data, mime_type, gemini_api_key, gemini_model)
            if text.strip():
                return {"text": text, "method": "gemini_vision"}
            logger.warning("Gemini OCR returned empty text for %s - falling back to Tesseract", filename)
        except Exception as exc:
            logger.warning("Gemini OCR failed for %s, falling back to Tesseract: %s", filename, exc)

    try:
        text = ocr_with_tesseract(filename, content_type, data)
    except Exception as exc:
        raise OCRError(f"Tesseract could not process this file: {exc}") from exc

    if not text.strip():
        raise OCRError("No readable text was found in this file by any available method.")
    return {"text": text, "method": "tesseract"}
