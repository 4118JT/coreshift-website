import { generateAccessCode, hashCredential } from "../../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../../db/runtime";
import { getViewer } from "../../../../../db/viewer";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
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
    "SELECT name, email FROM employees WHERE id = ? AND business_id = ? AND active = 1"
  ).bind(employeeId, viewer.businessId).first<{ name: string; email: string | null }>();
  if (!employee?.email) {
    return Response.json({ error: "Add the employee’s login email first." }, { status: 400 });
  }
  const accessCode = generateAccessCode();
  await database().prepare(
    "UPDATE employees SET access_code_hash = ?, employee_code = ? WHERE id = ? AND business_id = ?"
  ).bind(await hashCredential(accessCode), accessCode, employeeId, viewer.businessId).run();
  return Response.json({
    accessCode,
    employeeCode: accessCode,
    email: employee.email,
    name: employee.name,
    loginPath: `/login?mode=employee&business=${encodeURIComponent(viewer.businessId)}`,
  });
}
