import { config } from "../config";
import { processImage, validateImageQa } from "../imageproc";
import { availableImageProvider, editImageOpenAI, generateImage } from "../providers/images";
import * as eleven from "../providers/elevenlabs";
import * as tripo from "../providers/tripo";
import { CHROMA, pickChroma, processSheet, type Chroma } from "../sheetproc";
import { normalizeSheetAnims, sheetAspect, sheetIdFor, sheetLayout, sheetRows, sheetSpecFor, SHEET_ROLES, type SheetAnimSpec, type SheetLayout } from "../sheets";
import sharp from "sharp";
import { getProject, patchAsset, readProjectFile, writeProjectFile } from "../store";
import type { AssetRecord, AudioAssetSpec, GameDesign, ImageAssetSpec, ImageProvider, ImageRole, ModelAssetSpec } from "../types";
import { sanitizeVoicePrompt } from "./voice-prompt";

/** Image id paired with a `*_3d` model (lumi_hero_3d → lumi_hero). */
export function sourceImageIdForModel(modelId: string) {
  return modelId.endsWith("_3d") ? modelId.slice(0, -3) : "";
}

export function newRecord(type: AssetRecord["type"], spec: ImageAssetSpec | AudioAssetSpec | ModelAssetSpec): AssetRecord {
  return { id: spec.id, type, name: spec.name, spec, status: "pending", rev: 0, liked: 0, updatedAt: Date.now() };
}

/** Create (or re-scope) the `${baseId}_sheet` asset for a 2D character. Mutates design + assets. */
export function ensureSheet(design: GameDesign, assets: Record<string, AssetRecord>, baseId: string, anims: (string | SheetAnimSpec)[]): AssetRecord | null {
  const base = assets[baseId];
  if (!base || base.type !== "image") return null;
  const bs = base.spec as ImageAssetSpec;
  if (bs.sheet || !SHEET_ROLES.has(bs.role)) return null;
  const list = normalizeSheetAnims(anims);
  const id = sheetIdFor(baseId);
  const existing = assets[id];
  if (existing) {
    const spec = existing.spec as ImageAssetSpec;
    spec.sheet = { of: baseId, anims: list };
    spec.usage = sheetSpecFor(bs, list).usage;
    const inDesign = design.assets.images.find((i) => i.id === id);
    if (inDesign && inDesign !== spec) Object.assign(inDesign, { sheet: spec.sheet, usage: spec.usage });
    return existing;
  }
  const spec = sheetSpecFor(bs, list);
  design.assets.images.push(spec);
  assets[id] = newRecord("image", spec);
  return assets[id];
}

/** Remember which frame list revision `rev` of a sheet was drawn with. */
export function withSheetRev(spec: ImageAssetSpec, rev: number): ImageAssetSpec {
  if (!spec.sheet) return spec;
  return { ...spec, sheet: { ...spec.sheet, revs: { ...spec.sheet.revs, [rev]: spec.sheet.anims } } };
}

export const isSheetRecord = (r: AssetRecord) => r.type === "image" && !!(r.spec as ImageAssetSpec).sheet;

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

