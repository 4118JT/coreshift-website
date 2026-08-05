import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

const defaults = {
  locations: [
    { id: "main", name: "Main location", address: "Address not set", timeZone: "America/Chicago", geofenceMeters: 150, active: true, primary: true },
  ],
  integrations: {
    quickbooks: { status: "not_connected", syncEmployees: false, syncTime: false },
    gusto: { status: "not_connected", syncEmployees: false, syncTime: false },
    googleCalendar: { status: "not_connected", syncEmployees: false, syncTime: false },
    slack: { status: "not_connected", syncEmployees: false, syncTime: false },
  },
  security: {
    loginAlerts: true,
    requireTwoFactor: false,
    rememberDevices: true,
    restrictUnknownDevices: false,
    sessionTimeoutMinutes: 60,
  },
};

type WorkspaceSettings = typeof defaults;

async function readSettings(businessId: string): Promise<WorkspaceSettings> {
  const row = await database().prepare("SELECT value FROM workspace_settings WHERE key = ?").bind(`workspace_configuration:${businessId}`).first<{ value: string }>();
  if (!row?.value) return defaults;
  try {
    const parsed = JSON.parse(row.value) as Partial<WorkspaceSettings>;
    return {
      locations: Array.isArray(parsed.locations) && parsed.locations.length ? parsed.locations.slice(0, 25) : defaults.locations,
      integrations: { ...defaults.integrations, ...(parsed.integrations || {}) },
      security: { ...defaults.security, ...(parsed.security || {}) },
    };
  } catch {
    return defaults;
  }
}

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access === "pending") return Response.json({ error: "Not authorized" }, { status: 403 });
  await ensureDatabase();
  return Response.json({ settings: await readSettings(viewer.businessId) });
}

export async function PATCH(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const body = await request.json() as Partial<WorkspaceSettings>;
  const stored = await readSettings(viewer.businessId);
  const settings: WorkspaceSettings = {
    locations: Array.isArray(body.locations) && body.locations.length ? body.locations.slice(0, 25) : stored.locations,
    integrations: { ...stored.integrations, ...(body.integrations || {}) },
    security: { ...stored.security, ...(body.security || {}) },
  };
  await database().prepare("INSERT INTO workspace_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(`workspace_configuration:${viewer.businessId}`, JSON.stringify(settings)).run();
  return Response.json({ settings });
}
