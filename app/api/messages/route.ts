import { database, ensureDatabase } from "../../../db/runtime";
import { getViewer } from "../../../db/viewer";

async function access() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return { viewer, enabled: false };
  let setting: { value: string } | null = null;
  try {
    setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  } catch {
    await ensureDatabase();
    setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  }
  return { viewer, enabled: setting?.value !== "false" };
}

export async function GET(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ enabled: false, messages: [] });
  const conversationId = new URL(request.url).searchParams.get("conversationId") || "managers";
  const rows = await database().prepare(`SELECT id, sender_type AS senderType, sender_id AS senderId, sender_name AS senderName, body, created_at AS createdAt FROM (SELECT id, sender_type, sender_id, sender_name, body, created_at FROM messages WHERE business_id = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 100) recent ORDER BY created_at ASC, id ASC`).bind(viewer.businessId, conversationId).all();
  return Response.json({ enabled: true, messages: rows.results }, { headers: { "cache-control": "private, max-age=5, stale-while-revalidate=30" } });
}

export async function POST(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ error: "Messaging is disabled by the owner." }, { status: 403 });
  const body = await request.json() as { body?: string; conversationId?: string };
  const message = body.body?.trim().slice(0, 2000);
  if (!message) return Response.json({ error: "Enter a message." }, { status: 400 });
  const senderType = viewer.access === "owner" ? "owner" : "employee";
  const senderId = viewer.employeeId ?? 0;
  const createdAt = Date.now();
  const conversationId = body.conversationId?.trim().slice(0, 120) || "managers";
  const result = await database().prepare("INSERT INTO messages (business_id, conversation_id, sender_type, sender_id, sender_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(viewer.businessId, conversationId, senderType, senderId, viewer.displayName, message, createdAt).first<{ id: number }>();
  return Response.json({ id: result?.id, conversationId, senderType, senderId, senderName: viewer.displayName, body: message, createdAt }, { status: 201 });
}
