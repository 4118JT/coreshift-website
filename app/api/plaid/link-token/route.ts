import { ownerViewer, plaidConfig, plaidError } from "../_shared";

export async function POST() {
  const auth = await ownerViewer();
  if ("error" in auth) return auth.error;
  const config = plaidConfig();
  if (!config.clientId || !config.secret) return plaidError("Plaid is not configured yet. Add PLAID_CLIENT_ID and PLAID_SECRET in the hosting environment.");
  const response = await fetch(`${config.host}/link/token/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      secret: config.secret,
      client_name: "CoreShift",
      user: { client_user_id: auth.viewer.businessId },
      products: ["auth"],
      country_codes: ["US"],
      language: "en",
    }),
  });
  if (!response.ok) return plaidError(`Plaid could not create a connection session (${response.status}).`, 502);
  const data = await response.json() as { link_token?: string };
  if (!data.link_token) return plaidError("Plaid returned an invalid connection session.", 502);
  return Response.json({ linkToken: data.link_token, environment: config.environment });
}
