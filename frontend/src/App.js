import { useEffect, useRef, useState } from "react";
import client, { apiError } from "@/api";
import {
  AlertTriangle, Bell, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck,
  FileText, Home, LayoutDashboard, LifeBuoy, LogOut, Menu, Plus, Search, Settings, ShieldCheck,
  Stethoscope, Trash2, Upload, User as UserIcon, Users, X, UserPlus, UserX, History
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
  { label: "Documents", icon: FileText, id: "documents" },
  { label: "Evidence & Inventory", icon: Home, id: "evidence" },
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
  kpis: { active_policies: 0, insurer_count: 0, total_sum_insured: 0, packets_in_progress: 0 }
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
  const [mode, setMode] = useState("login"); // "login" | "register" | "forgot" | "reset"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [resetToken, setResetToken] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetDone, setResetDone] = useState(false);

  // A password-reset email link lands here as /?token=... (or /reset-password?token=...
  // depending on how the link was built) - detect it once on mount and drop
  // straight into the reset form instead of making the person navigate there.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setResetToken(token);
      setMode("reset");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = mode === "register" ? { ...form, consent_given: consent } : form;
      const response = await client.post(`/auth/${mode}`, payload);
      onAuthenticated(response.data);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const submitForgot = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await client.post("/auth/forgot-password", { email: forgotEmail });
      setForgotSent(true);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const submitReset = async (event) => {
    event.preventDefault(); setError("");
    if (resetPassword !== resetConfirm) { setError("Passwords don't match"); return; }
    setBusy(true);
    try {
      await client.post("/auth/reset-password", { token: resetToken, new_password: resetPassword });
      setResetDone(true);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  };

  const heading = mode === "login" ? "Welcome back."
    : mode === "register" ? "Create your household."
    : mode === "forgot" ? "Reset your password."
    : "Set a new password.";

  return (
    <div className="auth-shell" data-testid="auth-screen">
      <div className="auth-panel">
        <div className="brand auth-brand">
          <img className="brand-icon" src="/brand-icon.png" alt="Coversfolio" />
          <span><span className="brand-covers">Covers</span><span className="brand-folio">folio</span></span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">PRIVATE CLAIM COMPANION</p>
          <h1>{heading}</h1>
          <p>Keep your claim file clear, together, and in your hands.</p>
        </div>

        {(mode === "login" || mode === "register") && (
          <>
            {mode === "login" || consent ? (
              <GoogleSignInButton onAuthenticated={onAuthenticated} onError={setError} consentGiven={mode === "login" || consent} />
            ) : (
              <p className="empty-hint" data-testid="google-consent-gate" style={{ marginBottom: 8 }}>Check the box below to continue with Google.</p>
            )}
            {GOOGLE_CLIENT_ID && <div className="auth-divider" data-testid="auth-divider"><span>or with your email</span></div>}
            <form onSubmit={submit} data-testid="auth-form">
              {mode === "register" && (
                <label data-testid="name-field">Your name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Riya Mehta" /></label>
              )}
              <label data-testid="email-field">Email address<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></label>
              <label data-testid="password-field">Password<input required minLength="8" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="8 characters minimum" /></label>
              {mode === "login" && (
                <button
                  type="button" className="auth-switch" style={{ margin: "-6px 0 4px", textAlign: "left" }}
                  data-testid="forgot-password-link"
                  onClick={() => { setMode("forgot"); setError(""); setForgotEmail(form.email); setForgotSent(false); }}
                >
                  Forgot password?
                </button>
              )}
              {mode === "register" && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, flexDirection: "row", fontSize: 11 }} data-testid="consent-field">
                  <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ width: "auto", marginTop: 2 }} data-testid="consent-checkbox" />
                  I agree to the Privacy Policy and Terms of Service
                </label>
              )}
              {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
              <button className="primary-button auth-submit" disabled={busy || (mode === "register" && !consent)} data-testid="auth-submit-button">
                {busy ? "Checking…" : mode === "login" ? "Sign in securely" : "Create account"}
              </button>
            </form>
            <button className="auth-switch" data-testid="auth-mode-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "New here? Create a household" : "Already have an account? Sign in"}
            </button>
          </>
        )}

        {mode === "forgot" && (
          forgotSent ? (
            <div data-testid="forgot-password-sent">
              <p className="empty-hint" style={{ marginBottom: 16 }}>If an account exists for that email, we've sent password reset instructions. Check your inbox (and spam folder) for a link valid for 30 minutes.</p>
              <button className="auth-switch" data-testid="back-to-login-link" onClick={() => { setMode("login"); setError(""); }}>Back to sign in</button>
            </div>
          ) : (
            <form onSubmit={submitForgot} data-testid="forgot-password-form">
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 16px" }}>Enter the email on your account and we'll send a link to reset your password.</p>
              <label data-testid="forgot-email-field">Email address<input required type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" /></label>
              {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
              <button className="primary-button auth-submit" disabled={busy} data-testid="forgot-password-submit">{busy ? "Sending…" : "Send reset link"}</button>
              <button type="button" className="auth-switch" data-testid="back-to-login-from-forgot" onClick={() => { setMode("login"); setError(""); }}>Back to sign in</button>
            </form>
          )
        )}

        {mode === "reset" && (
          resetDone ? (
            <div data-testid="reset-password-done">
              <p className="empty-hint" style={{ marginBottom: 16 }}>Your password has been reset. You can now sign in with your new password.</p>
              <button className="auth-switch" data-testid="back-to-login-after-reset" onClick={() => { setMode("login"); setError(""); }}>Go to sign in</button>
            </div>
          ) : (
            <form onSubmit={submitReset} data-testid="reset-password-form">
              <label data-testid="reset-password-field">New password<input required minLength="8" type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="8 characters minimum" /></label>
              <label data-testid="reset-confirm-field">Confirm new password<input required minLength="8" type="password" value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} placeholder="Type it again" /></label>
              {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
              <button className="primary-button auth-submit" disabled={busy} data-testid="reset-password-submit">{busy ? "Saving…" : "Set new password"}</button>
            </form>
          )
        )}

        <div className="auth-assurance" data-testid="auth-assurance">
          <ShieldCheck size={17} />
          <span><strong>Your files are private</strong><small>Secure session · household access only</small></span>
        </div>
      </div>
      <div className="auth-art" data-testid="auth-marketing-panel">
        <div className="auth-art-blobs" aria-hidden="true"><span /><span /><span /></div>
        <div className="auth-art-inner">
          <span className="auth-art-kicker">WHAT WE'RE BUILDING</span>
          <h2>A calmer way<br />through a claim.</h2>
          <p className="auth-art-lede">
            Coversfolio helps Indian households organize insurance policies and prepare everything needed to file a claim - clearly, privately, on your own terms. We compile your file; we don't sell insurance, settle claims, or act as your insurer's intermediary.
          </p>

          <div className="auth-art-features">
            <div className="auth-art-feature">
              <BookOpen size={17} />
              <div><strong>One place for every policy</strong><small>Sum insured, renewal dates, and who's covered - tracked automatically, no more digging through email.</small></div>
            </div>
            <div className="auth-art-feature">
              <Search size={17} />
              <div><strong>Plain-language policy analysis</strong><small>Maternity cover, waiting periods, and exclusions explained - not buried in 40 pages of fine print.</small></div>
            </div>
            <div className="auth-art-feature">
              <FileText size={17} />
              <div><strong>A real claim compiler</strong><small>Bills sorted automatically, a field-by-field cheat sheet, and the right checklist for Cashless or Reimbursement.</small></div>
            </div>
            <div className="auth-art-feature">
              <ShieldCheck size={17} />
              <div><strong>Private by design</strong><small>Your documents stay yours. We never sell data or act as a licensed insurance intermediary.</small></div>
            </div>
          </div>

          <div className="auth-art-roadmap">
            <span>COMING NEXT</span>
            <p>Insurer-specific requirement guides, deeper coverage insights, and a smarter document checklist built from real IRDAI regulations.</p>
          </div>
        </div>
      </div>
    </div>
  );
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

