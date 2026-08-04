"use client";

import { FormEvent, useState } from "react";

export function OwnerRecoveryForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/recover-owner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        recoveryCode: form.get("recoveryCode"),
        password: form.get("password"),
        confirmPassword: form.get("confirmPassword"),
      }),
    }).catch(() => null);
    if (!response?.ok) {
      const result = response ? await response.json().catch(() => null) as { error?: string } | null : null;
      setError(result?.error ?? "Unable to reset the password. Check the recovery code and try again.");
      setBusy(false);
      return;
    }
    setComplete(true);
    window.setTimeout(() => window.location.replace("/login"), 1200);
  }

  if (complete) {
    return <div className="recovery-success" role="status"><span>✓</span><strong>Password updated</strong><p>Returning you to the secure sign-in screen…</p></div>;
  }

  return <form className="login-form recovery-form" onSubmit={submit}>
    <label>Owner email
      <input name="email" type="email" autoCapitalize="none" autoComplete="email" placeholder="you@example.com" maxLength={254} required />
    </label>
    <label>One-time recovery code
      <input name="recoveryCode" type="password" autoCapitalize="none" autoComplete="one-time-code" placeholder="Enter your private recovery code" minLength={16} maxLength={128} required />
    </label>
    <label>New password
      <input name="password" type="password" autoComplete="new-password" placeholder="At least 10 characters" minLength={10} required />
    </label>
    <label>Confirm new password
      <input name="confirmPassword" type="password" autoComplete="new-password" placeholder="Enter the password again" minLength={10} required />
    </label>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="login-submit" type="submit" disabled={busy}>{busy ? "Securing account…" : "Reset owner password"}</button>
  </form>;
}
