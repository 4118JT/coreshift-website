import { database, ensureDatabase } from "./runtime";

const AUTH_PEPPER = "bdaaff613afcb6f984053c1a0c7df974e6facd9d8d59b75803032e3c3db667d8";
const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 100_000;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateRecordId() {
  return randomHex(16);
}

export function generateNumericRecordId() {
  const value = new Uint32Array(2);
  crypto.getRandomValues(value);
  const high = value[0] & 0x1fffff;
  return Math.max(1, high * 0x100000000 + value[1]);
}

function equalHash(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]+$/.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derivePassword(value: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${AUTH_PEPPER}:${value}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function hashCredential(value: string) {
  return sha256(`${AUTH_PEPPER}:${value}`);
}

export async function hashPassword(value: string) {
  const saltHex = randomHex(16);
  const salt = hexToBytes(saltHex);
  if (!salt) throw new Error("Password salt generation failed");
  const hash = await derivePassword(value, salt, PASSWORD_ITERATIONS);
  return `pbkdf2$${PASSWORD_ITERATIONS}$${saltHex}$${hash}`;
}

export async function verifyPassword(
  value: string,
  expectedHash: string | null | undefined,
) {
  if (!expectedHash?.startsWith("pbkdf2$")) {
    return verifyCredential(value, expectedHash);
  }
  const [, iterationsValue, saltHex, expected] = expectedHash.split("$");
  const iterations = Number(iterationsValue);
  const salt = hexToBytes(saltHex);
  if (
    !salt ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000 ||
    !/^[a-f0-9]{64}$/.test(expected)
  ) {
    return false;
  }
  return equalHash(await derivePassword(value, salt, iterations), expected);
}

export async function verifyCredential(value: string, expectedHash: string | null | undefined) {
  if (!expectedHash) return false;
  return equalHash(await hashCredential(value), expectedHash);
}

export function generateAccessCode() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(10_000_000 + (random[0] % 90_000_000));
}

export async function createAppSession(
  access: "owner" | "employee",
  employeeId: number | null,
  ownerId: number | null = null,
) {
  await ensureDatabase();
  const session = await buildAppSession(access, employeeId, ownerId);
  await database().batch([
    database().prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(session.createdAt),
    database().prepare(
      "INSERT INTO app_sessions (token_hash, access, employee_id, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      session.tokenHash,
      session.access,
      session.employeeId,
      session.ownerId,
      session.expiresAt,
      session.createdAt,
    ),
  ]);
  return session.token;
}

export async function buildAppSession(
  access: "owner" | "employee",
  employeeId: number | null,
  ownerId: number | null = null,
) {
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const now = Date.now();
  return {
    token,
    tokenHash,
    access,
    employeeId,
    ownerId,
    expiresAt: now + SESSION_AGE_MS,
    createdAt: now,
  };
}

export async function getAppSession(token: string | undefined) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  await ensureDatabase();
  const row = await database().prepare(`
    SELECT
      CASE WHEN s.access = 'owner' OR lower(trim(COALESCE(e.role, ''))) = 'owner' THEN 'owner' ELSE 'employee' END AS access,
      s.employee_id AS employeeId,
      COALESCE(s.owner_id, (SELECT owner_row.id FROM owners owner_row WHERE owner_row.business_id = e.business_id AND owner_row.active = 1 ORDER BY owner_row.id LIMIT 1)) AS ownerId,
      s.expires_at AS expiresAt,
      COALESCE(e.display_name, e.name) AS name, e.email, e.role,
      o.name AS ownerName, o.email AS ownerEmail,
      COALESCE(o.business_id, e.business_id) AS businessId,
      b.name AS businessName
    FROM app_sessions s
    LEFT JOIN employees e ON e.id = s.employee_id
    LEFT JOIN owners o ON o.id = s.owner_id AND o.active = 1
    LEFT JOIN businesses b ON b.id = COALESCE(o.business_id, e.business_id)
    WHERE s.token_hash = ?
  `).bind(await sha256(token)).first<{
    access: "owner" | "employee";
    employeeId: number | null;
    ownerId: number | null;
    expiresAt: number;
    name: string | null;
    email: string | null;
    role: string | null;
    ownerName: string | null;
    ownerEmail: string | null;
    businessId: string | null;
    businessName: string | null;
  }>();
  if (!row || row.expiresAt <= Date.now()) return null;
  if (row.access === "employee" && (!row.employeeId || !row.name)) return null;
  // Employees promoted to the Owner role use the same owner capabilities as
  // the primary owner. Their session still points at the employee row so we
  // can show their own name, while ownerId supplies the business context.
  if (row.access === "owner" && (!row.ownerId || (!row.ownerName && !row.name))) return null;
  if (!row.businessId || !row.businessName) return null;
  return row;
}
