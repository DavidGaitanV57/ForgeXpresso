// The contract between the code agent and public/runtime/*. Keep in sync with the runtime.

const COMMON = `
## Forge runtime: common API (object \`forge\`)
The runtime loads every asset, shows the start screen, the cinematic, pause, win/lose screens, touch controls and the HUD.
Your module only contains the gameplay.

- \`forge.design\`: the design document (title, palette[], tuning[], controls, objective…).
- \`forge.tune(key, fallback)\` → number. Live‑tunable values (the user changes them from the chat WITHOUT reloading).
  ALWAYS read them every frame/at use time (never cache in a const at startup). Use every key listed in "Tuning".
- \`forge.assets.image(id)\` → { id, url, width, height, aspect, role, ready } | null. Every image id in the manifest ALWAYS exists
  (if generation failed the runtime creates a placeholder with the same id), so never guard against missing images.
- \`forge.assets.list(type)\` → array of manifest records for "image" | "audio" | "model".
- \`forge.input.down(action)\`, \`forge.input.pressed(action)\` (true only on the frame it was pressed), \`forge.input.axis()\` → {x,y} in [-1,1].
  Actions: "left","right","up","down","jump","action","action2","pause". Keyboard: arrows/WASD, Space=jump, J/X/Enter=action, K/Shift=action2.
  Gamepad and on‑screen touch buttons map to the same actions. Pointer/mouse: use the engine's own pointer API.
- \`forge.audio.play(id, {volume, rate, loop})\` → handle {stop()}; \`forge.audio.music(id, {volume})\` (crossfades, loops);
  \`forge.audio.stopMusic()\`. Unknown ids fall back to a synthesized blip chosen by name (jump, coin, hit, win, lose, shoot, explode, step, powerup), so it is safe to call.
  Start the music with \`forge.audio.music(<music id>)\` in your create/init.
- \`forge.hud.set(key, value, {label, icon})\`: a HUD chip (score, coins, time…). \`icon\` is a ui image asset id (drawn as that picture, e.g. \`icon: "heart_icon"\`) or one emoji — never other text. \`forge.hud.bar(key, ratio0to1, {label, color})\`: health/energy bar.
  \`forge.hud.remove(key)\`. \`forge.hud.message(text, ms)\`: short centered announcement. Do NOT draw HUD text with the engine.
- \`forge.win({title, subtitle, stats:{label:value}})\` and \`forge.lose({title, subtitle, stats})\`: end the run; the runtime shows the
  screen and the "play again" button, which calls your restart path automatically (the whole game is re‑created). Call exactly once per run.
- \`forge.save(key, value)\`, \`forge.load(key, fallback)\`: persistent storage (best score, unlocked levels).
- \`forge.rand()\`: seeded random in [0,1). \`forge.shake(intensity0to1)\`: screen shake handled by the runtime.
- \`forge.paused\`: boolean; the runtime already stops your update while paused.
- \`forge.cinematic\`: live intro state while the letterboxed cinematic plays:
  \`{ active, t, duration, lineIndex, shotIndex, shot, direction, progress }\`.
  \`direction\` is \`forge.design.cinematic.direction\` (approach, mood, shots[]) from the silent cinematic expert —
  unique per game. Implement \`onCinematic(dt, cine)\` on the object you return from createGame (Three) or next to \`scenes\` (Phaser)
  to drive camera/parallax/staging ONLY. While \`forge.cinematic.active\`, skip normal gameplay input; restore the play camera when it ends.
  CRITICAL — the runtime owns the letterbox bars, subtitles, title card, skip control and narration voice.
  Do NOT draw your own cinematic UI, skip tip, subtitle planes, or play the narration clip again.
  Do NOT boot the game in a DIY "cine" state that runs before/alongside the runtime intro — start in normal play;
  the runtime plays the intro when cineAuto is on (or when the studio asks to watch it).
`;

