import { config } from "../config";
import { processImage, validateImageQa } from "../imageproc";
import { availableImageProvider, editImageOpenAI, generateImage, openaiSize } from "../providers/images";
import { isSafetyRejection } from "../providers/http";
import * as eleven from "../providers/elevenlabs";
import * as tripo from "../providers/tripo";
import { CHROMA, measureStill, pickChroma, processSheet, repackClip, type Chroma, type SheetRef } from "../sheetproc";
import { animsMentioned, clipSheetId, clipSpecFor, fluidCycles, ownClipList, sheetAspect, sheetAnimsFor, sheetIdFor, NORM_VERSION, sheetLayout, sheetRows, SHEET_ANIMS, SHEET_ROLES, type SheetAnimName, type SheetAnimSpec, type SheetLayout } from "../sheets";
import sharp from "sharp";
import { getProject, patchAsset, readProjectFile, writeProjectFile } from "../store";
import type { AssetRecord, AudioAssetSpec, GameDesign, ImageAssetSpec, ImageProvider, ImageRole, ModelAssetSpec, Project } from "../types";
import { cameraOverride, characterView, sheetIdentityLine, sheetViewLine, stillViewLine } from "../sprite-view";
import { sanitizeVoicePrompt } from "./voice-prompt";

/** Image id paired with a `*_3d` model (lumi_hero_3d → lumi_hero). */
export function sourceImageIdForModel(modelId: string) {
  return modelId.endsWith("_3d") ? modelId.slice(0, -3) : "";
}

export function newRecord(type: AssetRecord["type"], spec: ImageAssetSpec | AudioAssetSpec | ModelAssetSpec): AssetRecord {
  return { id: spec.id, type, name: spec.name, spec, status: "pending", rev: 0, liked: 0, updatedAt: Date.now() };
}

export function sheetsForCharacter(assets: Record<string, AssetRecord>, baseId: string): AssetRecord[] {
  return Object.values(assets).filter((a) => a.type === "image" && (a.spec as ImageAssetSpec).sheet?.of === baseId);
}

/** Add one sheet per animation that the character does not already have. Existing clips are left untouched. */
export function ensureClipSheets(design: GameDesign, assets: Record<string, AssetRecord>, baseId: string, anims: (string | SheetAnimSpec)[]): AssetRecord[] {
  const base = assets[baseId];
  if (!base || base.type !== "image") return [];
  const bs = base.spec as ImageAssetSpec;
  if (bs.sheet || !SHEET_ROLES.has(bs.role)) return [];
  const list = ownClipList(anims);
  const have = new Set<string>();
  const legacy = assets[sheetIdFor(baseId)];
  const legacySheet = legacy?.type === "image" ? (legacy.spec as ImageAssetSpec).sheet : undefined;
  if (legacySheet) for (const a of legacySheet.anims) have.add(a.name);
  for (const a of list) if (assets[clipSheetId(baseId, a.name)]) have.add(a.name);
  const created: AssetRecord[] = [];
  for (const anim of list) {
    if (have.has(anim.name)) continue;
    const spec = clipSpecFor(bs, anim);
    design.assets.images.push(spec);
    assets[spec.id] = newRecord("image", spec);
    created.push(assets[spec.id]);
  }
  return created;
}

function characterSpec(project: Project, of: string, fallback: ImageAssetSpec): ImageAssetSpec {
  const base = project.assets[of];
  if (base?.type === "image") return base.spec as ImageAssetSpec;
  return { ...fallback, id: of, name: of };
}

/** Copy each clip out of a combined sheet so a later redraw of one animation cannot replace the others. */
export async function peelCombinedSheet(projectId: string, project: Project, rec: AssetRecord): Promise<void> {
  const spec = rec.spec as ImageAssetSpec;
  const sheet = spec.sheet;
  if (!sheet || sheet.anims.length < 2 || rec.status !== "ready" || !rec.file || !project.design) return;
  let png: Buffer;
  try {
    png = await readProjectFile(projectId, rec.file);
  } catch {
    return;
  }
  const anims = sheetAnimsFor(sheet, rec.file);
  const base = characterSpec(project, sheet.of, spec);
  for (const anim of anims) {
    const id = clipSheetId(sheet.of, anim.name);
    const existing = project.assets[id];
    if (existing?.status === "ready" && existing.file) continue;
    try {
      const data = await repackClip(png, anims, anim);
      if (!data) continue;
      const clip = clipSpecFor(base, anim);
      const file = `assets/${id}.r1.png`;
      await writeProjectFile(projectId, file, data);
      const record = newRecord("image", clip);
      record.status = "ready";
      record.file = file;
      record.mime = "image/png";
      record.rev = 1;
      record.provider = rec.provider;
      project.assets[id] = record;
      if (!project.design.assets.images.some((i) => i.id === id)) project.design.assets.images.push(clip);
    } catch (e) {
      console.warn(`[forge] peel ${id} failed`, e);
    }
  }
}

