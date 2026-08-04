import { env } from "cloudflare:workers";
import { hashCredential, hashPassword, verifyCredential } from "../../../../db/app-auth";
import { database, ensureDatabase } from "../../../../db/runtime";

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    email?: string;
    recoveryCode?: string;
    password?: string;
    confirmPassword?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase().slice(0, 254) ?? "";
  const recoveryCode = body?.recoveryCode?.trim() ?? "";
  const password = body?.password ?? "";
  if (!email || !recoveryCode) {
    return json({ error: "Enter the owner email and one-time recovery code." }, 400);
  }
  if (password.length < 10) {
    return json({ error: "Your new password must be at least 10 characters." }, 400);
  }
  if (password !== body?.confirmPassword) {
    return json({ error: "The passwords do not match." }, 400);
  }

  const secrets = env as unknown as {
    OWNER_RECOVERY_EMAIL?: string;
    OWNER_RECOVERY_TOKEN?: string;
  };
  const expectedEmail = secrets.OWNER_RECOVERY_EMAIL?.trim().toLowerCase();
  const expectedToken = secrets.OWNER_RECOVERY_TOKEN;
  if (!expectedEmail || !expectedToken) {
    return json({ error: "Owner recovery is not currently available." }, 503);
  }

  await ensureDatabase();
  const now = Date.now();
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  const attemptKey = await hashCredential(`owner-recovery-attempt:${clientIp}`);
  const ownerLoginAttemptKey = await hashCredential(`login:owner::${email}:${clientIp}`);

  const recoveryHash = await hashCredential(expectedToken);
  const usedKey = `owner-recovery-used:${recoveryHash}`;
  const alreadyUsed = await database().prepare(
    "SELECT 1 AS found FROM workspace_settings WHERE key = ?"
  ).bind(usedKey).first<{ found: number }>();
  const tokenMatches = await verifyCredential(recoveryCode, recoveryHash);
  const owner = email === expectedEmail
    ? await database().prepare("SELECT id FROM owners WHERE email = ? AND active = 1").bind(email).first<{ id: number }>()
    : null;

  if (!tokenMatches || !owner || alreadyUsed) {
    return json({ error: "That recovery code is invalid or has already been used." }, 401);
  }

  try {
    await database().batch([
      database().prepare("UPDATE owners SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), owner.id),
      database().prepare("DELETE FROM app_sessions WHERE owner_id = ?").bind(owner.id),
      database().prepare("INSERT INTO workspace_settings (key, value) VALUES (?, ?)").bind(usedKey, String(now)),
      database().prepare("DELETE FROM login_attempts WHERE key = ?").bind(attemptKey),
      database().prepare("DELETE FROM login_attempts WHERE key = ?").bind(ownerLoginAttemptKey),
    ]);
  } catch {
    return json({ error: "That recovery code is invalid or has already been used." }, 401);
  }

  const response = json({ ok: true }, 200);
  response.headers.set("set-cookie", "hourmark_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return response;
}
