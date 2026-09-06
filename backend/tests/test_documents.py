

def _make_test_image(lines):
    from PIL import Image, ImageDraw, ImageFont
    import io
    img = Image.new("RGB", (500, 250), color="white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
    for i, line in enumerate(lines):
        draw.text((15, 15 + i * 30), line, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_classify_hospital_bill_fallback(registered_user):
    """Regression test: date extraction previously threw the entire
    multi-line OCR text at dateutil's fuzzy parser, which got confused by
    unrelated numbers (like the bill amount) and silently returned no date at
    all. Fixed by regex-matching a narrow date-like substring first."""
    client, user = registered_user
    img = _make_test_image(["Fortis Hospital - Final Bill", "Total Amount: Rs. 45,000", "Date: 20/08/2026"])
    r = client.post("/api/documents/classify", files={"file": ("bill.png", img, "image/png")})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["method"] == "keyword_match"
    assert data["category"] == "hospital_bill"
    assert data["bill_amount"] == 45000.0
    assert data["bill_date"] == "2026-08-20"


def test_classify_discharge_summary_fallback(registered_user):
    client, user = registered_user
    img = _make_test_image(["Apollo Hospital", "Discharge Summary", "Patient: Test Patient"])
    r = client.post("/api/documents/classify", files={"file": ("doc.png", img, "image/png")})
    assert r.status_code == 200
    data = r.json()
    assert data["category"] == "discharge_summary"
    assert data["bill_amount"] is None


def test_classify_id_proof_fallback(registered_user):
    client, user = registered_user
    img = _make_test_image(["INCOME TAX DEPARTMENT", "Permanent Account Number Card"])
    r = client.post("/api/documents/classify", files={"file": ("pan.png", img, "image/png")})
    assert r.status_code == 200
    assert r.json()["category"] == "id_proof"


def test_classify_rejects_bad_type(registered_user):
    client, user = registered_user
    r = client.post("/api/documents/classify", files={"file": ("doc.docx", b"fake", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert r.status_code == 415


def test_classify_does_not_save_anything(registered_user):
    client, user = registered_user
    img = _make_test_image(["Fortis Hospital - Final Bill", "Total Amount: Rs. 10,000"])
    client.post("/api/documents/classify", files={"file": ("bill.png", img, "image/png")})
    r = client.get("/api/documents")
    assert len(r.json()["documents"]) == 0


def test_download_inline_mode_for_preview(registered_user):
    """Preview needs the browser to render inline rather than force a download
    dialog - confirms the disposition query param actually controls this."""
    client, user = registered_user
    r = client.post("/api/documents", files={"file": ("bill.pdf", b"%PDF-1.4 fake pdf content", "application/pdf")}, data={"category": "hospital_bill"})
    doc_id = r.json()["id"]
    r = client.get(f"/api/documents/{doc_id}/download", params={"disposition": "inline"})
    assert r.status_code == 200
    assert "inline" in r.headers["content-disposition"]


def test_download_rejects_bad_disposition(registered_user):
    client, user = registered_user
    r = client.post("/api/documents", files={"file": ("bill.pdf", b"%PDF-1.4 fake", "application/pdf")}, data={"category": "hospital_bill"})
    doc_id = r.json()["id"]
    r = client.get(f"/api/documents/{doc_id}/download", params={"disposition": "bogus"})
    assert r.status_code == 400
