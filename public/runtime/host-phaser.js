// Phaser 3 host for 2D games. Exposes forge.phaser helpers.

const W = 1280, H = 720;
const toColor = (c, d = 0xffffff) => (typeof c === "number" ? c : typeof c === "string" && /^#?[0-9a-f]{6}$/i.test(c) ? parseInt(c.replace("#", ""), 16) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export async function createHost(createGame, ctx) {
  const Phaser = window.Phaser;
  if (!Phaser) throw new Error("Phaser is not loaded");
  const { forge, stage, manifest, boot, input, onProgress } = ctx;
  let game = null;
  let debug = false;
  let progressed = false;
  let onCinematic = null;

  forge.phaser = helpers(Phaser, forge);

  function build() {
    return new Promise((resolve, reject) => {
      let def;
      try {
        def = createGame(forge, Phaser) || {};
      } catch (e) {
        return reject(e);
      }
      onCinematic = typeof def.onCinematic === "function" ? def.onCinematic.bind(def) : null;
      const scenes = Array.isArray(def.scenes) ? def.scenes : def.scene ? [def.scene] : [];
      if (!scenes.length) return reject(new Error("createGame must return { scenes: [...] }"));

      class ForgeBoot extends Phaser.Scene {
        constructor() {
          super("__forge_boot");
        }
        preload() {
          for (const img of manifest.images) {
            if (!img.url) continue;
            if (img.sheet) this.load.spritesheet(img.id, img.url, { frameWidth: img.sheet.cell, frameHeight: img.sheet.cell });
            else this.load.image(img.id, img.url);
          }
          if (!progressed) this.load.on("filecomplete", () => onProgress());
          this.load.on("loaderror", (file) => console.warn("[forge] image failed", file.key));
        }
        create() {
          progressed = true;
          for (const img of manifest.images) {
            const loaded = this.textures.exists(img.id);
            if (!loaded) this.textures.addCanvas(img.id, forge._placeholder(img));
            const src = this.textures.get(img.id).getSourceImage();
            img.width = img.sheet && loaded ? img.sheet.cell : src.width;
            img.height = img.sheet && loaded ? img.sheet.cell : src.height;
            img.ready = !!img.url && loaded;
            if (img.sheet && img.ready) makeSheetAnims(this.anims, img);
          }
          if (!this.textures.exists("forge-dot")) {
            const c = document.createElement("canvas");
            c.width = c.height = 32;
            const x = c.getContext("2d");
            const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
            g.addColorStop(0, "rgba(255,255,255,1)");
            g.addColorStop(0.4, "rgba(255,255,255,.85)");
            g.addColorStop(1, "rgba(255,255,255,0)");
            x.fillStyle = g;
            x.fillRect(0, 0, 32, 32);
            this.textures.addCanvas("forge-dot", c);
          }
          const first = this.scene.manager.scenes.find((s) => s.sys.settings.key !== "__forge_boot");
          if (!first) return reject(new Error("No game scenes"));
          this.scene.start(first.sys.settings.key);
          resolve();
        }
      }

      const physics =
        def.physics === "matter"
          ? { default: "matter", matter: { gravity: { y: def.gravity ?? 1 }, debug: debug } }
          : { default: "arcade", arcade: { gravity: { y: def.gravity ?? 0 }, debug: debug } };

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: stage,
        width: W,
        height: H,
        backgroundColor: def.background || boot.design?.palette?.[0] || "#0b0e17",
        pixelArt: !!def.pixelArt,
        antialias: !def.pixelArt,
        // Sprites are drawn larger than they are shown; mipmaps keep them smooth instead of jagged when shrunk.
        mipmapFilter: def.pixelArt ? "" : "LINEAR_MIPMAP_LINEAR",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        physics,
        loader: { crossOrigin: "anonymous" },
        audio: { noAudio: true },
        input: { gamepad: false, keyboard: { target: window } },
        banner: false,
        disableContextMenu: true,
        scene: [ForgeBoot, ...scenes],
      });
      game.events.once(Phaser.Core.Events.READY, () => {
        try {
          crispCanvas(Phaser, game, String(createGame));
        } catch (e) {
          console.warn("[forge] crisp canvas", e);
        }
      });
      game.events.on(Phaser.Core.Events.PRE_STEP, (_time, delta) => {
        input._begin();
        if (forge.cinematic?.active && onCinematic) {
          try {
            onCinematic(Math.min(0.05, (delta || 16) / 1000), forge.cinematic);
          } catch (e) {
            console.warn("[forge] phaser cinematic", e);
          }
        }
      });
      game.events.on(Phaser.Core.Events.POST_STEP, () => input._end());
      game.events.on(Phaser.Core.Events.PRE_RENDER, () => {
        try {
          forge.phaser._autoAnimate(game);
        } catch (e) {
          console.warn("[forge] auto animate", e);
        }
      });
    });
  }

  function destroy() {
    return new Promise((resolve) => {
      if (!game) return resolve();
      const g = game;
      game = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stage.querySelectorAll("canvas").forEach((c) => c.remove());
        resolve();
      };
      g.events.once(Phaser.Core.Events.DESTROY, finish);
      try {
        g.loop.wake();
        g.destroy(true);
      } catch {
        finish();
      }
      setTimeout(finish, 600);
    });
  }

  function replaceImage(id, url) {
    if (!game) return Promise.resolve(false);
    const bust = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now().toString(36);
    return new Promise((resolve) => {
      const scene = game.scene.getScenes(true)[0] || game.scene.scenes[0];
      if (!scene) return resolve(false);
      const key = id;
      const meta = manifest.images.find((i) => i.id === id);
      const sheet = meta?.sheet;
      // Load under a temp key and swap in one synchronous step: removing a texture that live
      // (or animating) objects still reference crashes the WebGL batch on the next render.
      const tmp = `${key}__swap_${Date.now().toString(36)}`;
      const onDone = () => {
        try {
          if (!game.textures.exists(tmp)) return resolve(false);
          const users = [];
          for (const sc of game.scene.getScenes(false)) {
            sc.children?.list?.forEach((obj) => {
              if (obj?.texture?.key !== key || typeof obj.setTexture !== "function") return;
              users.push({ obj, anim: obj.anims?.currentAnim?.key || null, frame: obj.frame?.name });
              obj.anims?.stop();
              obj.setTexture("__DEFAULT");
            });
          }
          if (sheet) for (const a of sheet.anims) game.anims.remove(`${key}:${a.name}`);
          if (game.textures.exists(key)) game.textures.remove(key);
          game.textures.renameTexture(tmp, key);
          const src = game.textures.get(key).getSourceImage();
          if (meta) {
            meta.url = url;
            meta.width = sheet ? sheet.cell : src.width;
            meta.height = sheet ? sheet.cell : src.height;
            meta.ready = true;
          }
          if (sheet) makeSheetAnims(game.anims, meta);
          for (const { obj, anim, frame } of users) {
            if (!obj.active) continue;
            obj.setTexture(key, sheet ? (typeof frame === "number" ? frame : 0) : undefined);
            if (anim && game.anims.exists(anim)) obj.anims.play(anim);
          }
          resolve(true);
        } catch (e) {
          console.warn("[forge] replaceImage failed", id, e);
          resolve(false);
        }
      };
      scene.load.once(Phaser.Loader.Events.COMPLETE, onDone);
      scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve(false));
      if (sheet) scene.load.spritesheet(tmp, bust, { frameWidth: sheet.cell, frameHeight: sheet.cell });
      else scene.load.image(tmp, bust);
      scene.load.start();
    });
  }

  return {
    start: () => build(),
    pause() {
      if (game) game.loop.sleep();
    },
    resume() {
      if (game) game.loop.wake();
    },
    async restart() {
      await destroy();
      await build();
    },
    replaceImage,
    cinematic(dt, cine) {
      try {
        onCinematic?.(dt, cine);
      } catch (e) {
        console.warn("[forge] phaser cinematic", e);
      }
    },
    setDebug(on) {
      debug = on;
      if (!game) return;
      for (const s of game.scene.getScenes(true)) {
        const w = s.physics && s.physics.world;
        if (!w || !("drawDebug" in w)) continue;
        w.drawDebug = on;
        if (on && !w.debugGraphic) w.createDebugGraphic();
        if (!on && w.debugGraphic) w.debugGraphic.clear();
      }
    },
  };
}

