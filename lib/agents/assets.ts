import { config } from "../config";
import { processImage, validateImageQa } from "../imageproc";
import { availableImageProvider, generateImage } from "../providers/images";
import * as eleven from "../providers/elevenlabs";
import * as tripo from "../providers/tripo";
import { patchAsset, writeProjectFile } from "../store";
import type { AssetRecord, AudioAssetSpec, GameDesign, ImageAssetSpec, ImageProvider, ImageRole, ModelAssetSpec } from "../types";

export function newRecord(type: AssetRecord["type"], spec: ImageAssetSpec | AudioAssetSpec | ModelAssetSpec): AssetRecord {
  return { id: spec.id, type, name: spec.name, spec, status: "pending", rev: 0, liked: 0, updatedAt: Date.now() };
}

export function recordsFromDesign(design: GameDesign): Record<string, AssetRecord> {
  const out: Record<string, AssetRecord> = {};
  for (const s of design.assets.images) out[s.id] = newRecord("image", s);
  for (const s of design.assets.audio) out[s.id] = newRecord("audio", s);
  for (const s of design.assets.models) out[s.id] = newRecord("model", s);
  return out;
}

const ROLE_FRAMING: Record<ImageRole, string> = {
  hero: "Game character sprite of the playable hero, full body, clean readable silhouette, centered, isolated subject only, flat solid chroma or transparent background, NO scenery, NO nebula, NO planets, NO ground plane, NO cast shadow, NO frame, NO text",
  enemy:
    "Game enemy/boss sprite, full body or full ship, clean readable silhouette, centered, ISOLATED subject only on flat solid pure magenta (#FF00FF) or transparent background, cutout ready. FORBIDDEN: nebula, galaxies, planets, stars as backdrop, ground plane, cast shadow plate, rectangular scenery frame, vignette, text. The pixels around the silhouette MUST be empty chroma — never paint space scenery behind the subject",
  npc: "Game character sprite, full body, centered, isolated subject only, no scenery, no ground, no frame, no text",
  collectible:
    "Game collectible item icon, glowing and appealing, centered, ISOLATED cutout on flat solid pure magenta (#FF00FF) or transparent background. FORBIDDEN: white/colored rectangular plate, scenery backdrop, room wall, ground plane, cast shadow plate, vignette, frame, text. Pixels around the silhouette MUST be empty chroma — never a pasted sticker card",
  hazard:
    "Game hazard/obstacle sprite, clearly dangerous, centered, ISOLATED cutout on flat solid pure magenta (#FF00FF) or transparent background. FORBIDDEN: white/colored rectangular plate, scenery backdrop, ground plane, cast shadow plate, vignette, frame, text. Cutout-ready silhouette only",
  prop:
    "Game prop/object sprite (door, mushroom, crate, etc.), centered, ISOLATED cutout on flat solid pure magenta (#FF00FF) or transparent background, alpha-ready for compositing into a 3D/2.5D scene. FORBIDDEN: white or solid rectangular card behind the object, painted room/forest plate, ground shadow plate, vignette, frame, text. The subject alone — never a sticker-on-backdrop look",
  platform:
    "Game platform piece seen from the side, flat walkable top surface, centered, ISOLATED cutout on flat solid pure magenta (#FF00FF) or transparent background, no scenery plate, no text, no frame",
  tile: "Game ground/platform block sprite seen from the side, flat walkable top edge, designed to be tiled horizontally, seamless left-right edges, no text",
  goal:
    "Game level goal object (exit/portal/flag/door), inviting and visible, centered, ISOLATED cutout on flat solid pure magenta (#FF00FF) or transparent background. FORBIDDEN: white rectangular plate, scenery backdrop, ground shadow plate, vignette, frame, text. Cutout-ready only",
  background:
    "Wide video game background environment painting, no characters, no text, no UI, strong sense of depth, calm lower area suitable for gameplay",
  texture: "Seamless tileable surface texture, orthographic top-down, flat even lighting, no perspective, no objects, no text, fills the entire image, left edge matches right edge perfectly",
  ui: "Flat game UI icon, centered, isolated, no text, no frame",
  portrait: "Character portrait illustration for a story cutscene, no text",
};

export function imagePrompt(spec: ImageAssetSpec, design: GameDesign, retryNote = "") {
  const view =
    design.dimension === "2d" && ["hero", "enemy", "npc", "hazard", "prop", "goal"].includes(spec.role) && !/top[- ]?down/i.test(design.camera)
      ? " Side view, facing right."
      : "";
  let seamless = "";
  if (spec.seamless) {
    seamless =
      spec.role === "background"
        ? " CRITICAL: perfectly seamless horizontally tileable abstract layer (starfield/nebula/clouds only). Left edge must continue into the right edge. NO planets, NO ships, NO landmarks, NO unique silhouettes."
        : " CRITICAL: seamless tileable — left edge matches right edge exactly.";
  } else if (spec.role === "background") {
    seamless = " Single non-tiling cinematic backdrop (unique landmarks OK). Do NOT make it wrap/tile.";
  }
  const retry = retryNote ? ` QA RETRY: ${retryNote}` : "";
  return `${ROLE_FRAMING[spec.role]}.${view}${seamless}${retry} Subject: ${spec.prompt}. Art style: ${design.artStyle}. Color palette: ${design.palette.join(", ")}. High quality, professional game art.`;
}

