import { useEffect, useRef, useState } from "react";
import client, { API, apiError } from "@/api";
import { ArrowUpRight, BookOpen, Download, FileScan, FileText, Trash2, Upload, X } from "lucide-react";

const DOCUMENT_CATEGORIES = [
  { id: "policy_document", label: "Policy document" },
  { id: "discharge_summary", label: "Discharge summary" },
  { id: "hospital_bill", label: "Hospital bill" },
  { id: "consultation", label: "Consultation papers" },
  { id: "pharmacy_bill", label: "Pharmacy bill" },
  { id: "opd_receipt", label: "OPD receipt" },
  { id: "claim_settlement", label: "Claim settlement" },
  { id: "id_proof", label: "ID proof" },
  { id: "obstetric_history", label: "Obstetric history (maternity claims)" },
  { id: "claim_form", label: "Insurer claim form" },
  { id: "purchase_receipt", label: "Purchase receipt" },
  { id: "general", label: "Other" },
];
const CATEGORY_LABEL = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.id, c.label]));
const SECTION_ORDER = DOCUMENT_CATEGORIES.map((c) => c.id);

const STATUS_LABEL = { active: "Active", grace_period: "Grace period", expired: "Expired", unknown: "Unknown" };
const STATUS_TONE = { active: "teal", grace_period: "amber", expired: "red", unknown: "neutral" };

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage({ canEdit, notify, onReviewAsPolicy }) {
  const [documents, setDocuments] = useState(null);
  const [policies, setPolicies] = useState(null);
  const [claims, setClaims] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [uploadCategory, setUploadCategory] = useState("general");
  const [uploadPolicyId, setUploadPolicyId] = useState("");
  const [uploadClaimId, setUploadClaimId] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billDate, setBillDate] = useState("");
  const inputRef = useRef(null);

  const load = () => {
    client.get("/documents").then((r) => setDocuments(r.data.documents)).catch((err) => notify(apiError(err)));
    client.get("/policies").then((r) => setPolicies(r.data.policies)).catch(() => setPolicies([]));
    client.get("/dashboard").then((r) => setClaims(r.data.claims || [])).catch(() => setClaims([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPendingFile(file);
    setUploadCategory("general");
    setUploadPolicyId("");
    setUploadClaimId("");
    setBillAmount("");
    setBillDate("");
    setShowUploadModal(true);
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setSuggestion(null);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("category", uploadCategory);
      if (uploadPolicyId) formData.append("linked_policy_id", uploadPolicyId);
      if (uploadClaimId) formData.append("linked_claim_id", uploadClaimId);
      if (billAmount) formData.append("bill_amount", billAmount);
      if (billDate) formData.append("bill_date", billDate);
      const res = await client.post("/documents", formData, { headers: { "Content-Type": "multipart/form-data" } });
      const detected = res.data.detected_policy;
      if (detected?.matched_existing) {
        notify(`Uploaded and linked to your existing ${detected.insurer_name} policy`);
      } else if (detected) {
        notify("Document uploaded");
        setSuggestion({ ...detected, filename: pendingFile.name });
      } else {
        notify("Document uploaded");
      }
      setShowUploadModal(false);
      setPendingFile(null);
      load();
    } catch (err) { notify(apiError(err)); } finally { setUploading(false); }
  };

  const download = (doc) => {
    // Downloads use the browser's own credentialed navigation rather than axios,
    // so the file streams straight from the authenticated endpoint.
    window.open(`${API}/documents/${doc.id}/download`, "_blank");
  };

  const remove = async (id) => {
    try { await client.delete(`/documents/${id}`); notify("Document removed"); load(); }
    catch (err) { notify(apiError(err)); }
  };

  if (documents === null || policies === null) return <div className="page-loading" data-testid="documents-loading">Loading your documents…</div>;

  const grouped = {};
  for (const doc of documents) {
    const cat = CATEGORY_LABEL[doc.category] ? doc.category : "general";
    grouped[cat] = grouped[cat] || [];
    grouped[cat].push(doc);
  }
  const orderedSections = SECTION_ORDER.filter((cat) => grouped[cat]?.length > 0);

  return (
    <section className="page-section" data-testid="documents-page">
      <div className="section-heading">
        <div><p className="eyebrow">SECURE STORAGE</p><h2 data-testid="documents-heading">Documents</h2></div>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" hidden onChange={onFilePicked} data-testid="document-file-input" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx" />
            <button className="primary-button" data-testid="upload-document-page-button" onClick={() => inputRef.current?.click()}>
              <Upload size={16} /> Upload document
            </button>
          </>
        )}
      </div>

      {policies.length > 0 && (
        <div className="card-grid" data-testid="documents-policy-cards" style={{ marginBottom: 24 }}>
          {policies.map((p) => {
            const info = p.status_info || {};
            const tone = STATUS_TONE[info.status] || "neutral";
            const maternity = p.ai_insights?.maternity_cover;
            return (
              <article className="entry policy-card" key={p.id} data-testid={`documents-policy-card-${p.id}`}>
                <header>
                  <span className="claim-icon" style={{ width: 36, height: 36 }}><BookOpen size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <strong>{p.insurer_name}</strong>
                    <small style={{ display: "block" }}>{p.policy_number} · {p.policy_type}</small>
                  </div>
                  <span className={`chip chip-${tone}`} data-testid={`documents-policy-status-${p.id}`}>{STATUS_LABEL[info.status] || "Unknown"}</span>
                </header>
                {info.days_label && <p><em>Renewal:</em> {info.days_label}</p>}
                <p><em>Remaining limit:</em> ₹{Number(p.utilization?.remaining ?? p.sum_insured).toLocaleString("en-IN")} of ₹{Number(p.sum_insured).toLocaleString("en-IN")}</p>
                {maternity && (
                  <p>
                    <em>Maternity:</em>{" "}
                    {maternity.covered
                      ? `Covered${maternity.cap_amount ? `, capped at ₹${Number(maternity.cap_amount).toLocaleString("en-IN")}` : ""}${maternity.waiting_period_months ? ` (${maternity.waiting_period_months}-month wait)` : ""}`
                      : "Not covered"}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {suggestion && (
        <div className="attention-strip" data-testid="policy-suggestion-banner">
          <div className="attention-icon"><FileScan size={20} /></div>
          <div>
            <strong>This looks like a {suggestion.insurer_name || "new"} policy</strong>
            <span>Found in {suggestion.filename} — add it to your Policies list?</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="text-button" data-testid="dismiss-policy-suggestion" onClick={() => setSuggestion(null)}>Dismiss</button>
            <button className="text-button" data-testid="review-policy-suggestion" onClick={() => { onReviewAsPolicy(suggestion); setSuggestion(null); }}>Review &amp; add <ArrowUpRight size={15} /></button>
          </div>
        </div>
      )}

      {documents.length === 0 ? (
        <div className="empty-hint" data-testid="documents-empty">No documents yet. Upload bills, prescriptions, or policy copies — they're stored privately and only visible to your household.</div>
      ) : (
        orderedSections.map((cat) => (
          <div key={cat} className="document-section" data-testid={`document-section-${cat}`} style={{ marginBottom: 22 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>{CATEGORY_LABEL[cat].toUpperCase()}</p>
            <div className="entry-list">
              {grouped[cat].map((doc) => (
                <article className="entry document-row" key={doc.id} data-testid={`document-${doc.id}`}>
                  <header>
                    <span className="claim-icon" style={{ width: 32, height: 32 }}><FileText size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: "block" }}>{doc.filename}</strong>
                      <small>{fileSize(doc.size)} · Uploaded by {doc.uploaded_by_name}</small>
                    </div>
                    <button className="icon-button" aria-label="Download" data-testid={`download-document-${doc.id}`} onClick={() => download(doc)}><Download size={15} /></button>
                    {canEdit && <button className="icon-button" aria-label="Remove document" data-testid={`remove-document-${doc.id}`} onClick={() => remove(doc.id)}><Trash2 size={15} /></button>}
                  </header>
                </article>
              ))}
            </div>
          </div>
        ))
      )}

      {showUploadModal && (
        <div className="modal-backdrop" data-testid="upload-document-modal">
          <div className="modal" style={{ width: "min(480px, 100%)" }}>
            <button className="close-button" aria-label="Close" onClick={() => { setShowUploadModal(false); setPendingFile(null); }} data-testid="close-upload-modal-button"><X size={18} /></button>
            <p className="eyebrow">UPLOAD</p>
            <h2>{pendingFile?.name}</h2>
            <div className="stack-form">
              <label>What kind of document is this?
                <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} data-testid="upload-category-select">
                  {DOCUMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              {policies.length > 0 && (
                <label>Link to a policy (optional)
                  <select value={uploadPolicyId} onChange={(e) => setUploadPolicyId(e.target.value)} data-testid="upload-policy-select">
                    <option value="">No specific policy</option>
                    {policies.map((p) => <option key={p.id} value={p.id}>{p.insurer_name} · {p.policy_number}</option>)}
                  </select>
                </label>
              )}
              {claims.length > 0 && (
                <label>Link to a claim (optional)
                  <select value={uploadClaimId} onChange={(e) => setUploadClaimId(e.target.value)} data-testid="upload-claim-select">
                    <option value="">No specific claim</option>
                    {claims.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.title}</option>)}
                  </select>
                </label>
              )}
              <div className="row-2">
                <label>Bill amount, ₹ (optional)
                  <input type="number" min="0" step="0.01" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} placeholder="e.g. 6600" data-testid="upload-bill-amount-input" />
                </label>
                <label>Bill date (optional)
                  <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} data-testid="upload-bill-date-input" />
                </label>
              </div>
              {(uploadClaimId || billAmount) && (
                <p style={{ fontSize: 10, color: "var(--muted)", margin: "-6px 0 0" }}>
                  Amount and date let this claim's summary sort the bill into pre/during/post-hospitalization automatically.
                </p>
              )}
              <button className="primary-button" disabled={uploading} onClick={confirmUpload} data-testid="confirm-upload-button">
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
