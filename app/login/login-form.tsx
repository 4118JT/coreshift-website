"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Screen = "choose" | "signin" | "join" | "create";

export function LoginForm({ nextPath = "/" }: { initialMode?: "owner" | "employee"; initialBusinessId?: string; nextPath?: string }) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const go = (next: Screen) => { setScreen(next); setError(""); setShowPassword(false); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "auto", identifier: form.get("identifier"), secret: form.get("secret") }),
    }).catch(() => null);
    if (!response?.ok) { const result = response ? await response.json().catch(() => null) as { error?: string } | null : null; setError(result?.error ?? "Unable to sign in. Please try again."); setBusy(false); return; }
    window.location.assign(nextPath);
  }

  async function registerOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/register-owner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), businessName: form.get("businessName"), email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword") }) }).catch(() => null);
    if (!response?.ok) { const result = response ? await response.json().catch(() => null) as { error?: string } | null : null; setError(result?.error ?? "Unable to create your account. Please try again."); setBusy(false); return; }
    window.location.assign(nextPath);
  }

  async function joinEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/join-employee", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyCode: form.get("companyCode"), name: form.get("name"), email: form.get("email"), password: form.get("password"), confirmPassword: form.get("confirmPassword") }) }).catch(() => null);
    if (!response?.ok) { const result = response ? await response.json().catch(() => null) as { error?: string } | null : null; setError(result?.error ?? "Unable to join the company. Please try again."); setBusy(false); return; }
    window.location.assign(nextPath);
  }

  async function startDemo() {
    setBusy(true); const response = await fetch("/api/session/demo", { method: "POST" }).catch(() => null);
    if (!response?.ok) { setError("The demo could not be started. Please try again."); setBusy(false); return; }
    window.location.assign(nextPath);
  }

  const title = screen === "create" ? "Create your owner account" : screen === "join" ? "Join your company" : screen === "signin" ? "Sign in to CoreShift" : "Welcome back";
  const subtitle = screen === "create" ? "Create a private workspace for your business and start managing your team." : screen === "join" ? "Use the 8-digit company code your owner gave you to create your employee login." : screen === "signin" ? "Use one sign-in for owners, managers, and employees." : "Everything you need for today, all in one place.";

  return <main className="login-page">
    <section className="login-shell">
      <div className="login-brand"><span className="brand-mark"><i /><i /><i /></span><span className="brand-lockup"><strong>Core<span>Shift</span></strong><small>Workforce management</small></span></div>
      <div className="login-copy"><p className="eyebrow">Simple employee time tracking</p><h1>{title}</h1><p>{subtitle}</p></div>

      {screen === "choose" && <div className="login-choice-grid" aria-label="Account access options">
        <button type="button" className="login-choice-card" onClick={() => go("signin")}><span className="login-choice-icon">↗</span><strong>Sign in</strong><small>Access your CoreShift workspace</small></button>
        <button type="button" className="login-choice-card" onClick={() => go("join")}><span className="login-choice-icon">＋</span><strong>Join a company</strong><small>Use your company code to get started</small></button>
      </div>}

      {screen === "create" ? <><div className="login-form-heading"><strong>New business account</strong><span>Your team and time records stay separate from every other business.</span></div><form className="login-form" onSubmit={registerOwner}>
        <label>Business name<input name="businessName" autoComplete="organization" placeholder="Enter your business name" maxLength={120} required /></label><label>Full name<input name="name" autoComplete="name" placeholder="Enter your name" maxLength={100} required /></label><label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required /></label><label>Password<input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 10 characters" minLength={10} required /></label><label>Confirm password<input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Enter the password again" minLength={10} required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}<label className="password-visibility"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show passwords</label><button className="login-submit" type="submit" disabled={busy}>{busy ? "Creating business…" : "Create business account"}</button>
      </form></> : screen === "join" ? <><div className="login-form-heading"><strong>Create employee account</strong><span>Your owner provides the company code. Choose your own private password.</span></div><form className="login-form" onSubmit={joinEmployee}>
        <label>8-digit company code<input name="companyCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} placeholder="12345678" required /></label><label>Full name<input name="name" autoComplete="name" placeholder="Enter your name" maxLength={100} required /></label><label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required /></label><label>Create password<input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 10 characters" minLength={10} required /></label><label>Confirm password<input name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Enter the password again" minLength={10} required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}<label className="password-visibility"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show passwords</label><button className="login-submit" type="submit" disabled={busy}>{busy ? "Joining company…" : "Create employee account"}</button>
      </form></> : screen === "signin" ? <><div className="login-form-heading"><strong>Sign in</strong><span>Use your email and password, or your employee ID and access code.</span></div><form className="login-form" onSubmit={submit}>
        <label>Email or 8-digit employee access code<input name="identifier" autoCapitalize="none" autoComplete="username" placeholder="you@example.com or 12345678" required /></label><label>Password or access code<input name="secret" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}<label className="password-visibility"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Show password</label><button className="login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><div className="login-recovery-links"><Link className="forgot-password-link" href="/recover-owner">Forgot password?</Link><Link className="forgot-password-link" href="/recover-employee">Employee recovery</Link></div>
      </form></> : null}

      {screen !== "choose" && <button className="login-account-switch" type="button" onClick={() => go("choose")}>← <strong>Back to account options</strong></button>}
      {screen === "choose" && <button className="login-account-switch" type="button" onClick={() => go("create")}>New business? <strong>Create an account</strong></button>}
      <div className="demo-login-card"><div><strong>Explore a live demo</strong><span>No account, email, or data required. Demo changes are not saved.</span></div><button type="button" onClick={startDemo} disabled={busy}>{busy ? "Opening demo…" : "Try the demo"}</button></div>
    </section>
    <aside className="login-art" aria-hidden="true"><div className="login-clock"><span>0:00</span><small>No time recorded</small></div><div className="login-quote"><strong>Hours without the hassle.</strong><span>No payroll transfers. Just clear, accurate time tracking.</span></div></aside>
    <footer className="login-legal-footer"><span>By using CoreShift, your company accepts responsibility for the information and activity in its workspace.</span><span className="login-legal-links"><Link href="/terms">Terms &amp; Conditions</Link><Link href="/privacy">Privacy Policy</Link></span></footer>
  </main>;
}
