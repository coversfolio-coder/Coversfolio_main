import { useEffect, useRef, useState } from "react";
import client, { apiError } from "@/api";
import {
  Bell, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck,
  FileText, Home, LayoutDashboard, LifeBuoy, LogOut, Menu, Plus, Search, Settings, ShieldCheck,
  Stethoscope, Upload, User as UserIcon, Users, X, UserPlus, UserX, History
} from "lucide-react";
import "@/App.css";
import "@/Auth.css";
import "@/Members.css";
import "@/ClaimDetail.css";
import ClaimDetail from "@/ClaimDetail";
import PoliciesPage from "@/PoliciesPage";
import EvidencePage from "@/EvidencePage";
import DocumentsPage from "@/DocumentsPage";


const navItems = [
  { label: "Claim packets", icon: LayoutDashboard, id: "workspace" },
  { label: "Policies & people", icon: ShieldCheck, id: "policies" },
  { label: "Evidence & Inventory", icon: Home, id: "evidence" },
  { label: "Documents", icon: FileText, id: "documents" },
];

function formatINR(n) {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  return `₹${v.toLocaleString("en-IN")}`;
}

const fallback = {
  household: { name: "Your household", city: "", members: 1, active_policies: 0 },
  claims: [],
  attention: [],
  deadlines: [],
  policies: [],
  onboarding: { steps: [], all_done: true, dismissed: true },
  kpis: { active_policies: 0, insurer_count: 0, total_sum_insured: 0, packets_in_progress: 0, overdue_sla_count: 0 }
};

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

