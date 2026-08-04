import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access === "pending") {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  const url = new URL(request.url);
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 32 * 24 * 60 * 60 * 1000) {
    return Response.json({ error: "A valid schedule range is required" }, { status: 400 });
  }

  await ensureDatabase();
  const employeeFilter = viewer.access === "employee" ? "AND e.id = ?" : "";
  const query = database().prepare(`
    SELECT p.id, p.amount_cents AS amountCents, p.paid_at AS paidAt, p.note,
      e.id AS employeeId, e.name AS employeeName, e.initials, e.color
    FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ? AND p.paid_at >= ? AND p.paid_at < ? ${employeeFilter}
    ORDER BY p.paid_at, e.name
  `);
  const result = await (viewer.access === "employee"
    ? query.bind(viewer.businessId, start, end, viewer.employeeId)
    : query.bind(viewer.businessId, start, end)
  ).all<{
    id: number; amountCents: number; paidAt: number; note: string | null;
    employeeId: number; employeeName: string; initials: string; color: string;
  }>();

  return Response.json(result.results, { headers: { "cache-control": "no-store" } });
}
