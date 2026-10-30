import { NextResponse } from "next/server";
import { emit } from "@/lib/events";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { isBusy } from "@/lib/agents/pipeline";
import { deleteProject, updateProject } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p) return jsonError("Proyecto no encontrado", 404);
  return NextResponse.json({ ...p, busy: isBusy(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await loadProject(id))) return jsonError("Proyecto no encontrado", 404);
  const body = (await req.json().catch(() => ({}))) as {
    cineAuto?: boolean;
    cinematicLines?: string[];
    cinematicStyle?: string;
    currentVersion?: number;
    tuning?: { key: string; value: number }[];
  };
  if (body.currentVersion !== undefined && isBusy(id)) return jsonError("Espera a que Forge termine el cambio actual", 409);
  const p = await updateProject(id, (pp) => {
    if (typeof body.currentVersion === "number" && pp.versions.some((v) => v.n === body.currentVersion)) {
      pp.currentVersion = body.currentVersion;
      pp.repairs = 0;
    }
    if (typeof body.cineAuto === "boolean") pp.cineAuto = body.cineAuto;
    if (pp.design && Array.isArray(body.cinematicLines)) pp.design.cinematic.lines = body.cinematicLines.slice(0, 3).map((l) => String(l).slice(0, 90));
    if (pp.design && body.cinematicStyle) pp.design.cinematic.style = String(body.cinematicStyle).slice(0, 20);
    if (pp.design && Array.isArray(body.tuning)) {
      for (const t of body.tuning) {
        const cur = pp.design.tuning.find((x) => x.key === t.key);
        if (cur && Number.isFinite(t.value)) cur.value = Math.min(cur.max, Math.max(cur.min, Number(t.value)));
      }
    }
  });
  if (p.design) emit(id, { type: "design", design: p.design });
  if (typeof body.currentVersion === "number") emit(id, { type: "version", n: p.currentVersion });
  return NextResponse.json(p);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (isBusy(id)) return jsonError("El proyecto se está generando", 409);
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
