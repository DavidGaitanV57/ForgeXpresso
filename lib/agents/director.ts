import { config } from "../config";
import { generateJson } from "../providers/anthropic";
import { clipSpecFor, FACING_ANIMS } from "../sheets";
import { characterView } from "../sprite-view";
import type { Aspect, Dimension, GameDesign, GameUiSpec, ImageAssetSpec, ImageRole, UiHudItem, UiMenuItem, UiSetting } from "../types";
import { animationClips, directionalView, missingSfx, perspectiveGround, SCENERY, sceneryCovered } from "./delivery";
import { sanitizeVoicePrompt, voicePromptFromLines } from "./voice-prompt";

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

const ROLES: ImageRole[] = ["hero", "enemy", "npc", "collectible", "hazard", "prop", "platform", "tile", "goal", "background", "texture", "ui", "portrait", "keyart"];
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
      animations: arr({ type: "string", enum: [...FACING_ANIMS] }),
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
  "2d": "2D game whose camera is exactly one of side, front, rear, top-down or isometric. Sprites are single transparent images drawn for that camera (moving characters also get a frame-animation spritesheet in the same view); backgrounds are wide parallax images.",
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
an image artist (2D décor/UI only when needed), a sound designer (ElevenLabs), ${opts.models3d ? "a 3D modeler (Tripo text→3D for mesh characters/entities — no 2D sprite for those), " : ""}and a programmer who writes the whole game in a single JS module.
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
- images: ${
    dimension === "3d" || meshChars
      ? "2D décor ONLY (no hero/enemy/npc/collectible/hazard/prop/goal sprites). Typically 2-4 seamless textures (role texture, 1:1) + 1 background (16:9, seamless=false) + optional ui. Mesh entities live under models[], not images."
      : `one still image for every distinct subject the idea names (usually 8-24; never drop a requested character, enemy or object). ids snake_case, unique, <=24 chars. Exactly one role "hero": the lead drawn on the poster. Every other playable character is its own role "npc" sprite. Every enemy is its own role "enemy" sprite. Include collectibles, goal (if any), ${
          dimension === "2d"
            ? "scenery the idea names, as images and not left for the programmer to draw: ONE seamless=true abstract sky layer (clouds/stars ONLY, no buildings, aspect 16:9); 3-6 transparent prop cutouts (role prop) for the recurring side scenery (buildings, trees, fences, signs, vehicles), one subject each; and the ground. Flat side/top view: one seamless ground tile. Rear view down a road or track (lanes converging to a horizon, objects growing as they approach): the ground image is ONLY a seamless abstract surface (asphalt grain, gravel or grass) with NO rails, sleepers, lane lines or markings, role texture — code draws those in perspective"
            : "2-4 seamless textures (role texture, 1:1) and 1 background (16:9, seamless=false)"
        }`
  }.
  transparent=true for sprites/characters/objects/ui; false for background, texture, portrait, keyart.
  Exactly one keyart image: aspect 1:1, transparent false, seamless false. A square promotional poster with the hero large, the setting behind and the game title in bold stylized lettering. It is the library cover only — never a sprite and never drawn inside the gameplay. It is generated before the other pictures and is the identity reference: the hero image must describe that exact same character (same species, outfit and colors), not a redesign. The poster hero uses the same camera as the playable sprite.
  Sprites MUST be isolated subjects: prompt the subject only — no scenery, no nebula plate, no ground, no frame. The image QA rejects baked backgrounds.
  CUTOUT HARD RULE for roles prop, collectible, hazard, goal (and platform when used as a floating piece): transparent=true ALWAYS. Prompt ONLY the object — forbidden: painted white/colored rectangle plate, scenery backdrop, room wall, ground shadow plate, vignette frame. These are alpha-cutout sprites composited into the scene; a baked background makes them look like stickers.
  seamless=true ONLY for abstract repeating layers/textures/tiles. Unique painted scenes with planets or landmarks MUST be seamless=false.
  The camera field and every character prompt (hero, enemies, keyart) name ONE view, in these words: side → "side view facing right"; front → "strict front view, facing the camera, both eyes visible"; rear → "strict straight-on back view, camera directly behind, both shoulders equal, face not visible"; top-down → "strict top-down view, camera straight above"; isometric → "strict isometric view, elevated three-quarter, top of the head and the front of the body visible". Do not mix two views in one prompt. A rear camera must not say three-quarter or side view.
  animations: ${
    dimension === "2d"
      ? 'on EVERY image, "animations" is the COMPLETE clip list for THAT sprite only, chosen from [idle, walk, run, jump, fall, land, slide, dash, attack, hurt], at most 6 names. "slide" is the crouch/duck-under; "dash" is a forward speed burst; walk or run is the locomotion cycle (a flying enemy uses walk as the flap). The pipeline draws exactly those names, each as its OWN spritesheet. It does NOT copy a clip onto a sprite because some other character uses it. If only the rival jumps, jump is on the rival and not on the hero. If only one boxer steps in place, walk is only on that boxer. Fill the list for the hero, for every other playable character, and for every enemy. A prop, hazard, collectible, goal or platform that moves on its own (spins, opens, flaps, flows, pulses, crawls) gets the clips that motion needs — ["idle"] is enough for a loop. [] ONLY for things that never change pose: ground, sky, still scenery, UI, the poster. Do not stop after one hero or two enemies.'
      : "always []."
  }
