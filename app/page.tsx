import { Timekeeper } from "./timekeeper";
import { getViewer } from "../db/viewer";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const viewer = await getViewer();
  if (viewer.access === "pending") redirect("/login");
  return (
    <Timekeeper
      view={viewer.access === "employee" ? "employee-home" : "overview"}
      viewer={viewer}
    />
  );
}