/**
 * Redraw one clip. A combined sheet is never sent back to the image model:
 * its frames are copied aside and only the animations named in the prompt are regenerated.
 */
export async function queueClipRedraws(projectId: string, project: Project, rec: AssetRecord, prompt: string): Promise<AssetRecord[]> {
  const spec = rec.spec as ImageAssetSpec;
  const sheet = spec.sheet;
  if (!sheet) return [rec];
  if (sheet.anims.length <= 1) {
    if (prompt) spec.prompt = prompt;
    rec.liked = 0;
    return [rec];
  }
  await peelCombinedSheet(projectId, project, rec);
  const named = animsMentioned(prompt).filter((n) => sheet.anims.some((a) => a.name === n));
  if (!named.length || !project.design) return [];
  const base = characterSpec(project, sheet.of, spec);
  const out: AssetRecord[] = [];
  for (const name of named) {
    const from = sheet.anims.find((a) => a.name === name);
    if (!from) continue;
    const id = clipSheetId(sheet.of, name);
    let clip = project.assets[id];
    if (!clip) {
      const clipSpec = clipSpecFor(base, fluidCycles([from])[0]);
      clipSpec.prompt = prompt;
      project.design.assets.images.push(clipSpec);
      clip = newRecord("image", clipSpec);
      project.assets[id] = clip;
    } else {
      (clip.spec as ImageAssetSpec).prompt = prompt;
    }
    clip.liked = 0;
    out.push(clip);
  }
  return out;
}

/** A regenerate id like `hero_sheet_slide` when that clip does not exist yet. */
export function clipIdParts(id: string): { baseId: string; name: SheetAnimName } | null {
  const m = /^(.*)_sheet_([a-z]+)$/.exec(id);
  if (!m) return null;
  const name = m[2] as SheetAnimName;
  if (!(SHEET_ANIMS as readonly string[]).includes(name)) return null;
  return { baseId: m[1], name };
}

/** Remember which frame list revision `rev` of a sheet was drawn with. */
export function withSheetRev(spec: ImageAssetSpec, rev: number): ImageAssetSpec {
  if (!spec.sheet) return spec;
  return { ...spec, sheet: { ...spec.sheet, revs: { ...spec.sheet.revs, [rev]: spec.sheet.anims } } };
}

/** Remember the cell size and standing fill revision `rev` was packed with (only for shared-scale clips). */
export function withSheetNorm(spec: ImageAssetSpec, rev: number, layout: SheetLayout, from?: number): ImageAssetSpec {
  if (!spec.sheet || !layout.fill) return spec;
  const entry = { cell: layout.cell, fill: layout.fill, v: NORM_VERSION, ...(from ? { from } : {}) };
  return { ...spec, sheet: { ...spec.sheet, norm: { ...spec.sheet.norm, [rev]: entry } } };
}

const revOf = (file: string) => Number(/\.r(\d+)\.[^.]+$/.exec(file)?.[1]) || 0;

/**
 * The drawing a repack should start from: the revision this one was repacked from, else the newest
 * revision that was never repacked. Repacking a repack would resample the pixels again each version.
 */
function repackSource(rec: AssetRecord): { file: string; rev: number } {
  const sheet = (rec.spec as ImageAssetSpec).sheet!;
  const cur = revOf(rec.file!);
  const norm = sheet.norm?.[cur];
  if (!norm) return { file: rec.file!, rev: cur };
  const at = (n: number) => ({ file: rec.file!.replace(/\.r\d+\.([^.]+)$/, `.r${n}.$1`), rev: n });
  if (norm.from) return at(norm.from);
  // A versioned entry without `from` was packed straight from the model's drawing: it is the original.
  if (norm.v) return { file: rec.file!, rev: cur };
  // First-version repacks recorded no source: the newest revision never repacked is the drawing.
  for (let n = cur - 1; n >= 1; n--) if (!sheet.norm?.[n]) return at(n);
  return { file: rec.file!, rev: cur };
}

const harmonizing = new Map<string, Promise<void>>();
/** Cell for clips drawn before shared-scale packing (256 px cells): a larger cell would only add memory. */
const LEGACY_REPACK_CELL = 320;