const PHASER = `
## Engine: Phaser 3.90 (2D). Global \`Phaser\` is available.
Module shape (ES module, no imports):
\`\`\`js
export default function createGame(forge, Phaser) {
  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }
    create() { /* build the level */ }
    update(time, delta) { /* gameplay */ }
  }
  return {
    scenes: [MainScene],
    physics: "arcade",
    gravity: 0,
    background: "#101420",
    onCinematic(dt, cine) { /* camera / parallax for this game's cinematic direction */ },
  };
}
\`\`\`
- Throw and reject only with \`new Error("…")\`, never a string or plain object: the runtime repairs only errors whose stack shows
  they came from the game, and a bare string has no stack.
- Logical resolution is 1280×720 (scaled to fit). The runtime draws it at the screen's real resolution, so position everything in
  1280×720 coordinates (constants, \`this.scale.width/height\`, \`pointer.worldX/worldY\`) and never read the canvas or GL buffer size
  (\`game.canvas.width\`, \`renderer.width\`, \`drawingBuffer*\`, \`getContext\`) or read pixels back (\`snapshot\`, \`readPixels\`): such a game drops to a blurry 1280×720 canvas. \`physics\`: "arcade" (default, recommended) or "matter". \`gravity\` is the world default (px/s²); for platformers set per‑body gravity from \`forge.tune\` instead.
- All images are preloaded as textures whose key is the asset id. Do NOT call this.load.* for assets. Do not use Phaser's sound system; use forge.audio.
- Generated images are large single frames (~512–640 px, transparent PNG for sprites). ALWAYS size them with
  \`forge.phaser.fit(gameObject, targetHeightPx)\` (keeps aspect). For physics sprites call \`forge.phaser.body(sprite, {w:0.6, h:0.9})\` AFTER fit
  to set a body as a fraction of the displayed size (bottom‑centered).
- Character scale on the 1280×720 stage: a standing playable character or enemy is 180–280 px tall in platformers, runners and
  top-down games, and at most 320 px in a one-screen duel or boxing game. Leave the upper third of the screen for the arena and the HUD;
  never make a character taller than 45% of the screen. Sprites are drawn at ~370 px, so going larger than that blurs them.
- Match the sprite's camera. Side view is drawn facing right: use \`setFlipX(true)\` to face left. An isometric sprite is drawn
  facing the lower-right: mirror it with \`setFlipX(vx < 0)\` to face the lower-left (that is how isometric games turn). Strict front,
  rear and top-down sprites are not mirrored into a profile; keep a rear-view runner back-to-camera.
- Isometric and top-down characters may have back clips (\`idle_back\`, \`walk_back\`, \`run_back\`). Then \`anim.update({vx, vy, …})\` picks
  front or back from vy and mirrors from vx by itself: pass the real velocity in both axes and do NOT call \`setFlipX\` on that sprite.
- Animated sprites: every \`spritesheet\` belongs to the still image in its \`of\` field — the hero, each companion, each enemy, and any prop that cycles on its own. Create the sprite with that BASE id (e.g. \`this.physics.add.sprite(x, y, "hero_kuro")\`) and IMMEDIATELY call \`const anim = forge.phaser.animate(sprite)\`
  — BEFORE fit/body, because it swaps the texture to that character's clip sheets (\`<id>_sheet_<anim>\`, or the legacy \`<id>_sheet\`). Each animation is its own image; cells are square with feet on the bottom and every clip shares the character's body scale. Then
  \`forge.phaser.fit(sprite, standingHeightPx)\` — after animate, fit sizes the STANDING character, not the cell, so a lunge or crouch keeps the same body size — and
  \`forge.phaser.body(sprite, {w:0.42, h:0.88})\` (fractions of the standing character). Call fit ONCE; never setScale an animated sprite per clip or per state, and never scale it up for a dash or attack — the clip already shows the pose. Every frame call
  \`anim.update({vx, vy, grounded, dashing, sliding, attacking, hurt}, deltaSeconds)\` with the physics body velocity; it picks idle/walk/run/jump/fall/land/slide/dash/attack/hurt.
  Pass \`sliding: true\` the whole time the character crouches or slides under an obstacle, and \`dashing: true\` only for a forward speed burst — they are different clips.
  dash, slide, jump, land, attack and hurt play ONCE and hold their last pose while the flag stays true; they restart only when the flag goes false and true again. So a hold-to-dodge must keep \`dashing\` true for the whole hold (or end it after a fixed burst) and must not toggle it every frame.
  Only the clips listed in the sheet exist; \`attacking\` triggers once on its rising edge. \`anim.play(name)\` forces a clip, \`anim.has(name)\`, \`anim.current\`.
  Flip with \`setFlipX(vx < 0)\` for a side-view or isometric sprite without back clips; a sprite with back clips is flipped by the runtime. Strict front, rear and top-down clips stay unflipped. If the sheet is missing/not ready, \`animate\` transparently falls back to the puppet below (\`anim.animated === false\`),
  so ALWAYS use animate for every sprite that has a spritesheet, including enemies and moving props — never load or slice sheets yourself, never use this.anims directly. A prop whose only motion is a loop can \`anim.play\` that clip and keep calling \`anim.update\`.
- Characters without a spritesheet: bring them to life with \`const p = forge.phaser.puppet(sprite)\` (after fit/body) and call
  \`p.update({vx, vy, grounded, attacking, hurt}, deltaSeconds)\` every frame (breathing, run bob/lean, jump stretch, landing squash).
  The puppet draws a visual copy that mirrors the sprite's position, flipX, alpha, tint, visibility and depth, so keep controlling the physics sprite as usual.
  Do not scale physics sprites every frame yourself (it resizes the Arcade body); use animate/puppet or tweens on non-physics objects.
  Never draw a \`*_sheet\` or \`*_sheet_<anim>\` asset as a plain image (each one is a grid of frames).
- \`forge.phaser.parallax(scene, imageId, factor, {depth, alpha, tint, y, height, tile})\` → full‑screen parallax layer.
  CRITICAL: only pass \`tile:true\` (or rely on \`forge.assets.image(id).seamless\`) for abstract seamless layers (starfields/clouds).
  Scenic paintings with planets/landmarks are seamless=false — the helper will NOT wrap them (wrapping causes a hard vertical seam).
  Stack: far seamless abstract layer (tile) + optional non-tiling landmark layer on top.
- \`forge.phaser.tiles(scene, imageId, x, y, w, h)\` → TileSprite ONLY when the asset is seamless (or abstract fx). If \`seamless=false\`, the helper returns a non-wrapping image (no vertical seam). Prefer \`parallax\` for scenic backdrops.
- Implement \`forge.design.ui\`: HUD via forge.hud.*. Pause (P / Esc / botón ⏸) and Ajustes (master/music/sfx volume sliders) are provided by the runtime — do not rebuild them. The studio chrome also has a master volume slider.
- \`forge.phaser.burst(scene, x, y, {color, count, speed, life, size})\` particle explosion. \`forge.phaser.trail(scene, target, {color})\` → emitter following a sprite (call .destroy()).
- \`forge.phaser.floatText(scene, x, y, text, {color, size})\` floating "+10" style text in world space.
- Use the camera: \`this.cameras.main.startFollow(player, true, 0.12, 0.12)\`, \`setBounds\`, \`setDeadzone\`. Use tweens and particles for juice.
`;

