import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  const requested = Number(new URL(request.url).searchParams.get("year"));
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : new Date().getFullYear();
  const start = new Date(year, 0, 1).getTime(); const end = new Date(year + 1, 0, 1).getTime();
  await ensureDatabase();
  const rows = await database().prepare("SELECT p.id, p.paid_at AS paidAt, e.name AS employeeName, e.email, p.amount_cents AS amountCents, p.note FROM employee_payments p JOIN employees e ON e.id = p.employee_id WHERE e.business_id = ? AND p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at ASC, p.id ASC").bind(viewer.businessId, start, end).all<{ id: number; paidAt: number; employeeName: string; email: string | null; amountCents: number; note: string | null }>();
  const lines = ["Payment ID,Date,Employee,Email,Amount,Note", ...rows.results.map((row) => [row.id, new Date(row.paidAt).toISOString(), row.employeeName, row.email ?? "", (row.amountCents / 100).toFixed(2), row.note ?? ""].map(cell).join(","))];
  return new Response(`\ufeff${lines.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="coreshift-payments-${year}.csv"`, "cache-control": "no-store" } });
}