/**
 * Repack every ready clip of a character that still has the old per-clip scale, at the still image's body size.
 * Runs locally on the stored PNG (no image API call), as a new revision, so a game that mixes an old clip
 * with a new one never changes the sprite's size when it switches animation. User uploads are left alone.
 */
export function harmonizeClips(projectId: string, baseId?: string): Promise<void> {
  const key = `${projectId}:${baseId || "*"}`;
  const prev = harmonizing.get(key) || Promise.resolve();
  const next = prev.then(() => harmonizeNow(projectId, baseId)).catch((e) => console.warn(`[forge] harmonize ${key} failed`, e));
  harmonizing.set(key, next);
  return next;
}

async function harmonizeNow(projectId: string, baseId?: string) {
  const project = await getProject(projectId);
  if (!project) return;
  const clips = Object.values(project.assets).filter((a) => {
    const sheet = a.type === "image" ? (a.spec as ImageAssetSpec).sheet : undefined;
    if (!sheet || (baseId && sheet.of !== baseId) || a.status !== "ready" || !a.file || a.custom) return false;
    return a.id !== sheetIdFor(sheet.of) && sheetAnimsFor(sheet, a.file).length === 1;
  });
  // All clips of one character share the largest cell any of them has, so switching clips never rescales it.
  // Old clips with no larger sibling stay at LEGACY_REPACK_CELL: their drawing has no more detail to keep.
  const target = new Map<string, number>();
  for (const a of clips) {
    const sheet = (a.spec as ImageAssetSpec).sheet!;
    const cell = sheet.norm?.[revOf(a.file!)]?.cell || LEGACY_REPACK_CELL;
    target.set(sheet.of, Math.max(target.get(sheet.of) || LEGACY_REPACK_CELL, cell));
  }
  const stale = clips.filter((a) => {
    const sheet = (a.spec as ImageAssetSpec).sheet!;
    const norm = sheet.norm?.[revOf(a.file!)];
    return norm?.v !== NORM_VERSION || norm.cell < target.get(sheet.of)!;
  });
  const refs = new Map<string, SheetRef | null>();
  for (const rec of stale) {
    const sheet = (rec.spec as ImageAssetSpec).sheet!;
    const base = project.assets[sheet.of];
    if (!base?.file || base.status !== "ready") continue;
    if (!refs.has(sheet.of)) refs.set(sheet.of, await measureStill(await readProjectFile(projectId, base.file)).catch(() => null));
    const ref = refs.get(sheet.of);
    if (!ref) continue;
    try {
      let src = repackSource(rec);
      const png = await readProjectFile(projectId, src.file).catch(() => {
        src = { file: rec.file!, rev: revOf(rec.file!) };
        return readProjectFile(projectId, rec.file!);
      });
      const anims = sheetAnimsFor(sheet, src.file);
      // The source grid is split from its own width; the output uses the character's shared cell.
      const fresh = await processSheet(png, anims, { chroma: "magenta", keyed: true, ref, exact: true, cell: target.get(sheet.of) });
      const done = await finish(projectId, rec, "png", fresh.data, "image/png", rec.provider || "Forge");
      if (done) {
        const spec = { ...(done.spec as ImageAssetSpec), sheet: { ...(done.spec as ImageAssetSpec).sheet!, anims } };
        await patchAsset(projectId, rec.id, { spec: withSheetNorm(withSheetRev(spec, done.rev), done.rev, fresh.layout, src.rev) });
      }
    } catch (e) {
      console.warn(`[forge] harmonize ${rec.id} failed`, e);
    }
  }
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
  keyart:
    "Square promotional key art poster, full-bleed splash illustration, the hero large and readable, the game's world behind them, the game title in bold stylized lettering, opaque painted background, not a sprite, not a transparent cutout, no UI buttons, no border, no watermark",
};

function designView(design: GameDesign, prompt = "") {
  return characterView({
    camera: design.camera,
    levelOutline: design.levelOutline,
    setting: design.setting,
    heroDescription: design.hero?.description,
    prompt,
  });
}

export function imagePrompt(spec: ImageAssetSpec, design: GameDesign, retryNote = "") {
  const cast = ["hero", "enemy", "npc", "hazard", "prop", "goal", "keyart"].includes(spec.role);
  const view = design.dimension === "2d" && cast ? stillViewLine(designView(design, spec.prompt)) : "";
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
  credits?: number;
};

const CAST_LOCK = new Set<ImageRole>(["hero"]);