function sheetPrompt(o: { subject: string; design: GameDesign; layout: SheetLayout; chroma: Chroma; withRef: boolean; extra: string; retry: string }) {
  const { layout, chroma } = o;
  const c = CHROMA[chroma];
  const rows = sheetRows(layout).map((row, r) => {
    const cells = row.map((x) => `cell ${x.col + 1}) ${x.anim} frame ${x.i + 1}/${x.of}: ${x.pose}`);
    for (let k = row.length; k < layout.cols; k++) cells.push(`cell ${k + 1}) EMPTY, background only`);
    return `Row ${r + 1}:\n  ${cells.join("\n  ")}`;
  });
  return [
    `2D game sprite sheet: ${o.withRef ? "the EXACT same character as the reference image (identical proportions, colors, outfit, accessories, line and shading style)" : "one single consistent character"}.`,
    o.withRef
      ? "The reference defines ONLY the character's identity, NOT the pose: do not copy its pose; draw every cell in the pose described for it."
      : "",
    `Layout: a strict grid of ${layout.rows} rows x ${layout.cols} columns of equal cells on a perfectly flat solid ${c.label} (${c.hex}) background — that one flat color everywhere, including gaps between legs, arms and tail.`,
    "Exactly one full-body pose per cell, side view, facing RIGHT in every cell, the same character size in every cell, feet on the same invisible baseline near the bottom of each cell, generous empty margin so no pose touches or crosses into a neighbouring cell.",
    "Each animation reads left to right as consecutive frames: neighbouring frames of a cycle MUST show clearly different leg and arm positions exactly as described (never the same stride repeated).",
    `FORBIDDEN: grid lines, borders, labels, text, numbers, ground, cast shadows, dust clouds, speed lines, any ${c.label} on the character.`,
    ...rows,
    `Character: ${o.subject}.`,
    `Art style: ${o.design.artStyle}. Palette: ${o.design.palette.join(", ")}.`,
    o.extra ? `Direction: ${o.extra}.` : "",
    o.retry ? `QA RETRY — fix: ${o.retry}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Reference for the edit endpoint: the approved character flattened on the chroma color, square-padded. */
async function sheetReference(base: Buffer, chroma: Chroma) {
  const [r, g, b] = CHROMA[chroma].rgb;
  return sharp(base)
    .ensureAlpha()
    .trim({ threshold: 1 })
    .resize(860, 860, { fit: "contain", background: { r, g, b, alpha: 1 } })
    .extend({ top: 82, bottom: 82, left: 82, right: 82, background: { r, g, b, alpha: 1 } })
    .flatten({ background: { r, g, b } })
    .png()
    .toBuffer();
}

/**
 * Animation spritesheet for a 2D character: reference edit from the approved base sprite (OpenAI),
 * text-only fallback otherwise, then strict grid normalization + per-frame QA.
 */
export async function generateSheetAsset(projectId: string, rec: AssetRecord, design: GameDesign, preferred: ImageProvider): Promise<AssetUsage | null> {
  const spec = rec.spec as ImageAssetSpec;
  const sheet = spec.sheet!;
  const provider = availableImageProvider(preferred);
  if (!provider) {
    await fail(projectId, rec, "Sin clave de OpenAI ni MiniMax: el personaje usa animación procedural.", "skipped");
    return null;
  }
  const project = await getProject(projectId);
  const base = project?.assets[sheet.of];
  const baseSpec = base?.spec as ImageAssetSpec | undefined;
  if (!base || !baseSpec) {
    await fail(projectId, rec, `No existe el personaje base ${sheet.of}.`);
    return null;
  }
  if (base.status !== "ready" || !base.file) {
    await fail(projectId, rec, `El personaje base ${sheet.of} no está listo; genéralo primero.`);
    return null;
  }
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined });
  const layout = sheetLayout(sheet.anims);
  const aspect = sheetAspect(layout);
  let spentUsd = 0;
  let spentMs = 0;
  let calls = 0;
  let lastErr = "";
  try {
    const baseBuf = await readProjectFile(projectId, base.file);
    const chroma = await pickChroma(baseBuf);
    const ref = provider === "openai" ? await sheetReference(baseBuf, chroma) : null;
    let best: { data: Buffer; reasons: string[] } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      const mk = (withRef: boolean) =>
        sheetPrompt({ subject: baseSpec.prompt, design, layout, chroma, withRef, extra: spec.prompt, retry: lastErr });
      if (ref) {
        try {
          raw = await editImageOpenAI({ prompt: mk(true), image: ref, aspect, hq: true });
        } catch (e) {
          console.warn(`[forge] sheet edit failed ${rec.id}, text-only fallback`, e);
          raw = await generateImage({ prompt: mk(false), aspect, transparent: false, provider, hq: true });
        }
      } else {
        raw = await generateImage({ prompt: mk(false), aspect, transparent: false, provider, hq: true });
      }
      calls++;
      spentUsd += raw.estimatedUsd;
      spentMs += raw.ms;
      const out = await processSheet(raw.data, sheet.anims, { chroma });
      if (!best || out.reasons.length < best.reasons.length) best = { data: out.data, reasons: out.reasons };
      if (!out.reasons.length) break;
      lastErr = out.reasons.join("; ");
      console.warn(`[forge] sheet QA failed ${rec.id} attempt ${attempt + 1}: ${lastErr}`);
    }
    const done = await finish(projectId, rec, "png", best!.data, "image/png", provider === "openai" ? "OpenAI" : "MiniMax");
    if (done) await patchAsset(projectId, rec.id, { spec: withSheetRev(done.spec as ImageAssetSpec, done.rev) });
    if (best!.reasons.length) await patchAsset(projectId, rec.id, { error: `QA débil: ${best!.reasons.join("; ")}`.slice(0, 300) });
    return { provider, label: `sheet:${rec.id}`, estimatedUsd: spentUsd, ms: spentMs, images: calls };
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

export async function generateAudioAsset(projectId: string, rec: AssetRecord, design?: GameDesign): Promise<AssetUsage | null> {
  const spec = rec.spec as AudioAssetSpec;
  if (!config.elevenlabs.key()) {
    await fail(projectId, rec, "Sin clave de ElevenLabs: el juego usa sonidos sintetizados.", "skipped");
    return null;
  }
  if (spec.kind === "voice") {
    const cleaned = sanitizeVoicePrompt(spec.prompt, design?.cinematic?.lines);
    if (cleaned && cleaned !== spec.prompt) {
      spec.prompt = cleaned;
      const dAudio = design?.assets.audio.find((a) => a.id === rec.id);
      if (dAudio) dAudio.prompt = cleaned;
      await patchAsset(projectId, rec.id, {});
    }
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
    // Text→3D is the primary path for new 3D/2.5D mesh entities (no 2D intermediary).
    const result = await tripo.textToModel(`${spec.prompt}. Art style: ${design.artStyle.slice(0, 280)}`);
    await finish(projectId, rec, "glb", result.data, "model/gltf-binary", "Tripo");
    return { provider: "tripo", label: `model:${rec.id}`, estimatedUsd: result.estimatedUsd, ms: result.ms, models: 1 };
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

/**
 * Auto-rig + retarget an existing ready GLB (Tripo). Opt-in only — not called by default generate.
 * Replaces the asset file with a skinned GLB that has baked clips (idle/walk/run/…).
 */
export async function animateModelAsset(
  projectId: string,
  rec: AssetRecord,
  opts: { rigType?: string; animations?: string[] } = {},
): Promise<AssetUsage | null> {
  if (!config.tripo.key()) {
    await fail(projectId, rec, "Sin clave de Tripo: no se puede auto-rig.", "skipped");
    return null;
  }
  if (rec.type !== "model" || !rec.file || rec.status !== "ready") {
    await fail(projectId, rec, "Modelo no listo para animar.");
    return null;
  }
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined });
  try {
    const { readProjectFile } = await import("../store");
    const glb = await readProjectFile(projectId, rec.file);
    const result = await tripo.animateExistingGlb(glb, {
      ...opts,
      onProgress: (label, p) => console.log(`[forge] animate ${rec.id} ${label} ${p}%`),
    });
    await finish(projectId, rec, "glb", result.data, "model/gltf-binary", "Tripo");
    return { provider: "tripo", label: `anim:${rec.id}`, estimatedUsd: result.estimatedUsd, ms: result.ms, models: 1 };
  } catch (e) {
    await fail(projectId, rec, e);
    return null;
  }
}

export function generateAsset(projectId: string, rec: AssetRecord, design: GameDesign, provider: ImageProvider) {
  if (rec.type === "image" && (rec.spec as ImageAssetSpec).sheet) return generateSheetAsset(projectId, rec, design, provider);
  if (rec.type === "image") return generateImageAsset(projectId, rec, design, provider);
  if (rec.type === "audio") return generateAudioAsset(projectId, rec, design);
  return generateModelAsset(projectId, rec, design);
}
