import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CROSS_SITE_EXCEPTIONS = new Set([
  "/api/plaid/webhook",
  "/api/gusto/webhook",
]);

function applySecurityHeaders(response: NextResponse, request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(), usb=()");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self' https://*.gusto.com https://*.gusto-demo.com; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.gusto.com https://api.gusto-demo.com https://*.plaid.com; frame-src https://*.gusto.com https://*.gusto-demo.com https://*.plaid.com; upgrade-insecure-requests",
  );
  if (isApi || request.nextUrl.pathname === "/login") {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (MUTATING_METHODS.has(request.method) && path.startsWith("/api/") && !CROSS_SITE_EXCEPTIONS.has(path)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    const wrongOrigin = Boolean(origin && origin !== request.nextUrl.origin);
    const crossSite = fetchSite === "cross-site";
    if (wrongOrigin || crossSite) {
      return applySecurityHeaders(
        NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 }),
        request,
      );
    }
  }
  return applySecurityHeaders(NextResponse.next(), request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
