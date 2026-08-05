import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";

type LaborRange = "day" | "week" | "month" | "ytd";
type Bucket = { start: number; end: number; label: string; axisLabel: string };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hourLabel(hour: number) {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}

function bucketsFor(range: LaborRange, offsetMinutes: number) {
  const offsetMs = offsetMinutes * 60_000;
  const localNow = new Date(Date.now() - offsetMs);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();
  const buckets: Bucket[] = [];
  const fromLocal = (value: number) => value + offsetMs;

  if (range === "day") {
    const localStart = Date.UTC(year, month, day);
    for (let hour = 0; hour < 24; hour += 1) {
      const start = fromLocal(localStart + hour * 3_600_000);
      buckets.push({ start, end: start + 3_600_000, label: hourLabel(hour), axisLabel: hour % 3 === 0 ? hourLabel(hour) : "" });
    }
    return buckets;
  }

  if (range === "week") {
    const mondayOffset = (localNow.getUTCDay() + 6) % 7;
    const localStart = Date.UTC(year, month, day - mondayOffset);
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(localStart + index * 86_400_000);
      const start = fromLocal(date.getTime());
      const end = fromLocal(localStart + (index + 1) * 86_400_000);
      const label = DAY_NAMES[date.getUTCDay()];
      buckets.push({ start, end, label, axisLabel: label });
    }
    return buckets;
  }

  if (range === "month") {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let date = 1; date <= daysInMonth; date += 1) {
      const start = fromLocal(Date.UTC(year, month, date));
      const end = fromLocal(Date.UTC(year, month, date + 1));
      buckets.push({ start, end, label: `${MONTH_NAMES[month]} ${date}`, axisLabel: date === 1 || date === daysInMonth || (date - 1) % 5 === 0 ? String(date) : "" });
    }
    return buckets;
  }

  for (let index = 0; index < 12; index += 1) {
    const start = fromLocal(Date.UTC(year, index, 1));
    const end = fromLocal(Date.UTC(year, index + 1, 1));
    buckets.push({ start, end, label: MONTH_NAMES[index], axisLabel: MONTH_NAMES[index] });
  }
  return buckets;
}

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") return Response.json({ error: "Owner access required" }, { status: 403 });
  await ensureDatabase();
  const url = new URL(request.url);
  const requestedRange = url.searchParams.get("range");
  const range: LaborRange = requestedRange === "day" || requestedRange === "month" || requestedRange === "ytd" ? requestedRange : "week";
  const offsetMinutes = Math.max(-840, Math.min(840, Number(url.searchParams.get("offsetMinutes")) || 0));
  const buckets = bucketsFor(range, offsetMinutes);
  const periodStart = buckets[0]?.start ?? Date.now();
  const periodEnd = buckets.at(-1)?.end ?? Date.now();
  const now = Date.now();
  const rows = await database().prepare(`
    SELECT t.clock_in AS clockIn, t.clock_out AS clockOut, e.hourly_rate_cents AS hourlyRateCents
    FROM time_entries t
    JOIN employees e ON e.id = t.employee_id
    WHERE e.business_id = ? AND e.active = 1
      AND t.clock_in < ? AND COALESCE(t.clock_out, ?) > ?
  `).bind(viewer.businessId, periodEnd, now, periodStart).all<{ clockIn: number; clockOut: number | null; hourlyRateCents: number }>();
  const values = buckets.map((bucket) => Math.round(rows.results.reduce((total, entry) => {
    const overlap = Math.max(0, Math.min(entry.clockOut ?? now, now, bucket.end) - Math.max(entry.clockIn, bucket.start));
    return total + (overlap / 3_600_000) * entry.hourlyRateCents;
  }, 0)));
  return Response.json({ labels: buckets.map((bucket) => bucket.label), axisLabels: buckets.map((bucket) => bucket.axisLabel), values }, { headers: { "cache-control": "private, no-store" } });
}
