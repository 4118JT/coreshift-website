import { NextResponse } from "next/server";
import { ensurePlaidTables, ownerViewer, plaidConfig, plaidDb, plaidError } from "../_shared";

export async function GET() {
  try {
    const viewer = await ownerViewer();
    if (viewer instanceof NextResponse) return viewer;
    const db = await plaidDb();
    await ensurePlaidTables(db);
    const linked: any = await db.prepare("SELECT subject_id FROM plaid_accounts WHERE business_id=? AND subject_type='employee'").bind(viewer.businessId).all();
    const transfers: any = await db.prepare(`SELECT employee_id, period_start, period_end, amount_cents,
      transfer_id, status, failure_reason, created_at FROM plaid_transfers
      WHERE business_id=? ORDER BY created_at DESC LIMIT 100`).bind(viewer.businessId).all();
    const config = plaidConfig();
    return NextResponse.json({ configured: config.configured, environment: config.environment,
      linkedEmployeeIds: (linked.results || []).map((row: any) => Number(row.subject_id)),
      transfers: transfers.results || [] });
  } catch (error) { return plaidError(error); }
}
