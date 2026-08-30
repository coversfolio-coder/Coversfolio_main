import { useEffect, useRef, useState } from "react";
import client, { apiError } from "@/api";
import {
  AlertTriangle, Bell, BookOpen, Check, CheckCircle2, ChevronRight, ClipboardCheck,
  FileText, Home, LayoutDashboard, LifeBuoy, LogOut, Plus, Search, Settings, ShieldCheck,
  Stethoscope, Trash2, Upload, User as UserIcon, X, UserPlus, UserX, History
} from "lucide-react";
import "@/App.css";
import "@/Auth.css";
import "@/Members.css";
import "@/ClaimDetail.css";
import ClaimDetail from "@/ClaimDetail";
import PoliciesPage from "@/PoliciesPage";
import EvidencePage from "@/EvidencePage";
import DocumentsPage from "@/DocumentsPage";


// Shown instantly while /public/landing-stats loads (or if it fails) - kept
// identical to the backend's own fallback so there's no visible content swap
// for most visitors; the backend copy is the one an admin can actually edit.
const DEFAULT_LANDING_STATS = [
  { value: "11%", label: "of health insurance claims were disallowed by insurers in FY24, per IRDAI's own Annual Report." },
  { value: "32%", label: "of reimbursement rejections trace back to incomplete or illegible discharge summaries - a paperwork problem, not a medical one." },
  { value: "₹26,000cr", label: "in health claims were held back by insurers that year alone, industry-wide." },
  { value: "3.7%", label: "is India's insurance penetration rate - most households are underinsured for what a real hospitalization costs." },
];

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

function FAQItem({ question, answer, testId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item" data-testid={testId}>
      <button type="button" className="faq-question" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{question}</span>
        <span className="faq-toggle">{open ? "−" : "+"}</span>
      </button>
      {open && <p className="faq-answer">{answer}</p>}
    </div>
  );
}

