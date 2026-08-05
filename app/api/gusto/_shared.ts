import { readConnection, requireOwner, validConnectionTokens } from "../integrations/_shared";

export const GUSTO_API_VERSION = "2026-06-15";

export async function requireGustoContext(request: Request) {
  const viewer = await requireOwner();
  if (!viewer) throw new Error("Owner access required.");
  const connection = await readConnection(viewer.businessId, "gusto");
  if (!connection) throw new Error("Connect Gusto in Settings before opening payroll setup.");
  const authorized = await validConnectionTokens(viewer.businessId, "gusto", new URL(request.url).origin);
  if (!authorized.stored.accountId || authorized.stored.accountId === "connected") throw new Error("Gusto did not provide a company ID. Reconnect the Gusto company.");
  return { viewer, companyId: authorized.stored.accountId, ...authorized };
}

export async function gustoRequest(context: Awaited<ReturnType<typeof requireGustoContext>>, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${context.tokens.accessToken}`);
  headers.set("accept", "application/json");
  headers.set("X-Gusto-API-Version", GUSTO_API_VERSION);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${context.config.gustoBase}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = payload?.message || payload?.error_description || payload?.error;
    const errors = Array.isArray(payload?.errors) ? payload.errors.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("; ") : "";
    throw new Error(String(message || errors || `Gusto request failed (${response.status}).`));
  }
  return payload || {};
}
