import { config } from "../config";
import { processImage } from "../imageproc";
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
  hero: "Game character sprite of the playable hero, full body, clean readable silhouette, centered, no text, no frame, no ground, no cast shadow",
  enemy: "Game enemy sprite, full body, clean readable silhouette, centered, no text, no frame, no ground, no cast shadow",
  npc: "Game character sprite, full body, centered, no text, no frame, no ground",
  collectible: "Game collectible item icon, glowing and appealing, centered, no text, no frame",
  hazard: "Game hazard/obstacle sprite, clearly dangerous, centered, no text, no frame",
  prop: "Game prop sprite, centered, no text, no frame",
  platform: "Game platform piece seen from the side, flat walkable top surface, centered, no text, no frame",
  tile: "Game ground/platform block sprite seen from the side, flat walkable top edge, designed to be tiled horizontally, no text",
  goal: "Game level goal object (exit/portal/flag), inviting and visible, centered, no text, no frame",
  background: "Wide video game background environment painting, no characters, no text, no UI, strong sense of depth, calm lower area suitable for gameplay",
  texture: "Seamless tileable surface texture, orthographic top-down, flat even lighting, no perspective, no objects, no text, fills the entire image",
  ui: "Flat game UI icon, centered, no text",
  portrait: "Character portrait illustration for a story cutscene, no text",
};

export function imagePrompt(spec: ImageAssetSpec, design: GameDesign) {
  const view =
    design.dimension === "2d" && ["hero", "enemy", "npc", "hazard", "prop", "goal"].includes(spec.role) && !/top[- ]?down/i.test(design.camera)
      ? " Side view, facing right."
      : "";
  return `${ROLE_FRAMING[spec.role]}.${view} Subject: ${spec.prompt}. Art style: ${design.artStyle}. Color palette: ${design.palette.join(", ")}. High quality, professional game art.`;
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
  try {
    const raw = await generateImage({
      prompt: imagePrompt(spec, design),
      aspect: spec.aspect,
      transparent: spec.transparent,
      provider,
      hq: spec.role === "hero" || spec.role === "background",
    });
    const img = await processImage(raw.data, { role: spec.role, transparent: spec.transparent, needsKeying: raw.needsKeying });
    await finish(projectId, rec, img.ext, img.data, img.mime, provider === "openai" ? "OpenAI" : "MiniMax");
    return { provider, label: `img:${rec.id}`, estimatedUsd: raw.estimatedUsd, ms: raw.ms, images: 1 };
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
