"use client";

import { useEffect, useMemo, useState } from "react";
import "./employee-paystub.css";

type PayStubEmployee = {
  id: number;
  currentPayPeriodStart?: number;
  currentPayPeriodEnd?: number;
  currentPayPeriodEarningsCents?: number;
  payFrequency?: string;
  nextPayDate?: number;
};

type TimeEntry = { id: number; clockIn: number; clockOut: number | null };

function hours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function dateRange(start: Date, end: Date) {
  const left = start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const right = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${left} - ${right}`;
}

export default function EmployeePayStub({ employee }: { employee?: PayStubEmployee }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employee) return;
    setLoading(true);
    fetch(`/api/employees/${employee.id}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((result: { entries?: TimeEntry[] }) => setEntries(result.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [employee?.id]);

  const payStub = useMemo(() => {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    fallback.setDate(fallback.getDate() - fallback.getDay());
    const start = new Date(employee?.currentPayPeriodStart ?? fallback.getTime());
    start.setHours(0, 0, 0, 0);
    const end = new Date(employee?.currentPayPeriodEnd ?? (start.getTime() + 7 * 86_400_000 - 1));
    const now = Date.now();
    const rows: Array<{ date: Date; shifts: TimeEntry[]; minutes: number }> = [];
    for (const cursor = new Date(start); cursor.getTime() <= end.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      const date = new Date(cursor);
      const dayStart = date.getTime();
      const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1);
      const dayEnd = nextDay.getTime();
      const shifts = entries.filter((entry) => entry.clockIn < dayEnd && (entry.clockOut ?? now) > dayStart);
      const minutes = Math.round(shifts.reduce((total, entry) => total + Math.max(0, Math.min(entry.clockOut ?? now, dayEnd) - Math.max(entry.clockIn, dayStart)) / 60_000, 0));
      rows.push({ date, shifts, minutes });
    }
    return { start, end, rows, minutes: rows.reduce((total, row) => total + row.minutes, 0) };
  }, [employee?.currentPayPeriodStart, employee?.currentPayPeriodEnd, entries]);

  if (!employee) return <article className="panel employee-paystub-detail employee-paystub-loading">Loading your pay stub...</article>;

  return <article className="panel employee-paystub-detail">
    <header className="employee-paystub-head"><div><p>Upcoming pay stub</p><h2>{dateRange(payStub.start, payStub.end)}</h2><span>{employee.payFrequency ?? "Weekly"} payroll - recorded time through today</span></div><em>Estimated</em></header>
    <section className="employee-paystub-summary"><div><span>Pay-period hours</span><strong>{hours(payStub.minutes)}</strong></div><div><span>Estimated gross pay</span><strong>{money(employee.currentPayPeriodEarningsCents ?? 0)}</strong></div><div><span>Next pay day</span><strong>{employee.nextPayDate ? new Date(employee.nextPayDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not set"}</strong></div></section>
    <div className="employee-paystub-days"><div className="employee-paystub-day employee-paystub-labels"><span>Day</span><span>Time worked</span><span>Total</span></div>{loading && <div className="employee-paystub-loading">Loading your recorded time...</div>}{!loading && payStub.rows.map((day) => <div className={`employee-paystub-day ${day.minutes ? "worked" : ""}`} key={day.date.toISOString()}><div><strong>{day.date.toLocaleDateString("en-US", { weekday: "long" })}</strong><span>{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div><div className="employee-paystub-shifts">{day.shifts.length ? day.shifts.map((shift) => <span key={shift.id}>{new Date(shift.clockIn).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - {shift.clockOut ? new Date(shift.clockOut).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Working now"}</span>) : <span>No recorded time</span>}</div><strong>{hours(day.minutes)}</strong></div>)}</div>
    <footer className="employee-paystub-total"><span>Total recorded for this pay period</span><strong>{hours(payStub.minutes)}</strong></footer>
  </article>;
}
