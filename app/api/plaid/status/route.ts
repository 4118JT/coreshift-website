import { NextResponse } from "next/server";
import { currentPlaidViewer, ensurePlaidTables, plaidConfig, plaidDb, plaidError, viewerSubject } from "../_shared";

export async function GET() {
  try {
    const viewer = await currentPlaidViewer();
    if (viewer instanceof NextResponse) return viewer;
    const db = await plaidDb();
    await ensurePlaidTables(db);
    const subject = viewerSubject(viewer);
    const account: any = await db.prepare(`SELECT institution_name, institution_id, account_name,
      account_mask, account_type, connected_at FROM plaid_accounts
      WHERE business_id=? AND subject_type=? AND subject_id=?`)
      .bind(viewer.businessId, subject.subjectType, subject.subjectId).first();
    const config = plaidConfig();
    return NextResponse.json({
      configured: config.configured, environment: config.environment, connected: Boolean(account),
      account: account ? { institutionName: account.institution_name, institutionId: account.institution_id,
        accountName: account.account_name, mask: account.account_mask, type: account.account_type,
        connectedAt: account.connected_at } : null,
    });
  } catch (error) { return plaidError(error); }
}
