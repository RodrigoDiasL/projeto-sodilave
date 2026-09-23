import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const production = process.env.NODE_ENV === "production";
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const expectedOrigin = production ? process.env.APP_URL : request.nextUrl.origin;
    const origin = request.headers.get("origin");
    if (!expectedOrigin || origin !== new URL(expectedOrigin).origin || request.headers.get("sec-fetch-site") === "cross-site") {
      return new NextResponse("Pedido não autorizado.", { status: 403 });
    }
  }
  if (!production) return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
    "img-src 'self' data: blob:", "font-src 'self' data:", "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, "connect-src 'self'", "manifest-src 'self'",
    "worker-src 'self' blob:", "upgrade-insecure-requests",
  ].join("; ");
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"] };
