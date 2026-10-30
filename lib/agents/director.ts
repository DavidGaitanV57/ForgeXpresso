import { config } from "../config";
import { generateJson } from "../providers/anthropic";
import type { Aspect, Dimension, GameDesign, GameUiSpec, ImageRole, UiHudItem, UiMenuItem, UiSetting } from "../types";
import { sanitizeVoicePrompt, voicePromptFromLines } from "./voice-prompt";

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
  ui: obj({
    hud: arr(obj({ id: str, label: str, kind: { type: "string", enum: ["value", "bar", "icon", "lives"] }, shows: str })),
    pauseMenu: arr(obj({ id: str, label: str, action: str })),
    settings: arr(
      obj({
        key: str,
        label: str,
        type: { type: "string", enum: ["toggle", "slider", "select"] },
        min: num,
        max: num,
        step: num,
        options: arr(str),
        defaultValue: str,
      }),
    ),
    gameOverActions: arr(str),
    startActions: arr(str),
  }),
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
      seamless: bool,
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

type Raw = Omit<GameDesign, "dimension" | "engine" | "assets" | "ui"> & {
  ui?: Partial<GameUiSpec> & { settings?: (UiSetting & { defaultValue?: unknown })[] };
  images: GameDesign["assets"]["images"];
  audio: GameDesign["assets"]["audio"];
  models: GameDesign["assets"]["models"];
};

const DIM_GUIDE: Record<Dimension, string> = {
  "2d": "2D side/top-down game. Sprites are single transparent images; backgrounds are wide parallax images.",
  "2.5d": "2.5D side-scroller on a gameplay plane with a side/three-quarter camera. READ THE IDEA for art split: if it asks for 3D characters + 2D décor/parallax (personnages en 3D + décor/fond en 2D, etc.), hero/enemies/NPCs MUST be real 3D via forge.three.character (GLB when Tripo available, else auto Capsule/Sphere low-poly) — never flat billboard sprites — while sky/far scenery stay 2D parallax (backdrop + layered planes). If unspecified, prefer 3D characters when models exist, else textured low-poly meshes for characters.",
  "3d": "Full 3D game (third-person, first-person or isometric). Environment from procedural meshes with generated seamless textures. EVERY gameplay entity (hero, enemies, collectibles, goals, hazards, props) MUST be true 3D via forge.three.character / model (GLB and/or auto low-poly). Flat billboard/sprite planes are FORBIDDEN for those entities — only HUD/UI may be 2D. Image assets for entities are reference/texture sources, not flat cardboard cutouts in the world.",
};

/** Idea asks for mesh/3D characters (common in 2.5D: 3D cast + 2D parallax décor). */
export function wantsMeshCharacters(idea: string, dimension: Dimension) {
  if (dimension === "3d") return true;
  if (dimension === "2d") return false;
  return /(?:personnages?|characters?|héros|heros|heroes?|enem(?:y|ies)|ennemis?|protagonist|personajes?).{0,80}(?:\b3d\b|trois[- ]?dimensions|three[- ]?d)|(?:\b3d\b|trois[- ]?dimensions|three[- ]?d).{0,80}(?:personnages?|characters?|personajes?)|(?:doivent|deben|must|should).{0,40}(?:être|ser|be).{0,20}(?:en\s+)?3d|(?:décor|decor|fond|background|scenery).{0,40}(?:en\s+)?2d|parallax[e]?/i.test(
    idea,
  );
}

