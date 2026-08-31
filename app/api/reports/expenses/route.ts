import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const boundaries = {
    day: Number(url.searchParams.get("dayStart")),
    week: Number(url.searchParams.get("weekStart")),
    month: Number(url.searchParams.get("monthStart")),
    year: Number(url.searchParams.get("yearStart")),
  };
  const range = url.searchParams.get("range") ?? "week";
  if (!["day", "week", "month", "year", "last-week", "two-weeks", "all", "custom"].includes(range)) {
    return Response.json({ error: "A valid report range is required" }, { status: 400 });
  }
  if (Object.values(boundaries).some((value) => !Number.isFinite(value) || value < 0)) {
    return Response.json({ error: "Valid report dates are required" }, { status: 400 });
  }

  await ensureDatabase();
  const totals = await database().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN p.paid_at >= ? THEN p.amount_cents ELSE 0 END), 0) AS dayCents,
      COALESCE(SUM(CASE WHEN p.paid_at >= ? THEN p.amount_cents ELSE 0 END), 0) AS weekCents,
      COALESCE(SUM(CASE WHEN p.paid_at >= ? THEN p.amount_cents ELSE 0 END), 0) AS monthCents,
      COALESCE(SUM(CASE WHEN p.paid_at >= ? THEN p.amount_cents ELSE 0 END), 0) AS yearCents,
      COALESCE(SUM(p.amount_cents), 0) AS allTimeCents,
      COUNT(p.id) AS paymentCount
    FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ?
  `).bind(
    boundaries.day,
    boundaries.week,
    boundaries.month,
    boundaries.year,
    viewer.businessId,
  ).first<{
    dayCents: number;
    weekCents: number;
    monthCents: number;
    yearCents: number;
    allTimeCents: number;
    paymentCount: number;
  }>();
  const requestedPeriodStart = Number(url.searchParams.get("periodStart"));
  const requestedPeriodEnd = Number(url.searchParams.get("periodEnd"));
  const selectedStart = range === "all"
    ? 0
    : range === "custom"
      ? (Number.isFinite(requestedPeriodStart) && requestedPeriodStart >= 0 ? requestedPeriodStart : boundaries.week)
    : ["last-week", "two-weeks"].includes(range)
      ? (Number.isFinite(requestedPeriodStart) && requestedPeriodStart >= 0 ? requestedPeriodStart : boundaries.week)
      : boundaries[range as keyof typeof boundaries];
  const selectedEnd = range === "custom" && Number.isFinite(requestedPeriodEnd) && requestedPeriodEnd > selectedStart ? requestedPeriodEnd : null;
  const selected = await database().prepare(`
    SELECT
      COALESCE(SUM(p.amount_cents), 0) AS totalCents,
      COUNT(p.id) AS paymentCount,
      COALESCE(AVG(p.amount_cents), 0) AS averageCents,
      COALESCE(MAX(p.amount_cents), 0) AS largestCents
    FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ? AND p.paid_at >= ? ${selectedEnd ? "AND p.paid_at <= ?" : ""}
  `).bind(...(selectedEnd ? [viewer.businessId, selectedStart, selectedEnd] : [viewer.businessId, selectedStart])).first<{
    totalCents: number;
    paymentCount: number;
    averageCents: number;
    largestCents: number;
  }>();
  const byEmployee = await database().prepare(`
    SELECT e.id, e.name, e.initials, e.color,
      COALESCE(SUM(p.amount_cents), 0) AS totalCents,
      COUNT(p.id) AS paymentCount
    FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ? AND p.paid_at >= ? ${selectedEnd ? "AND p.paid_at <= ?" : ""}
    GROUP BY e.id, e.name, e.initials, e.color
    ORDER BY totalCents DESC, e.name
  `).bind(...(selectedEnd ? [viewer.businessId, selectedStart, selectedEnd] : [viewer.businessId, selectedStart])).all<{
    id: number;
    name: string;
    initials: string;
    color: string;
    totalCents: number;
    paymentCount: number;
  }>();
  const payments = await database().prepare(`
    SELECT p.id, p.amount_cents AS amountCents, p.paid_at AS paidAt, p.note,
      e.id AS employeeId, e.name AS employeeName, e.initials, e.color
    FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ? AND p.paid_at >= ? ${selectedEnd ? "AND p.paid_at <= ?" : ""}
    ORDER BY p.paid_at DESC, p.id DESC
  `).bind(...(selectedEnd ? [viewer.businessId, selectedStart, selectedEnd] : [viewer.businessId, selectedStart])).all<{
    id: number;
    amountCents: number;
    paidAt: number;
    note: string | null;
    employeeId: number;
    employeeName: string;
    initials: string;
    color: string;
  }>();
  const recordedTime = await database().prepare(`
    SELECT te.clock_in AS clockIn, te.clock_out AS clockOut, e.hourly_rate_cents AS hourlyRateCents
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    WHERE e.business_id = ? AND te.clock_out IS NOT NULL AND te.clock_out > ? ${selectedEnd ? "AND te.clock_in <= ?" : ""}
  `).bind(...(selectedEnd ? [viewer.businessId, selectedStart, selectedEnd] : [viewer.businessId, selectedStart])).all<{
    clockIn: number;
    clockOut: number;
    hourlyRateCents: number;
  }>();
  const earnedCents = recordedTime.results.reduce((total, entry) => {
    const minutes = Math.max(0, (entry.clockOut - Math.max(entry.clockIn, selectedStart)) / 60_000);
    return total + Math.round((minutes / 60) * entry.hourlyRateCents);
  }, 0);
  const paidCents = Math.round(selected?.totalCents ?? 0);
  const owedCents = Math.max(0, earnedCents - paidCents);
  const employeeHours = await database().prepare(`
    SELECT e.id, e.name, e.role, e.initials, e.color, e.hourly_rate_cents AS hourlyRateCents,
      COALESCE(SUM(CASE WHEN te.clock_out IS NOT NULL AND te.clock_out > ?
        THEN (te.clock_out - CASE WHEN te.clock_in > ? THEN te.clock_in ELSE ? END) / 60000 ELSE 0 END), 0) AS minutes
    FROM employees e
    LEFT JOIN time_entries te ON te.employee_id = e.id ${selectedEnd ? "AND te.clock_in <= ?" : ""}
    WHERE e.business_id = ? AND e.active = 1
    GROUP BY e.id, e.name, e.role, e.initials, e.color, e.hourly_rate_cents
    ORDER BY e.name
  `).bind(...(selectedEnd ? [selectedStart, selectedStart, selectedStart, selectedEnd, viewer.businessId] : [selectedStart, selectedStart, selectedStart, viewer.businessId])).all<{
    id: number; name: string; role: string; initials: string; color: string; hourlyRateCents: number; minutes: number;
  }>();
  const employeePaid = await database().prepare(`
    SELECT employee_id AS employeeId, COALESCE(SUM(amount_cents), 0) AS paidCents
    FROM employee_payments WHERE paid_at >= ? ${selectedEnd ? "AND paid_at <= ?" : ""} GROUP BY employee_id
  `).bind(...(selectedEnd ? [selectedStart, selectedEnd] : [selectedStart])).all<{ employeeId: number; paidCents: number }>();
  const paidByEmployee = new Map(employeePaid.results.map((row) => [row.employeeId, Math.round(row.paidCents)]));
  const dailyTimeEntries = await database().prepare(`
    SELECT te.employee_id AS employeeId, te.clock_in AS clockIn, te.clock_out AS clockOut
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    WHERE e.business_id = ? AND te.clock_out IS NOT NULL AND te.clock_out > ? ${selectedEnd ? "AND te.clock_in <= ?" : ""}
  `).bind(...(selectedEnd ? [viewer.businessId, selectedStart, selectedEnd] : [viewer.businessId, selectedStart])).all<{
    employeeId: number; clockIn: number; clockOut: number;
  }>();
  const dayLength = 24 * 60 * 60 * 1000;
  const dayCount = selectedEnd ? Math.max(1, Math.ceil((selectedEnd - selectedStart + 1) / dayLength)) : 7;
  const dailyRawMinutesByEmployee = new Map<number, number[]>();
  for (const entry of dailyTimeEntries.results) {
    const dailyMinutes = dailyRawMinutesByEmployee.get(entry.employeeId) ?? Array.from({ length: dayCount }, () => 0);
    const entryEnd = Math.min(entry.clockOut, selectedEnd ? selectedEnd + 1 : Date.now());
    let cursor = Math.max(entry.clockIn, selectedStart);
    while (cursor < entryEnd) {
      const dayIndex = Math.floor((cursor - selectedStart) / dayLength);
      if (dayIndex < 0 || dayIndex >= dayCount) break;
      const dayEnd = selectedStart + (dayIndex + 1) * dayLength;
      const segmentEnd = Math.min(entryEnd, dayEnd);
      dailyMinutes[dayIndex] += Math.max(0, (segmentEnd - cursor) / 60_000);
      cursor = segmentEnd;
    }
    dailyRawMinutesByEmployee.set(entry.employeeId, dailyMinutes);
  }
  const dailyMinutesByEmployee = new Map<number, number[]>();
  for (const [employeeId, rawMinutes] of dailyRawMinutesByEmployee) {
    const roundedMinutes = rawMinutes.map((minutes) => Math.round(minutes));
    const totalMinutes = Math.round(rawMinutes.reduce((total, minutes) => total + minutes, 0));
    const roundingDifference = totalMinutes - roundedMinutes.reduce((total, minutes) => total + minutes, 0);
    const adjustmentIndex = rawMinutes.reduce((latest, minutes, index) => minutes > 0 ? index : latest, -1);
    if (adjustmentIndex >= 0) roundedMinutes[adjustmentIndex] = Math.max(0, roundedMinutes[adjustmentIndex] + roundingDifference);
    dailyMinutesByEmployee.set(employeeId, roundedMinutes);
  }
  const employeeReport = employeeHours.results.map((row) => {
    // Use the same normalized day buckets that power the detail view so the
    // displayed days always add up exactly to the payroll total.
    const dailyMinutes = dailyMinutesByEmployee.get(row.id) ?? Array.from({ length: dayCount }, () => 0);
    const minutes = dailyMinutes.reduce((total, dayMinutes) => total + dayMinutes, 0);
    const earned = Math.round((minutes / 60) * row.hourlyRateCents);
    const paid = paidByEmployee.get(row.id) ?? 0;
    return { id: row.id, name: row.name, role: row.role, initials: row.initials, color: row.color, hourlyRateCents: row.hourlyRateCents, minutes, dailyMinutes, earnedCents: earned, paidCents: paid, owedCents: Math.max(0, earned - paid) };
  });

  return Response.json({
    dayCents: totals?.dayCents ?? 0,
    weekCents: totals?.weekCents ?? 0,
    monthCents: totals?.monthCents ?? 0,
    yearCents: totals?.yearCents ?? 0,
    allTimeCents: totals?.allTimeCents ?? 0,
    paymentCount: totals?.paymentCount ?? 0,
    selected: {
      totalCents: Math.round(selected?.totalCents ?? 0),
      earnedCents,
      owedCents,
      combinedCents: owedCents + paidCents,
      paymentCount: selected?.paymentCount ?? 0,
      averageCents: Math.round(selected?.averageCents ?? 0),
      largestCents: selected?.largestCents ?? 0,
      byEmployee: byEmployee.results,
      employeeReport,
      payments: payments.results,
    },
  }, { headers: { "cache-control": "no-store" } });
}
