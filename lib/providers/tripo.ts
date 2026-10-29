import { config } from "../config";
import { estimateTripoUsd } from "../usage";
import { fetchWithRetry, ProviderError, sleep } from "./http";

const BASE = "https://api.tripo3d.ai/v2/openapi";

export interface ModelResult {
  data: Buffer;
  estimatedUsd: number;
  ms: number;
}

function headers() {
  return { Authorization: `Bearer ${config.tripo.key()}`, "Content-Type": "application/json" };
}

interface TaskResp {
  code: number;
  message?: string;
  data?: {
    task_id?: string;
    status?: string;
    progress?: number;
    output?: { pbr_model?: string; model?: string; base_model?: string };
  };
}

export async function textToModel(prompt: string, onProgress?: (p: number) => void): Promise<ModelResult> {
  const t0 = Date.now();
  const res = await fetchWithRetry(
    `${BASE}/task`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ type: "text_to_model", prompt: prompt.slice(0, 1000), texture: true, pbr: true, face_limit: 12000 }),
    },
    { provider: "Tripo" },
  );
  const j = (await res.json()) as TaskResp;
  const taskId = j.data?.task_id;
  if (j.code !== 0 || !taskId) throw new ProviderError("Tripo", 400, j.message || "no se creó la tarea");

  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    await sleep(4000);
    const r = await fetchWithRetry(`${BASE}/task/${taskId}`, { headers: headers() }, { provider: "Tripo" });
    const t = (await r.json()) as TaskResp;
    const st = t.data?.status;
    if (typeof t.data?.progress === "number") onProgress?.(t.data.progress);
    if (st === "success") {
      const url = t.data?.output?.pbr_model || t.data?.output?.model || t.data?.output?.base_model;
      if (!url) throw new ProviderError("Tripo", 500, "tarea sin modelo");
      const m = await fetch(url);
      if (!m.ok) throw new ProviderError("Tripo", m.status, "no se pudo descargar el modelo");
      return { data: Buffer.from(await m.arrayBuffer()), estimatedUsd: estimateTripoUsd(), ms: Date.now() - t0 };
    }
    if (st && ["failed", "cancelled", "banned", "expired", "unknown"].includes(st)) throw new ProviderError("Tripo", 500, `tarea ${st}`);
  }
  throw new ProviderError("Tripo", 504, "tiempo de espera agotado");
}