function GoogleSignInButton({ onAuthenticated, onError, consentGiven }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const handleCredential = async (response) => {
      try {
        const result = await client.post("/auth/google", { credential: response.credential, consent_given: consentGiven });
        onAuthenticated(result.data);
      } catch (err) { onError(apiError(err)); }
    };

    // The Google script is loaded via a <script> tag in public/index.html and may
    // still be loading on first render, so poll briefly rather than assuming it's ready.
    let cancelled = false;
    const tryInit = () => {
      if (cancelled) return;
      if (window.google?.accounts?.id && buttonRef.current) {
        window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
        window.google.accounts.id.renderButton(buttonRef.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
      } else {
        setTimeout(tryInit, 200);
      }
    };
    tryInit();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;
  return <div className="google-button-mount" ref={buttonRef} data-testid="google-signin-button" />;
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = mode === "register" ? { ...form, consent_given: consent } : form;
      const response = await client.post(`/auth/${mode}`, payload);
      onAuthenticated(response.data);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  return <div className="auth-shell" data-testid="auth-screen"><div className="auth-panel"><div className="brand auth-brand"><img className="brand-icon" src="/brand-icon.png" alt="Coversfolio" /><span><span className="brand-covers">Covers</span><span className="brand-folio">folio</span></span></div><div className="auth-copy"><p className="eyebrow">PRIVATE CLAIM COMPANION</p><h1>{mode === "login" ? "Welcome back." : "Create your household."}</h1><p>Keep your claim file clear, together, and in your hands.</p></div>{mode === "login" || consent ? <GoogleSignInButton onAuthenticated={onAuthenticated} onError={setError} consentGiven={mode === "login" || consent} /> : <p className="empty-hint" data-testid="google-consent-gate" style={{ marginBottom: 8 }}>Check the box below to continue with Google.</p>}{GOOGLE_CLIENT_ID && <div className="auth-divider" data-testid="auth-divider"><span>or with your email</span></div>}<form onSubmit={submit} data-testid="auth-form">{mode === "register" && <label data-testid="name-field">Your name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Riya Mehta" /></label>}<label data-testid="email-field">Email address<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label><label data-testid="password-field">Password<input required minLength="8" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8 characters minimum" /></label>{mode === "register" && <label style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row", fontSize: 11 }} data-testid="consent-field"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: "auto", marginTop: 2 }} data-testid="consent-checkbox" />I agree to the Privacy Policy and Terms of Service</label>}{error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}<button className="primary-button auth-submit" disabled={busy || (mode === "register" && !consent)} data-testid="auth-submit-button">{busy ? "Checking…" : mode === "login" ? "Sign in securely" : "Create account"}</button></form><button className="auth-switch" data-testid="auth-mode-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New here? Create a household" : "Already have an account? Sign in"}</button><div className="auth-assurance" data-testid="auth-assurance"><ShieldCheck size={17} /><span><strong>Your files are private</strong><small>Secure session · household access only</small></span></div></div><div className="auth-art"><div><span>01</span><h2>A calmer way<br />through a claim.</h2><p>Organise evidence, understand the next step, and keep every decision yours.</p></div></div></div>;
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

function Avatar({ user, size = "small" }) {
  const cls = size === "large" ? "avatar avatar-large" : "avatar avatar-small";
  if (user?.picture) return <img className={cls} src={user.picture} alt={user.name || "Account"} referrerPolicy="no-referrer" data-testid="account-avatar-image" />;
  return <span className={cls} data-testid="account-avatar-initials">{initials(user?.name)}</span>;
}

function AccountMenu({ user, onManageAccess, onSignOut, onSupport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const roleLabel = user.role === "owner" ? "Household owner" : user.role === "agent" ? "Read-only agent" : "Household member";
  return (
    <div className="account-menu-wrap" ref={ref}>
      <button className="account-trigger" onClick={() => setOpen(v => !v)} aria-haspopup="menu" aria-expanded={open} data-testid="account-menu-trigger">
        <Avatar user={user} />
        <span className="account-trigger-name">{user.name?.split(" ")[0] || "Account"}</span>
        <ChevronRight size={14} className={open ? "chev open" : "chev"} />
      </button>
      {open && (
        <div className="account-menu" role="menu" data-testid="account-menu">
          <header className="account-menu-header">
            <Avatar user={user} size="large" />
            <div><strong>{user.name}</strong><small>{user.email}</small><span className="account-role">{roleLabel}</span></div>
          </header>
          <div className="account-menu-meta"><ShieldCheck size={13} /><span>Signed in with email</span></div>
          <div className="account-menu-list">
            {user.role === "owner" && (
              <button role="menuitem" onClick={() => { setOpen(false); onManageAccess(); }} data-testid="account-menu-manage-access"><Settings size={15} /><span>Manage household access</span></button>
            )}
            <button role="menuitem" onClick={() => { setOpen(false); onSupport(); }} data-testid="account-menu-support"><LifeBuoy size={15} /><span>Support centre</span></button>
            <button role="menuitem" className="danger" onClick={() => { setOpen(false); onSignOut(); }} data-testid="account-menu-signout"><LogOut size={15} /><span>Sign out</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [data, setData] = useState(fallback);
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [active, setActive] = useState("workspace");
  const [policyPrefill, setPolicyPrefill] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newClaimPolicyId, setNewClaimPolicyId] = useState("");
  const [toast, setToast] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [members, setMembers] = useState({ members: [], invites: [] });
  const [activity, setActivity] = useState([]);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "member" });
  const [openClaimId, setOpenClaimId] = useState(null);
  const canEdit = user && user.role !== "agent";

  // The browser's back button previously had nothing to step back through -
  // section switches and opening a claim never touched browser history, so
  // pressing back immediately left the app instead of just closing a modal or
  // returning to the previous section. This keeps a matching history entry for
  // each in-app "screen" so back/forward behaves the way people expect.
  const isPoppingRef = useRef(false);
  const navigate = (view, claimId = null) => {
    setActive(view);
    setOpenClaimId(claimId);
    if (!isPoppingRef.current) {
      window.history.pushState({ view, claimId }, "");
    }
  };
  const openClaim = (claimId) => {
    setOpenClaimId(claimId);
    if (!isPoppingRef.current) {
      window.history.pushState({ view: active, claimId }, "");
    }
  };
  useEffect(() => {
    window.history.replaceState({ view: "workspace", claimId: null }, "");
    const onPopState = (event) => {
      isPoppingRef.current = true;
      const state = event.state || { view: "workspace", claimId: null };
      setActive(state.view);
      setOpenClaimId(state.claimId || null);
      // Reset on next tick, after the resulting re-render has happened, so a
      // subsequent user-initiated navigate() still pushes its own entry.
      setTimeout(() => { isPoppingRef.current = false; }, 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDashboard = () => { if (user) client.get(`/dashboard`).then(r => setData(r.data)).catch(() => {}); };
  const signOut = async () => { try { await client.post(`/auth/logout`, {}); } catch (err) {} setUser(false); setData(fallback); setOpenClaimId(null); setShowMembers(false); };
  useEffect(() => {
    client.get(`/auth/me`).then(r => setUser(r.data)).catch(() => setUser(false)).finally(() => setAuthChecking(false));
  }, []);
  useEffect(() => { if (user && active === "workspace") client.get(`/dashboard`).then(r => setData(r.data)).catch(() => {}); }, [user, active]);
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(""), 2800); };
  const openMembers = async () => { setShowMembers(true); try { const [people, history] = await Promise.all([client.get(`/household/members`), client.get(`/household/activity`)]); setMembers(people.data); setActivity(history.data.events); } catch (err) { notify(apiError(err)); } };
  const inviteMember = async (event) => { event.preventDefault(); try { const response = await client.post(`/household/invites`, inviteForm); setMembers({ ...members, invites: [response.data, ...members.invites] }); setInviteForm({ email: "", role: "member" }); notify("Invitation link ready to share"); } catch (err) { notify(apiError(err)); } };
  const revokeMember = async (id) => { try { await client.delete(`/household/members/${id}`); setMembers({ ...members, members: members.members.map(item => item.id === id ? { ...item, status: "revoked" } : item) }); notify("Access revoked"); } catch (err) { notify(apiError(err)); } };
  const revokeInvite = async (id) => { try { await client.delete(`/household/invites/${id}`); setMembers({ ...members, invites: members.invites.filter(item => item.id !== id) }); notify("Invitation revoked"); } catch (err) { notify(apiError(err)); } };

  if (authChecking) return <div className="auth-loading" data-testid="auth-loading"><ShieldCheck size={24} />Loading your secure workspace…</div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return <div className="app-shell">
    <aside className="sidebar" data-testid="primary-sidebar">
      <div className="brand" data-testid="brand-mark"><img className="brand-icon" src="/brand-icon.png" alt="Coversfolio" /><span><span className="brand-covers">Covers</span><span className="brand-folio">folio</span></span></div>
      <div className="household-switcher" data-testid="household-switcher"><span className="avatar">M</span><span><small>HOUSEHOLD</small><strong>{data.household.name}</strong></span><ChevronRight size={15} /></div>
      <nav className="nav-list" data-testid="main-navigation">{navItems.map(({ label, icon: Icon, id }) => <button key={id} data-testid={`nav-${id}`} className={active === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span></button>)}<button className="nav-item" data-testid="nav-household" onClick={openMembers}><Users size={18} /><span>Household</span></button></nav>
      <div className="sidebar-bottom"><button className="nav-item" data-testid="nav-support" onClick={() => notify("Support centre is ready for your questions")}><LifeBuoy size={18} /><span>Support centre</span></button><div className="privacy-note" data-testid="privacy-note"><ShieldCheck size={17} /><span><strong>Your files stay private</strong><small>Encrypted and only shared by you</small></span></div><button className="profile" data-testid="sidebar-profile" onClick={() => document.querySelector('[data-testid="account-menu-trigger"]')?.click()}><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.role === "owner" ? "Household owner" : user.role === "agent" ? "Read-only agent" : "Household member"}</small></span><Menu size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="crumbs" data-testid="page-breadcrumb"><span>My household</span><ChevronRight size={14} /><strong>{navItems.find(n => n.id === active)?.label || "Claim workspace"}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Search" data-testid="search-button" onClick={() => notify("Search across your claim file")}><Search size={19} /></button><button className="icon-button notification" aria-label="Notifications" data-testid="notifications-button" onClick={() => notify(data.attention.length > 0 ? `You have ${data.attention.length} item${data.attention.length === 1 ? "" : "s"} needing attention` : "You're all caught up")}><Bell size={19} /><i /></button><AccountMenu user={user} onManageAccess={openMembers} onSignOut={signOut} onSupport={() => notify("Support centre is ready for your questions")} /></div></header>
      <div className="content-wrap">
        {active === "workspace" && <>
        <section className="welcome-row"><div><p className="eyebrow" data-testid="workspace-eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</p><h1 data-testid="workspace-title">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user.name?.split(" ")[0] || "there"}<span className="title-accent">.</span></h1><p className="lede" data-testid="workspace-subtitle">One clear view of everything moving your claim forward.</p></div><div style={{ display: "flex", gap: 10 }}><button className="outline-button" data-testid="quick-upload-document-button" onClick={() => navigate("documents")}><Upload size={15} /> Upload document</button><button className="primary-button" data-testid="quick-add-policy-button" onClick={() => navigate("policies")}><Plus size={18} /> Add policy</button></div></section>

        {data.kpis && <div className="kpi-grid" data-testid="kpi-grid">
          <div className="kpi" data-testid="kpi-active-policies"><div className="k-label">Active policies</div><div className="k-value">{data.kpis.active_policies}</div><div className="k-sub">{data.kpis.insurer_count} insurer{data.kpis.insurer_count === 1 ? "" : "s"}</div></div>
          <div className="kpi" data-testid="kpi-sum-insured"><div className="k-label">Total sum insured</div><div className="k-value accent">{formatINR(data.kpis.total_sum_insured)}</div><div className="k-sub">across household</div></div>
          <div className="kpi" data-testid="kpi-packets-in-progress"><div className="k-label">Claim packets in progress</div><div className="k-value warn">{data.kpis.packets_in_progress}</div><div className="k-sub">not yet ready to submit</div></div>
          <div className="kpi" data-testid="kpi-overdue-sla"><div className="k-label">Overdue SLAs</div><div className={data.kpis.overdue_sla_count > 0 ? "k-value crit" : "k-value"}>{data.kpis.overdue_sla_count}</div><div className="k-sub">{data.kpis.overdue_sla_count > 0 ? "needs action today" : "all on track"}</div></div>
        </div>}

        {data.onboarding && !data.onboarding.all_done && !data.onboarding.dismissed && (
          <section className="onboarding-card" data-testid="onboarding-checklist">
            <div className="onboarding-header">
              <div><p className="eyebrow">GETTING STARTED</p><h2>A few things to set up</h2></div>
              <button className="text-button" data-testid="dismiss-onboarding-button" onClick={async () => { try { await client.post("/household/onboarding/dismiss"); refreshDashboard(); } catch (err) { notify(apiError(err)); } }}>Dismiss</button>
            </div>
            <div className="onboarding-steps">
              {data.onboarding.steps.map((step, i) => (
                <button
                  key={step.id}
                  className={step.done ? "onboarding-step done" : "onboarding-step"}
                  data-testid={`onboarding-step-${step.id}`}
                  onClick={() => { if (step.id === "add_policy") navigate("policies"); else if (step.id === "upload_document") navigate("documents"); else if (step.id === "start_claim") setShowNew(true); }}
                >
                  <span className="onboarding-step-num">{step.done ? <CheckCircle2 size={18} /> : i + 1}</span>
                  <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                  {!step.done && <ChevronRight size={16} />}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="dash-panels" data-testid="dash-panels">
          <div className="dash-panel" data-testid="attention-panel">
            <p className="dash-panel-title">Needs attention</p>
            {data.attention.length === 0 ? <p className="empty-hint">Nothing needs your attention right now.</p> : data.attention.map((item, i) => (
              <button className="attn-row" key={item.label} data-testid={`attention-item-${i}`} onClick={() => notify(`${item.label} selected`)} style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
                <span className={`attn-row-dot ${item.tone === "red" ? "crit" : "warn"}`} />
                <div className="attn-row-body"><div className="attn-row-title">{item.label}</div><div className="attn-row-meta">{item.detail}</div></div>
              </button>
            ))}
          </div>
          <div className="dash-panel" data-testid="dates-panel">
            <p className="dash-panel-title">Important dates</p>
            {data.deadlines.length === 0 ? <p className="empty-hint" data-testid="deadlines-empty">No dates tracked yet. These will appear once your policy and claim details include due dates.</p> : data.deadlines.map((d, i) => (
              <div className="date-row" key={d.label} data-testid={`deadline-item-${i}`}>
                <div className="date-chip"><span className="d-num">{d.date}</span><span className="d-mon">{d.month}</span></div>
                <div><div className="date-row-title">{d.label}</div><div className="date-row-meta">{d.meta}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-head-row"><span className="section-title">Your policies</span><button className="view-all" data-testid="view-all-policies-button" onClick={() => navigate("policies")} style={{ border: 0, background: "transparent", cursor: "pointer" }}>View all →</button></div>
          {(!data.policies || data.policies.length === 0) ? <p className="empty-hint" data-testid="no-policies-hint">No policies yet. Add one to see it here.</p> : (
            <div className="policy-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
              {data.policies.slice(0, 3).map((p) => {
                const tone = p.status === "expired" ? "red" : p.status === "grace_period" ? "amber" : "teal";
                const label = p.status === "expired" ? "Expired" : p.status === "grace_period" ? "Grace period" : "Active";
                const pct = p.sum_insured > 0 ? Math.round((p.remaining_sum_insured / p.sum_insured) * 100) : 100;
                return (
                  <div className="policy-card" key={p.id} data-testid={`dash-policy-${p.id}`}>
                    <div className="p-top-row"><div className="policy-icon-badge"><BookOpen size={18} /></div><span className={`chip chip-${tone}`}>{label}</span></div>
                    <h3>{p.insurer_name}</h3>
                    <div className="p-sub">{p.policy_number} · {p.days_label}</div>
                    <div className="p-data-row"><span>Sum insured</span><span className="p-val">{formatINR(p.sum_insured)}</span></div>
                    <div className="p-data-row"><span>Remaining</span><span className="p-val">{formatINR(p.remaining_sum_insured)}</span></div>
                    <div className="p-progress-track"><div className="p-progress-fill" style={{ width: `${pct}%`, background: tone === "amber" ? "var(--gold)" : tone === "red" ? "var(--red)" : "var(--teal)" }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-head-row"><span className="section-title">Claim packets</span><div style={{ display: "flex", gap: 14, alignItems: "center" }}><button className="text-button" style={{ margin: 0 }} data-testid="new-claim-button" onClick={() => setShowNew(true)}><Plus size={14} /> New claim</button><button className="view-all" data-testid="view-all-claims-button" onClick={() => notify("Showing all claims")} style={{ border: 0, background: "transparent", cursor: "pointer" }}>View all →</button></div></div>
          {data.claims.length === 0 ? <p className="empty-hint" data-testid="empty-claims-card">No claims yet. Start one whenever you actually need it.</p> : (
            <table className="packet-table" data-testid="packet-table">
              <thead><tr><th>Claim</th><th>Policy</th><th>Packet status</th><th>Documents</th><th>Started</th><th></th></tr></thead>
              <tbody>
                {data.claims.map((claim) => {
                  const policy = (data.policies || []).find(p => p.id === claim.policy_id);
                  const ready = claim.packet_status === "Ready to submit";
                  return (
                    <tr key={claim.id} data-testid={`packet-row-${claim.id}`}>
                      <td><div className="packet-row-link"><div className="packet-row-icon"><FileText size={14} /></div>{claim.title}</div></td>
                      <td className="mono">{policy ? policy.policy_number : "—"}</td>
                      <td><span className={`chip chip-${ready ? "teal" : "amber"}`}>{claim.packet_status || "Not started"}</span></td>
                      <td className="mono">{claim.documents_attached ?? 0}/{claim.documents_total ?? 0} attached</td>
                      <td className="mono">{claim.created_at ? claim.created_at.slice(0, 10) : "—"}</td>
                      <td><button className="packet-action" data-testid={`open-claim-${claim.id}`} onClick={() => openClaim(claim.id)}>{ready ? "Download packet" : "Continue"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </>}
        {active === "policies" && <PoliciesPage canEdit={canEdit} notify={notify} prefill={policyPrefill} onPrefillConsumed={() => setPolicyPrefill(null)} />}
        {active === "evidence" && <EvidencePage canEdit={canEdit} notify={notify} />}
        {active === "documents" && <DocumentsPage canEdit={canEdit} notify={notify} onReviewAsPolicy={(detected) => { setPolicyPrefill(detected); navigate("policies"); }} />}
      </div>
    </main>
    {showMembers && <div className="modal-backdrop" data-testid="members-modal"><div className="modal members-modal"><button className="close-button" aria-label="Close household access" data-testid="close-members-modal-button" onClick={() => setShowMembers(false)}><X size={18} /></button><p className="eyebrow">HOUSEHOLD ACCESS</p><h2>People in your household</h2><p className="modal-copy">Invite people to help prepare the file. Agents can view but cannot change claims.</p><form className="invite-form" onSubmit={inviteMember} data-testid="invite-member-form"><input required type="email" placeholder="person@example.com" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} data-testid="invite-email-input" /><select value={inviteForm.role} onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })} data-testid="invite-role-select"><option value="member">Household member</option><option value="agent">Read-only agent</option></select><button className="primary-button" data-testid="send-invite-button"><UserPlus size={16} /> Invite</button></form><div className="member-list" data-testid="member-list">{members.members.map(item => <div className={`member-row ${item.status === "revoked" ? "revoked" : ""}`} key={item.id} data-testid={`member-row-${item.id}`}><span className="avatar avatar-small">{item.name.slice(0, 2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.email} · {item.role === "agent" ? "Read-only agent" : item.role === "owner" ? "Owner" : "Household member"}</small></span>{item.role !== "owner" && item.status !== "revoked" && <button className="member-action" aria-label={`Revoke ${item.name}`} data-testid={`revoke-member-${item.id}`} onClick={() => revokeMember(item.id)}><UserX size={15} /></button>}{item.status === "revoked" && <em>Revoked</em>}</div>)}{members.invites.map(item => <div className="member-row pending" key={item.id} data-testid={`invite-row-${item.id}`}><span className="avatar avatar-small">?</span><span><strong>{item.email}</strong><small>Pending · {item.role === "agent" ? "Read-only agent" : "Household member"}</small></span><button className="member-action" aria-label="Revoke invitation" data-testid={`revoke-invite-${item.id}`} onClick={() => revokeInvite(item.id)}><X size={15} /></button></div>)}</div><div className="activity-header"><span><History size={15} /> Recent access activity</span><small>{activity.length} events</small></div><div className="activity-list" data-testid="activity-list">{activity.slice(0, 5).map(event => <div className="activity-row" key={event.id}><span className="activity-dot" /><span><strong>{event.actor_name}</strong> {event.detail}<small>{new Date(event.created_at).toLocaleString()}</small></span></div>)}</div></div></div>}
    {showNew && <div className="modal-backdrop" data-testid="new-claim-modal"><div className="modal"><button className="close-button" aria-label="Close" data-testid="close-new-claim-button" onClick={() => { setShowNew(false); setNewClaimPolicyId(""); }}><X size={18} /></button><p className="eyebrow">START A CLAIM</p><h2>What happened?</h2><p className="modal-copy">Choose a claim type to begin building your file.</p>{data.policies?.length > 0 && <label style={{ display: "block", marginBottom: 16, fontSize: 11, fontWeight: 600 }}>Which policy is this for? (optional)<select value={newClaimPolicyId} onChange={(e) => setNewClaimPolicyId(e.target.value)} data-testid="new-claim-policy-select" style={{ display: "block", width: "100%", marginTop: 6, padding: 10, borderRadius: 6, border: "1px solid var(--line)", fontSize: 12 }}><option value="">Not sure yet</option>{data.policies.map((p) => <option key={p.id} value={p.id}>{p.insurer_name} · {p.policy_type}</option>)}</select></label>}<div className="claim-options"><button data-testid="cashless-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New hospitalisation claim", claim_type: "Cashless", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); openClaim(response.data.id); notify("Cashless claim saved"); } catch (err) { notify(apiError(err)); } }}><Stethoscope size={20} /><strong>Cashless hospitalisation</strong><small>For planned or emergency care</small></button><button data-testid="reimbursement-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New reimbursement claim", claim_type: "Reimbursement", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); openClaim(response.data.id); notify("Reimbursement claim saved"); } catch (err) { notify(apiError(err)); } }}><ClipboardCheck size={20} /><strong>Reimbursement</strong><small>For expenses already paid</small></button></div></div></div>}
    {toast && <div className="toast" role="status" data-testid="toast-message"><Check size={16} />{toast}</div>}
    {openClaimId && <ClaimDetail claimId={openClaimId} canEdit={canEdit} onClose={() => window.history.back()} onChange={refreshDashboard} notify={notify} />}
  </div>;
}
export default App;