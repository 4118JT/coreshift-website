import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

async function ownerEntry(entryId: number, businessId: string) {
  return database().prepare(`
    SELECT t.id FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    WHERE t.id = ? AND e.business_id = ?
  `).bind(entryId, businessId).first<{ id: number }>();
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const entryId = Number(id);
  const body = await request.json() as { clockIn?: number; clockOut?: number | null };
  const clockIn = Number(body.clockIn);
  const clockOut = body.clockOut == null ? null : Number(body.clockOut);
  if (!Number.isInteger(entryId) || !Number.isFinite(clockIn) || (clockOut !== null && (!Number.isFinite(clockOut) || clockOut <= clockIn))) {
    return Response.json({ error: "Enter a valid clock-in and clock-out time." }, { status: 400 });
  }
  if (!await ownerEntry(entryId, viewer.businessId)) {
    return Response.json({ error: "Time entry not found" }, { status: 404 });
  }
  await database().prepare(
    "UPDATE time_entries SET clock_in = ?, clock_out = ? WHERE id = ?"
  ).bind(clockIn, clockOut, entryId).run();
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || !await ownerEntry(entryId, viewer.businessId)) {
    return Response.json({ error: "Time entry not found" }, { status: 404 });
  }
  await database().prepare("DELETE FROM time_entries WHERE id = ?").bind(entryId).run();
  return Response.json({ ok: true });
}
