import sharp, { type OverlayOptions } from "sharp";
import { cellPad, CLIP_CELL, sheetLayout, sheetRows, STAND_FILL, type SheetAnimSpec, type SheetLayout } from "./sheets";

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
  /** Frames that faced the other way and were mirrored to match the still. */
  mirrored: number;
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

/** Silhouette of the approved still image. Every clip of that character is scaled to the same body size. */
export interface SheetRef {
  height: number;
  area: number;
  /** Colour of each half of the still, to tell which way a frame faces. */
  sides?: Sides;
}

type Sides = { L: number[]; R: number[] };
const SIDE_BINS = 4;

/**
 * Alpha-weighted colour histogram of the left and right half of a silhouette, split at its body centre.
 * A face, visor, backpack or weapon sits on one side, so the halves tell the facing whatever the pose.
 */
function sidesOf(px: Buffer, w: number, b: { x0: number; y0: number; x1: number; y1: number }): Sides {
  const cx = bodyCenterX(px, w, b);
  const n = SIDE_BINS ** 3;
  const L = new Array<number>(n).fill(0), R = new Array<number>(n).fill(0);
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const i = (y * w + x) * 4;
      const a = px[i + 3];
      if (a <= 24) continue;
      const bin = ((px[i] * SIDE_BINS) >> 8) * SIDE_BINS * SIDE_BINS + ((px[i + 1] * SIDE_BINS) >> 8) * SIDE_BINS + ((px[i + 2] * SIDE_BINS) >> 8);
      (x < cx ? L : R)[bin] += a;
    }
  }
  const norm = (v: number[]) => {
    const t = v.reduce((s, x) => s + x, 0) || 1;
    return v.map((x) => x / t);
  };
  return { L: norm(L), R: norm(R) };
}

const sideDist = (a: number[], b: number[]) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);

/** The frame's halves match the still's halves swapped: it was drawn facing the other way. */
function facesAway(frame: Sides, still: Sides) {
  const same = sideDist(frame.L, still.L) + sideDist(frame.R, still.R);
  const flip = sideDist(frame.L, still.R) + sideDist(frame.R, still.L);
  // Correct frames score from ~0.9 up (arms flung out, a dizzy wobble); a turned-around frame scores ~0.2-0.4.
  return flip < same * 0.6;
}

export async function measureStill(buf: Buffer): Promise<SheetRef | null> {
  const { data, w, h } = await toRaw(buf);
  const b = alphaBox(data, w, 0, 0, w, h);
  return b ? { height: b.y1 - b.y0 + 1, area: b.area, sides: sidesOf(data, w, b) } : null;
}

/**
 * Erase straight separator lines the model drew between cells despite the prompt.
 * A column is a separator when an opaque run covers almost the whole height, the run is a few pixels wide,
 * and the columns beside it are mostly empty — a pole held by a character never has empty sides.
 */
function stripGridLines(px: Buffer, w: number, h: number) {
  const longRun = (n: number, at: (k: number) => number) => {
    let best = 0, cur = 0;
    for (let k = 0; k < n; k++) {
      if (px[at(k) + 3] > 40) best = Math.max(best, ++cur);
      else cur = 0;
    }
    return best;
  };
  const strip = (len: number, span: number, at: (line: number, k: number) => number) => {
    const count: number[] = new Array(len).fill(0);
    const hit: boolean[] = new Array(len).fill(false);
    for (let l = 0; l < len; l++) {
      for (let k = 0; k < span; k++) if (px[at(l, k) + 3] > 40) count[l]++;
      hit[l] = count[l] >= span * 0.9 && longRun(span, (k) => at(l, k)) >= span * 0.85;
    }
    const maxWidth = Math.max(6, Math.round(len * 0.006));
    for (let l = 0; l < len; l++) {
      if (!hit[l]) continue;
      let e = l;
      while (e + 1 < len && hit[e + 1]) e++;
      const before = l - 3 >= 0 ? count[l - 3] : 0;
      const after = e + 3 < len ? count[e + 3] : 0;
      if (e - l + 1 <= maxWidth && before < span * 0.35 && after < span * 0.35) {
        for (let x = Math.max(0, l - 1); x <= Math.min(len - 1, e + 1); x++) for (let k = 0; k < span; k++) px[at(x, k) + 3] = 0;
      }
      l = e;
    }
  };
  strip(w, h, (x, y) => (y * w + x) * 4);
  strip(h, w, (y, x) => (y * w + x) * 4);
}

