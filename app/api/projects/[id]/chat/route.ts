import { NextResponse } from "next/server";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { BusyError, startChat } from "@/lib/agents/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p) return jsonError("Proyecto no encontrado", 404);
  if (p.status !== "ready" || !p.design) return jsonError("El juego todavía no está listo.", 409);
  const body = (await req.json().catch(() => ({}))) as { message?: string; playing?: boolean };
  const message = String(body.message || "").trim().slice(0, 1500);
  if (!message) return jsonError("Escribe un cambio.");
  try {
    startChat(id, message, !!body.playing);
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
