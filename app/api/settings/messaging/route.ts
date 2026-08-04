import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  const setting = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`messaging_enabled:${viewer.businessId}`).first<{ value: string }>();
  return Response.json({ enabled: setting?.value !== "false" });
}

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const body = await request.json() as { enabled?: boolean };
  if (typeof body.enabled !== "boolean") return Response.json({ error: "A messaging setting is required" }, { status: 400 });
  await database().prepare(`INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`messaging_enabled:${viewer.businessId}`, String(body.enabled)).run();
  return Response.json({ enabled: body.enabled });
}