/**
 * Keep the character and what belongs to it inside one cell; drop specks, stray strokes and thin
 * line fragments (cut-off grid lines, a sliver of the neighbouring frame) that would show as lines in game.
 */
function cleanRect(px: Buffer, w: number, r: { x0: number; y0: number; x1: number; y1: number }) {
  const rw = r.x1 - r.x0;
  const rh = r.y1 - r.y0;
  if (rw <= 0 || rh <= 0) return;
  const label = new Int32Array(rw * rh);
  const comps: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start]) continue;
    const sx = start % rw, sy = (start / rw) | 0;
    if (px[((r.y0 + sy) * w + r.x0 + sx) * 4 + 3] < 24) continue;
    const id = comps.length + 1;
    const c = { area: 0, x0: sx, y0: sy, x1: sx, y1: sy };
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % rw, y = (k / rw) | 0;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
        const nk = ny * rw + nx;
        if (label[nk] || px[((r.y0 + ny) * w + r.x0 + nx) * 4 + 3] < 24) continue;
        label[nk] = id;
        stack.push(nk);
      }
    }
    comps.push(c);
  }
  if (comps.length < 2) return;
  const main = Math.max(...comps.map((c) => c.area));
  // Detached details the pose wants (dizzy stars, sweat drops, sparks) stay; dust specks, thin strokes and
  // slivers of the neighbouring frame cut by the cell edge go.
  const keep = comps.map((c) => {
    if (c.area === main) return true;
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    const thin = Math.min(cw, ch) <= Math.max(3, Math.round(Math.min(rw, rh) * 0.008)) && Math.max(cw, ch) >= Math.min(cw, ch) * 8;
    const edge = c.x0 === 0 || c.y0 === 0 || c.x1 === rw - 1 || c.y1 === rh - 1;
    if (thin || c.area < Math.max(24, main * 0.003)) return false;
    return !(edge && c.area < main * 0.1);
  });
  for (let k = 0; k < label.length; k++) {
    const id = label[k];
    if (id && !keep[id - 1]) px[((r.y0 + ((k / rw) | 0)) * w + r.x0 + (k % rw)) * 4 + 3] = 0;
  }
}

/**
 * Turn a generated sheet (chroma background, roughly gridded) into a strict grid:
 * fixed square cells, feet on a shared baseline, body centred, a transparent gutter on every side.
 * With `ref` (the still image), every clip of that character gets the same body scale: the median
 * silhouette area of the clip matches the still's area at STAND_FILL of the cell. Without it, the
 * tallest frame fills the cell (legacy behaviour, one scale per clip).
 */
