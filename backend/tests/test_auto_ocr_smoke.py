import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import io
from PIL import Image, ImageDraw, ImageFont

def test_document_upload_automatically_extracts_text_without_manual_ocr_call(registered_user):
    """Confirms extracted_text gets populated automatically right after
    upload, in the background - without the person needing to separately
    call the manual /documents/{id}/ocr endpoint."""
    client, user = registered_user
    img = Image.new("RGB", (500, 150), color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    draw.text((15, 15), "Fortis Hospital - Discharge Summary", fill="black", font=font)
    draw.text((15, 55), "Diagnosis: Acute Appendicitis", fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    r = client.post("/api/documents", files={"file": ("discharge.png", buf.getvalue(), "image/png")}, data={"category": "discharge_summary"})
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]

    # No manual OCR call made - just check the document directly
    r2 = client.get("/api/documents")
    doc = next(d for d in r2.json()["documents"] if d["id"] == doc_id)
    assert doc.get("extracted_text"), "extracted_text should be populated automatically, without a manual OCR call"
    assert "Appendicitis" in doc["extracted_text"]
    print("Automatic OCR correctly extracted:", doc["extracted_text"][:80])
