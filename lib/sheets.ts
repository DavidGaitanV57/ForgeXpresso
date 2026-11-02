import type { ImageAssetSpec } from "./types";

export const SHEET_ANIMS = ["idle", "walk", "run", "jump", "fall", "land", "dash", "attack", "hurt"] as const;
export type SheetAnimName = (typeof SHEET_ANIMS)[number];

export interface SheetAnimSpec {
  name: SheetAnimName;
  frames: number;
}

export interface SheetAnimLayout extends SheetAnimSpec {
  /** Phaser frame index of the first frame (row-major over the whole grid, empty cells included). */
  start: number;
  row: number;
  col: number;
  fps: number;
  loop: boolean;
}

export interface SheetLayout {
  cell: number;
  cols: number;
  rows: number;
  frames: number;
  anims: SheetAnimLayout[];
}

export const SHEET_CELL = 256;
export const SHEET_COLS = 4;
export const SHEET_MAX_FRAMES = 14;
const SHEET_MAX_ROWS = 4;

/** Concrete per-frame poses: vague cycle names make image models repeat one stride pose. */
export const ANIM_DEFAULTS: Record<SheetAnimName, { frames: number; fps: number; loop: boolean; poses: string[] }> = {
  idle: {
    frames: 2,
    fps: 4,
    loop: true,
    poses: ["standing relaxed, feet apart under the body, weight centered, arms down", "same stance breathing in: chest and shoulders slightly raised, ears/hair/scarf/tail drifting"],
  },
  walk: {
    frames: 4,
    fps: 9,
    loop: true,
    poses: [
      "CONTACT: near leg reaching forward with heel touching the ground, far leg stretched behind on its toes (widest stride), far arm swings forward",
      "PASSING: legs together under the body — far leg swinging forward past the planted near leg with its knee lifted, body at its highest, arms close to the body",
      "CONTACT MIRRORED: now the FAR leg reaches forward heel-down and the NEAR leg is stretched behind (widest stride), near arm swings forward",
      "PASSING MIRRORED: legs together again — near leg swinging forward past the planted far leg with its knee lifted",
    ],
  },
  run: {
    frames: 4,
    fps: 13,
    loop: true,
    poses: [
      "PUSH-OFF: strong forward lean, far leg fully extended behind pushing off, near knee driving up high",
      "FLIGHT: both feet off the ground, legs scissored, arms pumping",
      "PUSH-OFF MIRRORED: near leg extended behind pushing off, far knee driving up high",
      "FLIGHT MIRRORED: both feet off the ground, legs scissored the other way",
    ],
  },
  jump: {
    frames: 2,
    fps: 10,
    loop: false,
    poses: [
      "jump take-off: legs extending explosively from a crouch, body launching upward, arms swinging up",
      "rising jump: knees tucked up toward the chest, arms raised, body stretched upward",
    ],
  },
  fall: {
    frames: 2,
    fps: 6,
    loop: true,
    poses: [
      "falling: legs extended downward ready to land, arms spread up for balance, hair/scarf/tail blown upward",
      "falling flutter: same falling pose with arms and legs slightly shifted and hair/scarf/tail flapping in the other direction",
    ],
  },
  land: {
    frames: 2,
    fps: 14,
    loop: false,
    poses: ["landing impact: knees deeply bent, body low, arms forward absorbing the impact", "landing recover: rising from the crouch back toward standing"],
  },
  dash: {
    frames: 2,
    fps: 14,
    loop: true,
    poses: ["dash start: body low and leaning hard forward, back leg pushing off", "dash: full horizontal lunge, body stretched forward at maximum reach, trailing leg extended behind"],
  },
  attack: {
    frames: 2,
    fps: 12,
    loop: false,
    poses: [
      "attack wind-up: weapon/arm pulled back behind the body, weight on the back foot",
      "attack strike: full forward slash with weapon/arm extended far in front, front foot stepping in",
      "attack follow-through: weapon past the body, recovering balance",
    ],
  },
  hurt: {
    frames: 2,
    fps: 8,
    loop: false,
    poses: ["hurt recoil: flinching backwards, head thrown back, arms up", "hurt stagger: hunched and off-balance, one foot stepping back"],
  },
};

const DEFAULT_SET: SheetAnimName[] = ["idle", "walk", "jump", "fall"];

