import { database, ensureDatabase, mediaBucket } from "../../../db/runtime";
import { getViewer } from "../../../db/viewer";

async function access() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return { viewer, enabled: false };
  await ensureDatabase();
  let setting: { value: string } | null = null;
  try {
    setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  } catch {
    await ensureDatabase();
    setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  }
  return { viewer, enabled: setting?.value !== "false" };
}

function canAccessConversation(viewer: Awaited<ReturnType<typeof getViewer>>, conversationId: string) {
  return viewer.access !== "employee" || conversationId === `direct-${viewer.employeeId}` || conversationId.startsWith("group-");
}

function readReceiptTimeLabel(readAt: number) {
  const date = new Date(readAt);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === now.toDateString()
    ? `at ${time}`
    : `on ${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

function readReceiptLabel(readerName: string, readAt: number) {
  return `${readerName} ${readReceiptTimeLabel(readAt)}`;
}

function summarizeReadReceipts(receipts: Array<{ readerType: string; readerId: number; readerName: string; readAt: number }>) {
  if (receipts.length <= 2) return receipts;
  const latest = receipts[receipts.length - 1];
  return [{ ...latest, readerName: `${receipts.length} people` }];
}

export async function GET(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ enabled: false, messages: [] });
  const url = new URL(request.url);
  const mediaKey = url.searchParams.get("media");
  if (mediaKey) {
    if (!mediaKey.startsWith(`messages/${viewer.businessId}/`)) return Response.json({ error: "Media not found" }, { status: 404 });
    const message = await database().prepare("SELECT id FROM messages WHERE business_id = ? AND image_data = ? LIMIT 1").bind(viewer.businessId, `video:${mediaKey}`).first<{ id: number }>();
    if (!message) return Response.json({ error: "Media not found" }, { status: 404 });
    const object = await mediaBucket().get(mediaKey);
    if (!object) return Response.json({ error: "Media not found" }, { status: 404 });
    const headers = new Headers({ "cache-control": "private, no-store", "accept-ranges": "bytes" });
    object.writeHttpMetadata(headers);
    headers.set("content-length", String(object.size));
    return new Response(object.body, { headers });
  }
  const viewerType = viewer.access === "employee" ? "employee" : "owner";
  const viewerId = viewer.actorId;
  const employeeConversationId = viewer.access === "employee" ? `direct-${viewer.employeeId}` : null;
  const now = Date.now();
  const isSentByViewer = (message: { senderType: string; senderId: number; senderName: string }) => message.senderType === viewerType && (message.senderId === viewerId || (viewerType === "owner" && message.senderId === 0 && message.senderName === viewer.displayName));
  if (url.searchParams.get("list") === "1") {
    const [recent, online] = await Promise.all([
      database().prepare(`SELECT m.conversation_id AS id, m.sender_type AS senderType, m.sender_id AS senderId, m.sender_name AS senderName, m.body, m.image_data AS imageData, m.created_at AS lastMessageAt, (SELECT COUNT(*) FROM messages unread_message WHERE unread_message.business_id = m.business_id AND unread_message.conversation_id = m.conversation_id AND NOT (unread_message.sender_type = ? AND unread_message.sender_id = ?) AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = unread_message.id AND mr.reader_type = ? AND mr.reader_id = ?)) AS unread FROM messages m WHERE m.business_id = ? ${employeeConversationId ? "AND (m.conversation_id = ? OR m.conversation_id LIKE 'group-%')" : ""} AND m.id = (SELECT newest.id FROM messages newest WHERE newest.business_id = m.business_id AND newest.conversation_id = m.conversation_id ORDER BY newest.created_at DESC, newest.id DESC LIMIT 1) ORDER BY m.created_at DESC, m.id DESC LIMIT 100`).bind(viewerType, viewerId, viewerType, viewerId, viewer.businessId, ...(employeeConversationId ? [employeeConversationId] : [])).all(),
      database().prepare("SELECT user_type AS userType, user_id AS userId, user_name AS userName, last_seen AS lastSeen FROM message_presence WHERE business_id = ?").bind(viewer.businessId).all(),
    ]);
    const recentConversations = (recent.results as Array<{ senderType: string; senderId: number; senderName: string }>).map((conversation) => ({ ...conversation, sentByViewer: isSentByViewer(conversation) }));
    return Response.json({ enabled: true, recentConversations, onlinePeople: online.results }, { headers: { "cache-control": "private, no-store" } });
  }
  const conversationId = url.searchParams.get("conversationId") || "managers";
  if (!canAccessConversation(viewer, conversationId)) return Response.json({ error: "Not authorized for this conversation." }, { status: 403 });
  const [rows, reactionRows, readRows, typingRows] = await Promise.all([
    database().prepare(`SELECT recent.id, recent.sender_type AS senderType, recent.sender_id AS senderId, recent.sender_name AS senderName, recent.body, recent.image_data AS imageData, recent.image_name AS imageName, recent.created_at AS createdAt, recent.reply_to_id AS replyToId, parent.sender_name AS replySenderName, parent.body AS replyBody FROM (SELECT id, sender_type, sender_id, sender_name, body, image_data, image_name, created_at, reply_to_id FROM messages WHERE business_id = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 100) recent LEFT JOIN messages parent ON parent.id = recent.reply_to_id AND parent.business_id = ? ORDER BY recent.created_at ASC, recent.id ASC`).bind(viewer.businessId, conversationId, viewer.businessId).all(),
    database().prepare(`SELECT mr.message_id AS messageId, mr.emoji, COUNT(*) AS count, MAX(CASE WHEN mr.reactor_type = ? AND mr.reactor_id = ? THEN 1 ELSE 0 END) AS reactedByViewer FROM message_reactions mr JOIN messages m ON m.id = mr.message_id WHERE mr.business_id = ? AND m.conversation_id = ? GROUP BY mr.message_id, mr.emoji`).bind(viewerType, viewerId, viewer.businessId, conversationId).all<{ messageId: number; emoji: string; count: number; reactedByViewer: number }>(),
    database().prepare(`SELECT mr.message_id AS messageId, mr.reader_type AS readerType, mr.reader_id AS readerId, mr.reader_name AS readerName, mr.read_at AS readAt FROM message_reads mr JOIN messages m ON m.id = mr.message_id WHERE mr.business_id = ? AND m.conversation_id = ? ORDER BY mr.read_at ASC`).bind(viewer.businessId, conversationId).all<{ messageId: number; readerType: string; readerId: number; readerName: string; readAt: number }>(),
    database().prepare("SELECT user_type AS userType, user_id AS userId, user_name AS userName, last_seen AS lastSeen FROM message_presence WHERE business_id = ? AND conversation_id = ? AND typing_until > ? AND NOT (user_type = ? AND user_id = ?) ORDER BY user_name ASC").bind(viewer.businessId, conversationId, now, viewerType, viewerId).all(),
  ]);
  const reactionsByMessage = new Map<number, Array<{ emoji: string; count: number; reactedByViewer: boolean }>>();
  for (const reaction of reactionRows.results) {
    const reactions = reactionsByMessage.get(reaction.messageId) ?? [];
    reactions.push({ emoji: reaction.emoji, count: Number(reaction.count), reactedByViewer: Boolean(reaction.reactedByViewer) });
    reactionsByMessage.set(reaction.messageId, reactions);
  }
  const readsByMessage = new Map<number, Array<{ readerType: string; readerId: number; readerName: string; readAt: number }>>();
  for (const receipt of readRows.results) {
    if (receipt.readerType === viewerType && receipt.readerId === viewerId) continue;
    const receipts = readsByMessage.get(receipt.messageId) ?? [];
    receipts.push(receipt);
    readsByMessage.set(receipt.messageId, receipts);
  }
  for (const [messageId, receipts] of readsByMessage) readsByMessage.set(messageId, summarizeReadReceipts(receipts));
  const messages = (rows.results as Array<{ id: number; senderType: string; senderId: number; senderName: string; replyToId?: number | null; replySenderName?: string | null; replyBody?: string | null }>).map((message) => ({ ...message, replyTo: message.replyToId && message.replySenderName ? { id: message.replyToId, senderName: message.replySenderName, body: message.replyBody || "Photo" } : null, sentByViewer: isSentByViewer(message), reactions: reactionsByMessage.get(message.id) ?? [], readBy: readsByMessage.get(message.id) ?? [] }));
  return Response.json({ enabled: true, messages, typingPeople: typingRows.results }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ error: "Messaging is disabled by the owner." }, { status: 403 });
  const body = await request.json() as { body?: string; imageData?: string; imageName?: string; videoKey?: string; videoName?: string; conversationId?: string; replyToId?: number };
  const message = body.body?.trim().slice(0, 2000);
  const rawImageData = body.imageData?.trim();
  const imageData = rawImageData && rawImageData.length <= 1_800_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawImageData) ? rawImageData : null;
  if (rawImageData && !imageData) return Response.json({ error: "The photo is too large or unsupported." }, { status: 400 });
  const requestedVideoKey = body.videoKey?.trim();
  const videoKey = requestedVideoKey && requestedVideoKey.startsWith(`messages/${viewer.businessId}/`) ? requestedVideoKey : null;
  if (requestedVideoKey && !videoKey) return Response.json({ error: "That video could not be attached." }, { status: 400 });
  if (videoKey && !await mediaBucket().head(videoKey)) return Response.json({ error: "That video upload could not be found. Please try again." }, { status: 400 });
  if (imageData && videoKey) return Response.json({ error: "Send either one photo or one video per message." }, { status: 400 });
  if (!message && !imageData && !videoKey) return Response.json({ error: "Enter a message or add a photo or video." }, { status: 400 });
  const storedMedia = videoKey ? `video:${videoKey}` : imageData;
  const imageName = imageData ? body.imageName?.trim().slice(0, 120) || "Photo" : videoKey ? body.videoName?.trim().slice(0, 120) || "Video" : null;
  const senderType = viewer.access === "owner" ? "owner" : "employee";
  const senderId = viewer.actorId;
  const createdAt = Date.now();
  const conversationId = body.conversationId?.trim().slice(0, 120) || "managers";
  if (!canAccessConversation(viewer, conversationId)) return Response.json({ error: "Not authorized for this conversation." }, { status: 403 });
  const requestedReplyId = Number(body.replyToId);
  const replyTo = Number.isInteger(requestedReplyId) && requestedReplyId > 0
    ? await database().prepare("SELECT id, sender_name AS senderName, body FROM messages WHERE id = ? AND business_id = ? AND conversation_id = ?").bind(requestedReplyId, viewer.businessId, conversationId).first<{ id: number; senderName: string; body: string }>()
    : null;
  const result = await database().prepare("INSERT INTO messages (business_id, conversation_id, sender_type, sender_id, sender_name, body, image_data, image_name, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(viewer.businessId, conversationId, senderType, senderId, viewer.displayName, message ?? "", storedMedia, imageName, replyTo?.id ?? null, createdAt).first<{ id: number }>();
  return Response.json({ id: result?.id, conversationId, senderType, senderId, senderName: viewer.displayName, body: message ?? "", imageData: storedMedia, imageName, replyTo: replyTo ? { id: replyTo.id, senderName: replyTo.senderName, body: replyTo.body || "Photo" } : null, createdAt, sentByViewer: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ error: "Messaging is disabled by the owner." }, { status: 403 });
  const body = await request.json() as { action?: "presence" | "typing"; conversationId?: string; throughMessageId?: number; typing?: boolean };
  if (body.action === "presence") {
    const userType = viewer.access === "employee" ? "employee" : "owner";
    const userId = viewer.actorId;
    await database().prepare("INSERT INTO message_presence (business_id, user_type, user_id, user_name, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT (business_id, user_type, user_id) DO UPDATE SET user_name = excluded.user_name, last_seen = excluded.last_seen").bind(viewer.businessId, userType, userId, viewer.displayName, Date.now()).run();
    return Response.json({ ok: true });
  }
  if (body.action === "typing") {
    const conversationId = body.conversationId?.trim().slice(0, 120);
    if (!conversationId) return Response.json({ error: "Invalid typing state." }, { status: 400 });
    if (!canAccessConversation(viewer, conversationId)) return Response.json({ error: "Not authorized for this conversation." }, { status: 403 });
    const userType = viewer.access === "employee" ? "employee" : "owner";
    const userId = viewer.actorId;
    const now = Date.now();
    const typingUntil = body.typing === false ? 0 : now + 6_000;
    await database().prepare("INSERT INTO message_presence (business_id, user_type, user_id, user_name, conversation_id, typing_until, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (business_id, user_type, user_id) DO UPDATE SET user_name = excluded.user_name, conversation_id = excluded.conversation_id, typing_until = excluded.typing_until, last_seen = excluded.last_seen").bind(viewer.businessId, userType, userId, viewer.displayName, conversationId, typingUntil, now).run();
    return Response.json({ ok: true });
  }
  const conversationId = body.conversationId?.trim().slice(0, 120);
  const throughMessageId = Number(body.throughMessageId);
  if (!conversationId || !Number.isInteger(throughMessageId) || throughMessageId < 1) return Response.json({ error: "Invalid read receipt." }, { status: 400 });
  if (!canAccessConversation(viewer, conversationId)) return Response.json({ error: "Not authorized for this conversation." }, { status: 403 });
  const readerType = viewer.access === "employee" ? "employee" : "owner";
  const readerId = viewer.actorId;
  await database().prepare(`INSERT OR IGNORE INTO message_reads (message_id, business_id, reader_type, reader_id, reader_name, read_at) SELECT id, business_id, ?, ?, ?, ? FROM messages WHERE business_id = ? AND conversation_id = ? AND id <= ? AND NOT (sender_type = ? AND sender_id = ?)`).bind(readerType, readerId, viewer.displayName, Date.now(), viewer.businessId, conversationId, throughMessageId, readerType, readerId).run();
  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const { viewer, enabled } = await access();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  if (!enabled) return Response.json({ error: "Messaging is disabled by the owner." }, { status: 403 });
  const body = await request.json() as { messageId?: number; emoji?: string };
  const messageId = Number(body.messageId);
  const allowedEmojis = ["👍", "❤️", "😂", "😮", "😢", "🎉"];
  if (!Number.isInteger(messageId) || messageId < 1 || !body.emoji || !allowedEmojis.includes(body.emoji)) return Response.json({ error: "Invalid reaction." }, { status: 400 });
  const message = await database().prepare("SELECT id FROM messages WHERE id = ? AND business_id = ?").bind(messageId, viewer.businessId).first<{ id: number }>();
  if (!message) return Response.json({ error: "Message not found." }, { status: 404 });
  const reactorType = viewer.access === "employee" ? "employee" : "owner";
  const reactorId = viewer.actorId;
  const existing = await database().prepare("SELECT message_id FROM message_reactions WHERE message_id = ? AND reactor_type = ? AND reactor_id = ? AND emoji = ?").bind(messageId, reactorType, reactorId, body.emoji).first<{ message_id: number }>();
  if (existing) await database().prepare("DELETE FROM message_reactions WHERE message_id = ? AND reactor_type = ? AND reactor_id = ? AND emoji = ?").bind(messageId, reactorType, reactorId, body.emoji).run();
  else await database().prepare("INSERT INTO message_reactions (message_id, business_id, reactor_type, reactor_id, emoji, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(messageId, viewer.businessId, reactorType, reactorId, body.emoji, Date.now()).run();
  const total = await database().prepare("SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ? AND emoji = ?").bind(messageId, body.emoji).first<{ count: number }>();
  return Response.json({ active: !existing, count: Number(total?.count ?? 0) });
}
