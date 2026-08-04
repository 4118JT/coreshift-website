import { database, ensureDatabase } from "../../../db/runtime";
import { getViewer } from "../../../db/viewer";

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  await ensureDatabase();
  const db = database();
  const now = Date.now();
  const currentDate = new Date(now);
  const calendarWeek = new Date(currentDate);
  calendarWeek.setHours(0, 0, 0, 0);
  calendarWeek.setDate(calendarWeek.getDate() - ((calendarWeek.getDay() + 6) % 7));
  const weekStart = calendarWeek.getTime();
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getTime();
  const employeeFilter = viewer.access === "employee" ? "AND e.id = ?" : "";
  const query = db.prepare(`
    SELECT e.id, e.name, e.role, e.initials, e.color, e.email, e.phone, e.display_name AS displayName,
      e.availability, e.desired_hours AS desiredHours, e.address, e.profile_photo AS profilePhoto, e.created_at AS createdAt,
      e.hourly_rate_cents AS hourlyRateCents,
      CASE WHEN open_entry.id IS NULL THEN 'clocked_out' ELSE 'clocked_in' END AS status,
      open_entry.clock_in AS clockInMs,
      COALESCE(SUM(CASE WHEN t.clock_out IS NOT NULL AND t.clock_out > ?
        THEN (t.clock_out - CASE WHEN t.clock_in > ? THEN t.clock_in ELSE ? END) / 60000
        WHEN t.clock_out IS NULL AND ? >= t.clock_in AND ? > ?
        THEN (? - CASE WHEN t.clock_in > ? THEN t.clock_in ELSE ? END) / 60000
        ELSE 0 END), 0) AS weeklyMinutes,
      COALESCE(SUM(
        CASE WHEN t.clock_in >= ? THEN
          (COALESCE(t.clock_out, ?) - t.clock_in) / 60000
        ELSE 0 END
      ), 0) AS monthMinutes,
      COALESCE(SUM(
        CASE WHEN t.clock_out IS NOT NULL THEN (t.clock_out - t.clock_in) / 60000
        ELSE 0 END
      ), 0) AS totalMinutes,
      COALESCE(SUM(CASE WHEN t.clock_out IS NOT NULL THEN 1 ELSE 0 END), 0) AS totalShifts
    FROM employees e
    LEFT JOIN time_entries t ON t.employee_id = e.id
    LEFT JOIN time_entries open_entry ON open_entry.employee_id = e.id AND open_entry.clock_out IS NULL
    WHERE e.active = 1 AND e.business_id = ? ${employeeFilter}
    GROUP BY e.id, open_entry.id
    ORDER BY e.id
  `);
  const result = await (viewer.access === "employee"
    ? query.bind(weekStart, weekStart, weekStart, now, now, weekStart, now, weekStart, weekStart, monthStart, now, viewer.businessId, viewer.employeeId)
    : query.bind(weekStart, weekStart, weekStart, now, now, weekStart, now, weekStart, weekStart, monthStart, now, viewer.businessId)
  ).all<{
    id: number; name: string; role: string; initials: string; color: string; email: string | null; phone: string | null;
    displayName: string | null; availability: string | null; desiredHours: number; address: string | null; profilePhoto: string | null; hourlyRateCents: number;
    createdAt: number | null; status: "clocked_in" | "clocked_out"; clockInMs: number | null;
    weeklyMinutes: number; monthMinutes: number; totalMinutes: number; totalShifts: number;
  }>();

  const calendarDay = new Date(now);
  calendarDay.setHours(0, 0, 0, 0);
  calendarDay.setDate(calendarDay.getDate() - ((calendarDay.getDay() + 6) % 7));
  const calendarWeekStart = calendarDay.getTime();
  const calendarWeekEnd = calendarWeekStart + 7 * 24 * 60 * 60 * 1000;
  let dailyRows: { results: Array<{ employeeId: number; clockIn: number; clockOut: number | null }> } = { results: [] };
  try {
    const dailyQuery = db.prepare(`
      SELECT t.employee_id AS employeeId, t.clock_in AS clockIn, t.clock_out AS clockOut
      FROM time_entries t
      JOIN employees e ON e.id = t.employee_id
      WHERE e.active = 1 AND e.business_id = ? AND t.clock_in >= ? AND t.clock_in < ? ${viewer.access === "employee" ? "AND e.id = ?" : ""}
    `);
    dailyRows = await (viewer.access === "employee"
      ? dailyQuery.bind(viewer.businessId, calendarWeekStart, calendarWeekEnd, viewer.employeeId)
      : dailyQuery.bind(viewer.businessId, calendarWeekStart, calendarWeekEnd)
    ).all<{ employeeId: number; clockIn: number; clockOut: number | null }>();
  } catch {
    // The dashboard can still load with weekly totals if daily detail is unavailable.
  }
  const dailyMinutesByEmployee = new Map<number, number[]>();
  for (const entry of dailyRows.results) {
    const index = (new Date(entry.clockIn).getDay() + 6) % 7;
    // Clamp both ends to the displayed calendar week so open/overnight entries
    // never inflate the daily chart with time outside the selected period.
    const boundedStart = Math.max(entry.clockIn, calendarWeekStart);
    const boundedEnd = Math.min(entry.clockOut ?? now, calendarWeekEnd);
    const minutes = Math.max(0, (boundedEnd - boundedStart) / 60000);
    const totals = dailyMinutesByEmployee.get(entry.employeeId) ?? [0, 0, 0, 0, 0, 0, 0];
    totals[index] += minutes;
    dailyMinutesByEmployee.set(entry.employeeId, totals);
  }

  return Response.json(result.results.map((row) => {
    const weeklyMinutes = Math.round(row.weeklyMinutes);
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      role: row.role,
      initials: row.initials,
      color: row.color,
      email: viewer.access === "owner" || viewer.employeeId === row.id ? row.email : undefined,
      phone: viewer.access === "owner" || viewer.employeeId === row.id ? row.phone : undefined,
      availability: viewer.access === "owner" || viewer.employeeId === row.id ? row.availability : undefined,
      desiredHours: viewer.access === "owner" || viewer.employeeId === row.id ? Math.round(row.desiredHours ?? 0) : undefined,
      address: viewer.access === "owner" || viewer.employeeId === row.id ? row.address : undefined,
      profilePhoto: row.profilePhoto ?? null,
      hourlyRateCents: viewer.access === "owner" ? row.hourlyRateCents : undefined,
      createdAt: row.createdAt,
      status: row.status,
      weeklyMinutes,
      dailyMinutes: (dailyMinutesByEmployee.get(row.id) ?? [0, 0, 0, 0, 0, 0, 0]).map(Math.round),
      monthMinutes: Math.round(row.monthMinutes),
      totalMinutes: Math.round(row.totalMinutes),
      totalShifts: Math.round(row.totalShifts),
      currentPayPeriodEarningsCents: Math.round((weeklyMinutes / 60) * row.hourlyRateCents),
      // Keep the timestamp intact; the browser formats it in the user's timezone.
      clockIn: row.clockInMs ? new Date(row.clockInMs).toISOString() : null,
    };
  }));
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner" || viewer.businessId === "__coreshift_demo__") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const db = database();
  const body = await request.json() as {
    name?: string; role?: string; initials?: string; color?: string; email?: string; hourlyRateCents?: number;
  };
  const name = body.name?.trim();
  // New team members always start as employees; owners can promote them later.
  const role = "Employee";
  const initials = body.initials?.trim().slice(0, 2).toUpperCase();
  const email = body.email?.trim().toLowerCase();
  const hourlyRateCents = Math.max(0, Math.round(Number(body.hourlyRateCents) || 0));
  if (!name || !role || !initials || !email) {
    return Response.json({ error: "Name, role, and email are required" }, { status: 400 });
  }
  try {
    const result = await db.prepare(
      "INSERT INTO employees (business_id, name, role, initials, color, email, hourly_rate_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(viewer.businessId, name, role, initials, body.color ?? "green", email, hourlyRateCents, Date.now()).first<{ id: number }>();
    return Response.json({
      id: result?.id, name, displayName: null, role, initials, color: body.color ?? "green", email,
      phone: null, availability: null, desiredHours: 0, address: null, profilePhoto: null, hourlyRateCents,
      status: "clocked_out", clockIn: null, weeklyMinutes: 0, monthMinutes: 0,
      totalMinutes: 0, totalShifts: 0, currentPayPeriodEarningsCents: 0, createdAt: Date.now(),
    }, { status: 201 });
  } catch {
    return Response.json(
      { error: "That email is already used by an employee in this business." },
      { status: 409 },
    );
  }
}
