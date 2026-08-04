import { hashPassword } from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";

export async function POST(request: Request) {
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
  if (!employee) return Response.json({ error: "We couldn't verify that email and company code." }, { status: 401 });
  await database().batch([
    database().prepare("UPDATE employees SET password_hash = ?, access_code_hash = NULL WHERE id = ?").bind(await hashPassword(password), employee.id),
    database().prepare("DELETE FROM app_sessions WHERE employee_id = ?").bind(employee.id),
  ]);
  return Response.json({ ok: true });
}
