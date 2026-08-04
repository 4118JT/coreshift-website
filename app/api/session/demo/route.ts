export async function POST() {
  const response = Response.json({ ok: true });
  response.headers.set("set-cookie", "hourmark_demo=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400");
  response.headers.set("cache-control", "no-store");
  return response;
}
