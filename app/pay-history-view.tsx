"use client";

import { useEffect, useMemo, useState } from "react";

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
        return { employee: { id: row.id, name: row.name, role: row.role || "Employee", initials: row.initials, color: row.color, hourlyRateCents: row.hourlyRateCents }, regularMinutes, overtimeMinutes, totalMinutes, estimatedCents, paidCents: row.paidCents, owedCents: Math.max(0, estimatedCents - row.paidCents), status };
      });
      return { start, end, label: index === 0 ? currentPayPeriod : formatPeriod(start, end), rows, estimatedCost: rows.reduce((sum, row) => sum + row.estimatedCents, 0), paidTotal: rows.reduce((sum, row) => sum + row.paidCents, 0), owedTotal: rows.reduce((sum, row) => sum + row.owedCents, 0), paidCount: rows.filter((row) => row.status === "Paid").length };
    }))
      .then((results) => { setPeriods(results); setExpanded(new Set(results.length ? [results[0].start] : [])); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [currentPayPeriod, currentPeriodStart, periodDays]);

  const fallbackPeriod = useMemo<HistoryPeriod>(() => ({
    start: 0,
    end: 0,
    label: currentPayPeriod,
    rows: currentRows.map((row) => ({ ...row, paidCents: currentPaidIds.includes(row.employee.id) ? row.estimatedCents : 0, owedCents: currentPaidIds.includes(row.employee.id) ? 0 : row.estimatedCents, status: currentPaidIds.includes(row.employee.id) ? "Paid" : "Unpaid" })),
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
      {visibleHistory.map((period) => { const isExpanded = expanded.has(period.start); const allPaid = period.rows.length > 0 && period.paidCount === period.rows.length; return <div className={`pay-period-row ${isExpanded ? "expanded" : ""}`} key={period.start}><button className="pay-period-summary" type="button" onClick={() => togglePeriod(period.start)}><span className="pay-chevron">{isExpanded ? "v" : ">"}</span><strong>{period.label}</strong><span className={`history-status ${allPaid ? "paid" : "pending"}`}>{allPaid ? "Paid" : "Owed"}</span><b>{money(period.paidTotal)} paid / {money(period.owedTotal)} owed</b><span>{isExpanded ? "Hide details" : "View details"}</span></button>{isExpanded && <div className="pay-period-details"><div className="pay-history-table pay-history-table-head"><span>Employee</span><span>Hours</span><span>Pay rate</span><span>Paid / Owed</span><span>Status</span></div>{period.rows.map((row) => <div className="pay-history-table" key={row.employee.id}><div className="pay-history-person"><span className={`avatar ${row.employee.color}`}>{row.employee.initials}</span><strong>{row.employee.name}<small>{row.employee.role}</small></strong></div><span>{formatHours(row.totalMinutes)}<small>{row.overtimeMinutes > 0 ? ` (${formatHours(row.overtimeMinutes)} OT)` : ""}</small></span><span>{money(row.employee.hourlyRateCents ?? 0)} / hr</span><div className="pay-history-money"><span><small>Paid</small><strong>{money(row.paidCents)}</strong></span><span className={row.owedCents > 0 ? "has-balance" : ""}><small>Owed</small><strong>{money(row.owedCents)}</strong></span></div><span className={`history-status ${row.status === "Paid" ? "paid" : "pending"}`}>{row.status}</span></div>)}{!period.rows.length && <p>No recorded time or payments for this week.</p>}</div>}</div>; })}
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
