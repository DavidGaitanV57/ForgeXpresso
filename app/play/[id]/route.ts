import { loadProject, type Ctx } from "@/lib/http";
import { designForPlayLocale } from "@/lib/localize-play";
import { buildPlayHtml } from "@/lib/play";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p?.design || !p.versions.length) return new Response("Juego no disponible todavía", { status: 404 });
  const url = new URL(req.url);
  const want = Number(url.searchParams.get("v")) || p.currentVersion;
  const langRaw = (url.searchParams.get("lang") || "").toLowerCase();
  const locale = langRaw === "es" || langRaw === "en" || langRaw === "fr" ? langRaw : undefined;
  const v = p.versions.find((x) => x.n === want) ?? p.versions.find((x) => x.n === p.currentVersion)!;
  const design = locale ? await designForPlayLocale(p, locale) : p.design;
  const html = buildPlayHtml(p, {
    base: "/",
    version: v.n,
    gameUrl: `/api/files/${p.id}/${v.file}`,
    fileUrl: (rel) => `/api/files/${p.id}/${rel}`,
    locale,
    design,
  });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
