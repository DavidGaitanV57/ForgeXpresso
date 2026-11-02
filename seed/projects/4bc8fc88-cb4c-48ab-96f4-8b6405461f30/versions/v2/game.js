export default function createGame(forge, Phaser) {
  const W = 1280, H = 720;
  const C = { cyan: 0x00e5ff, pink: 0xff3d81, orange: 0xffb300, green: 0x7cff4f, white: 0xf4f1ff, indigo: 0x2b1b5e };
  const PU = {
    red: { tex: "powerup_red", col: 0xff3d81, name: "Abanico" },
    blue: { tex: "powerup_blue", col: 0x00e5ff, name: "Escudo" },
    green: { tex: "powerup_green", col: 0x7cff4f, name: "Misiles" }
  };
  const HUD_KEYS = ["score", "lives", "bomb", "weapons", "shield", "boss"];
  const FAN = [[0], [-9, 0, 9], [-16, -8, 0, 8, 16], [-21, -12, -4, 4, 12, 21]].map(a => a.map(d => d * Math.PI / 180));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, f) => (typeof v === "number" && isFinite(v) ? v : f);
  const T = (k, f) => num(forge.tune(k, f), f);
  const rnd = (a, b) => a + (b - a) * forge.rand();
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeSine = t => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const fmt = s => { s = Math.floor(Math.max(0, num(s, 0))); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // Cinematic direction: exactly 3 shots, one per narration line (camera/parallax staging only;
  // the runtime owns letterbox, subtitles, skip control and narration voice).
  const CINE_SHOTS = [
    {
      line: 0, start: 0, duration: 4,
      camFrom: { x: 560, y: 360, zoom: 1.0 }, camTo: { x: 860, y: 330, zoom: 1.15 },
      parallax: { nebula: 14, planets: 34 }, ease: "sineInOut",
      focus: "Paneo lento y amplio por la nebulosa mientras las estrellas se apagan y la sombra imperial asoma"
    },
    {
      line: 1, start: 4, duration: 4,
      camFrom: { x: 860, y: 330, zoom: 1.15 }, camTo: { x: 300, y: 390, zoom: 1.4 },
      parallax: { nebula: 26, planets: 150 }, ease: "sineInOut",
      focus: "Travelling desde los planetas lejanos y la flota hasta el Colibrí-9 en primer plano"
    },
    {
      line: 2, start: 8, duration: 4,
      camFrom: { x: 300, y: 390, zoom: 1.4 }, camTo: { x: 640, y: 360, zoom: 1.0 },
      parallax: { nebula: 45, planets: 260 }, ease: "sineInOut",
      focus: "Retroceso a zoom 1.0 empujando hacia el planeta rebelde, parallax acelerando y leve sacudida final"
    }
  ];
  const CINE_LEN = 12;

  let sceneRef = null;

  class Pool {
    constructor(scene, key, depth, add) { this.s = scene; this.key = key; this.depth = depth; this.add = add; this.items = []; }
    get(x, y) {
      let o = null;
      for (let i = 0; i < this.items.length; i++) if (!this.items[i].active) { o = this.items[i]; break; }
      if (!o) {
        o = this.s.add.image(x, y, this.key).setDepth(this.depth);
        if (this.add) o.setBlendMode(Phaser.BlendModes.ADD);
        this.items.push(o);
      }
      return o.setActive(true).setVisible(true).setPosition(x, y).setAlpha(1).setRotation(0).setScale(1).clearTint();
    }
    kill(o) { o.setActive(false).setVisible(false); }
  }

  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      sceneRef = this;
      this.ready = false;
      const ADD = Phaser.BlendModes.ADD;
      this.makeTextures();
      this.cameras.main.setBounds(0, 0, W, H);

      // ---- scrolling backgrounds (tileSprites when the asset is seamless; seam-free drifting image otherwise)
      this.scenic = [];
      this.neb = this.makeLayer("bg_nebula", -10, 1, 0.08, 20, 0, false);
      this.fog = this.makeLayer("bg_nebula", -9, 0, 0.12, 34, C.pink, true);
      if (this.fog.o.setFlipY) this.fog.o.setFlipY(true);
      this.mid = this.makeLayer("bg_planets", -8, 0.6, 0.25, 60, 0, true);
      this.stars = [];
      const s1 = this.add.tileSprite(0, 0, W, H, "fx_stars").setOrigin(0, 0).setDepth(-7).setAlpha(0.5).setScrollFactor(0);
      s1.spd = 100; s1.baseA = 0.5; this.stars.push(s1);
      const s2 = this.add.tileSprite(0, 0, W, H, "fx_stars").setOrigin(0, 0).setDepth(-6).setScrollFactor(0).setTileScale(1.6, 1.6);
      s2.tilePositionY = 200; s2.spd = 240; s2.baseA = 1; this.stars.push(s2);
      this.bgMul = 1;

      this.danger = this.add.rectangle(W / 2, H / 2, W, H, 0xff1040, 1).setDepth(30).setAlpha(0);
      this.fxG = this.add.graphics().setDepth(9);
      this.pb = new Pool(this, "fx_pbullet", 5, true);
      this.ms = new Pool(this, "fx_missile", 5, true);
      this.eb = new Pool(this, "enemy_bullet", 8, false);

      const P = this.physics.add.sprite(200, H / 2, "player_ship");
      forge.phaser.fit(P, 78);
      forge.phaser.body(P, { w: 0.6, h: 0.6 });
      P.setDepth(7).setCollideWorldBounds(true);
      this.player = P;
      this.puppet = forge.phaser.puppet(P);
      this.glow = this.add.image(P.x, P.y, "fx_glow").setBlendMode(ADD).setDepth(6);
      this.ring = this.add.image(P.x, P.y, "fx_ring").setBlendMode(ADD).setDepth(8).setTint(C.cyan).setVisible(false);
      this.muzzle = this.add.image(P.x, P.y, "fx_glow").setBlendMode(ADD).setDepth(8).setTint(C.cyan).setAlpha(0);
      this.engine = this.add.particles(0, 0, "fx_dot", {
        speedX: { min: -340, max: -180 }, speedY: { min: -25, max: 25 }, lifespan: 260,
        scale: { start: 0.9, end: 0 }, alpha: { start: 0.9, end: 0 },
        tint: [C.cyan, 0xffffff, C.orange], blendMode: "ADD", frequency: 18
      }).setDepth(6);
      this.engine.startFollow(P, -P.displayWidth * 0.42, 2);
      this.keyB = this.input.keyboard ? this.input.keyboard.addKey("B") : null;

      this.score = 0; this.best = num(forge.load("nova_best", 0), 0);
      this.livesTune = Math.round(clamp(T("playerLives", 3), 1, 9));
      this.lives = this.livesTune;
      this.bombs = 1; this.red = 0; this.green = 0; this.blue = 0; this.shield = 0;
      this.invuln = 1.5; this.hurtT = 0; this.fireCd = 0; this.misCd = 0; this.sparkCd = 0;
      this.stage = "s1"; this.stageNo = 1; this.stageT = 0; this.totalT = 0;
      this.waveT = 1.5; this.waveI = 0; this.astT = 6; this.kills = 0;
      this.ended = false; this.dead = false; this.flyOut = false;
      this.dropBlue = false; this.dropGreen = false; this.drop2 = false; this.gunIntro = false;
      this.enemies = []; this.pows = []; this.lasers = []; this.boss = null; this.nextBoss = 1;
      this._h = {};

      this.started = false; this.preT = 0;
      this.cineOn = false; this.cineT = 0; this.cf = {}; this.cp = null; this.lastExt = -99;

      const cleanup = () => {
        try { for (const k of HUD_KEYS) forge.hud.remove(k); } catch (e) { /* noop */ }
        this.destroyCineProps();
        if (sceneRef === this) sceneRef = null;
      };
      this.events.once("shutdown", cleanup);
      this.events.once("destroy", cleanup);
      this.ready = true;
    }

    makeTextures() {
      const mk = (key, w, h, draw) => {
        if (this.textures.exists(key)) return;
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        draw(g); g.generateTexture(key, w, h); g.destroy();
      };
      mk("fx_dot", 16, 16, g => { for (let r = 8; r >= 1; r--) { g.fillStyle(0xffffff, 0.15); g.fillCircle(8, 8, r); } g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 3); });
      mk("fx_glow", 64, 64, g => { for (let r = 32; r >= 2; r -= 2) { g.fillStyle(0xffffff, 0.055); g.fillCircle(32, 32, r); } });
      mk("fx_ring", 64, 64, g => { g.lineStyle(6, 0xffffff, 0.25); g.strokeCircle(32, 32, 26); g.lineStyle(3, 0xffffff, 0.95); g.strokeCircle(32, 32, 29); });
      mk("fx_pbullet", 34, 12, g => {
        g.fillStyle(0x00e5ff, 0.35); g.fillRoundedRect(0, 0, 34, 12, 6);
        g.fillStyle(0x00e5ff, 1); g.fillRoundedRect(3, 2, 28, 8, 4);
        g.fillStyle(0xffffff, 1); g.fillRoundedRect(10, 4, 20, 4, 2);
      });
      mk("fx_missile", 26, 12, g => {
        g.fillStyle(0x7cff4f, 0.35); g.fillRoundedRect(0, 0, 26, 12, 6);
        g.fillStyle(0x7cff4f, 1); g.fillRoundedRect(3, 2, 20, 8, 4);
        g.fillStyle(0xffffff, 1); g.fillRect(17, 4, 6, 4);
        g.fillStyle(0xffb300, 1); g.fillRect(0, 4, 4, 4);
      });
      mk("fx_stars", 512, 512, g => {
        for (let i = 0; i < 170; i++) {
          g.fillStyle(0xffffff, 0.3 + forge.rand() * 0.7);
          const s = forge.rand() < 0.85 ? 1 : 2;
          g.fillRect(Math.floor(forge.rand() * 512), Math.floor(forge.rand() * 512), s, s);
        }
      });
      mk("fx_planet", 256, 256, g => {
        for (let r = 128; r > 98; r -= 3) { g.fillStyle(0x00e5ff, 0.045); g.fillCircle(128, 128, r); }
        g.fillStyle(0x16594f, 1); g.fillCircle(128, 128, 96);
        g.fillStyle(0x7cff4f, 0.75); g.fillEllipse(100, 100, 62, 30); g.fillEllipse(150, 150, 70, 34); g.fillEllipse(118, 172, 40, 18);
        g.fillStyle(0xf4f1ff, 0.35); g.fillEllipse(140, 80, 80, 12); g.fillEllipse(96, 140, 60, 10);
        g.lineStyle(4, 0x00e5ff, 0.9); g.strokeCircle(128, 128, 96);
      });
    }

    makeLayer(id, depth, alpha, factor, spd, tint, add) {
      let o = null;
      try { o = forge.phaser.tiles(this, id, 0, 0, W, H); } catch (e) { o = null; }
      if (!o) o = this.add.image(0, 0, id);
      const isTile = typeof o.tilePositionX === "number";
      let th = 0;
      try { const src = this.textures.get(id).getSourceImage(); th = num(src && src.height, 0); } catch (e) { th = 0; }
      if (!th) { const a = forge.assets.image(id); th = num(a && a.height, H) || H; }
      if (isTile) {
        o.setOrigin(0, 0).setPosition(0, 0);
        const s = H / th;
        if (o.setTileScale) o.setTileScale(s, s);
      } else {
        o.setOrigin(0.5, 0.5).setPosition(W / 2, H / 2);
        o.setDisplaySize(W * 1.14, H * 1.14);
      }
      o.setScrollFactor(0).setDepth(depth).setAlpha(alpha);
      if (tint) o.setTint(tint);
      if (add) o.setBlendMode(Phaser.BlendModes.ADD);
      const L = { o, isTile, acc: 0, factor, spd, margin: W * 0.07 };
      this.scenic.push(L);
      return L;
    }

    applyLayer(L, camX) {
      if (L.isTile) L.o.tilePositionX = (L.acc + camX * L.factor) / (L.o.tileScaleX || 1);
      else {
        const m = L.margin * 0.95;
        const d = clamp(Math.sin(L.acc / 420) * m * 0.7 + camX * L.factor * 0.5, -m, m);
        L.o.x = W / 2 - d;
      }
    }

    scrollBg(dt) {
      for (const L of this.scenic) { L.acc += L.spd * this.bgMul * dt; this.applyLayer(L, 0); }
      for (const s of this.stars) s.tilePositionX += (s.spd * this.bgMul * dt) / (s.tileScaleX || 1);
    }

    update(time, delta) {
      if (forge.paused) return;
      const dt = Math.min(num(delta, 16), 50) / 1000;
      if (!(dt > 0)) return;
      const cine = forge.cinematic;
      if (cine && cine.active) {
        // Fallback driver in case the runtime does not call onCinematic this frame.
        if (this.game.loop.frame - this.lastExt > 2) this.cineStep(dt, cine);
        return;
      }
      if (this.cineOn) this.cineEnd();

      const m = this.flyOut ? 3 : this.stage === "boss" ? 0.55 : this.stageNo === 2 ? 1.35 : 1;
      this.bgMul += (m - this.bgMul) * Math.min(1, dt * 1.5);
      this.scrollBg(dt);

      if (!this.started) {
        this.preT += dt;
        this.shipFx(dt, 0);
        this.puppet.update({ vx: 0, vy: 0, grounded: true, attacking: false, hurt: false }, dt);
        if (this.preT >= 0.15) this.beginPlay();
        return;
      }

      if (!this.ended) {
        const lt = Math.round(clamp(T("playerLives", 3), 1, 9));
        if (lt !== this.livesTune) { this.lives = Math.max(1, this.lives + lt - this.livesTune); this.livesTune = lt; }
      }

      this.totalT += dt; this.stageT += dt;
      if (this.sparkCd > 0) this.sparkCd -= dt;
      this.updatePlayer(dt);
      this.updateDirector(dt);
      this.updateEnemies(dt);
      this.updateBoss(dt);
      this.updateShots(dt);
      this.updateEBullets(dt);
      this.updateLasers(dt);
      this.updatePows(dt);
      this.updateHud();
    }

    beginPlay() {
      if (this.started) return;
      this.started = true;
      this.stage = "s1"; this.stageNo = 1; this.stageT = 0; this.waveI = 0; this.waveT = 1.5; this.astT = 6;
      this.invuln = Math.max(this.invuln, 1.2);
      forge.audio.music("music_main", { volume: 0.55 });
      forge.hud.message("Mover: Flechas/WASD · Disparar: mantén Espacio · Bomba: Shift / B", 4200);
    }

    // ---------------------------------------------------------------- cinematic (camera / parallax / staging only)
    cineBegin() {
      this.cineOn = true; this.cineT = 0; this.cf = {};
      const cam = this.cameras.main;
      cam.stopFollow();
      if (cam.removeBounds) cam.removeBounds();
      try { for (const k of HUD_KEYS) forge.hud.remove(k); } catch (e) { /* noop */ }
      this._h = {};
      if (this.boss) this.boss.lastR = -1;
      this.danger.setAlpha(0);
      this.lasers.length = 0; this.fxG.clear();
      if (this.player.body) this.player.body.setVelocity(0, 0);

      const ADD = Phaser.BlendModes.ADD;
      const sil = [];
      const defs = [["boss_dreadnought", 1010, 240, 300], ["boss_hive", 1180, 480, 260]];
      for (let k = 0; k < defs.length; k++) {
        const d = defs[k];
        const s = this.add.image(d[1], d[2], d[0]).setDepth(-5).setFlipX(true).setScrollFactor(0.55).setAlpha(0);
        forge.phaser.fit(s, d[3]);
        s.setTint(C.indigo);
        const g = this.add.image(d[1], d[2], "fx_glow").setDepth(-4.9).setScrollFactor(0.55).setBlendMode(ADD)
          .setTint(k ? C.orange : C.pink).setAlpha(0).setScale(1.4);
        sil.push({ s, g, bx: d[1], by: d[2], k });
      }
      const planet = this.add.image(1080, 330, "fx_planet").setDepth(-5.5).setScrollFactor(0.35).setAlpha(0);
      planet.baseScale = 1.1; planet.setScale(1.1);
      const orbs = ["red", "blue", "green"].map(kind => {
        const s = this.add.image(-300, -300, PU[kind].tex).setDepth(9);
        forge.phaser.fit(s, 44);
        const g = this.add.image(-300, -300, "fx_glow").setDepth(8.9).setBlendMode(ADD).setTint(PU[kind].col).setScale(1.5);
        return { s, g, col: PU[kind].col };
      });
      this.cp = { sil, planet, orbs };
    }

    destroyCineProps() {
      const cp = this.cp; if (!cp) return;
      for (const o of cp.sil) { o.s.destroy(); o.g.destroy(); }
      cp.planet.destroy();
      for (const o of cp.orbs) { o.s.destroy(); o.g.destroy(); }
      this.cp = null;
    }

    cineStep(dt, cine) {
      if (!this.ready) return;
      if (!cine || !cine.active) { if (this.cineOn) this.cineEnd(); return; }
      if (!this.cineOn) this.cineBegin();
      this.cineT += dt;
      const dur = num(cine.duration, CINE_LEN);
      const sc = dur > 2 ? dur / CINE_LEN : 1;
      const tt = (typeof cine.t === "number" && isFinite(cine.t) ? cine.t : this.cineT) / sc;
      let i = 0;
      for (let k = 0; k < CINE_SHOTS.length; k++) if (tt >= CINE_SHOTS[k].start) i = k;
      const sh = CINE_SHOTS[i];
      const t = clamp((tt - sh.start) / sh.duration, 0, 1), e = easeSine(t);

      // camera
      const cam = this.cameras.main;
      cam.setZoom(clamp(lerp(sh.camFrom.zoom, sh.camTo.zoom, e), 0.5, 3));
      cam.centerOn(lerp(sh.camFrom.x, sh.camTo.x, e), lerp(sh.camFrom.y, sh.camTo.y, e));

      // parallax (continuous motion, speeds blend from the previous shot)
      const prev = i > 0 ? CINE_SHOTS[i - 1].parallax : { nebula: sh.parallax.nebula * 0.6, planets: sh.parallax.planets * 0.6 };
      const pn = lerp(prev.nebula, sh.parallax.nebula, e), pp = lerp(prev.planets, sh.parallax.planets, e);
      this.neb.acc += pn * dt; this.fog.acc += pn * 1.4 * dt; this.mid.acc += pp * dt;
      const cx = num(cam.scrollX, 0);
      for (const L of this.scenic) this.applyLayer(L, cx);
      const starK = pp / 60;
      const dim = i === 0 ? lerp(1, 0.22, e) : i === 1 ? 0.22 : lerp(0.22, 1, e);
      for (let k = 0; k < this.stars.length; k++) {
        const s = this.stars[k];
        s.tilePositionX += (s.spd * 0.5 * starK * dt) / (s.tileScaleX || 1);
        s.setAlpha(s.baseA * dim * (0.85 + 0.15 * Math.sin(this.cineT * (17 + k * 9))));
      }

      // hero staging
      const P = this.player;
      let boost = 0;
      if (!this.dead && P.body) {
        let px = 200, vx = 0;
        if (i === 0) px = -220;
        else if (i === 1) { const k = easeSine(clamp(t / 0.75, 0, 1)); px = lerp(-140, 200, k); vx = k < 1 ? 300 : 0; boost = 0.1; }
        else { px = 200 + Math.sin(e * Math.PI) * 45; vx = Math.cos(e * Math.PI) * 120; boost = 0.15 + e * 0.6; }
        const py = H / 2 + Math.sin(this.cineT * Math.PI * 2 / 1.2) * 6;
        P.body.reset(px, py);
        P.setAlpha(1).setVisible(true);
        this.puppet.update({ vx, vy: 0, grounded: true, attacking: false, hurt: false }, dt);
        this.shipFx(dt, boost);
      }

      // props
      const cp = this.cp;
      if (cp) {
        let sa = 0, creep = 0;
        if (i === 0) { sa = clamp((t - 0.35) / 0.65, 0, 1) * 0.85; creep = (1 - e) * 260; }
        else if (i === 1) sa = 0.85;
        else sa = (1 - e) * 0.85;
        for (const o of cp.sil) {
          const x = o.bx + creep, y = o.by + Math.sin(this.cineT * 0.8 + o.k * 2) * 6;
          o.s.setPosition(x, y).setAlpha(sa).setRotation(Math.sin(this.cineT * 0.5 + o.k) * 0.015);
          const pulse = 0.65 + 0.35 * Math.sin(this.cineT * 4 + o.k * 1.7);
          o.g.setPosition(x - o.s.displayWidth * 0.3, y).setAlpha(sa * pulse);
        }
        const pa = i === 2 ? Math.sin(e * Math.PI) * 0.9 : 0;
        cp.planet.setAlpha(pa).setScale(cp.planet.baseScale * (1 + (i === 2 ? e * 0.3 : 0)));
        for (let k = 0; k < cp.orbs.length; k++) {
          const o = cp.orbs[k];
          if (i === 2 && t < 0.75) {
            const x = W + 80 + k * 170 - (t / 0.75) * (W + 620);
            const y = 300 + k * 60 + Math.sin(this.cineT * 3 + k) * 8;
            o.s.setVisible(true).setPosition(x, y).setRotation(this.cineT * 2);
            o.g.setVisible(true).setPosition(x, y).setAlpha(0.6 + 0.3 * Math.sin(this.cineT * 7 + k));
            if (Math.abs(x - P.x) < 90) this.glow.setTint(o.col);
          } else { o.s.setVisible(false); o.g.setVisible(false); }
        }
      }

      // one-shot beats
      if (i === 2 && t > 0.45 && !this.cf.ignite && !this.dead) {
        this.cf.ignite = true;
        forge.phaser.burst(this, P.x - P.displayWidth * 0.45, P.y, { color: C.cyan, count: 26, speed: 300, life: 500, size: 6 });
        const r = this.add.image(P.x, P.y, "fx_ring").setBlendMode(Phaser.BlendModes.ADD).setDepth(9).setTint(C.cyan).setScale(0.6);
        this.tweens.add({ targets: r, scale: 7, alpha: 0, duration: 650, ease: "Cubic.easeOut", onComplete: () => r.destroy() });
      }
      if (i === 2 && t > 0.88 && !this.cf.shake) { this.cf.shake = true; forge.shake(0.22); }
      if (num(cine.progress, 0) >= 0.999 && !this.cf.fin && typeof cine.finish === "function") {
        this.cf.fin = true;
        try { cine.finish(); } catch (err) { /* noop */ }
      }
    }

    cineEnd() {
      this.cineOn = false;
      this.destroyCineProps();
      const cam = this.cameras.main;
      if (cam.resetFX) cam.resetFX();
      cam.stopFollow();
      cam.setZoom(1);
      cam.setBounds(0, 0, W, H);
      cam.setScroll(0, 0);
      for (const L of this.scenic) { L.acc = 0; this.applyLayer(L, 0); }
      for (const s of this.stars) { s.tilePositionX = 0; s.setAlpha(s.baseA); }
      this.bgMul = 1;
      if (!this.dead && this.player.body) {
        this.player.body.reset(200, H / 2);
        this.player.setAlpha(1).setVisible(true);
        this.invuln = Math.max(this.invuln, 1);
      }
      if (this.keyB) Phaser.Input.Keyboard.JustDown(this.keyB);
      this._h = {};
      if (this.boss) this.boss.lastR = -1;
      if (!this.started) this.beginPlay();
      else if (!this.ended) forge.audio.music("music_main", { volume: 0.55 });
    }

    // ---------------------------------------------------------------- player
    shipFx(dt, boost) {
      const P = this.player;
      const pw = this.red + this.green + this.blue, t = this.time.now / 1000;
      const fl = 0.88 + 0.18 * Math.sin(t * 38) + 0.06 * Math.sin(t * 13);
      this.glow.setPosition(P.x - P.displayWidth * 0.44, P.y + 2).setScale((0.5 + pw * 0.09 + boost) * fl)
        .setTint(pw >= 6 ? C.orange : pw >= 3 ? C.green : C.cyan).setAlpha(Math.min(1, 0.6 + pw * 0.05 + boost * 0.4));
      if (this.shield > 0 && P.visible) {
        this.ring.setVisible(true).setPosition(P.x, P.y).setScale(P.displayHeight * 1.55 / 64).setAlpha(0.45 + 0.3 * Math.sin(t * 6));
        this.ring.rotation += dt * 1.5;
      } else this.ring.setVisible(false);
      this.muzzle.setPosition(P.x + P.displayWidth * 0.45, P.y + 2).setAlpha(Math.max(0, this.muzzle.alpha - dt * 10));
    }

    updatePlayer(dt) {
      const P = this.player, b = P.body;
      if (this.dead) return;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.hurtT > 0) this.hurtT -= dt;
      let vx, vy, shooting = false;
      const cvx = num(b.velocity.x, 0), cvy = num(b.velocity.y, 0);
      if (this.flyOut) {
        vx = Math.min(1100, cvx + 1500 * dt); vy = cvy * 0.9; P.setAlpha(1);
      } else {
        const ax = forge.input.axis();
        let ix = num(ax && ax.x, 0), iy = num(ax && ax.y, 0);
        const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
        const sp = clamp(T("playerSpeed", 380), 50, 1500), k = 1 - Math.exp(-dt * 15);
        vx = cvx + (ix * sp - cvx) * k; vy = cvy + (iy * sp - cvy) * k;
        P.setAlpha(this.invuln > 0 && Math.floor(this.time.now / 55) % 2 ? 0.25 : 1);
        shooting = forge.input.down("jump") || forge.input.down("action");
        this.fireCd -= dt; this.misCd -= dt;
        if (shooting && !this.ended) {
          const rate = clamp(T("fireRate", 160), 40, 1000);
          if (this.fireCd <= 0) { this.fireCd = rate * (this.red >= 3 ? 0.85 : 1) / 1000; this.fireBullets(); }
          if (this.green > 0 && this.misCd <= 0) { this.misCd = Math.max(0.35, rate * 3 / 1000); this.fireMissiles(); }
        }
        if (forge.input.pressed("action2") || (this.keyB && Phaser.Input.Keyboard.JustDown(this.keyB))) this.useBomb();
      }
      b.setVelocity(num(vx, 0), num(vy, 0));
      this.puppet.update({ vx, vy, grounded: true, attacking: shooting, hurt: this.hurtT > 0 }, dt);
      this.shipFx(dt, this.flyOut ? 0.6 : 0);
    }

    fireBullets() {
      const P = this.player, x = P.x + P.displayWidth * 0.4, y = P.y + 2;
      const angs = FAN[clamp(this.red, 0, 3)];
      for (const a of angs) {
        const b = this.pb.get(x, y);
        b.vx = Math.cos(a) * 1050; b.vy = Math.sin(a) * 1050; b.rotation = a; b.dmg = this.red >= 3 ? 1.25 : 1;
      }
      this.muzzle.setAlpha(1).setScale(0.55);
      forge.audio.play("sfx_shoot", { volume: 0.16, rate: rnd(0.95, 1.08) });
    }

    fireMissiles() {
      const P = this.player;
      for (let k = 0; k < this.green; k++) {
        const side = k % 2 ? 1 : -1, row = 1 + Math.floor(k / 2);
        const m = this.ms.get(P.x, P.y + side * 14 * row);
        m.ang = side * (0.7 + 0.25 * row); m.speed = 360; m.life = 3; m.tgt = null; m.rt = 0;
        m.setScale(1.1);
      }
      forge.audio.play("sfx_shoot", { volume: 0.12, rate: 0.6 });
    }

    useBomb() {
      if (this.dead || this.ended) return;
      if (this.bombs <= 0) { forge.hud.message("Sin bombas (1 por vida)", 900); return; }
      this.bombs--;
      const n = this.clearBullets(true);
      this.lasers.length = 0;
      this.score += n * 10;
      const len = this.enemies.length;
      for (let i = 0; i < len; i++) { const e = this.enemies[i]; if (e && e.alive && e.x < W + 30) this.damageEnemy(e, 14); }
      const B = this.boss;
      if (B && B.state === "fight") {
        for (const w of B.wps) if (w.shieldMax) { w.shield = 0; w.regenT = 3; }
        this.damageBoss(B, 25);
      }
      this.invuln = Math.max(this.invuln, 1.2);
      this.cameras.main.flash(350, 255, 240, 255);
      forge.shake(0.8);
      forge.audio.play("sfx_explosion", { volume: 1, rate: 0.6 });
      const P = this.player;
      const r = this.add.image(P.x, P.y, "fx_ring").setBlendMode(Phaser.BlendModes.ADD).setDepth(9).setScale(0.5);
      this.tweens.add({ targets: r, scale: 30, alpha: 0, duration: 550, ease: "Cubic.easeOut", onComplete: () => r.destroy() });
      forge.phaser.burst(this, P.x, P.y, { color: C.white, count: 30, speed: 420, life: 600, size: 6 });
      forge.hud.message("¡BOMBA!", 800);
    }

    hurtPlayer() {
      if (this.dead || this.ended || this.invuln > 0) return;
      const P = this.player;
      this.hurtT = 0.35;
      if (this.shield > 0) {
        this.shield--; this.invuln = 0.9;
        forge.audio.play("sfx_hit", { volume: 0.6, rate: 1.3 });
        forge.shake(0.25);
        forge.phaser.burst(this, P.x, P.y, { color: C.cyan, count: 18, speed: 260, life: 400, size: 5 });
        if (this.shield === 0) forge.hud.message("¡Escudo agotado!", 1000);
        return;
      }
      this.lives--;
      forge.audio.play("sfx_hit", { volume: 0.9 });
      forge.shake(0.6);
      forge.phaser.burst(this, P.x, P.y, { color: C.pink, count: 26, speed: 320, life: 600, size: 7 });
      if (this.lives <= 0) { this.playerDie(); return; }
      const mx = Math.max(this.red, this.green, this.blue);
      if (mx > 0) {
        if (this.red === mx) this.red--; else if (this.green === mx) this.green--;
        else { this.blue--; this.shield = Math.min(this.shield, this.blue ? 2 + this.blue : 0); }
      }
      this.bombs = 1; this.invuln = 2.2;
      this.clearBullets(false, P.x, P.y, 170);
      this.cameras.main.flash(160, 255, 60, 120);
      forge.hud.message(mx > 0 ? `¡Impacto! -1 nivel de arma · Vidas: ${this.lives}` : `¡Impacto! Vidas: ${this.lives}`, 1400);
    }

    playerDie() {
      if (this.ended) return;
      this.dead = true; this.ended = true; this.lives = 0;
      const P = this.player, x = P.x, y = P.y;
      P.body.setVelocity(0, 0); P.body.enable = false; P.setVisible(false);
      this.engine.stop(); this.glow.setVisible(false); this.ring.setVisible(false);
      for (let i = 0; i < 4; i++) this.time.delayedCall(i * 160, () => {
        forge.phaser.burst(this, x + rnd(-30, 30), y + rnd(-30, 30), { color: i % 2 ? C.orange : C.pink, count: 28, speed: 340, life: 700, size: 8 });
        forge.audio.play("sfx_explosion", { volume: 0.8, rate: rnd(0.7, 1) });
      });
      forge.shake(1);
      forge.audio.stopMusic();
      forge.audio.play("sfx_gameover", { volume: 0.9 });
      this.saveBest();
      const stats = { "Puntuación": this.score, "Mejor": this.best, "Enemigos": this.kills, "Tiempo": fmt(this.totalT) };
      this.time.delayedCall(1900, () => forge.lose({ title: "Colibrí-9 derribado", subtitle: "La flota imperial mantiene el bloqueo… ¡inténtalo de nuevo!", stats }));
    }

    victory() {
      if (this.ended) return;
      this.ended = true; this.flyOut = true; this.invuln = 999;
      this.player.setCollideWorldBounds(false);
      forge.audio.stopMusic();
      forge.audio.play("sfx_victory", { volume: 0.9 });
      forge.hud.message("¡BLOQUEO ROTO! El camino a casa está libre", 2600);
      this.score += this.lives * 1000;
      this.saveBest();
      const stats = { "Puntuación": this.score, "Mejor": this.best, "Enemigos": this.kills, "Vidas restantes": this.lives, "Tiempo": fmt(this.totalT) };
      this.time.delayedCall(2800, () => forge.win({ title: "¡Victoria rebelde!", subtitle: "Colibrí-9 ha destruido la Colmena Nodriza", stats }));
    }

    saveBest() { if (this.score > this.best) { this.best = this.score; forge.save("nova_best", this.best); } }

    // ---------------------------------------------------------------- director
    updateDirector(dt) {
      const st = this.stage;
      if (st === "s1" || st === "s2") {
        const len = st === "s1" ? 100 : 90;
        if (this.stageT < len) {
          this.waveT -= dt;
          if (this.waveT <= 0) {
            const cost = st === "s1" ? this.wave1() : this.wave2();
            this.waveT = Math.max(0.6, cost * clamp(T("spawnInterval", 1400), 200, 6000) / 1000);
          }
          this.astT -= dt;
          if (this.astT <= 0) { this.spawnAsteroid(); this.astT = st === "s1" ? rnd(2.8, 5) : rnd(1.5, 3); }
        } else {
          let threats = 0;
          for (const e of this.enemies) if (e.alive && e.type !== "asteroid") threats++;
          if (threats === 0 || this.stageT > len + 8) {
            this.stage = "warn"; this.stageT = 0; this.nextBoss = st === "s1" ? 1 : 2;
            forge.audio.play("sfx_boss_alarm", { volume: 0.8 });
            forge.hud.message("⚠ ¡PELIGRO! ⚠  Nave nodriza aproximándose", 3000);
            forge.shake(0.2);
          }
        }
      } else if (st === "warn") {
        this.danger.setAlpha(0.16 * (0.5 + 0.5 * Math.sin(this.stageT * 9)));
        if (this.stageT >= 3.2) { this.danger.setAlpha(0); this.stage = "boss"; this.stageT = 0; this.spawnBoss(this.nextBoss); }
      } else if (st === "rest" && this.stageT >= 8) {
        this.stage = "s2"; this.stageNo = 2; this.stageT = 0; this.waveI = 0; this.waveT = 1.5; this.astT = 2;
        forge.hud.message("TRAMO 2 · Nebulosa Escarlata", 2400);
        this.tweens.add({ targets: this.fog.o, alpha: 0.32, duration: 3000 });
        this.mid.o.setTint(0xffb0d0);
      }
    }

    grp(drop) { return { alive: 0, killed: 0, drop: drop || null, dropped: false, lx: 0, ly: 0 }; }
    wLine(n, y, sm, drop) { const g = this.grp(drop); for (let i = 0; i < n; i++) this.spawnEnemy("drone", W + 50 + i * 85, y, { amp: 30, freq: 2.2, phase: i * 0.7, sm, g }); }
    wV(n, y, sm, drop) {
      const g = this.grp(drop);
      for (let i = 0; i < n; i++) { const k = i - (n - 1) / 2; this.spawnEnemy("drone", W + 50 + Math.abs(k) * 75, y + k * 58, { amp: 18, freq: 1.8, sm, g }); }
    }
    wSnake(n, y, sm, drop) { const g = this.grp(drop); for (let i = 0; i < n; i++) this.spawnEnemy("drone", W + 50 + i * 70, y, { amp: 150, freq: 1.7, phase: -i * 0.55, sm, g }); }
    wGun(n, burst, drop) {
      const g = this.grp(drop), span = H - 260;
      for (let k = 0; k < n; k++) {
        const y = 130 + (n === 1 ? span / 2 + rnd(-120, 120) : (k * span) / (n - 1)) + rnd(-30, 30);
        this.spawnEnemy("gunner", W + 70 + k * 50, y, { stopX: rnd(960, 1150), burst, hold: this.stageNo === 2 ? 5.5 : 4.5, g });
      }
    }

    wave1() {
      const t = this.stageT, i = this.waveI++, r = forge.rand(), sm = 1 + t / 700;
      let drop = null;
      if (!this.dropBlue && t >= 58) { drop = "blue"; this.dropBlue = true; }
      else if (!this.dropGreen && t >= 80) { drop = "green"; this.dropGreen = true; }
      if (i === 0) { this.wLine(3, H / 2, 1, "red"); return 2.3; }
      if (i === 1) { this.wLine(3, 200, 1, drop); return 1.9; }
      if (i === 2) { this.wLine(3, 520, 1, drop); return 1.9; }
      if (i === 3) { this.wV(5, H / 2, 1, drop); return 2.1; }
      if (t < 50) {
        if (r < 0.4) this.wV(5, rnd(200, 520), sm, drop);
        else if (r < 0.7) this.wSnake(5, rnd(240, 480), sm, drop);
        else { this.wLine(3, rnd(120, 300), sm, drop); this.wLine(3, rnd(420, 600), sm, null); }
        return 2.1;
      }
      if (!this.gunIntro) { this.gunIntro = true; forge.hud.message("¡Cañoneros imperiales! Se detienen a disparar", 2500); this.wGun(2, 1, drop); return 2.3; }
      if (r < 0.28) this.wGun(t > 78 ? 3 : 2, 1, drop);
      else if (r < 0.5) this.wV(t > 78 ? 7 : 5, rnd(220, 500), sm, drop);
      else if (r < 0.7) { this.wSnake(6, rnd(240, 480), sm, drop); this.wGun(1, 1, null); }
      else { this.wLine(4, rnd(120, 280), sm, drop); this.wLine(4, rnd(440, 600), sm, null); }
      return t > 80 ? 1.6 : 2;
    }

    wave2() {
      const t = this.stageT, i = this.waveI++, r = forge.rand(), sm = 1.22 + t / 360;
      let drop = null;
      if (!this.drop2 && t >= 40) { this.drop2 = true; drop = this.pickKind(null); }
      if (i === 0) { this.wSnake(6, H / 2, sm, null); return 1.9; }
      if (i === 1) { this.wGun(2, 3, null); return 1.9; }
      if (r < 0.2) this.wSnake(7, rnd(230, 490), sm * 1.08, drop);
      else if (r < 0.38) this.wGun(t > 45 ? 3 : 2, 3, drop);
      else if (r < 0.55) { this.wLine(4, 140, sm, drop); this.wLine(4, H - 140, sm, null); }
      else if (r < 0.75) this.wV(7, rnd(220, 500), sm, drop);
      else { this.wSnake(5, rnd(250, 470), sm, drop); this.wGun(1, 3, null); }
      return t > 70 ? 1.4 : 1.8 - t / 300;
    }

    spawnAsteroid() {
      const big = this.stageNo === 2 ? forge.rand() < 0.45 : forge.rand() < 0.12;
      const size = big ? rnd(150, 210) : rnd(56, 100);
      this.spawnEnemy("asteroid", W + size * 0.6, rnd(70, H - 70), { size, hp: big ? 18 : Math.round(size / 24) + 1, vy: rnd(-25, 25), spin: rnd(-1.2, 1.2), sm: big ? 0.7 : rnd(0.9, 1.3) });
    }

    // ---------------------------------------------------------------- enemies
    spawnEnemy(type, x, y, o) {
      const s2 = this.stageNo === 2;
      let key, size, hp, score;
      if (type === "drone") { key = "enemy_drone"; size = 62; hp = s2 ? 3 : 2; score = 100; }
      else if (type === "gunner") { key = "enemy_gunner"; size = 86; hp = s2 ? 14 : 10; score = 300; }
      else { key = "asteroid_tile"; size = o.size; hp = o.hp; score = size >= 140 ? 200 : 60; }
      const spr = this.add.image(x, y, key).setDepth(type === "asteroid" ? 2 : 3);
      forge.phaser.fit(spr, size);
      if (type !== "asteroid") spr.setFlipX(true); else spr.rotation = forge.rand() * 6.28;
      const e = {
        spr, type, hp, score, size, r: size * (type === "asteroid" ? 0.4 : 0.36), t: 0, x, y, baseY: y,
        amp: o.amp || 0, freq: o.freq || 2, phase: o.phase || 0, sm: o.sm || 1, g: o.g || null, home: !!o.home,
        stopX: o.stopX || 1050, state: "in", holdT: o.hold || 4.5, fireCd: rnd(0.4, 1), burst: o.burst || 1,
        burstLeft: 0, burstCd: 0, vy: o.vy || 0, spin: o.spin || 0, big: type === "asteroid" && size >= 140, flash: 0, alive: true
      };
      if (e.g) e.g.alive++;
      this.enemies.push(e);
      return e;
    }

    updateEnemies(dt) {
      const es = clamp(T("enemySpeed", 150), 10, 1000), bs = clamp(T("enemyBulletSpeed", 260), 40, 1200), P = this.player;
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e.alive) { this.enemies.splice(i, 1); continue; }
        const s = e.spr; e.t += dt;
        if (e.flash > 0 && (e.flash -= dt) <= 0) s.clearTint();
        if (e.type === "drone") {
          s.x -= es * e.sm * dt;
          if (e.home && !this.dead) e.baseY += clamp(P.y - e.baseY, -85 * dt, 85 * dt);
          const py = s.y;
          s.y = clamp(e.baseY + e.amp * Math.sin(e.freq * e.t + e.phase), 30, H - 30);
          s.rotation = clamp(-(s.y - py) / dt * 0.0012, -0.35, 0.35);
        } else if (e.type === "gunner") {
          if (e.state === "in") { s.x -= es * 1.1 * dt; if (s.x <= e.stopX) e.state = "hold"; }
          else if (e.state === "hold") {
            e.holdT -= dt; s.y = e.baseY + Math.sin(e.t * 1.5) * 12;
            if (e.burstLeft > 0) {
              if ((e.burstCd -= dt) <= 0) {
                e.burstLeft--; e.burstCd = 0.13;
                const mx = s.x - s.displayWidth * 0.4;
                this.fireE(mx, s.y, this.angTo(mx, s.y), bs, 22);
                forge.phaser.burst(this, mx, s.y, { color: C.orange, count: 4, speed: 90, life: 180, size: 4 });
              }
            } else if (!this.dead && (e.fireCd -= dt) <= 0) { e.fireCd = this.stageNo === 2 ? 1.3 : 1.6; e.burstLeft = e.burst; e.burstCd = 0; }
            if (e.holdT <= 0) e.state = "out";
          } else s.x += es * 1.3 * dt;
        } else {
          s.x -= es * 0.55 * e.sm * dt; s.y += e.vy * dt;
          if ((s.y < 40 && e.vy < 0) || (s.y > H - 40 && e.vy > 0)) e.vy = -e.vy;
          s.rotation += e.spin * dt;
        }
        e.x = s.x; e.y = s.y;
        if (s.x < -e.size || (e.state === "out" && s.x > W + 120)) { this.killEnemy(e, false); this.enemies.splice(i, 1); continue; }
        if (!this.dead && this.invuln <= 0) {
          const dx = e.x - P.x, dy = e.y - P.y, rr = e.r + 18;
          if (dx * dx + dy * dy < rr * rr) { this.hurtPlayer(); this.damageEnemy(e, e.big ? 6 : 20); }
        }
      }
    }

    damageEnemy(e, dmg) {
      if (!e.alive) return;
      e.hp -= dmg; e.spr.setTintFill(0xffffff); e.flash = 0.05;
      if (e.hp <= 0) this.killEnemy(e, true);
    }

    killEnemy(e, byPlayer) {
      if (!e.alive) return;
      e.alive = false;
      const x = e.spr.x, y = e.spr.y, g = e.g;
      if (byPlayer) {
        this.addScore(e.score, x, y); this.kills++;
        const col = e.type === "asteroid" ? C.orange : e.type === "gunner" ? C.cyan : C.pink;
        forge.phaser.burst(this, x, y, { color: col, count: e.big ? 30 : 16, speed: e.big ? 320 : 220, life: 550, size: e.big ? 9 : 6 });
        forge.phaser.burst(this, x, y, { color: C.white, count: 6, speed: 120, life: 260, size: 4 });
        forge.audio.play("sfx_explosion", { volume: e.big ? 0.6 : 0.38, rate: rnd(0.85, 1.2) });
        forge.shake(e.big ? 0.35 : e.type === "gunner" ? 0.2 : 0.08);
        if (e.big) for (let k = -1; k <= 1; k += 2) this.spawnEnemy("asteroid", x, clamp(y + k * 30, 60, H - 60), { size: e.size * 0.48, hp: 3, vy: k * 70, spin: rnd(-2, 2), sm: 1.25 });
        if (!(g && g.drop && !g.dropped) && this.pows.length < 3) {
          let ch = clamp(T("powerUpDropRate", 18), 0, 100) / 100;
          if (this.stageNo === 2) ch *= 0.5;
          if (this.stage === "boss") ch *= 0.5;
          ch *= e.type === "gunner" ? 1.5 : e.type === "asteroid" ? 0.5 : 1;
          if (forge.rand() < ch) this.spawnPow(this.pickKind(null), x, y);
        }
      }
      if (g) {
        g.alive--;
        if (byPlayer) { g.killed++; g.lx = x; g.ly = y; }
        if (g.alive <= 0 && g.drop && !g.dropped) {
          g.dropped = true;
          if (g.killed > 0) this.spawnPow(g.drop, g.lx, g.ly); else this.spawnPow(g.drop, W + 30, rnd(200, 520));
        }
      }
      e.spr.destroy();
    }

    addScore(n, x, y) { this.score += n; forge.phaser.floatText(this, x, y - 20, "+" + n, { color: "#FFB300", size: n >= 1000 ? 40 : 22 }); }

    // ---------------------------------------------------------------- boss
    bossMax(hive) { return Math.max(20, clamp(T("bossHealth", 300), 20, 5000) * (hive ? 1.5 : 1)); }

    spawnBoss(n) {
      const hive = n === 2, ADD = Phaser.BlendModes.ADD;
      const s = this.add.image(W + 420, H / 2, hive ? "boss_hive" : "boss_dreadnought").setDepth(4).setFlipX(true);
      forge.phaser.fit(s, hive ? 430 : 400);
      const max = this.bossMax(hive);
      const defs = hive ? [[-0.28, -0.26, 0], [-0.4, 0, 0], [-0.28, 0.26, 0]] : [[-0.12, -0.33, 0], [-0.12, 0.33, 0], [-0.34, 0.02, 1]];
      const wps = defs.map(d => ({
        ox: d[0] * s.displayWidth, oy: d[1] * s.displayHeight, r: d[2] ? 36 : 30, core: !!d[2], alive: !d[2], x: s.x, y: s.y, flash: 0,
        glow: this.add.image(0, 0, "fx_glow").setBlendMode(ADD).setDepth(5).setTint(hive ? C.orange : C.pink),
        ring: this.add.image(0, 0, "fx_ring").setBlendMode(ADD).setDepth(5).setTint(C.cyan).setVisible(hive),
        shield: hive ? 8 : 0, shieldMax: hive ? 8 : 0, regenT: 0
      }));
      this.boss = { s, hive, hp: max, max, phase: 1, state: "enter", t: 0, ta: 2, tb: 1.2, tc: 3, spin: 0, homeX: W - s.displayWidth * 0.4, wps, flash: 0, dieT: 0, boomT: 0, name: hive ? "Colmena Nodriza" : "Dreadnought Carmesí", lastR: -1 };
      forge.hud.message(hive ? "JEFE FINAL: COLMENA NODRIZA · Rompe los escudos de sus núcleos" : "JEFE: DREADNOUGHT CARMESÍ · Dispara a los puntos brillantes", 3000);
      forge.shake(0.3);
    }

    updateBoss(dt) {
      const B = this.boss; if (!B) return;
      const s = B.s; B.t += dt;
      if (B.state !== "dying") {
        const nm = this.bossMax(B.hive);
        if (Math.abs(nm - B.max) > 0.5) { B.hp = B.hp / B.max * nm; B.max = nm; }
      }
      const fast = B.hive && B.phase === 3 ? 1.5 : 1;
      if (B.flash > 0 && (B.flash -= dt) <= 0) s.clearTint();
      if (B.state === "enter") {
        s.x += (B.homeX - s.x) * Math.min(1, dt * 1.6);
        if (Math.abs(s.x - B.homeX) < 4) { B.state = "fight"; B.t = 0; }
      } else if (B.state === "fight") {
        s.x = B.homeX + Math.sin(B.t * 0.7 * fast) * 30;
        s.y = H / 2 + Math.sin(B.t * 0.55 * fast) * (B.hive ? 150 : 110);
        if (!this.dead) this.bossAttack(B, dt * fast, dt);
        const P = this.player;
        const dx = (P.x - s.x) / (s.displayWidth * 0.42), dy = (P.y - s.y) / (s.displayHeight * 0.36);
        if (dx * dx + dy * dy < 1) this.hurtPlayer();
      } else {
        B.dieT += dt; B.boomT -= dt;
        s.x = B.homeX + rnd(-6, 6) + B.dieT * 30; s.y += rnd(-4, 4);
        if (B.boomT <= 0) {
          B.boomT = 0.12;
          forge.phaser.burst(this, s.x + rnd(-0.4, 0.4) * s.displayWidth, s.y + rnd(-0.4, 0.4) * s.displayHeight, { color: forge.rand() < 0.5 ? C.orange : C.pink, count: 20, speed: 280, life: 600, size: 8 });
          forge.audio.play("sfx_explosion", { volume: 0.6, rate: rnd(0.6, 1) });
          forge.shake(0.3);
        }
        if (B.dieT > 2.4) { this.finishBoss(B); return; }
      }
      for (const w of B.wps) {
        w.x = s.x + w.ox; w.y = s.y + w.oy;
        if (w.flash > 0) w.flash -= dt;
        const pulse = 0.75 + 0.25 * Math.sin(B.t * 6 + w.oy);
        w.glow.setPosition(w.x, w.y).setScale((w.r * 2.6 / 64) * pulse * (w.flash > 0 ? 1.3 : 1))
          .setAlpha(B.state !== "fight" ? 0.3 : w.alive ? (w.shield > 0 ? 0.45 : 1) : 0.18).setTint(w.flash > 0 ? 0xffffff : B.hive ? C.orange : C.pink);
        if (w.shieldMax) {
          w.ring.setVisible(w.shield > 0).setPosition(w.x, w.y).setScale((w.r * 2.4 / 64) * (0.8 + 0.2 * w.shield / w.shieldMax)).setAlpha(0.4 + 0.5 * w.shield / w.shieldMax);
          w.ring.rotation += dt * 2;
        }
      }
      const r = Math.round(clamp(B.hp / B.max, 0, 1) * 200) / 200;
      if (r !== B.lastR) { B.lastR = r; forge.hud.bar("boss", r, { label: B.name, color: B.hive ? "#FFB300" : "#FF3D81" }); }
    }

    bossAttack(B, dt, rdt) {
      const bs = clamp(T("enemyBulletSpeed", 260), 40, 1200), s = B.s, P = this.player;
      const fx = s.x - s.displayWidth * 0.38, fy = s.y;
      B.ta -= dt; B.tb -= dt; B.tc -= dt;
      const w = B.wps;
      if (!B.hive) {
        const aimT = () => { for (let k = 0; k < 2; k++) this.fireE(w[k].x, w[k].y, this.angTo(w[k].x, w[k].y), bs * 0.9, 22); };
        if (B.phase === 1) {
          if (B.ta <= 0) { B.ta = 1.8; this.fan(fx, fy, 9, 1.25, bs * 0.6, 0, 0); }
          if (B.tb <= 0) { B.tb = 1.1; aimT(); }
        } else if (B.phase === 2) {
          if (B.ta <= 0) { B.ta = 2.8; this.addLaser(P.y, fx); }
          if (B.tb <= 0) { B.tb = 4.5; if (this.enemies.length < 12) for (let k = -1; k <= 1; k += 2) this.spawnEnemy("drone", s.x - 120, s.y + k * 160, { home: true, amp: 20, sm: 1.1 }); }
          if (B.tc <= 0) { B.tc = 2.4; this.fan(fx, fy, 7, 1, bs * 0.65, 0, 0); }
        } else {
          if (B.ta <= 0) { B.ta = 0.085; B.spin += 0.31; for (let k = 0; k < 2; k++) this.fireE(w[2].x, w[2].y, B.spin + k * Math.PI, bs * 0.5, 20, C.pink, 0); }
          if (B.tb <= 0) { B.tb = 1.5; aimT(); }
          if (B.tc <= 0) { B.tc = 4.2; this.addLaser(P.y, fx); }
        }
      } else {
        const ph = B.phase, ob = bs * (ph === 3 ? 0.9 : 0.75);
        if (B.ta <= 0) {
          B.ta = ph === 1 ? 4 : 3.2;
          if (this.enemies.length < 14) for (let k = 0; k < 3 + ph; k++) this.spawnEnemy("drone", fx + k * 40, clamp(fy + rnd(-140, 140), 60, H - 60), { home: true, amp: 25, freq: 3, phase: k, sm: 1.3 });
          forge.hud.message("¡Enjambre!", 700);
        }
        if (B.tb <= 0) { B.tb = ph === 1 ? 2.6 : 2; this.fan(fx, fy, 4 + ph, 1.1, ob, C.orange, 2); }
        if (ph >= 2 && B.tc <= 0) {
          B.tc = 1.6;
          for (const p of w) if (p.alive) { const a = this.angTo(p.x, p.y); for (let k = -1; k <= 1; k++) this.fireE(p.x, p.y, a + k * 0.12, bs, 20, 0, 0); }
        }
        for (const p of w) {
          if (p.regenT > 0) p.regenT -= rdt;
          else if (p.shield < p.shieldMax) p.shield = Math.min(p.shieldMax, p.shield + 3 * rdt);
        }
      }
    }

    fan(x, y, n, spread, speed, tint, bounce) {
      const base = this.angTo(x, y);
      for (let i = 0; i < n; i++) this.fireE(x, y, base + spread * (i / (n - 1) - 0.5), speed, bounce ? 30 : 22, tint, bounce);
    }

    addLaser(y, x) {
      this.lasers.push({ y: clamp(y, 30, H - 30), x, t: 0, warn: 1, dur: 0.5, fired: false });
      forge.audio.play("sfx_boss_alarm", { volume: 0.25, rate: 2 });
    }

    updateLasers(dt) {
      const g = this.fxG; g.clear();
      const P = this.player;
      for (let i = this.lasers.length - 1; i >= 0; i--) {
        const L = this.lasers[i]; L.t += dt;
        if (L.t > L.warn + L.dur || !this.boss || this.boss.state !== "fight") { this.lasers.splice(i, 1); continue; }
        if (L.t < L.warn) {
          const a = 0.3 + 0.4 * (Math.floor(L.t * 16) % 2);
          g.lineStyle(2, C.pink, a); g.lineBetween(0, L.y, L.x, L.y);
          g.fillStyle(C.pink, a * 0.15); g.fillRect(0, L.y - 14, L.x, 28);
        } else {
          if (!L.fired) { L.fired = true; forge.shake(0.3); forge.audio.play("sfx_shoot", { volume: 0.5, rate: 0.4 }); }
          const k = 1 - (L.t - L.warn) / L.dur;
          g.fillStyle(C.pink, 0.5 * k); g.fillRect(0, L.y - 22, L.x, 44);
          g.fillStyle(C.cyan, 0.8 * k); g.fillRect(0, L.y - 12, L.x, 24);
          g.fillStyle(0xffffff, k); g.fillRect(0, L.y - 5, L.x, 10);
          if (!this.dead && Math.abs(P.y - L.y) < 26 && P.x < L.x) this.hurtPlayer();
        }
      }
    }

    bossHitTest(x, y, rad, dmg) {
      const B = this.boss;
      if (!B || B.state !== "fight") return false;
      for (const w of B.wps) {
        if (!w.alive) continue;
        const dx = w.x - x, dy = w.y - y, rr = w.r + rad;
        if (dx * dx + dy * dy < rr * rr) {
          if (w.shield > 0) {
            w.shield -= dmg; w.regenT = 2.5; this.spark(x, y, C.cyan);
            if (w.shield <= 0) { w.shield = 0; forge.phaser.burst(this, w.x, w.y, { color: C.cyan, count: 16, speed: 220, life: 400, size: 5 }); forge.audio.play("sfx_hit", { volume: 0.4, rate: 1.5 }); }
          } else { w.flash = 0.06; this.damageBoss(B, dmg * (w.core ? 2 : 1)); this.spark(x, y, C.orange); }
          return true;
        }
      }
      const s = B.s, ex = (x - s.x) / (s.displayWidth * 0.45), ey = (y - s.y) / (s.displayHeight * 0.4);
      if (ex * ex + ey * ey < 1) { this.damageBoss(B, dmg * 0.1); this.spark(x, y, 0x9a9ab0); return true; }
      return false;
    }

    damageBoss(B, dmg) {
      if (B.state !== "fight") return;
      B.hp -= dmg;
      if (dmg >= 0.5) { B.s.setTintFill(0xffffff); B.flash = 0.04; }
      const r = B.hp / B.max;
      if (B.hp <= 0) {
        B.hp = 0; B.state = "dying"; B.dieT = 0;
        this.clearBullets(true); this.lasers.length = 0;
        forge.audio.play("sfx_explosion", { volume: 1, rate: 0.5 });
        forge.shake(0.9);
        return;
      }
      const np = r < 0.33 ? 3 : r < 0.66 ? 2 : 1;
      if (np > B.phase) {
        B.phase = np; B.ta = 1.2; B.tb = 1.5; B.tc = 2;
        this.clearBullets(true);
        forge.shake(0.5); this.cameras.main.flash(200, 255, 80, 140);
        forge.audio.play("sfx_explosion", { volume: 0.8, rate: 0.7 });
        if (!B.hive) {
          if (np === 2) forge.hud.message("¡Fase 2! Láseres y escoltas", 1600);
          else { B.wps[2].alive = true; forge.hud.message("¡Fase 3! ¡El núcleo está expuesto!", 1800); }
        } else {
          for (const w of B.wps) { w.shieldMax += 4; w.shield = w.shieldMax; }
          forge.hud.message(np === 2 ? "¡Fase 2! Escudos reforzados" : "¡Fase 3! ¡La Colmena enloquece!", 1800);
        }
      }
    }

    finishBoss(B) {
      forge.phaser.burst(this, B.s.x, B.s.y, { color: C.white, count: 60, speed: 500, life: 900, size: 10 });
      this.cameras.main.flash(400, 255, 255, 255);
      forge.shake(1);
      for (const w of B.wps) { w.glow.destroy(); w.ring.destroy(); }
      this.addScore(B.hive ? 10000 : 5000, B.s.x, B.s.y);
      B.s.destroy();
      this.boss = null;
      forge.hud.remove("boss");
      if (B.hive) { this.victory(); return; }
      this.stage = "rest"; this.stageT = 0; this.bombs = Math.max(this.bombs, 1);
      forge.hud.message("¡Dreadnought Carmesí destruido! Recoge suministros", 2600);
      const k1 = this.pickKind(null), k2 = this.pickKind(k1);
      this.spawnPow(k1, W + 30, 250); this.spawnPow(k2, W + 30, 470);
    }

    // ---------------------------------------------------------------- shots
    angTo(x, y) { const P = this.player; return Math.atan2(P.y - y, P.x - x); }

    fireE(x, y, a, speed, size, tint, bounce) {
      const b = this.eb.get(x, y);
      b.setScale(size / (b.height || 64));
      b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed; b.r = size * 0.36; b.bounce = bounce || 0;
      if (tint) b.setTint(tint);
      return b;
    }

    spark(x, y, color) {
      if (this.sparkCd > 0) return;
      this.sparkCd = 0.035;
      forge.phaser.burst(this, x, y, { color, count: 4, speed: 140, life: 200, size: 3 });
    }

    hitAny(x, y, rad, dmg, color) {
      const es = this.enemies;
      for (let j = 0; j < es.length; j++) {
        const e = es[j];
        if (!e.alive || e.x > W + e.r * 0.3) continue;
        const dx = e.x - x, dy = e.y - y, rr = e.r + rad;
        if (dx * dx + dy * dy < rr * rr) { this.damageEnemy(e, dmg); this.spark(x, y, color); return true; }
      }
      return this.bossHitTest(x, y, rad, dmg);
    }

    findTarget(x, y) {
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (!e.alive || e.x > W - 10 || e.x < x - 40) continue;
        const d = (e.x - x) ** 2 + (e.y - y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (this.boss && this.boss.state === "fight") for (const w of this.boss.wps) {
        if (!w.alive) continue;
        const d = ((w.x - x) ** 2 + (w.y - y) ** 2) * 0.8;
        if (d < bd) { bd = d; best = w; }
      }
      return best;
    }

    updateShots(dt) {
      for (const b of this.pb.items) {
        if (!b.active) continue;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x > W + 30 || b.y < -20 || b.y > H + 20 || this.hitAny(b.x, b.y, 6, b.dmg, C.cyan)) this.pb.kill(b);
      }
      for (const m of this.ms.items) {
        if (!m.active) continue;
        if ((m.life -= dt) <= 0) { this.ms.kill(m); continue; }
        const tgtAlive = m.tgt && (m.tgt.alive !== false) && !(this.boss === null && m.tgt.glow);
        if (!tgtAlive || (m.rt -= dt) <= 0) { m.tgt = this.findTarget(m.x, m.y); m.rt = 0.25; }
        let d = m.tgt ? Math.atan2(m.tgt.y - m.y, m.tgt.x - m.x) - m.ang : -m.ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        m.ang += clamp(d, -7 * dt, 7 * dt);
        m.speed = Math.min(720, m.speed + 900 * dt);
        m.x += Math.cos(m.ang) * m.speed * dt; m.y += Math.sin(m.ang) * m.speed * dt; m.rotation = m.ang;
        if (m.x > W + 40 || m.x < -40 || m.y < -40 || m.y > H + 40) { this.ms.kill(m); continue; }
        if (this.hitAny(m.x, m.y, 8, 2.5, C.green)) {
          forge.phaser.burst(this, m.x, m.y, { color: C.green, count: 8, speed: 160, life: 300, size: 5 });
          this.ms.kill(m);
        }
      }
    }

    updateEBullets(dt) {
      const P = this.player;
      for (const b of this.eb.items) {
        if (!b.active) continue;
        b.x += b.vx * dt; b.y += b.vy * dt; b.rotation += 4 * dt;
        if (b.bounce > 0) {
          if ((b.y < b.r && b.vy < 0) || (b.y > H - b.r && b.vy > 0)) { b.vy = -b.vy; b.bounce--; }
          else if (b.x < b.r && b.vx < 0) { b.vx = -b.vx; b.bounce--; }
        }
        if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { this.eb.kill(b); continue; }
        if (!this.dead && this.invuln <= 0) {
          const dx = b.x - P.x, dy = b.y - P.y, rr = b.r + 10;
          if (dx * dx + dy * dy < rr * rr) { this.eb.kill(b); this.hurtPlayer(); }
        }
      }
    }

    clearBullets(fx, x, y, rad) {
      let n = 0;
      const r2 = rad ? rad * rad : 0;
      for (const b of this.eb.items) {
        if (!b.active) continue;
        if (rad && (b.x - x) ** 2 + (b.y - y) ** 2 > r2) continue;
        if (fx && n < 24) forge.phaser.burst(this, b.x, b.y, { color: C.white, count: 3, speed: 80, life: 250, size: 3 });
        n++; this.eb.kill(b);
      }
      return n;
    }

    // ---------------------------------------------------------------- power-ups
    pickKind(exclude) {
      const ks = ["red", "blue", "green"].filter(k => k !== exclude);
      const wts = ks.map(k => (k === "blue" ? (this.shield >= 2 + Math.max(1, this.blue) ? 0.4 : 1.2) : 1) / (1 + this[k]));
      let r = forge.rand() * wts.reduce((a, b) => a + b, 0);
      for (let i = 0; i < ks.length; i++) { r -= wts[i]; if (r <= 0) return ks[i]; }
      return ks[0];
    }

    spawnPow(kind, x, y) {
      const spr = this.add.image(x, y, PU[kind].tex).setDepth(6);
      forge.phaser.fit(spr, 50);
      const sc = spr.scale;
      spr.setScale(0);
      this.tweens.add({ targets: spr, scale: sc, duration: 350, ease: "Back.easeOut" });
      const halo = this.add.image(x, y, "fx_glow").setBlendMode(Phaser.BlendModes.ADD).setDepth(5).setTint(PU[kind].col).setScale(1.6);
      this.pows.push({ spr, halo, kind, x: Math.min(x, W + 30), baseY: clamp(y, 50, H - 50), t: 0 });
    }

    updatePows(dt) {
      const P = this.player;
      for (let i = this.pows.length - 1; i >= 0; i--) {
        const p = this.pows[i];
        p.t += dt; p.x -= 95 * dt;
        const y = p.baseY + Math.sin(p.t * 3) * 10;
        p.spr.setPosition(p.x, y).setRotation(Math.sin(p.t * 2) * 0.2);
        p.halo.setPosition(p.x, y).setAlpha(0.5 + 0.3 * Math.sin(p.t * 7));
        const dx = p.x - P.x, dy = y - P.y;
        if (!this.dead && dx * dx + dy * dy < 48 * 48) { this.collect(p); this.removePow(i); }
        else if (p.x < -50) this.removePow(i);
      }
    }

    removePow(i) { const p = this.pows[i]; p.spr.destroy(); p.halo.destroy(); this.pows.splice(i, 1); }

    collect(p) {
      const k = p.kind, P = this.player;
      let msg;
      if (k === "blue") {
        const was = this.blue;
        this.blue = Math.min(3, this.blue + 1);
        this.shield = 2 + this.blue;
        msg = was === 3 ? "Escudo recargado +500" : `Escudo nivel ${this.blue} (${this.shield} impactos)`;
        if (was === 3) this.addScore(500, p.x, p.spr.y);
      } else if (this[k] < 3) { this[k]++; msg = `${PU[k].name} nivel ${this[k]}`; }
      else { msg = `${PU[k].name} al máximo · +500`; this.addScore(500, p.x, p.spr.y); }
      forge.hud.message(msg, 1200);
      forge.audio.play("sfx_powerup", { volume: 0.7 });
      forge.phaser.burst(this, p.x, p.spr.y, { color: PU[k].col, count: 22, speed: 240, life: 500, size: 6 });
      forge.phaser.floatText(this, P.x, P.y - 40, PU[k].name.toUpperCase() + "!", { color: { red: "#FF3D81", blue: "#00E5FF", green: "#7CFF4F" }[k], size: 26 });
      forge.shake(0.1);
      this.score += 50;
    }

    // ---------------------------------------------------------------- HUD
    hs(k, v, o) { if (this._h[k] === v) return; this._h[k] = v; forge.hud.set(k, v, o); }

    updateHud() {
      this.hs("score", this.score, { label: "Puntos", icon: "⭐" });
      this.hs("lives", Math.max(0, this.lives), { label: "Vidas", icon: "❤️" });
      this.hs("bomb", this.bombs, { label: "Bomba", icon: "💣" });
      this.hs("weapons", `🔴${this.red} 🟢${this.green} 🔵${this.blue}`, { label: "Armas" });
      const sh = this.shield > 0 ? clamp(this.shield / (2 + Math.max(1, this.blue)), 0, 1) : 0;
      if (this._h.sh !== sh) { this._h.sh = sh; forge.hud.bar("shield", sh, { label: "Escudo", color: "#00E5FF" }); }
    }
  }

  return {
    scenes: [MainScene],
    physics: "arcade",
    gravity: 0,
    background: "#0B0A24",
    cinematicShots: CINE_SHOTS,
    onCinematic(dt, cine) {
      const s = sceneRef;
      if (!s || !s.ready || !s.sys) return;
      let d = num(dt, 1 / 60);
      if (d > 0.5) d /= 1000;
      d = clamp(d, 0, 0.05);
      s.lastExt = s.game.loop.frame;
      s.cineStep(d, cine || forge.cinematic);
    }
  };
}