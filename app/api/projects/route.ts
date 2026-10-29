import { NextResponse } from "next/server";
import { capabilities, config } from "@/lib/config";
import { jsonError } from "@/lib/http";
import { startCreate } from "@/lib/agents/pipeline";
import { createProject, listProjects } from "@/lib/store";
import type { Dimension, ImageProvider } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const list = await listProjects();
  return NextResponse.json(
    list.map((p) => {
      const hero = Object.values(p.assets).find((a) => a.type === "image" && (a.spec as { role?: string }).role === "hero" && a.status === "ready");
      return {
        id: p.id,
        title: p.design?.title || p.idea.slice(0, 40),
        idea: p.idea,
        dimension: p.dimension,
        status: p.status,
        updatedAt: p.updatedAt,
        thumb: hero?.file ? `/api/files/${p.id}/${hero.file}` : null,
      };
    }),
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { idea?: string; dimension?: Dimension; imageProvider?: ImageProvider };
  const idea = String(body.idea || "").trim().slice(0, 1200);
  if (!idea) return jsonError("Describe el juego que quieres crear.");
  if (!capabilities().code) return jsonError("Falta ANTHROPIC_API_KEY en .env.local: es necesaria para diseñar y programar el juego.", 412);
  const dimension: Dimension = body.dimension === "3d" || body.dimension === "2.5d" ? body.dimension : "2d";
  const provider: ImageProvider = body.imageProvider === "minimax" || body.imageProvider === "openai" ? body.imageProvider : config.imageProvider();
  const p = await createProject(idea, dimension, provider);
  startCreate(p.id);
  return NextResponse.json(p, { status: 201 });
}