const THREE = `
## Engine: Three.js r186 + Rapier 3D physics (for 2.5D and 3D)
Module shape (ES module; you MAY import from "three" and "three/addons/..." — e.g. \`import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"\`):
\`\`\`js
export default async function createGame(forge, ctx) {
  const { THREE, RAPIER, scene, camera, renderer, world } = ctx;
  // build the world…
  return {
    update(dt, time) { /* gameplay; runtime steps physics AFTER this */ },
    onCinematic(dt, cine) {
      /* REQUIRED when design.cinematic.direction exists: tween camera from cine.shot.camera.from→to, lookAt, apply fx.
         cine = forge.cinematic snapshot. Do not leave a static frame. */
    },
    dispose() { /* optional */ },
  };
}
\`\`\`
- Renderer already configured: sRGB output, ACES tone mapping, soft shadows, \`scene.environment\` (studio IBL), resize handling,
  bloom post‑processing (tune with \`forge.three.bloom(strength, radius, threshold)\`; 0 disables). \`camera\` is a PerspectiveCamera(55°).
  You must add your own lights: \`forge.three.lights({sun:"#fff2dd", sky:"#bcd4ff", ground:"#40302a", intensity:1, shadowSize:40})\` returns {sun, hemi};
  move \`sun.position\`/\`sun.target\` with the player for large levels.
- \`world\` is a RAPIER.World with gravity {x:0,y:-9.81,z:0} (affects dynamic bodies only; assign \`world.gravity = {x,y,z}\` to change it). The runtime calls \`world.step()\` after your update and syncs linked meshes.
- Units: meters. A character is ~1.6–1.8 m tall.
- Textures: \`forge.three.texture(imageId, {repeat:[x,y]})\` (sRGB, mipmapped, wrap repeat). \`forge.three.material(imageId|null, {color, repeat, roughness, metalness, emissive, emissiveIntensity})\` → MeshStandardMaterial.
- Characters (preferred for 3D / mesh-character designs): \`forge.three.character(logicalId, heightMeters, {shape, model, color, flatShading})\` → Object3D.
  Tries \`forge.three.model(model || logicalId+'_3d')\` first (Tripo **text→3D** GLB; mesh games may have no 2D image for that id). If no GLB, builds low‑poly primitives (default \`"humanoid"\`; also \`"creature"\`|\`"capsule"\`|\`"box"\`|\`"sphere"\`), textured only if an image id exists. Base at y=0. **Always use this for hero/enemies/NPCs when 3D characters are required — never sprites.**
- Paper billboards only: \`forge.three.sprite(imageId, heightMeters, {billboard: "y"|true|false})\` → Mesh (alpha‑tested plane). Only for paper-style 2.5D when the design does NOT demand 3D characters. **Forbidden** whenever the idea/design asks for 3D characters (or full 3D dimension) — use \`character()\` instead.
- 3D models: \`forge.three.model(id, {height})\` → Object3D clone normalized to that height with its base at y=0, or null if no model exists for that id.
  Prefer model ids ending in \`_3d\`. Prefer wrapping with \`forge.three.character(imageId)\` so missing GLBs fall back to primitives automatically.
- **Facing (critical — do not invent a separate “3D orientation agent”):**
  - **Third-person / free 3D:** each frame \`root.rotation.y = atan2(vx, vz)\` (smoothed). Pass \`forge.three.character(id, h, { yaw: -Math.PI/2 })\` so Tripo +X noses align to group **+Z** = move dir. Tune \`yaw\` if a mesh differs — never stack a blind \`model.rotation.y += Math.PI\` on top (causes profile-while-walking).
  - **Side-scroll / 2.5D:** leave \`yaw\` unset/0; rotate the root with \`sideYaw=(d)=>d>=0?-PI/2-0.55:PI/2+0.55\`. Never \`facing*1.15\` if that shows the rear.
- \`forge.three.puppet(object3D)\` → \`p.update({vx, vz, vy, grounded, speed}, dt)\` procedural bob/lean/squash for characters without skeletal animation. Prefer this for platformer feel when the GLB has no clips; Tripo auto-rig is humanoid-biased and rarely gives good quadruped walk cycles.
- \`forge.three.animator(root)\` → skeletal player when the GLB was Tripo-retargeted (clips on \`root.userData.animations\`). Returns \`{ names, play(name), setLocomotion({vx,vz,vy,grounded,speed}), hurt(), stop, dispose }\` or null if no clips. Host advances mixers each frame and pins Root/Hip translation to bind pose (kills baked root-motion drift). Prefer animator over puppet when clips exist.
  - Biped clips are idle, walk, run, jump and hurt. setLocomotion picks idle/walk/run on the ground and holds "jump" for the whole time in the air (rising and falling). There is no airborne "fall" clip: never \`play("fall")\` or any death/lie-down pose for a character that is only in the air.
  - On every hit to a character, call \`anim.hurt()\` (one short reaction, then locomotion resumes by itself) and keep calling setLocomotion every frame. If it returns false (no hurt clip), show the hit with a flash and knockback instead.
  - In onCinematic and on spawn, call \`anim.setLocomotion({speed: 0, grounded: true})\` each frame for characters on screen so they stand in idle, never frozen in a rest pose.
- \`forge.three.backdrop(imageId)\` sets a screen‑fixed background image (ideal for 2.5D side views); \`forge.three.skydome(imageId, radius)\` wraps it around a dome for free cameras; \`forge.three.fog(color, near, far)\`.
- \`forge.three.follow(camera, targetObject3D, {offset:[x,y,z], lookAhead:[x,y,z], smooth:6})\` → call \`.update(dt)\` each frame (spring follow cam). For 2.5D use a side offset like [0,3,12].
- \`forge.three.burst(position, {color, count, speed, life, size})\` particles. \`forge.three.floatText(position, text, {color})\`.
- Physics helpers (all return Rapier objects; meshes are kept in sync automatically):
  - \`forge.physics.addStatic(mesh, {shape:"box"|"trimesh", friction})\` → collider (box uses the mesh's world bounding box, rotation respected).
  - \`forge.physics.addDynamic(mesh, {shape:"box"|"ball"|"capsule", mass, restitution, friction, lockRotations})\` → {body, collider}.
  - \`forge.physics.character({radius, height, position:[x,y,z], stepHeight, maxSlopeDeg, snapToGround})\` → controller
    with \`.move(desiredDeltaVector3)\` (call once per frame with velocity*dt, including your own gravity), \`.grounded\`, \`.position\` (THREE.Vector3, read‑only copy), \`.teleport([x,y,z])\`, \`.body\`, \`.collider\`.
  - \`forge.physics.raycast(originVec3, dirVec3, maxDist)\` → {point, distance, collider} | null. \`forge.physics.remove(meshOrBody)\`.
  - For pickups, triggers, enemy contact and projectiles use simple distance / bounding‑box checks in update (no sensors).
- 2.5D means: real 3D environment (depth, lighting, shadows, parallax depth layers with meshes) but gameplay constrained to a plane (lock z=0) with a side/three‑quarter camera.
`;

