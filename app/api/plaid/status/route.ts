import { database, ensureDatabase } from "../../../../db/runtime";
import { ownerViewer } from "../_shared";

export async function GET() {
  const auth = await ownerViewer();
  if ("error" in auth) return auth.error;
  await ensureDatabase();
  const item = await database().prepare("SELECT institution_name AS institutionName, institution_id AS institutionId, connected_at AS connectedAt FROM plaid_items WHERE business_id = ?").bind(auth.viewer.businessId).first<{ institutionName: string | null; institutionId: string | null; connectedAt: number }>();
  return Response.json({ connected: Boolean(item), item: item ?? null });
}
