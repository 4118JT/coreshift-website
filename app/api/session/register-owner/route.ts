import {
  buildAppSession,
  generateAccessCode,
  generateRecordId,
  generateNumericRecordId,
  hashCredential,
  hashPassword,
  verifyPassword,
} from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";

export async function POST(request: Request) {
  const body = await request.json() as {
    name?: string;
    businessName?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
  const name = body.name?.trim().slice(0, 100);
  const businessName = body.businessName?.trim().slice(0, 120);
  const email = body.email?.trim().toLowerCase().slice(0, 254);
  const password = body.password ?? "";
  if (!businessName || !name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter your business, name, and a valid email." }, { status: 400 });
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
  const signupKey = await hashCredential(`signup:v2:${clientIp}`);
  const signupAttempts = await database().prepare(
    "SELECT failures, window_start AS windowStart FROM login_attempts WHERE key = ?"
  ).bind(signupKey).first<{ failures: number; windowStart: number }>();
  const withinWindow =
    Boolean(signupAttempts) &&
    now - (signupAttempts?.windowStart ?? 0) < 60 * 60 * 1000;
  const signupCount = withinWindow ? (signupAttempts?.failures ?? 0) + 1 : 1;
  if (withinWindow && (signupAttempts?.failures ?? 0) >= 3) {
    return Response.json(
      { error: "Too many business accounts were created from this connection. Try again later." },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }

  const partialOwner = await database().prepare(`
    SELECT o.id, o.business_id AS businessId, o.password_hash AS passwordHash
    FROM owners o
    WHERE lower(o.email) = ?
      AND o.active = 1
      AND o.created_at >= ?
      AND NOT EXISTS (
        SELECT 1 FROM app_sessions s WHERE s.owner_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM employees e WHERE e.business_id = o.business_id
      )
      AND (
        SELECT COUNT(*) FROM owners sibling WHERE sibling.business_id = o.business_id
      ) = 1
  `).bind(email, now - 2 * 60 * 60 * 1000).first<{
    id: number;
    businessId: string;
    passwordHash: string;
  }>();
  if (
    partialOwner &&
    await verifyPassword(password, partialOwner.passwordHash)
  ) {
    await database().batch([
      database().prepare(
        "DELETE FROM owners WHERE id = ? AND business_id = ?"
      ).bind(partialOwner.id, partialOwner.businessId),
      database().prepare(`
        DELETE FROM businesses
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM owners WHERE business_id = ?)
          AND NOT EXISTS (SELECT 1 FROM employees WHERE business_id = ?)
      `).bind(
        partialOwner.businessId,
        partialOwner.businessId,
        partialOwner.businessId,
      ),
    ]);
  }

  try {
    const businessId = generateRecordId();
    const ownerId = generateNumericRecordId();
    const employeeJoinCode = generateAccessCode();
    const createdAt = now;
    const session = await buildAppSession("owner", null, ownerId);
    await database().batch([
      database().prepare(
        "DELETE FROM app_sessions WHERE expires_at <= ?"
      ).bind(session.createdAt),
      database().prepare(
        "INSERT INTO businesses (id, name, employee_join_code, created_at) VALUES (?, ?, ?, ?)"
      ).bind(businessId, businessName, employeeJoinCode, createdAt),
      database().prepare(`
        INSERT INTO owners (id, business_id, name, email, password_hash, active, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).bind(ownerId, businessId, name, email, await hashPassword(password), createdAt),
      database().prepare(`
        INSERT INTO app_sessions (token_hash, access, employee_id, owner_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        session.tokenHash,
        session.access,
        session.employeeId,
        session.ownerId,
        session.expiresAt,
        session.createdAt,
      ),
      database().prepare(`
        INSERT INTO login_attempts (key, failures, window_start, locked_until)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(key) DO UPDATE SET
          failures = excluded.failures,
          window_start = excluded.window_start,
          locked_until = 0
      `).bind(
        signupKey,
        signupCount,
        withinWindow ? (signupAttempts?.windowStart ?? now) : now,
      ),
    ]);
    return Response.json(
      { ok: true },
      {
        status: 201,
        headers: {
          "set-cookie": `hourmark_session=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      },
    );
  } catch (error) {
    const existingOwner = await database().prepare(
      "SELECT id FROM owners WHERE lower(email) = ?"
    ).bind(email).first<{ id: number }>();
    console.error({
      event: "owner_registration_failed",
      duplicateEmail: Boolean(existingOwner),
      cause: error instanceof Error ? error.message : "unknown",
    });
    return existingOwner
      ? Response.json({ error: "That email already has an owner account." }, { status: 409 })
      : Response.json({ error: "Unable to create the business account. Please try again." }, { status: 500 });
  }
}
