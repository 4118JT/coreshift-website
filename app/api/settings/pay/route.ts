import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const defaults = {
  payPeriod: "Weekly (Sunday - Saturday)",
  payDay: "Friday",
  frequency: "Weekly",
  rounding: "15 minutes (0.25)",
  threshold: "40",
  dailyThreshold: "8",
  dailyOvertime: true,
  doubleTime: false,
  rule: "Time and a half (1.5x)",
  approval: true,
  notify: true,
  differentRates: true,
  individualRates: true,
  payPeriodStarts: "Sunday",
  currency: "USD ($)",
  timeZone: "Central Time (CT)",
  doubleTimeThreshold: "12",
  overtimeEnabled: true,
  overtimeDisabled: false,
  overtimeApplies: "all",
  approvalMode: "Manager approval required",
  eligibility: "hourly",
  holidayPay: "2x",
  weekendPremium: "None",
  nightShiftDifferential: "$2.00 / hr",
};

const key = (businessId: string) => `pay_settings:${businessId}`;

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  const row = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(key(viewer.businessId)).first<{ value: string }>();
  let stored: Record<string, unknown> = {};
  try { stored = row?.value ? JSON.parse(row.value) : {}; } catch { /* use defaults */ }
  return Response.json({ settings: { ...defaults, ...stored } });
}

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const body = await request.json() as { settings?: Record<string, unknown> };
  if (!body.settings || typeof body.settings !== "object") return Response.json({ error: "Settings are required" }, { status: 400 });
  const existing = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(key(viewer.businessId)).first<{ value: string }>();
  let stored: Record<string, unknown> = {};
  try { stored = existing?.value ? JSON.parse(existing.value) : {}; } catch { /* use defaults */ }
  const allowed = new Set(Object.keys(defaults));
  const updates = Object.fromEntries(Object.entries(body.settings).filter(([name, value]) => allowed.has(name) && (typeof value === "string" || typeof value === "boolean")));
  const settings = { ...defaults, ...stored, ...updates };
  if (String(settings.payPeriod).startsWith("Biweekly") || settings.frequency === "Biweekly") {
    settings.frequency = "Biweekly";
    settings.payPeriod = "Biweekly (Sunday - Saturday)";
  } else if (String(settings.payPeriod).startsWith("Weekly") || settings.frequency === "Weekly") {
    settings.frequency = "Weekly";
    settings.payPeriod = "Weekly (Sunday - Saturday)";
  }
  await database().prepare("INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key(viewer.businessId), JSON.stringify(settings)).run();
  return Response.json({ settings });
}
