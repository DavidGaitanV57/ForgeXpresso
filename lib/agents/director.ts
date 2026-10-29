import { config } from "../config";
import { generateJson } from "../providers/anthropic";
import type { Aspect, Dimension, GameDesign, ImageRole } from "../types";

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

const ROLES: ImageRole[] = ["hero", "enemy", "npc", "collectible", "hazard", "prop", "platform", "tile", "goal", "background", "texture", "ui", "portrait"];
const ASPECTS: Aspect[] = ["1:1", "16:9", "9:16", "3:2", "2:3"];

const schema = obj({
  title: str,
  tagline: str,
  genre: str,
  camera: str,
  artStyle: str,
  palette: arr(str),
  setting: str,
  hero: obj({ name: str, description: str }),
  mechanics: arr(str),
  controls: arr(obj({ input: str, action: str })),
  objective: str,
  loseCondition: str,
  levelOutline: str,
  tuning: arr(obj({ key: str, label: str, value: num, min: num, max: num })),
  cinematic: obj({ style: { type: "string", enum: ["epica", "misteriosa", "comica"] }, lines: arr(str) }),
  images: arr(
    obj({
      id: str,
      name: str,
      role: { type: "string", enum: ROLES },
      prompt: str,
      transparent: bool,
      aspect: { type: "string", enum: ASPECTS },
      usage: str,
    }),
  ),
  audio: arr(
    obj({
      id: str,
      name: str,
      kind: { type: "string", enum: ["music", "sfx", "voice"] },
      prompt: str,
      durationSec: num,
      loop: bool,
      usage: str,
    }),
  ),
  models: arr(obj({ id: str, name: str, prompt: str, usage: str })),
});

type Raw = Omit<GameDesign, "dimension" | "engine" | "assets"> & {
  images: GameDesign["assets"]["images"];
  audio: GameDesign["assets"]["audio"];
  models: GameDesign["assets"]["models"];
};

const DIM_GUIDE: Record<Dimension, string> = {
  "2d": "2D game built with Phaser 3 (side view, top-down or any 2D camera that fits the idea). Sprites are single transparent images; backgrounds are wide parallax images.",
  "2.5d": "2.5D game built with Three.js: real 3D environment with lighting, shadows and depth, gameplay constrained to a plane with a side or three-quarter camera. Characters can be billboard sprites made from transparent images or 3D models; environment uses procedural meshes with generated textures.",
  "3d": "Full 3D game built with Three.js + Rapier physics (third-person, first-person or isometric camera). Environment from procedural meshes with generated seamless textures; characters from 3D models (when available) or stylized low-poly primitives / billboards.",
};

