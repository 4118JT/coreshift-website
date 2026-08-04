function clearSession(response: Response) {
  response.headers.set("set-cookie", "hourmark_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  response.headers.append("set-cookie", "hourmark_demo=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST() {
  return clearSession(new Response(null, { status: 204 }));
}

export async function GET(request: Request) {
  return clearSession(Response.redirect(new URL("/login", request.url), 303));
}
