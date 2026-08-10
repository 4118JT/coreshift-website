import { providerConfiguration, requireOwner, saveConnection } from "../../integrations/_shared";
import { enforceRateLimit, rateLimitResponse, recordAudit } from "../../../../db/security";

export async function POST(request: Request) {
  const viewer = await requireOwner();
  if (!viewer) return Response.json({ error: "Owner access required" }, { status: 403 });
  const limit = await enforceRateLimit(request, "gusto-connect", viewer.businessId, 5, 15 * 60 * 1000);
  if (!limit.allowed) return rateLimitResponse(limit.retryAfter);
  const body = await request.json() as { companyId?: string; accessToken?: string; refreshToken?: string; companyName?: string };
  const companyId = String(body.companyId || "").trim();
  const accessToken = String(body.accessToken || "").trim();
  const refreshToken = String(body.refreshToken || "").trim();
  const companyName = String(body.companyName || "CoreShift Demo").trim().slice(0, 120) || "CoreShift Demo";
  if (!/^[0-9a-f-]{30,40}$/i.test(companyId) || accessToken.length < 20 || refreshToken.length < 20) {
    return Response.json({ error: "Enter the demo company UUID, access token, and refresh token from the Gusto Developer Portal." }, { status: 400 });
  }
  const origin = new URL(request.url).origin;
  const config = providerConfiguration("gusto", origin);
  if (!config.configured) return Response.json({ error: "Gusto application credentials are not configured.", missing: config.missing }, { status: 503 });
  if (!config.gustoBase.includes("gusto-demo")) return Response.json({ error: "Demo tokens can only be imported while GUSTO_ENV is set to demo." }, { status: 409 });
  const verification = await fetch(`${config.gustoBase}/v1/token_info`, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "X-Gusto-API-Version": "2026-06-15" } });
  const payload = await verification.json().catch(() => null) as { company_uuid?: string; resource_uuid?: string; name?: string; error?: string; message?: string } | null;
  if (!verification.ok || !payload) return Response.json({ error: payload?.message || payload?.error || "Gusto rejected the demo access token." }, { status: 400 });
  const verifiedCompanyId = payload.company_uuid || payload.resource_uuid || "";
  if (verifiedCompanyId && verifiedCompanyId !== companyId) return Response.json({ error: "The company UUID does not match the company associated with this access token." }, { status: 400 });
  await saveConnection(viewer.businessId, "gusto", origin, { accessToken, refreshToken, expiresAt: Date.now() + 2 * 60 * 60 * 1000 }, companyId, payload.name || companyName);
  await recordAudit({ businessId: viewer.businessId, actorType: "owner", actorId: viewer.actorId, action: "integration.connected", targetType: "gusto_company", targetId: companyId, metadata: { environment: "demo" }, request });
  return Response.json({ connected: true, companyId, companyName: payload.name || companyName });
}
