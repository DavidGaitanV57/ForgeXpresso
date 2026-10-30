import sharp from "sharp";
import type { ImageRole } from "./types";

export interface ProcessedImage {
  data: Buffer;
  ext: "png" | "jpg";
  mime: string;
  width: number;
  height: number;
}

const OPAQUE_ROLES: ImageRole[] = ["background", "texture", "portrait"];

export async function processImage(input: Buffer, o: { role: ImageRole; transparent: boolean; needsKeying: boolean }): Promise<ProcessedImage> {
  const opaque = !o.transparent || OPAQUE_ROLES.includes(o.role);
  if (opaque) {
    const max = o.role === "background" ? 1920 : 1024;
    const img = sharp(input).resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).flatten({ background: "#000" });
    const { data, info } = await img.jpeg({ quality: 88, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { data, ext: "jpg", mime: "image/jpeg", width: info.width, height: info.height };
  }

  const raw = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const info = raw.info;
  let data: Buffer = raw.data;
  // gpt-image often returns "transparent" PNGs that still have an opaque dark plate.
  // Only skip keying when there is a real cutout (meaningful fully-transparent area).
  if (o.needsKeying || !hasRealCutout(data, info.width, info.height)) {
    data = keyBackground(data, info.width, info.height);
    data = punchDarkPlate(data, info.width, info.height);
  }
  const box = alphaBounds(data, info.width, info.height);
  let pipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (box) {
    const pad = 4;
    const left = Math.max(0, box.x0 - pad);
    const top = Math.max(0, box.y0 - pad);
    const width = Math.min(info.width - left, box.x1 - box.x0 + 1 + pad * 2);
    const height = Math.min(info.height - top, box.y1 - box.y0 + 1 + pad * 2);
    pipeline = pipeline.extract({ left, top, width, height });
  }
  const max = o.role === "tile" || o.role === "platform" ? 768 : 640;
  const out = await pipeline
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, ext: "png", mime: "image/png", width: out.info.width, height: out.info.height };
}

/** True when enough pixels are fully transparent — a real sprite cutout, not soft edges on a plate. */
function hasRealCutout(px: Buffer, w: number, h: number) {
  const need = Math.max(256, Math.floor(w * h * 0.08));
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 12 && ++n >= need) return true;
  return false;
}

/** Flood-fills the flat background colour from the borders and makes it transparent, softening the fringe. */
function keyBackground(px: Buffer, w: number, h: number): Buffer {
  const out = Buffer.from(px);
  const ref = borderColor(px, w, h);
  const dist = (i: number) => {
    const dr = px[i] - ref[0];
    const dg = px[i + 1] - ref[1];
    const db = px[i + 2] - ref[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  // Magenta chroma (MiniMax) needs a wider soft edge; dark plates from GPT need a tighter hard cut.
  const lum = (ref[0] + ref[1] + ref[2]) / 3;
  const isChroma = ref[0] > 180 && ref[2] > 180 && ref[1] < 80;
  const HARD = isChroma ? 55 : lum < 40 ? 48 : 70;
  const SOFT = isChroma ? 130 : lum < 40 ? 95 : 140;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const d = dist(i);
    if (d > SOFT) continue;
    if (d <= HARD) out[i + 3] = 0;
    else {
      const a = (d - HARD) / (SOFT - HARD);
      out[i + 3] = Math.round(out[i + 3] * a);
      // Pull the chroma tint out of the anti-aliased edge.
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.max(0, Math.min(255, (px[i + c] - ref[c] * (1 - a)) / Math.max(a, 0.35))));
      continue;
    }
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return out;
}

/**
 * Second pass for GPT plates: any near-black (or flat dark) region still connected to the
 * image border after the first key becomes fully transparent. Protects glowing subjects
 * that sit on an opaque charcoal square.
 */
function punchDarkPlate(px: Buffer, w: number, h: number): Buffer {
  const out = Buffer.from(px);
  const isPlate = (i: number) => {
    if (out[i + 3] < 12) return true;
    const r = out[i],
      g = out[i + 1],
      b = out[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Dark + low saturation (charcoal plate), not saturated neon glows.
    return max < 55 && max - min < 28;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!isPlate(i)) continue;
    out[i + 3] = 0;
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return out;
}

function borderColor(px: Buffer, w: number, h: number): [number, number, number] {
  const samples: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  const take = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    // Prefer opaque border samples so leftover RGB under alpha=0 does not skew the key colour.
    if (px[i + 3] < 8) return;
    samples.push([px[i], px[i + 1], px[i + 2]]);
  };
  for (let x = 0; x < w; x += step) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    take(0, y);
    take(w - 1, y);
  }
  if (!samples.length) {
    // Fall back to any border pixel (including transparent leftovers).
    for (let x = 0; x < w; x += step) {
      const i0 = x * 4;
      const i1 = ((h - 1) * w + x) * 4;
      samples.push([px[i0], px[i0 + 1], px[i0 + 2]], [px[i1], px[i1 + 1], px[i1 + 2]]);
    }
  }
  const med = (k: 0 | 1 | 2) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
  return [med(0), med(1), med(2)];
}

