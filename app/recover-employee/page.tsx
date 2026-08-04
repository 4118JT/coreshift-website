import Link from "next/link";
import { EmployeeRecoveryForm } from "./recovery-form";

export const dynamic = "force-dynamic";

export default function EmployeeRecoveryPage() {
  return <main className="login-page recovery-page"><section className="login-shell">
    <div className="login-brand"><span className="brand-mark"><i /><i /><i /></span><span className="brand-lockup"><strong>Core<span>Shift</span></strong><small>Workforce management</small></span></div>
    <div className="login-copy"><p className="eyebrow">Employee account recovery</p><h1>Choose a new password</h1><p>Use your work email and the 8-digit company code provided by your owner.</p></div>
    <EmployeeRecoveryForm />
    <Link className="login-account-switch recovery-back-link" href="/login">← Back to sign in</Link>
  </section><aside className="login-art recovery-art" aria-hidden="true"><div className="recovery-shield">✓</div><div className="login-quote"><strong>Private by design.</strong><span>Your existing sessions are signed out after a password reset.</span></div></aside></main>;
}
