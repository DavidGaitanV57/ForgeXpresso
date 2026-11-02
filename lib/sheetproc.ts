import sharp, { type OverlayOptions } from "sharp";
import { sheetLayout, sheetRows, type SheetAnimSpec, type SheetLayout } from "./sheets";

export type Chroma = "magenta" | "green";
export const CHROMA: Record<Chroma, { hex: string; rgb: [number, number, number]; label: string }> = {
  magenta: { hex: "#FF00FF", rgb: [255, 0, 255], label: "pure magenta" },
  green: { hex: "#00FF00", rgb: [0, 255, 0], label: "pure green" },
};

export interface SheetFrameInfo {
  anim: string;
  i: number;
  w: number;
  h: number;
  area: number;
  hollow: number;
  feet: number;
}

export interface ProcessedSheet {
  data: Buffer;
  layout: SheetLayout;
  frames: SheetFrameInfo[];
  /** Rows/cells where the detected grid didn't match and an even split was used. */
  irregular: number;
  reasons: string[];
}

type Raw = { data: Buffer; w: number; h: number };

async function toRaw(buf: Buffer): Promise<Raw> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function hue(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (!d) return { h: 0, s: 0, v: mx / 255 };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: d / mx, v: mx / 255 };
}

/** Chroma key least present on the character (a magenta scarf must not be keyed out). */
export async function pickChroma(ref: Buffer): Promise<Chroma> {
  const { data } = await sharp(ref).ensureAlpha().resize(160, 160, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let mag = 0;
  let grn = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const { h, s, v } = hue(data[i], data[i + 1], data[i + 2]);
    if (s < 0.35 || v < 0.3) continue;
    if (h >= 270 && h <= 350) mag++;
    else if (h >= 75 && h <= 165) grn++;
  }
  return mag > grn ? "green" : "magenta";
}

function dominance(c: Chroma, r: number, g: number, b: number) {
  return c === "magenta" ? Math.min(r, b) - g : g - Math.max(r, b);
}

/** Global chroma key (safe because the chroma was chosen to be absent from the subject) + edge despill. */
function keySheet(img: Raw, chroma: Chroma): Raw {
  const { data, w, h } = img;
  const px = Buffer.from(data);
  let rr = 0, gg = 0, bb = 0, n = 0;
  const [cr, cg, cb] = CHROMA[chroma].rgb;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const d = Math.hypot(px[i] - cr, px[i + 1] - cg, px[i + 2] - cb);
    if (d > 150) return;
    rr += px[i];
    gg += px[i + 1];
    bb += px[i + 2];
    n++;
  };
  for (let x = 0; x < w; x += 2) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    sample(0, y);
    sample(w - 1, y);
  }
  const ref = n > 20 ? [rr / n, gg / n, bb / n] : [cr, cg, cb];
  const HARD = 70;
  const SOFT = 150;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const d = Math.hypot(r - ref[0], g - ref[1], b - ref[2]);
    const dom = dominance(chroma, r, g, b);
    if (d < HARD || dom > 170) px[i + 3] = 0;
    else if (d < SOFT && dom > 50) px[i + 3] = Math.min(px[i + 3], Math.round((255 * (d - HARD)) / (SOFT - HARD)));
  }
  // Despill: soft pixels and the first opaque ring around holes lose the chroma cast.
  const despill = (i: number) => {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const ex = dominance(chroma, r, g, b);
    if (ex <= 0) return;
    if (chroma === "magenta") {
      px[i] = Math.max(0, r - ex * 0.85);
      px[i + 2] = Math.max(0, b - ex * 0.85);
    } else px[i + 1] = Math.max(0, g - ex * 0.85);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      if (a === 0) continue;
      if (a < 255) {
        despill(i);
        continue;
      }
      const near =
        (x > 0 && px[i - 4 + 3] < 200) || (x < w - 1 && px[i + 4 + 3] < 200) || (y > 0 && px[i - w * 4 + 3] < 200) || (y < h - 1 && px[i + w * 4 + 3] < 200);
      if (near) despill(i);
    }
  }
  return { data: px, w, h };
}

type Seg = { s: number; e: number; mass: number };

function segments(profile: number[], minVal: number, minGap: number): Seg[] {
  const out: Seg[] = [];
  let cur: Seg | null = null;
  let gap = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > minVal) {
      if (cur && gap < minGap) cur.e = i;
      else {
        cur = { s: i, e: i, mass: 0 };
        out.push(cur);
      }
      cur.mass += profile[i];
      gap = 0;
    } else if (cur) gap++;
  }
  return out;
}

