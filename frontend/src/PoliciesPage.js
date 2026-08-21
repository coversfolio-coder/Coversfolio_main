import { useEffect, useRef, useState } from "react";
import client, { apiError } from "@/api";
import { ArrowUpRight, BookOpen, Check, FileScan, FileText, MapPin, Plus, ShieldQuestion, Sparkles, Trash2, Upload, Users, X } from "lucide-react";

const emptyForm = {
  insurer_name: "", policy_number: "", policy_type: "Health",
  sum_insured: "", start_date: "", end_date: "",
  insured_people: [{ name: "", relation: "Self", dob: "" }],
};

export default function PoliciesPage({ canEdit, notify, prefill, onPrefillConsumed }) {
  const [policies, setPolicies] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedFrom, setScannedFrom] = useState(null);
  const [typeTouched, setTypeTouched] = useState(false);
  const [hospitalPolicy, setHospitalPolicy] = useState(null);
  const [hospitalCity, setHospitalCity] = useState("");
  const [hospitalResult, setHospitalResult] = useState(null);
  const [hospitalLoading, setHospitalLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  // One modal now shows everything stored about a policy - basic details, AI
  // coverage insights, and maximize-benefits - instead of three separate ones.
  const [detailsPolicy, setDetailsPolicy] = useState(null);
  const [loggingCheckup, setLoggingCheckup] = useState(false);

  const openDetails = (policy) => {
    setDetailsPolicy(policy);
    setConditionQuery("");
    setConditionResult(null);
  };

  const logCheckupUsed = async (policyId) => {
    setLoggingCheckup(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await client.put(`/policies/${policyId}`, { health_checkup_last_used_date: today });
      setDetailsPolicy(res.data);
      notify("Logged - noted today as when you used it");
      load();
    } catch (err) { notify(apiError(err)); } finally { setLoggingCheckup(false); }
  };
  const [conditionQuery, setConditionQuery] = useState("");
  const [conditionResult, setConditionResult] = useState(null);
  const [conditionChecking, setConditionChecking] = useState(false);
  const [retroAnalyzing, setRetroAnalyzing] = useState(null);
  const retroAiInputRefs = useRef({});

  const onRetroAnalyze = async (policyId, e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRetroAnalyzing(policyId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const analyzeRes = await client.post("/policies/extract-ai", formData, { headers: { "Content-Type": "multipart/form-data" } });
      const { source, ...insights } = analyzeRes.data;
      await client.put(`/policies/${policyId}`, { ai_insights: insights });
      notify("AI analysis added to this policy");
      load();
    } catch (err) {
      if (err?.response?.status === 501) notify("AI analysis isn't set up on this server yet");
      else notify(apiError(err));
    } finally { setRetroAnalyzing(null); }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { notify("Your browser doesn't support location detection - please type your city"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await client.get("/geocode/reverse", { params: { lat: position.coords.latitude, lng: position.coords.longitude } });
          setHospitalCity(res.data.city);
          notify(`Detected: ${res.data.city}`);
        } catch (err) { notify(apiError(err)); } finally { setLocating(false); }
      },
      () => { notify("Couldn't access your location - please type your city instead"); setLocating(false); },
      { timeout: 10000 }
    );
  };
  const [aiEnabled, setAiEnabled] = useState(false);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [aiInsights, setAiInsights] = useState(null);
  const fileInputRef = useRef(null);
  const aiFileInputRef = useRef(null);

  useEffect(() => {
    client.get("/config").then((r) => setAiEnabled(Boolean(r.data.ai_enabled))).catch(() => setAiEnabled(false));
  }, []);

  const load = () => client.get("/policies").then((r) => {
    setPolicies(r.data.policies);
    // Keep an already-open details modal showing fresh data (e.g. right after
    // an "Analyze with AI" pass completes) instead of stale pre-analysis info.
    setDetailsPolicy((prev) => (prev ? r.data.policies.find((p) => p.id === prev.id) || prev : prev));
  }).catch((err) => notify(apiError(err)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // A document uploaded elsewhere (e.g. the Documents page) looked like a policy
  // we don't have on file yet - open the form pre-filled with whatever was found,
  // same as scanning a document directly in this form would do.
  useEffect(() => {
    if (!prefill) return;
    setForm({
      ...emptyForm,
      insurer_name: prefill.insurer_name || "",
      policy_number: prefill.policy_number || "",
      policy_type: prefill.policy_type || emptyForm.policy_type,
      sum_insured: prefill.sum_insured ? String(prefill.sum_insured) : "",
    });
    setTypeTouched(Boolean(prefill.policy_type));
    setScannedFrom(prefill.filename || null);
    setAiInsights(null);
    setShowForm(true);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const addPerson = () => setForm({ ...form, insured_people: [...form.insured_people, { name: "", relation: "", dob: "" }] });
  const updatePerson = (i, field, value) => {
    const people = form.insured_people.map((p, idx) => (idx === i ? { ...p, [field]: value } : p));
    setForm({ ...form, insured_people: people });
  };
  const removePerson = (i) => setForm({ ...form, insured_people: form.insured_people.filter((_, idx) => idx !== i) });

  const applyScanFields = (detected) => {
    // Only fill fields the person hasn't already typed something into - never
    // overwrite a manual entry with what the scan found.
    setForm((prev) => {
      const next = { ...prev };
      if (!prev.insurer_name.trim() && detected.insurer_name) next.insurer_name = detected.insurer_name;
      if (!prev.policy_number.trim() && detected.policy_number) next.policy_number = detected.policy_number;
      if (detected.policy_type && !typeTouched) next.policy_type = detected.policy_type;
      if (!String(prev.sum_insured).trim() && detected.sum_insured) next.sum_insured = String(detected.sum_insured);
      if (!prev.start_date && detected.start_date) next.start_date = detected.start_date;
      if (!prev.end_date && detected.end_date) next.end_date = detected.end_date;
      const noPeopleEnteredYet = prev.insured_people.every((p) => !p.name.trim());
      if (noPeopleEnteredYet && detected.insured_people?.length > 0) next.insured_people = detected.insured_people;
      return next;
    });
  };

  const applyAIScanFields = (detected) => {
    setForm((prev) => {
      const next = { ...prev };
      if (!prev.insurer_name.trim() && detected.insurer_name) next.insurer_name = detected.insurer_name;
      if (!prev.policy_number.trim() && detected.policy_number) next.policy_number = detected.policy_number;
      if (detected.policy_type && !typeTouched) next.policy_type = detected.policy_type;
      if (!String(prev.sum_insured).trim() && detected.sum_insured) next.sum_insured = String(detected.sum_insured);
      if (!prev.start_date && detected.start_date) next.start_date = detected.start_date;
      if (!prev.end_date && detected.end_date) next.end_date = detected.end_date;
      return next;
    });
    setAiInsights({
      maternity_cover: detected.maternity_cover,
      key_sub_limits: detected.key_sub_limits || [],
      key_exclusions: detected.key_exclusions || [],
      summary: detected.summary,
    });
  };

  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setScannedFrom(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await client.post("/policies/extract", formData, { headers: { "Content-Type": "multipart/form-data" } });
      const detected = res.data;
      applyScanFields(detected);
      const foundCount = ["insurer_name", "policy_number", "policy_type", "sum_insured", "start_date", "end_date"].filter((k) => detected[k]).length + (detected.insured_people?.length > 0 ? 1 : 0);
      setScannedFrom(file.name);
      notify(foundCount > 0 ? `Found ${foundCount} detail${foundCount === 1 ? "" : "s"} in ${file.name}` : `Couldn't detect policy details in ${file.name} - please fill them in manually`);
    } catch (err) { notify(apiError(err)); } finally { setScanning(false); }
  };

  const onAIFilePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAnalyzingAI(true);
    setAiInsights(null);
    setScannedFrom(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await client.post("/policies/extract-ai", formData, { headers: { "Content-Type": "multipart/form-data" } });
      applyAIScanFields(res.data);
      setScannedFrom(file.name);
      notify(`AI analysis complete for ${file.name}`);
    } catch (err) {
      if (err?.response?.status === 501) notify("AI analysis isn't set up on this server yet - use the standard scan instead");
      else notify(apiError(err));
    } finally { setAnalyzingAI(false); }
  };

  // Lets the person pick a document they've already uploaded (in the Documents
  // vault) to feed into scan/AI-analyze/retro-analyze, instead of being forced
  // to browse their computer again for a file that's already sitting in the app.
  const [docPicker, setDocPicker] = useState(null); // { purpose: 'scan' | 'ai' | 'retro-ai', policyId? }
  const [pickerDocuments, setPickerDocuments] = useState(null);
  const [pickerBusy, setPickerBusy] = useState(null);

  const openDocPicker = async (purpose, policyId) => {
    setDocPicker({ purpose, policyId });
    setPickerDocuments(null);
    try {
      const res = await client.get("/documents");
      const wantedTypes = purpose === "scan"
        ? ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]
        : ["application/pdf"];
      const docs = res.data.documents.filter((d) => wantedTypes.includes(d.content_type));
      // Policy documents the person tagged as such float to the top - most likely what they want here.
      docs.sort((a, b) => (b.category === "policy_document") - (a.category === "policy_document"));
      setPickerDocuments(docs);
    } catch (err) { notify(apiError(err)); setDocPicker(null); }
  };

  const pickDocument = async (doc) => {
    setPickerBusy(doc.id);
    try {
      if (docPicker.purpose === "scan") {
        const res = await client.post(`/policies/extract-from-document/${doc.id}`);
        const detected = res.data;
        applyScanFields(detected);
        const foundCount = ["insurer_name", "policy_number", "policy_type", "sum_insured", "start_date", "end_date"].filter((k) => detected[k]).length + (detected.insured_people?.length > 0 ? 1 : 0);
        setScannedFrom(doc.filename);
        notify(foundCount > 0 ? `Found ${foundCount} detail${foundCount === 1 ? "" : "s"} in ${doc.filename}` : `Couldn't detect policy details in ${doc.filename} - please fill them in manually`);
      } else if (docPicker.purpose === "ai") {
        const res = await client.post(`/policies/extract-ai-from-document/${doc.id}`);
        applyAIScanFields(res.data);
        setScannedFrom(doc.filename);
        notify(`AI analysis complete for ${doc.filename}`);
      } else if (docPicker.purpose === "retro-ai") {
        const res = await client.post(`/policies/extract-ai-from-document/${doc.id}`);
        const { source, ...insights } = res.data;
        await client.put(`/policies/${docPicker.policyId}`, { ai_insights: insights });
        notify("AI analysis added to this policy");
        load();
      }
      setDocPicker(null);
    } catch (err) {
      if (err?.response?.status === 501) notify("AI analysis isn't set up on this server yet");
      else notify(apiError(err));
    } finally { setPickerBusy(null); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await client.post("/policies", {
        ...form,
        sum_insured: Number(form.sum_insured),
        insured_people: form.insured_people.filter((p) => p.name.trim()),
        ai_insights: aiInsights || null,
      });
      notify("Policy added");
      setForm(emptyForm);
      setTypeTouched(false);
      setScannedFrom(null);
      setAiInsights(null);
      setShowForm(false);
      load();
    } catch (err) { notify(apiError(err)); } finally { setBusy(false); }
  };

  const remove = async (id) => {
    try { await client.delete(`/policies/${id}`); notify("Policy removed"); load(); }
    catch (err) { notify(apiError(err)); }
  };

  if (policies === null) return <div className="page-loading" data-testid="policies-loading">Loading policies…</div>;

  return (
    <section className="page-section" data-testid="policies-page">
      <div className="section-heading">
        <div><p className="eyebrow">COVERAGE</p><h2 data-testid="policies-heading">Policies &amp; people</h2></div>
        {canEdit && <button className="primary-button" data-testid="add-policy-button" onClick={() => { setForm(emptyForm); setTypeTouched(false); setScannedFrom(null); setAiInsights(null); setShowForm(true); }}><Plus size={16} /> Add policy</button>}
      </div>

      {policies.length === 0 ? (
        <div className="empty-hint" data-testid="policies-empty">No policies yet. Add your Mediclaim or home insurance policy to get started.</div>
      ) : (
        <div className="card-grid" data-testid="policies-list">
          {policies.map((p) => (
            <article
              className="entry policy-card policy-card-clickable"
              key={p.id}
              data-testid={`policy-${p.id}`}
              role="button"
              tabIndex={0}
              onClick={() => openDetails(p)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetails(p); } }}
            >
              <header>
                <span className="claim-icon" style={{ width: 36, height: 36 }}><BookOpen size={16} /></span>
                <div style={{ flex: 1 }}>
                  <strong>{p.insurer_name}</strong>
                  <small style={{ display: "block" }}>{p.policy_number} · {p.policy_type}</small>
                </div>
                {canEdit && (
                  <button
                    className="icon-button" aria-label="Remove policy" data-testid={`remove-policy-${p.id}`}
                    onClick={(e) => { e.stopPropagation(); remove(p.id); }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </header>
              <p><em>Sum insured:</em> ₹{Number(p.sum_insured).toLocaleString("en-IN")}</p>
              <p><em>Valid:</em> {p.start_date} to {p.end_date}</p>
              {p.insured_people?.length > 0 && (
                <p><em><Users size={12} style={{ verticalAlign: -2 }} /> Covered:</em> {p.insured_people.map((person) => person.name).join(", ")}</p>
              )}

              {!p.ai_insights && aiEnabled && canEdit && (
                <input
                  ref={(el) => { retroAiInputRefs.current[p.id] = el; }}
                  type="file" hidden accept=".pdf"
                  onChange={(e) => onRetroAnalyze(p.id, e)}
                  data-testid={`retro-ai-input-${p.id}`}
                />
              )}

              <button
                type="button"
                className="text-button policy-view-details-button"
                style={{ marginTop: 10 }}
                data-testid={`view-details-${p.id}`}
                onClick={(e) => { e.stopPropagation(); openDetails(p); }}
              >
                <ShieldQuestion size={13} /> View details <ArrowUpRight size={13} />
              </button>
            </article>
          ))}
        </div>
      )}

      {detailsPolicy && (
        <div className="modal-backdrop" data-testid="policy-details-modal">
          <div className="modal" style={{ width: "min(600px, 100%)", maxHeight: "88vh", overflow: "auto" }}>
            <button className="close-button" aria-label="Close" onClick={() => setDetailsPolicy(null)} data-testid="close-policy-details-modal-button"><X size={18} /></button>
            <p className="eyebrow">POLICY DETAILS</p>
            <h2>{detailsPolicy.insurer_name}</h2>
            <p className="readonly-hint" style={{ margin: "4px 0 18px" }}>{detailsPolicy.policy_number} · {detailsPolicy.policy_type}</p>

            {/* Basic details - always available, no AI required */}
            <div className="entry" style={{ marginBottom: 12 }} data-testid="policy-basic-details">
              <p><em>Sum insured:</em> ₹{Number(detailsPolicy.sum_insured).toLocaleString("en-IN")}</p>
              <p><em>Valid:</em> {detailsPolicy.start_date} to {detailsPolicy.end_date}</p>
              {detailsPolicy.insured_people?.length > 0 && (
                <p>
                  <em><Users size={12} style={{ verticalAlign: -2 }} /> Covered people:</em>{" "}
                  {detailsPolicy.insured_people.map((person) => `${person.name}${person.relation ? ` (${person.relation})` : ""}`).join(", ")}
                </p>
              )}
            </div>

            <div className="stack-form" style={{ marginBottom: 18 }}>
              <button
                type="button" className="text-button" data-testid="details-find-hospitals-button"
                onClick={() => { setHospitalPolicy(detailsPolicy); setHospitalCity(""); setHospitalResult(null); }}
              >
                <MapPin size={13} /> Find network hospitals
              </button>

              {!detailsPolicy.ai_insights && aiEnabled && canEdit && (
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <button
                    type="button" className="text-button" disabled={retroAnalyzing === detailsPolicy.id}
                    data-testid="details-analyze-ai-button"
                    onClick={() => retroAiInputRefs.current[detailsPolicy.id]?.click()}
                  >
                    <Sparkles size={13} /> {retroAnalyzing === detailsPolicy.id ? "Analyzing…" : "Analyze with AI ✨"}
                  </button>
                  <button
                    type="button" className="text-button"
                    data-testid="details-analyze-ai-from-vault-button"
                    onClick={() => openDocPicker("retro-ai", detailsPolicy.id)}
                  >
                    <FileText size={13} /> Choose from Documents
                  </button>
                </div>
              )}
            </div>

            {!detailsPolicy.ai_insights && (
              <div className="empty-hint" data-testid="details-no-ai-yet" style={{ marginBottom: 18 }}>
                {aiEnabled
                  ? "No AI analysis yet for this policy. Analyze it to see maternity cover, sub-limits, exclusions, waiting periods, and personalized benefits below."
                  : "AI analysis isn't set up on this server yet, so coverage breakdowns and benefits aren't available - basic details above are still accurate."}
              </div>
            )}

            {detailsPolicy.ai_insights?.summary && (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 18px", lineHeight: 1.5 }}>{detailsPolicy.ai_insights.summary}</p>
            )}

            {detailsPolicy.ai_insights && (() => {
              const insights = detailsPolicy.ai_insights || {};
              const hasPreExisting = insights.pre_existing_disease_waiting_months != null;
              const hasNamedConditions = insights.waiting_periods?.length > 0;
              const hasExclusions = insights.key_exclusions?.length > 0;
              const hasNothing = !hasPreExisting && !hasNamedConditions && !hasExclusions;

              if (hasNothing) {
                return (
                  <div className="empty-hint" data-testid="coverage-nothing-extracted" style={{ marginBottom: 18 }}>
                    This document didn't have enough detail for a full breakdown - it may be a policy schedule or renewal letter rather than the complete terms &amp; conditions wording (insurers usually issue that as a separate document). You can still search for a specific condition below, or try analyzing the fuller policy wording document if you have it.
                  </div>
                );
              }

              return (
                <>
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="pre-existing-waiting-section">
                    <strong style={{ fontSize: 12 }}>Pre-existing disease waiting period</strong>
                    {hasPreExisting ? (
                      <p style={{ fontSize: 12, margin: "6px 0 0" }}>
                        {insights.pre_existing_disease_waiting_months} months.{" "}
                        {insights.pre_existing_disease_waiting_status?.covered_now === true && <span className="chip chip-teal">Has passed</span>}
                        {insights.pre_existing_disease_waiting_status?.covered_now === false && <span className="chip chip-amber">{insights.pre_existing_disease_waiting_status.days_remaining} days left</span>}
                      </p>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>Not stated in what we could extract from this document.</p>
                    )}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <p className="eyebrow" style={{ marginBottom: 8 }}>NAMED CONDITIONS</p>
                    {hasNamedConditions ? (
                      <div className="entry-list">
                        {insights.waiting_periods.map((w, i) => (
                          <article className="entry" key={i} data-testid={`waiting-period-${i}`}>
                            <header>
                              <div style={{ flex: 1 }}><strong>{w.condition}</strong></div>
                              {w.waiting_status?.covered_now === true && <span className="chip chip-teal">Covered now</span>}
                              {w.waiting_status?.covered_now === false && <span className="chip chip-amber">{w.waiting_status.days_remaining} days left</span>}
                              {!w.covered && <span className="chip chip-red">Not covered</span>}
                            </header>
                            {w.notes && <p style={{ fontSize: 11, margin: "4px 0 0" }}>{w.notes}</p>}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--muted)" }}>No specific conditions with their own waiting periods were found in this document.</p>
                    )}
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <p className="eyebrow" style={{ marginBottom: 8 }}>KEY EXCLUSIONS</p>
                    {hasExclusions ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                        {insights.key_exclusions.map((ex, i) => <li key={i} style={{ marginBottom: 4 }}>{ex}</li>)}
                      </ul>
                    ) : (
                      <p style={{ fontSize: 11, color: "var(--muted)" }}>No exclusions were listed in what we could extract from this document.</p>
                    )}
                  </div>
                </>
              );
            })()}

            <div className="stack-form" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <label>Or search for a specific condition
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={conditionQuery} onChange={(e) => setConditionQuery(e.target.value)} placeholder="e.g. knee replacement, cataract, maternity" style={{ flex: 1 }} data-testid="condition-query-input" />
                  <button
                    type="button" className="primary-button" style={{ padding: "10px 14px" }} disabled={conditionChecking || !conditionQuery.trim()}
                    data-testid="check-condition-button"
                    onClick={async () => {
                      setConditionChecking(true);
                      try {
                        const res = await client.get(`/policies/${detailsPolicy.id}/check-condition`, { params: { condition: conditionQuery } });
                        setConditionResult(res.data);
                      } catch (err) { notify(apiError(err)); } finally { setConditionChecking(false); }
                    }}
                  >
                    {conditionChecking ? "Checking…" : "Check"}
                  </button>
                </div>
              </label>

              {conditionResult && (
                <div className={conditionResult.matched ? "ai-insights-panel" : "empty-hint"} data-testid="condition-result-panel">
                  {conditionResult.matched ? (
                    <>
                      <p className="ai-insights-row"><strong>{conditionResult.condition}:</strong>{" "}
                        {conditionResult.covered ? (
                          conditionResult.waiting_status.covered_now === true ? (
                            <span className="chip chip-teal">Covered now - waiting period has passed</span>
                          ) : conditionResult.waiting_status.covered_now === false ? (
                            <span className="chip chip-amber">Waiting period active - {conditionResult.waiting_status.days_remaining} days left</span>
                          ) : (
                            <span className="chip chip-neutral">Covered - no waiting period stated</span>
                          )
                        ) : <span className="chip chip-red">Not covered</span>}
                      </p>
                      {conditionResult.notes && <p style={{ fontSize: 11, color: "var(--muted)" }}>{conditionResult.notes}</p>}
                    </>
                  ) : (
                    <p style={{ fontSize: 12 }}>{conditionResult.message}</p>
                  )}
                </div>
              )}
            </div>

            {/* Benefits - what you're actually eligible to use right now, based on this policy's own document */}
            {detailsPolicy.benefits && Object.keys(detailsPolicy.benefits).length > 0 && (
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginTop: 4 }}>
                <p className="eyebrow" style={{ marginBottom: 8 }}>MAXIMIZE THIS POLICY</p>

                {detailsPolicy.benefits.health_checkup && (
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="benefit-health-checkup">
                    <header>
                      <div style={{ flex: 1 }}><strong>Free annual health checkup</strong></div>
                      {detailsPolicy.benefits.health_checkup.eligible_now === true && <span className="chip chip-teal">Eligible now</span>}
                      {detailsPolicy.benefits.health_checkup.eligible_now === false && <span className="chip chip-amber">Next eligible {detailsPolicy.benefits.health_checkup.next_eligible_date}</span>}
                    </header>
                    {detailsPolicy.benefits.health_checkup.notes && <p style={{ fontSize: 12, margin: "6px 0 8px" }}>{detailsPolicy.benefits.health_checkup.notes}</p>}
                    {detailsPolicy.benefits.health_checkup.last_used_date && (
                      <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 8px" }}>Last logged as used: {detailsPolicy.benefits.health_checkup.last_used_date}</p>
                    )}
                    {canEdit && (
                      <button type="button" className="text-button" disabled={loggingCheckup} onClick={() => logCheckupUsed(detailsPolicy.id)} data-testid="log-checkup-used-button">
                        <Check size={13} /> {loggingCheckup ? "Saving…" : "I used this today"}
                      </button>
                    )}
                  </div>
                )}

                {detailsPolicy.benefits.restoration_benefit && (
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="benefit-restoration">
                    <header>
                      <div style={{ flex: 1 }}><strong>Restoration benefit</strong></div>
                      {detailsPolicy.benefits.restoration_benefit.relevant_now && <span className="chip chip-amber">Your sum insured looks exhausted - relevant now</span>}
                    </header>
                    {detailsPolicy.benefits.restoration_benefit.notes && <p style={{ fontSize: 12, margin: "6px 0 0" }}>{detailsPolicy.benefits.restoration_benefit.notes}</p>}
                  </div>
                )}

                {detailsPolicy.benefits.no_claim_bonus && (
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="benefit-ncb">
                    <strong style={{ fontSize: 13 }}>No-claim bonus</strong>
                    {detailsPolicy.benefits.no_claim_bonus.notes && <p style={{ fontSize: 12, margin: "6px 0 0" }}>{detailsPolicy.benefits.no_claim_bonus.notes}</p>}
                  </div>
                )}

                {detailsPolicy.benefits.newly_usable_conditions?.length > 0 && (
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="benefit-newly-usable">
                    <strong style={{ fontSize: 13 }}>Already usable - waiting periods have passed</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                      {detailsPolicy.benefits.newly_usable_conditions.map((cond, i) => <li key={i}>{cond}</li>)}
                    </ul>
                  </div>
                )}

                {detailsPolicy.benefits.other_benefits?.length > 0 && (
                  <div className="entry" style={{ marginBottom: 12 }} data-testid="benefit-other">
                    <strong style={{ fontSize: 13 }}>Other included benefits &amp; services</strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                      {detailsPolicy.benefits.other_benefits.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}

                {detailsPolicy.benefits.renewal_reminder && (
                  <div className="attention-strip" data-testid="benefit-renewal-reminder">
                    <div className="attention-icon"><ShieldQuestion size={20} /></div>
                    <div><strong>Renewing soon</strong><span>{detailsPolicy.benefits.renewal_reminder}</span></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {hospitalPolicy && (
        <div className="modal-backdrop" data-testid="network-hospitals-modal">
          <div className="modal" style={{ width: "min(440px, 100%)" }}>
            <button className="close-button" aria-label="Close" onClick={() => setHospitalPolicy(null)} data-testid="close-hospitals-modal-button"><X size={18} /></button>
            <p className="eyebrow">NETWORK HOSPITALS</p>
            <h2>{hospitalPolicy.insurer_name}</h2>
            <div className="stack-form">
              <label>Your city (optional)
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={hospitalCity} onChange={(e) => setHospitalCity(e.target.value)} placeholder="e.g. Pune" data-testid="hospital-city-input" style={{ flex: 1 }} />
                  <button type="button" className="text-button" style={{ margin: 0, whiteSpace: "nowrap" }} disabled={locating} onClick={useMyLocation} data-testid="use-my-location-button">
                    <MapPin size={13} /> {locating ? "Locating…" : "Use my location"}
                  </button>
                </div>
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={hospitalLoading}
                data-testid="search-hospitals-button"
                onClick={async () => {
                  setHospitalLoading(true);
                  try {
                    const res = await client.get(`/policies/${hospitalPolicy.id}/network-hospitals`, { params: { city: hospitalCity || undefined } });
                    setHospitalResult(res.data);
                  } catch (err) { notify(apiError(err)); } finally { setHospitalLoading(false); }
                }}
              >
                {hospitalLoading ? "Looking…" : "Find hospitals"}
              </button>

              {hospitalResult && (
                <div className="ai-insights-panel" data-testid="hospital-result-panel">
                  <p className="ai-insights-summary">{hospitalResult.note}</p>
                  <a href={hospitalResult.locator_url} target="_blank" rel="noopener noreferrer" className="text-button" data-testid="open-hospital-locator-link" onClick={() => setHospitalPolicy(null)}>
                    Open {hospitalResult.matched ? `${hospitalResult.insurer_name}'s official site` : "search results"} <ArrowUpRight size={13} />
                  </a>
                  <p style={{ fontSize: 10, color: "var(--muted)", marginTop: 10 }}>{hospitalResult.disclaimer}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" data-testid="add-policy-modal">
          <div className="modal" style={{ width: "min(560px, 100%)" }}>
            <button className="close-button" aria-label="Close" onClick={() => setShowForm(false)} data-testid="close-policy-modal-button"><X size={18} /></button>
            <p className="eyebrow">NEW POLICY</p>
            <h2>Add a policy</h2>
            <input ref={fileInputRef} type="file" hidden onChange={onFilePicked} accept=".pdf,.docx,.txt" data-testid="policy-scan-input" />
            <button
              type="button"
              className="scan-upload-button"
              disabled={scanning}
              onClick={() => fileInputRef.current?.click()}
              data-testid="scan-policy-document-button"
            >
              {scanning ? <FileScan size={16} className="spin-icon" /> : <Upload size={16} />}
              <span>
                <strong>{scanning ? "Reading document…" : "Scan a policy document"}</strong>
                <small>{scannedFrom ? `Last scanned: ${scannedFrom}` : "PDF, Word, or text - we'll fill in what we can find"}</small>
              </span>
            </button>
            <button
              type="button" className="text-button" style={{ marginTop: -6, marginBottom: 14 }}
              data-testid="scan-from-vault-button"
              onClick={() => openDocPicker("scan")}
            >
              <FileText size={13} /> Already uploaded it? Choose from Documents
            </button>

            {aiEnabled && (
              <>
                <input ref={aiFileInputRef} type="file" hidden onChange={onAIFilePicked} accept=".pdf" data-testid="policy-ai-scan-input" />
                <button
                  type="button"
                  className="scan-upload-button ai-scan-button"
                  disabled={analyzingAI}
                  onClick={() => aiFileInputRef.current?.click()}
                  data-testid="analyze-policy-ai-button"
                >
                  {analyzingAI ? <Sparkles size={16} className="spin-icon" /> : <Sparkles size={16} />}
                  <span>
                    <strong>{analyzingAI ? "Analyzing with AI…" : "Analyze with AI ✨"}</strong>
                    <small>PDF only - also finds maternity caps, sub-limits, and key exclusions. Sends this document to Google's Gemini API.</small>
                  </span>
                </button>
                <button
                  type="button" className="text-button" style={{ marginTop: -6, marginBottom: 14 }}
                  data-testid="analyze-ai-from-vault-button"
                  onClick={() => openDocPicker("ai")}
                >
                  <FileText size={13} /> Already uploaded it? Choose from Documents
                </button>
              </>
            )}

            {aiInsights && (
              <div className="ai-insights-panel" data-testid="ai-insights-panel">
                <p className="ai-insights-label"><Sparkles size={12} /> AI-generated — always verify against your actual policy document</p>
                {aiInsights.summary && <p className="ai-insights-summary">{aiInsights.summary}</p>}
                {aiInsights.maternity_cover && (
                  <div className="ai-insights-row">
                    <strong>Maternity cover:</strong>{" "}
                    {aiInsights.maternity_cover.covered ? (
                      <span>
                        Covered{aiInsights.maternity_cover.cap_amount ? `, capped at ₹${Number(aiInsights.maternity_cover.cap_amount).toLocaleString("en-IN")}` : ""}
                        {aiInsights.maternity_cover.waiting_period_months ? ` after a ${aiInsights.maternity_cover.waiting_period_months}-month waiting period` : ""}.
                        {aiInsights.maternity_cover.notes && <small style={{ display: "block" }}>{aiInsights.maternity_cover.notes}</small>}
                      </span>
                    ) : <span>Not covered under this policy, per the document.</span>}
                  </div>
                )}
                {aiInsights.key_sub_limits?.length > 0 && (
                  <div className="ai-insights-row">
                    <strong>Other sub-limits:</strong>
                    <ul>{aiInsights.key_sub_limits.map((s, i) => <li key={i}>{s.name}: {s.cap_description}</li>)}</ul>
                  </div>
                )}
                {aiInsights.key_exclusions?.length > 0 && (
                  <div className="ai-insights-row">
                    <strong>Key exclusions:</strong>
                    <ul>{aiInsights.key_exclusions.map((ex, i) => <li key={i}>{ex}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={submit} className="stack-form" data-testid="policy-form">
              <div className="row-2">
                <label>Insurer name<input required value={form.insurer_name} onChange={(e) => setForm({ ...form, insurer_name: e.target.value })} placeholder="Star Health" data-testid="policy-insurer-input" /></label>
                <label>Policy number<input required value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} placeholder="SH-2026-00123" data-testid="policy-number-input" /></label>
              </div>
              <div className="row-2">
                <label>Type<select value={form.policy_type} onChange={(e) => { setForm({ ...form, policy_type: e.target.value }); setTypeTouched(true); }} data-testid="policy-type-select"><option value="Health">Health</option><option value="Mediclaim">Mediclaim</option><option value="Home">Home</option></select></label>
                <label>Sum insured (₹)<input required type="number" min="1" value={form.sum_insured} onChange={(e) => setForm({ ...form, sum_insured: e.target.value })} placeholder="500000" data-testid="policy-sum-insured-input" /></label>
              </div>
              <div className="row-2">
                <label>Start date<input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} data-testid="policy-start-date-input" /></label>
                <label>End date<input required type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} data-testid="policy-end-date-input" /></label>
              </div>
              <div>
                <label style={{ marginBottom: 8, display: "block" }}>Insured people</label>
                {form.insured_people.map((p, i) => (
                  <div className="row-2" key={i} style={{ marginBottom: 8 }}>
                    <input value={p.name} onChange={(e) => updatePerson(i, "name", e.target.value)} placeholder="Name" data-testid={`insured-name-${i}`} />
                    <input value={p.relation} onChange={(e) => updatePerson(i, "relation", e.target.value)} placeholder="Relation" data-testid={`insured-relation-${i}`} />
                    <button type="button" className="icon-button" aria-label="Remove person" onClick={() => removePerson(i)} data-testid={`remove-insured-${i}`}><X size={14} /></button>
                  </div>
                ))}
                <button type="button" className="quiet-button" onClick={addPerson} data-testid="add-insured-person-button"><Plus size={13} /> Add person</button>
              </div>
              <button className="primary-button" disabled={busy} data-testid="submit-policy-button">{busy ? "Saving…" : "Save policy"}</button>
            </form>
          </div>
        </div>
      )}

      {docPicker && (
        <div className="modal-backdrop" data-testid="document-picker-modal">
          <div className="modal" style={{ width: "min(480px, 100%)", maxHeight: "80vh", overflow: "auto" }}>
            <button className="close-button" aria-label="Close" onClick={() => setDocPicker(null)} data-testid="close-document-picker-button"><X size={18} /></button>
            <p className="eyebrow">CHOOSE A DOCUMENT</p>
            <h2>Pick from your uploads</h2>
            <p className="readonly-hint" style={{ margin: "6px 0 16px" }}>
              {docPicker.purpose === "ai" || docPicker.purpose === "retro-ai"
                ? "PDFs you've already uploaded to Documents - pick one to analyze with AI."
                : "Documents you've already uploaded - pick one to scan for policy details."}
            </p>

            {pickerDocuments === null ? (
              <div className="page-loading" data-testid="document-picker-loading">Loading your documents…</div>
            ) : pickerDocuments.length === 0 ? (
              <div className="empty-hint" data-testid="document-picker-empty">
                No matching documents found in your Documents vault yet. Upload one there first, or use the file picker instead.
              </div>
            ) : (
              <div className="entry-list" data-testid="document-picker-list">
                {pickerDocuments.map((doc) => (
                  <article className="entry" key={doc.id} data-testid={`document-picker-item-${doc.id}`}>
                    <header>
                      <span className="claim-icon" style={{ width: 30, height: 30 }}><FileText size={14} /></span>
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: 12 }}>{doc.filename}</strong>
                        <small style={{ display: "block" }}>
                          {doc.category === "policy_document" ? "Policy document" : "Other document"} · {new Date(doc.uploaded_at).toLocaleDateString("en-IN")}
                        </small>
                      </div>
                      <button
                        type="button" className="text-button" disabled={pickerBusy === doc.id}
                        data-testid={`document-picker-use-${doc.id}`}
                        onClick={() => pickDocument(doc)}
                      >
                        {pickerBusy === doc.id ? "Working…" : "Use this"}
                      </button>
                    </header>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
