import { config } from "../config";
import type { Aspect, ImageProvider } from "../types";
import { estimateMiniMaxImageUsd, estimateOpenAIImageUsd } from "../usage";
import { fetchWithRetry, ProviderError } from "./http";

export const CHROMA_HEX = "#FF00FF";

export interface RawImage {
  data: Buffer;
  provider: ImageProvider;
  /** The image was generated on a flat chroma background that must be keyed out. */
  needsKeying: boolean;
  estimatedUsd: number;
  ms: number;
}

export function availableImageProvider(preferred: ImageProvider): ImageProvider | null {
  const has = { openai: !!config.openai.key(), minimax: !!config.minimax.key() };
  if (has[preferred]) return preferred;
  if (has.openai) return "openai";
  if (has.minimax) return "minimax";
  return null;
}

export async function generateImage(o: { prompt: string; aspect: Aspect; transparent: boolean; provider: ImageProvider; hq?: boolean }): Promise<RawImage> {
  return o.provider === "minimax" ? minimax(o) : openai(o);
}

async function openai(o: { prompt: string; aspect: Aspect; transparent: boolean; hq?: boolean }): Promise<RawImage> {
  const size = o.aspect === "1:1" ? "1024x1024" : o.aspect === "9:16" || o.aspect === "2:3" ? "1024x1536" : "1536x1024";
  const quality = o.hq ? "high" : "medium";
  const body = {
    model: config.openai.imageModel(),
    prompt: o.prompt,
    size,
    n: 1,
    quality,
    background: o.transparent ? "transparent" : "opaque",
    output_format: "png",
  };
  const t0 = Date.now();
  const res = await fetchWithRetry(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { provider: "OpenAI", timeoutMs: 240_000 },
  );
  const j = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = j.data?.[0];
  // gpt-image often leaves an opaque dark plate even with background:"transparent" — always run cutout.
  const meta = { provider: "openai" as const, needsKeying: !!o.transparent, estimatedUsd: estimateOpenAIImageUsd(quality, o.aspect), ms: Date.now() - t0 };
  if (item?.b64_json) return { data: Buffer.from(item.b64_json, "base64"), ...meta };
  if (item?.url) return { data: Buffer.from(await (await fetch(item.url)).arrayBuffer()), ...meta };
  throw new ProviderError("OpenAI", 500, "respuesta sin imagen");
}

async function minimax(o: { prompt: string; aspect: Aspect; transparent: boolean }): Promise<RawImage> {
  const prompt = o.transparent
    ? `${o.prompt}. Single isolated subject, centered, full body visible, on a perfectly flat solid pure magenta (${CHROMA_HEX}) background, no shadows on the background, no magenta on the subject.`
    : o.prompt;
  const t0 = Date.now();
  const res = await fetchWithRetry(
    `${config.minimax.baseUrl()}/v1/image_generation`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.minimax.key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.minimax.imageModel(),
        prompt: prompt.slice(0, 1500),
        aspect_ratio: o.aspect,
        response_format: "base64",
        n: 1,
        prompt_optimizer: false,
      }),
    },
    { provider: "MiniMax", timeoutMs: 240_000 },
  );
  const j = (await res.json()) as { data?: { image_base64?: string[]; image_urls?: string[] }; base_resp?: { status_code: number; status_msg: string } };
  if (j.base_resp && j.base_resp.status_code !== 0) throw new ProviderError("MiniMax", 400, j.base_resp.status_msg);
  const meta = { provider: "minimax" as const, needsKeying: o.transparent, estimatedUsd: estimateMiniMaxImageUsd(), ms: Date.now() - t0 };
  const b64 = j.data?.image_base64?.[0];
  if (b64) return { data: Buffer.from(b64, "base64"), ...meta };
  const url = j.data?.image_urls?.[0];
  if (url) return { data: Buffer.from(await (await fetch(url)).arrayBuffer()), ...meta };
  throw new ProviderError("MiniMax", 500, "respuesta sin imagen");
}
