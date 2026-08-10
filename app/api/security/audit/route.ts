import { getViewer } from "../../../../db/viewer";
import { listAuditEvents } from "../../../../db/security";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  const requested = Number(new URL(request.url).searchParams.get("limit") || 100);
  const result = await listAuditEvents(viewer.businessId, requested);
  return Response.json({ events: result.results || [] }, { headers: { "cache-control": "no-store" } });
}
