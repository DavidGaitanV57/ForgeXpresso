import type { AssetRecord, GameDesign, ImageAssetSpec } from "../types";
import { normalizeSheetAnims, type SheetAnimName } from "../sheets";

/** Animations a 2D game must ship, read from the idea and the design text. */
const ANIM_CUES: [SheetAnimName, RegExp][] = [
  ["slide", /desliz|agach|slide|crouch|gliss|duck|barrera alta|por debajo|sous (?:la |les )?barri/i],
  ["jump", /salt|jump|saut|hop\b/i],
  ["dash", /\bdash\b|sprint|embestid|aceler[oó]n|boost/i],
  ["attack", /atac|attack|dispar|shoot|arma|weapon/i],
  ["fall", /ca[ií]d|falling|\bfall\b|chute/i],
  ["walk", /camin|walk|marcher/i],
  ["run", /corr|run\b|courir|runner|trotte/i],
];

const ANIM_ORDER: SheetAnimName[] = ["slide", "jump", "dash", "attack", "run", "walk", "fall", "land", "hurt", "idle"];

/** Every animation the text actually asks for, plus idle, a locomotion cycle and a bump reaction. */
export function requiredAnims(text: string): SheetAnimName[] {
  const out = new Set<SheetAnimName>(["idle", "hurt"]);
  for (const [name, re] of ANIM_CUES) if (re.test(text)) out.add(name);
  if (!out.has("run") && !out.has("walk")) out.add("run");
  return ANIM_ORDER.filter((n) => out.has(n));
}

/** Mechanic cues first, so a tight frame budget never drops slide/jump/dash in favor of idle. */
export function mergeAnims(text: string, fromModel: string[]): ReturnType<typeof normalizeSheetAnims> {
  const must = requiredAnims(text);
  const extra = fromModel.map((n) => n.toLowerCase().trim()).filter((n) => !must.includes(n as SheetAnimName));
  return normalizeSheetAnims([...must, ...extra]);
}

export interface ScenerySpec {
  id: string;
  name: string;
  prompt: string;
  aspect: ImageAssetSpec["aspect"];
  test: RegExp;
}

/** Side scenery the idea names. One subject per image, so the programmer never has to draw it with rectangles. */
export const SCENERY: ScenerySpec[] = [
  {
    id: "scenery_building",
    name: "Edificio",
    aspect: "2:3",
    test: /edifici|rascaciel|building|immeuble|\bcasas?\b|\bhouses?\b|maison/i,
    prompt:
      "Single cartoon building front, flat cel-shaded, bold outline, windows and a door, isolated cutout on a transparent background, no ground, no sky, no neighboring buildings",
  },
  {
    id: "scenery_tree",
    name: "Árbol",
    aspect: "2:3",
    test: /árbol|arbol|tree|arbre/i,
    prompt: "Single cartoon tree, round canopy and a short trunk, bold outline, flat colors, isolated cutout on a transparent background, no ground, no sky",
  },
  {
    id: "scenery_fence",
    name: "Valla",
    aspect: "3:2",
    test: /valla|cerca|reja|fence|cl[oô]ture/i,
    prompt: "Short stretch of cartoon picket fence, front view, bold outline, flat colors, isolated cutout on a transparent background, no ground, no sky",
  },
  {
    id: "scenery_sign",
    name: "Cartel",
    aspect: "1:1",
    test: /cartel|letrero|billboard|signboard|panneau|se[ñn]al/i,
    prompt: "Single cartoon billboard on two posts, blank colorful panel, front view, bold outline, isolated cutout on a transparent background, no ground, no sky, no text",
  },
];

/** True when an image for this scenery already exists, so we don't add a second one. */
export function sceneryCovered(images: { id: string; name: string; prompt: string }[], scenery: ScenerySpec) {
  return images.some((i) => scenery.test.test(`${i.id} ${i.name} ${i.prompt}`));
}

const SFX_CUES: { id: string; name: string; prompt: string; test: RegExp }[] = [
  { id: "sfx_jump", name: "Salto", prompt: "Short cartoon jump whoosh, bright and light, no voice", test: /salt|jump|saut/i },
  { id: "sfx_slide", name: "Deslizamiento", prompt: "Short whoosh of something sliding along the ground, cartoon, no voice", test: /desliz|agach|slide|crouch|gliss/i },
  { id: "sfx_dash", name: "Acelerón", prompt: "Short rising whoosh of a sudden speed burst, cartoon, no voice", test: /\bdash\b|sprint|aceler[oó]n/i },
  { id: "sfx_coin", name: "Moneda", prompt: "Bright short coin pickup bling, no voice", test: /moneda|coin|pi[eè]ce/i },
  { id: "sfx_hit", name: "Choque", prompt: "Soft cartoon thud, a bump not a scream, no voice", test: /choque|colisi|golpe|hurt|crash/i },
];

