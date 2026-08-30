import { useEffect, useRef, useState } from "react";
import client, { API, apiError } from "@/api";
import { Camera, Download, FileText, Plus, ScanText, Trash2, Upload, X } from "lucide-react";

const emptyForm = { category: "", item_name: "", description: "", purchase_date: "", value: "" };

function fileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EvidencePage({ canEdit, notify }) {
  const [items, setItems] = useState(null);
  const [documents, setDocuments] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [uploadingFor, setUploadingFor] = useState(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const activeItemId = useRef(null);

  const load = () => {
    client.get("/evidence").then((r) => setItems(r.data.items)).catch((err) => notify(apiError(err), true));
    client.get("/documents").then((r) => {
      const byItem = {};
      for (const doc of r.data.documents) {
        if (doc.linked_evidence_id) (byItem[doc.linked_evidence_id] = byItem[doc.linked_evidence_id] || []).push(doc);
      }
      setDocuments(byItem);
      // A receipt may already have been OCR'd in a previous session - that's
      // saved server-side, so show it immediately instead of making the
      // person click "Extract text" again just to see what's already known.
      const preloaded = {};
      r.data.documents.forEach((doc) => {
        if (doc.extracted_text) preloaded[doc.id] = { text: doc.extracted_text, method: doc.extracted_text_method };
      });
      if (Object.keys(preloaded).length > 0) setOcrResults((prev) => ({ ...preloaded, ...prev }));
    }).catch(() => setDocuments({}));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await client.post("/evidence", { ...form, value: Number(form.value || 0) });
      notify("Item added to your inventory");
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) { notify(apiError(err), true); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    try { await client.delete(`/evidence/${id}`); notify("Item removed"); load(); }
    catch (err) { notify(apiError(err), true); }
  };

  const openFilePicker = (itemId) => { activeItemId.current = itemId; fileInputRef.current?.click(); };
  const openCamera = (itemId) => { activeItemId.current = itemId; cameraInputRef.current?.click(); };

  const onBillFilePicked = async (e) => {
    const file = e.target.files?.[0];
    const itemId = activeItemId.current;
    e.target.value = "";
    if (!file || !itemId) return;
    setUploadingFor(itemId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "purchase_receipt");
      formData.append("linked_evidence_id", itemId);
      await client.post("/documents", formData, { headers: { "Content-Type": "multipart/form-data" } });
      notify("Bill copy added");
      load();
    } catch (err) { notify(apiError(err), true); } finally { setUploadingFor(null); }
  };

  const [ocrBusyId, setOcrBusyId] = useState(null);
  const [ocrResults, setOcrResults] = useState({}); // { [docId]: { text, method } }

  const runOcr = async (docId) => {
    setOcrBusyId(docId);
    try {
      const res = await client.post(`/documents/${docId}/ocr`);
      setOcrResults((prev) => ({ ...prev, [docId]: res.data }));
    } catch (err) { notify(apiError(err), true); } finally { setOcrBusyId(null); }
  };

  // A light, best-effort read of a rupee figure from OCR'd receipt text - lets
  // the person one-click-fill the item's value instead of retyping a number
  // that's already right there on the receipt. Never overwrites silently; the
  // person still clicks to accept it.
  const findRupeeAmount = (text) => {
    const matches = [...text.matchAll(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/gi)];
    if (matches.length === 0) return null;
    const amounts = matches.map((m) => parseFloat(m[1].replace(/,/g, ""))).filter((n) => !isNaN(n) && n > 0);
    return amounts.length > 0 ? Math.max(...amounts) : null;
  };

  const applyAmountAsValue = async (itemId, amount) => {
    try {
      await client.put(`/evidence/${itemId}`, { value: amount });
      notify(`Value updated to ₹${amount.toLocaleString("en-IN")}`);
      load();
    } catch (err) { notify(apiError(err), true); }
  };

  const removeDocument = async (docId) => {
    try { await client.delete(`/documents/${docId}`); notify("Removed"); load(); }
    catch (err) { notify(apiError(err), true); }
  };

  const download = (doc) => window.open(`${API}/documents/${doc.id}/download`, "_blank");

  if (items === null) return <div className="page-loading" data-testid="evidence-loading">Loading your evidence vault…</div>;

  const totalValue = items.reduce((sum, i) => sum + Number(i.value || 0), 0);

  return (
    <section className="page-section" data-testid="evidence-page">
      <div className="page-accent-header">
        <div><p className="eyebrow">HOME INVENTORY</p><h2 data-testid="evidence-heading">Evidence vault</h2></div>
        <div className="page-accent-header-actions">
          {items.length > 0 && (
            <>
              <span className="page-accent-stat" data-testid="evidence-total-strip">Catalogued<strong>{items.length}</strong></span>
              <span className="page-accent-stat">Est. value<strong>&#8377;{totalValue.toLocaleString("en-IN")}</strong></span>
            </>
          )}
          {canEdit && <button className="primary-button" data-testid="add-evidence-button" onClick={() => setShowForm(true)}><Plus size={16} /> Add item</button>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-hint" data-testid="evidence-empty">No inventory items yet. Add belongings with photos and receipts to support a future claim.</div>
      ) : (
        <div className="entry-list" data-testid="evidence-list">
          {items.map((item) => (
            <article className="entry" key={item.id} data-testid={`evidence-${item.id}`}>
              <header>
                <strong>{item.item_name}</strong>
                <small>{item.category}</small>
                {canEdit && <button className="icon-button" aria-label="Remove item" data-testid={`remove-evidence-${item.id}`} onClick={() => remove(item.id)}><Trash2 size={15} /></button>}
              </header>
              {item.description && <p>{item.description}</p>}
              <p><em>Value:</em> ₹{Number(item.value || 0).toLocaleString("en-IN")} {item.purchase_date && <span>· <em>Purchased:</em> {item.purchase_date}</span>}</p>

              {(documents[item.id] || []).length > 0 && (
                <div className="evidence-bills" data-testid={`evidence-bills-${item.id}`}>
                  {documents[item.id].map((doc) => (
                    <div key={doc.id}>
                      <div className="evidence-bill-row" data-testid={`evidence-bill-${doc.id}`}>
                        <FileText size={13} />
                        <span className="evidence-bill-name">{doc.filename}</span>
                        <small>{fileSize(doc.size)}</small>
                        <button className="icon-button" aria-label="Extract text" disabled={ocrBusyId === doc.id} data-testid={`ocr-evidence-bill-${doc.id}`} onClick={() => runOcr(doc.id)}><ScanText size={13} className={ocrBusyId === doc.id ? "spin-icon" : ""} /></button>
                        <button className="icon-button" aria-label="Download" data-testid={`download-evidence-bill-${doc.id}`} onClick={() => download(doc)}><Download size={13} /></button>
                        {canEdit && <button className="icon-button" aria-label="Remove bill copy" data-testid={`remove-evidence-bill-${doc.id}`} onClick={() => removeDocument(doc.id)}><Trash2 size={13} /></button>}
                      </div>
                      {ocrResults[doc.id] && (() => {
                        const detectedAmount = findRupeeAmount(ocrResults[doc.id].text);
                        return (
                          <div className="empty-hint" data-testid={`ocr-result-${doc.id}`} style={{ margin: "6px 0 10px", whiteSpace: "pre-wrap", fontSize: 11.5, maxHeight: 180, overflowY: "auto" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
                              <strong style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)" }}>
                                Extracted text {ocrResults[doc.id].method === "gemini_vision" ? "(via AI)" : ocrResults[doc.id].method === "tesseract" ? "(via offline OCR)" : "(from file)"}
                              </strong>
                              <div style={{ display: "flex", gap: 10 }}>
                                {canEdit && detectedAmount && (
                                  <button className="text-button" style={{ padding: 0 }} data-testid={`use-amount-${doc.id}`} onClick={() => applyAmountAsValue(item.id, detectedAmount)}>
                                    Use ₹{detectedAmount.toLocaleString("en-IN")} as value
                                  </button>
                                )}
                                <button className="text-button" style={{ padding: 0 }} onClick={() => setOcrResults((prev) => { const next = { ...prev }; delete next[doc.id]; return next; })}>Dismiss</button>
                              </div>
                            </div>
                            {ocrResults[doc.id].text}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}

              {canEdit && (
                <div className="evidence-bill-actions">
                  <button type="button" className="text-button" disabled={uploadingFor === item.id} onClick={() => openCamera(item.id)} data-testid={`camera-evidence-${item.id}`}>
                    <Camera size={13} /> {uploadingFor === item.id ? "Uploading…" : "Take photo"}
                  </button>
                  <button type="button" className="text-button" disabled={uploadingFor === item.id} onClick={() => openFilePicker(item.id)} data-testid={`upload-evidence-bill-${item.id}`}>
                    <Upload size={13} /> Upload bill copy
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" hidden accept="image/*,.pdf,.doc,.docx" onChange={onBillFilePicked} data-testid="evidence-bill-file-input" />
      <input ref={cameraInputRef} type="file" hidden accept="image/*" capture="environment" onChange={onBillFilePicked} data-testid="evidence-bill-camera-input" />

      {showForm && (
        <div className="modal-backdrop" data-testid="add-evidence-modal">
          <div className="modal">
            <button className="close-button" aria-label="Close" onClick={() => setShowForm(false)} data-testid="close-evidence-modal-button"><X size={18} /></button>
            <p className="eyebrow">NEW ITEM</p>
            <h2>Add to inventory</h2>
            <form onSubmit={submit} className="stack-form" data-testid="evidence-form">
              <label>Item name<input required value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="Samsung refrigerator" data-testid="evidence-item-name-input" /></label>
              <label>Category<input required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Electronics / Furniture / Jewellery" data-testid="evidence-category-input" /></label>
              <div className="row-2">
                <label>Estimated value (₹)<input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="45000" data-testid="evidence-value-input" /></label>
                <label>Purchase date<input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} data-testid="evidence-purchase-date-input" /></label>
              </div>
              <label>Description (optional)<textarea rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Model, serial number, condition…" data-testid="evidence-description-input" /></label>
              <button className="primary-button" disabled={busy} data-testid="submit-evidence-button">{busy ? "Saving…" : "Save item"}</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