/** Merge lightest fragments (slash fx, dust) into their nearest neighbour until `want` remain. */
function fitSegments(segs: Seg[], want: number): Seg[] | null {
  const s = segs.map((x) => ({ ...x }));
  while (s.length > want) {
    let k = 0;
    for (let i = 1; i < s.length; i++) if (s[i].mass < s[k].mass) k = i;
    const left = k > 0 ? s[k].s - s[k - 1].e : Infinity;
    const right = k < s.length - 1 ? s[k + 1].s - s[k].e : Infinity;
    const j = left <= right ? k - 1 : k + 1;
    const a = Math.min(j, k);
    const merged = { s: s[a].s, e: s[a + 1].e, mass: s[a].mass + s[a + 1].mass };
    s.splice(a, 2, merged);
  }
  return s.length === want ? s : null;
}

function alphaBox(px: Buffer, w: number, x0: number, y0: number, x1: number, y1: number) {
  let bx0 = x1, by0 = y1, bx1 = -1, by1 = -1, area = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (px[(y * w + x) * 4 + 3] < 24) continue;
      area++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  }
  return bx1 < 0 ? null : { x0: bx0, y0: by0, x1: bx1, y1: by1, area };
}

/** Body anchor: alpha-weighted x centroid of the lower 60% (ignores a scarf/sword flying sideways). */
function bodyCenterX(px: Buffer, w: number, b: { x0: number; y0: number; x1: number; y1: number }) {
  const yStart = Math.round(b.y0 + (b.y1 - b.y0) * 0.4);
  let sx = 0, sa = 0;
  for (let y = yStart; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const a = px[(y * w + x) * 4 + 3];
      sx += x * a;
      sa += a;
    }
  }
  return sa ? sx / sa : (b.x0 + b.x1) / 2;
}

/** Width of the feet band (bottom 12% of the silhouette) relative to its height. */
function feetSpan(px: Buffer, w: number, h: number) {
  const b = alphaBox(px, w, 0, 0, w, h);
  if (!b) return 0;
  const band = Math.max(3, Math.round((b.y1 - b.y0) * 0.12));
  let x0 = w, x1 = -1;
  for (let y = b.y1 - band; y <= b.y1; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] < 100) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return x1 < 0 ? 0 : (x1 - x0) / Math.max(1, b.y1 - b.y0);
}

function hollowRatio(px: Buffer, w: number, h: number) {
  const b = alphaBox(px, w, 0, 0, w, h);
  if (!b) return 1;
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bw < 16 || bh < 16) return 0;
  const ix = Math.max(2, Math.floor(bw * 0.18));
  const iy = Math.max(2, Math.floor(bh * 0.18));
  let n = 0, hol = 0;
  for (let y = b.y0 + iy; y <= b.y1 - iy; y++) {
    for (let x = b.x0 + ix; x <= b.x1 - ix; x++) {
      n++;
      if (px[(y * w + x) * 4 + 3] < 40) hol++;
    }
  }
  return n ? hol / n : 0;
}

/**
 * Turn a generated sheet (chroma background, roughly gridded) into a strict grid:
 * fixed square cells, one global scale for every frame, feet on a shared baseline, body centred.
 */