export async function runDirector(idea: string, dimension: Dimension, opts: { models3d: boolean }) {
  const system = `You are Forge's game director. You turn a short game idea into a precise, buildable design document for an AI team:
an image artist, a sound designer (ElevenLabs), ${opts.models3d ? "a 3D modeler (text-to-3D), " : ""}and a programmer who writes the whole game in a single JS module.
Design something fun, focused and achievable as one polished vertical slice. Be specific and concrete.
Write titles, names, labels, objective, mechanics, controls, cinematic lines, UI labels and usage notes in the SAME language as the idea (French idea → French UI; Spanish → Spanish; English → English). Never mix languages in pause/settings/HUD labels.
Write image, music, sfx and model prompts in English (better generation quality). Exception — voice/narration: prompt is ONLY the spoken script (see audio rules).`;

  const meshChars = wantsMeshCharacters(idea, dimension);
  const prompt = `Idea: """${idea}"""
Dimension: ${dimension}. ${DIM_GUIDE[dimension]}
${meshChars ? "ART SPLIT FROM IDEA: characters/entities in 3D meshes; décor/backgrounds as 2D parallax. Encode this in levelOutline and mechanics so the programmer cannot ship billboard-only heroes/enemies." : ""}

Rules:
- artStyle: one rich paragraph (English) describing a single coherent visual style (rendering technique, line/shading, lighting, mood) that every image will share.
- palette: 5-7 hex colors.
- images: 6-12 assets. ids in snake_case, unique, <=24 chars. Exactly one "hero". Include at least: hero, the main enemies or obstacles, collectibles, goal (if any), ${
    dimension === "2d"
      ? "parallax: at least ONE seamless=true abstract background layer (starfield/nebula/clouds ONLY, no planets/ships/landmarks, aspect 16:9) for wrapping, PLUS optionally one seamless=false landmark backdrop (planets/stations) that must NEVER be tiled, and platform/ground tiles (role tile or platform, seamless=true when meant to repeat)"
      : "2-4 seamless textures (role texture, seamless=true, aspect 1:1) and 1 background (role background, 16:9, seamless=false) used as sky/backdrop"
  }.
  transparent=true for sprites/characters/objects/ui; false for background, texture, portrait.
  Sprites MUST be isolated subjects: prompt the subject only — no scenery, no nebula plate, no ground, no frame. The image QA rejects baked backgrounds.
  CUTOUT HARD RULE for roles prop, collectible, hazard, goal (and platform when used as a floating piece): transparent=true ALWAYS. Prompt ONLY the object — forbidden: painted white/colored rectangle plate, scenery backdrop, room wall, ground shadow plate, vignette frame. These are alpha-cutout sprites composited into the scene; a baked background makes them look like stickers.
  seamless=true ONLY for abstract repeating layers/textures/tiles. Unique painted scenes with planets or landmarks MUST be seamless=false.
  Characters/objects for 2D or billboards must be "side view facing right" (2D side games) or "three-quarter front view" (top-down/3D).
- audio: exactly 1 music (kind music, loop true, durationSec 60-90), 4-8 sfx (durationSec 0.5-3, loop false) for the core events (jump, pickup, hit, win, lose, attack… whatever fits),
  and 1 voice (id "narration", kind voice). VOICE HARD RULE: prompt = the 3 cinematic.lines joined with a blank line between them, in the idea's language — NOTHING ELSE. ElevenLabs speaks the prompt verbatim. FORBIDDEN in voice prompt: English delivery notes, tone ("warm gentle storyteller"), language labels ("in French"), "reading exactly N lines", pause instructions, or any text that is not spoken aloud.
- models: ${
    opts.models3d && dimension !== "2d"
      ? dimension === "3d" || meshChars
        ? "REQUIRED for every character/entity image (hero, enemy, npc; also collectible/hazard/prop/goal when they are gameplay objects the player touches): one text-to-3D model each (English prompt, single object, game-ready, stylized, matching artStyle). Id = image id + '_3d'. Do NOT skip — billboard-only characters are forbidden for this idea. 3-8 models typical. UI images do not get models."
        : "1-4 key 3D models (hero first, then main enemy/prop/goal) as text-to-3D prompts (English, single object, game-ready, stylized, matching artStyle). Id = matching image id + '_3d'."
      : "empty array (no Tripo key). Programmer will build low-poly meshes instead when 3D characters are required."
  }
${
  dimension === "3d" || meshChars
    ? "- MESH CHARACTERS HARD RULE: hero/enemies/NPCs must be real 3D (programmer uses forge.three.character → GLB or auto low-poly Capsule/Sphere). Images for those roles are texture/reference only. Never plan billboard-only characters. 2D parallax is OK for backgrounds/sky only. Without Tripo, models[] stays empty and the programmer still ships primitive meshes via character()."
    : ""
}
- tuning: 4-8 live-tunable numbers that the player may want to tweak from the chat (e.g. playerSpeed, jumpForce, gravity, enemySpeed, spawnRate, timeLimit). key in camelCase, label short in the idea's language, sensible value/min/max in the units the programmer will use (${dimension === "2d" ? "pixels and px/s at 1280x720" : "meters and m/s"}).
- ui (REQUIRED — every game has its own UI):
  - hud: 3-7 chips/bars the player sees while playing (score, lives, weapon, boss HP…). kind value|bar|icon|lives. Labels in the idea's language.
  - pauseMenu: at least Resume / Settings / Quit equivalents IN THE IDEA'S LANGUAGE (FR: Continuer/Réglages/Quitter; ES: Continuar/Ajustes/Salir; EN: Resume/Settings/Quit).
  - settings: MUST include masterVolume (slider 0-1), musicVolume (slider 0-1), sfxVolume (slider 0-1), plus any game-specific options. Labels in the idea's language. For sliders put min/max/step/defaultValue as strings of numbers; for toggles defaultValue "true"/"false"; for select fill options[].
  - startActions and gameOverActions: short button labels in the idea's language.
- controls: list of {input, action} with action text in the idea's language.
- cinematic: style and exactly 3 short lines (<= 70 chars) that set up the story (idea's language).
- levelOutline: a concrete description of the level(s) layout, pacing and difficulty curve the programmer will implement.
- mechanics: 3-7 concrete mechanics.`;

  const { data: raw, usage } = await generateJson<Raw>({ model: config.anthropic.fastModel(), system, prompt, schema, maxTokens: 9000 });
  return { design: normalize(raw, dimension, opts.models3d, idea), usage };
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

function defaultUi(langHint: string): GameUiSpec {
  const fr = /[àâäéèêëïîôùûüç]|forêt|jouer|vies|réglages|continuer|luciole/i.test(langHint);
  const es = !fr && (/[áéíóúñ¿¡]|puntos|vidas|jugar|continuar/i.test(langHint) || !/[a-z]{4}/i.test(langHint));
  const L = fr
    ? { score: "Score", lives: "Vies", resume: "Continuer", settings: "Réglages", quit: "Quitter", master: "Volume général", music: "Musique", sfx: "Effets", retry: "Réessayer", menu: "Menu", play: "Jouer", scoreShows: "score", livesShows: "vies restantes" }
    : es
      ? { score: "Puntos", lives: "Vidas", resume: "Continuar", settings: "Ajustes", quit: "Salir", master: "Volumen general", music: "Música", sfx: "Efectos", retry: "Reintentar", menu: "Menú", play: "Jugar", scoreShows: "puntuación", livesShows: "vidas restantes" }
      : { score: "Score", lives: "Lives", resume: "Resume", settings: "Settings", quit: "Quit", master: "Master volume", music: "Music", sfx: "SFX", retry: "Retry", menu: "Menu", play: "Play", scoreShows: "score", livesShows: "lives left" };
  return {
    hud: [
      { id: "score", label: L.score, kind: "value", shows: L.scoreShows },
      { id: "lives", label: L.lives, kind: "lives", shows: L.livesShows },
    ],
    pauseMenu: [
      { id: "resume", label: L.resume, action: "resume" },
      { id: "settings", label: L.settings, action: "settings" },
      { id: "quit", label: L.quit, action: "quit" },
    ],
    settings: [
      { key: "masterVolume", label: L.master, type: "slider", min: 0, max: 1, step: 0.05, defaultValue: 0.9 },
      { key: "musicVolume", label: L.music, type: "slider", min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
      { key: "sfxVolume", label: L.sfx, type: "slider", min: 0, max: 1, step: 0.05, defaultValue: 1 },
    ],
    gameOverActions: [L.retry, L.menu],
    startActions: [L.play],
  };
}

function normalizeUi(raw: Raw["ui"] | undefined, idea: string): GameUiSpec {
  const base = defaultUi(idea + " " + (raw?.hud?.[0]?.label || ""));
  const hud: UiHudItem[] = (raw?.hud?.length ? raw.hud : base.hud).slice(0, 8).map((h) => ({
    id: String(h.id || "hud").replace(/[^a-zA-Z0-9_]/g, ""),
    label: String(h.label || h.id),
    kind: (["value", "bar", "icon", "lives"].includes(h.kind) ? h.kind : "value") as UiHudItem["kind"],
    shows: String(h.shows || h.label || ""),
  }));
  const pauseMenu: UiMenuItem[] = (raw?.pauseMenu?.length ? raw.pauseMenu : base.pauseMenu).slice(0, 6).map((m) => ({
    id: String(m.id || "item").replace(/[^a-zA-Z0-9_]/g, ""),
    label: String(m.label || m.id),
    action: String(m.action || m.id),
  }));
  const settingsIn = raw?.settings?.length ? raw.settings : base.settings;
  const settings: UiSetting[] = settingsIn.slice(0, 10).map((s) => {
    const type = (["toggle", "slider", "select"].includes(s.type) ? s.type : "slider") as UiSetting["type"];
    const min = s.min != null ? Number(s.min) : type === "slider" ? 0 : undefined;
    const max = s.max != null ? Number(s.max) : type === "slider" ? 1 : undefined;
    let defaultValue: number | string | boolean | undefined = undefined;
    const rawDef = s.defaultValue;
    if (type === "toggle") defaultValue = String(rawDef) === "true" || rawDef === true;
    else if (type === "slider") defaultValue = Number(rawDef ?? ((min ?? 0) + (max ?? 1)) / 2);
    else defaultValue = rawDef != null ? String(rawDef) : s.options?.[0];
    return {
      key: String(s.key || "setting").replace(/[^a-zA-Z0-9_]/g, ""),
      label: String(s.label || s.key),
      type,
      min,
      max,
      step: s.step != null ? Number(s.step) : type === "slider" ? 0.05 : undefined,
      options: Array.isArray(s.options) ? s.options.map(String) : undefined,
      defaultValue,
    };
  });
  // Enforce volume sliders (labels follow idea language via defaultUi).
  const volDefaults = defaultUi(idea);
  for (const req of volDefaults.settings.filter((s) => ["masterVolume", "musicVolume", "sfxVolume"].includes(s.key))) {
    if (!settings.some((s) => s.key === req.key)) {
      settings.unshift({ ...req });
    }
  }
  return {
    hud: hud.length ? hud : base.hud,
    pauseMenu: pauseMenu.length ? pauseMenu : base.pauseMenu,
    settings: settings.slice(0, 12),
    gameOverActions: (raw?.gameOverActions?.length ? raw.gameOverActions : base.gameOverActions).map(String).slice(0, 4),
    startActions: (raw?.startActions?.length ? raw.startActions : base.startActions).map(String).slice(0, 4),
  };
}

function normalize(r: Raw, dimension: Dimension, models3d: boolean, idea = ""): GameDesign {
  const used = new Set<string>();
  const cutoutRoles = new Set(["hero", "enemy", "npc", "collectible", "hazard", "prop", "goal", "platform", "ui"]);
  const images = (r.images || []).slice(0, 14).map((a) => {
    const role = a.role;
    const forceCutout = ["prop", "collectible", "hazard", "goal", "platform"].includes(role);
    const transparent = ["background", "texture", "portrait"].includes(role)
      ? false
      : forceCutout || cutoutRoles.has(role)
        ? true
        : a.transparent !== false;
    let seamless = !!a.seamless;
    if (role === "texture" || role === "tile") seamless = a.seamless !== false;
    if (role === "background") {
      // Unique scenic paintings must not wrap; abstract layers may.
      const scenic = /planet|ship|station|castle|landmark|city|boss|dread|hive|character|hero/i.test(a.prompt + " " + a.name);
      seamless = scenic ? false : a.seamless === true;
    }
    if (["hero", "enemy", "npc", "collectible", "hazard", "prop", "goal", "ui", "portrait", "platform"].includes(role)) seamless = false;
    let prompt = String(a.prompt || "");
    if (forceCutout && !/isolated cutout|no background|transparent background|chroma/i.test(prompt)) {
      prompt = `Isolated cutout, transparent or flat magenta background, no scenery plate, no white rectangle, no ground shadow: ${prompt}`;
    }
    return {
      ...a,
      id: slug(a.id || a.name, used),
      prompt,
      transparent,
      seamless,
    };
  });
  if (!images.some((i) => i.role === "hero") && images[0]) images[0].role = "hero";
  // Guarantee at least one seamless wrap layer for 2D side/scroll games when any background exists.
  if (dimension === "2d" && images.some((i) => i.role === "background") && !images.some((i) => i.role === "background" && i.seamless)) {
    const far = images.find((i) => i.role === "background");
    if (far && /star|nebula|cloud|sky|space dust|abstract/i.test(far.prompt)) far.seamless = true;
  }
  const cineLines = (r.cinematic?.lines || []).map((l) => String(l || "").trim()).filter(Boolean).slice(0, 3);
  const audio = (r.audio || []).slice(0, 10).map((a) => {
    const kind = a.kind;
    let prompt = String(a.prompt || "");
    if (kind === "voice") {
      prompt = cineLines.length ? voicePromptFromLines(cineLines) : sanitizeVoicePrompt(prompt);
    }
    return {
      ...a,
      kind,
      prompt,
      id: kind === "voice" ? slug("narration", used) : slug(a.id || a.name, used),
      durationSec: Math.max(0.5, Math.min(kind === "music" ? 120 : 30, Number(a.durationSec) || (kind === "music" ? 60 : 1.5))),
      loop: kind === "music" ? true : !!a.loop,
    };
  });
  const meshChars = wantsMeshCharacters(idea, dimension);
  let models =
    models3d && dimension !== "2d"
      ? (r.models || []).slice(0, dimension === "3d" || meshChars ? 10 : 4).map((m) => ({ ...m, id: slug(m.id || m.name, used) }))
      : [];
  // Full 3D or 2.5D with mesh characters: ensure every character/entity image has a matching *_3d model.
  if (models3d && (dimension === "3d" || meshChars)) {
    const entityRoles = new Set(
      dimension === "3d" ? ["hero", "enemy", "npc", "collectible", "hazard", "prop", "goal"] : ["hero", "enemy", "npc"],
    );
    const covered = (imgId: string) => models.some((m) => m.id === imgId || m.id === `${imgId}_3d` || m.id.startsWith(`${imgId}_`));
    for (const img of images) {
      if (!entityRoles.has(img.role) || covered(img.id)) continue;
      const mid = slug(`${img.id}_3d`, used);
      models.push({
        id: mid,
        name: img.name,
        prompt: `Game-ready stylized low-poly 3D ${img.role}: ${img.prompt}. Single isolated object, clean topology, readable silhouette, no ground plane, no scenery pedestal.`,
        usage: `3D mesh for ${img.role} ${img.name}`,
      });
    }
    models = models.slice(0, 10);
  }
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
    ui: normalizeUi(r.ui, `${r.title} ${r.objective}`),
    cinematic: { style: r.cinematic?.style || "epica", lines: (r.cinematic?.lines || []).slice(0, 3) },
    assets: { images, audio, models },
  };
}