export async function runDirector(idea: string, dimension: Dimension, opts: { models3d: boolean }) {
  const system = `You are Forge's game director. You turn a short game idea into a precise, buildable design document for an AI team:
an image artist, a sound designer (ElevenLabs), ${opts.models3d ? "a 3D modeler (text-to-3D), " : ""}and a programmer who writes the whole game in a single JS module.
Design something fun, focused and achievable as one polished vertical slice. Be specific and concrete.
Write titles, names, labels, objective, mechanics, controls, cinematic lines and usage notes in the same language as the idea (Spanish if the idea is in Spanish).
Write image/audio/model prompts in English (better generation quality).`;

  const prompt = `Idea: """${idea}"""
Dimension: ${dimension}. ${DIM_GUIDE[dimension]}

Rules:
- artStyle: one rich paragraph (English) describing a single coherent visual style (rendering technique, line/shading, lighting, mood) that every image will share.
- palette: 5-7 hex colors.
- images: 6-12 assets. ids in snake_case, unique, <=24 chars. Exactly one "hero". Include at least: hero, the main enemies or obstacles, collectibles, goal (if any), ${dimension === "2d" ? "1-3 background layers (role background, aspect 16:9; far layers first) and platform/ground tiles (role tile or platform)" : "2-4 seamless textures (role texture, aspect 1:1, e.g. ground, walls, rocks) and 1 background (role background, 16:9) used as sky/backdrop"}.
  transparent=true for sprites/characters/objects/ui; false for background, texture, portrait. Prompts describe ONLY the subject (style is appended automatically), e.g. "a red panda samurai with a tiny katana, side view facing right, full body".
  Characters/objects for 2D or billboards must be "side view facing right" (2D side games) or "three-quarter front view" (top-down/3D).
- audio: exactly 1 music (kind music, loop true, durationSec 60-90), 4-8 sfx (durationSec 0.5-3, loop false) for the core events (jump, pickup, hit, win, lose, attack… whatever fits),
  and 1 voice (id "narration", kind voice) whose prompt is the narration text of the cinematic (the cinematic lines joined, in the idea's language).
- models: ${opts.models3d && dimension !== "2d" ? "0-3 key 3D models (hero first, then main enemy/prop) as text-to-3D prompts (English, single object, game-ready, stylized, matching artStyle). Use the same id as the matching image when it represents the same entity, suffixed with _3d." : "empty array."}
- tuning: 4-8 live-tunable numbers that the player may want to tweak from the chat (e.g. playerSpeed, jumpForce, gravity, enemySpeed, spawnRate, timeLimit). key in camelCase, label short in the idea's language, sensible value/min/max in the units the programmer will use (${dimension === "2d" ? "pixels and px/s at 1280x720" : "meters and m/s"}).
- controls: list of {input, action}, e.g. {"input":"← →","action":"mover"}.
- cinematic: style and exactly 3 short lines (<= 70 chars) that set up the story.
- levelOutline: a concrete description of the level(s) layout, pacing and difficulty curve the programmer will implement.
- mechanics: 3-7 concrete mechanics.`;

  const { data: raw, usage } = await generateJson<Raw>({ model: config.anthropic.fastModel(), system, prompt, schema, maxTokens: 8000 });
  return { design: normalize(raw, dimension, opts.models3d), usage };
}

function slug(s: string, used: Set<string>) {
  let base =
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "asset";
  if (/^[0-9]/.test(base)) base = `a_${base}`;
  let id = base;
  let i = 2;
  while (used.has(id)) id = `${base}_${i++}`;
  used.add(id);
  return id;
}

function normalize(r: Raw, dimension: Dimension, models3d: boolean): GameDesign {
  const used = new Set<string>();
  const images = (r.images || []).slice(0, 14).map((a) => ({
    ...a,
    id: slug(a.id || a.name, used),
    transparent: ["background", "texture", "portrait"].includes(a.role) ? false : a.transparent !== false,
  }));
  if (!images.some((i) => i.role === "hero") && images[0]) images[0].role = "hero";
  const audio = (r.audio || []).slice(0, 10).map((a) => ({
    ...a,
    id: a.kind === "voice" ? slug("narration", used) : slug(a.id || a.name, used),
    durationSec: Math.max(0.5, Math.min(a.kind === "music" ? 120 : 30, Number(a.durationSec) || (a.kind === "music" ? 60 : 1.5))),
    loop: a.kind === "music" ? true : !!a.loop,
  }));
  const models = models3d && dimension !== "2d" ? (r.models || []).slice(0, 3).map((m) => ({ ...m, id: slug(m.id || m.name, used) })) : [];
  const tuning = (r.tuning || []).slice(0, 8).map((t) => {
    const min = Number(t.min);
    const max = Number(t.max);
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return { key: t.key.replace(/[^a-zA-Z0-9_]/g, ""), label: t.label, min: lo, max: hi, value: Math.min(hi, Math.max(lo, Number(t.value))) };
  });
  return {
    title: r.title,
    tagline: r.tagline,
    genre: r.genre,
    dimension,
    engine: dimension === "2d" ? "phaser" : "three",
    camera: r.camera,
    artStyle: r.artStyle,
    palette: (r.palette || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8),
    setting: r.setting,
    hero: r.hero,
    mechanics: r.mechanics || [],
    controls: r.controls || [],
    objective: r.objective,
    loseCondition: r.loseCondition,
    levelOutline: r.levelOutline,
    tuning,
    cinematic: { style: r.cinematic?.style || "epica", lines: (r.cinematic?.lines || []).slice(0, 3) },
    assets: { images, audio, models },
  };
}
