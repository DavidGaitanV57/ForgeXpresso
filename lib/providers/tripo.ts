import { createHash, createHmac } from "crypto";
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

/** Default biped locomotion pack for in-game characters (in-place; root motion stays with physics). */
export const DEFAULT_BIPED_CLIPS = ["preset:idle", "preset:walk", "preset:run", "preset:jump", "preset:fall"] as const;

/**
 * Tripo only ships biped locomotion as a full pack; other skeletons get a single gait preset.
 * The runtime animator treats "walk"/"march" as the locomotion clip and rests in bind pose when idle.
 */
export const CLIPS_BY_RIG: Record<string, readonly string[]> = {
  biped: DEFAULT_BIPED_CLIPS,
  quadruped: ["preset:quadruped:walk"],
  hexapod: ["preset:hexapod:walk"],
  octopod: ["preset:octopod:walk"],
  serpentine: ["preset:serpentine:march"],
  aquatic: ["preset:aquatic:march"],
};

export function clipsForRig(rigType: string): string[] {
  return [...(CLIPS_BY_RIG[rigType] || CLIPS_BY_RIG.biped)];
}

/** v1.0 is biped-only (and the most reliable biped retarget); other skeletons need v2.5. */
function rigVersionFor(rigType: string) {
  return rigType === "biped" ? "v1.0-20240301" : "v2.5-20260210";
}

export interface ModelResult {
  data: Buffer;
  estimatedUsd: number;
  ms: number;
  /** Tripo task id (generation / import / rig / retarget) when available. */
  taskId?: string;
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
    output?: {
      pbr_model?: string;
      model?: string;
      base_model?: string;
      model_url?: string;
      riggable?: boolean;
      rig_type?: string;
    };
    image_token?: string;
    file_token?: string;
    s3_host?: string;
    resource_bucket?: string;
    resource_uri?: string;
    session_token?: string;
    sts_ak?: string;
    sts_sk?: string;
  };
}

function modelUrl(out?: NonNullable<TaskResp["data"]>["output"]) {
  if (!out) return "";
  return out.pbr_model || out.model || out.base_model || out.model_url || "";
}

async function submitTask(body: Record<string, unknown>): Promise<string> {
  const res = await fetchWithRetry(
    `${BASE}/task`,
    { method: "POST", headers: headers(), body: JSON.stringify(body) },
    { provider: "Tripo" },
  );
  const j = (await res.json()) as TaskResp;
  const taskId = j.data?.task_id;
  if (j.code !== 0 || !taskId) throw new ProviderError("Tripo", 400, j.message || "no se creó la tarea");
  return taskId;
}

