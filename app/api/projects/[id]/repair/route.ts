import { NextResponse } from "next/server";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { isBusy, MAX_REPAIRS, startRepair } from "@/lib/agents/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p?.design) return jsonError("Proyecto no encontrado", 404);
  const body = (await req.json().catch(() => ({}))) as { message?: string; stack?: string; phase?: string; version?: number; manual?: boolean };
  if (body.version && body.version !== p.currentVersion) return NextResponse.json({ started: false, reason: "stale" });
  if (isBusy(id)) return NextResponse.json({ started: false, reason: "busy" });
  if (!body.manual && (p.repairs || 0) >= MAX_REPAIRS) return NextResponse.json({ started: false, reason: "limit" });
  const error = `${String(body.message || "Unknown error").slice(0, 2000)}\nPhase: ${body.phase || "runtime"}\nStack:\n${String(body.stack || "").slice(0, 3000)}`;
  startRepair(id, error);
  return NextResponse.json({ started: true }, { status: 202 });
}
