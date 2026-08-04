import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

type IncomingShift = {
  employeeId?: number;
  employeeName?: string;
  date?: string;
  startMinutes?: number;
  endMinutes?: number;
  breakMinutes?: number;
  note?: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return json({ error: "Owner access required." }, 403);
  const body = await request.json().catch(() => null) as { shifts?: IncomingShift[]; ownerShifts?: IncomingShift[] } | null;
  const incoming = Array.isArray(body?.shifts) ? body.shifts.slice(0, 1000) : [];
  const ownerShifts = Array.isArray(body?.ownerShifts) ? body.ownerShifts.slice(0, 1000) : [];
  const shifts = incoming.filter((shift) => {
    const date = shift.date ?? "";
    return Number.isInteger(shift.employeeId) &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isInteger(shift.startMinutes) && Number.isInteger(shift.endMinutes) &&
      Number(shift.startMinutes) >= 0 && Number(shift.endMinutes) <= 1440 &&
      Number(shift.endMinutes) > Number(shift.startMinutes);
  }).map((shift) => ({
    employeeId: Number(shift.employeeId),
    employeeName: String(shift.employeeName ?? "").trim().toLowerCase(),
    date: shift.date!,
    startMinutes: Number(shift.startMinutes),
    endMinutes: Number(shift.endMinutes),
    breakMinutes: Math.max(0, Math.min(shift.endMinutes! - shift.startMinutes!, Number(shift.breakMinutes ?? 0))),
    note: String(shift.note ?? "").slice(0, 240),
  }));

  await ensureDatabase();
  const owner = await database().prepare("SELECT id FROM owners WHERE business_id = ? AND lower(email) = lower(?) LIMIT 1").bind(viewer.businessId, viewer.email).first<{ id: number }>();
  if (!owner?.id) return json({ error: "Owner account could not be resolved." }, 400);
  const employeeRows = await database().prepare(
    "SELECT id FROM employees WHERE business_id = ? AND active = 1"
  ).bind(viewer.businessId).all<{ id: number }>();
  const employeeIds = new Set(employeeRows.results.map((employee) => employee.id));
  const employeeNames = await database().prepare(
    "SELECT id, lower(name) AS name FROM employees WHERE business_id = ? AND active = 1"
  ).bind(viewer.businessId).all<{ id: number; name: string }>();
  const idsByName = new Map(employeeNames.results.map((employee) => [employee.name, employee.id]));
  for (const shift of shifts) {
    if (!employeeIds.has(shift.employeeId)) {
      const replacementId = idsByName.get(shift.employeeName);
      if (replacementId) shift.employeeId = replacementId;
    }
  }
  if (shifts.some((shift) => !employeeIds.has(shift.employeeId))) {
    return json({ error: "One or more shifts reference an invalid employee." }, 400);
  }

  const publishedAt = Date.now();
  const statements = [
    database().prepare("DELETE FROM published_schedule_shifts WHERE business_id = ?").bind(viewer.businessId),
    database().prepare("DELETE FROM published_owner_schedule_shifts WHERE business_id = ?").bind(viewer.businessId),
    ...shifts.map((shift) => database().prepare(`
      INSERT INTO published_schedule_shifts
        (business_id, employee_id, date, start_minutes, end_minutes, break_minutes, note, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(viewer.businessId, shift.employeeId, shift.date, shift.startMinutes, shift.endMinutes, shift.breakMinutes, shift.note, publishedAt)),
    ...ownerShifts.filter((shift) => /^\d{4}-\d{2}-\d{2}$/.test(shift.date ?? "") && Number.isInteger(shift.startMinutes) && Number.isInteger(shift.endMinutes) && Number(shift.endMinutes) > Number(shift.startMinutes)).map((shift) => database().prepare(`INSERT INTO published_owner_schedule_shifts (business_id, owner_id, date, start_minutes, end_minutes, break_minutes, note, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(viewer.businessId, owner.id, shift.date, shift.startMinutes, shift.endMinutes, Math.max(0, shift.breakMinutes ?? 0), String(shift.note ?? "").slice(0, 240), publishedAt)),
  ];
  await database().batch(statements);
  return json({ ok: true, count: shifts.length, publishedAt });
}
