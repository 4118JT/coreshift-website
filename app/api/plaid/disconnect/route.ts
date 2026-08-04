import { database, ensureDatabase } from "../../../../db/runtime";
import { ownerViewer } from "../_shared";

export async function DELETE() {
  const auth = await ownerViewer();
  if ("error" in auth) return auth.error;
  await ensureDatabase();
  await database().prepare("DELETE FROM plaid_items WHERE business_id = ?").bind(auth.viewer.businessId).run();
  return Response.json({ connected: false });
}
