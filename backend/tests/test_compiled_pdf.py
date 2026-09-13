import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import io
from pypdf import PdfReader
from PIL import Image
from conftest import make_policy, make_claim

def test_compiled_pdf_merges_cheat_sheet_image_and_pdf_and_notes_skipped_docx(registered_user):
    client, user = registered_user
    policy = make_policy(client)
    claim = make_claim(client, claim_type="Reimbursement", policy_id=policy["id"])

    # A real image document
    img = Image.new("RGB", (200, 100), color="white")
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    r = client.post("/api/documents", files={"file": ("bill.png", img_buf.getvalue(), "image/png")}, data={"category": "hospital_bill"})
    doc1_id = r.json()["id"]
    client.post(f"/api/documents/{doc1_id}/link", json={"linked_claim_id": claim["id"]})

    # A real (minimal but valid) PDF document
    from reportlab.pdfgen import canvas
    pdf_buf = io.BytesIO()
    c = canvas.Canvas(pdf_buf)
    c.drawString(100, 700, "Discharge Summary")
    c.save()
    pdf_buf.seek(0)
    r = client.post("/api/documents", files={"file": ("discharge.pdf", pdf_buf.getvalue(), "application/pdf")}, data={"category": "discharge_summary"})
    doc2_id = r.json()["id"]
    client.post(f"/api/documents/{doc2_id}/link", json={"linked_claim_id": claim["id"]})

    # A docx document - should be skipped, but noted
    r = client.post("/api/documents", files={"file": ("id_proof.docx", b"fake docx content", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}, data={"category": "id_proof"})
    doc3_id = r.json()["id"]
    client.post(f"/api/documents/{doc3_id}/link", json={"linked_claim_id": claim["id"]})

    r = client.get(f"/api/claims/{claim['id']}/compiled-pdf")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert "claim-compiled-" in r.headers["content-disposition"]

    reader = PdfReader(io.BytesIO(r.content))
    # Cheat sheet (at least 1 page) + image page + pdf page + skipped-note page
    assert len(reader.pages) >= 4, f"Expected at least 4 pages, got {len(reader.pages)}"

    # Confirm the skipped-docx note actually made it into the PDF text
    all_text = "".join(page.extract_text() for page in reader.pages)
    assert "id_proof.docx" in all_text
    assert "Not included" in all_text
    print(f"Compiled PDF has {len(reader.pages)} pages, correctly notes the skipped docx file")
