function clearSession(response: Response) {
  response.headers.set("set-cookie", "hourmark_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  response.headers.append("set-cookie", "hourmark_demo=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  response.headers.set("cache-control", "no-store");
  return response;
}

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hourmark_session="))?.slice("hourmark_session=".length);
}

export async function POST(request: Request) {
  await revokeAppSession(sessionToken(request));
  return clearSession(new Response(null, { status: 204 }));
}

export async function GET(request: Request) {
  await revokeAppSession(sessionToken(request));
  return clearSession(Response.redirect(new URL("/login", request.url), 303));
}
import { revokeAppSession } from "../../../../db/app-auth";
