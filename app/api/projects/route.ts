import { NextResponse } from "next/server";
import { capabilities, config } from "@/lib/config";
import { jsonError } from "@/lib/http";
import { IDEA_MAX_CHARS } from "@/lib/limits";
import { startCreate } from "@/lib/agents/pipeline";
import { createProject, listProjects } from "@/lib/store";
import type { Dimension } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await listProjects();
  return NextResponse.json(
    list.map((p) => {
      const specOf = (a: (typeof p.assets)[string]) => a.spec as { role?: string; sheet?: unknown };
      const ready = Object.values(p.assets).filter((a) => a.type === "image" && a.status === "ready" && a.file && !specOf(a).sheet);
      const keyart = ready.find((a) => specOf(a).role === "keyart");
      const hero = ready.find((a) => specOf(a).role === "hero");
      const cover = keyart || hero;
      return {
        id: p.id,
        title: p.design?.title || p.idea.slice(0, 40),
        idea: p.idea,
        dimension: p.dimension,
        status: p.status,
        updatedAt: p.updatedAt,
        thumb: cover?.file ? `/api/files/${p.id}/${cover.file}` : null,
        thumbFit: keyart ? "cover" : "contain",
      };
    }),
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { idea?: string; dimension?: Dimension };
  const idea = String(body.idea || "").trim();
  if (!idea) return jsonError("Describe el juego que quieres crear.");
  if (idea.length > IDEA_MAX_CHARS) return jsonError(`La idea supera el máximo de ${IDEA_MAX_CHARS} caracteres (${idea.length}). Resúmela un poco.`);
  if (!capabilities().code) return jsonError("Falta ANTHROPIC_API_KEY en .env.local: es necesaria para diseñar y programar el juego.", 412);
  const dimension: Dimension = body.dimension === "3d" || body.dimension === "2.5d" ? body.dimension : "2d";
  const p = await createProject(idea, dimension, config.imageProvider());
  startCreate(p.id);
  return NextResponse.json(p, { status: 201 });
}
