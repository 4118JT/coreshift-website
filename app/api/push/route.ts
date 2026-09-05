import { database, ensureDatabase } from "../../../db/runtime";
import { publicVapidKey, pushIsConfigured } from "../../../db/push";
import { getViewer } from "../../../db/viewer";

type PushSubscriptionBody = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

function validKey(value: unknown, expectedBytes: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)), (character) => character.charCodeAt(0)).length === expectedBytes; } catch { return false; }
}

export async function GET() {
  return Response.json({ enabled: pushIsConfigured(), publicKey: publicVapidKey() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!pushIsConfigured()) return Response.json({ error: "Push notifications are not configured yet." }, { status: 503 });
  const body = await request.json().catch(() => null) as PushSubscriptionBody | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2048 || !validKey(body?.keys?.p256dh, 65) || !validKey(body?.keys?.auth, 16)) return Response.json({ error: "Invalid push subscription." }, { status: 400 });
  await ensureDatabase();
  const now = Date.now();
  await database().prepare("INSERT INTO push_subscriptions (endpoint, business_id, user_type, user_id, p256dh, auth, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET business_id = excluded.business_id, user_type = excluded.user_type, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at").bind(endpoint, viewer.businessId, viewer.access === "employee" ? "employee" : "owner", viewer.actorId, body!.keys!.p256dh, body!.keys!.auth, now, now).run();
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return Response.json({ error: "Invalid push subscription." }, { status: 400 });
  await ensureDatabase();
  await database().prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND business_id = ? AND user_type = ? AND user_id = ?").bind(body.endpoint, viewer.businessId, viewer.access === "employee" ? "employee" : "owner", viewer.actorId).run();
  return Response.json({ ok: true });
}
