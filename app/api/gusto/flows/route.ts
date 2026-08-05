import { gustoRequest, requireGustoContext } from "../_shared";

const allowedFlows = new Set(["company_onboarding", "employee_management", "run_payroll", "payroll_history"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { flowType?: string };
    const flowType = String(body.flowType || "");
    if (!allowedFlows.has(flowType)) return Response.json({ error: "Unsupported Gusto workflow." }, { status: 400 });
    const context = await requireGustoContext(request);
    const flowBody: Record<string, unknown> = { flow_type: flowType };
    if (flowType === "employee_management") {
      flowBody.entity_type = "Company";
      flowBody.entity_uuid = context.companyId;
    }
    const payload = await gustoRequest(context, `/v1/companies/${encodeURIComponent(context.companyId)}/flows`, { method: "POST", body: JSON.stringify(flowBody) });
    const nested = payload.flow && typeof payload.flow === "object" ? payload.flow as Record<string, unknown> : null;
    const url = String(payload.url || payload.flow_url || payload.link || nested?.url || "");
    if (!url.startsWith("https://")) throw new Error("Gusto did not return a secure workflow link.");
    return Response.json({ url, flowType, environment: context.config.gustoBase.includes("gusto-demo") ? "Demo" : "Production" });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "The Gusto workflow could not be opened.";
    const status = message === "Owner access required." ? 403 : message.startsWith("Connect Gusto") ? 409 : 502;
    return Response.json({ error: message }, { status });
  }
}
