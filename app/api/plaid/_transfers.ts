import { decryptAccessToken, ensurePlaidTables, plaidDb, plaidRequest } from "./_shared";

export type PayrollTransferInput = { employeeId: number; amountCents: number; periodStart: string; periodEnd: string; employeeName: string };
const money = (cents: number) => (cents / 100).toFixed(2);

async function transferKey(businessId: number, input: PayrollTransferInput) {
  const raw = `${businessId}|${input.employeeId}|${input.periodStart}|${input.periodEnd}|${input.amountCents}`;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return `pay_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 44)}`;
}

export async function createPayrollTransfer(businessId: number, input: PayrollTransferInput) {
  const db = await plaidDb();
  await ensurePlaidTables(db);
  const key = await transferKey(businessId, input);
  const existing: any = await db.prepare("SELECT * FROM plaid_transfers WHERE idempotency_key=?").bind(key).first();
  if (existing?.transfer_id) return existing;
  const account: any = await db.prepare(`SELECT access_token_encrypted, account_id FROM plaid_accounts
    WHERE business_id=? AND subject_type='employee' AND subject_id=?`).bind(businessId, input.employeeId).first();
  if (!account) throw new Error(`${input.employeeName || "Employee"} has not connected a payroll bank account.`);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO plaid_transfers
    (business_id, employee_id, period_start, period_end, amount_cents, idempotency_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'authorizing', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`)
    .bind(businessId, input.employeeId, input.periodStart, input.periodEnd, input.amountCents, key, now, now).run();
  try {
    const accessToken = await decryptAccessToken(String(account.access_token_encrypted));
    const authorization: any = await plaidRequest("/transfer/authorization/create", {
      access_token: accessToken, account_id: String(account.account_id), type: "credit", network: "ach",
      amount: money(input.amountCents), ach_class: "ppd", user: { legal_name: input.employeeName || "Payroll recipient" },
      user_present: true, idempotency_key: key,
    });
    const authorizationId = String(authorization.authorization?.id || authorization.authorization_id || "");
    const decision = String(authorization.decision || authorization.authorization?.decision || "");
    if (!authorizationId || (decision && decision !== "approved")) throw new Error(authorization.decision_rationale?.description || "Plaid did not approve this transfer.");
    const created: any = await plaidRequest("/transfer/create", {
      access_token: accessToken, account_id: String(account.account_id), authorization_id: authorizationId,
      description: "PAYROLL",
      metadata: { business_id: String(businessId), employee_id: String(input.employeeId), period_start: input.periodStart, period_end: input.periodEnd },
    });
    const transferId = String(created.transfer?.id || created.transfer_id || "");
    const status = String(created.transfer?.status || created.status || "pending").toLowerCase();
    if (!transferId) throw new Error("Plaid did not return a transfer ID.");
    await db.prepare(`UPDATE plaid_transfers SET authorization_id=?, transfer_id=?, decision=?,
      status=?, failure_reason=NULL, updated_at=? WHERE idempotency_key=?`)
      .bind(authorizationId, transferId, decision || "approved", status, new Date().toISOString(), key).run();
    return { transfer_id: transferId, status, employee_id: input.employeeId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer failed.";
    await db.prepare("UPDATE plaid_transfers SET status='failed', failure_reason=?, updated_at=? WHERE idempotency_key=?")
      .bind(message, new Date().toISOString(), key).run();
    throw error;
  }
}

export async function syncTransferEvents() {
  const db = await plaidDb();
  await ensurePlaidTables(db);
  const cursor: any = await db.prepare("SELECT value FROM workspace_settings WHERE key='plaid_transfer_event_cursor'").first();
  let afterId = Number(cursor?.value || 0);
  let processed = 0;
  for (let page = 0; page < 10; page += 1) {
    const payload: any = await plaidRequest("/transfer/event/sync", { after_id: afterId, count: 500 });
    const events: any[] = payload.transfer_events || [];
    if (!events.length) break;
    for (const event of events) {
      const eventId = Number(event.event_id || event.id || 0);
      const transferId = String(event.transfer_id || "");
      const status = String(event.event_type || event.status || "").toLowerCase();
      if (eventId > afterId) afterId = eventId;
      if (!transferId || !status) continue;
      await db.prepare("UPDATE plaid_transfers SET status=?, updated_at=? WHERE transfer_id=?")
        .bind(status, new Date().toISOString(), transferId).run();
      if (status === "settled") {
        const transfer: any = await db.prepare(`SELECT employee_id, amount_cents, period_start, period_end
          FROM plaid_transfers WHERE transfer_id=?`).bind(transferId).first();
        if (transfer) await db.prepare(`INSERT OR IGNORE INTO employee_payments
          (employee_id, amount_cents, paid_at, note, created_at, plaid_transfer_id) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(transfer.employee_id, transfer.amount_cents, event.timestamp || new Date().toISOString(),
            `Plaid payroll ${transfer.period_start} to ${transfer.period_end}`, new Date().toISOString(), transferId).run();
      }
      processed += 1;
    }
    if (events.length < 500) break;
  }
  await db.prepare(`INSERT INTO workspace_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind("plaid_transfer_event_cursor", String(afterId), new Date().toISOString()).run();
  return { processed, afterId };
}
