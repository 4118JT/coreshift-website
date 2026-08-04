import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const key = (businessId: string) => `role_permissions:${businessId}`;

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  const row = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(key(viewer.businessId)).first<{ value: string }>();
  return Response.json({ permissions: row?.value ? JSON.parse(row.value) : {} });
}

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const body = await request.json() as { permissions?: Record<string, Record<string, boolean>> };
  if (!body.permissions || typeof body.permissions !== "object") return Response.json({ error: "Permissions are required" }, { status: 400 });
  await database().prepare(`INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key(viewer.businessId), JSON.stringify(body.permissions)).run();
  return Response.json({ permissions: body.permissions });
}