function StatsCarousel({ stats }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (paused || reducedMotion || stats.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % stats.length), 4500);
    return () => clearInterval(id);
  }, [paused, reducedMotion, stats.length]);

  useEffect(() => { setIndex(0); }, [stats]);

  if (stats.length === 0) return null;
  const current = stats[index];

  return (
    <div className="stat-flashcard-wrap" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} data-testid="landing-stats-carousel">
      <div className="stat-flashcard" key={index} data-testid={`landing-stat-${index}`}>
        <strong>{current.value}</strong>
        <span>{current.label}</span>
      </div>
      {stats.length > 1 && (
        <div className="stat-flashcard-dots">
          {stats.map((_, i) => (
            <button
              key={i} type="button" className={`stat-flashcard-dot ${i === index ? "active" : ""}`}
              onClick={() => setIndex(i)} aria-label={`Show stat ${i + 1}`} data-testid={`landing-stat-dot-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroIllustration() {
  return (
    <div className="hero-illustration" aria-hidden="true">
      <svg viewBox="0 0 600 300" className="hero-illustration-svg">
        {/* Compiled claim folder */}
        <g className="hero-folder">
          <rect x="330" y="70" width="60" height="18" rx="5" fill="#22315C" />
          <rect x="330" y="82" width="200" height="150" rx="14" fill="#22315C" />
          <rect x="358" y="118" width="144" height="10" rx="5" fill="#4A5C8F" />
          <rect x="358" y="142" width="144" height="10" rx="5" fill="#4A5C8F" />
          <rect x="358" y="166" width="96" height="10" rx="5" fill="#4A5C8F" />
        </g>
        <g className="hero-badge">
          <circle cx="500" cy="90" r="26" fill="#1F7A5C" />
          <path d="M488 90 L497 99 L514 80" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>

        {/* Floating documents, each with its own animation delay */}
        <g className="hero-doc hero-doc-1">
          <rect x="60" y="60" width="92" height="118" rx="10" fill="#FFFFFF" stroke="#DCDFE6" strokeWidth="1.5" />
          <rect x="76" y="80" width="60" height="9" rx="4" fill="#A9781F" />
          <rect x="76" y="100" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="76" y="114" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="76" y="128" width="40" height="6" rx="3" fill="#DCDFE6" />
        </g>
        <g className="hero-doc hero-doc-2">
          <rect x="120" y="150" width="92" height="118" rx="10" fill="#FFFFFF" stroke="#DCDFE6" strokeWidth="1.5" />
          <rect x="136" y="170" width="60" height="9" rx="4" fill="#1F7A5C" />
          <rect x="136" y="190" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="136" y="204" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="136" y="218" width="40" height="6" rx="3" fill="#DCDFE6" />
        </g>
        <g className="hero-doc hero-doc-3">
          <rect x="15" y="150" width="92" height="118" rx="10" fill="#FFFFFF" stroke="#DCDFE6" strokeWidth="1.5" />
          <rect x="31" y="170" width="60" height="9" rx="4" fill="#22315C" />
          <rect x="31" y="190" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="31" y="204" width="60" height="6" rx="3" fill="#DCDFE6" />
          <rect x="31" y="218" width="40" height="6" rx="3" fill="#DCDFE6" />
        </g>
      </svg>
    </div>
  );
}

function LandingPage({ onGetStarted, onLogin }) {
  const [stats, setStats] = useState(DEFAULT_LANDING_STATS);
  useEffect(() => {
    client.get("/public/landing-stats").then((r) => { if (r.data.stats?.length > 0) setStats(r.data.stats); }).catch(() => {});
  }, []);

  return (
    <div className="landing" data-testid="landing-page">
      <header className="landing-topbar">
        <div className="wordmark"><img className="brand-icon-sm" src="/brand-icon.png" alt="Coversfolio" /><span>Coversfolio</span></div>
        <div className="landing-topbar-actions">
          <button className="btn" onClick={onLogin} data-testid="landing-login-button">Log in</button>
          <button className="btn primary" onClick={onGetStarted} data-testid="landing-get-started-button">Get started free</button>
        </div>
      </header>

      <section className="landing-hero">
        <p className="landing-eyebrow">FOR INDIAN HOUSEHOLDS</p>
        <h1>Your claim shouldn't get rejected<br />over a missing form.</h1>
        <p className="landing-lede">
          Coversfolio organizes your insurance policies and compiles exactly what your insurer needs to process a claim -
          so paperwork isn't what costs your family the payout you're owed.
        </p>
        <div className="landing-hero-actions">
          <button className="btn primary large" onClick={onGetStarted} data-testid="landing-hero-cta">Get started free</button>
        </div>
        <HeroIllustration />
      </section>

      <StatsCarousel stats={stats} />

      <section className="landing-features">
        <p className="landing-section-label">WHAT WE ACTUALLY DO</p>
        <div className="landing-feature-grid">
          <div className="landing-feature">
            <BookOpen size={19} />
            <strong>One place for every policy</strong>
            <p>Sum insured, renewal dates, and who's covered - tracked automatically, no more digging through email.</p>
          </div>
          <div className="landing-feature">
            <Search size={19} />
            <strong>Plain-language policy analysis</strong>
            <p>Maternity cover, waiting periods, and exclusions explained - not buried in 40 pages of fine print.</p>
          </div>
          <div className="landing-feature">
            <FileText size={19} />
            <strong>A real claim compiler</strong>
            <p>Bills sorted automatically, a field-by-field cheat sheet matching the insurer's own form, and the right checklist for Cashless or Reimbursement.</p>
          </div>
          <div className="landing-feature">
            <ShieldCheck size={19} />
            <strong>Know your rights, verified</strong>
            <p>IRDAI mandates a 1-hour cashless decision and a 30-day reimbursement settlement, with 2% interest owed if insurers miss it. We show you the real rule, cited.</p>
          </div>
        </div>
      </section>

      <section className="landing-privacy">
        <div className="privacy-icon-wrap" aria-hidden="true">
          <span className="privacy-ring privacy-ring-1"></span>
          <span className="privacy-ring privacy-ring-2"></span>
          <ShieldCheck size={22} />
        </div>
        <div>
          <strong>Private by design.</strong>
          <p>Your documents stay yours. We compile your claim file - we don't sell insurance, settle claims, or act as your insurer's intermediary, and we never sell your data.</p>
        </div>
      </section>

      <section className="landing-faq">
        <p className="landing-section-label">FREQUENTLY ASKED QUESTIONS</p>

        <p className="faq-group-label">About Coversfolio</p>
        <div className="faq-list">
          <FAQItem
            testId="faq-free"
            question="Is Coversfolio free to use?"
            answer="Yes. Tracking policies, storing documents, and compiling your claim checklist and cheat sheet are free. We're not selling insurance or taking a commission on anything you do here."
          />
          <FAQItem
            testId="faq-sell-insurance"
            question="Does Coversfolio sell insurance or connect me with an insurer?"
            answer="No. We don't sell policies, act as a broker or agent, or get paid by any insurer. We organize what you already have and help you compile the paperwork - the insurer relationship stays entirely between you and your provider."
          />
          <FAQItem
            testId="faq-file-claim"
            question="Does Coversfolio file the claim for me?"
            answer="No - and that's deliberate. We compile your documents, sort your bills, and fill in a field-by-field reference matching your insurer's own form. You (or your hospital's TPA desk) still submit the actual claim - we never contact your insurer on your behalf."
          />
          <FAQItem
            testId="faq-data-safe"
            question="Is my data safe and private?"
            answer="Your documents and policy details are only visible to the household members you explicitly invite. We don't sell or share your data with insurers, advertisers, or anyone else."
          />
          <FAQItem
            testId="faq-family"
            question="Can my whole family use one account?"
            answer="Yes. You can invite household members to help prepare a claim together, or add a read-only agent (like someone helping an elderly parent) who can view but not change anything."
          />
        </div>

        <p className="faq-group-label">About your insurance</p>
        <div className="faq-list">
          <FAQItem
            testId="faq-cashless-vs-reimbursement"
            question="What's the difference between Cashless and Reimbursement claims?"
            answer="Cashless means your insurer settles directly with the hospital (usually at a network hospital) - you don't pay upfront. Reimbursement means you pay the hospital yourself first, then claim the money back from your insurer afterward using your bills and receipts."
          />
          <FAQItem
            testId="faq-cashless-timeline"
            question="How long does an insurer have to approve a cashless request?"
            answer="Under IRDAI's Master Circular on Health Insurance Business (29 May 2024), insurers must decide on a complete cashless pre-authorization request within 1 hour, and give final discharge authorization within 3 hours."
          />
          <FAQItem
            testId="faq-reimbursement-timeline"
            question="How long does a reimbursement claim take to settle?"
            answer="Per IRDA's Protection of Policyholders' Interests Regulations, insurers must pay or give written reasons for disputing a claim within 30 days of receiving all your documents - up to 45 days if they need to investigate. If they're late, they owe you interest at 2% above the applicable bank rate."
          />
          <FAQItem
            testId="faq-repeat-document-requests"
            question="Can an insurer keep asking me for more documents, again and again?"
            answer="They're not supposed to. The same regulations require insurers to ask for everything they need within 15 days of receiving your claim, in one go - not through several separate rounds of requests."
          />
          <FAQItem
            testId="faq-waiting-period"
            question="What is a waiting period?"
            answer="A length of time after your policy starts during which certain conditions aren't covered yet - commonly a shorter period for the policy overall, and a longer one (often a few years) specifically for pre-existing diseases. The exact duration varies by insurer and policy, so always check your own policy document."
          />
          <FAQItem
            testId="faq-sublimit"
            question="What is a room rent sub-limit, and why does it matter?"
            answer="Many policies cap how much they'll pay per day for your hospital room. If you choose a room above that cap, insurers often reduce the rest of the bill proportionally too - not just the room charge - which is one of the most common reasons a claim payout ends up smaller than expected."
          />
          <FAQItem
            testId="faq-documents-needed"
            question="What documents does a typical claim need?"
            answer="Usually your policy document, ID proof, hospital discharge summary, and itemized bills - with reimbursement claims also needing payment receipts. The exact list varies by insurer and claim type, which is exactly what Coversfolio's checklist is built to sort out for you."
          />
        </div>
      </section>

      <section className="landing-cta">
        <h2>Ready to get your paperwork right the first time?</h2>
        <button className="btn primary large" onClick={onGetStarted} data-testid="landing-footer-cta">Get started free</button>
      </section>

      <footer className="landing-footer">
        <span>Sources: IRDAI Annual Report (via Business Standard); industry claim-rejection analyses, 2025-26.</span>
      </footer>
    </div>
  );
}

function AuthScreen({ onAuthenticated, initialMode = "login", onBack }) {
  const [mode, setMode] = useState(initialMode); // "login" | "register" | "forgot" | "reset"
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
        {onBack && <button type="button" className="auth-back-link" onClick={onBack} data-testid="auth-back-button">← Back to home</button>}
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
            {mode === "register" && (
              <label className="auth-consent-inline" data-testid="consent-field">
                <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} data-testid="consent-checkbox" />
                I agree to the Privacy Policy and Terms of Service
              </label>
            )}
            {mode === "login" || consent ? (
              <GoogleSignInButton onAuthenticated={onAuthenticated} onError={setError} consentGiven={mode === "login" || consent} />
            ) : (
              <p className="empty-hint" data-testid="google-consent-gate" style={{ marginBottom: 8 }}>Check the box above to continue with Google.</p>
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
          <div className="account-menu-privacy" data-testid="privacy-note"><ShieldCheck size={14} /><span>Your files stay private - encrypted and only shared by you</span></div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [data, setData] = useState(fallback);
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authEntryMode, setAuthEntryMode] = useState(() => (new URLSearchParams(window.location.search).get("token") ? "login" : null));
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
  const [landingStatsEdit, setLandingStatsEdit] = useState(null);
  const [savingLandingStats, setSavingLandingStats] = useState(false);
  const openAdminStats = async () => {
    setAdminStatsOpen(true);
    setAdminStats(null);
    try {
      const res = await client.get("/admin/stats");
      setAdminStats(res.data);
      const statsRes = await client.get("/public/landing-stats");
      setLandingStatsEdit(statsRes.data.stats);
    } catch (err) { notify(apiError(err), true); setAdminStatsOpen(false); }
  };
  const saveLandingStats = async () => {
    setSavingLandingStats(true);
    try {
      await client.put("/admin/landing-stats", { stats: landingStatsEdit });
      notify("Landing page stats updated");
    } catch (err) { notify(apiError(err), true); } finally { setSavingLandingStats(false); }
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
  if (!user) {
    if (!authEntryMode) return <LandingPage onGetStarted={() => setAuthEntryMode("register")} onLogin={() => setAuthEntryMode("login")} />;
    return <AuthScreen onAuthenticated={setUser} initialMode={authEntryMode} onBack={() => setAuthEntryMode(null)} />;
  }

  return <div className="app-shell">
    <main className="main-content">
      <header className="topbar">
        <div className="wordmark" data-testid="brand-mark">
          <img className="brand-icon-sm" src="/brand-icon.png" alt="Coversfolio" />
          <span>Coversfolio</span>
        </div>
        <nav className="nav" data-testid="main-navigation">
          {navItems.map(({ label, id }) => (
            <a key={id} data-testid={`nav-${id}`} className={active === id ? "active" : ""} onClick={() => navigate(id)}>{label}</a>
          ))}
          <a data-testid="nav-household" onClick={openMembers}>Members</a>
        </nav>
        <div className="nav-right">
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

          <span className="household-pill" data-testid="household-switcher">{data.household.name}</span>
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

              <div style={{ borderTop: "1px solid var(--line)", marginTop: 22, paddingTop: 18 }}>
                <p className="eyebrow">LANDING PAGE</p>
                <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Stat flashcards</h3>
                <p className="readonly-hint" style={{ marginBottom: 14 }}>Shown to logged-out visitors on the homepage. Update these as new IRDAI figures come out - no code changes or redeploy needed.</p>
                {!landingStatsEdit ? (
                  <p className="readonly-hint">Loading…</p>
                ) : (
                  <>
                    {landingStatsEdit.map((s, i) => (
                      <div key={i} className="row-2" style={{ marginBottom: 10 }} data-testid={`landing-stat-edit-${i}`}>
                        <label style={{ fontSize: 11 }}>Value
                          <input
                            value={s.value} placeholder="e.g. 11%"
                            onChange={(e) => setLandingStatsEdit((prev) => prev.map((p, pi) => pi === i ? { ...p, value: e.target.value } : p))}
                            data-testid={`landing-stat-value-${i}`}
                          />
                        </label>
                        <label style={{ fontSize: 11 }}>Description
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              value={s.label} placeholder="What this number means"
                              onChange={(e) => setLandingStatsEdit((prev) => prev.map((p, pi) => pi === i ? { ...p, label: e.target.value } : p))}
                              data-testid={`landing-stat-label-${i}`}
                            />
                            {landingStatsEdit.length > 1 && (
                              <button type="button" className="icon-button" aria-label="Remove stat" onClick={() => setLandingStatsEdit((prev) => prev.filter((_, pi) => pi !== i))} data-testid={`remove-landing-stat-${i}`}><Trash2 size={14} /></button>
                            )}
                          </div>
                        </label>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                      {landingStatsEdit.length < 8 && (
                        <button type="button" className="text-button" style={{ margin: 0 }} onClick={() => setLandingStatsEdit((prev) => [...prev, { value: "", label: "" }])} data-testid="add-landing-stat-button">
                          <Plus size={13} /> Add stat
                        </button>
                      )}
                      <button type="button" className="primary-button" style={{ marginLeft: "auto" }} disabled={savingLandingStats} onClick={saveLandingStats} data-testid="save-landing-stats-button">
                        {savingLandingStats ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )}
  </div>;
}
export default App;