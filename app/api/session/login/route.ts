import {
  createAppSession,
  hashCredential,
  verifyCredential,
  verifyPassword,
} from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";
import { isDemoBusiness, resetDemoWorkspace } from "../../../../db/demo";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export async function POST(request: Request) {
  await ensureDatabase();
  const body = await request.json() as {
    mode?: string;
    identifier?: string;
    secret?: string;
    businessId?: string;
  };
  // The public sign-in form intentionally has one entry point. Keep the
  // explicit modes for older links, but auto-detect owners and employees when
  // mode is omitted or set to auto.
  const mode = body.mode === "employee" ? "employee" : body.mode === "owner" ? "owner" : "auto";
  const identifier = body.identifier?.trim().toLowerCase() ?? "";
  const secret = body.secret?.trim() || (/^\d{8}$/.test(identifier) ? identifier : "");
  const businessId = body.businessId?.trim() ?? "";
  if (!identifier || !secret) {
    return Response.json({ error: "Enter your email and password or access code." }, { status: 400 });
  }

  const now = Date.now();
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const attemptKey = await hashCredential(`login:${mode}:${businessId}:${identifier}:${clientIp}`);
  const attempts = await database().prepare(
    "SELECT failures, window_start AS windowStart, locked_until AS lockedUntil FROM login_attempts WHERE key = ?"
  ).bind(attemptKey).first<{ failures: number; windowStart: number; lockedUntil: number }>();
  if (attempts && attempts.lockedUntil > now) {
    return Response.json(
      { error: "Too many sign-in attempts. Try again in 15 minutes." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  let employeeId: number | null = null;
  let ownerId: number | null = null;
  let ownerBusinessId: string | null = null;
  let valid = false;
  if (mode === "owner" || mode === "auto") {
    const owner = await database().prepare(
      "SELECT id, business_id AS businessId, password_hash AS passwordHash FROM owners WHERE lower(email) = ? AND active = 1"
    ).bind(identifier).first<{ id: number; businessId: string; passwordHash: string }>();
    valid = Boolean(owner && await verifyPassword(secret, owner.passwordHash));
    ownerId = valid ? owner?.id ?? null : null;
    ownerBusinessId = valid ? owner?.businessId ?? null : null;
  }
  if (mode === "employee" || (mode === "auto" && !valid)) {
    const employee = await database().prepare(
      `SELECT e.id, e.access_code_hash AS accessCodeHash, e.password_hash AS passwordHash
       FROM employees e
       JOIN businesses b ON b.id = e.business_id
       WHERE (lower(e.email) = ? OR e.employee_code = ?)
         ${businessId ? "AND (e.business_id = ? OR b.employee_join_code = ?)" : ""}
         AND e.active = 1`
    ).bind(...(businessId ? [identifier, identifier, businessId, businessId] : [identifier, identifier])).first<{
      id: number;
      accessCodeHash: string | null;
      passwordHash: string | null;
    }>();
    valid = Boolean(employee && (
      await verifyPassword(secret, employee.passwordHash) ||
      await verifyCredential(secret, employee.accessCodeHash)
    ));
    employeeId = valid ? employee?.id ?? null : null;
  }

  if (!valid) {
    const failures =
      attempts && now - attempts.windowStart < ATTEMPT_WINDOW_MS
        ? attempts.failures + 1
        : 1;
    const windowStart =
      attempts && now - attempts.windowStart < ATTEMPT_WINDOW_MS
        ? attempts.windowStart
        : now;
    const lockedUntil = failures >= MAX_FAILURES ? now + ATTEMPT_WINDOW_MS : 0;
    await database().prepare(`
      INSERT INTO login_attempts (key, failures, window_start, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        failures = excluded.failures,
        window_start = excluded.window_start,
        locked_until = excluded.locked_until
    `).bind(attemptKey, failures, windowStart, lockedUntil).run();
    return Response.json({ error: mode === "owner" ? "Owner login is incorrect." : "Email or password is incorrect." }, { status: 401 });
  }
  await database().prepare("DELETE FROM login_attempts WHERE key = ?").bind(attemptKey).run();
  if (ownerBusinessId && isDemoBusiness(ownerBusinessId)) {
    await resetDemoWorkspace(database());
  }
  const sessionAccess = ownerId ? "owner" : "employee";
  const token = await createAppSession(sessionAccess, employeeId, ownerId);
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": `hourmark_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      },
    },
  );
}
