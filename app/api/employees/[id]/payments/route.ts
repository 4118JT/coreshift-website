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
  const body = await request.json() as { amountCents?: number; paidAt?: number; note?: string };
  const amountCents = Math.round(Number(body.amountCents));
  const paidAt = Number(body.paidAt);
  const note = body.note?.trim().slice(0, 200) || null;
  if (!Number.isInteger(employeeId) || !Number.isFinite(amountCents) || amountCents <= 0 || !Number.isFinite(paidAt)) {
    return Response.json({ error: "Enter a valid payment amount and date." }, { status: 400 });
  }
  const employee = await database().prepare(
    "SELECT id FROM employees WHERE id = ? AND business_id = ? AND active = 1"
  ).bind(employeeId, viewer.businessId).first<{ id: number }>();
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  const payment = await database().prepare(`
    INSERT INTO employee_payments (employee_id, amount_cents, paid_at, note, created_at)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).bind(employeeId, amountCents, paidAt, note, Date.now()).first<{ id: number }>();
  return Response.json({ id: payment?.id }, { status: 201 });
}