/** Poster first locks the hero; a later poster is locked to the hero that already exists. */
async function identityReference(projectId: string, spec: ImageAssetSpec): Promise<{ image: Buffer; note: string } | null> {
  const project = await getProject(projectId);
  if (!project) return null;
  const ready = Object.values(project.assets).filter((a) => a.type === "image" && a.status === "ready" && a.file && !(a.spec as ImageAssetSpec).sheet);
  const pick = (role: ImageRole) => ready.find((a) => (a.spec as ImageAssetSpec).role === role);
  const source = spec.role === "keyart" ? pick("hero") : CAST_LOCK.has(spec.role) ? pick("keyart") : undefined;
  if (!source?.file) return null;
  const png = await sharp(await readProjectFile(projectId, source.file))
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#14151c" })
    .png()
    .toBuffer();
  const note =
    spec.role === "keyart"
      ? " IDENTITY LOCK: the reference image is the playable character. Depict that exact character — same species, face, outfit, colors and proportions. Do not redesign them. A new pose, the setting and the title are welcome."
      : " IDENTITY LOCK: the reference image is this game's key art. Draw that same hero as an isolated full-body sprite — same species, face, outfit, colors and proportions. Discard the poster layout, the title lettering and the scenery. Do not invent a different character.";
  return { image: png, note };
}

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
    const ref = provider === "openai" && (spec.role === "keyart" || CAST_LOCK.has(spec.role)) ? await identityReference(projectId, spec) : null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const view = design.dimension === "2d" && ["hero", "enemy", "npc", "hazard", "prop", "goal", "keyart"].includes(spec.role) ? designView(design, spec.prompt) : null;
      const prompt = imagePrompt(spec, design, lastErr) + (ref ? ref.note : "") + (ref && view ? cameraOverride(view) : "");
      const hq = spec.role === "hero" || spec.role === "background" || spec.role === "enemy" || spec.role === "keyart";
      let raw;
      if (ref) {
        try {
          raw = await editImageOpenAI({ prompt, image: ref.image, aspect: spec.aspect, hq });
        } catch (e) {
          if (isSafetyRejection(e)) throw e;
          console.warn(`[forge] identity reference failed ${rec.id}, text-only fallback`, e);
          raw = await generateImage({ prompt, aspect: spec.aspect, transparent: spec.transparent, provider, hq });
        }
      } else {
        raw = await generateImage({ prompt, aspect: spec.aspect, transparent: spec.transparent, provider, hq });
      }
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

/** Anim names as shown to the image model; "hurt"/"attack" alone can trip image safety filters. */
const PROMPT_ANIM_LABEL: Record<string, string> = { hurt: "bump", attack: "action" };

