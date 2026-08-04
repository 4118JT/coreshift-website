import { NextResponse } from "next/server";
import { currentPlaidViewer, decryptAccessToken, ensurePlaidTables, plaidDb, plaidError, plaidRequest, viewerSubject } from "../_shared";

export async function POST() {
  try {
    const viewer = await currentPlaidViewer();
    if (viewer instanceof NextResponse) return viewer;
    const db = await plaidDb();
    await ensurePlaidTables(db);
    const subject = viewerSubject(viewer);
    const account: any = await db.prepare(`SELECT access_token_encrypted FROM plaid_accounts
      WHERE business_id=? AND subject_type=? AND subject_id=?`)
      .bind(viewer.businessId, subject.subjectType, subject.subjectId).first();
    if (account?.access_token_encrypted) {
      try { await plaidRequest("/item/remove", { access_token: await decryptAccessToken(String(account.access_token_encrypted)) }); } catch {}
    }
    await db.prepare("DELETE FROM plaid_accounts WHERE business_id=? AND subject_type=? AND subject_id=?")
      .bind(viewer.businessId, subject.subjectType, subject.subjectId).run();
    return NextResponse.json({ connected: false });
  } catch (error) { return plaidError(error); }
}
