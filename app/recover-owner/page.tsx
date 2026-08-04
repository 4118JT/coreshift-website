import Link from "next/link";
import { OwnerRecoveryForm } from "./recovery-form";

export const dynamic = "force-dynamic";

export default function OwnerRecoveryPage() {
  return (
    <main className="login-page recovery-page">
      <section className="login-shell">
        <div className="login-brand"><span className="brand-mark"><i /><i /><i /></span><span className="brand-lockup"><strong>Core<span>Shift</span></strong><small>Workforce management</small></span></div>
        <div className="login-copy">
          <p className="eyebrow">Secure owner recovery</p>
          <h1>Choose a new password</h1>
          <p>Enter the one-time recovery code provided for your owner account. The code expires permanently after one successful reset.</p>
        </div>
        <OwnerRecoveryForm />
        <Link className="login-account-switch recovery-back-link" href="/login">← Back to sign in</Link>
      </section>
      <aside className="login-art recovery-art" aria-hidden="true">
        <div className="recovery-shield">✓</div>
        <div className="login-quote"><strong>Private by design.</strong><span>Your password is encrypted before it is saved, and existing sessions are signed out.</span></div>
      </aside>
    </main>
  );
}
