import { database, ensureDatabase } from "../../../../../db/runtime";
import { getViewer } from "../../../../../db/viewer";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const employeeId = Number(id);
  const body = await request.json() as { clockIn?: number; clockOut?: number | null };
  const clockIn = Number(body.clockIn);
  const clockOut = body.clockOut == null ? null : Number(body.clockOut);
  if (!Number.isInteger(employeeId) || !Number.isFinite(clockIn) || (clockOut !== null && (!Number.isFinite(clockOut) || clockOut <= clockIn))) {
    return Response.json({ error: "Enter a valid clock-in and clock-out time." }, { status: 400 });
  }
  const employee = await database().prepare(
    "SELECT id FROM employees WHERE id = ? AND business_id = ? AND active = 1"
  ).bind(employeeId, viewer.businessId).first<{ id: number }>();
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  const entry = await database().prepare(
    "INSERT INTO time_entries (employee_id, clock_in, clock_out) VALUES (?, ?, ?) RETURNING id"
  ).bind(employeeId, clockIn, clockOut).first<{ id: number }>();
  return Response.json({ id: entry?.id }, { status: 201 });
}