/**
 * Game code that reads the real canvas or GL buffer size, or reads pixels back, keeps the 1x canvas:
 * those are the only places where the larger drawing buffer would be visible to the game.
 */
const READS_BUFFER = /\bcanvas\.(width|height)\b|drawingBuffer|snapshot|readPixels|getContext\s*\(|renderer\.(width|height)\b|\bgl\.viewport/;
const MAX_CRISP = 2;

/**
 * Draw at the screen's real resolution while the game keeps its 1280x720 world.
 * The canvas buffer grows to W*k x H*k and the GL viewport and scissor on the screen framebuffer are
 * multiplied by k, so the projection still maps 1280x720 onto the whole buffer. Cameras, scroll, input,
 * physics and render targets stay in logical pixels: nothing the game reads changes.
 * Falls back to 1x on the Canvas renderer, on touch devices, and when the frame rate stays low.
 */
function crispCanvas(Phaser, game, source) {
  const r = game.renderer;
  if (!r || r.type !== Phaser.WEBGL || !r.gl) return;
  if (READS_BUFFER.test(source)) {
    console.info("[forge] game reads the canvas size: rendering at 1280x720");
    return;
  }
  const gl = r.gl;
  const FB = gl.FRAMEBUFFER, DRAW_FB = gl.DRAW_FRAMEBUFFER;
  let k = 1, cap = matchMedia("(pointer: coarse)").matches ? 1 : MAX_CRISP, onScreen = true;
  const bind = gl.bindFramebuffer.bind(gl), viewport = gl.viewport.bind(gl), scissor = gl.scissor.bind(gl);
  gl.bindFramebuffer = (target, fb) => {
    if (target === FB || target === DRAW_FB) onScreen = !fb;
    return bind(target, fb);
  };
  gl.viewport = (x, y, w, h) => (onScreen ? viewport(x * k, y * k, w * k, h * k) : viewport(x, y, w, h));
  gl.scissor = (x, y, w, h) => (onScreen ? scissor(x * k, y * k, w * k, h * k) : scissor(x, y, w, h));
  // Phaser flips scissor rectangles with the buffer height: it must see the logical one.
  Object.defineProperty(gl, "drawingBufferWidth", { configurable: true, get: () => W });
  Object.defineProperty(gl, "drawingBufferHeight", { configurable: true, get: () => H });

  const sharpenText = (obj) => {
    if (obj?.type === "Text" && obj.style && obj.style.resolution !== Math.ceil(k)) obj.setResolution(Math.ceil(k));
  };
  const apply = (next) => {
    if (Math.abs(next - k) < 0.05) return;
    k = next;
    game.canvas.width = Math.round(W * k);
    game.canvas.height = Math.round(H * k);
    r.resize(W, H);
    for (const sc of game.scene.scenes) sc.children?.list?.forEach(sharpenText);
    // Resizing clears the buffer; while paused (start menu, pause) the loop would leave it black.
    try {
      r.preRender();
      game.scene.render(r);
      r.postRender();
    } catch (e) {
      console.warn("[forge] crisp redraw", e);
    }
  };
  const want = () => {
    const css = game.canvas.getBoundingClientRect().width || W;
    const exact = (css * (window.devicePixelRatio || 1)) / W;
    return clamp(Math.ceil(exact * 4) / 4, 1, cap);
  };
  let t = 0;
  const schedule = () => {
    clearTimeout(t);
    t = setTimeout(() => game.canvas && apply(want()), 120);
  };
  for (const sc of game.scene.scenes) sc.sys.events.on("addedtoscene", sharpenText);
  game.scale.on("resize", () => {
    // setGameSize/resize rewrite the canvas to 1x: force the next apply.
    if (game.canvas.width === W) k = 1;
    schedule();
  });
  addEventListener("resize", schedule);
  document.addEventListener("fullscreenchange", schedule);
  // A machine that cannot keep up at k > 1 drops to 1x for the rest of the session.
  let slow = 0;
  const watch = setInterval(() => {
    if (k <= 1 || document.hidden) return (slow = 0);
    slow = game.loop.actualFps < 42 ? slow + 1 : 0;
    if (slow >= 3) {
      cap = 1;
      apply(1);
      console.info("[forge] low frame rate: rendering at 1280x720");
    }
  }, 1000);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    clearTimeout(t);
    clearInterval(watch);
    removeEventListener("resize", schedule);
    document.removeEventListener("fullscreenchange", schedule);
  });
  apply(want());
}

