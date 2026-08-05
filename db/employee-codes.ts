import { generateAccessCode, hashCredential } from "./app-auth";

async function uniqueEightDigitCode(db: any) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateAccessCode();
    const existing = await db.prepare(`SELECT code FROM (
      SELECT employee_code AS code FROM employees WHERE employee_code = ?
      UNION ALL
      SELECT employee_join_code AS code FROM businesses WHERE employee_join_code = ?
    ) LIMIT 1`).bind(code, code).first<{ code: string }>();
    if (!existing) return code;
  }
  throw new Error("A unique 8-digit code could not be created.");
}

export async function createUniqueEightDigitCode(db: any) {
  return uniqueEightDigitCode(db);
}

export async function ensureWorkspaceEightDigitCodes(db: any, businessId: string) {
  const business = await db.prepare("SELECT employee_join_code AS code FROM businesses WHERE id = ?")
    .bind(businessId).first<{ code: string | null }>();
  if (!/^\d{8}$/.test(business?.code ?? "")) {
    await db.prepare("UPDATE businesses SET employee_join_code = ? WHERE id = ?")
      .bind(await uniqueEightDigitCode(db), businessId).run();
  }

  const employees = await db.prepare(`SELECT id, employee_code AS employeeCode
    FROM employees WHERE business_id = ? AND employee_code IS NOT NULL`)
    .bind(businessId).all<{ id: number; employeeCode: string }>();
  for (const employee of employees.results ?? []) {
    if (/^\d{8}$/.test(employee.employeeCode)) continue;
    const code = await uniqueEightDigitCode(db);
    await db.prepare("UPDATE employees SET employee_code = ?, access_code_hash = ? WHERE id = ? AND business_id = ?")
      .bind(code, await hashCredential(code), employee.id, businessId).run();
  }
}
