import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Sign in required" }, { status: 403 });
  const url = new URL(request.url);
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return Response.json({ error: "A valid schedule date range is required." }, { status: 400 });
  }
  await ensureDatabase();
  const result = await database().prepare(`SELECT
      te.id,
      te.employee_id AS employeeId,
      e.name AS employeeName,
      te.clock_in AS clockIn,
      te.clock_out AS clockOut
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    WHERE e.business_id = ?
      AND te.clock_in <= ?
      AND COALESCE(te.clock_out, ?) >= ?
      AND (? IS NULL OR e.id = ?)
    ORDER BY te.clock_in ASC`)
    .bind(viewer.businessId, end, Date.now(), start, viewer.access === "employee" ? viewer.employeeId : null, viewer.access === "employee" ? viewer.employeeId : null)
    .all<{ id: number; employeeId: number; employeeName: string; clockIn: number; clockOut: number | null }>();
  return Response.json({ entries: result.results ?? [] });
}
