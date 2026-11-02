import type { ImageAssetSpec } from "./types";

export const SHEET_ANIMS = ["idle", "walk", "run", "jump", "fall", "land", "slide", "dash", "attack", "hurt"] as const;
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
export const SHEET_MAX_FRAMES = 16;
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
    frames: 6,
    fps: 8,
    loop: true,
    poses: [
      "CONTACT: near leg reaching forward with heel touching the ground, far leg stretched behind on its toes (widest stride), far arm swings forward",
      "DOWN: body at its lowest, weight over the front foot, back foot just leaving the ground",
      "PASSING: legs together under the body — far leg swinging forward past the planted near leg with its knee lifted, body at its highest, arms close to the body",
      "CONTACT MIRRORED: now the FAR leg reaches forward heel-down and the NEAR leg is stretched behind (widest stride), near arm swings forward",
      "DOWN MIRRORED: body at its lowest on the other foot",
      "PASSING MIRRORED: legs together again — near leg swinging forward past the planted far leg with its knee lifted",
    ],
  },
  run: {
    frames: 6,
    fps: 10,
    loop: true,
    poses: [
      "PUSH-OFF: strong forward lean, far leg fully extended behind pushing off, near knee driving up high",
      "PASSING: legs together under the body, near knee driving forward, arms crossing the torso",
      "FLIGHT: both feet off the ground, legs scissored, arms pumping",
      "PUSH-OFF MIRRORED: near leg extended behind pushing off, far knee driving up high",
      "PASSING MIRRORED: legs together again, far knee driving forward, arms crossing the other way",
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
  slide: {
    frames: 2,
    fps: 10,
    loop: true,
    poses: [
      "slide start: dropping into a crouch, knees folding, one hand reaching down, body getting low",
      "full slide: body flat and low, chest close to the ground, legs trailing straight behind — ducking under an overhead bar, not a forward dive",
    ],
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
      "action wind-up: tool/arm pulled back behind the body, weight on the back foot",
      "action swing: full forward swing with tool/arm extended far in front, front foot stepping in",
      "action follow-through: tool/arm past the body, recovering balance",
    ],
  },
  hurt: {
    frames: 2,
    fps: 8,
    loop: false,
    // Image safety filters reject injury/pain wording on characters; keep it a comic bump reaction.
    poses: [
      "bump reaction: comic surprised lean backwards, eyes wide, arms raised, cartoon-style (no injury)",
      "wobble: off-balance and dizzy in a funny cartoon way, one foot stepping back, arms waving for balance",
    ],
  },
};

const DEFAULT_SET: SheetAnimName[] = ["idle", "walk", "jump", "fall"];

const LOCO_FRAMES = 6;