- audio: exactly 1 music (kind music, loop true, durationSec 60-90), 4-8 sfx (durationSec 0.5-3, loop false) for the core events (jump, pickup, hit, win, lose, attack… whatever fits),
  and 1 voice (id "narration", kind voice). VOICE HARD RULE: prompt = the 3 cinematic.lines joined with a blank line between them, in the idea's language — NOTHING ELSE. ElevenLabs speaks the prompt verbatim. FORBIDDEN in voice prompt: English delivery notes, tone ("warm gentle storyteller"), language labels ("in French"), "reading exactly N lines", pause instructions, or any text that is not spoken aloud.
- models: ${
    opts.models3d && dimension !== "2d"
      ? dimension === "3d" || meshChars
        ? "REQUIRED text→3D models (English prompts) for every mesh entity: hero, enemy, npc; also collectible/hazard/prop/goal when the player touches them. Id = logical id + '_3d' (e.g. hero_ila_3d). Do NOT also create images for those roles — Tripo builds the GLB from the model prompt alone. Prompts must describe a CLOSED solid game-ready mesh (no paper cutouts, no hollow shells). 3-8 models typical."
        : "1-4 key text→3D models (hero first). Id = logical id + '_3d'. English prompt, closed solid mesh."
      : "empty array (no Tripo key)."
  }
${
  dimension === "3d" || meshChars
    ? "- MESH / NO-2D RULE: for hero/enemies/NPCs (and full-3D touchable entities), DO NOT list them under images — only under models (or nowhere if no Tripo; programmer uses forge.three.character primitives). Never billboard sprites for those roles. Images are ONLY for background, texture, ui, portrait, and 2.5D décor that stays flat. Without Tripo, models[] empty + character() primitives — still never 2D sprites for mesh roles."
    : ""
}
- tuning: 4-8 live-tunable numbers that the player may want to tweak from the chat (e.g. playerSpeed, jumpForce, gravity, enemySpeed, spawnRate, timeLimit). key in camelCase, label short in the idea's language, sensible value/min/max in the units the programmer will use (${dimension === "2d" ? "pixels and px/s at 1280x720" : "meters and m/s"}).
- ui (REQUIRED — every game has its own UI):
  - hud: 3-7 chips/bars the player sees while playing (score, lives, weapon, boss HP…). kind value|bar|icon|lives. Labels in the idea's language.
  - pauseMenu: at least Resume / Settings / Quit equivalents IN THE IDEA'S LANGUAGE (FR: Continuer/Réglages/Quitter; ES: Continuar/Ajustes/Salir; EN: Resume/Settings/Quit).
  - settings: MUST include masterVolume (slider 0-1), musicVolume (slider 0-1), sfxVolume (slider 0-1), plus any game-specific options. Labels in the idea's language. For sliders put min/max/step/defaultValue as strings of numbers; for toggles defaultValue "true"/"false"; for select fill options[].
  - startActions and gameOverActions: short button labels in the idea's language.
