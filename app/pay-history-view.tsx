"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type HistoryEmployee = {
  id: number;
  name: string;
  role: string;
  initials: string;
  color: string;
  hourlyRateCents?: number;
};

type HistoryRow = {
  employee: HistoryEmployee;
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  dailyMinutes: number[];
  estimatedCents: number;
  paidCents: number;
  owedCents: number;
  status: "Paid" | "Partially paid" | "Unpaid";
};

type HistoryPeriod = {
  start: number;
  end: number;
  label: string;
  rows: HistoryRow[];
  estimatedCost: number;
  paidTotal: number;
  owedTotal: number;
  paidCount: number;
};

type ReportPayload = {
  selected?: {
    employeeReport?: Array<{
      id: number;
      name: string;
      role: string;
      initials: string;
      color: string;
      hourlyRateCents: number;
      minutes: number;
      dailyMinutes?: number[];
      paidCents: number;
    }>;
  };
};

type CurrentRow = {
  employee: HistoryEmployee;
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  estimatedCents: number;
};

type DayEntry = { id: number; clockIn: number; clockOut: number | null; note: string | null; dayMinutes?: number };

export default function PersistentPayHistoryView({ currentPayPeriod, currentPeriodStart, periodDays, payFrequency, currentRows, currentEstimatedCost, currentPaidIds, money, flash }: {
  currentPayPeriod: string;
  currentPeriodStart: number;
  periodDays: number;
  payFrequency: string;
  currentRows: CurrentRow[];
  currentEstimatedCost: number;
  currentPaidIds: number[];
  money: (cents: number) => string;
  flash: (message: string) => void;
}) {
  const [periods, setPeriods] = useState<HistoryPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [recordingPayment, setRecordingPayment] = useState("");
  const [dailyHoursFor, setDailyHoursFor] = useState("");
  const [selectedDay, setSelectedDay] = useState<{ key: string; start: number; end: number; employeeId: number; employeeName: string } | null>(null);
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DayEntry | null>(null);
  const [entryError, setEntryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => {
    const currentStart = currentPeriodStart;
    const ranges = Array.from({ length: 8 }, (_, index) => {
      const start = currentStart - index * periodDays * 24 * 60 * 60 * 1000;
      return { start, end: start + periodDays * 24 * 60 * 60 * 1000 - 1 };
    });
    Promise.all(ranges.map(async ({ start, end }, index) => {
      const query = new URLSearchParams({
        range: "custom",
        dayStart: String(start),
        weekStart: String(start),
        monthStart: String(start),
        yearStart: String(start),
        periodStart: String(start),
        periodEnd: String(end),
      });
      const response = await fetch(`/api/reports/expenses?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as ReportPayload & { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Pay history could not be loaded.");
      const rows = (payload?.selected?.employeeReport ?? []).filter((row) => row.minutes > 0 || row.paidCents > 0).map((row) => {
        const totalMinutes = Math.max(0, Math.round(row.minutes));
        const regularMinutes = Math.min(totalMinutes, periodDays === 14 ? 4800 : 2400);
        const overtimeMinutes = Math.max(0, totalMinutes - regularMinutes);
        const estimatedCents = Math.round((regularMinutes / 60) * row.hourlyRateCents + (overtimeMinutes / 60) * row.hourlyRateCents * 1.5);
        const status: HistoryRow["status"] = row.paidCents <= 0 ? "Unpaid" : row.paidCents >= estimatedCents ? "Paid" : "Partially paid";
        return { employee: { id: row.id, name: row.name, role: row.role || "Employee", initials: row.initials, color: row.color, hourlyRateCents: row.hourlyRateCents }, regularMinutes, overtimeMinutes, totalMinutes, dailyMinutes: row.dailyMinutes ?? Array.from({ length: periodDays }, () => 0), estimatedCents, paidCents: row.paidCents, owedCents: Math.max(0, estimatedCents - row.paidCents), status };
      });
      return { start, end, label: index === 0 ? currentPayPeriod : formatPeriod(start, end), rows, estimatedCost: rows.reduce((sum, row) => sum + row.estimatedCents, 0), paidTotal: rows.reduce((sum, row) => sum + row.paidCents, 0), owedTotal: rows.reduce((sum, row) => sum + row.owedCents, 0), paidCount: rows.filter((row) => row.status === "Paid").length };
    }))
      .then((results) => { setPeriods(results); setExpanded(new Set(results.length ? [results[0].start] : [])); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [currentPayPeriod, currentPeriodStart, periodDays, historyRefresh]);

  const fallbackPeriod = useMemo<HistoryPeriod>(() => ({
    start: 0,
    end: 0,
    label: currentPayPeriod,
    rows: currentRows.map((row) => ({ ...row, dailyMinutes: Array.from({ length: periodDays }, () => 0), paidCents: currentPaidIds.includes(row.employee.id) ? row.estimatedCents : 0, owedCents: currentPaidIds.includes(row.employee.id) ? 0 : row.estimatedCents, status: currentPaidIds.includes(row.employee.id) ? "Paid" : "Unpaid" })),
    estimatedCost: currentEstimatedCost,
    paidTotal: currentRows.filter((row) => currentPaidIds.includes(row.employee.id)).reduce((sum, row) => sum + row.estimatedCents, 0),
    owedTotal: currentRows.filter((row) => !currentPaidIds.includes(row.employee.id)).reduce((sum, row) => sum + row.estimatedCents, 0),
    paidCount: currentRows.filter((row) => currentPaidIds.includes(row.employee.id)).length,
  }), [currentEstimatedCost, currentPaidIds, currentPayPeriod, currentRows]);
  const displayPeriods = periods.length ? periods : [fallbackPeriod];
  const current = displayPeriods[0];
  const totalHours = current.rows.reduce((sum, row) => sum + row.totalMinutes, 0);
  const averageRate = totalHours ? current.estimatedCost / (totalHours / 60) : 0;
  const visibleHistory = displayPeriods.filter((period, index) => index === 0 || period.rows.length > 0);

  function togglePeriod(start: number) {
    setExpanded((currentExpanded) => {
      const next = new Set(currentExpanded);
      if (next.has(start)) next.delete(start); else next.add(start);
      return next;
    });
  }

  async function markPaid(period: HistoryPeriod, row: HistoryRow) {
    if (row.owedCents <= 0) return;
    const paymentKey = `${period.start}:${row.employee.id}`;
    if (!window.confirm(`Mark ${row.employee.name} as paid ${money(row.owedCents)} for ${period.label}?`)) return;
    setRecordingPayment(paymentKey);
    try {
      const response = await fetch("/api/payroll/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payments: [{ employeeId: row.employee.id, amountCents: row.owedCents }], paidAt: period.end, periodStart: period.start, periodEnd: period.end }),
      });
      const payload = await response.json().catch(() => null) as { recorded?: Array<{ employeeId: number; amountCents: number }>; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "The payment could not be recorded.");
      const recordedCents = payload?.recorded?.find((payment) => payment.employeeId === row.employee.id)?.amountCents ?? 0;
      if (!recordedCents) throw new Error("This payment was already recorded. Refresh the page to see the latest status.");
      setPeriods((currentPeriods) => currentPeriods.map((currentPeriod) => {
        if (currentPeriod.start !== period.start) return currentPeriod;
        const rows = currentPeriod.rows.map((currentRow) => currentRow.employee.id !== row.employee.id ? currentRow : {
          ...currentRow,
          paidCents: currentRow.paidCents + recordedCents,
          owedCents: Math.max(0, currentRow.owedCents - recordedCents),
          status: currentRow.paidCents + recordedCents >= currentRow.estimatedCents ? "Paid" : "Partially paid" as const,
        });
        return { ...currentPeriod, rows, paidTotal: rows.reduce((sum, currentRow) => sum + currentRow.paidCents, 0), owedTotal: rows.reduce((sum, currentRow) => sum + currentRow.owedCents, 0), paidCount: rows.filter((currentRow) => currentRow.status === "Paid").length };
      }));
      flash(`${row.employee.name} was marked paid for ${period.label}.`);
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "The payment could not be recorded.");
    } finally {
      setRecordingPayment("");
    }
  }

  async function openDay(period: HistoryPeriod, row: HistoryRow, index: number) {
    const start = period.start + index * 86400000;
    const end = start + 86400000;
    const key = `${period.start}:${row.employee.id}:${index}`;
    if (selectedDay?.key === key) { setSelectedDay(null); setEditingEntry(null); return; }
    setSelectedDay({ key, start, end, employeeId: row.employee.id, employeeName: row.employee.name });
    setEditingEntry(null); setEntryError(""); setLoadingEntries(true);
    try {
      const response = await fetch(`/api/employees/${row.employee.id}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { entries?: DayEntry[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "That day could not be loaded.");
      setDayEntries((payload?.entries ?? [])
        .filter((entry) => entry.clockIn < end && (entry.clockOut ?? Date.now()) > start)
        .map((entry) => ({ ...entry, dayMinutes: Math.max(0, Math.round((Math.min(entry.clockOut ?? Date.now(), end) - Math.max(entry.clockIn, start)) / 60_000)) }))
        .sort((left, right) => left.clockIn - right.clockIn));
    } catch (reason) {
      setEntryError(reason instanceof Error ? reason.message : "That day could not be loaded.");
      setDayEntries([]);
    } finally { setLoadingEntries(false); }
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEntry) return;
    const form = new FormData(event.currentTarget);
    const date = selectedDay ? dateInput(selectedDay.start) : dateInput(editingEntry.clockIn);
    const clockIn = new Date(`${date}T${String(form.get("clockIn"))}`).getTime();
    const clockOutValue = String(form.get("clockOut") ?? "");
    const clockOut = clockOutValue ? new Date(`${date}T${clockOutValue}`).getTime() : null;
    const response = await fetch(`/api/time-entries/${editingEntry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ clockIn, clockOut }) }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) as { error?: string } | null : null;
    if (!response?.ok) { setEntryError(payload?.error ?? "That time entry could not be saved."); return; }
    setEditingEntry(null); setEntryError(""); setHistoryRefresh((value) => value + 1); flash("Time entry updated.");
  }

  function downloadHistory() {
    const header = ["Pay period", "Employee", "Role", "Regular hours", "Overtime hours", "Pay rate", "Estimated pay", "Paid", "Owed", "Status"];
    const lines = visibleHistory.flatMap((period) => period.rows.map((row) => [period.label, row.employee.name, row.employee.role, formatHours(row.regularMinutes), formatHours(row.overtimeMinutes), money(row.employee.hourlyRateCents ?? 0), money(row.estimatedCents), money(row.paidCents), money(row.owedCents), row.status]));
    const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `coreshift-pay-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    flash("Pay history downloaded.");
  }

  return <section className="pay-history-view">
    <div className="pay-history-header"><div><h1>Pay History</h1><p>Current and previous {payFrequency.toLowerCase()} payroll periods from recorded time.</p></div><div className="pay-history-actions"><button className="secondary-button" type="button" onClick={downloadHistory}>Export all</button><button className="primary-button" type="button" onClick={downloadHistory}>Download CSV</button></div></div>
    {error && <p className="owner-form-error" role="alert">{error}</p>}
    <div className="pay-history-kpis"><article className="panel"><span className="payroll-icon green">$</span><small>Total payroll</small><strong>{money(current.estimatedCost)}</strong><em>Current period</em></article><article className="panel"><span className="payroll-icon purple">#</span><small>Employees paid</small><strong>{current.paidCount} / {current.rows.length}</strong><em>Current period</em></article><article className="panel"><span className="payroll-icon blue">H</span><small>Total hours</small><strong>{formatHours(totalHours)}</strong><em>Current period</em></article><article className="panel"><span className="payroll-icon orange">A</span><small>Average labor cost</small><strong>{money(Math.round(averageRate))} / hr</strong><em>Current period</em></article></div>
    <div className="pay-history-grid"><article className="panel pay-history-list"><div className="pay-history-list-head"><div><h2>Payroll periods</h2><p>Each previous pay period uses the same employee payroll layout as the current period.</p></div><button className="secondary-button" type="button" onClick={downloadHistory}>Download data</button></div>
      {loading && <p>Loading previous payroll periods...</p>}
      {visibleHistory.map((period) => { const isExpanded = expanded.has(period.start); const allPaid = period.rows.length > 0 && period.paidCount === period.rows.length; return <div className={`pay-period-row ${isExpanded ? "expanded" : ""}`} key={period.start}><button className="pay-period-summary" type="button" onClick={() => togglePeriod(period.start)}><span className="pay-chevron">{isExpanded ? "v" : ">"}</span><strong>{period.label}</strong><span className={`history-status ${allPaid ? "paid" : "pending"}`}>{allPaid ? "Paid" : "Owed"}</span><b>{money(period.paidTotal)} paid / {money(period.owedTotal)} owed</b><span>{isExpanded ? "Hide details" : "View details"}</span></button>{isExpanded && <div className="pay-period-details"><div className="pay-history-table pay-history-table-head"><span>Employee</span><span>Hours</span><span>Pay rate</span><span>Paid / Owed</span><span>Status</span></div>{period.rows.map((row) => { const hoursKey = `${period.start}:${row.employee.id}`; const isDailyHoursOpen = dailyHoursFor === hoursKey; return <div className="pay-history-employee" key={row.employee.id}><div className="pay-history-table"><button className="pay-history-person employee-details-trigger" type="button" onClick={() => setDailyHoursFor(isDailyHoursOpen ? "" : hoursKey)}><span className={`avatar ${row.employee.color}`}>{row.employee.initials}</span><strong>{row.employee.name}<small>{row.employee.role} · {isDailyHoursOpen ? "Hide details" : "View details"}</small></strong></button><span>{formatHours(row.totalMinutes)}<small>{row.overtimeMinutes > 0 ? ` (${formatHours(row.overtimeMinutes)} OT)` : ""}</small><button className="daily-hours-toggle" type="button" onClick={() => setDailyHoursFor(isDailyHoursOpen ? "" : hoursKey)}>{isDailyHoursOpen ? "Hide daily hours" : "Hours by day"}</button></span><span>{money(row.employee.hourlyRateCents ?? 0)} / hr</span><div className="pay-history-money"><span><small>Paid</small><strong>{money(row.paidCents)}</strong></span><span className={row.owedCents > 0 ? "has-balance" : ""}><small>Owed</small><strong>{money(row.owedCents)}</strong></span></div>{row.status === "Paid" ? <span className="history-status paid">Paid</span> : <button className="history-status pending action" type="button" disabled={recordingPayment === hoursKey} onClick={() => void markPaid(period, row)}>{recordingPayment === hoursKey ? "Saving..." : "Mark paid"}</button>}</div>{isDailyHoursOpen && <div className="history-daily-hours"><div className="history-detail-summary"><strong>Employee details</strong><span><small>Total hours</small><b>{formatHours(row.totalMinutes)}</b></span><span><small>Estimated pay</small><b>{money(row.estimatedCents)}</b></span><span><small>Amount owed</small><b>{money(row.owedCents)}</b></span></div><div className="history-days"><strong>Hours by day</strong><div>{row.dailyMinutes.map((minutes, index) => <button className="history-day-button" type="button" key={index} onClick={() => void openDay(period, row, index)}><small>{new Date(period.start + index * 86400000).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" })}</small><b>{formatHours(minutes)}</b></button>)}</div></div></div>}</div>; })}{!period.rows.length && <p>No recorded time or payments for this week.</p>}</div>}</div>; })}
      {selectedDay && <section className="history-day-entries"><div className="history-day-entries-head"><div><strong>{selectedDay.employeeName}</strong><span>{new Date(selectedDay.start).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span></div><button className="text-button" type="button" onClick={() => { setSelectedDay(null); setEditingEntry(null); }}>Close</button></div>{entryError && <p className="owner-form-error" role="alert">{entryError}</p>}{loadingEntries ? <p>Loading time entries...</p> : dayEntries.length ? <div className="history-entry-list">{dayEntries.map((entry) => <div className="history-entry" key={entry.id}>{editingEntry?.id === entry.id ? <form className="history-time-editor" onSubmit={saveEntry}><div className="history-time-editor-label"><strong>Edit times</strong><small>For this selected day</small></div><label>Clock in<input name="clockIn" type="time" step="900" required defaultValue={timeInput(entry.clockIn)} /></label><label>Clock out<input name="clockOut" type="time" step="900" defaultValue={entry.clockOut ? timeInput(entry.clockOut) : ""} /></label><button className="primary-button" type="submit">Save changes</button><button className="text-button" type="button" onClick={() => setEditingEntry(null)}>Cancel</button></form> : <><span>{formatTime(entry.clockIn)} – {entry.clockOut ? formatTime(entry.clockOut) : "Still clocked in"}<small>{entry.clockOut ? `${formatHours(entry.dayMinutes ?? 0)} counted on this day` : ""}</small></span><button className="secondary-button" type="button" onClick={() => { setEditingEntry(entry); setEntryError(""); }}>Edit</button></>}</div>)}</div> : <p>No clock-in or clock-out records for this day.</p>}</section>}
      {!loading && visibleHistory.length === 1 && <p>No previous weekly payroll records were found yet.</p>}
    </article><aside className="pay-history-summary panel"><h2>Current week summary</h2><div><span>Total payroll</span><strong>{money(current.estimatedCost)}</strong></div><div><span>Employees paid</span><strong>{current.paidCount} / {current.rows.length}</strong></div><div><span>Total hours</span><strong>{formatHours(totalHours)}</strong></div><div><span>Previous weeks</span><strong>{Math.max(0, visibleHistory.length - 1)}</strong></div><button className="secondary-button" type="button" onClick={downloadHistory}>Download payroll report</button></aside></div>
  </section>;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function formatPeriod(start: number, end: number) {
  const first = new Date(start);
  const last = new Date(end);
  const left = first.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const right = last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${left} - ${right}`;
}

function formatHours(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function datetimeInput(value: number) {
  const local = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function timeInput(value: number) {
  return datetimeInput(value).slice(11, 16);
}

function dateInput(value: number) {
  return datetimeInput(value).slice(0, 10);
}