export async function processSheet(input: Buffer, anims: SheetAnimSpec[], o: { chroma: Chroma; keyed?: boolean }): Promise<ProcessedSheet> {
  const layout = sheetLayout(anims);
  const grid = sheetRows(layout);
  const cells = grid.flat();
  let img = await toRaw(input);
  if (!o.keyed) img = keySheet(img, o.chroma);
  const { data: px, w, h } = img;

  const rowProfile: number[] = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) rowProfile[y]++;
  let irregular = 0;
  let rows = fitSegments(
    segments(rowProfile, Math.max(2, w * 0.002), Math.round(h * 0.02)).filter((s) => s.e - s.s > h * 0.03),
    layout.rows,
  );
  if (!rows) {
    irregular++;
    rows = Array.from({ length: layout.rows }, (_, r) => ({ s: Math.round((r * h) / layout.rows), e: Math.round(((r + 1) * h) / layout.rows) - 1, mass: 0 }));
  }

  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let r = 0; r < layout.rows; r++) {
    const want = grid[r].length;
    const y0 = rows[r].s;
    const y1 = rows[r].e + 1;
    const colProfile: number[] = new Array(w).fill(0);
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) colProfile[x]++;
    let cols = fitSegments(
      segments(colProfile, 1, Math.round(w * 0.008)).filter((s) => s.mass > (y1 - y0) * 2),
      want,
    );
    if (!cols) {
      irregular++;
      const cw = w / layout.cols;
      cols = Array.from({ length: want }, (_, c) => ({ s: Math.round(c * cw), e: Math.round((c + 1) * cw) - 1, mass: 0 }));
    }
    for (const c of cols) rects.push({ x0: c.s, y0, x1: c.e + 1, y1 });
  }

  const boxes = rects.map((r) => alphaBox(px, w, r.x0, r.y0, r.x1, r.y1));
  const maxH = Math.max(1, ...boxes.map((b) => (b ? b.y1 - b.y0 + 1 : 0)));
  const cell = layout.cell;
  const pad = Math.round(cell * 0.03);
  // Height drives the shared scale; a frame too wide for the cell (katana slash, dash) is shrunk on its own.
  const scale = Math.min(2, (cell - pad * 2) / maxH);

  const src = sharp(px, { raw: { width: w, height: h, channels: 4 } });
  const comps: OverlayOptions[] = [];
  const frames: SheetFrameInfo[] = [];
  for (let k = 0; k < cells.length; k++) {
    const b = boxes[k];
    const meta = cells[k];
    if (!b) {
      frames.push({ anim: meta.anim, i: meta.i, w: 0, h: 0, area: 0, hollow: 1, feet: 0 });
      continue;
    }
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const s = Math.min(scale, cell / bw);
    const nw = Math.max(1, Math.min(cell, Math.round(bw * s)));
    const nh = Math.max(1, Math.round(bh * s));
    const cx = (bodyCenterX(px, w, b) - b.x0) * s;
    const left = Math.max(0, Math.min(cell - nw, Math.round(cell / 2 - cx)));
    const top = Math.max(0, cell - pad - nh);
    const piece = await src.clone().extract({ left: b.x0, top: b.y0, width: bw, height: bh }).resize(nw, nh, { kernel: "lanczos3" }).raw().toBuffer();
    comps.push({
      input: piece,
      raw: { width: nw, height: nh, channels: 4 },
      left: meta.col * cell + left,
      top: meta.row * cell + top,
    });
    frames.push({ anim: meta.anim, i: meta.i, w: nw, h: nh, area: b.area * s * s, hollow: hollowRatio(piece, nw, nh), feet: feetSpan(piece, nw, nh) });
  }

  const data = await sharp({
    create: { width: layout.cols * cell, height: layout.rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(comps)
    .png({ compressionLevel: 9 })
    .toBuffer();

  const reasons: string[] = [];
  const areas = frames.map((f) => f.area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] || 0;
  for (const f of frames) if (f.area < median * 0.25) reasons.push(`frame ${f.anim}#${f.i + 1} vacío o incompleto`);
  const hollows = frames.map((f) => f.hollow).sort((a, b) => a - b);
  if ((hollows[Math.floor(hollows.length / 2)] ?? 0) > 0.42) reasons.push("siluetas vaciadas por el recorte");
  const grounded = frames.filter((f) => (f.anim === "idle" || f.anim === "walk" || f.anim === "run") && f.h > 0).map((f) => f.h);
  if (grounded.length > 1 && Math.max(...grounded) / Math.min(...grounded) > 1.45) reasons.push("escala inconsistente entre frames");
  if (irregular > Math.max(1, layout.rows / 2)) reasons.push("la grilla no respeta las filas/columnas pedidas");
  // A walk/run that never closes the legs (no passing pose) reads as a two-frame wobble in game.
  for (const a of layout.anims) {
    if ((a.name !== "walk" && a.name !== "run") || a.frames < 3) continue;
    const spans = frames.filter((f) => f.anim === a.name && f.feet > 0).map((f) => f.feet);
    if (spans.length >= 3 && Math.max(...spans) / Math.min(...spans) < 1.08) {
      reasons.push(`el ciclo ${a.name} repite la misma zancada en todos los frames (falta la pose de paso con las piernas juntas)`);
    }
  }

  return { data, layout, frames, irregular, reasons };
}
