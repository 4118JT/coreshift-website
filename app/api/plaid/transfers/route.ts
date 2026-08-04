import { NextRequest, NextResponse } from "next/server";
import { ownerViewer, plaidError } from "../_shared";
import { createPayrollTransfer, syncTransferEvents, type PayrollTransferInput } from "../_transfers";

export async function GET() {
  try {
    const viewer = await ownerViewer();
    if (viewer instanceof NextResponse) return viewer;
    return NextResponse.json(await syncTransferEvents());
  } catch (error) { return plaidError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const viewer = await ownerViewer();
    if (viewer instanceof NextResponse) return viewer;
    const body = await request.json();
    if (body?.confirmation !== "SEND_PAYROLL") return NextResponse.json({ error: "Payroll transfer confirmation is required." }, { status: 400 });
    const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
    if (!items.length) return NextResponse.json({ error: "No payroll transfers were supplied." }, { status: 400 });
    const valid: PayrollTransferInput[] = items.map((item: any) => ({
      employeeId: Number(item.employeeId), amountCents: Math.round(Number(item.amountCents)),
      periodStart: String(item.periodStart || ""), periodEnd: String(item.periodEnd || ""),
      employeeName: String(item.employeeName || "Payroll recipient"),
    }));
    if (valid.some((item) => !Number.isInteger(item.employeeId) || item.employeeId <= 0 ||
      !Number.isInteger(item.amountCents) || item.amountCents <= 0 || !item.periodStart || !item.periodEnd)) {
      return NextResponse.json({ error: "One or more payroll transfers are invalid." }, { status: 400 });
    }
    const results: any[] = [];
    for (const item of valid) {
      try { results.push({ ok: true, ...(await createPayrollTransfer(viewer.businessId, item)) }); }
      catch (error) { results.push({ ok: false, employee_id: item.employeeId, error: error instanceof Error ? error.message : "Transfer failed." }); }
    }
    const sent = results.filter((result) => result.ok).length;
    return NextResponse.json({ sent, failed: results.length - sent, results }, { status: sent ? 200 : 422 });
  } catch (error) { return plaidError(error); }
}
