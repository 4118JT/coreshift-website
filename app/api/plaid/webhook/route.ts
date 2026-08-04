import { NextRequest, NextResponse } from "next/server";
import { plaidConfig, plaidError } from "../_shared";
import { syncTransferEvents } from "../_transfers";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (String(body?.webhook_type || "").toUpperCase() !== "TRANSFER" ||
      String(body?.webhook_code || "").toUpperCase() !== "TRANSFER_EVENTS_UPDATE") {
      return NextResponse.json({ received: true, ignored: true });
    }
    const environment = String(body?.environment || "").toLowerCase();
    if (environment && environment !== plaidConfig().environment) return NextResponse.json({ received: true, ignored: true });
    return NextResponse.json({ received: true, ...(await syncTransferEvents()) });
  } catch (error) { return plaidError(error); }
}
