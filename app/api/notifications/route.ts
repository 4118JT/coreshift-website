import { database, ensureDatabase } from "../../../db/runtime";
import { getViewer } from "../../../db/viewer";

type NotificationRow = { id: string; type: string; title: string; body: string; createdAt: number };

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  const db = database();
  const notifications: NotificationRow[] = [];
  const employeeFilter = viewer.access === "employee" ? "AND p.employee_id = ?" : "";
  const paymentArgs = viewer.access === "employee" ? [viewer.businessId, viewer.employeeId] : [viewer.businessId];
  const payments = await db.prepare(`
    SELECT p.id, p.amount_cents AS amountCents, p.paid_at AS paidAt, e.name AS employeeName
    FROM employee_payments p JOIN employees e ON e.id = p.employee_id
    WHERE e.business_id = ? ${employeeFilter}
    ORDER BY p.paid_at DESC, p.id DESC LIMIT 20
  `).bind(...paymentArgs).all<{ id: number; amountCents: number; paidAt: number; employeeName: string }>();
  for (const payment of payments.results) notifications.push({ id: `payment:${payment.id}`, type: "payment", title: "Payment recorded", body: `${payment.employeeName} was paid $${(payment.amountCents / 100).toFixed(2)}.`, createdAt: payment.paidAt });

  const scheduleArgs = viewer.access === "employee" ? [viewer.businessId, viewer.employeeId] : [viewer.businessId];
  const schedule = await db.prepare(`
    SELECT published_at AS publishedAt FROM published_schedule_shifts
    WHERE business_id = ? ${viewer.access === "employee" ? "AND employee_id = ?" : ""}
    ORDER BY published_at DESC LIMIT 1
  `).bind(...scheduleArgs).first<{ publishedAt: number }>();
  if (schedule?.publishedAt) notifications.push({ id: `schedule:${schedule.publishedAt}`, type: "schedule", title: "Schedule published", body: "Your latest schedule is ready to view.", createdAt: schedule.publishedAt });

  const messages = await db.prepare(`SELECT id, sender_name AS senderName, body, created_at AS createdAt FROM messages WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`).bind(viewer.businessId).all<{ id: number; senderName: string; body: string; createdAt: number }>();
  for (const message of messages.results) notifications.push({ id: `message:${message.id}`, type: "message", title: `Message from ${message.senderName}`, body: message.body, createdAt: message.createdAt });
  notifications.sort((left, right) => right.createdAt - left.createdAt);
  return Response.json({ notifications: notifications.slice(0, 30) }, { headers: { "cache-control": "no-store" } });
}
