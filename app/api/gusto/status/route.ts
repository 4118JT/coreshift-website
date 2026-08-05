import { readConnection, requireOwner } from "../../integrations/_shared";
import { gustoRequest, requireGustoContext } from "../_shared";

export async function GET(request: Request) {
  const viewer = await requireOwner();
  if (!viewer) return Response.json({ error: "Owner access required" }, { status: 403 });
  const connection = await readConnection(viewer.businessId, "gusto");
  if (!connection) return Response.json({ connected: false });
  try {
    const context = await requireGustoContext(request);
    const onboarding = await gustoRequest(context, `/v1/companies/${encodeURIComponent(context.companyId)}/onboarding_status`);
    const complete = Boolean(onboarding.onboarding_completed ?? onboarding.is_complete ?? onboarding.completed);
    const steps = Array.isArray(onboarding.steps) ? onboarding.steps : Array.isArray(onboarding.required_steps) ? onboarding.required_steps : [];
    return Response.json({ connected: true, companyName: context.stored.accountName, companyId: context.companyId, environment: context.config.gustoBase.includes("gusto-demo") ? "Demo" : "Production", onboardingComplete: complete, steps });
  } catch (caught) {
    return Response.json({ connected: true, companyName: connection.accountName, companyId: connection.accountId, error: caught instanceof Error ? caught.message : "Gusto status could not be loaded." });
  }
}
