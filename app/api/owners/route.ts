import { hashPassword } from "../../../db/app-auth";
import { database, ensureDatabase } from "../../../db/runtime";
import { getViewer } from "../../../db/viewer";

export async function GET() {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  await ensureDatabase();
  const owners = await database().prepare(`
    SELECT id, name, email, created_at AS createdAt
    FROM owners
    WHERE business_id = ? AND active = 1
    ORDER BY id
  `).bind(viewer.businessId).all<{ id: number; name: string; email: string; createdAt: number }>();
  return Response.json(owners.results);
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (viewer.access !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }
  const body = await request.json() as { name?: string; email?: string; password?: string };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!name || !email || !email.includes("@")) {
    return Response.json({ error: "Enter the owner’s name and a valid email." }, { status: 400 });
  }
  if (password.length < 10) {
    return Response.json({ error: "The password must be at least 10 characters." }, { status: 400 });
  }

  await ensureDatabase();
  try {
    const createdAt = Date.now();
    const owner = await database().prepare(`
      INSERT INTO owners (business_id, name, email, password_hash, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
      RETURNING id
    `).bind(viewer.businessId, name, email, await hashPassword(password), createdAt).first<{ id: number }>();
    return Response.json({ id: owner?.id, name, email, createdAt }, { status: 201 });
  } catch {
    return Response.json({ error: "That email already has an owner account." }, { status: 409 });
  }
}
