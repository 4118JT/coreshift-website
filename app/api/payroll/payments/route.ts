import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

type PayrollPayment = { employeeId?: number; amountCents?: number };

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  const body = await request.json() as { payments?: PayrollPayment[]; paidAt?: number; periodStart?: number; periodEnd?: number };
  const paidAt = Number(body.paidAt);
  const periodStart = Number(body.periodStart);
  const periodEnd = Number(body.periodEnd);
  const payments = Array.isArray(body.payments) ? body.payments.slice(0, 250) : [];
  if (!payments.length || !Number.isFinite(paidAt) || !Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart || paidAt < periodStart || paidAt > periodEnd) {
    return Response.json({ error: "Valid payroll payments and period dates are required." }, { status: 400 });
  }
  await ensureDatabase();
  const db = database();
  const inserts = [];
  const recorded: Array<{ employeeId: number; amountCents: number }> = [];
  for (const item of payments) {
    const employeeId = Number(item.employeeId);
    const requestedCents = Math.round(Number(item.amountCents));
    if (!Number.isInteger(employeeId) || !Number.isFinite(requestedCents) || requestedCents <= 0) continue;
    const employee = await db.prepare("SELECT id FROM employees WHERE id = ? AND business_id = ? AND active = 1").bind(employeeId, viewer.businessId).first<{ id: number }>();
    if (!employee) continue;
    const existing = await db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS paidCents FROM employee_payments WHERE employee_id = ? AND paid_at >= ? AND paid_at <= ?").bind(employeeId, periodStart, periodEnd).first<{ paidCents: number }>();
    const remainingCents = Math.max(0, requestedCents - Math.round(existing?.paidCents ?? 0));
    if (!remainingCents) continue;
    inserts.push(db.prepare("INSERT INTO employee_payments (employee_id, amount_cents, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?)").bind(employeeId, remainingCents, paidAt, "Payroll approval", Date.now()));
    recorded.push({ employeeId, amountCents: remainingCents });
  }
  if (inserts.length) await db.batch(inserts);
  return Response.json({ recorded });
}

export async function DELETE(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  const body = await request.json() as { employeeIds?: number[]; periodStart?: number; periodEnd?: number };
  const periodStart = Number(body.periodStart);
  const periodEnd = Number(body.periodEnd);
  const employeeIds = Array.isArray(body.employeeIds)
    ? [...new Set(body.employeeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 250)
    : [];
  if (!employeeIds.length || !Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart) {
    return Response.json({ error: "Valid employees and payroll period dates are required." }, { status: 400 });
  }
  await ensureDatabase();
  const db = database();
  const removed: number[] = [];
  for (const employeeId of employeeIds) {
    const result = await db.prepare(`DELETE FROM employee_payments
      WHERE employee_id = ? AND paid_at >= ? AND paid_at <= ? AND note = 'Payroll approval'
      AND employee_id IN (SELECT id FROM employees WHERE business_id = ?)`)
      .bind(employeeId, periodStart, periodEnd, viewer.businessId).run();
    if (Number(result.meta?.changes ?? 0) > 0) removed.push(employeeId);
  }
  return Response.json({ removed });
}