const manifestHasSheets = (forge) => forge.assets.list("image").some((i) => i.sheet && i.ready);

/** Dedicated clip sheets win. A combined `<id>_sheet` only fills animations that don't have their own image yet. */
function clipMap(forge, key) {
  const list = forge.assets.list("image").filter((i) => i && i.sheet && i.ready && i.sheet.of === key);
  const map = new Map();
  for (const meta of list) {
    if (meta.id === `${key}_sheet`) continue;
    for (const a of meta.sheet.anims) if (!map.has(a.name)) map.set(a.name, { meta, spec: a });
  }
  const legacy = list.find((i) => i.id === `${key}_sheet`);
  if (legacy) for (const a of legacy.sheet.anims) if (!map.has(a.name)) map.set(a.name, { meta: legacy, spec: a });
  return map;
}

/** Register `${sheetId}:${anim}` animations for a ready spritesheet (re-creates them on hot swap). */
function makeSheetAnims(anims, img) {
  for (const a of img.sheet.anims) {
    const key = `${img.id}:${a.name}`;
    if (anims.exists(key)) anims.remove(key);
    anims.create({
      key,
      frames: anims.generateFrameNumbers(img.id, { start: a.start, end: a.start + a.frames - 1 }),
      frameRate: a.fps,
      repeat: a.loop ? -1 : 0,
    });
  }
}