export function missingSfx(text: string, audio: { id: string; name: string; prompt: string }[]) {
  return SFX_CUES.filter((c) => c.test.test(text) && !audio.some((a) => c.test.test(`${a.id} ${a.name} ${a.prompt}`)));
}

/** A rear-view road cannot be a top-down picture: the texture may only be grain, and code draws the converging rails. */
export function isPerspectiveRoad(text: string) {
  return /carril|lanes?|desde atr[aá]s|por detr[aá]s|from behind|rear view|vista trasera|endless runner/i.test(text);
}

export const PERSPECTIVE_GROUND_PROMPT =
  "Seamless abstract ground surface only: flat cartoon asphalt grain with subtle speckle, no rails, no sleepers, no lane markings, no objects, no perspective, tileable vertically and horizontally";

const PICTURED_ROAD = /rail|sleeper|lane|divider|v[ií]a|traviesa|carril|durmiente/i;

/** A pictured road would be tiled flat over the perspective trapezoid, so the texture becomes grain and code draws the rails. */
export function perspectiveGround(role: string, prompt: string, text: string) {
  if ((role === "texture" || role === "tile") && isPerspectiveRoad(text) && PICTURED_ROAD.test(prompt)) return PERSPECTIVE_GROUND_PROMPT;
  return prompt;
}

/** Why the finished module would be rejected. Sheets are used through their base id, so they are not required as strings. */
export function deliveryGaps(code: string, assets: AssetRecord[]): string | null {
  const missing: string[] = [];
  for (const a of assets) {
    if (a.status === "skipped" || a.status === "error") continue;
    if (a.type === "image" && ((a.spec as ImageAssetSpec).sheet || (a.spec as ImageAssetSpec).role === "keyart")) continue;
    const quoted = [`"${a.id}"`, `'${a.id}'`, `\`${a.id}\``].some((q) => code.includes(q));
    if (!quoted) missing.push(a.id);
  }
  const anims = new Set(
    assets
      .filter((a) => a.type === "image" && (a.spec as ImageAssetSpec).sheet)
      .flatMap((a) => ((a.spec as ImageAssetSpec).sheet?.anims || []).map((x) => x.name)),
  );
  if (anims.has("slide") && !/\bsliding\b/.test(code)) missing.push("sliding:true mientras el personaje se agacha o desliza");
  if (anims.has("dash") && !/\bdashing\b/.test(code)) missing.push("dashing:true durante el acelerón");
  if (anims.has("jump") && !/jump/i.test(code)) missing.push("el salto (la animación jump no se usa)");
  if (anims.has("attack") && !/\battacking\b/.test(code)) missing.push("attacking:true durante el ataque");
  return missing.length ? `Falta usar en el juego: ${missing.join(", ")}.` : null;
}

/** Ids and animation states the programmer has to wire, shown in its prompt. */
export function deliveryBrief(design: GameDesign, assets: AssetRecord[]): string {
  const ids = assets.filter((a) => !(a.type === "image" && ((a.spec as ImageAssetSpec).sheet || (a.spec as ImageAssetSpec).role === "keyart"))).map((a) => a.id);
  const anims = [
    ...new Set(
      assets
        .filter((a) => a.type === "image" && (a.spec as ImageAssetSpec).sheet?.of && /hero/i.test((a.spec as ImageAssetSpec).sheet!.of + a.id))
        .flatMap((a) => (a.spec as ImageAssetSpec).sheet!.anims.map((x) => x.name)),
    ),
  ];
  return [
    "DELIVERY CONTRACT — the module is rejected otherwise:",
    `Use every asset id as a string literal, on screen or as audio: ${ids.join(", ")}.`,
    anims.length ? `The hero sheet has [${anims.join(", ")}]. Pass sliding:true the whole time the character crouches or slides, dashing:true only for a speed burst, attacking:true while striking, and a real jump when "jump" is listed.` : "",
    design.dimension === "2d" && isPerspectiveRoad(`${design.camera} ${design.levelOutline}`)
      ? "The ground texture is grain only. Draw rails, sleepers and lane lines yourself, in the same perspective as the obstacles. Place every scenery prop image (buildings, trees, fences, signs) scaled with distance; do not replace them with rectangles."
      : "Place every scenery prop image in the level; do not redraw those subjects with graphics primitives.",
  ]
    .filter(Boolean)
    .join("\n");
}
