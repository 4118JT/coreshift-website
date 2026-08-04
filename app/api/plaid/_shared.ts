import { NextResponse } from "next/server";

export type PlaidViewer = { kind: "owner" | "employee"; businessId: number; employeeId: number | null; raw: any };

export async function plaidDb(): Promise<any> {
  const runtime: any = await import("@/db/runtime");
  const factory = runtime.getDb ?? runtime.getDatabase ?? runtime.database ?? runtime.db;
  const value = typeof factory === "function" ? await factory() : factory;
  const db = value?.prepare ? value : value?.$client ?? value?.session?.client ?? value?.client;
  if (!db?.prepare) throw new Error("Database binding is unavailable.");
  return db;
}

export async function currentPlaidViewer(): Promise<PlaidViewer | NextResponse> {
  const module: any = await import("@/db/viewer");
  const resolver = module.getViewer ?? module.currentViewer ?? module.resolveViewer;
  if (typeof resolver !== "function") return NextResponse.json({ error: "Authentication is unavailable." }, { status: 500 });
  const raw = await resolver();
  const kind = String(raw?.kind ?? raw?.type ?? raw?.role ?? "").toLowerCase();
  if (kind !== "owner" && kind !== "employee") return NextResponse.json({ error: "Sign in to connect a bank account." }, { status: 401 });
  const businessId = Number(raw.businessId ?? raw.business_id ?? raw.business?.id);
  const employeeId = kind === "employee" ? Number(raw.employeeId ?? raw.employee_id ?? raw.employee?.id) : null;
  if (!Number.isFinite(businessId) || (kind === "employee" && !Number.isFinite(employeeId))) {
    return NextResponse.json({ error: "Your account is missing payroll access." }, { status: 403 });
  }
  return { kind: kind as "owner" | "employee", businessId, employeeId, raw };
}

export async function ownerViewer(): Promise<PlaidViewer | NextResponse> {
  const viewer = await currentPlaidViewer();
  if (viewer instanceof NextResponse) return viewer;
  if (viewer.kind !== "owner") return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  return viewer;
}

export function viewerSubject(viewer: PlaidViewer) {
  return { subjectType: viewer.kind, subjectId: viewer.kind === "employee" ? Number(viewer.employeeId) : 0 };
}

export function plaidConfig() {
  const environment = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  const hosts: Record<string, string> = {
    sandbox: "https://sandbox.plaid.com",
    development: "https://development.plaid.com",
    production: "https://production.plaid.com",
  };
  const clientId = process.env.PLAID_CLIENT_ID || "";
  const secret = process.env.PLAID_SECRET || "";
  return {
    clientId, secret, environment,
    host: hosts[environment] || hosts.sandbox,
    webhook: process.env.PLAID_WEBHOOK_URL || "",
    configured: Boolean(clientId && secret && process.env.PLAID_TOKEN_ENCRYPTION_KEY),
  };
}

export async function plaidRequest<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = plaidConfig();
  if (!config.clientId || !config.secret) throw new Error("Plaid credentials are not configured.");
  const response = await fetch(`${config.host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_message || payload?.display_message || "Plaid request failed.");
  return payload as T;
}

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decode(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function tokenKey() {
  const secret = process.env.PLAID_TOKEN_ENCRYPTION_KEY || "";
  if (secret.length < 24) throw new Error("Plaid token encryption is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptAccessToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(token));
  return `${encode(iv)}.${encode(new Uint8Array(data))}`;
}
export async function decryptAccessToken(value: string) {
  const [iv, data] = value.split(".");
  if (!iv || !data) throw new Error("Stored Plaid token is invalid.");
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv) }, await tokenKey(), decode(data));
  return new TextDecoder().decode(clear);
}

export async function ensurePlaidTables(db: any) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS plaid_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, subject_type TEXT NOT NULL,
      subject_id INTEGER NOT NULL, item_id TEXT NOT NULL, access_token_encrypted TEXT NOT NULL,
      account_id TEXT NOT NULL, institution_name TEXT, institution_id TEXT, account_name TEXT,
      account_mask TEXT, account_type TEXT, connected_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (business_id, subject_type, subject_id))`,
    `CREATE TABLE IF NOT EXISTS plaid_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, business_id INTEGER NOT NULL, employee_id INTEGER NOT NULL,
      period_start TEXT NOT NULL, period_end TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE, authorization_id TEXT, transfer_id TEXT UNIQUE,
      decision TEXT, status TEXT NOT NULL DEFAULT 'created', failure_reason TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS idx_plaid_accounts_business ON plaid_accounts (business_id, subject_type)",
    "CREATE INDEX IF NOT EXISTS idx_plaid_transfers_business ON plaid_transfers (business_id, created_at)",
  ];
  for (const sql of statements) await db.prepare(sql).run();
  try { await db.prepare("ALTER TABLE employee_payments ADD COLUMN plaid_transfer_id TEXT").run(); } catch {}
  try { await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_payments_plaid_transfer ON employee_payments (plaid_transfer_id)").run(); } catch {}
}

export function plaidError(error: unknown, fallback = "Plaid could not complete that request.") {
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