function AccountMenu({ user, onManageAccess, onSignOut, onSupport, onOpenAdminStats }) {
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
              <button role="menuitem" onClick={() => { setOpen(false); onManageAccess(); }} data-testid="account-menu-manage-access"><Settings size={15} /><span>Manage members</span></button>
            )}
            {user.is_platform_admin && (
              <button role="menuitem" onClick={() => { setOpen(false); onOpenAdminStats(); }} data-testid="account-menu-admin-stats"><LayoutDashboard size={15} /><span>Admin stats</span></button>
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
  const [toast, setToast] = useState(null); // { message, isError } | null
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
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
  const deleteClaim = async (claim) => {
    if (!window.confirm(`Remove "${claim.title}"? This can't be undone - any documents attached to it stay in your Documents vault, just unlinked from this claim.`)) return;
    try {
      await client.delete(`/claims/${claim.id}`);
      notify("Claim removed");
      refreshDashboard();
    } catch (err) { notify(apiError(err), true); }
  };
  const signOut = async () => { try { await client.post(`/auth/logout`, {}); } catch (err) {} setUser(false); setData(fallback); setOpenClaimId(null); setShowMembers(false); };

  // Real search: debounced call to /api/search, replacing what used to be a
  // button that just showed a toast with the typed-in text and did nothing else.
  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults(null); setSearching(false); return; }
    setSearching(true);
    const timeout = setTimeout(() => {
      client.get("/search", { params: { q } })
        .then((r) => setSearchResults(r.data))
        .catch(() => setSearchResults(null))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, searchOpen]);

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(""); setSearchResults(null); };
  const goToSearchResult = (type, item) => {
    closeSearch();
    if (type === "claim") openClaim(item.id);
    else if (type === "policy") navigate("policies");
    else if (type === "document") navigate("documents");
  };

  // Real notifications: reuses the same attention data already shown on the
  // dashboard, but now clicking one actually takes you to the claim or policy
  // involved, instead of just repeating a count in a toast.
  const goToAttentionItem = (item) => {
    setNotifOpen(false);
    if (item.target_type === "claim" && item.target_id) openClaim(item.target_id);
    else if (item.target_type === "policy") navigate("policies");
  };

  const [adminStats, setAdminStats] = useState(null);
  const [adminStatsOpen, setAdminStatsOpen] = useState(false);
  const openAdminStats = async () => {
    setAdminStatsOpen(true);
    setAdminStats(null);
    try {
      const res = await client.get("/admin/stats");
      setAdminStats(res.data);
    } catch (err) { notify(apiError(err), true); setAdminStatsOpen(false); }
  };
  useEffect(() => {
    client.get(`/auth/me`).then(r => setUser(r.data)).catch(() => setUser(false)).finally(() => setAuthChecking(false));
  }, []);
  useEffect(() => { if (user && active === "workspace") client.get(`/dashboard`).then(r => setData(r.data)).catch(() => {}); }, [user, active]);
  const notify = (message, isError = false) => { setToast({ message, isError }); window.setTimeout(() => setToast(null), 2800); };
  const openMembers = async () => { setShowMembers(true); try { const [people, history] = await Promise.all([client.get(`/household/members`), client.get(`/household/activity`)]); setMembers(people.data); setActivity(history.data.events); } catch (err) { notify(apiError(err), true); } };
  const inviteMember = async (event) => { event.preventDefault(); try { const response = await client.post(`/household/invites`, inviteForm); setMembers({ ...members, invites: [response.data, ...members.invites] }); setInviteForm({ email: "", role: "member" }); notify("Invitation link ready to share"); } catch (err) { notify(apiError(err), true); } };
  const revokeMember = async (id) => { try { await client.delete(`/household/members/${id}`); setMembers({ ...members, members: members.members.map(item => item.id === id ? { ...item, status: "revoked" } : item) }); notify("Access revoked"); } catch (err) { notify(apiError(err), true); } };
  const revokeInvite = async (id) => { try { await client.delete(`/household/invites/${id}`); setMembers({ ...members, invites: members.invites.filter(item => item.id !== id) }); notify("Invitation revoked"); } catch (err) { notify(apiError(err), true); } };

  if (authChecking) return <div className="auth-loading" data-testid="auth-loading"><ShieldCheck size={24} />Loading your secure workspace…</div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return <div className="app-shell">
    <aside className="sidebar" data-testid="primary-sidebar">
      <div className="brand" data-testid="brand-mark"><img className="brand-icon" src="/brand-icon.png" alt="Coversfolio" /><span><span className="brand-covers">Covers</span><span className="brand-folio">folio</span></span></div>
      <div className="household-switcher" data-testid="household-switcher"><span className="avatar">M</span><span><small>HOUSEHOLD</small><strong>{data.household.name}</strong></span><ChevronRight size={15} /></div>
      <nav className="nav-list" data-testid="main-navigation">{navItems.map(({ label, icon: Icon, id }) => <button key={id} data-testid={`nav-${id}`} className={active === id ? "nav-item active" : "nav-item"} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span></button>)}<button className="nav-item" data-testid="nav-household" onClick={openMembers}><Users size={18} /><span>Members</span></button></nav>
      <div className="sidebar-bottom"><button className="nav-item" data-testid="nav-support" onClick={() => notify("Support centre is ready for your questions")}><LifeBuoy size={18} /><span>Support centre</span></button><div className="privacy-note" data-testid="privacy-note"><ShieldCheck size={17} /><span><strong>Your files stay private</strong><small>Encrypted and only shared by you</small></span></div><button className="profile" data-testid="sidebar-profile" onClick={() => document.querySelector('[data-testid="account-menu-trigger"]')?.click()}><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.role === "owner" ? "Household owner" : user.role === "agent" ? "Read-only agent" : "Household member"}</small></span><Menu size={16} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div className="crumbs" data-testid="page-breadcrumb"><span>My household</span><ChevronRight size={14} /><strong>{navItems.find(n => n.id === active)?.label || "Claim workspace"}</strong></div>
        <div className="top-actions">
          <div style={{ position: "relative" }}>
            <button className="icon-button" aria-label="Search" data-testid="search-button" onClick={() => { setSearchOpen((v) => !v); setNotifOpen(false); }}><Search size={19} /></button>
            {searchOpen && (
              <>
                <div className="dropdown-backdrop" onClick={closeSearch} />
                <div className="search-dropdown" data-testid="search-dropdown">
                  <input
                    autoFocus type="text" placeholder="Search policies, claims, documents…"
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="search-input"
                  />
                  {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && <p className="empty-hint" style={{ padding: "10px 14px", margin: 0 }}>Keep typing…</p>}
                  {searching && <p className="empty-hint" style={{ padding: "10px 14px", margin: 0 }}>Searching…</p>}
                  {searchResults && !searching && (
                    (searchResults.policies.length + searchResults.claims.length + searchResults.documents.length === 0) ? (
                      <p className="empty-hint" style={{ padding: "10px 14px", margin: 0 }}>No matches for "{searchQuery}"</p>
                    ) : (
                      <div data-testid="search-results">
                        {searchResults.policies.length > 0 && (
                          <div className="search-group">
                            <p className="search-group-label">Policies</p>
                            {searchResults.policies.map((p) => (
                              <button key={p.id} className="search-result-row" onClick={() => goToSearchResult("policy", p)} data-testid={`search-result-policy-${p.id}`}>
                                <BookOpen size={14} /><span><strong>{p.insurer_name}</strong><small>{p.policy_number} · {p.policy_type}</small></span>
                              </button>
                            ))}
                          </div>
                        )}
                        {searchResults.claims.length > 0 && (
                          <div className="search-group">
                            <p className="search-group-label">Claims</p>
                            {searchResults.claims.map((c) => (
                              <button key={c.id} className="search-result-row" onClick={() => goToSearchResult("claim", c)} data-testid={`search-result-claim-${c.id}`}>
                                <FileText size={14} /><span><strong>{c.title}</strong><small>{c.type} · {c.status}</small></span>
                              </button>
                            ))}
                          </div>
                        )}
                        {searchResults.documents.length > 0 && (
                          <div className="search-group">
                            <p className="search-group-label">Documents</p>
                            {searchResults.documents.map((d) => (
                              <button key={d.id} className="search-result-row" onClick={() => goToSearchResult("document", d)} data-testid={`search-result-document-${d.id}`}>
                                <ClipboardCheck size={14} /><span><strong>{d.filename}</strong><small>{d.category}</small></span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              </>
            )}
          </div>

          <div style={{ position: "relative" }}>
            <button className="icon-button notification" aria-label="Notifications" data-testid="notifications-button" onClick={() => { setNotifOpen((v) => !v); setSearchOpen(false); }}>
              <Bell size={19} />{data.attention.length > 0 && <i />}
            </button>
            {notifOpen && (
              <>
                <div className="dropdown-backdrop" onClick={() => setNotifOpen(false)} />
                <div className="notif-dropdown" data-testid="notifications-dropdown">
                  <p className="search-group-label" style={{ padding: "12px 14px 6px" }}>Notifications</p>
                  {data.attention.length === 0 ? (
                    <p className="empty-hint" style={{ padding: "0 14px 14px", margin: 0 }}>You're all caught up.</p>
                  ) : data.attention.map((item, i) => (
                    <button key={i} className="search-result-row" data-testid={`notif-item-${i}`} onClick={() => goToAttentionItem(item)}>
                      <span className={`attn-row-dot ${item.tone === "red" ? "crit" : "warn"}`} />
                      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <AccountMenu user={user} onManageAccess={openMembers} onSignOut={signOut} onSupport={() => notify("Support centre is ready for your questions")} onOpenAdminStats={openAdminStats} />
        </div>
      </header>
      <div className="content-wrap">
        {active === "workspace" && <>
        <section className="page-head" data-testid="dashboard-hero">
          <div>
            <h1 data-testid="workspace-title">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {user.name?.split(" ")[0] || "there"}<span className="title-accent">.</span></h1>
            <div className="context-line" data-testid="workspace-subtitle">
              {data.kpis && (
                <>
                  <b>{data.kpis.packets_in_progress}</b> claim packet{data.kpis.packets_in_progress === 1 ? "" : "s"} in progress
                  <span className="dot">·</span>
                  <b>{formatINR(data.kpis.total_sum_insured)}</b> sum insured tracked
                  <span className="dot">·</span>
                </>
              )}
              {(() => {
                const openCount = data.attention.length;
                return openCount === 0 ? "All caught up" : <><b>{openCount}</b> item{openCount === 1 ? "" : "s"} need{openCount === 1 ? "s" : ""} attention</>;
              })()}
            </div>
          </div>
          <div className="head-actions">
            <button className="btn" data-testid="quick-upload-document-button" onClick={() => navigate("documents")}><Upload size={15} /> Upload document</button>
            <button className="btn primary" data-testid="quick-add-policy-button" onClick={() => navigate("policies")}><Plus size={18} /> Add policy</button>
          </div>
        </section>

        {data.onboarding && !data.onboarding.all_done && !data.onboarding.dismissed && (
          <section className="onboarding-card" data-testid="onboarding-checklist">
            <div className="onboarding-header">
              <div><p className="eyebrow">GETTING STARTED</p><h2>A few things to set up</h2></div>
              <button className="text-button" data-testid="dismiss-onboarding-button" onClick={async () => { try { await client.post("/household/onboarding/dismiss"); refreshDashboard(); } catch (err) { notify(apiError(err), true); } }}>Dismiss</button>
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
              <button className="attn-row" key={item.label} data-testid={`attention-item-${i}`} onClick={() => goToAttentionItem(item)} style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
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
            <div className="claims-list" data-testid="packet-table">
              {data.claims.map((claim) => {
                const policy = (data.policies || []).find(p => p.id === claim.policy_id);
                const ready = claim.packet_status === "Ready to submit";
                return (
                  <div className="claim-card" key={claim.id} data-testid={`packet-row-${claim.id}`}>
                    <div className="claim-top">
                      <div>
                        <p className="claim-name">{claim.title}</p>
                        <span className="claim-meta">{claim.id}{policy ? ` · ${policy.insurer_name}` : ""} · {claim.type} · Started {claim.created_at ? claim.created_at.slice(0, 10) : "—"}</span>
                      </div>
                      <span className={`claim-status ${ready ? "ok" : "watch"}`}>{claim.packet_status || "Not started"}</span>
                    </div>
                    <div className="claim-bottom-row">
                      <span className="claim-doc-count">{claim.documents_attached ?? 0}/{claim.documents_total ?? 0} documents attached</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="packet-action" data-testid={`open-claim-${claim.id}`} onClick={() => openClaim(claim.id)}>{ready ? "Download packet" : "Continue"}</button>
                        {canEdit && (
                          <button className="icon-button" aria-label="Remove claim" data-testid={`remove-claim-${claim.id}`} onClick={() => deleteClaim(claim)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {claim.regulatory_note && (
                      <div className="claim-reg-note" data-testid={`claim-reg-note-${claim.id}`}>{claim.regulatory_note}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </>}
        {active === "policies" && <PoliciesPage canEdit={canEdit} notify={notify} prefill={policyPrefill} onPrefillConsumed={() => setPolicyPrefill(null)} />}
        {active === "evidence" && <EvidencePage canEdit={canEdit} notify={notify} />}
        {active === "documents" && <DocumentsPage canEdit={canEdit} notify={notify} onReviewAsPolicy={(detected) => { setPolicyPrefill(detected); navigate("policies"); }} />}
      </div>
    </main>
    {showMembers && <div className="modal-backdrop" data-testid="members-modal"><div className="modal members-modal"><button className="close-button" aria-label="Close household access" data-testid="close-members-modal-button" onClick={() => setShowMembers(false)}><X size={18} /></button><p className="eyebrow">MEMBERS</p><h2>People in your household</h2><p className="modal-copy">Invite people to help prepare the file. Agents can view but cannot change claims.</p><form className="invite-form" onSubmit={inviteMember} data-testid="invite-member-form"><input required type="email" placeholder="person@example.com" value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} data-testid="invite-email-input" /><select value={inviteForm.role} onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })} data-testid="invite-role-select"><option value="member">Household member</option><option value="agent">Read-only agent</option></select><button className="primary-button" data-testid="send-invite-button"><UserPlus size={16} /> Invite</button></form><div className="member-list" data-testid="member-list">{members.members.map(item => <div className={`member-row ${item.status === "revoked" ? "revoked" : ""}`} key={item.id} data-testid={`member-row-${item.id}`}><span className="avatar avatar-small">{item.name.slice(0, 2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.email} · {item.role === "agent" ? "Read-only agent" : item.role === "owner" ? "Owner" : "Household member"}</small></span>{item.role !== "owner" && item.status !== "revoked" && <button className="member-action" aria-label={`Revoke ${item.name}`} data-testid={`revoke-member-${item.id}`} onClick={() => revokeMember(item.id)}><UserX size={15} /></button>}{item.status === "revoked" && <em>Revoked</em>}</div>)}{members.invites.map(item => <div className="member-row pending" key={item.id} data-testid={`invite-row-${item.id}`}><span className="avatar avatar-small">?</span><span><strong>{item.email}</strong><small>Pending · {item.role === "agent" ? "Read-only agent" : "Household member"}</small></span><button className="member-action" aria-label="Revoke invitation" data-testid={`revoke-invite-${item.id}`} onClick={() => revokeInvite(item.id)}><X size={15} /></button></div>)}</div><div className="activity-header"><span><History size={15} /> Recent access activity</span><small>{activity.length} events</small></div><div className="activity-list" data-testid="activity-list">{activity.slice(0, 5).map(event => <div className="activity-row" key={event.id}><span className="activity-dot" /><span><strong>{event.actor_name}</strong> {event.detail}<small>{new Date(event.created_at).toLocaleString()}</small></span></div>)}</div></div></div>}
    {showNew && <div className="modal-backdrop" data-testid="new-claim-modal"><div className="modal"><button className="close-button" aria-label="Close" data-testid="close-new-claim-button" onClick={() => { setShowNew(false); setNewClaimPolicyId(""); }}><X size={18} /></button><p className="eyebrow">START A CLAIM</p><h2>What happened?</h2><p className="modal-copy">Choose a claim type to begin building your file.</p>{data.policies?.length > 0 && <label style={{ display: "block", marginBottom: 16, fontSize: 11, fontWeight: 600 }}>Which policy is this for? (optional)<select value={newClaimPolicyId} onChange={(e) => setNewClaimPolicyId(e.target.value)} data-testid="new-claim-policy-select" style={{ display: "block", width: "100%", marginTop: 6, padding: 10, borderRadius: 6, border: "1px solid var(--line)", fontSize: 12 }}><option value="">Not sure yet</option>{data.policies.map((p) => <option key={p.id} value={p.id}>{p.insurer_name} · {p.policy_type}</option>)}</select></label>}<div className="claim-options"><button data-testid="cashless-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New hospitalisation claim", claim_type: "Cashless", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); openClaim(response.data.id); notify("Cashless claim saved"); } catch (err) { notify(apiError(err), true); } }}><Stethoscope size={20} /><strong>Cashless hospitalisation</strong><small>For planned or emergency care</small></button><button data-testid="reimbursement-claim-option" onClick={async () => { try { const response = await client.post(`/claims`, { title: "New reimbursement claim", claim_type: "Reimbursement", policy_id: newClaimPolicyId || null }); setData({ ...data, claims: [response.data, ...data.claims] }); setShowNew(false); setNewClaimPolicyId(""); openClaim(response.data.id); notify("Reimbursement claim saved"); } catch (err) { notify(apiError(err), true); } }}><ClipboardCheck size={20} /><strong>Reimbursement</strong><small>For expenses already paid</small></button></div></div></div>}
    {toast && (
      <div className={toast.isError ? "toast toast-error" : "toast"} role="status" data-testid="toast-message">
        {toast.isError ? <AlertTriangle size={16} /> : <Check size={16} />}
        {toast.message}
      </div>
    )}
    {openClaimId && <ClaimDetail claimId={openClaimId} canEdit={canEdit} onClose={() => window.history.back()} onChange={refreshDashboard} notify={notify} />}

    {adminStatsOpen && (
      <div className="modal-backdrop" data-testid="admin-stats-modal">
        <div className="modal">
          <button className="close-button" aria-label="Close" data-testid="close-admin-stats-button" onClick={() => setAdminStatsOpen(false)}><X size={18} /></button>
          <p className="eyebrow">ADMIN · PLATFORM-WIDE</p>
          <h2>Usage stats</h2>
          {!adminStats ? (
            <p className="readonly-hint">Loading…</p>
          ) : (
            <>
              <p className="readonly-hint" style={{ marginBottom: 18 }}>Across every household on Coversfolio, not just yours. As of {new Date(adminStats.generated_at).toLocaleString("en-IN")}.</p>
              <div className="card-grid" style={{ marginBottom: 6 }}>
                <article className="entry" data-testid="admin-stat-households"><strong style={{ fontSize: 12 }}>Households</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.households.total}</p></article>
                <article className="entry" data-testid="admin-stat-users"><strong style={{ fontSize: 12 }}>Total users</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.users.total}</p></article>
                <article className="entry" data-testid="admin-stat-active-7d"><strong style={{ fontSize: 12 }}>Active (7 days)</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.users.active_last_7_days}</p></article>
                <article className="entry" data-testid="admin-stat-active-30d"><strong style={{ fontSize: 12 }}>Active (30 days)</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.users.active_last_30_days}</p></article>
                <article className="entry" data-testid="admin-stat-signups-7d"><strong style={{ fontSize: 12 }}>New signups (7 days)</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.users.signups_last_7_days}</p></article>
                <article className="entry" data-testid="admin-stat-signups-30d"><strong style={{ fontSize: 12 }}>New signups (30 days)</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.users.signups_last_30_days}</p></article>
                <article className="entry" data-testid="admin-stat-policies"><strong style={{ fontSize: 12 }}>Policies tracked</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.policies.total}</p></article>
                <article className="entry" data-testid="admin-stat-claims"><strong style={{ fontSize: 12 }}>Claims total</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.claims.total}<small style={{ display: "block", fontSize: 10, fontWeight: 500, color: "var(--muted)" }}>{adminStats.claims.in_progress} in progress</small></p></article>
                <article className="entry" data-testid="admin-stat-documents"><strong style={{ fontSize: 12 }}>Documents stored</strong><p style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>{adminStats.documents.total}</p></article>
              </div>
              {adminStats.users.never_logged_in > 0 && (
                <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>{adminStats.users.never_logged_in} user{adminStats.users.never_logged_in === 1 ? "" : "s"} signed up before login tracking started and haven't logged in since - not counted as active until their next login.</p>
              )}
            </>
          )}
        </div>
      </div>
    )}
  </div>;
}
export default App;