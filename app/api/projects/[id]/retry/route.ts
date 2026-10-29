import { NextResponse } from "next/server";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { BusyError, isBusy, retryCreate } from "@/lib/agents/pipeline";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p) return jsonError("Proyecto no encontrado", 404);
  if (isBusy(id)) return jsonError("Ya se está generando", 409);
  try {
    await retryCreate(id);
  } catch (e) {
    if (e instanceof BusyError) return jsonError(e.message, 409);
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 202 });
}
