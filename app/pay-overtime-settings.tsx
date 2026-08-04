"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type SettingsTarget = "general" | "time" | "access" | "owners" | "notifications" | "billing" | "scheduling" | "pay";

type PaySettings = {
  payPeriod: string;
  payDay: string;
  frequency: string;
  rounding: string;
  threshold: string;
  dailyThreshold: string;
  dailyOvertime: boolean;
  doubleTime: boolean;
  rule: string;
  approval: boolean;
  notify: boolean;
  differentRates: boolean;
  individualRates: boolean;
  payPeriodStarts: string;
  currency: string;
  timeZone: string;
  doubleTimeThreshold: string;
  overtimeEnabled: boolean;
  overtimeDisabled: boolean;
  overtimeApplies: string;
  approvalMode: string;
  eligibility: string;
  holidayPay: string;
  weekendPremium: string;
  nightShiftDifferential: string;
};

const defaults: PaySettings = {
  payPeriod: "Weekly (Sunday - Saturday)",
  payDay: "Friday",
  frequency: "Weekly",
  rounding: "15 minutes (0.25)",
  threshold: "40",
  dailyThreshold: "8",
  dailyOvertime: true,
  doubleTime: false,
  rule: "Time and a half (1.5x)",
  approval: true,
  notify: true,
  differentRates: true,
  individualRates: true,
  payPeriodStarts: "Sunday",
  currency: "USD ($)",
  timeZone: "Central Time (CT)",
  doubleTimeThreshold: "12",
  overtimeEnabled: true,
  overtimeDisabled: false,
  overtimeApplies: "all",
  approvalMode: "Manager approval required",
  eligibility: "hourly",
  holidayPay: "2x",
  weekendPremium: "None",
  nightShiftDifferential: "$2.00 / hr",
};

