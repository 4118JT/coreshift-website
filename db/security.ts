import { database, ensureDatabase } from "./runtime";

type AuditInput = {
  businessId?: string | null;
  actorType: "owner" | "employee" | "system" | "anonymous";
  actorId?: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  outcome?: "success" | "denied" | "failed";
  metadata?: Record<string, string | number | boolean | null>;
  request?: Request;
};

const encoder = new TextEncoder();

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function ensureAuditTable() {
  await ensureDatabase();
  await database().prepare(`CREATE TABLE IF NOT EXISTS security_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    outcome TEXT NOT NULL,
    metadata TEXT,
    ip_hash TEXT,
    created_at INTEGER NOT NULL
  )`).run();
  await database().prepare("CREATE INDEX IF NOT EXISTS security_audit_business_time_idx ON security_audit_events(business_id, created_at DESC)").run();
}

export async function enforceRateLimit(
  request: Request,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
) {
  await ensureDatabase();
  const now = Date.now();
  const key = await digest(`security:v1:${scope}:${subject}:${clientIp(request)}`);
  const row = await database().prepare(
    "SELECT failures, window_start AS windowStart, locked_until AS lockedUntil FROM login_attempts WHERE key = ?",
  ).bind(key).first<{ failures: number; windowStart: number; lockedUntil: number }>();
  const activeWindow = Boolean(row && now - row.windowStart < windowMs);
  const count = activeWindow ? row!.failures + 1 : 1;
  const blocked = Boolean(row && row.lockedUntil > now) || count > limit;
  const lockedUntil = blocked ? Math.max(row?.lockedUntil || 0, (activeWindow ? row!.windowStart : now) + windowMs) : 0;
  await database().prepare(`INSERT INTO login_attempts (key, failures, window_start, locked_until)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, window_start = excluded.window_start, locked_until = excluded.locked_until`)
    .bind(key, count, activeWindow ? row!.windowStart : now, lockedUntil).run();
  return {
    allowed: !blocked,
    retryAfter: blocked ? Math.max(1, Math.ceil((lockedUntil - now) / 1000)) : 0,
  };
}

export function rateLimitResponse(retryAfter: number) {
  return Response.json(
    { error: "Too many requests. Please wait and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter), "cache-control": "no-store" } },
  );
}

export async function recordAudit(input: AuditInput) {
  try {
    await ensureAuditTable();
    const ipHash = input.request ? (await digest(clientIp(input.request))).slice(0, 24) : null;
    await database().prepare(`INSERT INTO security_audit_events
      (business_id, actor_type, actor_id, action, target_type, target_id, outcome, metadata, ip_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.businessId || null,
        input.actorType,
        input.actorId ?? null,
        input.action.slice(0, 100),
        input.targetType?.slice(0, 80) || null,
        input.targetId == null ? null : String(input.targetId).slice(0, 160),
        input.outcome || "success",
        input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
        ipHash,
        Date.now(),
      ).run();
  } catch (error) {
    console.error({ event: "security_audit_write_failed", cause: error instanceof Error ? error.message : "unknown" });
  }
}

export async function listAuditEvents(businessId: string, limit = 100) {
  await ensureAuditTable();
  return database().prepare(`SELECT id, actor_type AS actorType, actor_id AS actorId, action,
    target_type AS targetType, target_id AS targetId, outcome, metadata, created_at AS createdAt
    FROM security_audit_events WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(businessId, Math.max(1, Math.min(250, limit))).all();
}
