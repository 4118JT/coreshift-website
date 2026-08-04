import { database, ensureDatabase } from "../../../../../db/runtime";
import { getViewer } from "../../../../../db/viewer";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access === "pending") {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }
  await ensureDatabase();
  const db = database();
  const { id } = await context.params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) return Response.json({ error: "Invalid employee" }, { status: 400 });
  if (viewer.access === "employee" && viewer.employeeId !== employeeId) {
    return Response.json({ error: "You can only update your own time" }, { status: 403 });
  }
  const employee = await db.prepare(
    "SELECT id FROM employees WHERE id = ? AND business_id = ? AND active = 1"
  ).bind(employeeId, viewer.businessId).first<{ id: number }>();
  if (!employee) {
    return Response.json({ error: "Employee not found" }, { status: 404 });
  }
  const body = await request.json() as { status?: string };

  if (body.status === "clocked_in") {
    const open = await db.prepare("SELECT id FROM time_entries WHERE employee_id = ? AND clock_out IS NULL").bind(employeeId).first();
    if (!open) {
      await db.prepare("INSERT INTO time_entries (employee_id, clock_in) VALUES (?, ?)").bind(employeeId, Date.now()).run();
    }
  } else if (body.status === "clocked_out") {
    await db.prepare("UPDATE time_entries SET clock_out = ? WHERE employee_id = ? AND clock_out IS NULL").bind(Date.now(), employeeId).run();
  } else {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