async function pollTask(
  taskId: string,
  t0: number,
  onProgress?: (p: number) => void,
  opts: { needModel?: boolean; timeoutMs?: number } = {},
): Promise<ModelResult & { raw?: TaskResp["data"] }> {
  const needModel = opts.needModel !== false;
  const deadline = Date.now() + (opts.timeoutMs ?? 12 * 60_000);
  while (Date.now() < deadline) {
    await sleep(4000);
    const r = await fetchWithRetry(`${BASE}/task/${taskId}`, { headers: headers() }, { provider: "Tripo" });
    const t = (await r.json()) as TaskResp;
    const st = t.data?.status;
    if (typeof t.data?.progress === "number") onProgress?.(t.data.progress);
    if (st === "success") {
      if (!needModel) {
        return { data: Buffer.alloc(0), estimatedUsd: estimateTripoUsd(), ms: Date.now() - t0, taskId, raw: t.data };
      }
      const url = modelUrl(t.data?.output);
      if (!url) throw new ProviderError("Tripo", 500, "tarea sin modelo");
      const m = await fetch(url);
      if (!m.ok) throw new ProviderError("Tripo", m.status, "no se pudo descargar el modelo");
      return { data: Buffer.from(await m.arrayBuffer()), estimatedUsd: estimateTripoUsd(), ms: Date.now() - t0, taskId, raw: t.data };
    }
    if (st && ["failed", "cancelled", "banned", "expired", "unknown"].includes(st)) {
      const detail = JSON.stringify(t.data || t).slice(0, 500);
      throw new ProviderError("Tripo", 500, `tarea ${st}${t.message ? `: ${t.message}` : ""} — ${detail}`);
    }
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
  const j = (await res.json()) as TaskResp;
  const token = j.data?.image_token || j.data?.file_token;
  if (j.code !== 0 || !token) throw new ProviderError("Tripo", 400, j.message || "upload sin token");
  return token;
}

/** STS + S3 PUT for a 3D model (glb/fbx/obj/stl). Returns bucket/key for import_model. */
export async function uploadModelObject(
  data: Buffer,
  format: "glb" | "fbx" | "obj" | "stl" = "glb",
): Promise<{ bucket: string; key: string }> {
  const tokRes = await fetchWithRetry(
    `${BASE}/upload/sts/token`,
    { method: "POST", headers: headers(), body: JSON.stringify({ format }) },
    { provider: "Tripo" },
  );
  const tok = (await tokRes.json()) as TaskResp;
  const d = tok.data;
  if (tok.code !== 0 || !d?.sts_ak || !d.sts_sk || !d.session_token || !d.resource_uri || !d.resource_bucket) {
    throw new ProviderError("Tripo", 400, tok.message || "STS token inválido");
  }
  const bucket = d.resource_bucket;
  const key = d.resource_uri;
  const host = `${bucket}.s3-accelerate.amazonaws.com`;
  const region = "us-west-2";
  const contentType = format === "glb" ? "model/gltf-binary" : "application/octet-stream";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(data).digest("hex");
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-security-token:${d.session_token}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  const canonicalRequest = ["PUT", `/${key}`, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, createHash("sha256").update(canonicalRequest).digest("hex")].join(
    "\n",
  );
  const kDate = createHmac("sha256", `AWS4${d.sts_sk}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${d.sts_ak}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const put = await fetch(`https://${host}/${key}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      Host: host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "x-amz-security-token": d.session_token,
      Authorization: authorization,
    },
    body: new Uint8Array(data),
  });
  if (!put.ok) {
    const msg = await put.text().catch(() => put.statusText);
    throw new ProviderError("Tripo", put.status, `S3 upload falló: ${String(msg).slice(0, 200)}`);
  }
  return { bucket, key };
}

/** Import an uploaded model so it can be used as original_model_task_id for rig/retarget. */
export async function importModel(bucket: string, key: string, onProgress?: (p: number) => void): Promise<string> {
  const taskId = await submitTask({
    type: "import_model",
    file: { object: { bucket, key } },
  });
  const r = await pollTask(taskId, Date.now(), onProgress, { needModel: false, timeoutMs: 5 * 60_000 });
  return r.taskId || taskId;
}

/** Optional pre-check; returns suggested rig_type (defaults to biped on failure). */
export async function preRigCheck(originalModelTaskId: string): Promise<{ riggable: boolean; rigType: string }> {
  try {
    const taskId = await submitTask({ type: "animate_prerigcheck", original_model_task_id: originalModelTaskId });
    const r = await pollTask(taskId, Date.now(), undefined, { needModel: false, timeoutMs: 3 * 60_000 });
    const out = r.raw?.output;
    return {
      riggable: out?.riggable !== false,
      rigType: typeof out?.rig_type === "string" && out.rig_type ? out.rig_type : "biped",
    };
  } catch {
    return { riggable: true, rigType: "biped" };
  }
}

export async function animateRig(
  originalModelTaskId: string,
  opts: { rigType?: string; modelVersion?: string; onProgress?: (p: number) => void } = {},
): Promise<ModelResult> {
  const t0 = Date.now();
  const rigType = opts.rigType || "biped";
  const taskId = await submitTask({
    type: "animate_rig",
    original_model_task_id: originalModelTaskId,
    out_format: "glb",
    rig_type: rigType,
    spec: "tripo",
    model_version: opts.modelVersion || rigVersionFor(rigType),
  });
  return pollTask(taskId, t0, opts.onProgress);
}