function alphaBounds(px: Buffer, w: number, h: number) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export async function imageInfo(buf: Buffer) {
  const m = await sharp(buf).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0, format: m.format };
}

/** Re-run cutout on an existing sprite PNG (for assets generated before the keying fix). */
export async function rekeySprite(input: Buffer, role: ImageRole = "prop"): Promise<ProcessedImage> {
  return processImage(input, { role, transparent: true, needsKeying: true });
}

export interface ImageQaResult {
  ok: boolean;
  reasons: string[];
  /** 0 = perfect left/right match, 1 = totally different. */
  seamError?: number;
  /** Fraction of opaque edge ring that looks like baked scenery (nebula/clouds). */
  sceneryEdge?: number;
  /** Fraction of the full-frame margin that is still opaque (rectangular plate). */
  borderOpaque?: number;
  /** Fully transparent pixel ratio. */
  transparentRatio?: number;
}

/** Horizontal wrap seam error (0 perfect … 1 bad) for seamless tiles / parallax layers. */
export async function horizontalSeamError(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .resize(256, 144, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let n = 0;
  const band = 2;
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < band; k++) {
      const iL = (y * w + k) * 3;
      const iR = (y * w + (w - 1 - k)) * 3;
      for (let c = 0; c < 3; c++) {
        const d = data[iL + c] - data[iR + c];
        sum += d * d;
        n++;
      }
    }
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, n)) / 255);
}

/**
 * Detects "AI plate" sprites: opaque rectangular cutouts whose FRAME MARGIN is still
 * filled (nebula/sky) instead of true alpha. Also scores soft colourful edge fill.
 */
export async function sceneryContamination(
  buf: Buffer,
): Promise<{ transparentRatio: number; sceneryEdge: number; borderOpaque: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let a0 = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 12) a0++;
  const box = alphaBounds(data, w, h);
  if (!box) return { transparentRatio: 1, sceneryEdge: 0, borderOpaque: 0 };

  // Full-frame margin: a baked scenery plate leaves the outer pixels opaque.
  const margin = Math.max(4, Math.floor(Math.min(w, h) * 0.045));
  let border = 0;
  let borderOp = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= margin && x < w - margin && y >= margin && y < h - margin) continue;
      border++;
      if (data[(y * w + x) * 4 + 3] >= 40) borderOp++;
    }
  }

  const ring = Math.max(8, Math.floor(Math.min(box.x1 - box.x0, box.y1 - box.y0) * 0.08));
  let edge = 0;
  let soft = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const near = x - box.x0 < ring || box.x1 - x < ring || y - box.y0 < ring || box.y1 - y < ring;
      if (!near) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 40) continue;
      edge++;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      const sat = max - min;
      // Soft colourful scenery (nebula/sky) vs hard subject silhouette.
      if (lum > 35 && lum < 210 && sat > 22 && sat < 150) soft++;
    }
  }
  return {
    transparentRatio: a0 / (w * h),
    sceneryEdge: edge ? soft / edge : 0,
    borderOpaque: border ? borderOp / border : 0,
  };
}

/** QA gate used by the image agent after generation. */
export async function validateImageQa(
  buf: Buffer,
  o: { transparent: boolean; seamless?: boolean; role: ImageRole },
): Promise<ImageQaResult> {
  const reasons: string[] = [];
  let seamError: number | undefined;
  let sceneryEdge: number | undefined;
  let borderOpaque: number | undefined;
  let transparentRatio: number | undefined;

  if (o.seamless || o.role === "texture" || (o.role === "tile" && o.seamless !== false)) {
    seamError = await horizontalSeamError(buf);
    if (seamError > 0.14) reasons.push(`no es seamless (error de borde ${(seamError * 100).toFixed(0)}%)`);
  }

  // Isolation QA for subject sprites. Collectibles/UI often have soft glow halos —
  // only enforce transparentRatio + rectangular plate (borderOpaque) there.
  const subjectRoles = new Set(["hero", "enemy", "npc", "prop", "goal", "platform", "hazard"]);
  if (o.transparent && !["background", "texture", "portrait"].includes(o.role)) {
    const s = await sceneryContamination(buf);
    transparentRatio = s.transparentRatio;
    sceneryEdge = s.sceneryEdge;
    borderOpaque = s.borderOpaque;
    if (s.transparentRatio < 0.12) reasons.push(`poco alpha real (${(s.transparentRatio * 100).toFixed(0)}% transparente)`);
    // Opaque frame margin = unkeyed rectangular plate (hard vertical box in-game).
    if (s.borderOpaque > 0.12) {
      reasons.push(`placa rectangular opaca (${(s.borderOpaque * 100).toFixed(0)}% del margen)`);
    }
    // Soft nebula/sky still hugging the silhouette after keying (halo plate).
    if (subjectRoles.has(o.role) && s.sceneryEdge > 0.55) {
      reasons.push(`fondo de escena pegado al sprite (${(s.sceneryEdge * 100).toFixed(0)}% del borde)`);
    }
  }

  return { ok: reasons.length === 0, reasons, seamError, sceneryEdge, borderOpaque, transparentRatio };
}
