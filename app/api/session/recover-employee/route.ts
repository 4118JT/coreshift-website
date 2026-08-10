import { hashPassword } from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";
import { enforceRateLimit, rateLimitResponse, recordAudit } from "../../../../db/security";

export async function POST(request: Request) {
  const limit = await enforceRateLimit(request, "employee-recovery", "all", 5, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfter);
  const body = await request.json().catch(() => null) as { email?: string; companyCode?: string; password?: string; confirmPassword?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const companyCode = body?.companyCode?.trim() ?? "";
  const password = body?.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{8}$/.test(companyCode)) return Response.json({ error: "Enter your work email and the 8-digit company code." }, { status: 400 });
  if (password.length < 10) return Response.json({ error: "Your new password must be at least 10 characters." }, { status: 400 });
  if (password !== body?.confirmPassword) return Response.json({ error: "The passwords do not match." }, { status: 400 });
  await ensureDatabase();
  const employee = await database().prepare(`
    SELECT e.id FROM employees e JOIN businesses b ON b.id = e.business_id
    WHERE lower(e.email) = ? AND b.employee_join_code = ? AND e.active = 1
  `).bind(email, companyCode).first<{ id: number }>();
  if (!employee) {
    await recordAudit({ actorType: "anonymous", action: "employee.recovery", outcome: "denied", request });
    return Response.json({ error: "We couldn't verify that email and company code." }, { status: 401 });
  }
  await database().batch([
    database().prepare("UPDATE employees SET password_hash = ?, access_code_hash = NULL WHERE id = ?").bind(await hashPassword(password), employee.id),
    database().prepare("DELETE FROM app_sessions WHERE employee_id = ?").bind(employee.id),
  ]);
  await recordAudit({ actorType: "employee", actorId: employee.id, action: "employee.recovery", targetType: "employee", targetId: employee.id, request });
  return Response.json({ ok: true });
}