/** Clamp an anim list to known names, fixed frame counts and the sheet's frame budget. */
export function normalizeSheetAnims(input: (string | Partial<SheetAnimSpec>)[] | undefined): SheetAnimSpec[] {
  const seen = new Set<string>();
  const out: SheetAnimSpec[] = [];
  let total = 0;
  for (const it of input?.length ? input : DEFAULT_SET) {
    const name = String(typeof it === "string" ? it : it?.name || "").toLowerCase().trim() as SheetAnimName;
    if (!(name in ANIM_DEFAULTS) || seen.has(name)) continue;
    const want = typeof it === "object" && it?.frames ? Math.round(it.frames) : ANIM_DEFAULTS[name].frames;
    const frames = Math.max(1, Math.min(SHEET_COLS, want));
    if (total + frames > SHEET_MAX_FRAMES) continue;
    const trial = [...out, { name, frames }];
    if (packRows(trial).length > SHEET_MAX_ROWS) continue;
    seen.add(name);
    out.push({ name, frames });
    total += frames;
  }
  if (!out.some((a) => a.name === "idle") && total < SHEET_MAX_FRAMES) out.unshift({ name: "idle", frames: Math.min(2, SHEET_MAX_FRAMES - total) });
  return out;
}

/** First-fit rows: an animation never wraps across rows (models read each row as one strip). */
function packRows(anims: SheetAnimSpec[]) {
  const rows: SheetAnimSpec[][] = [];
  const used: number[] = [];
  for (const a of anims) {
    let r = used.findIndex((n) => n + a.frames <= SHEET_COLS);
    if (r < 0) {
      rows.push([]);
      used.push(0);
      r = rows.length - 1;
    }
    rows[r].push(a);
    used[r] += a.frames;
  }
  return rows;
}

export function sheetLayout(anims: SheetAnimSpec[], cell = SHEET_CELL): SheetLayout {
  const rows = packRows(anims);
  const cols = Math.min(SHEET_COLS, Math.max(1, ...rows.map((r) => r.reduce((n, a) => n + a.frames, 0))));
  const out: SheetAnimLayout[] = [];
  rows.forEach((row, r) => {
    let col = 0;
    for (const a of row) {
      const d = ANIM_DEFAULTS[a.name];
      out.push({ name: a.name, frames: a.frames, row: r, col, start: r * cols + col, fps: d.fps, loop: d.loop });
      col += a.frames;
    }
  });
  const order = new Map(anims.map((a, i) => [a.name, i]));
  out.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  return { cell, cols, rows: Math.max(1, rows.length), frames: out.reduce((n, a) => n + a.frames, 0), anims: out };
}

/** Generation canvas: tall 2:3 for 4 rows keeps each source cell at least 256 px high. */
export const sheetAspect = (layout: SheetLayout) => (layout.rows >= 4 ? ("2:3" as const) : ("3:2" as const));

export type SheetCell = { anim: SheetAnimName; i: number; of: number; pose: string; row: number; col: number };

/** Cells per grid row, left-aligned (what the generator must draw, and where processing expects it). */
export function sheetRows(layout: SheetLayout): SheetCell[][] {
  const rows: SheetCell[][] = Array.from({ length: layout.rows }, () => []);
  for (const a of layout.anims) {
    const poses = ANIM_DEFAULTS[a.name].poses;
    for (let i = 0; i < a.frames; i++) {
      rows[a.row].push({ anim: a.name, i, of: a.frames, pose: poses[i % poses.length], row: a.row, col: a.col + i });
    }
  }
  for (const r of rows) r.sort((a, b) => a.col - b.col);
  return rows;
}

/** Animation list of the revision a file belongs to (`assets/x.r3.png` → revs["3"]), else the current one. */
export function sheetAnimsFor(sheet: NonNullable<ImageAssetSpec["sheet"]>, file?: string): SheetAnimSpec[] {
  const rev = file ? /\.r(\d+)\.[^.]+$/.exec(file)?.[1] : undefined;
  return (rev && sheet.revs?.[rev]) || sheet.anims;
}

export const sheetIdFor = (baseId: string) => `${baseId}_sheet`;
export const SHEET_ROLES = new Set(["hero", "enemy", "npc"]);

export function sheetSpecFor(base: ImageAssetSpec, anims: SheetAnimSpec[]): ImageAssetSpec {
  return {
    id: sheetIdFor(base.id),
    name: `${base.name} · anim`,
    role: base.role,
    prompt: "",
    transparent: true,
    aspect: "3:2",
    usage: `Animation spritesheet of ${base.id} (${anims.map((a) => a.name).join(", ")}). Use forge.phaser.animate(sprite) on the ${base.id} sprite.`,
    seamless: false,
    sheet: { of: base.id, anims },
  };
}
