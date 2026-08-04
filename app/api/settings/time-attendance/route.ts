import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const defaults = {
  "Time Tracking": true,
  "Location Tracking (GPS)": true,
  "Offline Time Clock": true,
  "Auto Reminders": true,
  "Auto Clock-Out": true,
};
const configDefaults = { "Time Zone": "Central Time (CT)", "Pay Period": "Weekly (Sun – Sat)", "Week Starts On": "Sunday", "Grace Period": "5 minutes", "Auto Clock-Out": "After 12 hours" };

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  const row = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`time_attendance:${viewer.businessId}`).first<{ value: string }>();
  let settings = defaults;
  let config = configDefaults;
  if (row?.value) {
    try { const parsed = JSON.parse(row.value); settings = { ...defaults, ...(parsed.settings || parsed) }; config = { ...configDefaults, ...(parsed.config || {}) }; } catch { /* use defaults */ }
  }
  return Response.json({ settings, config });
}

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const body = await request.json() as { settings?: Record<string, boolean>; config?: Record<string, string> };
  const existing = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`time_attendance:${viewer.businessId}`).first<{ value: string }>();
  let stored: { settings?: Record<string, boolean>; config?: Record<string, string> } = {};
  try { stored = existing?.value ? JSON.parse(existing.value) : {}; } catch { /* use defaults */ }
  const settings = { ...defaults, ...(stored.settings || {}), ...Object.fromEntries(Object.entries(body.settings || {}).filter(([, value]) => typeof value === "boolean")) };
  const config = { ...configDefaults, ...(stored.config || {}), ...Object.fromEntries(Object.entries(body.config || {}).filter(([, value]) => typeof value === "string")) };
  await database().prepare(`INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`time_attendance:${viewer.businessId}`, JSON.stringify({ settings, config })).run();
  return Response.json({ settings, config });
}
