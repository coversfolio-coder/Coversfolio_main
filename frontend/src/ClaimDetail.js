import { useEffect, useState } from "react";
import client, { API, apiError } from "@/api";
import {
  X, FileText, MessageSquare, IndianRupee, Milestone, AlertTriangle,
  Undo2, Check, Plus, ClipboardList, ShieldAlert, Timer, PlayCircle, CheckCircle2, Files, Link2, FileSpreadsheet
} from "lucide-react";


const STAGES = [
  { label: "Documents in review", progress: 30 },
  { label: "Pre-authorisation", progress: 45 },
  { label: "Insurer query raised", progress: 55 },
  { label: "Awaiting settlement", progress: 75 },
  { label: "Documents submitted", progress: 85 },
];

const STATUS_TONE = {
  in_progress: { label: "In progress", tone: "teal" },
  settled: { label: "Settled", tone: "teal" },
  rejected: { label: "Rejected", tone: "red" },
  appealed: { label: "Appeal filed", tone: "amber" },
  reopened: { label: "Reopened", tone: "blue" },
};

const format = (iso) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function Countdown({ startedAt, hours }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const deadline = new Date(startedAt).getTime() + hours * 3600 * 1000;
  const diffMs = deadline - now;
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const totalMinutes = Math.floor(abs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hrs = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  const secs = Math.floor((abs % 60000) / 1000);
  const text = days > 0 ? `${days}d ${hrs}h ${mins}m` : `${hrs}h ${mins}m ${secs}s`;
  return (
    <span className={overdue ? "sla-countdown sla-overdue" : "sla-countdown sla-active"} data-testid="sla-countdown">
      {overdue ? `Overdue by ${text}` : `${text} remaining`}
    </span>
  );
}

export default function ClaimDetail({ claimId, canEdit, onClose, onChange, notify }) {
  const [claim, setClaim] = useState(null);
  const [sla, setSla] = useState(null);
  const [packet, setPacket] = useState(null);
  const [claimForm, setClaimForm] = useState(null);
  const [tab, setTab] = useState("timeline");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState({ question: "", source: "Insurer" });
  const [settlement, setSettlement] = useState({ amount: "", kind: "partial", note: "" });
  const [stage, setStage] = useState({ stage: STAGES[0].label, progress: STAGES[0].progress, note: "" });
  const [reason, setReason] = useState("");
  const [hospForm, setHospForm] = useState({ patient_name: "", hospital_name: "", admission_date: "", discharge_date: "", diagnosis: "", is_maternity: false });
  const [savingHosp, setSavingHosp] = useState(false);

  const load = async () => {
    try {
      const res = await client.get(`/claims/${claimId}`);
      setClaim(res.data);
      setHospForm({
        patient_name: res.data.patient_name || "", hospital_name: res.data.hospital_name || "",
        admission_date: res.data.admission_date || "", discharge_date: res.data.discharge_date || "",
        diagnosis: res.data.diagnosis || "", is_maternity: !!res.data.is_maternity,
      });
      const slaRes = await client.get(`/claims/${claimId}/sla`);
      setSla(slaRes.data);
      const packetRes = await client.get(`/claims/${claimId}/document-packet`);
      setPacket(packetRes.data);
      if (res.data.type === "Reimbursement") {
        const formRes = await client.get(`/claims/${claimId}/claim-form`);
        setClaimForm(formRes.data);
      }
    } catch (err) { notify(apiError(err)); onClose(); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [claimId]);

  const refresh = async () => { await load(); onChange && onChange(); };

  const call = async (fn, ok) => {
    try { await fn(); notify(ok); await refresh(); }
    catch (err) { notify(apiError(err)); }
  };

  const startSla = (slaType) => call(async () => { await client.post(`/claims/${claimId}/sla/start`, { sla_type: slaType }); }, "SLA clock started");
  const resolveSla = (eventId) => call(async () => { await client.post(`/claims/${claimId}/sla/${eventId}/resolve`); }, "Marked resolved");
  const attachDocument = (docId) => call(async () => { await client.post(`/documents/${docId}/link`, { linked_claim_id: claimId }); }, "Document attached");

  const saveHospitalization = async (e) => {
    e.preventDefault();
    setSavingHosp(true);
    try {
      await client.put(`/claims/${claimId}/hospitalization`, hospForm);
      notify("Hospitalization details saved");
      await refresh();
    } catch (err) { notify(apiError(err)); } finally { setSavingHosp(false); }
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
  const submitStage = (e) => {
    e.preventDefault();
    call(async () => { await client.post(`/claims/${claimId}/stage`, stage); setStage({ ...stage, note: "" }); }, "Stage updated");
  };
  const changeStatus = (status) => {
    call(async () => { await client.post(`/claims/${claimId}/status`, { status, reason }); setReason(""); }, `Marked ${status}`);
  };

  if (!claim) return (
    <div className="drawer-backdrop" data-testid="claim-detail-drawer">
      <div className="drawer"><div className="drawer-loading">Loading claim…</div></div>
    </div>
  );

  const status = STATUS_TONE[claim.status] || STATUS_TONE.in_progress;
  const settledTotal = (claim.settlements || []).filter(s => s.kind !== "deduction").reduce((a, s) => a + s.amount, 0);
  const openQueries = (claim.queries || []).filter(q => q.status === "open").length;

  const activeSlaCount = (sla?.events || []).filter(e => !e.resolved_at).length;
  const missingCount = packet ? packet.sections.filter(s => s.status === "missing").length : 0;
  const tabs = [
    { id: "timeline", label: "Timeline", icon: Milestone, count: (claim.stage_history || []).length },
    { id: "sla", label: "SLA tracking", icon: Timer, count: activeSlaCount },
    { id: "packet", label: "Document packet", icon: Files, count: missingCount },
    ...(claim.type === "Reimbursement" ? [{ id: "claimform", label: "Claim form", icon: FileSpreadsheet, count: 0 }] : []),
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
          {tab === "timeline" && (
            <section data-testid="tab-panel-timeline">
              <ol className="timeline">
                {(claim.stage_history || []).slice().reverse().map((h, i) => (
                  <li key={i}><span className="tl-dot" /><div><strong>{h.stage}</strong><small>{format(h.at)} · {h.by || "Household"}</small>{h.note && <p>{h.note}</p>}</div></li>
                ))}
              </ol>
              {canEdit ? (
                <form onSubmit={submitStage} className="stack-form" data-testid="advance-stage-form">
                  <label>Advance to<select data-testid="stage-select" value={stage.stage} onChange={e => { const s = STAGES.find(x => x.label === e.target.value); setStage({ ...stage, stage: s.label, progress: s.progress }); }}>{STAGES.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}</select></label>
                  <label>Add a note (optional)<textarea rows="2" value={stage.note} onChange={e => setStage({ ...stage, note: e.target.value })} placeholder="Anything worth remembering" data-testid="stage-note-input" /></label>
                  <button className="primary-button" data-testid="advance-stage-submit"><Plus size={14} /> Save stage</button>
                </form>
              ) : <p className="readonly-hint">Only owners and household members can update stages.</p>}
            </section>
          )}

          {tab === "sla" && sla && (
            <section data-testid="tab-panel-sla">
              <p className="readonly-hint" style={{ marginBottom: 14 }}>
                These windows come from IRDAI's Master Circular on Health Insurance Business and the "Cashless Everywhere" initiative. Start a clock the moment the real-world event happens (e.g. the hospital submits the pre-authorization request) - Coversfolio just tracks the deadline, it doesn't talk to your insurer.
              </p>

              {(sla.events || []).length > 0 && (
                <div className="entry-list" style={{ marginBottom: 18 }}>
                  {sla.events.map((event) => (
                    <article className="entry" key={event.id} data-testid={`sla-event-${event.id}`}>
                      <header>
                        <span className="claim-icon" style={{ width: 32, height: 32 }}><Timer size={15} /></span>
                        <div style={{ flex: 1 }}>
                          <strong>{event.label}</strong>
                          <small style={{ display: "block" }}>Started {format(event.started_at)}</small>
                        </div>
                        {event.resolved_at ? (
                          <span className="chip chip-teal"><CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> Resolved {format(event.resolved_at)}</span>
                        ) : (
                          canEdit && <button className="text-button" data-testid={`resolve-sla-${event.id}`} onClick={() => resolveSla(event.id)}><Check size={13} /> Mark resolved</button>
                        )}
                      </header>
                      {!event.resolved_at && <p><Countdown startedAt={event.started_at} hours={event.hours} /></p>}
                    </article>
                  ))}
                </div>
              )}

              {canEdit && (
                <div>
                  <label style={{ marginBottom: 8, display: "block", fontSize: 12, fontWeight: 600 }}>Start a clock</label>
                  <div className="card-grid">
                    {Object.entries(sla.applicable || {}).map(([slaType, def]) => {
                      const alreadyActive = (sla.events || []).some(e => e.sla_type === slaType && !e.resolved_at);
                      return (
                        <button
                          key={slaType}
                          type="button"
                          className="scan-upload-button"
                          disabled={alreadyActive}
                          onClick={() => startSla(slaType)}
                          data-testid={`start-sla-${slaType}`}
                          style={{ marginBottom: 0 }}
                        >
                          <PlayCircle size={16} />
                          <span>
                            <strong>{def.label} ({def.hours < 24 ? `${def.hours}h` : `${Math.round(def.hours / 24)}d`})</strong>
                            <small>{alreadyActive ? "Already tracking" : def.citation}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!canEdit && (sla.events || []).length === 0 && <p className="empty-hint">No SLA clocks started on this claim yet.</p>}
            </section>
          )}

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
              <p className="readonly-hint" style={{ marginBottom: 14 }}>
                Enter the hospitalization details once, and this compiles a reference summary from your linked documents - bills sorted into pre/during/post-hospitalization with real totals, plus the document checklist. It doesn't replace the insurer's own Claim Form Part A (needs your signature) or Part B (needs the hospital's), but it makes filling either one transcription instead of a from-scratch reconstruction.
              </p>

              <form
                className="stack-form"
                style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}
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
                {canEdit && <button className="primary-button" type="submit" disabled={savingHosp} data-testid="save-hospitalization-button" style={{ justifySelf: "start" }}>{savingHosp ? "Saving…" : "Save hospitalization details"}</button>}
              </form>

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

                  {claimForm.missing_hospitalization_dates && (
                    <div className="empty-hint" style={{ marginBottom: 16 }} data-testid="claimform-missing-dates-hint">
                      Add admission and discharge dates above to sort bills into pre/during/post-hospitalization automatically.
                    </div>
                  )}

                  <div className="card-grid" style={{ marginBottom: 16 }}>
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

                  <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }} data-testid="claimform-grand-total">Grand total claimed: {inr(claimForm.grand_total)}</p>

                  <a
                    href={`${API}/claims/${claimId}/claim-form-pdf`}
                    target="_blank" rel="noopener noreferrer"
                    className="primary-button"
                    style={{ display: "inline-flex", width: "fit-content", textDecoration: "none" }}
                    data-testid="download-claim-form-button"
                  >
                    <FileSpreadsheet size={15} /> Download claim summary (PDF)
                  </a>
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
