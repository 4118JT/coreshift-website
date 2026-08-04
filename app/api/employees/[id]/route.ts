import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access === "pending") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) {
    return Response.json({ error: "A valid employee is required" }, { status: 400 });
  }
  const employee = await database().prepare(`
    SELECT id, name, role, initials, color, email, phone, display_name AS displayName,
      availability, desired_hours AS desiredHours, address, profile_photo AS profilePhoto, hourly_rate_cents AS hourlyRateCents
    FROM employees WHERE id = ? AND business_id = ? AND active = 1
  `).bind(employeeId, viewer.businessId).first<{
    id: number; name: string; role: string; initials: string; color: string;
    email: string | null; phone: string | null; displayName: string | null; availability: string | null;
    desiredHours: number; address: string | null; profilePhoto: string | null; hourlyRateCents: number;
  }>();
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  if (viewer.access === "employee" && viewer.employeeId !== employeeId) return Response.json({ error: "Not authorized" }, { status: 403 });
  const entries = await database().prepare(`
    SELECT id, clock_in AS clockIn, clock_out AS clockOut, note
    FROM time_entries WHERE employee_id = ? ORDER BY clock_in DESC
  `).bind(employeeId).all<{ id: number; clockIn: number; clockOut: number | null; note: string | null }>();
  const payments = await database().prepare(`
    SELECT id, amount_cents AS amountCents, paid_at AS paidAt, note
    FROM employee_payments WHERE employee_id = ? ORDER BY paid_at DESC, id DESC
  `).bind(employeeId).all<{ id: number; amountCents: number; paidAt: number; note: string | null }>();
  return Response.json({ employee, entries: entries.results, payments: payments.results });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access === "pending") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const employeeId = Number(id);
  const body = await request.json() as {
    email?: string; phone?: string; displayName?: string; availability?: string; desiredHours?: number; address?: string; profilePhoto?: string | null;
    hourlyRateCents?: number; role?: string;
  };
  if (!Number.isInteger(employeeId)) {
    return Response.json({ error: "A valid employee is required" }, { status: 400 });
  }
  if (viewer.access === "employee" && viewer.employeeId !== employeeId) return Response.json({ error: "Not authorized" }, { status: 403 });
  try {
    if (typeof body.role === "string" && viewer.access !== "owner") {
      return Response.json({ error: "Only an owner can change an employee role" }, { status: 403 });
    }
    if (typeof body.hourlyRateCents === "number" && viewer.access !== "owner") {
      return Response.json({ error: "Only an owner can change the hourly rate" }, { status: 403 });
    }
    const hasProfileFields = typeof body.phone === "string" || typeof body.displayName === "string" || typeof body.availability === "string" || typeof body.address === "string" || Number.isFinite(body.desiredHours);
    if (hasProfileFields) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
      if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "A valid email is required" }, { status: 400 });
      const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
      const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 32) : "";
      const availability = typeof body.availability === "string" ? body.availability.trim().slice(0, 500) : "";
      const address = typeof body.address === "string" ? body.address.trim().slice(0, 240) : "";
      const desiredHours = Number.isFinite(body.desiredHours) ? Math.max(0, Math.min(168, Math.round(Number(body.desiredHours)))) : 0;
      if (!displayName) return Response.json({ error: "A displayed name is required" }, { status: 400 });
      await database().prepare(`UPDATE employees SET email = COALESCE(?, email), phone = ?, display_name = ?, availability = ?, desired_hours = ?, address = ?, profile_photo = COALESCE(?, profile_photo) WHERE id = ? AND business_id = ?`).bind(email, phone, displayName, availability, desiredHours, address, typeof body.profilePhoto === "string" ? body.profilePhoto : null, employeeId, viewer.businessId).run();
    } else if (typeof body.role === "string") {
      const role = body.role.trim().slice(0, 80);
      if (!role) return Response.json({ error: "A role is required" }, { status: 400 });
      await database().prepare("UPDATE employees SET role = ? WHERE id = ? AND business_id = ?").bind(role, employeeId, viewer.businessId).run();
    } else if (typeof body.profilePhoto === "string" || body.profilePhoto === null) {
      if (typeof body.profilePhoto === "string" && (!body.profilePhoto.startsWith("data:image/") || body.profilePhoto.length > 3_000_000)) return Response.json({ error: "Choose an image under 2 MB." }, { status: 400 });
      await database().prepare("UPDATE employees SET profile_photo = ? WHERE id = ? AND business_id = ?").bind(body.profilePhoto, employeeId, viewer.businessId).run();
    } else if (typeof body.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: "A valid email is required" }, { status: 400 });
      }
      await database().prepare("UPDATE employees SET email = ? WHERE id = ? AND business_id = ?").bind(email, employeeId, viewer.businessId).run();
    } else if (Number.isFinite(body.hourlyRateCents)) {
      const hourlyRateCents = Math.max(0, Math.round(Number(body.hourlyRateCents)));
      await database().prepare(
        "UPDATE employees SET hourly_rate_cents = ? WHERE id = ? AND business_id = ?"
      ).bind(hourlyRateCents, employeeId, viewer.businessId).run();
    } else {
      return Response.json({ error: "Nothing to update" }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "That update could not be saved" }, { status: 409 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const { id } = await context.params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) {
    return Response.json({ error: "A valid employee is required" }, { status: 400 });
  }
  const employee = await database().prepare(
    "SELECT id FROM employees WHERE id = ? AND business_id = ?"
  ).bind(employeeId, viewer.businessId).first<{ id: number }>();
  if (!employee) return Response.json({ error: "Employee not found" }, { status: 404 });
  try {
    await database().batch([
      database().prepare("DELETE FROM app_sessions WHERE employee_id = ?").bind(employeeId),
      database().prepare("DELETE FROM employee_payments WHERE employee_id = ?").bind(employeeId),
      database().prepare("DELETE FROM time_entries WHERE employee_id = ?").bind(employeeId),
      database().prepare("DELETE FROM published_schedule_shifts WHERE employee_id = ? AND business_id = ?").bind(employeeId, viewer.businessId),
      database().prepare("DELETE FROM employees WHERE id = ? AND business_id = ?").bind(employeeId, viewer.businessId),
    ]);
  } catch {
    return Response.json({ error: "This employee could not be deleted because another record still references them." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
