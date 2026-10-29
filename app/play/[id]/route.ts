import { loadProject, type Ctx } from "@/lib/http";
import { buildPlayHtml } from "@/lib/play";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p?.design || !p.versions.length) return new Response("Juego no disponible todavía", { status: 404 });
  const want = Number(new URL(req.url).searchParams.get("v")) || p.currentVersion;
  const v = p.versions.find((x) => x.n === want) ?? p.versions.find((x) => x.n === p.currentVersion)!;
  const html = buildPlayHtml(p, {
    base: "/",
    version: v.n,
    gameUrl: `/api/files/${p.id}/${v.file}`,
    fileUrl: (rel) => `/api/files/${p.id}/${rel}`,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