- controls: list of {input, action}. "input" holds ONLY keyboard key names separated by " / " (e.g. "← / → / A / D", "↑ / W / Space", "P / Esc"): no prose, no "or", no touch or swipe hints (the runtime shows its own touch buttons). "action" is 1-4 words in the idea's language.
- cinematic: style and exactly 3 short lines (<= 70 chars) that set up the story (idea's language).
- levelOutline: a concrete description of the level(s) layout, pacing and difficulty curve the programmer will implement.
- mechanics: 3-7 concrete mechanics.
- LENGTH: the whole JSON must stay compact. Image/model/music/sfx prompts <= 45 words each, artStyle <= 90 words, levelOutline <= 150 words, usage notes <= 25 words. Keep every named character, enemy and animated object; merge only duplicate scenery.`;

  const { data: raw, usage } = await generateJson<Raw>({ model: config.anthropic.fastModel(), system, prompt, schema, maxTokens: 16000 });
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
  const brief = [idea, r.camera, r.levelOutline, ...(r.mechanics || []), r.objective, r.loseCondition].filter(Boolean).join("\n");
  const listedAnims = new Map<string, string[]>();
  const images = (r.images || []).slice(0, 28).map((a): ImageAssetSpec => {
    const role = a.role;
    const forceCutout = ["prop", "collectible", "hazard", "goal", "platform"].includes(role);
    const transparent = ["background", "texture", "portrait", "keyart"].includes(role)
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
    if (["hero", "enemy", "npc", "collectible", "hazard", "prop", "goal", "ui", "portrait", "platform", "keyart"].includes(role)) seamless = false;
    let prompt = String(a.prompt || "");
    if (forceCutout && !/isolated cutout|no background|transparent background|chroma/i.test(prompt)) {
      prompt = `Isolated cutout, transparent or flat magenta background, no scenery plate, no white rectangle, no ground shadow: ${prompt}`;
    }
    prompt = perspectiveGround(role, prompt, brief);
    const { animations: listed, ...rest } = a as ImageAssetSpec & { animations?: string[] };
    const id = slug(a.id || a.name, used);
    listedAnims.set(id, Array.isArray(listed) ? listed.map(String) : []);
    return {
      ...rest,
      id,
      prompt,
      transparent,
      seamless,
    };
  });
  // A missing hero sprite gets a stand-in only when the hero really is a sprite. In mesh games the
  // hero is a model, and promoting a texture or background here turned scenery into a Tripo "hero".
  const meshCast = models3d && dimension !== "2d" && (dimension === "3d" || wantsMeshCharacters(idea, dimension));
  if (!meshCast && !images.some((i) => i.role === "hero")) {
    const standIn = images.find((i) => ["npc", "enemy", "prop", "collectible", "goal", "hazard"].includes(i.role));
    if (standIn) standIn.role = "hero";
  }
  if (!images.some((i) => i.role === "keyart")) {
    images.push({
      id: slug("keyart", used),
      name: "Portada",
      role: "keyart",
      prompt: `Square promotional key art poster, the character reference for every later sprite of the game "${r.title || "the game"}". The playable hero stays this exact character: ${[r.hero?.name, r.hero?.description].filter(Boolean).join(" — ") || "the hero"}. ${r.setting || "the game's world"} behind them, the title "${r.title || ""}" in bold stylized lettering. Do not invent a second protagonist. Polished splash illustration, full color, not a sprite, not a transparent cutout, no interface.`,
      transparent: false,
      aspect: "1:1",
      usage: "Portada de la biblioteca de juegos. No es un sprite jugable.",
      seamless: false,
    });
  }
  if (dimension === "2d") {
    for (const s of SCENERY) {
      if (!s.test.test(brief) || sceneryCovered(images, s) || images.length >= 32) continue;
      const id = slug(s.id, used);
      images.push({
        id,
        name: s.name,
        role: "prop",
        prompt: s.prompt,
        transparent: true,
        aspect: s.aspect,
        usage: `Escenario: ${s.name}. Colócalo a escala según la distancia; no lo dibujes con rectángulos.`,
        seamless: false,
      });
    }
    for (const img of [...images]) {
      if (img.sheet) continue;
      const view = characterView({ camera: r.camera, levelOutline: r.levelOutline, prompt: img.prompt });
      const list = animationClips(img.role, listedAnims.get(img.id), directionalView(view));
      for (const anim of list) {
        const spec = clipSpecFor(img, anim);
        if (used.has(spec.id)) continue;
        used.add(spec.id);
        images.push(spec);
      }
    }
  }
  // Guarantee at least one seamless wrap layer for 2D side/scroll games when any background exists.
  if (dimension === "2d" && images.some((i) => i.role === "background") && !images.some((i) => i.role === "background" && i.seamless)) {
    const far = images.find((i) => i.role === "background");
    if (far && /star|nebula|cloud|sky|space dust|abstract/i.test(far.prompt)) far.seamless = true;
  }
  const cineLines = (r.cinematic?.lines || []).map((l) => String(l || "").trim()).filter(Boolean).slice(0, 3);
  // Music and the narration are kept before the sound effects are trimmed: the director often lists the voice
  // last, and a plain cap of 8 dropped it whenever it also wrote 8 effects.
  const listed = r.audio || [];
  const music = listed.find((a) => a.kind === "music");
  const voice = listed.find((a) => a.kind === "voice");
  const kept = [music, voice, ...listed.filter((a) => a.kind !== "music" && a.kind !== "voice")].filter(Boolean).slice(0, 10) as typeof listed;
  // The cinematic is narrated: a design with story lines and no voice still gets one, spoken from those lines.
  if (!voice && cineLines.length) kept.splice(music ? 1 : 0, 0, { id: "narration", name: "Narración", kind: "voice", prompt: "", durationSec: 20, loop: false, usage: "Cinematic narration" } as (typeof listed)[number]);
  const audio = kept.map((a) => {
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
  for (const s of missingSfx(brief, audio)) {
    if (audio.length >= 10) break;
    audio.push({ id: slug(s.id, used), name: s.name, kind: "sfx", prompt: s.prompt, durationSec: 1, loop: false, usage: s.name });
  }
  const meshChars = wantsMeshCharacters(idea, dimension);
  const meshMode = dimension === "3d" || meshChars;
  const entityRoles = new Set(
    dimension === "3d" ? ["hero", "enemy", "npc", "collectible", "hazard", "prop", "goal"] : meshChars ? ["hero", "enemy", "npc"] : [],
  );
  let models =
    models3d && dimension !== "2d"
      ? (r.models || []).slice(0, meshMode ? 10 : 4).map((m) => ({ ...m, id: slug(m.id || m.name, used) }))
      : [];
  // Mesh mode: promote any entity images the LLM still emitted into *_3d text→3D models, then drop those images
  // (no 2D sprite generation for mesh roles — Tripo text or programmer primitives only).
  if (meshMode && entityRoles.size) {
    const covered = (baseId: string) => models.some((m) => m.id === baseId || m.id === `${baseId}_3d` || m.id.startsWith(`${baseId}_`));
    for (const img of images) {
      if (!entityRoles.has(img.role)) continue;
      if (models3d && !covered(img.id)) {
        const mid = slug(`${img.id}_3d`, used);
        models.push({
          id: mid,
          name: img.name,
          prompt: `Game-ready stylized low-poly 3D ${img.role}: ${img.prompt}. Closed solid watertight mesh, clean topology, readable silhouette, no holes, no paper-thin shells, no ground plane.`,
          usage: `3D mesh for ${img.role} ${img.name}`,
        });
      }
    }
    if (models3d) {
      // Ensure at least a hero model exists
      if (!models.some((m) => /hero|_hero/i.test(m.id) || /hero/i.test(m.name))) {
        const mid = slug("hero_3d", used);
        models.push({
          id: mid,
          name: "Hero",
          prompt: `Game-ready stylized low-poly 3D playable hero. Closed solid watertight mesh, readable silhouette, ${r.artStyle || "stylized game art"}.`,
          usage: "3D mesh for hero",
        });
      }
      models = models.slice(0, 10);
    }
  }
  const imagesFinal = meshMode ? images.filter((i) => !entityRoles.has(i.role)) : images;
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
    assets: { images: imagesFinal, audio, models },
  };
}