async function finish(projectId: string, rec: AssetRecord, ext: string, data: Buffer, mime: string, provider: string) {
  const rev = (rec.rev || 0) + 1;
  const file = `assets/${rec.id}.r${rev}.${ext}`;
  await writeProjectFile(projectId, file, data);
  return patchAsset(projectId, rec.id, { status: "ready", file, mime, rev, provider, error: undefined, custom: false });
}

async function fail(projectId: string, rec: AssetRecord, e: unknown, status: "error" | "skipped" = "error") {
  const msg = e instanceof Error ? e.message : String(e);
  return patchAsset(projectId, rec.id, { status, error: msg.slice(0, 300) });
}

export type AssetUsage = {
  provider: "openai" | "minimax" | "elevenlabs" | "tripo";
  label: string;
  estimatedUsd: number;
  ms: number;
  images?: number;
  audioSec?: number;
  models?: number;
};

export async function generateImageAsset(projectId: string, rec: AssetRecord, design: GameDesign, preferred: ImageProvider): Promise<AssetUsage | null> {
  const spec = rec.spec as ImageAssetSpec;
  const provider = availableImageProvider(preferred);
  if (!provider) {
    await fail(projectId, rec, "Sin clave de OpenAI ni MiniMax: el juego usa un marcador para esta imagen.", "skipped");
    return null;
  }
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined });
  let lastErr = "";
  let spentUsd = 0;
  let spentMs = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await generateImage({
        prompt: imagePrompt(spec, design, lastErr),
        aspect: spec.aspect,
        transparent: spec.transparent,
        provider,
        hq: spec.role === "hero" || spec.role === "background" || spec.role === "enemy",
      });
      spentUsd += raw.estimatedUsd;
      spentMs += raw.ms;
      const img = await processImage(raw.data, { role: spec.role, transparent: spec.transparent, needsKeying: raw.needsKeying });
      const qa = await validateImageQa(img.data, { transparent: spec.transparent, seamless: spec.seamless, role: spec.role });
      if (!qa.ok) {
        lastErr = qa.reasons.join("; ");
        console.warn(`[forge] image QA failed ${rec.id} attempt ${attempt + 1}: ${lastErr}`);
        if (attempt === 0) continue;
        // Keep the best-effort image on final attempt but annotate error for visibility.
        await finish(projectId, rec, img.ext, img.data, img.mime, provider === "openai" ? "OpenAI" : "MiniMax");
        await patchAsset(projectId, rec.id, { error: `QA débil: ${lastErr}`.slice(0, 300) });
        return { provider, label: `img:${rec.id}`, estimatedUsd: spentUsd, ms: spentMs, images: attempt + 1 };
      }
      await finish(projectId, rec, img.ext, img.data, img.mime, provider === "openai" ? "OpenAI" : "MiniMax");
      return { provider, label: `img:${rec.id}`, estimatedUsd: spentUsd, ms: spentMs, images: attempt + 1 };
    }
    await fail(projectId, rec, lastErr || "QA de imagen falló");
    return null;
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

export async function generateAudioAsset(projectId: string, rec: AssetRecord): Promise<AssetUsage | null> {
  const spec = rec.spec as AudioAssetSpec;
  if (!config.elevenlabs.key()) {
    await fail(projectId, rec, "Sin clave de ElevenLabs: el juego usa sonidos sintetizados.", "skipped");
    return null;
  }
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined });
  try {
    const result =
      spec.kind === "music"
        ? await eleven.music(spec.prompt, spec.durationSec)
        : spec.kind === "voice"
          ? await eleven.speech(spec.prompt)
          : await eleven.soundEffect(spec.prompt, spec.durationSec, spec.loop);
    await finish(projectId, rec, "mp3", result.data, "audio/mpeg", "ElevenLabs");
    return { provider: "elevenlabs", label: `audio:${rec.id}`, estimatedUsd: result.estimatedUsd, ms: result.ms, audioSec: result.audioSec };
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

export async function generateModelAsset(projectId: string, rec: AssetRecord, design: GameDesign): Promise<AssetUsage | null> {
  const spec = rec.spec as ModelAssetSpec;
  if (!config.tripo.key()) {
    await fail(projectId, rec, "Sin clave de Tripo: se usa geometría procedural.", "skipped");
    return null;
  }
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined });
  try {
    const result = await tripo.textToModel(`${spec.prompt}. Style: ${design.artStyle.slice(0, 300)}`);
    await finish(projectId, rec, "glb", result.data, "model/gltf-binary", "Tripo");
    return { provider: "tripo", label: `model:${rec.id}`, estimatedUsd: result.estimatedUsd, ms: result.ms, models: 1 };
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

export function generateAsset(projectId: string, rec: AssetRecord, design: GameDesign, provider: ImageProvider) {
  if (rec.type === "image") return generateImageAsset(projectId, rec, design, provider);
  if (rec.type === "audio") return generateAudioAsset(projectId, rec);
  return generateModelAsset(projectId, rec, design);
}
