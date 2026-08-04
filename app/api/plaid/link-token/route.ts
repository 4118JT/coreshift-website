import { NextResponse } from "next/server";
import { currentPlaidViewer, plaidConfig, plaidError, plaidRequest, viewerSubject } from "../_shared";

export async function POST() {
  try {
    const viewer = await currentPlaidViewer();
    if (viewer instanceof NextResponse) return viewer;
    const config = plaidConfig();
    if (!config.configured) return NextResponse.json({ error: "Plaid is not fully configured yet." }, { status: 503 });
    const subject = viewerSubject(viewer);
    const payload = await plaidRequest<{ link_token: string }>("/link/token/create", {
      user: { client_user_id: `${viewer.businessId}:${subject.subjectType}:${subject.subjectId}` },
      client_name: "CoreShift Payroll",
      products: ["transfer"],
      country_codes: ["US"],
      language: "en",
      ...(config.webhook ? { webhook: config.webhook } : {}),
    });
    return NextResponse.json({ linkToken: payload.link_token });
  } catch (error) { return plaidError(error); }
}