export const QUALITY_RULES = `
## Quality bar (very important)
- A complete, polished vertical slice: clear goal, increasing challenge, at least ~2–4 minutes of content (or endless with scaling difficulty), win and/or lose conditions wired to forge.win/forge.lose.
- Tight controls: acceleration/deceleration, coyote time + jump buffering for platformers, variable jump height, invulnerability frames after damage, readable hitboxes (smaller than the sprite).
- Juice: particles on pickups/hits/landing, screen shake on impacts (forge.shake), squash/stretch (puppet), tween pops on collectibles, floating score text, sound on every meaningful event.
- Level design by code: hand‑authored arrays or seeded procedural generation that is guaranteed beatable (check jump distances against tuning). Use forge.rand for randomness.
- Visual depth: layered parallax/backdrops, palette‑consistent tints, lighting/fog in 3D, shadows under characters.
- Scenery the player sees (buildings, trees, fences, signs, vehicles) MUST be the prop/background images from the manifest, placed and scaled with distance. Draw them with graphics primitives only when no such image exists.
- Perspective ground (camera behind the runner, lanes converging to a horizon): fill the road with the seamless abstract ground texture or a flat color, and draw rails, sleepers and lane markings yourself as rows that scroll with the SAME perspective as the obstacles (wide near the player, compressed at the horizon). Never tile a pictured top-down road over that trapezoid, and never draw rails both in the texture and again in code.
- Full 3D dimension: every gameplay entity in the world is a real mesh via \`forge.three.character(imageId)\` / \`forge.three.model\` (GLB or auto low-poly). Do NOT use forge.three.sprite. UI/HUD stays 2D via forge.hud.
- 2.5D with “3D characters + 2D décor/parallax”: hero/enemies/NPCs = \`forge.three.character(…)\`; backgrounds = backdrop/skydome/parallax planes. Never forge.three.sprite for characters.
- Use every generated image and sound where it makes sense; never reference ids that are not in the manifest (except synthesized sfx names).
- Show controls hints with forge.hud.message at start (short). Build the HUD from \`forge.design.ui.hud\` (every chip/bar listed must appear). Do not invent a different HUD.
- Never tileSprite-wrap a non-seamless background. If an enemy/boss sprite still shows a baked scene plate, prefer tinted placeholders only as last resort — assets should already be isolated by the image QA gate (sceneryContamination + alpha ratio); do not work around bad plates in code.
- Robustness: no external network requests, no DOM access, no alert/prompt, no localStorage (use forge.save/load), no infinite loops, clean up on dispose. Guard against NaN. Keep frame time low (pool objects, avoid allocating per frame in hot loops).
- Write clean, well‑structured, plain JavaScript (ES2022). No TypeScript, no JSX.
`;

export function runtimeDocs(engine: "phaser" | "three") {
  return COMMON + (engine === "phaser" ? PHASER : THREE) + QUALITY_RULES;
}
