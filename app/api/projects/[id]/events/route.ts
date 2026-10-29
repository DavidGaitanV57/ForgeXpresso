import { subscribe } from "@/lib/events";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { isBusy } from "@/lib/agents/pipeline";
import type { ForgeEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p) return jsonError("Proyecto no encontrado", 404);
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const send = (ev: ForgeEvent | { type: "busy"; busy: boolean }) => write(`data: ${JSON.stringify(ev)}\n\n`);
      send({ type: "project", project: p });
      send({ type: "busy", busy: isBusy(id) });
      const unsub = subscribe(id, send);
      const ping = setInterval(() => write(": ping\n\n"), 15000);
      cleanup = () => {
        unsub();
        clearInterval(ping);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