/** Legacy clips filled their own cell; normalized clips carry the standing fill of their still image. */
const LEGACY_FILL = 0.94;
/** Height of the standing character inside one cell of this sheet, in frame pixels. */
const unitOf = (meta) => meta.sheet.cell * (meta.sheet.fill || LEGACY_FILL);

function helpers(Phaser, forge) {
  const noRender = () => {};
  return {
    animate(sprite, o = {}) {
      const scene = sprite.scene;
      const key = String(o.character || sprite.texture.key);
      const map = o.sheet
        ? new Map(
            (forge.assets.image(o.sheet)?.sheet?.anims || []).map((a) => [a.name, { meta: forge.assets.image(o.sheet), spec: a }]),
          )
        : clipMap(forge, key);
      const usable = [...map.entries()].filter(([, hit]) => hit.meta && scene.textures.exists(hit.meta.id) && scene.anims.exists(`${hit.meta.id}:${hit.spec.name}`));
      sprite.__forgeAnim = true;
      if (!usable.length) {
        const p = this.puppet(sprite);
        return { animated: false, names: [], current: null, visual: p.visual, has: () => false, play: () => false, update: (s, dt) => p.update(s, dt) };
      }
      const byName = new Map(usable);
      const names = [...byName.keys()];
      const first = byName.has("idle") ? "idle" : names[0];
      const has = (n) => byName.has(n);
      let cur = null, curMeta = null, oneShot = null, wasGrounded = true, wasAttacking = false, landT = 0;
      // A game that called fit() on the still image before animate() keeps that on-screen height.
      const stillH = !sprite.texture.key.includes("_sheet") && Math.abs(sprite.scaleY) !== 1 ? Math.abs(sprite.displayHeight) : 0;
      const play = (n, force) => {
        const hit = byName.get(n);
        if (!hit) return false;
        if (cur === n && !force) return true;
        cur = n;
        if (sprite.texture.key !== hit.meta.id) sprite.setTexture(hit.meta.id, hit.spec.start || 0);
        // Clips packed at different body scales (an old clip next to a redrawn one) must not resize the character.
        if (curMeta && curMeta !== hit.meta) {
          const k = unitOf(curMeta) / unitOf(hit.meta);
          if (Math.abs(k - 1) > 0.01) sprite.setScale(sprite.scaleX * k, sprite.scaleY * k);
        }
        curMeta = hit.meta;
        sprite.__forgeUnit = hit.meta.sheet.fill ? unitOf(hit.meta) : 0;
        sprite.__forgePad = hit.meta.sheet.pad || 0;
        sprite.anims.play(`${hit.meta.id}:${n}`);
        return true;
      };
      sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, (anim) => {
        if (oneShot && anim.key && anim.key.endsWith(`:${oneShot}`)) oneShot = null;
      });
      play(first);
      if (stillH) {
        const s = stillH / unitOf(curMeta);
        sprite.setScale(Math.sign(sprite.scaleX || 1) * s, Math.sign(sprite.scaleY || 1) * s);
      }
      return {
        animated: true,
        names,
        has,
        get current() {
          return cur;
        },
        play(n) {
          const ok = play(n, true);
          const a = byName.get(n)?.spec;
          if (ok) oneShot = a && !a.loop ? n : null;
          return ok;
        },
        update(s = {}, dt = 1 / 60) {
          if (!sprite.active) return;
          const vx = +s.vx || 0, vy = +s.vy || 0;
          const grounded = s.grounded !== false;
          const attacking = !!s.attacking;
          if (grounded && !wasGrounded && has("land")) {
            const l = byName.get("land").spec;
            landT = l.frames / Math.max(1, l.fps);
            play("land", true);
          }
          wasGrounded = grounded;
          landT = Math.max(0, landT - dt);
          sprite.anims.timeScale = 1;
          if (attacking && !wasAttacking && has("attack")) {
            wasAttacking = true;
            play("attack", true);
            oneShot = "attack";
            return;
          }
          wasAttacking = attacking;
          if (s.hurt && has("hurt")) {
            oneShot = null;
            return void play("hurt");
          }
          if (oneShot) return;
          // `sliding` is a crouch/duck-under; `dashing` is a forward burst. Older games pass a crouch as dashing.
          if (s.sliding && has("slide")) return void play("slide");
          if (s.dashing && has("dash")) return void play("dash");
          if ((s.sliding || s.dashing) && has("slide")) return void play("slide");
          if (!grounded) return void play(vy < 0 ? (has("jump") ? "jump" : "fall") : has("fall") ? "fall" : "jump");
          if (landT > 0) return void play("land");
          const sp = Math.abs(vx);
          if (sp > (o.runSpeed ?? 380) && has("run")) return void play("run");
          if (sp > (o.walkMin ?? 20) && (has("walk") || has("run"))) {
            play(has("walk") ? "walk" : "run");
            sprite.anims.timeScale = clamp(sp / (o.walkSpeed ?? 220), 0.6, 1.8);
            return;
          }
          play(has("idle") ? "idle" : first);
        },
      };
    },
    fit(obj, targetHeight) {
      // An animated sprite's cell has headroom for jumps and lunges: the standing character, not the cell, gets the height.
      const h = obj.__forgeUnit || (obj.frame ? obj.frame.realHeight : obj.height);
      const s = targetHeight / Math.max(1, h);
      obj.setScale(s);
      return obj;
    },
    body(sprite, o = {}) {
      const scene = sprite.scene;
      if (!sprite.body) scene.physics.add.existing(sprite);
      const b = sprite.body;
      if (!b || !b.setSize) return sprite;
      const fw = sprite.frame ? sprite.frame.realWidth : sprite.width;
      const fh = sprite.frame ? sprite.frame.realHeight : sprite.height;
      // Normalized clips: fractions are of the standing character (a unit x unit box), feet on the cell's gutter line.
      const unit = sprite.__forgeUnit || 0;
      const w = (unit || fw) * (o.w ?? 0.6);
      const h = (unit || fh) * (o.h ?? 0.9);
      b.setSize(w, h, false);
      b.setOffset((fw - w) / 2, fh - (unit ? sprite.__forgePad || 0 : 0) - h);
      return sprite;
    },
    /** Ready spritesheet for a character texture key, or null. */
    _sheetFor(scene, key) {
      const map = clipMap(forge, key);
      for (const [, hit] of map) {
        if (scene.textures.exists(hit.meta.id) && scene.anims.exists(`${hit.meta.id}:${hit.spec.name}`)) return hit.meta;
      }
      return null;
    },
    /**
     * Frame-animated visual copy of a physics sprite (body untouched, so it works after fit/body).
     * State comes from `update()` when the game calls it, otherwise from the body itself.
     */
    _sheetVisual(sprite, meta) {
      const scene = sprite.scene;
      sprite.__forgeAnim = true;
      const vis = scene.add.sprite(sprite.x, sprite.y, meta.id, 0).setOrigin(0.5, 1);
      const ctl = this.animate(vis, { character: sprite.texture.key });
      sprite.renderWebGL = noRender;
      sprite.renderCanvas = noRender;
      let manual = null;
      const fill = meta.sheet.fill || 0.92;
      const sync = () => {
        if (!sprite.active) return;
        const b = sprite.body;
        let st = manual;
        if (!st && b?.velocity) {
          const gravity = b.allowGravity !== false && (scene.physics?.world?.gravity?.y || 0) + (b.gravity?.y || 0) > 0;
          st = gravity
            ? { vx: b.velocity.x, vy: b.velocity.y, grounded: !!(b.blocked?.down || b.touching?.down) }
            : { vx: Math.hypot(b.velocity.x, b.velocity.y), vy: 0, grounded: true };
        }
        ctl.update(st || {}, (scene.game.loop.delta || 16) / 1000);
        const sc = Math.abs(sprite.displayHeight) / (meta.sheet.cell * fill) || 1;
        vis.setScale(sc);
        vis.x = sprite.x + (0.5 - sprite.originX) * sprite.displayWidth;
        // Feet sit on the cell's gutter line, not on its edge.
        vis.y = sprite.y + (1 - sprite.originY) * sprite.displayHeight + (meta.sheet.pad || 0) * sc;
        vis.rotation = sprite.rotation;
        vis.setFlipX(sprite.flipX);
        vis.alpha = sprite.alpha;
        vis.visible = sprite.visible;
        vis.depth = sprite.depth;
        vis.scrollFactorX = sprite.scrollFactorX;
        vis.scrollFactorY = sprite.scrollFactorY;
        if (sprite.isTinted) {
          vis.tintFill = sprite.tintFill;
          vis.setTint(sprite.tintTopLeft, sprite.tintTopRight, sprite.tintBottomLeft, sprite.tintBottomRight);
        } else if (vis.isTinted) vis.clearTint();
      };
      scene.events.on("postupdate", sync);
      sprite.once("destroy", () => {
        scene.events.off("postupdate", sync);
        vis.destroy();
      });
      sync();
      return {
        animated: true,
        visual: vis,
        names: ctl.names,
        has: ctl.has,
        play: ctl.play,
        get current() {
          return ctl.current;
        },
        update(s) {
          manual = { ...(s || {}) };
        },
      };
    },
    /** Attach frame animation to physics sprites whose character has a sheet but that the game never animated. */
    _autoAnimate(game) {
      if (!manifestHasSheets(forge)) return;
      for (const sc of game.scene.getScenes(true)) {
        const list = sc.children?.list;
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const obj = list[i];
          if (obj.__forgeAnim || !obj.body || !obj.texture || (obj.type !== "Sprite" && obj.type !== "Image")) continue;
          if (obj.__forgeNoSheet === obj.texture.key) continue;
          const meta = this._sheetFor(sc, obj.texture.key);
          if (meta) this._sheetVisual(obj, meta);
          else obj.__forgeNoSheet = obj.texture.key;
        }
      }
    },
    puppet(sprite) {
      const scene = sprite.scene;
      const sheet = this._sheetFor(scene, String(sprite.texture.key));
      if (sheet) return this._sheetVisual(sprite, sheet);
      sprite.__forgeAnim = true;
      const vis = scene.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name).setOrigin(0.5, 1);
      sprite.renderWebGL = noRender;
      sprite.renderCanvas = noRender;
      const st = { vx: 0, vy: 0, grounded: true, attacking: false, hurt: false };
      let t = 0, wasGrounded = true, land = 0, atk = 0, face = sprite.flipX ? -1 : 1;
      const sync = () => {
        if (!sprite.active) return;
        if (vis.texture.key !== sprite.texture.key || vis.frame.name !== sprite.frame.name) vis.setTexture(sprite.texture.key, sprite.frame.name);
        const sx0 = Math.abs(sprite.scaleX), sy0 = Math.abs(sprite.scaleY);
        let sx = 1, sy = 1, rot = 0, bob = 0;
        const speed = Math.abs(st.vx);
        if (!st.grounded) {
          const k = clamp(Math.abs(st.vy) / 1100, 0, 0.16);
          sy += k;
          sx -= k * 0.6;
          rot = clamp(st.vx / 4000, -0.08, 0.08);
        } else if (speed > 25) {
          const ph = t * (8 + speed * 0.012);
          bob = Math.abs(Math.sin(ph)) * 0.05;
          sy -= bob * 0.5;
          sx += bob * 0.3;
          rot = clamp(st.vx / 3000, -0.1, 0.1) + Math.sin(ph) * 0.03;
        } else {
          const br = Math.sin(t * 2.4) * 0.022;
          sy += br;
          sx -= br * 0.5;
        }
        if (land > 0) {
          const k = land / 0.14;
          sx += 0.2 * k;
          sy -= 0.2 * k;
        }
        if (atk > 0) rot += face * 0.18 * (atk / 0.2);
        const dh = sprite.displayHeight;
        vis.x = sprite.x + (0.5 - sprite.originX) * sprite.displayWidth;
        vis.y = sprite.y + (1 - sprite.originY) * dh;
        vis.setScale(sx0 * sx, sy0 * sy);
        vis.rotation = sprite.rotation + rot;
        vis.setFlipX(sprite.flipX);
        vis.setFlipY(sprite.flipY);
        vis.alpha = sprite.alpha;
        vis.visible = sprite.visible;
        vis.depth = sprite.depth;
        vis.scrollFactorX = sprite.scrollFactorX;
        vis.scrollFactorY = sprite.scrollFactorY;
        vis.blendMode = sprite.blendMode;
        if (sprite.isTinted) {
          vis.tintFill = sprite.tintFill;
          vis.setTint(sprite.tintTopLeft, sprite.tintTopRight, sprite.tintBottomLeft, sprite.tintBottomRight);
        } else if (vis.isTinted) vis.clearTint();
      };
      scene.events.on("postupdate", sync);
      sprite.once("destroy", () => {
        scene.events.off("postupdate", sync);
        vis.destroy();
      });
      return {
        visual: vis,
        update(s, dt = 1 / 60) {
          Object.assign(st, s || {});
          t += dt;
          if (st.vx > 10) face = 1;
          else if (st.vx < -10) face = -1;
          if (st.grounded && !wasGrounded) land = 0.14;
          wasGrounded = !!st.grounded;
          land = Math.max(0, land - dt);
          if (st.attacking && atk <= 0) atk = 0.2;
          atk = Math.max(0, atk - dt);
        },
      };
    },
    parallax(scene, id, factor = 0.5, o = {}) {
      const meta = forge.assets.image(id);
      const tile = o.tile != null ? !!o.tile : !!meta?.seamless;
      const src = scene.textures.get(id).getSourceImage();
      const h = o.height ?? H;
      const s = h / Math.max(1, src.height);
      const cam = scene.cameras.main;
      // Non-seamless scenic backdrops must NOT wrap — tiling/duplicating them creates a hard vertical seam.
      if (!tile) {
        const img = scene.add
          .image(W / 2, o.y ?? 0, id)
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setDepth(o.depth ?? -100)
          .setDisplaySize(Math.max(W * 1.2, src.width * s), h);
        if (o.alpha != null) img.setAlpha(o.alpha);
        if (o.tint != null) img.setTint(toColor(o.tint));
        const maxShift = Math.max(0, (img.displayWidth - W) / 2);
        const upd = () => {
          if (!img.active) return;
          const shift = clamp(cam.scrollX * factor * 0.08, -maxShift, maxShift);
          img.x = W / 2 - shift;
          if (o.vertical) img.y = (o.y ?? 0) - cam.scrollY * factor * 0.05;
        };
        scene.events.on("update", upd);
        img.once("destroy", () => scene.events.off("update", upd));
        upd();
        return img;
      }
      const ts = scene.add
        .tileSprite(0, o.y ?? 0, W, h, id)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(o.depth ?? -100);
      ts.setTileScale(s, s);
      if (o.alpha != null) ts.setAlpha(o.alpha);
      if (o.tint != null) ts.setTint(toColor(o.tint));
      const upd = () => {
        if (!ts.active) return;
        ts.tilePositionX = (cam.scrollX * factor) / s;
        if (o.vertical) ts.tilePositionY = (cam.scrollY * factor) / s;
      };
      scene.events.on("update", upd);
      ts.once("destroy", () => scene.events.off("update", upd));
      return ts;
    },
    tiles(scene, id, x, y, w, h) {
      const meta = forge.assets.image(id);
      const src = scene.textures.get(id).getSourceImage();
      const s = h / Math.max(1, src.height);
      // Scenic (non-seamless) assets must never wrap — TileSprite seams are the classic "vertical cut".
      if (meta && meta.seamless === false) {
        const dw = Math.max(w * 1.35, src.width * s);
        const img = scene.add.image(x, y, id).setOrigin(0, 0).setDisplaySize(dw, h);
        let tx = 0;
        const max = Math.max(0, dw - w);
        Object.defineProperty(img, "tilePositionX", {
          get: () => tx,
          set: (v) => {
            tx = +v || 0;
            img.x = x - clamp(tx * 0.12, 0, max);
          },
        });
        Object.defineProperty(img, "tilePositionY", {
          get: () => 0,
          set: () => {},
        });
        Object.defineProperty(img, "tileScaleX", { get: () => s, set: () => {} });
        Object.defineProperty(img, "tileScaleY", { get: () => s, set: () => {} });
        img.setTileScale = () => img;
        return img;
      }
      const ts = scene.add.tileSprite(x, y, w, h, id).setOrigin(0, 0);
      ts.setTileScale(s, s);
      return ts;
    },
    burst(scene, x, y, o = {}) {
      const life = o.life ?? 550;
      const speed = o.speed ?? 240;
      const em = scene.add.particles(x, y, "forge-dot", {
        speed: { min: speed * 0.25, max: speed },
        angle: { min: 0, max: 360 },
        lifespan: { min: life * 0.6, max: life },
        scale: { start: (o.size ?? 1) * 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: toColor(o.color),
        gravityY: o.gravity ?? 280,
        blendMode: "ADD",
        emitting: false,
      });
      em.setDepth(o.depth ?? 50);
      em.explode(o.count ?? 18);
      scene.time.delayedCall(life + 200, () => em.destroy());
      return em;
    },
    trail(scene, target, o = {}) {
      const em = scene.add.particles(0, 0, "forge-dot", {
        follow: target,
        speed: 12,
        lifespan: o.life ?? 320,
        scale: { start: (o.size ?? 1) * 0.5, end: 0 },
        alpha: { start: 0.8, end: 0 },
        tint: toColor(o.color),
        blendMode: "ADD",
        frequency: o.frequency ?? 28,
      });
      em.setDepth((target.depth ?? 0) - 1);
      return em;
    },
    floatText(scene, x, y, text, o = {}) {
      const t = scene.add
        .text(x, y, String(text), {
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: `${o.size ?? 28}px`,
          fontStyle: "800",
          color: o.color ?? "#ffffff",
          stroke: "#000000",
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(o.depth ?? 60);
      scene.tweens.add({ targets: t, y: y - 70, alpha: 0, duration: 900, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
      return t;
    },
  };
}