/** Names only: one-shots stay at 2 frames and leftover cells go to run, then walk, up to 6. */
function packNamed(namesIn: string[]): SheetAnimSpec[] {
  const seen = new Set<string>();
  let names: SheetAnimName[] = [];
  for (const raw of namesIn) {
    const name = String(raw || "").toLowerCase().trim() as SheetAnimName;
    if (!(name in ANIM_DEFAULTS) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (!names.includes("idle")) names.unshift("idle");
  const oneShot = (n: SheetAnimName) => Math.min(ANIM_DEFAULTS[n].frames, 2);
  const cost = (list: SheetAnimName[], runF: number, walkF: number) =>
    list.reduce((s, n) => s + (n === "run" ? runF : n === "walk" ? walkF : oneShot(n)), 0);
  // Land and fall are polish poses. Drop them before the run cycle loses frames.
  for (const drop of ["land", "fall"] as const) {
    const runF = names.includes("run") ? LOCO_FRAMES : 2;
    const walkF = names.includes("walk") ? LOCO_FRAMES : 2;
    if (cost(names, runF, walkF) <= SHEET_MAX_FRAMES) break;
    names = names.filter((n) => n !== drop);
  }
  // A second locomotion cycle gives its cells to run when both cannot stay.
  if (names.includes("run") && names.includes("walk") && cost(names, LOCO_FRAMES, 2) > SHEET_MAX_FRAMES) {
    names = names.filter((n) => n !== "walk");
  }
  const specs: SheetAnimSpec[] = names.map((name) => ({
    name,
    frames: name === "run" || name === "walk" ? 2 : oneShot(name),
  }));
  let spare = SHEET_MAX_FRAMES - specs.reduce((s, a) => s + a.frames, 0);
  while (spare < 0 && specs.length > 1) {
    const run = specs.some((a) => a.name === "run");
    const walkAt = specs.findIndex((a) => a.name === "walk");
    if (run && walkAt >= 0) specs.splice(walkAt, 1);
    else {
      let dropAt = -1;
      for (let i = specs.length - 1; i >= 0; i--) {
        if (specs[i].name !== "idle" && specs[i].name !== "run" && specs[i].name !== "hurt") {
          dropAt = i;
          break;
        }
      }
      if (dropAt < 0) break;
      specs.splice(dropAt, 1);
    }
    spare = SHEET_MAX_FRAMES - specs.reduce((s, a) => s + a.frames, 0);
  }
  for (const name of ["run", "walk"] as const) {
    const anim = specs.find((a) => a.name === name);
    if (!anim || spare <= 0) continue;
    const add = Math.min(LOCO_FRAMES - anim.frames, spare);
    anim.frames += add;
    spare -= add;
  }
  return specs;
}

/** Clamp an anim list to known names, fixed frame counts and the sheet's frame budget. */
export function normalizeSheetAnims(input: (string | Partial<SheetAnimSpec>)[] | undefined): SheetAnimSpec[] {
  const source = input?.length ? input : DEFAULT_SET;
  const hasExplicit = source.some((it) => typeof it === "object" && !!it && typeof it.frames === "number");
  if (!hasExplicit) return packNamed(source.map((it) => (typeof it === "string" ? it : String(it?.name || ""))));
  const seen = new Set<string>();
  const out: SheetAnimSpec[] = [];
  let total = 0;
  for (const it of source) {
    const name = String(typeof it === "string" ? it : it?.name || "").toLowerCase().trim() as SheetAnimName;
    if (!(name in ANIM_DEFAULTS) || seen.has(name)) continue;
    const want = typeof it === "object" && it?.frames ? Math.round(it.frames) : ANIM_DEFAULTS[name].frames;
    const frames = Math.max(1, Math.min(8, want));
    if (total + frames > SHEET_MAX_FRAMES) continue;
    if (Math.ceil((total + frames) / SHEET_COLS) > SHEET_MAX_ROWS) continue;
    seen.add(name);
    out.push({ name, frames });
    total += frames;
  }
  if (!out.some((a) => a.name === "idle") && total < SHEET_MAX_FRAMES) out.unshift({ name: "idle", frames: Math.min(2, SHEET_MAX_FRAMES - total) });
  return out;
}

/** One clip fills its own grid with no empty cells. A shared sheet stays 4 columns so old games keep their cell map. */
export function gridFor(anims: SheetAnimSpec[]): { cols: number; aspect: "1:1" | "16:9" | "9:16" | "3:2" | "2:3" } {
  if (anims.length !== 1) {
    const frames = anims.reduce((s, a) => s + a.frames, 0);
    const rows = Math.max(1, Math.ceil(frames / SHEET_COLS));
    return { cols: SHEET_COLS, aspect: rows >= 4 ? "2:3" : "3:2" };
  }
  const n = anims[0].frames;
  if (n <= 3) return { cols: Math.max(1, n), aspect: "16:9" };
  if (n === 4) return { cols: 2, aspect: "1:1" };
  if (n <= 6) return { cols: 3, aspect: "3:2" };
  return { cols: SHEET_COLS, aspect: "3:2" };
}

export function sheetLayout(anims: SheetAnimSpec[], cell = SHEET_CELL): SheetLayout {
  const cols = gridFor(anims).cols;
  const out: SheetAnimLayout[] = [];
  let cursor = 0;
  for (const a of anims) {
    const d = ANIM_DEFAULTS[a.name];
    out.push({ name: a.name, frames: a.frames, row: Math.floor(cursor / cols), col: cursor % cols, start: cursor, fps: d.fps, loop: d.loop });
    cursor += a.frames;
  }
  return { cell, cols, rows: Math.max(1, Math.ceil(cursor / cols)), frames: cursor, anims: out };
}

/** Generation canvas. A single clip uses a tight grid; a full sheet stays tall so each cell is at least 256 px. */
export const sheetAspect = (layout: SheetLayout) => gridFor(layout.anims).aspect;

export type SheetCell = { anim: SheetAnimName; i: number; of: number; pose: string; row: number; col: number };

/** Cells per grid row, left-aligned (what the generator must draw, and where processing expects it). */
export function sheetRows(layout: SheetLayout): SheetCell[][] {
  const rows: SheetCell[][] = Array.from({ length: layout.rows }, () => []);
  for (const a of layout.anims) {
    const poses = ANIM_DEFAULTS[a.name].poses;
    for (let i = 0; i < a.frames; i++) {
      const at = a.start + i;
      const row = Math.floor(at / layout.cols);
      const col = at % layout.cols;
      rows[row].push({ anim: a.name, i, of: a.frames, pose: poses[i % poses.length], row, col });
    }
  }
  for (const r of rows) r.sort((a, b) => a.col - b.col);
  return rows;
}

const ANIM_ALIASES: [SheetAnimName, RegExp][] = [
  ["slide", /\b(slid\w*|crouch|duck|agach\w*|desliz\w*|gliss\w*)\b/i],
  ["run", /\b(run|running|correr|sprint)\b/i],
  ["walk", /\b(walk|camin\w*|marche)\b/i],
  ["jump", /\b(jump|salt\w*|saut)\b/i],
  ["dash", /\bdash\b|\baceler\w*/i],
  ["attack", /\b(attack|ataque|dispar\w*)\b/i],
  ["hurt", /\b(hurt|daño|dano)\b/i],
  ["idle", /\b(idle|reposo)\b/i],
  ["fall", /\b(fall|ca[ií]da)\b/i],
  ["land", /\b(land|aterriz\w*)\b/i],
];

/** Animation names a redraw request actually talks about. */
export function animsMentioned(text: string): SheetAnimName[] {
  const cleaned = text.replace(/\b(do not|don't|without|never|no toques|sin tocar|no cambies|excepto)\b[^.,;]{0,48}/gi, " ");
  const found: SheetAnimName[] = [];
  for (const name of SHEET_ANIMS) {
    if (new RegExp(`\\b${name}\\b`, "i").test(cleaned)) found.push(name);
  }
  for (const [name, re] of ANIM_ALIASES) if (re.test(cleaned) && !found.includes(name)) found.push(name);
  return found;
}

/** On a redraw, grow run (then walk) up to 6 frames. A one-clip sheet never gains a second animation. */
export function fluidCycles(anims: SheetAnimSpec[]): SheetAnimSpec[] {
  if (anims.length === 1) {
    const a = anims[0];
    const goal = a.name === "run" || a.name === "walk" ? Math.max(a.frames, ANIM_DEFAULTS[a.name].frames) : a.frames;
    return [{ name: a.name, frames: Math.max(1, Math.min(8, goal)) }];
  }
  const specs = anims.map((a) => ({ name: a.name, frames: a.frames }));
  const total = () => specs.reduce((s, a) => s + a.frames, 0);
  const grow = (name: SheetAnimName, donor?: SheetAnimName) => {
    const target = specs.find((a) => a.name === name);
    if (!target) return;
    const goal = ANIM_DEFAULTS[name].frames;
    while (target.frames < goal) {
      if (total() < SHEET_MAX_FRAMES) {
        target.frames++;
        continue;
      }
      const from = donor ? specs.find((a) => a.name === donor) : undefined;
      if (from && from.frames > 2) {
        from.frames--;
        target.frames++;
        continue;
      }
      break;
    }
  };
  grow("run", "walk");
  grow("walk");
  return normalizeSheetAnims(specs);
}

/** Animation list of the revision a file belongs to (`assets/x.r3.png` → revs["3"]), else the current one. */
export function sheetAnimsFor(sheet: NonNullable<ImageAssetSpec["sheet"]>, file?: string): SheetAnimSpec[] {
  const rev = file ? /\.r(\d+)\.[^.]+$/.exec(file)?.[1] : undefined;
  return (rev && sheet.revs?.[rev]) || sheet.anims;
}

export const sheetIdFor = (baseId: string) => `${baseId}_sheet`;
/** One animation, one image. Redrawing slide cannot repaint run. */
export const clipSheetId = (baseId: string, name: string) => `${baseId}_sheet_${name}`;
export const SHEET_ROLES = new Set(["hero", "enemy", "npc"]);

export function clipSpecFor(base: ImageAssetSpec, anim: SheetAnimSpec): ImageAssetSpec {
  const layout = sheetLayout([anim]);
  return {
    id: clipSheetId(base.id, anim.name),
    name: `${base.name} · ${anim.name}`,
    role: base.role,
    prompt: "",
    transparent: true,
    aspect: sheetAspect(layout),
    usage: `Animation clip "${anim.name}" of ${base.id}, ${anim.frames} frames on its own sheet. forge.phaser.animate() plays it from the ${base.id} sprite. Never draw this image as a picture.`,
    seamless: false,
    sheet: { of: base.id, anims: [anim] },
  };
}

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
