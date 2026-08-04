import { notFound, redirect } from "next/navigation";
import { Timekeeper, type ViewName } from "../timekeeper";
import { getViewer } from "../../db/viewer";

export const dynamic = "force-dynamic";

const ownerViews: ViewName[] = ["time-clock", "schedule", "team", "requests", "messages", "reports", "payroll", "documents", "settings"];
const employeeViews: ViewName[] = ["time-clock", "my-hours", "my-schedule", "profile", "messages"];

export default async function ViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  const viewer = await getViewer();
  if (viewer.access === "pending") redirect(`/login?next=/${encodeURIComponent(view)}`);
  const allowed = viewer.access === "employee" ? employeeViews : ownerViews;
  if (!allowed.includes(view as ViewName)) notFound();
  return (
    <Timekeeper
      view={view as ViewName}
      viewer={viewer}
    />
  );
}
