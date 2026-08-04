import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const paymentId = Number(id);
  const payment = await database().prepare(`
    SELECT p.id FROM employee_payments p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.id = ? AND e.business_id = ?
  `).bind(paymentId, viewer.businessId).first<{ id: number }>();
  if (!payment) return Response.json({ error: "Payment not found" }, { status: 404 });
  await database().prepare("DELETE FROM employee_payments WHERE id = ?").bind(paymentId).run();
  return Response.json({ ok: true });
}
