import { useEffect, useRef, useState } from "react";
import client, { apiError } from "@/api";
import {
  Activity, ArrowUpRight, Bell, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck,
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
  { label: "Claim workspace", icon: LayoutDashboard, id: "workspace" },
  { label: "Policies & people", icon: ShieldCheck, id: "policies" },
  { label: "Evidence vault", icon: Home, id: "evidence" },
  { label: "Documents", icon: FileText, id: "documents" },
];

const fallback = {
  household: { name: "Your household", city: "", members: 1, active_policies: 0 },
  claims: [],
  attention: [],
  deadlines: [],
  policies: [],
  onboarding: { steps: [], all_done: true, dismissed: true }
};

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

function GoogleSignInButton({ onAuthenticated, onError }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const handleCredential = async (response) => {
      try {
        const result = await client.post("/auth/google", { credential: response.credential });
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await client.post(`/auth/${mode}`, form);
      onAuthenticated(response.data);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };
  return <div className="auth-shell" data-testid="auth-screen"><div className="auth-panel"><div className="brand auth-brand"><img className="brand-icon" src="/brand-icon.png" alt="Coversfolio" /><span><span className="brand-covers">Covers</span><span className="brand-folio">folio</span></span></div><div className="auth-copy"><p className="eyebrow">PRIVATE CLAIM COMPANION</p><h1>{mode === "login" ? "Welcome back." : "Create your household."}</h1><p>Keep your claim file clear, together, and in your hands.</p></div><GoogleSignInButton onAuthenticated={onAuthenticated} onError={setError} />{GOOGLE_CLIENT_ID && <div className="auth-divider" data-testid="auth-divider"><span>or with your email</span></div>}<form onSubmit={submit} data-testid="auth-form">{mode === "register" && <label data-testid="name-field">Your name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Riya Mehta" /></label>}<label data-testid="email-field">Email address<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label><label data-testid="password-field">Password<input required minLength="8" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8 characters minimum" /></label>{error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}<button className="primary-button auth-submit" disabled={busy} data-testid="auth-submit-button">{busy ? "Checking…" : mode === "login" ? "Sign in securely" : "Create account"}</button></form><button className="auth-switch" data-testid="auth-mode-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New here? Create a household" : "Already have an account? Sign in"}</button><div className="auth-assurance" data-testid="auth-assurance"><ShieldCheck size={17} /><span><strong>Your files are private</strong><small>Secure session · household access only</small></span></div></div><div className="auth-art"><div><span>01</span><h2>A calmer way<br />through a claim.</h2><p>Organise evidence, understand the next step, and keep every decision yours.</p></div></div></div>;
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
      <nav className="nav-list" data-testid="main-navigation">{navItems.map(({ label, icon: Icon, id }) => <button key={id} data-testid={`nav-${id}`} className={active === id ? "nav-item active" : "nav-item"} onClick={() => setActive(id)}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button className="nav-item" data-testid="nav-support" onClick={() => notify("Support centre is ready for your questions")}><LifeBuoy size={18} /><span>Support centre</span></button><div className="privacy-note" data-testid="privacy-note"><ShieldCheck size={17} /><span><strong>Your files stay private</strong><small>Encrypted and only shared by you</small></span></div><button className="profile" data-testid="sidebar-profile" onClick={() => document.querySelector('[data-testid="account-menu-trigger"]')?.click()}><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.role === "owner" ? "Household owner" : user.role === "agent" ? "Read-only agent" : "Household member"}</small></span><Menu size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="crumbs" data-testid="page-breadcrumb"><span>My household</span><ChevronRight size={14} /><strong>{navItems.find(n => n.id === active)?.label || "Claim workspace"}</strong></div><div className="top-actions"><button className="icon-button" aria-label="Search" data-testid="search-button" onClick={() => notify("Search across your claim file")}><Search size={19} /></button><button className="icon-button notification" aria-label="Notifications" data-testid="notifications-button" onClick={() => notify(data.attention.length > 0 ? `You have ${data.attention.length} item${data.attention.length === 1 ? "" : "s"} needing attention` : "You're all caught up")}><Bell size={19} /><i /></button><AccountMenu user={user} onManageAccess={openMembers} onSignOut={signOut} onSupport={() => notify("Support centre is ready for your questions")} /></div></header>
      <div className="content-wrap">
        {active === "workspace" && <>
        <section className="welcome-row"><div><p className="eyebrow" data-testid="workspace-eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</p><h1 data-testid="workspace-title">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user.name?.split(" ")[0] || "there"}<span className="title-accent">.</span></h1><p className="lede" data-testid="workspace-subtitle">One clear view of everything moving your claim forward.</p></div><button className="primary-button" data-testid="new-claim-button" onClick={() => setShowNew(true)}><Plus size={18} /> New claim</button></section>
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
                  onClick={() => { if (step.id === "add_policy") setActive("policies"); else if (step.id === "upload_document") setActive("documents"); else if (step.id === "start_claim") setShowNew(true); }}
                >
                  <span className="onboarding-step-num">{step.done ? <CheckCircle2 size={18} /> : i + 1}</span>
                  <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                  {!step.done && <ChevronRight size={16} />}
                </button>
              ))}
            </div>
          </section>
        )}
        {data.attention.length > 0 && <section className="attention-strip" data-testid="attention-summary"><div className="attention-icon"><Activity size={20} /></div><div><strong>{data.attention.length} item{data.attention.length === 1 ? "" : "s"} need your attention</strong><span>Keep your claim file moving by resolving the next steps.</span></div><button className="text-button" data-testid="review-attention-button" onClick={() => document.getElementById("attention-list").scrollIntoView({ behavior: "smooth" })}>Review now <ArrowUpRight size={15} /></button></section>}
        <div className="dashboard-grid"><section className="primary-column"><div className="section-heading"><div><p className="eyebrow">IN PROGRESS</p><h2 data-testid="active-claims-heading">Active claims</h2></div><button className="quiet-button" data-testid="view-all-claims-button" onClick={() => notify("Showing all claims")}>View all <ChevronRight size={15} /></button></div>{data.claims.length === 0 ? <article className="claim-card empty-claim" data-testid="empty-claims-card"><div className="claim-top"><div className="claim-icon"><ClipboardCheck size={22} /></div><div className="claim-heading"><span className="claim-id">READY</span><h3>No claims yet</h3><span className="claim-type">Start a new claim to begin your file.</span></div></div></article> : data.claims.map(claim => <article className="claim-card" key={claim.id} data-testid="active-claim-card"><div className="claim-top"><div className="claim-icon"><Stethoscope size={22} /></div><div className="claim-heading"><span className="claim-id">{claim.id}</span><h3 data-testid="active-claim-title">{claim.title}</h3><span className="claim-type"><span className="status-dot" /> {claim.type}</span></div><button className="more-button" aria-label="Open claim" data-testid={`open-claim-${claim.id}`} onClick={() => setOpenClaimId(claim.id)}>↗</button></div><div className="claim-progress"><div className="progress-label"><span>{claim.stage}</span><strong>{claim.progress}%</strong></div><div className="progress-track"><span style={{ width: `${claim.progress}%` }} /></div></div><div className="claim-footer"><span>{claim.amount} <small>estimated claim value</small></span><span>{claim.updated}</span></div></article>)}{data.attention.length > 0 && <><div className="section-heading attention-heading" id="attention-list"><div><p className="eyebrow">NEXT STEPS</p><h2 data-testid="attention-heading">Needs attention</h2></div><span className="count-pill" data-testid="attention-count">{data.attention.length} open</span></div><div className="attention-list">{data.attention.map((item, i) => <button className="attention-item" key={item.label} data-testid={`attention-item-${i}`} onClick={() => notify(`${item.label} selected`)}><span className={`attention-bullet ${item.tone}`}><span /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={16} /></button>)}</div></>}</section>
        <aside className="right-column"><section className="side-section"><div className="section-heading"><div><p className="eyebrow">YOUR HOUSEHOLD</p><h2 data-testid="household-heading">At a glance</h2></div><button className="square-button" data-testid="household-settings-button" onClick={openMembers}>•••</button></div><div className="glance-stats"><div data-testid="household-members-stat"><Users size={17} /><strong>{data.household.members}</strong><span>People covered</span></div><div data-testid="active-policies-stat"><BookOpen size={17} /><strong>{data.household.active_policies ?? 0}</strong><span>Active policies</span></div></div>{data.policies?.length > 0 && <div className="policy-status-list" data-testid="policy-status-list">{data.policies.map((p) => { const tone = p.status === "expired" ? "red" : p.status === "grace_period" ? "amber" : "teal"; const label = p.status === "expired" ? "Expired" : p.status === "grace_period" ? "Grace period" : "Active"; return <div className="policy-status-row" key={p.id} data-testid={`policy-status-${p.id}`}><span className={`status-dot dot-${tone}`} /><span className="policy-status-name">{p.insurer_name}</span><span className={`chip chip-${tone} chip-sm`}>{label}</span>{p.days_label && <small>{p.days_label}</small>}</div>; })}</div>}<button className="outline-button" data-testid="manage-household-button" onClick={openMembers}>Manage access <ArrowUpRight size={15} /></button></section><section className="side-section deadlines"><div className="section-heading"><div><p className="eyebrow">UPCOMING</p><h2 data-testid="deadlines-heading">Important dates</h2></div><button className="quiet-button" data-testid="calendar-button" onClick={() => notify("Calendar view coming next")}>Calendar <ArrowUpRight size={14} /></button></div>{data.deadlines.length === 0 ? <p className="empty-hint" data-testid="deadlines-empty" style={{ marginTop: 12 }}>No dates tracked yet. These will appear once your policy and claim details include due dates.</p> : data.deadlines.map((d, i) => <div className="deadline" key={d.label} data-testid={`deadline-item-${i}`}><div className="date-tile"><strong>{d.date}</strong><span>{d.month}</span></div><div><strong>{d.label}</strong><small>{d.meta}</small></div></div>)}</section><section className="upload-prompt" data-testid="upload-prompt"><div className="upload-symbol"><Upload size={20} /></div><div><strong>Have a new document?</strong><p>Add it to your secure evidence vault.</p></div><button className="round-arrow" aria-label="Upload document" data-testid="upload-document-button" onClick={() => setActive("documents")}>+</button></section></aside></div>
        </>}
        {active === "policies" && <PoliciesPage canEdit={canEdit} notify={notify} prefill={policyPrefill} onPrefillConsumed={() => setPolicyPrefill(null)} />}
        {active === "evidence" && <EvidencePage canEdit={canEdit} notify={notify} />}
        {active === "documents" && <DocumentsPage canEdit={canEdit} notify={notify} onReviewAsPolicy={(detected) => { setPolicyPrefill(detected); setActive("policies"); }} />}
      </div>
    </main>
    {showMembers && <div className="modal-backdrop" data-testid="members-modal"><div className="modal members-modal"><button className="close-button" aria-label="Close household access" data-testid="close-members-modal-button" onClick={() => setShowMembers(false)}><X size={18} /></button><p className="eyebrow">HOUSEHOLD ACCESS</p><h2>People in your household</h2><p className="modal-copy">Invite people to help prepare the file. Agents can view but cannot change claims.</p><form className="invite-form" onSubmit={inviteMember} data-testid="invite-member-form"><input required type="email" placeholder="person@example.com" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} data-testid="invite-email-input" /><select value={inviteForm.role} onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })} data-testid="invite-role-select"><option value="member">Household member</option><option value="agent">Read-only agent</option></select><button className="primary-button" data-testid="send-invite-button"><UserPlus size={16} /> Invite</button></form><div className="member-list" data-testid="member-list">{members.members.map(item => <div className={`member-row ${item.status === "revoked" ? "revoked" : ""}`} key={item.id} data-testid={`member-row-${item.id}`}><span className="avatar avatar-small">{item.name.slice(0, 2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.email} · {item.role === "agent" ? "Read-only agent" : item.role === "owner" ? "Owner" : "Household member"}</small></span>{item.role !== "owner" && item.status !== "revoked" && <button className="member-action" aria-label={`Revoke ${item.name}`} data-testid={`revoke-member-${item.id}`} onClick={() => revokeMember(item.id)}><UserX size={15} /></button>}{item.status === "revoked" && <em>Revoked</em>}</div>)}{members.invites.map(item => <div className="member-row pending" key={item.id} data-testid={`invite-row-${item.id}`}><span className="avatar avatar-small">?</span><span><strong>{item.email}</strong><small>Pending · {item.role === "agent" ? "Read-only agent" : "Household member"}</small></span><button className="member-action" aria-label="Revoke invitation" data-testid={`revoke-invite-${item.id}`} onClick={() => revokeInvite(item.id)}><X size={15} /></button></div>)}</div><div className="activity-header"><span><History size={15} /> Recent access activity</span><small>{activity.length} events</small></div><div className="activity-list" data-testid="activity-list">{activity.slice(0, 5).map(event => <div className="activity-row" key={event.id}><span className="activity-dot" /><span><strong>{event.actor_name}</strong> {event.detail}<small>{new Date(event.created_at).toLocaleString()}</small></span></div>)}</div></div></div>}
    {showNew && <div className="modal-backdrop" data-testid="new-claim-modal"><div className="modal"><button className="close-button" aria-label="Close" data-testid="close-new-claim-button" onClick={() => { setShowNew(false); setNewClaimPolicyId(""); }}><X size={18} /></button><p className="eyebrow">START A CLAIM</p><h2>What happened?</h2><p className="modal-copy">Choose a claim type to begin building your file.</p>{data.policies?.length > 0 && <label style={{ display: "block", marginBottom: 16, fontSize: 11, fontWeight: 600 }}>Which policy is this for? (optional)<select value={newClaimPolicyId} onChange={(e) => setNewClaimPolicyId(e.target.value)} data-testid="new-claim-policy-select" style={{ display: "block", width: "100%", marginTop: 6, padding: 10, borderRadius: 6, border: "1px solid var(--line)", fontSize: 12 }}><option value="">Not sure yet</option>{data.policies.map((p) => <option key={p.id} value={p.id}>{p.insurer_name} · {p.policy_type}</option>)}</select></label>}<div className="claim-options"><button data-testid="cashless-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New hospitalisation claim", claim_type: "Cashless", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); setOpenClaimId(response.data.id); notify("Cashless claim saved"); } catch (err) { notify(apiError(err)); } }}><Stethoscope size={20} /><strong>Cashless hospitalisation</strong><small>For planned or emergency care</small></button><button data-testid="reimbursement-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New reimbursement claim", claim_type: "Reimbursement", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); setOpenClaimId(response.data.id); notify("Reimbursement claim saved"); } catch (err) { notify(apiError(err)); } }}><ClipboardCheck size={20} /><strong>Reimbursement</strong><small>For expenses already paid</small></button></div></div></div>}
    {toast && <div className="toast" role="status" data-testid="toast-message"><Check size={16} />{toast}</div>}
    {openClaimId && <ClaimDetail claimId={openClaimId} canEdit={canEdit} onClose={() => setOpenClaimId(null)} onChange={refreshDashboard} notify={notify} />}
  </div>;
}
export default App;