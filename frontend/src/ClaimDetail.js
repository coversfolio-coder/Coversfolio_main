import { Fragment, useEffect, useState } from "react";
import client, { API, apiError } from "@/api";
import {
  X, FileText, MessageSquare, IndianRupee, AlertTriangle,
  Undo2, Check, Plus, ClipboardList, ShieldAlert, CheckCircle2, Files, Link2, FileSpreadsheet, Trash2
} from "lucide-react";


const STATUS_TONE = {
  in_progress: { label: "In progress", tone: "teal" },
  settled: { label: "Settled", tone: "teal" },
  rejected: { label: "Rejected", tone: "red" },
  appealed: { label: "Appeal filed", tone: "amber" },
  reopened: { label: "Reopened", tone: "blue" },
};

const format = (iso) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function ClaimDetail({ claimId, canEdit, onClose, onChange, notify }) {
  const [claim, setClaim] = useState(null);
  const [packet, setPacket] = useState(null);
  const [claimForm, setClaimForm] = useState(null);
  const [tab, setTab] = useState(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState({ question: "", source: "Insurer" });
  const [settlement, setSettlement] = useState({ amount: "", kind: "partial", note: "" });
  const [reason, setReason] = useState("");
  const [hospForm, setHospForm] = useState({
    patient_name: "", hospital_name: "", admission_date: "", discharge_date: "", diagnosis: "", is_maternity: false,
    has_other_insurance: false, other_insurer_name: "", first_insurance_start_date: "",
    hospitalized_last_4_years: false, previously_covered_other_insurance: false,
    patient_gender: "", patient_dob: "", patient_relationship: "", patient_occupation: "",
    patient_address: "", patient_phone: "", patient_email: "",
    room_category: "", hospitalization_cause: "", date_of_onset: "", admission_time: "", discharge_time: "",
    medico_legal: false, injury_cause: "", reported_to_police: false, mlc_report_attached: false, system_of_medicine: "",
  });
  const [savingHosp, setSavingHosp] = useState(false);
  // Section G on the real claim form (PAN, bank account, IFSC) is sensitive
  // financial data the app has no reason to store or transmit - it's only
  // needed once, by the person themselves, to copy onto the paper/PDF form.
  // Kept in component state only: never sent to the backend, cleared on reload.
  const [bankForm, setBankForm] = useState({ tpa_membership_id: "", pan_number: "", bank_account_holder: "", bank_account_number: "", bank_name_branch: "", cheque_payable_name: "", ifsc_code: "" });

  const load = async () => {
    try {
      const res = await client.get(`/claims/${claimId}`);
      setClaim(res.data);
      setHospForm({
        patient_name: res.data.patient_name || "", hospital_name: res.data.hospital_name || "",
        admission_date: res.data.admission_date || "", discharge_date: res.data.discharge_date || "",
        diagnosis: res.data.diagnosis || "", is_maternity: !!res.data.is_maternity,
        has_other_insurance: !!res.data.has_other_insurance, other_insurer_name: res.data.other_insurer_name || "",
        first_insurance_start_date: res.data.first_insurance_start_date || "",
        hospitalized_last_4_years: !!res.data.hospitalized_last_4_years,
        previously_covered_other_insurance: !!res.data.previously_covered_other_insurance,
        patient_gender: res.data.patient_gender || "", patient_dob: res.data.patient_dob || "",
        patient_relationship: res.data.patient_relationship || "", patient_occupation: res.data.patient_occupation || "",
        patient_address: res.data.patient_address || "", patient_phone: res.data.patient_phone || "", patient_email: res.data.patient_email || "",
        room_category: res.data.room_category || "", hospitalization_cause: res.data.hospitalization_cause || "",
        date_of_onset: res.data.date_of_onset || "", admission_time: res.data.admission_time || "", discharge_time: res.data.discharge_time || "",
        medico_legal: !!res.data.medico_legal, injury_cause: res.data.injury_cause || "",
        reported_to_police: !!res.data.reported_to_police, mlc_report_attached: !!res.data.mlc_report_attached,
        system_of_medicine: res.data.system_of_medicine || "",
      });
      const packetRes = await client.get(`/claims/${claimId}/document-packet`);
      setPacket(packetRes.data);
      const formRes = await client.get(`/claims/${claimId}/claim-form`);
      setClaimForm(formRes.data);
      // Default to the most useful tab for this claim type - only on first
      // load, so switching tabs manually afterward (e.g. after saving hospitalization
      // details triggers a refresh) doesn't keep yanking the person back.
      setTab((prev) => prev || "claimform");
    } catch (err) { notify(apiError(err), true); onClose(); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [claimId]);

  const refresh = async () => { await load(); onChange && onChange(); };

  const call = async (fn, ok) => {
    try { await fn(); notify(ok); await refresh(); }
    catch (err) { notify(apiError(err), true); }
  };

  const attachDocument = (docId) => call(async () => { await client.post(`/documents/${docId}/link`, { linked_claim_id: claimId }); }, "Document attached");

  const saveHospitalization = async (e) => {
    e.preventDefault();
    setSavingHosp(true);
    try {
      await client.put(`/claims/${claimId}/hospitalization`, hospForm);
      notify("Hospitalization details saved");
      await refresh();
    } catch (err) { notify(apiError(err), true); } finally { setSavingHosp(false); }
  };

  const submitNote = (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    call(async () => { await client.post(`/claims/${claimId}/notes`, { text: note }); setNote(""); }, "Note added");
  };
  const submitQuery = (e) => {
    e.preventDefault();
    if (!query.question.trim()) return;
    call(async () => { await client.post(`/claims/${claimId}/queries`, query); setQuery({ question: "", source: "Insurer" }); }, "Query logged");
  };
  const respond = (qid, response) => call(async () => { await client.post(`/claims/${claimId}/queries/${qid}/respond`, { response }); }, "Response recorded");
  const submitSettlement = (e) => {
    e.preventDefault();
    if (!settlement.amount) return;
    call(async () => { await client.post(`/claims/${claimId}/settlements`, { ...settlement, amount: Number(settlement.amount) }); setSettlement({ amount: "", kind: "partial", note: "" }); }, "Settlement recorded");
  };
  const changeStatus = (status) => {
    call(async () => { await client.post(`/claims/${claimId}/status`, { status, reason }); setReason(""); }, `Marked ${status}`);
  };
  const deleteClaim = async () => {
    if (!window.confirm(`Remove "${claim.title}"? This can't be undone - any documents attached to it stay in your Documents vault, just unlinked from this claim.`)) return;
    try {
      await client.delete(`/claims/${claimId}`);
      notify("Claim removed");
      onChange && onChange();
      onClose();
    } catch (err) { notify(apiError(err), true); }
  };

  if (!claim) return (
    <div className="drawer-backdrop" data-testid="claim-detail-drawer">
      <div className="drawer"><div className="drawer-loading">Loading claim…</div></div>
    </div>
  );

  const status = STATUS_TONE[claim.status] || STATUS_TONE.in_progress;
  const settledTotal = (claim.settlements || []).filter(s => s.kind !== "deduction").reduce((a, s) => a + s.amount, 0);
  const openQueries = (claim.queries || []).filter(q => q.status === "open").length;

  const missingCount = packet ? packet.sections.filter(s => s.status === "missing").length : 0;
  const tabs = [
    { id: "claimform", label: claim.type === "Reimbursement" ? "Claim form" : "Pre-auth prep", icon: FileSpreadsheet, count: 0 },
    { id: "packet", label: "Document packet", icon: Files, count: missingCount },
    { id: "notes", label: "Notes", icon: FileText, count: (claim.notes || []).length },
    { id: "queries", label: "Insurer queries", icon: MessageSquare, count: openQueries },
    { id: "settlements", label: "Settlements", icon: IndianRupee, count: (claim.settlements || []).length },
    { id: "outcome", label: "Outcome", icon: ShieldAlert, count: 0 },
  ];

  return (
    <div className="drawer-backdrop" data-testid="claim-detail-drawer">
      <div className="drawer">
        <button className="close-button" onClick={onClose} aria-label="Close claim" data-testid="close-claim-detail-button"><X size={18} /></button>

        <header className="drawer-header">
          <span className="claim-id" data-testid="detail-claim-id">{claim.id}</span>
          <h2 data-testid="detail-claim-title">{claim.title}</h2>
          <div className="detail-chips">
            <span className="chip chip-neutral">{claim.type}</span>
            <span className={`chip chip-${status.tone}`} data-testid="detail-status-chip">{status.label}</span>
            {!canEdit && <span className="chip chip-blue" data-testid="detail-readonly-chip">Read-only view</span>}
          </div>
          <div className="detail-meta">
            <div><small>Progress</small><strong>{claim.progress}%</strong></div>
            <div><small>Recovered</small><strong>{inr(settledTotal)}</strong></div>
            <div><small>Open queries</small><strong>{openQueries}</strong></div>
            <div><small>Updated</small><strong>{claim.updated}</strong></div>
          </div>
        </header>

        <nav className="drawer-tabs" data-testid="claim-detail-tabs">
          {tabs.map(t => (
            <button key={t.id} data-testid={`tab-${t.id}`} className={tab === t.id ? "tab active" : "tab"} onClick={() => setTab(t.id)}>
              <t.icon size={14} /><span>{t.label}</span>{t.count > 0 && <b>{t.count}</b>}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {tab === "packet" && packet && (
            <section data-testid="tab-panel-packet">
              <p className="readonly-hint" style={{ marginBottom: 14 }}>
                Documents in the order insurers commonly ask for them{claim.type === "Reimbursement" ? " for a reimbursement claim" : " for a cashless claim"}. This is a helpful default, not a guarantee any specific insurer requires exactly this - always check your policy's own checklist too.
              </p>
              <div className="entry-list">
                {packet.sections.map((section) => (
                  <article className="entry" key={section.category} data-testid={`packet-section-${section.category}`}>
                    <header>
                      <span className="claim-icon" style={{ width: 32, height: 32 }}>
                        {section.status === "attached" ? <CheckCircle2 size={15} /> : <Files size={15} />}
                      </span>
                      <div style={{ flex: 1 }}><strong>{section.label}</strong></div>
                      <span className={`chip chip-${section.status === "attached" ? "teal" : section.status === "suggested" ? "amber" : "neutral"}`}>
                        {section.status === "attached" ? "Attached" : section.status === "suggested" ? "Suggested" : "Missing"}
                      </span>
                    </header>
                    {section.attached.length > 0 && (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                        {section.attached.map((d) => <li key={d.id} style={{ fontSize: 11 }}>{d.filename}</li>)}
                      </ul>
                    )}
                    {section.status === "suggested" && section.suggested.map((d) => (
                      <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 11, flex: 1 }}>{d.filename} <small style={{ color: "var(--muted)" }}>(already in Documents)</small></span>
                        {canEdit && <button className="text-button" data-testid={`attach-document-${d.id}`} onClick={() => attachDocument(d.id)}><Link2 size={13} /> Attach</button>}
                      </div>
                    ))}
                    {section.status === "missing" && <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>Not uploaded yet - add one from the Documents page.</p>}
                  </article>
                ))}
              </div>
            </section>
          )}

          {tab === "claimform" && (
            <section data-testid="tab-panel-claimform">
              <p className="readonly-hint" style={{ marginBottom: 18 }}>
                {claim.type === "Reimbursement"
                  ? "Enter the hospitalization details once, and this compiles a reference summary from your linked documents - bills sorted into pre/during/post-hospitalization with real totals, plus a field-by-field cheat sheet for the insurer's own form. It doesn't replace the insurer's Claim Form Part A (needs your signature) or Part B (needs the hospital's) - it makes filling either one transcription instead of a from-scratch reconstruction."
                  : "Enter the hospitalization details once, and this compiles a field-by-field cheat sheet covering what a hospital's pre-authorization desk typically asks for - policy, patient, and hospitalization details. Since the insurer settles directly with the hospital on a cashless claim, there's no bill total or bank detail step here."}
              </p>

              {(() => {
                const detailsDone = !!(hospForm.patient_name && hospForm.hospital_name && hospForm.admission_date && hospForm.discharge_date);
                const isReimbursement = claim.type === "Reimbursement";
                const billsDone = !isReimbursement || !!(claimForm && claimForm.grand_total > 0);
                const sheetReady = detailsDone && billsDone;
                const steps = [
                  { label: "Hospitalization details", done: detailsDone, hint: detailsDone ? "Saved" : "Fill in below" },
                  ...(isReimbursement ? [{ label: "Bills & documents", done: billsDone, hint: billsDone ? `${inr(claimForm?.grand_total)} logged` : "Upload bills with amounts" }] : []),
                  { label: "Cheat sheet ready", done: sheetReady, hint: sheetReady ? "Ready to copy" : "Complete step 1" + (isReimbursement ? "-2" : "") },
                ];
                return (
                  <div className="cf-steps" data-testid="claimform-step-tracker">
                    {steps.map((s, i) => (
                      <div key={s.label} className={`cf-step ${s.done ? "done" : !steps[i - 1] || steps[i - 1].done ? "active" : ""}`} data-testid={`claimform-step-${i + 1}`}>
                        <strong>{i + 1}. {s.label}</strong>
                        <span>{s.hint}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="cf-card">
                <div className="cf-card-head">
                  <h3>Hospitalization details</h3>
                  <p>The core facts every insurer's form asks for - fill in what you know, the rest can wait.</p>
                </div>
              <form
                className="stack-form"
                style={{ marginBottom: 0, paddingBottom: 0, border: 0 }}
                onSubmit={saveHospitalization}
                data-testid="hospitalization-form"
              >
                <div className="row-2">
                  <label>Patient name<input value={hospForm.patient_name} onChange={(e) => setHospForm({ ...hospForm, patient_name: e.target.value })} placeholder="Who was hospitalized" data-testid="hosp-patient-name-input" disabled={!canEdit} /></label>
                  <label>Hospital name<input value={hospForm.hospital_name} onChange={(e) => setHospForm({ ...hospForm, hospital_name: e.target.value })} placeholder="e.g. Venkateshwar Hospital" data-testid="hosp-hospital-name-input" disabled={!canEdit} /></label>
                </div>
                <div className="row-2">
                  <label>Admission date<input type="date" value={hospForm.admission_date} onChange={(e) => setHospForm({ ...hospForm, admission_date: e.target.value })} data-testid="hosp-admission-date-input" disabled={!canEdit} /></label>
                  <label>Discharge date<input type="date" value={hospForm.discharge_date} onChange={(e) => setHospForm({ ...hospForm, discharge_date: e.target.value })} data-testid="hosp-discharge-date-input" disabled={!canEdit} /></label>
                </div>
                <label>Diagnosis<input value={hospForm.diagnosis} onChange={(e) => setHospForm({ ...hospForm, diagnosis: e.target.value })} placeholder="e.g. Placenta previa - LSCS" data-testid="hosp-diagnosis-input" disabled={!canEdit} /></label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                  <input type="checkbox" checked={!!hospForm.is_maternity} onChange={(e) => setHospForm({ ...hospForm, is_maternity: e.target.checked })} data-testid="hosp-maternity-checkbox" disabled={!canEdit} style={{ width: "auto" }} />
                  This is a maternity claim (adds the obstetric-history requirement to the checklist)
                </label>

                <p className="eyebrow" style={{ marginTop: 10 }}>PATIENT DETAILS (SECTION C)</p>
                <div className="row-2">
                  <label>Gender
                    <select value={hospForm.patient_gender} onChange={(e) => setHospForm({ ...hospForm, patient_gender: e.target.value })} data-testid="hosp-patient-gender-select" disabled={!canEdit}>
                      <option value="">Not set</option><option value="Male">Male</option><option value="Female">Female</option>
                    </select>
                  </label>
                  <label>Date of birth<input type="date" value={hospForm.patient_dob} onChange={(e) => setHospForm({ ...hospForm, patient_dob: e.target.value })} data-testid="hosp-patient-dob-input" disabled={!canEdit} /></label>
                </div>
                <div className="row-2">
                  <label>Relationship to primary insured
                    <select value={hospForm.patient_relationship} onChange={(e) => setHospForm({ ...hospForm, patient_relationship: e.target.value })} data-testid="hosp-patient-relationship-select" disabled={!canEdit}>
                      <option value="">Not set</option>
                      {["Self", "Spouse", "Child", "Father", "Mother", "Other"].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label>Occupation
                    <select value={hospForm.patient_occupation} onChange={(e) => setHospForm({ ...hospForm, patient_occupation: e.target.value })} data-testid="hosp-patient-occupation-select" disabled={!canEdit}>
                      <option value="">Not set</option>
                      {["Service", "Self Employed", "Home Maker", "Student", "Retired", "Other"].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                </div>
                <label>Address<input value={hospForm.patient_address} onChange={(e) => setHospForm({ ...hospForm, patient_address: e.target.value })} placeholder="Patient's address, if different from household" data-testid="hosp-patient-address-input" disabled={!canEdit} /></label>
                <div className="row-2">
                  <label>Phone<input value={hospForm.patient_phone} onChange={(e) => setHospForm({ ...hospForm, patient_phone: e.target.value })} data-testid="hosp-patient-phone-input" disabled={!canEdit} /></label>
                  <label>Email<input type="email" value={hospForm.patient_email} onChange={(e) => setHospForm({ ...hospForm, patient_email: e.target.value })} data-testid="hosp-patient-email-input" disabled={!canEdit} /></label>
                </div>

                <p className="eyebrow" style={{ marginTop: 10 }}>HOSPITALIZATION SPECIFICS (SECTION D)</p>
                <div className="row-2">
                  <label>Room category occupied
                    <select value={hospForm.room_category} onChange={(e) => setHospForm({ ...hospForm, room_category: e.target.value })} data-testid="hosp-room-category-select" disabled={!canEdit}>
                      <option value="">Not set</option>
                      {["Day care", "Single occupancy", "Twin sharing", "3 or more beds per room"].map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </label>
                  <label>Hospitalization due to
                    <select value={hospForm.hospitalization_cause} onChange={(e) => setHospForm({ ...hospForm, hospitalization_cause: e.target.value })} data-testid="hosp-cause-select" disabled={!canEdit}>
                      <option value="">Not set</option><option value="Injury">Injury</option><option value="Illness">Illness</option><option value="Maternity">Maternity</option>
                    </select>
                  </label>
                </div>
                <div className="row-2">
                  <label>Date of injury / disease first detected / delivery<input type="date" value={hospForm.date_of_onset} onChange={(e) => setHospForm({ ...hospForm, date_of_onset: e.target.value })} data-testid="hosp-date-of-onset-input" disabled={!canEdit} /></label>
                  <label>System of medicine<input value={hospForm.system_of_medicine} onChange={(e) => setHospForm({ ...hospForm, system_of_medicine: e.target.value })} placeholder="e.g. Allopathy" data-testid="hosp-system-of-medicine-input" disabled={!canEdit} /></label>
                </div>
                <div className="row-2">
                  <label>Admission time<input type="time" value={hospForm.admission_time} onChange={(e) => setHospForm({ ...hospForm, admission_time: e.target.value })} data-testid="hosp-admission-time-input" disabled={!canEdit} /></label>
                  <label>Discharge time<input type="time" value={hospForm.discharge_time} onChange={(e) => setHospForm({ ...hospForm, discharge_time: e.target.value })} data-testid="hosp-discharge-time-input" disabled={!canEdit} /></label>
                </div>
                {hospForm.hospitalization_cause === "Injury" && (
                  <>
                    <label>If injury, cause<input value={hospForm.injury_cause} onChange={(e) => setHospForm({ ...hospForm, injury_cause: e.target.value })} placeholder="e.g. Road traffic accident" data-testid="hosp-injury-cause-input" disabled={!canEdit} /></label>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}><input type="checkbox" checked={!!hospForm.medico_legal} onChange={(e) => setHospForm({ ...hospForm, medico_legal: e.target.checked })} data-testid="hosp-medico-legal-checkbox" disabled={!canEdit} style={{ width: "auto" }} />Medico-legal case</label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}><input type="checkbox" checked={!!hospForm.reported_to_police} onChange={(e) => setHospForm({ ...hospForm, reported_to_police: e.target.checked })} data-testid="hosp-reported-police-checkbox" disabled={!canEdit} style={{ width: "auto" }} />Reported to police</label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}><input type="checkbox" checked={!!hospForm.mlc_report_attached} onChange={(e) => setHospForm({ ...hospForm, mlc_report_attached: e.target.checked })} data-testid="hosp-mlc-attached-checkbox" disabled={!canEdit} style={{ width: "auto" }} />MLC report &amp; FIR attached</label>
                    </div>
                  </>
                )}

                <p className="eyebrow" style={{ marginTop: 10 }}>INSURANCE HISTORY (SECTION B)</p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
                  <input type="checkbox" checked={!!hospForm.has_other_insurance} onChange={(e) => setHospForm({ ...hospForm, has_other_insurance: e.target.checked })} data-testid="hosp-other-insurance-checkbox" disabled={!canEdit} style={{ width: "auto" }} />
                  Currently covered by another Mediclaim / Health Insurance
                </label>
                {hospForm.has_other_insurance && (
                  <div className="row-2">
                    <label>Other insurer name<input value={hospForm.other_insurer_name} onChange={(e) => setHospForm({ ...hospForm, other_insurer_name: e.target.value })} data-testid="hosp-other-insurer-name-input" disabled={!canEdit} /></label>
                    <label>Date first insurance began (no break)<input type="date" value={hospForm.first_insurance_start_date} onChange={(e) => setHospForm({ ...hospForm, first_insurance_start_date: e.target.value })} data-testid="hosp-first-insurance-date-input" disabled={!canEdit} /></label>
                  </div>
                )}
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}><input type="checkbox" checked={!!hospForm.hospitalized_last_4_years} onChange={(e) => setHospForm({ ...hospForm, hospitalized_last_4_years: e.target.checked })} data-testid="hosp-last-4-years-checkbox" disabled={!canEdit} style={{ width: "auto" }} />Hospitalized in the last 4 years</label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}><input type="checkbox" checked={!!hospForm.previously_covered_other_insurance} onChange={(e) => setHospForm({ ...hospForm, previously_covered_other_insurance: e.target.checked })} data-testid="hosp-previously-covered-checkbox" disabled={!canEdit} style={{ width: "auto" }} />Previously covered elsewhere</label>
                </div>

                {canEdit && <button className="primary-button" type="submit" disabled={savingHosp} data-testid="save-hospitalization-button" style={{ justifySelf: "start", marginTop: 8 }}>{savingHosp ? "Saving…" : "Save hospitalization details"}</button>}
              </form>
              </div>

              {claimForm && (
                <>
                  {claimForm.coverage_check && (
                    <div
                      className={claimForm.coverage_check.matched
                        ? (claimForm.coverage_check.waiting_status?.covered_now === false || claimForm.coverage_check.covered === false ? "attention-strip" : "ai-insights-panel")
                        : "empty-hint"}
                      style={{ marginBottom: 16 }}
                      data-testid="claimform-coverage-check"
                    >
                      {claimForm.coverage_check.matched ? (
                        <>
                          <p style={{ margin: 0, fontSize: 12 }}>
                            <strong>Coverage check — {claimForm.coverage_check.condition}:</strong>{" "}
                            {claimForm.coverage_check.covered === false ? (
                              <span className="chip chip-red">Not covered per this policy</span>
                            ) : claimForm.coverage_check.waiting_status?.covered_now === false ? (
                              <span className="chip chip-amber">Waiting period active — {claimForm.coverage_check.waiting_status.days_remaining} days left</span>
                            ) : claimForm.coverage_check.waiting_status?.covered_now === true ? (
                              <span className="chip chip-teal">Waiting period has passed — covered</span>
                            ) : (
                              <span className="chip chip-neutral">Covered, no waiting period stated</span>
                            )}
                          </p>
                          {claimForm.coverage_check.notes && <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>{claimForm.coverage_check.notes}</p>}
                        </>
                      ) : (
                        <p style={{ fontSize: 12, margin: 0 }}>{claimForm.coverage_check.message}</p>
                      )}
                    </div>
                  )}

                  {claim.type === "Reimbursement" && (
                    <div className="cf-card">
                      <div className="cf-card-head">
                        <h3>Bills &amp; documents</h3>
                        <p>Sorted automatically into pre/during/post-hospitalization using the dates above and each document's bill date.</p>
                      </div>

                      {claimForm.missing_hospitalization_dates && (
                        <div className="cf-notice" data-testid="claimform-missing-dates-hint">
                          Add admission and discharge dates above to sort bills into pre/during/post-hospitalization automatically.
                        </div>
                      )}

                      <div className="card-grid">
                        {[
                          { key: "pre_hospitalization", label: "Pre-hospitalization" },
                          { key: "hospitalization", label: "Hospitalization" },
                          { key: "post_hospitalization", label: "Post-hospitalization" },
                        ].map(({ key, label }) => (
                          <article className="entry" key={key} data-testid={`claimform-bucket-${key}`}>
                            <strong style={{ fontSize: 12 }}>{label}</strong>
                            <p style={{ fontSize: 16, margin: "6px 0 0", fontWeight: 700 }}>{inr(claimForm.bills[key].total)}</p>
                            <small style={{ color: "var(--muted)" }}>{claimForm.bills[key].items.length} document{claimForm.bills[key].items.length === 1 ? "" : "s"}</small>
                          </article>
                        ))}
                      </div>

                      <div className="cf-totalbox" data-testid="claimform-grand-total">
                        <div><span>Total claim expenses</span><strong>{inr(claimForm.grand_total)}</strong></div>
                      </div>
                    </div>
                  )}

                  <div className="cf-card">
                    <div className="cf-card-head">
                      <h3>Your claim packet</h3>
                      <p>Everything organized for you to review, print, or hand off yourself - Coversfolio never submits anything on your behalf.</p>
                    </div>
                    <div className="cf-package">
                      <a
                        href={`${API}/claims/${claimId}/claim-form-pdf`}
                        target="_blank" rel="noopener noreferrer"
                        className="cf-packitem" style={{ textDecoration: "none", color: "inherit", display: "block" }}
                        data-testid="download-claim-form-button"
                      >
                        <FileSpreadsheet size={20} />
                        <b>Claim summary (PDF)</b>
                        <small>Hospitalization details, bill totals, and coverage check - ready to download.</small>
                      </a>
                      <button type="button" className="cf-packitem" style={{ textAlign: "left", background: "#fff", cursor: "pointer", width: "100%" }} onClick={() => setTab("packet")} data-testid="claimform-jump-to-packet">
                        <Files size={20} />
                        <b>Document packet</b>
                        <small>{missingCount > 0 ? `${missingCount} document${missingCount === 1 ? "" : "s"} still missing` : "All checklist documents attached"}</small>
                      </button>
                    </div>
                  </div>

                  {claimForm.cheat_sheet && (
                    <div className="cf-card" data-testid="cheat-sheet">
                      <div className="cf-card-head">
                        <h3>Fill-in cheat sheet</h3>
                        <p>Laid out section-by-section to match a standard reimbursement claim form (e.g. Medi Assist / TPA format) - so filling in the paper or PDF form is copying, not hunting through a shoebox of documents.</p>
                      </div>

                      {claimForm.cheat_sheet.map((section) => (
                        <div key={section.section} style={{ marginBottom: 18 }} data-testid={`cheat-sheet-section-${section.section}`}>
                          <p style={{ margin: "0 0 8px" }}><span className="cf-section-badge">Section {section.section}</span><strong style={{ fontSize: 12 }}>{section.title}</strong></p>
                          {section.fields && (
                            <div className="cf-cheat-table">
                              <div className="cf-head">Form field</div><div className="cf-head">Value</div><div className="cf-head">Status</div>
                              {section.fields.map((f) => {
                                const filled = f.value !== null && f.value !== undefined && f.value !== "";
                                return (
                                  <Fragment key={f.label}>
                                    <div>{f.label}</div>
                                    <div style={{ fontWeight: filled ? 600 : 400 }}>{filled ? String(f.value) : "—"}</div>
                                    <div className={filled ? "cf-filled" : "cf-missing"}>{filled ? "Filled in" : "Needs input"}</div>
                                  </Fragment>
                                );
                              })}
                            </div>
                          )}
                          {section.bills && (
                            section.bills.length === 0 ? (
                              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>No bills with an amount logged yet - add bill amounts when uploading documents in the Documents page.</p>
                            ) : (
                              <table style={{ width: "100%", marginTop: 8, fontSize: 11, borderCollapse: "collapse" }}>
                                <thead><tr style={{ textAlign: "left", color: "var(--muted)" }}><th style={{ paddingBottom: 4 }}>Sl.</th><th>Document</th><th>Towards</th><th>Bill date</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                                <tbody>
                                  {section.bills.map((b, i) => (
                                    <tr key={i} style={{ borderTop: "1px dashed var(--line)" }}>
                                      <td style={{ padding: "4px 0" }}>{i + 1}</td>
                                      <td>{b.filename}</td>
                                      <td>{b.towards}</td>
                                      <td>{b.bill_date || "—"}</td>
                                      <td style={{ textAlign: "right" }}>{inr(b.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )
                          )}
                          {section.note && <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 8, fontStyle: "italic" }}>{section.note}</p>}
                        </div>
                      ))}

                      {claim.type === "Reimbursement" && (
                        <div>
                          <p style={{ margin: "0 0 8px" }}><span className="cf-section-badge">Section G</span><strong style={{ fontSize: 12 }}>Details of primary insured's bank account</strong></p>
                          <div className="cf-notice" style={{ marginBottom: 12 }}>
                            Typed here only to lay it out for you to copy - this stays in your browser for this session only. Coversfolio never saves or transmits your bank/PAN details.
                          </div>
                          <div className="row-2">
                            <label style={{ fontSize: 11 }}>TPA / Company membership ID<input value={bankForm.tpa_membership_id} onChange={(e) => setBankForm({ ...bankForm, tpa_membership_id: e.target.value })} data-testid="bank-tpa-id-input" /></label>
                            <label style={{ fontSize: 11 }}>PAN<input value={bankForm.pan_number} onChange={(e) => setBankForm({ ...bankForm, pan_number: e.target.value.toUpperCase() })} maxLength={10} data-testid="bank-pan-input" /></label>
                          </div>
                          <div className="row-2">
                            <label style={{ fontSize: 11 }}>Account holder name<input value={bankForm.bank_account_holder} onChange={(e) => setBankForm({ ...bankForm, bank_account_holder: e.target.value })} data-testid="bank-holder-input" /></label>
                            <label style={{ fontSize: 11 }}>Account number<input value={bankForm.bank_account_number} onChange={(e) => setBankForm({ ...bankForm, bank_account_number: e.target.value })} data-testid="bank-account-number-input" /></label>
                          </div>
                          <div className="row-2">
                            <label style={{ fontSize: 11 }}>Bank name and branch<input value={bankForm.bank_name_branch} onChange={(e) => setBankForm({ ...bankForm, bank_name_branch: e.target.value })} data-testid="bank-name-branch-input" /></label>
                            <label style={{ fontSize: 11 }}>IFSC code<input value={bankForm.ifsc_code} onChange={(e) => setBankForm({ ...bankForm, ifsc_code: e.target.value.toUpperCase() })} maxLength={11} data-testid="bank-ifsc-input" /></label>
                          </div>
                          <label style={{ fontSize: 11 }}>Cheque / DD payable to<input value={bankForm.cheque_payable_name} onChange={(e) => setBankForm({ ...bankForm, cheque_payable_name: e.target.value })} data-testid="bank-cheque-payable-input" /></label>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === "notes" && (
            <section data-testid="tab-panel-notes">
              <div className="entry-list">
                {(claim.notes || []).length === 0 && <p className="empty-hint">No notes yet. Capture anything the household should remember.</p>}
                {(claim.notes || []).slice().reverse().map(n => (
                  <article className="entry" key={n.id} data-testid={`note-${n.id}`}><header><strong>{n.author || "Household"}</strong><small>{format(n.at)}</small></header><p>{n.text}</p></article>
                ))}
              </div>
              {canEdit && (
                <form onSubmit={submitNote} className="stack-form" data-testid="add-note-form">
                  <textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Called TPA — will confirm cashless approval by Monday." data-testid="note-input" required />
                  <button className="primary-button" data-testid="add-note-submit"><Plus size={14} /> Add note</button>
                </form>
              )}
            </section>
          )}

          {tab === "queries" && (
            <section data-testid="tab-panel-queries">
              <div className="entry-list">
                {(claim.queries || []).length === 0 && <p className="empty-hint">No insurer queries logged yet.</p>}
                {(claim.queries || []).slice().reverse().map(q => (
                  <article className={`entry query-${q.status}`} key={q.id} data-testid={`query-${q.id}`}>
                    <header><strong>{q.source}</strong><small>{format(q.at)}</small><span className={`chip chip-${q.status === "open" ? "amber" : "teal"}`}>{q.status === "open" ? "Awaiting response" : "Answered"}</span></header>
                    <p><em>Query:</em> {q.question}</p>
                    {q.response && <p className="response"><em>Response by {q.responded_by} · {format(q.responded_at)}</em><br />{q.response}</p>}
                    {canEdit && q.status === "open" && <QueryReply onSubmit={(text) => respond(q.id, text)} />}
                  </article>
                ))}
              </div>
              {canEdit && (
                <form onSubmit={submitQuery} className="stack-form" data-testid="add-query-form">
                  <label>Source<input value={query.source} onChange={e => setQuery({ ...query, source: e.target.value })} placeholder="Insurer / TPA name" data-testid="query-source-input" /></label>
                  <label>Query raised<textarea rows="3" value={query.question} onChange={e => setQuery({ ...query, question: e.target.value })} placeholder="What did the insurer ask?" data-testid="query-question-input" required /></label>
                  <button className="primary-button" data-testid="add-query-submit"><Plus size={14} /> Log query</button>
                </form>
              )}
            </section>
          )}

          {tab === "settlements" && (
            <section data-testid="tab-panel-settlements">
              <div className="entry-list">
                {(claim.settlements || []).length === 0 && <p className="empty-hint">No settlement entries yet. Record every part-payment, deduction, or final decision.</p>}
                {(claim.settlements || []).slice().reverse().map(s => (
                  <article className={`entry settlement-${s.kind}`} key={s.id} data-testid={`settlement-${s.id}`}>
                    <header><strong>{inr(s.amount)}</strong><small>{format(s.at)} · {s.recorded_by}</small><span className={`chip chip-${s.kind === "deduction" ? "red" : s.kind === "final" ? "teal" : "blue"}`}>{s.kind}</span></header>
                    {s.note && <p>{s.note}</p>}
                  </article>
                ))}
              </div>
              {canEdit && (
                <form onSubmit={submitSettlement} className="stack-form" data-testid="add-settlement-form">
                  <div className="row-2">
                    <label>Amount (₹)<input type="number" min="1" step="1" value={settlement.amount} onChange={e => setSettlement({ ...settlement, amount: e.target.value })} placeholder="45000" data-testid="settlement-amount-input" required /></label>
                    <label>Type<select value={settlement.kind} onChange={e => setSettlement({ ...settlement, kind: e.target.value })} data-testid="settlement-kind-select"><option value="partial">Partial payment</option><option value="deduction">Deduction / disallowed</option><option value="final">Final settlement</option></select></label>
                  </div>
                  <label>Note (optional)<textarea rows="2" value={settlement.note} onChange={e => setSettlement({ ...settlement, note: e.target.value })} placeholder="What was covered or deducted?" data-testid="settlement-note-input" /></label>
                  <button className="primary-button" data-testid="add-settlement-submit"><Plus size={14} /> Record entry</button>
                </form>
              )}
            </section>
          )}

          {tab === "outcome" && (
            <section data-testid="tab-panel-outcome">
              <div className="outcome-card">
                <ClipboardList size={20} />
                <div><strong>Current outcome</strong><p>Status: <b>{status.label}</b>. Every change is logged in the timeline and access history.</p></div>
              </div>
              {canEdit ? (
                <div className="outcome-actions">
                  <label>Reason / note<textarea rows="3" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is the status changing?" data-testid="status-reason-input" /></label>
                  <div className="btn-row">
                    <button className="outline-button danger" onClick={() => changeStatus("rejected")} data-testid="mark-rejected-button"><AlertTriangle size={14} /> Mark rejected</button>
                    <button className="outline-button" onClick={() => changeStatus("appealed")} data-testid="file-appeal-button"><ShieldAlert size={14} /> File appeal</button>
                    <button className="outline-button" onClick={() => changeStatus("reopened")} data-testid="reopen-claim-button"><Undo2 size={14} /> Reopen</button>
                    <button className="primary-button" onClick={() => changeStatus("settled")} data-testid="mark-settled-button"><Check size={14} /> Mark settled</button>
                  </div>
                  <p className="readonly-hint">Note: this app prepares and tracks your file — insurer decisions and TPA confirmations remain authoritative.</p>
                  <div style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 16 }}>
                    <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 10px" }}>Started this by mistake, or just testing? You can remove it entirely instead of changing its status.</p>
                    <button className="outline-button danger" onClick={deleteClaim} data-testid="delete-claim-button"><Trash2 size={14} /> Delete this claim</button>
                  </div>
                </div>
              ) : <p className="readonly-hint">Only owners and household members can change the claim outcome.</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function QueryReply({ onSubmit }) {
  const [text, setText] = useState("");
  const submit = (e) => { e.preventDefault(); if (!text.trim()) return; onSubmit(text); setText(""); };
  return (
    <form className="reply-form" onSubmit={submit} data-testid="respond-query-form">
      <textarea rows="2" value={text} onChange={e => setText(e.target.value)} placeholder="Record what was sent back or clarified." data-testid="query-response-input" required />
      <button className="outline-button" data-testid="respond-query-submit"><Check size={14} /> Save response</button>
    </form>
  );
}
