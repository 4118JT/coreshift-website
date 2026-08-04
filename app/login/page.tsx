import { redirect } from "next/navigation";
import { getViewer } from "../../db/viewer";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; business?: string; next?: string }>;
}) {
  const viewer = await getViewer();
  if (viewer.access !== "pending") redirect("/");
  const { mode, business, next } = await searchParams;
  return (
    <LoginForm
      initialMode={mode === "employee" ? "employee" : "owner"}
      initialBusinessId={business?.trim() ?? ""}
      nextPath={next?.startsWith("/") && !next.startsWith("//") ? next : "/"}
    />
  );
}
