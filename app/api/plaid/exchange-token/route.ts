import { database, ensureDatabase } from "../../../../db/runtime";
import { ownerViewer, plaidConfig, plaidError } from "../_shared";

export async function POST(request: Request) {
  const auth = await ownerViewer();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => ({})) as { publicToken?: string; institutionName?: string; institutionId?: string };
  const publicToken = body.publicToken?.trim();
  if (!publicToken) return plaidError("A Plaid public token is required.", 400);
  const config = plaidConfig();
  if (!config.clientId || !config.secret) return plaidError("Plaid is not configured yet. Add PLAID_CLIENT_ID and PLAID_SECRET in the hosting environment.");
  const response = await fetch(`${config.host}/item/public_token/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, secret: config.secret, public_token: publicToken }),
  });
  if (!response.ok) return plaidError(`Plaid could not finish the bank connection (${response.status}).`, 502);
  const data = await response.json() as { item_id?: string };
  if (!data.item_id) return plaidError("Plaid returned an invalid bank connection.", 502);
  await ensureDatabase();
  await database().prepare(`INSERT INTO plaid_items (business_id, item_id, institution_name, institution_id, connected_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(business_id) DO UPDATE SET item_id = excluded.item_id, institution_name = excluded.institution_name, institution_id = excluded.institution_id, connected_at = excluded.connected_at`).bind(auth.viewer.businessId, data.item_id, body.institutionName ?? null, body.institutionId ?? null, Date.now()).run();
  return Response.json({ connected: true, institutionName: body.institutionName ?? null });
}
