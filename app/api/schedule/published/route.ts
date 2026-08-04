import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
    return Response.json({ error: "A valid schedule date range is required." }, { status: 400 });
  }
  await ensureDatabase();
  // Do not expose the legacy sample shifts that older builds published with
  // notes such as "Opening shift · ...". They are demo data, not assignments.
  const employeeFilter = viewer.access === "employee"
    ? "AND s.employee_id = ? AND lower(coalesce(s.note, '')) NOT LIKE 'opening shift ·%' AND lower(coalesce(s.note, '')) NOT LIKE 'midday shift ·%' AND lower(coalesce(s.note, '')) NOT LIKE 'closing shift ·%'"
    : "";
  const query = database().prepare(`
    SELECT s.id, s.date, s.start_minutes AS startMinutes, s.end_minutes AS endMinutes,
      s.break_minutes AS breakMinutes, s.note,
      e.id AS employeeId, e.name AS employeeName, e.role, e.initials, e.color
    FROM published_schedule_shifts s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.business_id = ? AND s.date >= ? AND s.date < ? ${employeeFilter}
    ORDER BY s.date, s.start_minutes, e.name
  `);
  const result = await (viewer.access === "employee"
    ? query.bind(viewer.businessId, start, end, viewer.employeeId)
    : query.bind(viewer.businessId, start, end)
  ).all();
  const ownerResult = await database().prepare(`SELECT s.id, s.date, s.start_minutes AS startMinutes, s.end_minutes AS endMinutes, s.break_minutes AS breakMinutes, s.note, 0 AS employeeId, o.name AS employeeName, 'Owner' AS role, upper(substr(o.name, 1, 1) || substr(trim(substr(o.name, instr(o.name, ' ') + 1)), 1, 1)) AS initials, 'violet' AS color FROM published_owner_schedule_shifts s JOIN owners o ON o.id = s.owner_id WHERE s.business_id = ? AND s.date >= ? AND s.date < ? ORDER BY s.date, s.start_minutes`).bind(viewer.businessId, start, end).all();
  return Response.json([...result.results, ...ownerResult.results].sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)) || Number(a.startMinutes) - Number(b.startMinutes)), { headers: { "cache-control": "no-store" } });
}