export async function animateRetarget(
  rigTaskId: string,
  animations: string[] = [...DEFAULT_BIPED_CLIPS],
  opts: { animateInPlace?: boolean; onProgress?: (p: number) => void } = {},
): Promise<ModelResult> {
  const t0 = Date.now();
  const clips = animations.slice(0, 5);
  // Keep the body minimal — bake_animation / export_with_geometry caused Tripo 1004.
  // Prefer in-place when requested; runtime still pins Root/Hip if clips include root motion.
  const body: Record<string, unknown> = {
    type: "animate_retarget",
    original_model_task_id: rigTaskId,
    out_format: "glb",
  };
  if (clips.length === 1) body.animation = clips[0];
  else body.animations = clips;
  if (opts.animateInPlace !== false) body.animate_in_place = true;
  try {
    const taskId = await submitTask(body);
    return await pollTask(taskId, t0, opts.onProgress);
  } catch (e) {
    if (body.animate_in_place) {
      delete body.animate_in_place;
      const taskId = await submitTask(body);
      return pollTask(taskId, t0, opts.onProgress);
    }
    throw e;
  }
}

export interface AnimateOptions {
  /** Force a skeleton ("biped" | "quadruped" | …). Default: whatever Tripo's pre-rig check detects. */
  rigType?: string;
  /** Override presets; default comes from CLIPS_BY_RIG for the resolved rig type. */
  animations?: string[];
  onProgress?: (label: string, p: number) => void;
}

/**
 * Full pipeline: upload existing GLB → import → pre-rig check → rig → retarget with clips.
 * Returns a skinned GLB with baked animation clips ready for THREE.AnimationMixer.
 */
export async function animateExistingGlb(
  glb: Buffer,
  opts: AnimateOptions = {},
): Promise<ModelResult & { rigType: string; clips: string[] }> {
  const onProgress = opts.onProgress;
  const t0 = Date.now();
  let usd = 0;
  const prog = (label: string) => (p: number) => onProgress?.(label, p);

  onProgress?.("upload", 0);
  const { bucket, key } = await uploadModelObject(glb, "glb");
  onProgress?.("upload", 100);

  onProgress?.("import", 0);
  const importId = await importModel(bucket, key, prog("import"));
  usd += estimateTripoUsd() * 0.25;

  onProgress?.("prerig", 0);
  const check = await preRigCheck(importId);
  if (!check.riggable) throw new ProviderError("Tripo", 400, "modelo no apto para auto-rig");
  const rigType = opts.rigType || check.rigType;
  const clips = opts.animations?.length ? opts.animations : clipsForRig(rigType);
  onProgress?.(`prerig detected=${check.rigType} using=${rigType}`, 100);

  onProgress?.("rig", 0);
  const rig = await animateRig(importId, { rigType, onProgress: prog("rig") });
  usd += rig.estimatedUsd;
  if (!rig.taskId) throw new ProviderError("Tripo", 500, "rig sin task_id");

  onProgress?.("retarget", 0);
  const anim = await animateRetarget(rig.taskId, clips, { onProgress: prog("retarget") });
  usd += anim.estimatedUsd;

  return { data: anim.data, estimatedUsd: usd, ms: Date.now() - t0, taskId: anim.taskId, rigType, clips };
}

const SOLID =
  " Game-ready closed solid mesh, watertight, no holes, no paper-thin open shells, readable silhouette, single isolated object, no ground plane, no scenery pedestal.";

export async function textToModel(prompt: string, onProgress?: (p: number) => void): Promise<ModelResult> {
  const t0 = Date.now();
  const full = `${prompt.slice(0, 850)}${SOLID}`.slice(0, 1000);
  const taskId = await submitTask({ type: "text_to_model", prompt: full, ...GEN });
  return pollTask(taskId, t0, onProgress);
}

/** Legacy image→3D (kept for rare explicit use). New games prefer textToModel. */
export async function imageToModel(image: Buffer, filename: string, mime = "image/png", onProgress?: (p: number) => void): Promise<ModelResult> {
  const t0 = Date.now();
  const token = await uploadImage(image, filename, mime);
  const ext = filename.split(".").pop()?.toLowerCase();
  const fileType = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "webp" ? "webp" : "png";
  const taskId = await submitTask({
    type: "image_to_model",
    file: { type: fileType, file_token: token },
    ...GEN,
    enable_image_autofix: true,
  });
  return pollTask(taskId, t0, onProgress);
}