export async function processSheet(
  input: Buffer,
  anims: SheetAnimSpec[],
  /** `exact`: the input is already a strict grid (a stored clip being repacked), so cells are split evenly. */
  /** `facing`: every frame must face like the still (side and isometric facing clips); frames drawn the other way are mirrored. */
  o: { chroma: Chroma; keyed?: boolean; ref?: SheetRef | null; cell?: number; exact?: boolean; facing?: boolean },
): Promise<ProcessedSheet> {
  const layout = sheetLayout(anims, o.cell || (o.ref ? CLIP_CELL : undefined));
  const grid = sheetRows(layout);
  const cells = grid.flat();
  let img = await toRaw(input);
  if (!o.keyed) img = keySheet(img, o.chroma);
  const { data: px, w, h } = img;
  stripGridLines(px, w, h);

  const rowProfile: number[] = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) rowProfile[y]++;
  let irregular = 0;
  let rows = o.exact
    ? null
    : fitSegments(
        segments(rowProfile, Math.max(2, w * 0.002), Math.round(h * 0.02)).filter((s) => s.e - s.s > h * 0.03),
        layout.rows,
      );
  if (!rows) {
    if (!o.exact) irregular++;
    rows = Array.from({ length: layout.rows }, (_, r) => ({ s: Math.round((r * h) / layout.rows), e: Math.round(((r + 1) * h) / layout.rows) - 1, mass: 0 }));
  }

  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let r = 0; r < layout.rows; r++) {
    const want = grid[r].length;
    const y0 = rows[r].s;
    const y1 = rows[r].e + 1;
    const colProfile: number[] = new Array(w).fill(0);
    for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) colProfile[x]++;
    let cols = o.exact
      ? null
      : fitSegments(
          segments(colProfile, 1, Math.round(w * 0.008)).filter((s) => s.mass > (y1 - y0) * 2),
          want,
        );
    if (!cols) {
      if (!o.exact) irregular++;
      const cw = w / layout.cols;
      cols = Array.from({ length: want }, (_, c) => ({ s: Math.round(c * cw), e: Math.round((c + 1) * cw) - 1, mass: 0 }));
    }
    for (const c of cols) rects.push({ x0: c.s, y0, x1: c.e + 1, y1 });
  }

  for (const r of rects) cleanRect(px, w, r);
  const boxes = rects.map((r) => alphaBox(px, w, r.x0, r.y0, r.x1, r.y1));
  const cell = layout.cell;
  const pad = cellPad(cell);
  const room = cell - pad * 2;
  const live = boxes.filter((b): b is NonNullable<typeof b> => !!b);
  const maxH = Math.max(1, ...live.map((b) => b.y1 - b.y0 + 1));
  const maxW = Math.max(1, ...live.map((b) => b.x1 - b.x0 + 1));
  // One scale for the whole clip, never one per frame: a frame that changes size reads as the sprite popping.
  const fits = Math.min(room / maxH, room / maxW);
  let scale = Math.min(2, room / maxH, fits);
  const reasons: string[] = [];
  let fill: number | undefined;
  let refArea = 0;
  if (o.ref && live.length) {
    const areas = live.map((b) => b.area).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)] || 1;
    const stand = cell * STAND_FILL;
    refArea = o.ref.area * (stand / Math.max(1, o.ref.height)) ** 2;
    const want = Math.sqrt(refArea / median);
    scale = Math.min(3, want, fits);
    fill = STAND_FILL;
    if (scale < want * 0.85) reasons.push("la pose no cabe en la celda al tamaño del personaje: dibújala más compacta, con el cuerpo a la misma escala que el sprite base");
  }

  const src = sharp(px, { raw: { width: w, height: h, channels: 4 } });
  const comps: OverlayOptions[] = [];
  const frames: SheetFrameInfo[] = [];
  let mirrored = 0;
  for (let k = 0; k < cells.length; k++) {
    const b = boxes[k];
    const meta = cells[k];
    if (!b) {
      frames.push({ anim: meta.anim, i: meta.i, w: 0, h: 0, area: 0, hollow: 1, feet: 0 });
      continue;
    }
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    // With a reference, each frame is brought to the still's body area too: the model (or an older pipeline)
    // often draws one frame of a clip larger or smaller than its neighbours. The clamp keeps a pose that
    // really covers more or less of the body (arms tucked, effects) close to the clip scale.
    const own = refArea ? Math.sqrt(refArea / Math.max(1, b.area)) : scale;
    const s = refArea ? Math.min(Math.max(own, scale * 0.7), scale * 1.45, room / bw, room / bh) : scale;
    const nw = Math.max(1, Math.min(room, Math.round(bw * s)));
    const nh = Math.max(1, Math.min(room, Math.round(bh * s)));
    // The image model sometimes turns half a cycle around ("the other leg" read as "mirror the character").
    const mirror = !!(o.facing && o.ref?.sides && facesAway(sidesOf(px, w, b), o.ref.sides));
    if (mirror) mirrored++;
    const bodyX = (bodyCenterX(px, w, b) - b.x0) * s;
    const cx = mirror ? nw - bodyX : bodyX;
    const left = Math.max(pad, Math.min(cell - pad - nw, Math.round(cell / 2 - cx)));
    const top = Math.max(pad, cell - pad - nh);
    let cut = src.clone().extract({ left: b.x0, top: b.y0, width: bw, height: bh }).resize(nw, nh, { kernel: "lanczos3" });
    if (mirror) cut = cut.flop();
    const piece = await cut.raw().toBuffer();
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

  const areas = frames.map((f) => f.area).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] || 0;
  for (const f of frames) if (f.area < median * 0.25) reasons.push(`frame ${f.anim}#${f.i + 1} vacío o incompleto`);
  // Only upright poses: a lunge, punch or dizzy wobble leaves its bounding box legitimately empty inside.
  const standing = (anim: string) => /^(idle|walk|run)(_back)?$/.test(anim);
  const upright = frames.filter((f) => standing(f.anim));
  const hollows = upright.map((f) => f.hollow).sort((a, b) => a - b);
  if ((hollows[Math.floor(hollows.length / 2)] ?? 0) > 0.42) reasons.push("siluetas vaciadas por el recorte");
  const grounded = frames.filter((f) => standing(f.anim) && f.h > 0).map((f) => f.h);
  if (grounded.length > 1 && Math.max(...grounded) / Math.min(...grounded) > 1.45) reasons.push("escala inconsistente entre frames");
  // Same area but a different height means the model redrew the proportions (chibi, stretched): not the same character.
  if (fill && grounded.length) {
    const tall = Math.max(...grounded) / (cell * fill);
    if (tall < 0.78 || tall > 1.22) reasons.push("el personaje no mantiene las proporciones del sprite base (cabeza, piernas y torso al mismo tamaño)");
  }
  if (irregular > Math.max(1, layout.rows / 2)) reasons.push("la grilla no respeta las filas/columnas pedidas");
  // A walk/run that never closes the legs (no passing pose) reads as a two-frame wobble in game.
  for (const a of layout.anims) {
    if (!/^(walk|run)(_back)?$/.test(a.name) || a.frames < 3) continue;
    const spans = frames.filter((f) => f.anim === a.name && f.feet > 0).map((f) => f.feet);
    if (spans.length >= 3 && Math.max(...spans) / Math.min(...spans) < 1.08) {
      reasons.push(`el ciclo ${a.name} repite la misma zancada en todos los frames (falta la pose de paso con las piernas juntas)`);
    }
  }

  return { data, layout: { ...layout, fill }, frames, irregular, reasons, mirrored };
}

/** Copy one animation's cells out of a normalized combined sheet into that clip's own grid. */
export async function repackClip(png: Buffer, source: SheetAnimSpec[], anim: SheetAnimSpec): Promise<Buffer | null> {
  const src = sheetLayout(source);
  const dest = sheetLayout([anim]);
  const cell = src.cell;
  const meta = await sharp(png).metadata();
  if (!meta.width || !meta.height || meta.width < src.cols * cell || meta.height < src.rows * cell) return null;
  const from = src.anims.find((a) => a.name === anim.name);
  if (!from || from.frames < anim.frames) return null;
  const comps: OverlayOptions[] = [];
  for (let i = 0; i < anim.frames; i++) {
    const at = from.start + i;
    const input = await sharp(png)
      .extract({ left: (at % src.cols) * cell, top: Math.floor(at / src.cols) * cell, width: cell, height: cell })
      .png()
      .toBuffer();
    const to = i;
    comps.push({ input, left: (to % dest.cols) * cell, top: Math.floor(to / dest.cols) * cell });
  }
  return sharp({
    create: { width: dest.cols * cell, height: dest.rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(comps)
    .png()
    .toBuffer();
}
