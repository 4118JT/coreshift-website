import {
  buildAppSession,
  generateNumericRecordId,
  hashCredential,
  hashPassword,
} from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export async function POST(request: Request) {
  const body = await request.json() as {
    companyCode?: string;
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  const companyCode = body.companyCode?.trim() ?? "";
  const name = body.name?.trim().slice(0, 100) ?? "";
  const email = body.email?.trim().toLowerCase().slice(0, 254) ?? "";
  const password = body.password ?? "";

  if (!/^\d{8}$/.test(companyCode) || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter the 8-digit company code, your name, and a valid email." }, { status: 400 });
  }
  if (password.length < 10) {
    return Response.json({ error: "Your password must be at least 10 characters." }, { status: 400 });
  }
  if (password !== body.confirmPassword) {
    return Response.json({ error: "The passwords do not match." }, { status: 400 });
  }

  await ensureDatabase();
  const now = Date.now();
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const attemptKey = await hashCredential(`employee-join:${clientIp}`);
  const attempts = await database().prepare(
    "SELECT failures, window_start AS windowStart, locked_until AS lockedUntil FROM login_attempts WHERE key = ?"
  ).bind(attemptKey).first<{ failures: number; windowStart: number; lockedUntil: number }>();
  if (attempts && attempts.lockedUntil > now) {
    return Response.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429, headers: { "retry-after": "900" } },
    );
  }

  const business = await database().prepare(
    "SELECT id FROM businesses WHERE employee_join_code = ?"
  ).bind(companyCode).first<{ id: string }>();
  if (!business) {
    const failures = attempts && now - attempts.windowStart < ATTEMPT_WINDOW_MS ? attempts.failures + 1 : 1;
    const windowStart = attempts && now - attempts.windowStart < ATTEMPT_WINDOW_MS ? attempts.windowStart : now;
    const lockedUntil = failures >= MAX_FAILURES ? now + ATTEMPT_WINDOW_MS : 0;
    await database().prepare(`
      INSERT INTO login_attempts (key, failures, window_start, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        failures = excluded.failures,
        window_start = excluded.window_start,
        locked_until = excluded.locked_until
    `).bind(attemptKey, failures, windowStart, lockedUntil).run();
    return Response.json({ error: "That company code is not valid." }, { status: 401 });
  }

  const employeeId = generateNumericRecordId();
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const session = await buildAppSession("employee", employeeId);
  try {
    await database().batch([
      database().prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(session.createdAt),
      database().prepare(`
        INSERT INTO employees (
          id, business_id, name, role, initials, color, email, phone,
          access_code_hash, password_hash, hourly_rate_cents, active, created_at
        ) VALUES (?, ?, ?, 'Employee', ?, 'violet', ?, NULL, NULL, ?, 0, 1, ?)
      `).bind(employeeId, business.id, name, initials, email, await hashPassword(password), now),
      database().prepare(`
        INSERT INTO app_sessions (token_hash, access, employee_id, owner_id, expires_at, created_at)
        VALUES (?, 'employee', ?, NULL, ?, ?)
      `).bind(session.tokenHash, employeeId, session.expiresAt, session.createdAt),
      database().prepare("DELETE FROM login_attempts WHERE key = ?").bind(attemptKey),
    ]);
  } catch {
    return Response.json(
      { error: "That email already belongs to an employee in this company." },
      { status: 409 },
    );
  }

  return Response.json(
    { ok: true },
    {
      status: 201,
      headers: {
        "set-cookie": `hourmark_session=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
      },
    },
  );
}
