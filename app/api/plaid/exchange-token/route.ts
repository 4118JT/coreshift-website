import { NextRequest, NextResponse } from "next/server";
import { currentPlaidViewer, encryptAccessToken, ensurePlaidTables, plaidDb, plaidError, plaidRequest, viewerSubject } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const viewer = await currentPlaidViewer();
    if (viewer instanceof NextResponse) return viewer;
    const body = await request.json();
    const account = body?.account || {};
    if (!body?.publicToken || !account?.id) return NextResponse.json({ error: "Choose a bank account to continue." }, { status: 400 });
    const exchanged = await plaidRequest<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: body.publicToken });
    const db = await plaidDb();
    await ensurePlaidTables(db);
    const subject = viewerSubject(viewer);
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO plaid_accounts (
      business_id, subject_type, subject_id, item_id, access_token_encrypted, account_id,
      institution_name, institution_id, account_name, account_mask, account_type, connected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (business_id, subject_type, subject_id) DO UPDATE SET
      item_id=excluded.item_id, access_token_encrypted=excluded.access_token_encrypted,
      account_id=excluded.account_id, institution_name=excluded.institution_name,
      institution_id=excluded.institution_id, account_name=excluded.account_name,
      account_mask=excluded.account_mask, account_type=excluded.account_type,
      connected_at=excluded.connected_at, updated_at=excluded.updated_at`)
      .bind(viewer.businessId, subject.subjectType, subject.subjectId, exchanged.item_id,
        await encryptAccessToken(exchanged.access_token), String(account.id),
        String(body?.institution?.name || ""), String(body?.institution?.institution_id || ""),
        String(account.name || "Bank account"), String(account.mask || ""),
        String(account.subtype || account.type || "checking"), now, now).run();
    return NextResponse.json({ connected: true });
  } catch (error) { return plaidError(error); }
}
