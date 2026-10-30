import { config } from "../config";
import { estimateTripoUsd } from "../usage";
import { fetchWithRetry, ProviderError, sleep } from "./http";

const BASE = "https://api.tripo3d.ai/v2/openapi";

/** Shared generation knobs — denser, more solid meshes than the old 12k default. */
const GEN = {
  texture: true,
  pbr: true,
  face_limit: 40000,
  // Prefer structural fidelity over paper-thin shells from cutout sprites.
  texture_quality: "detailed" as const,
};

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
    image_token?: string;
  };
}

async function pollTask(taskId: string, t0: number, onProgress?: (p: number) => void): Promise<ModelResult> {
  const deadline = Date.now() + 10 * 60_000;
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

/** Upload a local image buffer; returns Tripo file/image token for image_to_model (legacy / explicit). */
export async function uploadImage(data: Buffer, filename: string, mime = "image/png"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: mime }), filename);
  const res = await fetchWithRetry(
    `${BASE}/upload/sts`,
    { method: "POST", headers: { Authorization: `Bearer ${config.tripo.key()}` }, body: form },
    { provider: "Tripo", timeoutMs: 120_000 },
  );
  const j = (await res.json()) as TaskResp & { data?: { image_token?: string; file_token?: string } };
  const token = j.data?.image_token || j.data?.file_token;
  if (j.code !== 0 || !token) throw new ProviderError("Tripo", 400, j.message || "upload sin token");
  return token;
}

const SOLID =
  " Game-ready closed solid mesh, watertight, no holes, no paper-thin open shells, readable silhouette, single isolated object, no ground plane, no scenery pedestal.";

export async function textToModel(prompt: string, onProgress?: (p: number) => void): Promise<ModelResult> {
  const t0 = Date.now();
  const full = `${prompt.slice(0, 850)}${SOLID}`.slice(0, 1000);
  const res = await fetchWithRetry(
    `${BASE}/task`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ type: "text_to_model", prompt: full, ...GEN }),
    },
    { provider: "Tripo" },
  );
  const j = (await res.json()) as TaskResp;
  const taskId = j.data?.task_id;
  if (j.code !== 0 || !taskId) throw new ProviderError("Tripo", 400, j.message || "no se creó la tarea");
  return pollTask(taskId, t0, onProgress);
}

/** Legacy image→3D (kept for rare explicit use). New games prefer textToModel. */
export async function imageToModel(image: Buffer, filename: string, mime = "image/png", onProgress?: (p: number) => void): Promise<ModelResult> {
  const t0 = Date.now();
  const token = await uploadImage(image, filename, mime);
  const ext = filename.split(".").pop()?.toLowerCase();
  const fileType = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png";
  const res = await fetchWithRetry(
    `${BASE}/task`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "image_to_model",
        file: { type: fileType, file_token: token },
        ...GEN,
        enable_image_autofix: true,
      }),
    },
    { provider: "Tripo" },
  );
  const j = (await res.json()) as TaskResp;
  const taskId = j.data?.task_id;
  if (j.code !== 0 || !taskId) throw new ProviderError("Tripo", 400, j.message || "no se creó la tarea image_to_model");
  return pollTask(taskId, t0, onProgress);
}
