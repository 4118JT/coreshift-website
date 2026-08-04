import { env } from "cloudflare:workers";
import { getViewer } from "../../../db/viewer";

export function plaidConfig() {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const clientId = runtimeEnv.PLAID_CLIENT_ID?.trim();
  const secret = runtimeEnv.PLAID_SECRET?.trim();
  const environment = runtimeEnv.PLAID_ENV === "production" ? "production" : "sandbox";
  return { clientId, secret, environment, host: environment === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com" };
}

export async function ownerViewer() {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return { error: Response.json({ error: "Owner access required" }, { status: 403 }) } as const;
  if (viewer.businessId === "__coreshift_demo__") return { error: Response.json({ error: "Bank connections are disabled in demo mode." }, { status: 403 }) } as const;
  return { viewer } as const;
}

export function plaidError(message: string, status = 503) {
  return Response.json({ error: message }, { status });
}
