import { database, ensureDatabase } from "../../../../db/runtime";
import { getViewer } from "../../../../db/viewer";
import { createUniqueEightDigitCode, ensureWorkspaceEightDigitCodes } from "../../../../db/employee-codes";

async function requireOwner() {
  const viewer = await getViewer();
  return viewer.access === "owner" ? viewer : null;
}

export async function GET() {
  const viewer = await requireOwner();
  if (!viewer) {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  await ensureWorkspaceEightDigitCodes(database(), viewer.businessId);
  const business = await database().prepare(
    "SELECT employee_join_code AS code FROM businesses WHERE id = ?"
  ).bind(viewer.businessId).first<{ code: string | null }>();
  return Response.json({ code: business?.code ?? null });
}

export async function POST() {
  const viewer = await requireOwner();
  if (!viewer) {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = await createUniqueEightDigitCode(database());
    const existing = await database().prepare(
      "SELECT id FROM businesses WHERE employee_join_code = ?"
    ).bind(code).first<{ id: string }>();
    if (existing) continue;
    await database().prepare(
      "UPDATE businesses SET employee_join_code = ? WHERE id = ?"
    ).bind(code, viewer.businessId).run();
    return Response.json({ code });
  }

  return Response.json(
    { error: "A new company code could not be created. Try again." },
    { status: 500 },
  );
}