export default function PersistentPayOvertimeSettingsPage({ flash, onNavigate }: { flash: (message: string) => void; onNavigate: (target: SettingsTarget) => void }) {
  const [settings, setSettings] = useState<PaySettings>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    fetch("/api/settings/pay", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { settings?: Partial<PaySettings>; error?: string } | null;
        if (!response.ok || !payload?.settings) throw new Error(payload?.error ?? "Pay settings could not be loaded.");
        setSettings({ ...defaults, ...payload.settings });
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoaded(true));
  }, []);

  async function saveSettings(snapshot = settingsRef.current, announce = false) {
    setSaving(true);
    setError("");
    const response = await fetch("/api/settings/pay", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: snapshot }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) as { settings?: PaySettings; error?: string } | null : null;
    if (!response?.ok || !payload?.settings) {
      const message = payload?.error ?? "Pay settings could not be saved.";
      setError(message);
      setSaving(false);
      flash(message);
      return;
    }
    if (JSON.stringify(settingsRef.current) === JSON.stringify(snapshot)) setDirty(false);
    setSaving(false);
    if (announce) flash("Pay and overtime settings saved.");
  }

  useEffect(() => {
    if (!loaded || !dirty) return;
    const timer = window.setTimeout(() => { void saveSettings(settings); }, 700);
    return () => window.clearTimeout(timer);
  }, [settings, loaded, dirty]);

  function update<K extends keyof PaySettings>(key: K, value: PaySettings[K]) {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      if (key === "payPeriod") {
        const period = String(value);
        next.frequency = period.startsWith("Biweekly") ? "Biweekly" : period.startsWith("Weekly") ? "Weekly" : period;
      }
      if (key === "frequency") {
        const frequency = String(value);
        next.payPeriod = frequency === "Biweekly" ? "Biweekly (Sunday - Saturday)" : frequency === "Weekly" ? "Weekly (Sunday - Saturday)" : frequency;
      }
      return next;
    });
    setDirty(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveSettings(settingsRef.current, true);
  }

  const nav: Array<[string, string, SettingsTarget]> = [
    ["O", "Organization", "general"], ["B", "Billing & Subscription", "billing"], ["L", "Locations", "general"],
    ["R", "Roles & Permissions", "access"], ["T", "Time & Attendance", "time"], ["S", "Scheduling", "scheduling"],
    ["$", "Pay & Overtime", "pay"], ["N", "Notifications", "notifications"], ["I", "Integrations", "general"],
    ["A", "Account", "owners"], ["S", "Security", "access"],
  ];

  const Toggle = ({ setting, label, description }: { setting: keyof Pick<PaySettings, "dailyOvertime" | "doubleTime" | "approval" | "notify" | "differentRates" | "individualRates" | "overtimeEnabled">; label: string; description: string }) => (
    <label className="pay-toggle"><input type="checkbox" checked={settings[setting]} onChange={(event) => update(setting, event.target.checked)} disabled={!loaded || saving} /><span className="pay-switch" /><span><strong>{label}</strong><small>{description}</small></span></label>
  );

  return <div className="settings-reference">
    <aside className="settings-reference-nav"><div className="settings-ref-nav-list">{nav.map(([icon, title, target]) => <button type="button" className={target === "pay" ? "active" : ""} key={title} onClick={() => onNavigate(target)}><span>{icon}</span><div><strong>{title}</strong><small>{title === "Pay & Overtime" ? "Pay rates and overtime rules" : "Settings and preferences"}</small></div></button>)}</div><div className="settings-ref-promo"><strong>Pay your team with confidence</strong><p>Every change is saved to your shared workspace.</p></div></aside>
    <form className="settings-reference-main pay-settings-page" onSubmit={submit}>
      <header className="pay-settings-header"><div><h1>Pay &amp; Overtime</h1><p>Manage pay periods, overtime rules, and premium pay for your team.</p></div><button className="primary-button" type="submit" disabled={!loaded || saving}>{saving ? "Saving..." : "Save Changes"}</button></header>
      {!loaded && <section className="pay-settings-card"><p>Loading pay settings...</p></section>}
      {error && <p className="owner-form-error" role="alert">{error}</p>}
      <section className="pay-settings-card"><h2>Company Pay Settings</h2><div className="pay-settings-grid">
        <label>Default Pay Frequency<select value={settings.frequency} onChange={(event) => update("frequency", event.target.value)} disabled={!loaded}><option>Weekly</option><option>Biweekly</option><option>Semi-monthly</option><option>Monthly</option></select></label>
        <label>Pay Period Starts<select value={settings.payPeriodStarts} onChange={(event) => update("payPeriodStarts", event.target.value)} disabled={!loaded}><option>Sunday</option><option>Monday</option><option>Saturday</option></select></label>
        <label>Pay Day<select value={settings.payDay} onChange={(event) => update("payDay", event.target.value)} disabled={!loaded}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day) => <option key={day}>{day}</option>)}</select></label>
        <label>Default Currency<select value={settings.currency} onChange={(event) => update("currency", event.target.value)} disabled={!loaded}><option>USD ($)</option><option>CAD ($)</option><option>EUR</option></select></label>
        <label>Time Zone<select value={settings.timeZone} onChange={(event) => update("timeZone", event.target.value)} disabled={!loaded}><option>Central Time (CT)</option><option>Eastern Time (ET)</option><option>Mountain Time (MT)</option><option>Pacific Time (PT)</option></select></label>
      </div></section>
      <section className="pay-settings-card"><h2>Pay Settings</h2><div className="pay-settings-grid">
        <label>Default Pay Period<select value={settings.payPeriod} onChange={(event) => update("payPeriod", event.target.value)} disabled={!loaded}><option>Weekly (Sunday - Saturday)</option><option>Biweekly (Sunday - Saturday)</option><option>Semi-monthly</option><option>Monthly</option></select></label>
        <label>Rounding<select value={settings.rounding} onChange={(event) => update("rounding", event.target.value)} disabled={!loaded}><option>Exact time</option><option>5 minutes (0.08)</option><option>15 minutes (0.25)</option><option>30 minutes (0.5)</option></select></label>
        <Toggle setting="differentRates" label="Allow different rates by role / position" description="Enable custom pay rates for different roles." />
        <Toggle setting="individualRates" label="Allow individual pay rate overrides" description="Set custom rates per employee." />
      </div></section>
      <section className="pay-settings-card"><h2>Overtime Settings</h2><div className="pay-settings-grid">
        <Toggle setting="overtimeEnabled" label="Overtime enabled" description="Calculate overtime using the rules below." />
        <label>Overtime Rule<select value={settings.rule} onChange={(event) => update("rule", event.target.value)} disabled={!loaded || !settings.overtimeEnabled}><option>Time and a half (1.5x)</option><option>Double time (2x)</option><option>Custom multiplier</option></select></label>
        <label>Weekly Threshold<div className="pay-input-suffix"><input type="number" min="0" value={settings.threshold} onChange={(event) => update("threshold", event.target.value)} disabled={!loaded || !settings.overtimeEnabled} /><span>hours / week</span></div></label>
        <Toggle setting="dailyOvertime" label="Daily Overtime" description="Enable overtime after a daily threshold." />
        <label>Daily Threshold<div className="pay-input-suffix"><input type="number" min="0" value={settings.dailyThreshold} onChange={(event) => update("dailyThreshold", event.target.value)} disabled={!loaded || !settings.overtimeEnabled} /><span>hours / day</span></div></label>
        <Toggle setting="doubleTime" label="Double Time" description="Enable double time after the threshold." />
        <label>Double Time Threshold<div className="pay-input-suffix"><input type="number" min="0" value={settings.doubleTimeThreshold} onChange={(event) => update("doubleTimeThreshold", event.target.value)} disabled={!loaded || !settings.overtimeEnabled || !settings.doubleTime} /><span>hours / day</span></div></label>
        <fieldset><legend>Overtime Applies To</legend>{[["all", "All employees"], ["nonExempt", "Non-exempt employees only"], ["custom", "Custom"]].map(([value, label]) => <label key={value}><input type="radio" name="overtime-applies" value={value} checked={settings.overtimeApplies === value} onChange={() => update("overtimeApplies", value)} disabled={!loaded} /> {label}</label>)}</fieldset>
        <Toggle setting="approval" label="Overtime Approval" description="Require approval for overtime hours." />
        <label>Approval Mode<select value={settings.approvalMode} onChange={(event) => update("approvalMode", event.target.value)} disabled={!loaded || !settings.approval}><option>Manager approval required</option><option>Owner approval required</option><option>No approval required</option></select></label>
        <Toggle setting="notify" label="Overtime Notifications" description="Notify owners when overtime is worked." />
      </div></section>
      <section className="pay-settings-card"><h2>Premium Pay</h2><div className="pay-settings-grid">
        <label>Holiday Pay<select value={settings.holidayPay} onChange={(event) => update("holidayPay", event.target.value)} disabled={!loaded}><option>2x</option><option>1.5x</option><option>None</option></select></label>
        <label>Weekend Premium<select value={settings.weekendPremium} onChange={(event) => update("weekendPremium", event.target.value)} disabled={!loaded}><option>None</option><option>1.5x</option></select></label>
        <label>Night Shift Differential<input value={settings.nightShiftDifferential} onChange={(event) => update("nightShiftDifferential", event.target.value)} disabled={!loaded} /></label>
      </div></section>
      <div className="pay-info-banner"><div><strong>{dirty ? "Unsaved changes" : saveStatusLabel(saving, loaded, error)}</strong><p>{dirty ? "Your changes will auto-save shortly, or use Save Changes now." : "These settings are stored in the shared workspace database."}</p></div><button className="primary-button" type="submit" disabled={!loaded || saving}>{saving ? "Saving..." : "Save Changes"}</button></div>
    </form>
  </div>;
}

function saveStatusLabel(saving: boolean, loaded: boolean, error: string) {
  if (saving) return "Saving pay settings...";
  if (error) return "Pay settings need attention";
  if (!loaded) return "Loading pay settings...";
  return "Pay settings saved";
}