function sheetPrompt(o: { subject: string; design: GameDesign; layout: SheetLayout; chroma: Chroma; withRef: boolean; extra: string; retry: string; safe?: boolean }) {
  const { layout, chroma } = o;
  const c = CHROMA[chroma];
  const rows = sheetRows(layout).map((row, r) => {
    const cells = row.map((x) => `cell ${x.col + 1}) ${PROMPT_ANIM_LABEL[x.anim] || x.anim} frame ${x.i + 1}/${x.of}: ${x.pose}`);
    for (let k = row.length; k < layout.cols; k++) cells.push(`cell ${k + 1}) EMPTY, background only`);
    return `Row ${r + 1}:\n  ${cells.join("\n  ")}`;
  });
  const view = designView(o.design, [o.subject, o.extra].filter(Boolean).join("\n"));
  const [W, H] = openaiSize(sheetAspect(layout)).split("x").map(Number);
  const cw = Math.round(W / layout.cols);
  const ch = Math.round(H / layout.rows);
  const stand = Math.round(Math.min(ch * 0.7, cw * 1.6));
  return [
    `2D game sprite sheet: ${o.withRef ? "the EXACT same character as the reference image (identical proportions, colors, outfit, accessories, line and shading style)" : "one single consistent character"}.`,
    o.withRef ? sheetIdentityLine(view) : "",
    `Layout: a strict grid of ${layout.rows} rows x ${layout.cols} columns of equal cells (${W}x${H} px canvas, each cell ${cw}x${ch} px) on a perfectly flat solid ${c.label} (${c.hex}) background — that one flat color everywhere, including gaps between legs, arms and tail.`,
    `SCALE: one constant body scale in every cell. Standing, the character is about ${stand} px from the top of the head to the soles, and the head, torso, hands and feet keep exactly the same pixel size in every frame. A crouch, slide or lunge is shorter or wider than standing — never enlarged to fill its cell. Keep the feet of grounded poses on the same baseline near the bottom of each cell.`,
    `MARGINS: each figure stays fully inside its own cell with at least ${Math.round(Math.min(cw, ch) * 0.08)} px of empty ${c.label} on all four sides. No hair, glove, foot, weapon or effect touches a cell edge or crosses into the next cell. A wide pose is drawn more compact, not cut off.`,
    sheetViewLine(view),
    "Each animation reads left to right as consecutive frames: neighbouring frames of a cycle MUST show clearly different leg and arm positions exactly as described (never the same stride repeated).",
    `FORBIDDEN: grid lines, cell borders, divider strokes, frames around cells, labels, text, numbers, ground, cast shadows, dust clouds, speed lines, motion trails, any ${c.label} on the character.`,
    ...rows,
    `Character: ${o.subject}.`,
    o.safe
      ? `Art style: wholesome, family-friendly cartoon game art for all ages, matching the reference. Palette: ${o.design.palette.join(", ")}.`
      : `Art style: ${o.design.artStyle}. Palette: ${o.design.palette.join(", ")}.`,
    o.extra && !o.safe ? `Direction: ${o.extra}.` : "",
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
  const anims = fluidCycles(sheet.anims);
  sheet.anims = anims;
  await patchAsset(projectId, rec.id, { status: "generating", error: undefined, spec: { ...spec, sheet: { ...sheet, anims } } });
  const layout = sheetLayout(anims);
  const aspect = sheetAspect(layout);
  let spentUsd = 0;
  let spentMs = 0;
  let calls = 0;
  let lastErr = "";
  try {
    const baseBuf = await readProjectFile(projectId, base.file);
    const chroma = await pickChroma(baseBuf);
    const ref = provider === "openai" ? await sheetReference(baseBuf, chroma) : null;
    // Every clip of this character is packed at the still image's body size, so switching clips never resizes the sprite.
    const still = await measureStill(baseBuf);
    let best: { data: Buffer; reasons: string[]; layout: SheetLayout } | null = null;
    let safe = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw;
      const mk = (withRef: boolean) =>
        sheetPrompt({ subject: baseSpec.prompt, design, layout, chroma, withRef, extra: spec.prompt, retry: lastErr, safe });
      const textOnly = () => generateImage({ prompt: mk(false), aspect, transparent: false, provider, hq: true });
      try {
        if (ref) {
          try {
            raw = await editImageOpenAI({ prompt: mk(true), image: ref, aspect, hq: true });
          } catch (e) {
            if (isSafetyRejection(e) && !safe) throw e;
            console.warn(`[forge] sheet edit failed ${rec.id}, text-only fallback`, e);
            raw = await textOnly();
          }
        } else {
          raw = await textOnly();
        }
      } catch (e) {
        if (!isSafetyRejection(e)) throw e;
        if (!safe) {
          console.warn(`[forge] sheet ${rec.id} blocked by image safety filter, retrying with a softened prompt`);
          safe = true;
          attempt--;
          continue;
        }
        if (best) break;
        await fail(projectId, rec, "El filtro de seguridad de OpenAI bloqueó el spritesheet; el personaje usa animación procedural. Puedes regenerarlo con otra descripción.", "skipped");
        return { provider, label: `sheet:${rec.id}`, estimatedUsd: spentUsd, ms: spentMs, images: calls };
      }
      calls++;
      spentUsd += raw.estimatedUsd;
      spentMs += raw.ms;
      const out = await processSheet(raw.data, sheet.anims, { chroma, ref: still });
      if (!best || out.reasons.length < best.reasons.length) best = { data: out.data, reasons: out.reasons, layout: out.layout };
      if (!out.reasons.length) break;
      lastErr = out.reasons.join("; ");
      console.warn(`[forge] sheet QA failed ${rec.id} attempt ${attempt + 1}: ${lastErr}`);
    }
    const done = await finish(projectId, rec, "png", best!.data, "image/png", provider === "openai" ? "OpenAI" : "MiniMax");
    if (done) await patchAsset(projectId, rec.id, { spec: withSheetNorm(withSheetRev(done.spec as ImageAssetSpec, done.rev), done.rev, best!.layout) });
    if (best!.reasons.length) await patchAsset(projectId, rec.id, { error: `QA débil: ${best!.reasons.join("; ")}`.slice(0, 300) });
    await harmonizeClips(projectId, sheet.of);
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
    return { provider: "elevenlabs", label: `audio:${rec.id}`, estimatedUsd: result.estimatedUsd, ms: result.ms, audioSec: result.audioSec, credits: result.credits };
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
