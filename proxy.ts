import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Basic-auth gate for public deployments: every route that spends API credits (studio + API)
// needs FORGE_PASSWORD. Empty FORGE_PASSWORD = no gate (local dev keeps working as before).
// Left open: the landing, static assets, and what the sandboxed game iframe loads
// (/play, /api/files, /runtime, /vendor) — that iframe has an opaque origin and sends no credentials.
export function proxy(req: NextRequest) {
  const password = (process.env.FORGE_PASSWORD ?? "").trim();
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given === password) return NextResponse.next();
  }
  return new NextResponse("Acceso restringido", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Forge Xpresso", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/studio/:path*", "/api/((?!files/).*)"],
};
