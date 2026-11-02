export default function createGame(forge, Phaser) {
  // ---------------------------------------------------------------------------
  // Constants (screen + perspective world)
  // ---------------------------------------------------------------------------
  const W = 1280, H = 720, CX = 640, HY = 250, GY = 650, D = 340;
  const ZFAR = 3200, ZNEAR = -70, LANE_W = 250, ROAD_HALF = LANE_W * 1.5 + 45;
  const TRAIN_H = 330, CAR_LEN = 330, JUMP_PEAK = 175, HIGH_PEAK = 400, SLIDE_TIME = 0.62;
  const COIN_H = 45;
  const BEST_KEY = "carril_cometa_best";
  const NARRATION_ID = "narration"; // voice clip is owned & played by the runtime intro

  // Ground texture mapping (world units per texture tile)
  const GROUND_TILE = 300;
  const CURB_W = 26;          // curb width (world units)
  const EDGE_OUT = 8;         // dark outline outside the curb
  const PROP_MARGIN = 60;     // props keep at least this far from the road edge band

  // Run animation pacing
  const RUN_TS_MIN = 0.85;    // timeScale at baseSpeed
  const RUN_TS_MAX = 1.2;     // timeScale at maxSpeed (hard clamp)

  const KIND = {
    low: { tex: "low_barrier", w: 210, center: false },
    high: { tex: "high_barrier", w: 236, center: false },
    cone: { tex: "cone_crate", w: 122, center: false },
    train: { tex: "train_car", w: 236, center: false },
    coin: { tex: "coin", w: 64, center: true },
    power: { tex: "powerups", w: 96, center: true },
  };
  const POWER = {
    magnet: { label: "Imán", color: 0xff6b35, css: "#FF6B35" },
    shield: { label: "Escudo", color: 0x2ec4b6, css: "#2EC4B6" },
    x2: { label: "Monedas x2", color: 0xffd23f, css: "#FFD23F" },
    jump: { label: "Supersalto", color: 0x8338ec, css: "#8338EC" },
  };
  const POWER_KEYS = ["magnet", "shield", "x2", "jump"];
  const DECOR = [
    { tex: "prop_building", x0: 840, x1: 940, w0: 430, w1: 500, g0: 430, g1: 520, tints: [0xffffff, 0xffe2d4, 0xd8f1ff, 0xeadcff, 0xfff1c4], flip: true },
    { tex: "prop_tree", x0: 610, x1: 650, w0: 190, w1: 240, g0: 360, g1: 520, tints: [0xffffff, 0xe8ffe8, 0xfff4d8], flip: true },
    { tex: "scenery_fence", x0: 560, x1: 570, w0: 170, w1: 176, g0: 175, g1: 185, tints: [0xffffff], skip: 0.3 },
    { tex: "prop_billboard", x0: 720, x1: 760, w0: 300, w1: 340, g0: 1100, g1: 1700, tints: [0xffffff] },
  ];
  const PATTERNS = [
    { id: "lowSingle", tier: 0, w: 3 }, { id: "coinRow", tier: 0, w: 2 }, { id: "cones", tier: 0, w: 2 }, { id: "lowArc", tier: 0, w: 2 },
    { id: "high", tier: 1, w: 3 }, { id: "train", tier: 1, w: 3 }, { id: "combo", tier: 1, w: 2 },
    { id: "twoTrains", tier: 2, w: 3 }, { id: "jumpSlide", tier: 2, w: 2 }, { id: "zigzag", tier: 2, w: 2 },
    { id: "gauntlet", tier: 3, w: 3 },
  ];
  const LANES = [-1, 0, 1];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  let sceneRef = null;
  const R = () => forge.rand();
  const rr = (a, b) => a + (b - a) * R();
  const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(R() * arr.length))];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const tune = (k, f) => { const v = Number(forge.tune(k, f)); return Number.isFinite(v) ? v : f; };
  const ease = (name, p) => {
    switch (name) {
      case "easeOut": return 1 - Math.pow(1 - p, 3);
      case "easeIn": return p * p * p;
      case "linear": return p;
      default: return p * p * (3 - 2 * p);
    }
  };
  const randLane = () => pick(LANES);
  const otherLane = (l) => pick(LANES.filter((x) => x !== l));
  const adjLane = (l) => (l === 0 ? pick([-1, 1]) : 0);
  const shuffle3 = () => {
    const a = [-1, 0, 1];
    for (let i = 2; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  const lineAngle = () => (R() < 0.5 ? rr(-0.3, 0.33) * Math.PI : rr(0.67, 1.3) * Math.PI);
  const posMod = (v, m) => { const r = v % m; return r < 0 ? r + m : r; };

  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------
  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      sceneRef = this;
      this.pools = new Map();
      this.ents = [];
      this.decor = [];
      this.scrollDist = 0;
      this.cineOn = false;
      this.cineRole = "";
      this.cineLines = 0;
      this.hintShown = false;
      this.hudCache = {};
      this.groupId = 0;
      this.swipeQ = [];
      this.runAnimRef = null;
      this.runFps = 11;
      this.prevClip = "";
      this.hasVoice = forge.assets.list("audio").some((a) => a && a.id === NARRATION_ID);
      this.best = Number(forge.load(BEST_KEY, 0)) || 0;

      const cam = this.cameras.main;
      cam.setBounds(0, 0, W, H);

      // Sky (non-seamless painting: plain image, gentle sway only)
      this.sky = this.add.image(CX, HY + 10, "sky_clouds").setOrigin(0.5, 0.62).setDepth(0);
      const skySc = Math.max(1420 / this.sky.width, (HY + 40) / (this.sky.height * 0.62));
      this.sky.setScale(skySc);

      // Ground: side scenery floor + asphalt only inside the road, both in perspective
      this.buildGroundStrips();

      this.roadG = this.add.graphics().setDepth(2);
      this.shadowG = this.add.graphics().setDepth(3);
      this.heroShadowG = this.add.graphics().setDepth(499);
      this.fxG = this.add.graphics().setDepth(560);
      this.speedG = this.add.graphics().setDepth(900);

      // Hero (animated sheet)
      this.hero = this.add.sprite(CX, GY, "hero_kiko");
      this.anim = forge.phaser.animate(this.hero);
      forge.phaser.fit(this.hero, 200);
      this.hero.setOrigin(0.5, 1).setDepth(500);

      this.lines = [];
      for (let i = 0; i < 26; i++) this.lines.push({ a: lineAngle(), r: R() });

      this.decorNext = [];
      for (let i = 0; i < 8; i++) { const k = DECOR[i % 4]; this.decorNext.push(ZNEAR + R() * k.g1); }

      // Swipe input
      this.swipeStart = null;
      this._onDown = (p) => { this.swipeStart = { x: p.x, y: p.y }; };
      this._onUp = (p) => {
        if (!this.swipeStart) return;
        const dx = p.x - this.swipeStart.x, dy = p.y - this.swipeStart.y;
        this.swipeStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
        if (Math.abs(dx) > Math.abs(dy)) this.swipeQ.push(dx < 0 ? "left" : "right");
        else this.swipeQ.push(dy < 0 ? "up" : "down");
      };
      this.input.on("pointerdown", this._onDown);
      this.input.on("pointerup", this._onUp);
      this.events.once("shutdown", () => {
        this.input.off("pointerdown", this._onDown);
        this.input.off("pointerup", this._onUp);
        if (sceneRef === this) sceneRef = null;
      });

      this.resetRun();
      this.initHud();
      forge.audio.music("music_main", { volume: 0.6 });
      this.render(0);
    }

    // ------------------------------------------------------------------ ground strips
    texSize(key) {
      const fr = this.textures.getFrame(key);
      const w = fr && fr.width > 0 ? fr.width : 512;
      const h = fr && fr.height > 0 ? fr.height : 512;
      return { w, h };
    }

    buildGroundStrips() {
      this.groundStrips = [];
      this.sideTex = this.texSize("side_ground");
      this.roadTex = this.texSize("asphalt_ground");
      const sMin = D / (D + 24000);
      const span = GY - HY;
      let y = HY;
      while (y < H) {
        const step = y < HY + 120 ? 4 : 8;
        const y1 = Math.min(H, y + step);
        const hpx = y1 - y;
        const sT = Math.max(sMin, (y - HY) / span);
        const sB = Math.max(sT + 1e-4, (y1 - HY) / span);
        const sM = (sT + sB) * 0.5;
        const zT = D / sT - D, zB = D / sB - D;
        const dz = Math.max(1, zT - zB);

        // side scenery floor: full width, the road is drawn on top of it
        const side = this.add.tileSprite(0, y, W, hpx, "side_ground").setOrigin(0, 0).setDepth(1);
        const skx = (GROUND_TILE * sM) / this.sideTex.w;
        const sky = hpx / ((dz * this.sideTex.h) / GROUND_TILE);
        side.tileScaleX = skx; side.tileScaleY = sky;
        side.tilePositionX = posMod(-CX / skx, this.sideTex.w);

        // asphalt: only inside the 3-lane road (slightly under the curb band)
        const rw = Math.max(2, 2 * (ROAD_HALF + 14) * sM);
        const road = this.add.tileSprite(CX, y, rw, hpx, "asphalt_ground").setOrigin(0.5, 0).setDepth(1.5);
        road.setTint(0xc9c3d6);
        const rkx = (GROUND_TILE * sM) / this.roadTex.w;
        const rky = hpx / ((dz * this.roadTex.h) / GROUND_TILE);
        road.tileScaleX = rkx; road.tileScaleY = rky;
        road.tilePositionX = posMod(-(rw * 0.5) / rkx, this.roadTex.w);

        this.groundStrips.push({ zT, side, road });
        y = y1;
      }
    }

    updateGround() {
      const sd = this.scrollDist;
      const sh = this.sideTex.h, rh = this.roadTex.h;
      for (let i = 0; i < this.groundStrips.length; i++) {
        const st = this.groundStrips[i];
        const wz = st.zT + sd;
        st.side.tilePositionY = posMod((-wz * sh) / GROUND_TILE, sh);
        st.road.tilePositionY = posMod((-wz * rh) / GROUND_TILE, rh);
      }
    }

    // ------------------------------------------------------------------ pools
    getImg(tex) {
      let arr = this.pools.get(tex);
      if (!arr) { arr = []; this.pools.set(tex, arr); }
      const im = arr.pop() || this.add.image(0, 0, tex);
      im._fk = tex;
      im.setVisible(true).setOrigin(0.5, 1).setAlpha(1).setAngle(0).setFlipX(false);
      im.clearTint();
      return im;
    }
    relImg(im) {
      im.setVisible(false);
      const arr = this.pools.get(im._fk);
      if (arr) arr.push(im);
    }

    // ------------------------------------------------------------------ run state
    resetRun() {
      for (const e of this.ents) this.relImg(e.spr);
      this.ents.length = 0;
      this.distance = 0;
      this.runTime = 0;
      this.score = 0;
      this.coins = 0;
      this.speed = tune("baseSpeed", 420);
      this.laneX = 0; this.targetLane = 0; this.prevLane = 0;
      this.h = 0; this.vy = 0; this.grounded = true; this.groundH = 0;
      this.curG = this.normalG();
      this.slideT = 0; this.jumpBuf = 0; this.slideQueued = false; this.coyote = 0;
      this.power = { magnet: 0, shield: 0, x2: 0, jump: 0 };
      this.powerMax = { magnet: 1, shield: 1, x2: 1, jump: 1 };
      this.invuln = 0; this.bumpCD = 0;
      this.dead = false; this.deadT = 0; this.ended = false;
      this.nextPatternWz = 700;
      this.nextPowerT = rr(16, 22);
      this.lastTier = 0; this.lastPat = "";
      this.nextMilestone = 1000;
      this.coinStreak = 0; this.coinStreakT = 0;
      this.heroVX = 0;
      if (this.hero) { this.hero.setAlpha(1).setAngle(0); }
    }

    normalG() {
      const dur = Math.max(0.2, tune("jumpDuration", 0.6));
      return (8 * JUMP_PEAK) / (dur * dur);
    }

    // ------------------------------------------------------------------ HUD
    initHud() {
      this.hudCache = {};
      this.updateHud(true);
    }
    setHud(key, val, opts) {
      if (this.hudCache[key] === val) return;
      this.hudCache[key] = val;
      forge.hud.set(key, val, opts);
    }
    updateHud() {
      const sc = Math.floor(this.score);
      this.setHud("score", sc, { label: "Puntos", icon: "⭐" });
      this.setHud("coins", this.coins, { label: "Monedas", icon: "🪙" });
      this.setHud("multiplier", this.power.x2 > 0 ? "x2" : "x1", { label: "Multiplicador", icon: "✨" });
      this.setHud("shield", this.power.shield > 0 ? "Activo" : "—", { label: "Escudo", icon: "🛡️" });
      this.setHud("best", Math.max(this.best, sc), { label: "Récord", icon: "🏆" });
      let bk = null, br = 0;
      for (const k of POWER_KEYS) {
        if (this.power[k] > 0) {
          const r = this.power[k] / Math.max(0.01, this.powerMax[k]);
          if (r > br) { br = r; bk = k; }
        }
      }
      const ratio = Math.round(clamp(br, 0, 1) * 100) / 100;
      const key = (bk || "none") + ":" + ratio;
      if (this.hudCache.powerup !== key) {
        this.hudCache.powerup = key;
        forge.hud.bar("powerup", ratio, { label: bk ? POWER[bk].label : "Poder activo", color: bk ? POWER[bk].css : "#8a8fa8" });
      }
    }

    // ------------------------------------------------------------------ entities
    // NOTE: named "spawn" (not "add") because Phaser injects `this.add` (GameObjectFactory)
    // as an instance property on every Scene, which would shadow a class method called add().
    spawn(kind, lane, wz, extra) {
      const def = KIND[kind];
      const e = {
        kind, lane, wz, z: wz - this.distance, h: 0, len: 0, alive: true, mag: false, pop: 0,
        ptype: null, group: 0, wob: false, showAt: undefined, shown: false,
        w: def.w, spr: this.getImg(def.tex),
      };
      if (kind === "train") e.len = CAR_LEN;
      if (kind === "coin") e.h = COIN_H;
      if (kind === "power") e.h = 70;
      if (extra) Object.assign(e, extra);
      if (def.center) e.spr.setOrigin(0.5, 0.5);
      if (kind === "power" && e.ptype) e.spr.setTint(POWER[e.ptype].color);
      e.spr.setVisible(false);
      this.ents.push(e);
      return e;
    }
    coinRow(lane, wz, n, step = 70, h = COIN_H) {
      for (let i = 0; i < n; i++) this.spawn("coin", lane, wz + i * step, { h });
      return n * step;
    }
    coinArc(lane, center, jl, peak) {
      const n = 7;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        this.spawn("coin", lane, center - jl / 2 + u * jl, { h: COIN_H + peak * 4 * u * (1 - u) * 0.95 });
      }
    }
    addTrain(lane, wz, cars, extra) {
      const group = ++this.groupId;
      const out = [];
      for (let i = 0; i < cars; i++) out.push(this.spawn("train", lane, wz + i * CAR_LEN, Object.assign({ group }, extra || {})));
      return out;
    }

    tierAt(t) { return t < 15 ? 0 : t < 45 ? 1 : t < 90 ? 2 : 3; }

    pickPattern(tier) {
      const cands = PATTERNS.filter((p) => p.tier <= tier && p.id !== this.lastPat);
      let total = 0;
      for (const p of cands) total += p.w * (p.tier === tier && tier > 0 ? 2 : 1);
      let r = R() * total;
      for (const p of cands) {
        r -= p.w * (p.tier === tier && tier > 0 ? 2 : 1);
        if (r <= 0) return p.id;
      }
      return cands.length ? cands[cands.length - 1].id : "coinRow";
    }

    buildPattern(id, z, sp, jl, jd) {
      switch (id) {
        case "lowSingle": {
          const L = randLane();
          this.spawn("low", L, z + 160);
          this.coinRow(otherLane(L), z, 6);
          return 420;
        }
        case "coinRow": {
          const L = randLane();
          return this.coinRow(L, z, 8);
        }
        case "cones": {
          const a = shuffle3();
          this.spawn("cone", a[0], z);
          this.spawn("cone", a[1], z + sp * 0.8);
          this.coinRow(a[2], z - 60, 6);
          return sp * 0.8 + 120;
        }
        case "lowArc": {
          const L = randLane();
          const c = z + jl / 2;
          this.spawn("low", L, c);
          this.coinArc(L, c, jl, JUMP_PEAK);
          return jl + 120;
        }
        case "high": {
          const L = randLane();
          this.spawn("high", L, z + 220);
          this.coinRow(L, z + 80, 5, 70, 32);
          if (R() < 0.55) this.spawn("cone", otherLane(L), z + 220);
          return 460;
        }
        case "train": {
          const L = randLane();
          const cars = R() < 0.5 ? 2 : 3;
          this.addTrain(L, z, cars);
          const C = adjLane(L);
          this.coinRow(C, z + 60, Math.floor((cars * CAR_LEN) / 85), 80);
          if (R() < 0.4) {
            const other = LANES.find((x) => x !== L && x !== C);
            this.spawn("low", other, z + cars * CAR_LEN * 0.5);
          }
          return cars * CAR_LEN;
        }
        case "combo": {
          const a = shuffle3();
          const c = z + jl / 2;
          this.spawn("low", a[0], c);
          this.coinArc(a[0], c, jl, JUMP_PEAK);
          this.spawn("high", a[1], c);
          this.spawn("cone", a[2], c);
          return jl + 100;
        }
        case "twoTrains": {
          const a = shuffle3();
          const F = a[0], cars = 3, len = cars * CAR_LEN;
          this.addTrain(a[1], z, cars);
          this.addTrain(a[2], z, cars);
          if (R() < 0.6) {
            const c = z + len * 0.55;
            this.spawn("low", F, c);
            this.coinArc(F, c, jl, JUMP_PEAK);
            this.coinRow(F, z, 3, 70);
          } else this.coinRow(F, z, 10, 90);
          return len;
        }
        case "jumpSlide": {
          const sp2 = sp * (jd * 0.95 + 0.38) + 80;
          const c = z + jl / 2;
          for (const L of LANES) this.spawn("low", L, c);
          this.coinArc(0, c, jl, JUMP_PEAK);
          for (const L of LANES) this.spawn("high", L, c + sp2);
          this.coinRow(0, c + sp2 - 140, 5, 70, 32);
          return jl / 2 + sp2 + 120;
        }
        case "zigzag": {
          const F1 = randLane();
          const F2 = otherLane(F1);
          const len = 2 * CAR_LEN;
          for (const L of LANES) if (L !== F1) this.addTrain(L, z, 2);
          this.coinRow(F1, z, 7, 85);
          const gap = sp * 0.9 + 100;
          const z2 = z + len + gap;
          for (const L of LANES) if (L !== F2) this.addTrain(L, z2, 2);
          this.coinRow(F2, z2, 7, 85);
          return len * 2 + gap;
        }
        case "gauntlet": {
          const a = shuffle3();
          const c = z + jl / 2;
          this.spawn("low", a[0], c);
          this.coinArc(a[0], c, jl, JUMP_PEAK);
          this.spawn("high", a[1], c);
          this.spawn("cone", a[2], c);
          const z2 = c + sp * 0.9 + 140;
          const F = randLane();
          for (const L of LANES) if (L !== F) this.addTrain(L, z2, 2);
          this.coinRow(F, z2, 7, 85);
          return z2 - z + 2 * CAR_LEN;
        }
        case "power": {
          const L = randLane();
          this.coinRow(L, z, 4);
          this.spawn("power", L, z + 4 * 70 + 90, { ptype: pick(POWER_KEYS) });
          return 480;
        }
        default:
          return 300;
      }
    }

    spawnPatterns() {
      let guard = 0;
      while (this.nextPatternWz < this.distance + ZFAR && guard++ < 6) {
        const z = this.nextPatternWz;
        const base = tune("baseSpeed", 420);
        const max = Math.max(base, tune("maxSpeed", 900));
        const acc = tune("acceleration", 8);
        const tArr = this.runTime + (z - this.distance) / Math.max(100, this.speed);
        const sp = Math.min(max, base + acc * tArr) * 1.04;
        const jd = Math.max(0.2, tune("jumpDuration", 0.6));
        const jl = sp * jd;
        const tier = this.tierAt(tArr);
        let id;
        if (tArr >= this.nextPowerT && tArr > 12) { id = "power"; this.nextPowerT = tArr + rr(20, 30); }
        else id = this.pickPattern(tier);
        this.lastPat = id;
        const len = this.buildPattern(id, z, sp, jl, jd);
        const dens = clamp(tune("obstacleDensity", 1), 0.3, 3);
        let gap = (sp * 0.95 + 280) / dens;
        if (tier >= 3) gap *= 0.85;
        if (id === "coinRow" || id === "power") gap *= 0.6;
        gap = Math.max(gap, sp * 0.6 + 140);
        this.nextPatternWz = z + len + gap;
      }
    }

    // ------------------------------------------------------------------ actions
    doJump(quiet) {
      if (this.dead) return;
      if (this.grounded || this.coyote > 0) {
        const hj = this.power.jump > 0;
        const dur = Math.max(0.2, tune("jumpDuration", 0.6)) * (hj ? 1.35 : 1);
        const peak = hj ? HIGH_PEAK : JUMP_PEAK;
        this.curG = (8 * peak) / (dur * dur);
        this.vy = (4 * peak) / dur;
        this.grounded = false;
        this.coyote = 0; this.slideT = 0; this.jumpBuf = 0; this.slideQueued = false;
        forge.audio.play("sfx_jump", { volume: quiet ? 0.35 : 0.7, rate: hj ? 0.85 : 1 });
        this.dust(0xf7f7f2, 8);
      } else {
        this.jumpBuf = 0.16;
      }
    }
    doSlide(quiet) {
      if (this.dead) return;
      if (this.grounded) {
        if (this.slideT <= 0) forge.audio.play("sfx_slide", { volume: quiet ? 0.35 : 0.7 });
        this.slideT = SLIDE_TIME;
        this.jumpBuf = 0;
        this.dust(0xffd23f, 10);
      } else {
        const dur = Math.max(0.2, tune("jumpDuration", 0.6));
        this.vy = Math.min(this.vy, ((-4 * JUMP_PEAK) / dur) * 1.3);
        this.curG = Math.max(this.curG, this.normalG());
        this.slideQueued = true;
      }
    }
    doLane(dir, quiet) {
      if (this.dead) return;
      const t = clamp(this.targetLane + dir, -1, 1);
      if (t === this.targetLane) { if (!quiet) forge.shake(0.06); return; }
      this.prevLane = Math.round(this.laneX);
      this.targetLane = t;
      forge.audio.play("step", { volume: quiet ? 0.15 : 0.25, rate: 1.4 });
    }

    heroFeet() { return { x: CX + this.laneX * LANE_W, y: GY - this.groundH }; }
    dust(color, count) {
      const f = this.heroFeet();
      forge.phaser.burst(this, f.x, f.y - 6, { color, count, speed: 140, life: 380, size: 5 });
    }

    land() {
      const impact = -this.vy;
      this.vy = 0;
      this.grounded = true;
      this.dust(0xf7f7f2, 7);
      if (impact > 700) forge.shake(0.05);
      forge.audio.play("step", { volume: 0.25 });
      if (this.dead) return;
      if (this.slideQueued) { this.slideQueued = false; this.doSlide(this.cineOn); }
      else if (this.jumpBuf > 0) this.doJump(this.cineOn);
    }

    moveHero(dt) {
      const lct = Math.max(0.03, tune("laneChangeTime", 0.12));
      const dl = this.targetLane - this.laneX;
      const st = dt / lct;
      this.laneX = Math.abs(dl) <= st ? this.targetLane : this.laneX + Math.sign(dl) * st;

      let gH = 0;
      if (this.h >= TRAIN_H - 40) {
        for (let i = 0; i < this.ents.length; i++) {
          const e = this.ents[i];
          if (e.kind !== "train" || !e.alive) continue;
          const z = e.wz - this.distance;
          if (Math.abs(this.laneX - e.lane) < 0.5 && z <= 20 && z + e.len >= -20) { gH = TRAIN_H; break; }
        }
      }
      this.groundH = gH;
      if (this.grounded) {
        if (this.h > gH + 1) {
          this.grounded = false; this.vy = 0; this.curG = this.normalG(); this.coyote = 0.1; this.slideT = 0;
        } else this.h = gH;
      } else {
        this.vy -= this.curG * dt;
        this.h += this.vy * dt;
        this.coyote = Math.max(0, this.coyote - dt);
        if (this.h <= gH && this.vy <= 0) { this.h = gH; this.land(); }
      }
      if (!Number.isFinite(this.h)) { this.h = 0; this.vy = 0; this.grounded = true; }
      if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);
      if (this.jumpBuf > 0) this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    }

    // ------------------------------------------------------------------ simulation
    simulate(dt, live) {
      const sp = this.speed;
      this.distance += sp * dt;
      this.scrollDist += sp * dt;

      for (const k of POWER_KEYS) {
        if (this.power[k] > 0) {
          this.power[k] = Math.max(0, this.power[k] - dt);
          if (this.power[k] === 0 && live && !this.dead) forge.hud.message(POWER[k].label + ": fin", 700);
        }
      }
      this.invuln = Math.max(0, this.invuln - dt);
      this.bumpCD = Math.max(0, this.bumpCD - dt);
      this.coinStreakT = Math.max(0, this.coinStreakT - dt);
      if (this.coinStreakT === 0) this.coinStreak = 0;

      this.moveHero(dt);

      const magR = tune("coinMagnetRadius", 260);
      const magOn = this.power.magnet > 0 && !this.dead;
      const center = this.h + (this.slideT > 0 ? 35 : 75);
      const k = Math.min(1, dt * 9);

      for (let i = 0; i < this.ents.length; i++) {
        const e = this.ents[i];
        if (!e.alive) continue;
        let z = e.wz - this.distance;
        if (e.kind === "coin") {
          if (magOn && !e.mag && z < magR && z > -30) {
            const dx = (e.lane - this.laneX) * LANE_W;
            if (dx * dx + z * z < magR * magR) e.mag = true;
          }
          if (e.mag) {
            e.lane += (this.laneX - e.lane) * k;
            e.wz += (this.distance + 5 - e.wz) * k;
            e.h += (center - e.h) * k;
            z = e.wz - this.distance;
          }
          e.z = z;
          if (!this.dead && Math.abs(this.laneX - e.lane) < 0.6 && z > -45 && z < 45 && Math.abs(center - e.h) < 90) this.collectCoin(e);
          continue;
        }
        e.z = z;
        if (e.kind === "power") {
          if (!this.dead && Math.abs(this.laneX - e.lane) < 0.6 && z > -55 && z < 55 && Math.abs(center - e.h) < 120) this.collectPower(e);
          continue;
        }
        if (live && !this.dead) this.hitCheck(e);
      }

      for (let i = this.ents.length - 1; i >= 0; i--) {
        const e = this.ents[i];
        const end = e.kind === "train" ? e.z + e.len : e.z;
        if (!e.alive || end < ZNEAR) {
          this.relImg(e.spr);
          this.ents[i] = this.ents[this.ents.length - 1];
          this.ents.pop();
        }
      }

      if (live) this.spawnPatterns();
    }

    hitCheck(e) {
      if (Math.abs(this.laneX - e.lane) >= 0.55) return;
      const z = e.z, h = this.h;
      switch (e.kind) {
        case "low": if (z > -35 && z < 35 && h < 95) this.onHit(e); break;
        case "cone": if (z > -30 && z < 30 && h < 68) this.onHit(e); break;
        case "high": if (z > -25 && z < 25 && this.slideT <= 0 && h < 190) this.onHit(e); break;
        case "train":
          if (z <= 20 && z + e.len >= -20 && h < TRAIN_H - 35) {
            if (z >= -22 || this.prevLane === e.lane) this.onHit(e);
            else if (this.bumpCD <= 0) {
              // side scrape: bounce back to the lane we came from
              this.bumpCD = 0.3;
              this.targetLane = this.prevLane;
              forge.shake(0.25);
              forge.audio.play("hit", { volume: 0.5 });
              this.dust(0xff6b35, 10);
            }
          }
          break;
        default: break;
      }
    }

    onHit(e) {
      if (this.invuln > 0 || this.dead) return;
      if (this.power.shield > 0) {
        this.power.shield = 0;
        this.invuln = 1.1;
        forge.audio.play("sfx_shield_break", { volume: 0.8 });
        forge.shake(0.45);
        const f = this.heroFeet();
        forge.phaser.burst(this, f.x, f.y - 100, { color: 0x2ec4b6, count: 28, speed: 320, life: 600, size: 7 });
        forge.hud.message("¡Escudo roto!", 900);
        if (e.group) { for (const o of this.ents) if (o.group === e.group) this.killEnt(o); }
        else this.killEnt(e);
        return;
      }
      this.crash();
    }

    killEnt(e) {
      if (!e.alive) return;
      e.alive = false;
      const z = Math.max(-30, e.wz - this.distance);
      const s = D / (D + z);
      forge.phaser.burst(this, CX + e.lane * LANE_W * s, HY + (GY - HY - 60) * s, { color: 0xffd23f, count: 14, speed: 260, life: 500, size: 6 });
    }

    crash() {
      this.dead = true;
      this.deadT = 1.4;
      this.slideT = 0;
      forge.audio.play("sfx_crash", { volume: 0.9 });
      forge.audio.stopMusic();
      forge.shake(0.9);
      this.cameras.main.flash(160, 255, 240, 220);
      const f = this.heroFeet();
      forge.phaser.burst(this, f.x, f.y - 100, { color: 0xff6b35, count: 36, speed: 380, life: 700, size: 8 });
      forge.phaser.burst(this, f.x, f.y - 100, { color: 0xf7f7f2, count: 18, speed: 220, life: 500, size: 6 });
      this.vy = 320; this.grounded = false; this.curG = this.normalG();
    }

    finish() {
      this.ended = true;
      const sc = Math.floor(this.score);
      const newBest = sc > this.best;
      if (newBest) { this.best = sc; forge.save(BEST_KEY, sc); }
      forge.lose({
        title: "¡Choque!",
        subtitle: newBest ? "¡Nuevo récord! Kiko vuela por la ciudad." : "Kiko se estampó… ¡inténtalo otra vez!",
        stats: { Puntos: sc, Monedas: this.coins, Distancia: Math.floor(this.distance / 10) + " m", "Récord": this.best },
      });
    }

    collectCoin(e) {
      e.alive = false;
      const m = this.power.x2 > 0 ? 2 : 1;
      this.coins += m;
      if (!this.cineOn) this.score += 5 * m;
      this.coinStreak++; this.coinStreakT = 0.6;
      forge.audio.play("sfx_coin", { volume: this.cineOn ? 0.3 : 0.55, rate: 1 + (this.coinStreak % 8) * 0.05 });
      const z = Math.max(-30, e.z);
      const s = D / (D + z);
      const x = CX + e.lane * LANE_W * s, y = HY + (GY - HY - e.h) * s;
      forge.phaser.burst(this, x, y, { color: 0xffd23f, count: 6, speed: 150, life: 320, size: 4 });
      if (m === 2) forge.phaser.floatText(this, x, y - 20, "+2", { color: "#FFD23F", size: 26 });
      if (!this.cineOn && Math.floor(this.coins / 50) > Math.floor((this.coins - m) / 50)) {
        forge.hud.message(`¡${Math.floor(this.coins / 50) * 50} monedas!`, 1000);
      }
    }

    collectPower(e) {
      e.alive = false;
      const t = e.ptype || "magnet";
      const dur = Math.max(1, tune("powerupDuration", 8));
      this.power[t] = dur;
      this.powerMax[t] = dur;
      forge.audio.play("sfx_powerup", { volume: 0.8 });
      forge.shake(0.12);
      const f = this.heroFeet();
      forge.phaser.burst(this, f.x, f.y - 100, { color: POWER[t].color, count: 30, speed: 300, life: 650, size: 7 });
      forge.phaser.floatText(this, f.x, f.y - 230, POWER[t].label + "!", { color: POWER[t].css, size: 34 });
      forge.hud.message("¡" + POWER[t].label + "!", 1100);
    }

    // ------------------------------------------------------------------ input
    readInput() {
      const I = forge.input;
      let L = I.pressed("left"), Rt = I.pressed("right");
      let J = I.pressed("jump") || I.pressed("up") || I.pressed("action");
      let S = I.pressed("down") || I.pressed("action2");
      while (this.swipeQ.length) {
        const s = this.swipeQ.shift();
        if (s === "left") L = true; else if (s === "right") Rt = true; else if (s === "up") J = true; else if (s === "down") S = true;
      }
      if (L) this.doLane(-1);
      if (Rt) this.doLane(1);
      if (J) this.doJump(false);
      if (S) this.doSlide(false);
    }

    // ------------------------------------------------------------------ main update
    update(time, delta) {
      const dt = Math.min(0.05, Math.max(0, (Number.isFinite(delta) ? delta : 16) / 1000));
      if (forge.cinematic && forge.cinematic.active) return; // onCinematic drives the intro
      if (this.cineOn) this.endCine();
      if (!this.hintShown) {
        this.hintShown = true;
        forge.hud.message("←/→ carril · ↑/Espacio saltar · ↓ deslizar", 3200);
      }
      this.playStep(dt);
    }

    playStep(dt) {
      const base = tune("baseSpeed", 420);
      const max = Math.max(base, tune("maxSpeed", 900));
      const acc = tune("acceleration", 8);
      if (!this.dead) {
        this.runTime += dt;
        this.speed = Math.min(max, base + acc * this.runTime);
        this.readInput();
      } else {
        this.speed = Math.max(0, this.speed - this.speed * 5 * dt - 40 * dt);
      }
      this.heroVX = this.dead ? 0 : this.speed;
      this.cineLines = 0;
      this.simulate(dt, true);

      if (!this.dead) {
        const m = this.power.x2 > 0 ? 2 : 1;
        this.score += this.speed * dt * 0.1 * m;
        const tier = this.tierAt(this.runTime);
        if (tier > this.lastTier) {
          this.lastTier = tier;
          forge.hud.message(tier >= 3 ? "¡Velocidad máxima!" : "¡Más rápido!", 1200);
        }
        if (this.score >= this.nextMilestone) {
          forge.hud.message(`¡${this.nextMilestone} puntos!`, 900);
          forge.audio.play("coin", { volume: 0.4, rate: 1.5 });
          this.nextMilestone += 1000;
        }
      } else {
        this.deadT -= dt;
        if (this.deadT <= 0 && !this.ended) this.finish();
      }
      this.updateHud();
      this.render(dt);
    }

    // ------------------------------------------------------------------ cinematic
    runCine(dtIn, cine) {
      let dt = Number(dtIn);
      if (!Number.isFinite(dt) || dt < 0) dt = 1 / 60;
      if (dt > 1) dt /= 1000;
      dt = Math.min(0.05, dt);

      if (!this.cineOn) {
        this.cineOn = true;
        this.resetRun();
        this.swipeQ.length = 0;
        this.cineIdx = -1;
        this.cineLocal = 0;
        this.showGroups = [];
      }
      const dir = (forge.design.cinematic && forge.design.cinematic.direction) || {};
      const shots = Array.isArray(dir.shots) ? dir.shots : [];
      let idx = Number.isFinite(cine.shotIndex) ? cine.shotIndex : 0;
      if (shots.length) idx = clamp(idx, 0, shots.length - 1);
      const shot = cine.shot || shots[idx] || null;
      const n = Math.max(1, shots.length);
      if (idx !== this.cineIdx) {
        this.cineIdx = idx;
        this.cineLocal = 0;
        this.cineFlags = {};
        this.cineRole = idx === 0 ? "intro" : idx >= n - 1 ? "action" : shot && shot.lineIndex === -1 ? "tease" : "tour";
        this.stageCine(this.cineRole);
      }
      this.cineLocal += dt;
      const dur = Math.max(0.5, (shot && shot.durationSec) || 4);
      const lp = clamp(this.cineLocal / dur, 0, 1);
      this.cineCamera(shot, lp);

      const role = this.cineRole;
      if (role === "action") {
        this.speed = 480;
        this.heroVX = this.speed;
        this.cineLines = 0.45;
        this.autopilot(lp);
        this.simulate(dt, false);
      } else {
        let sp = 0;
        if (role === "intro") {
          if (lp > 0.28 && !this.cineFlags.hop) {
            this.cineFlags.hop = true;
            this.vy = (4 * 90) / 0.35; this.curG = (8 * 90) / (0.35 * 0.35); this.grounded = false;
            const f = this.heroFeet();
            forge.phaser.burst(this, f.x + 40, f.y - 200, { color: 0x3a86ff, count: 5, speed: 90, life: 500, size: 5 });
          }
          sp = lp > 0.6 ? 260 * ((lp - 0.6) / 0.4) : 0;
          this.heroVX = lp > 0.6 ? 380 : 0;
          this.cineLines = lp > 0.6 ? 0.15 : 0;
        } else if (role === "tour") {
          sp = 50;
          this.heroVX = 300;
          this.cineLines = 0;
          const groups = this.showGroups || [];
          for (let i = 0; i < groups.length; i++) {
            if (!this.cineFlags["p" + i] && lp > 0.12 + i * 0.24) {
              this.cineFlags["p" + i] = true;
              for (const e of groups[i]) {
                e.pop = 1;
                const z = Math.max(1, e.wz - this.distance), s = D / (D + z);
                forge.phaser.burst(this, CX + e.lane * LANE_W * s, HY + (GY - HY) * s, {
                  color: e.kind === "train" ? 0xf7f7f2 : 0xffd23f, count: e.kind === "train" ? 14 : 8, speed: 160, life: 450, size: 5,
                });
              }
            }
          }
        } else {
          sp = 140;
          this.heroVX = 360;
          this.cineLines = 0.15 + 0.4 * Math.sin(lp * Math.PI);
        }
        this.speed = sp;
        this.scrollDist += sp * dt;
        this.moveHero(dt);
      }
      this.render(dt);
    }

    clearEnts() {
      for (const e of this.ents) this.relImg(e.spr);
      this.ents.length = 0;
    }

    stageShowcase() {
      this.clearEnts();
      const cone = this.spawn("cone", 1, this.distance + 560, { wob: true });
      const low = this.spawn("low", 0, this.distance + 900, { wob: true });
      const cars = this.addTrain(-1, this.distance + 1250, 2, { wob: true });
      this.showGroups = [[cone], [low], cars];
    }

    stageCine(role) {
      if (role === "intro") {
        this.stageShowcase();
      } else if (role === "tour") {
        if (!this.ents.length) this.stageShowcase();
      } else if (role === "tease") {
        if (!this.ents.length) this.stageShowcase();
        const n = 8;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          this.spawn("coin", 0, this.distance + 320 + u * 300, { h: 70 + 200 * 4 * u * (1 - u), showAt: 0.15 + i * 0.1 });
        }
        this.spawn("power", -0.7, this.distance + 700, { ptype: "magnet", h: 300, showAt: 1.1 });
        this.spawn("power", 0.7, this.distance + 700, { ptype: "shield", h: 300, showAt: 1.35 });
      } else {
        this.clearEnts();
        this.laneX = 0; this.targetLane = 0; this.prevLane = 0;
        this.h = 0; this.vy = 0; this.grounded = true; this.slideT = 0;
        const d = this.distance;
        const jl = 480 * Math.max(0.2, tune("jumpDuration", 0.6));
        this.spawn("low", 0, d + 560);
        this.coinArc(0, d + 560, jl, JUMP_PEAK);
        this.spawn("high", 0, d + 1000);
        this.coinRow(0, d + 900, 4, 70, 32);
        this.addTrain(0, d + 1700, 1);
        this.coinRow(1, d + 1600, 6, 80);
      }
    }

    autopilot(lp) {
      const jd = Math.max(0.2, tune("jumpDuration", 0.6));
      for (let i = 0; i < this.ents.length; i++) {
        const e = this.ents[i];
        if (!e.alive || Math.abs(e.lane - this.targetLane) > 0.4) continue;
        const z = e.wz - this.distance;
        if (e.kind === "low" && z > 0 && z < this.speed * jd * 0.5 + 30 && this.grounded) this.doJump(true);
        else if (e.kind === "high" && z > 0 && z < 130 && this.grounded && this.slideT <= 0) this.doSlide(true);
        else if (e.kind === "train" && z > 0 && z < 420) this.doLane(1, true);
      }
      if (lp > 0.95 && this.targetLane !== 0) {
        let blocked = false;
        for (const e of this.ents) {
          if (e.kind === "train" && e.alive && e.lane === 0) {
            const z = e.wz - this.distance;
            if (z < 200 && z + e.len > -40) blocked = true;
          }
        }
        if (!blocked) this.doLane(-1, true);
      }
    }

    cineCamera(shot, lp) {
      const cam = this.cameras.main;
      const c = shot && shot.camera;
      const f = (c && Array.isArray(c.from) && c.from) || [0, 0, 1];
      const to = (c && Array.isArray(c.to) && c.to) || [0, 0, 1];
      const e = ease(c && c.ease, lp);
      const x = lerp(Number(f[0]) || 0, Number(to[0]) || 0, e);
      const y = lerp(Number(f[1]) || 0, Number(to[1]) || 0, e);
      let zm = lerp(Number(f[2]) || 1, Number(to[2]) || 1, e);
      if (this.cineRole === "tease") zm += 0.25 * Math.sin(lp * Math.PI);
      cam.setZoom(clamp(zm, 1, 3));
      cam.centerOn(CX + x * 3, 470 - y * 3.1);
      if (this.cineRole === "intro" && lp < 0.45) cam.setRotation(Math.sin(this.cineLocal * 38) * 0.01);
      else cam.setRotation(0);
    }

    endCine() {
      this.cineOn = false;
      this.cineRole = "";
      this.cineLines = 0;
      const cam = this.cameras.main;
      cam.setZoom(1);
      cam.setRotation(0);
      cam.centerOn(CX, H / 2);
      this.resetRun();
      this.swipeQ.length = 0;
      this.hintShown = false;
      this.hudCache = {};
      this.updateHud();
    }

    // ------------------------------------------------------------------ hero run animation pacing
    // Configures the sheet's "run" clip once: the frame count is read from the clip itself
    // (whatever the sheet provides), the base frameRate is lowered for a smoother stride,
    // and the clip loops forever.
    configureRunAnim(cur) {
      try {
        const count = cur.frames && cur.frames.length ? cur.frames.length : 1;
        const fps = count >= 8 ? clamp(10 + (count - 8) * 0.25, 10, 12) : clamp(count * 1.4, 6, 10);
        this.runFps = fps;
        cur.frameRate = fps;
        cur.msPerFrame = 1000 / fps;
        cur.duration = count * cur.msPerFrame;
        cur.repeat = -1;
      } catch (err) { /* keep the runtime's clip as-is */ }
    }

    // Applies the run pacing to the playing AnimationState (it copies timing at play time).
    applyRunState(st) {
      const ms = 1000 / this.runFps;
      if (st.repeat !== -1) st.repeat = -1;
      st.repeatCounter = Number.MAX_VALUE;
      if (st.frameRate !== this.runFps) st.frameRate = this.runFps;
      if (st.msPerFrame !== ms) st.msPerFrame = ms;
    }

    tuneRunAnim() {
      const st = this.hero && this.hero.anims;
      if (!st || !this.anim || this.anim.animated === false) { this.prevClip = ""; return; }
      const clip = this.anim.current || "";
      const cur = st.currentAnim;
      if (clip !== "run" || !cur) {
        // jump / slide / hurt / idle play at their native rate
        if (st.timeScale !== 1) st.timeScale = 1;
        this.prevClip = clip;
        return;
      }
      if (this.runAnimRef !== cur) {
        this.runAnimRef = cur;
        this.configureRunAnim(cur);
      }
      const entering = this.prevClip !== "run";
      this.prevClip = "run";
      this.applyRunState(st);
      // after landing / sliding the clip must be running again from a clean loop
      if (entering && !st.isPlaying && typeof st.restart === "function") {
        try { st.restart(); this.applyRunState(st); } catch (err) { /* ignore */ }
      }

      const base = tune("baseSpeed", 420);
      const max = Math.max(base + 1, tune("maxSpeed", 900));
      const r = clamp((this.speed - base) / (max - base), 0, 1);
      const ts = clamp(lerp(RUN_TS_MIN, RUN_TS_MAX, r), RUN_TS_MIN, RUN_TS_MAX);
      if (Number.isFinite(ts) && st.timeScale !== ts) st.timeScale = ts;
    }

    // ------------------------------------------------------------------ rendering
    quad(g, X0, X1, z0, z1) {
      const s0 = D / (D + z0), s1 = D / (D + z1);
      const y0 = HY + (GY - HY) * s0, y1 = HY + (GY - HY) * s1;
      g.beginPath();
      g.moveTo(CX + X0 * s0, y0);
      g.lineTo(CX + X1 * s0, y0);
      g.lineTo(CX + X1 * s1, y1);
      g.lineTo(CX + X0 * s1, y1);
      g.closePath();
      g.fillPath();
    }

    drawRoad() {
      const g = this.roadG;
      g.clear();
      const ZF = 24000, zMax = 2800;
      // subtle shade over the asphalt only (side ground stays untouched)
      g.fillStyle(0x1b1f3b, 0.22);
      this.quad(g, -ROAD_HALF, ROAD_HALF, ZNEAR, ZF);
      g.fillStyle(0x6b5d57, 0.28);
      for (const L of LANES) { const lx = L * LANE_W; this.quad(g, lx - 100, lx + 100, ZNEAR, ZF); }

      // sleepers
      const SP = 95;
      g.fillStyle(0x7b4a33, 0.95);
      for (let wz = Math.ceil((this.scrollDist + ZNEAR) / SP) * SP; wz - this.scrollDist < zMax; wz += SP) {
        const z = wz - this.scrollDist;
        for (const L of LANES) { const lx = L * LANE_W; this.quad(g, lx - 86, lx + 86, z, z + 22); }
      }
      // rails
      g.fillStyle(0x5b6078, 1);
      for (const L of LANES) {
        const lx = L * LANE_W;
        this.quad(g, lx - 60, lx - 48, ZNEAR, ZF);
        this.quad(g, lx + 48, lx + 60, ZNEAR, ZF);
      }
      g.fillStyle(0xdde1f0, 1);
      for (const L of LANES) {
        const lx = L * LANE_W;
        this.quad(g, lx - 58, lx - 52, ZNEAR, ZF);
        this.quad(g, lx + 52, lx + 58, ZNEAR, ZF);
      }
      // dashed lane dividers
      const DS = 260;
      g.fillStyle(0xf7f7f2, 0.85);
      for (let wz = Math.ceil((this.scrollDist + ZNEAR) / DS) * DS; wz - this.scrollDist < zMax + 1500; wz += DS) {
        const z = wz - this.scrollDist;
        this.quad(g, -LANE_W / 2 - 5, -LANE_W / 2 + 5, z, z + 120);
        this.quad(g, LANE_W / 2 - 5, LANE_W / 2 + 5, z, z + 120);
      }
      // curbs
      const CS = 140;
      for (let wz = Math.floor((this.scrollDist + ZNEAR) / CS) * CS; wz - this.scrollDist < zMax + 1500; wz += CS) {
        const z = wz - this.scrollDist;
        const k = Math.abs(Math.round(wz / CS));
        g.fillStyle(k % 2 ? 0xff6b35 : 0xf7f7f2, 1);
        this.quad(g, -ROAD_HALF - CURB_W, -ROAD_HALF, z, z + CS);
        this.quad(g, ROAD_HALF, ROAD_HALF + CURB_W, z, z + CS);
      }
      // road edge: dark-blue outlines on both sides of the curb + light inner stripe
      g.fillStyle(0x1b1f3b, 1);
      this.quad(g, -ROAD_HALF - CURB_W - EDGE_OUT, -ROAD_HALF - CURB_W, ZNEAR, ZF);
      this.quad(g, ROAD_HALF + CURB_W, ROAD_HALF + CURB_W + EDGE_OUT, ZNEAR, ZF);
      this.quad(g, -ROAD_HALF, -ROAD_HALF + 6, ZNEAR, ZF);
      this.quad(g, ROAD_HALF - 6, ROAD_HALF, ZNEAR, ZF);
      g.fillStyle(0xf7f7f2, 0.95);
      this.quad(g, -ROAD_HALF + 6, -ROAD_HALF + 13, ZNEAR, ZF);
      this.quad(g, ROAD_HALF - 13, ROAD_HALF - 6, ZNEAR, ZF);

      // warm haze at the horizon
      for (let i = 0; i < 6; i++) {
        g.fillStyle(0xffd9a8, 0.3 - i * 0.045);
        g.fillRect(0, HY - 2, W, 8 + i * 10);
      }
    }

    updateDecor() {
      const minEdge = ROAD_HALF + CURB_W + EDGE_OUT + PROP_MARGIN;
      for (let i = 0; i < 8; i++) {
        const k = DECOR[i % 4];
        const side = i < 4 ? -1 : 1;
        let guard = 0;
        while (this.decorNext[i] < this.scrollDist + ZFAR && guard++ < 30) {
          const wz = this.decorNext[i];
          this.decorNext[i] += rr(k.g0, k.g1);
          if (k.skip && R() < k.skip) continue;
          const spr = this.getImg(k.tex);
          spr.setTint(pick(k.tints));
          if (k.flip) spr.setFlipX(R() < 0.5);
          else if (k.tex === "prop_billboard") spr.setFlipX(side < 0);
          spr.setVisible(false);
          const w = rr(k.w0, k.w1);
          // keep every prop entirely over the side ground, never on the asphalt
          const X = side * Math.max(rr(k.x0, k.x1), minEdge + w * 0.5);
          this.decor.push({ X, wz, w, spr });
        }
      }
      for (let i = this.decor.length - 1; i >= 0; i--) {
        const d = this.decor[i];
        const z = d.wz - this.scrollDist;
        if (z < ZNEAR) {
          this.relImg(d.spr);
          this.decor[i] = this.decor[this.decor.length - 1];
          this.decor.pop();
          continue;
        }
        const s = D / (D + z);
        const sx = CX + d.X * s;
        const half = d.w * s * 0.5;
        if (z > ZFAR + 60 || sx - half > W || sx + half < 0) { d.spr.setVisible(false); continue; }
        d.spr.setVisible(true)
          .setPosition(sx, HY + (GY - HY) * s)
          .setScale((d.w * s) / d.spr.width)
          .setDepth(100 + (4000 - z) * 0.1)
          .setAlpha(clamp((ZFAR - z) / 500, 0, 1));
      }
    }

    renderEnts(t, dt) {
      const sg = this.shadowG;
      for (let i = 0; i < this.ents.length; i++) {
        const e = this.ents[i];
        const spr = e.spr;
        const z = e.wz - this.distance;
        e.z = z;
        const hiddenByCine = e.showAt !== undefined && this.cineOn && this.cineLocal < e.showAt;
        if (!e.alive || z < ZNEAR || z > ZFAR + 60 || hiddenByCine) { spr.setVisible(false); continue; }
        if (e.showAt !== undefined && !e.shown) {
          e.shown = true; e.pop = 1;
          const s0 = D / (D + z);
          forge.phaser.burst(this, CX + e.lane * LANE_W * s0, HY + (GY - HY - e.h) * s0, { color: 0xfff1a8, count: 6, speed: 110, life: 380, size: 4 });
        }
        const s = D / (D + z);
        let mult = 1;
        if (e.pop > 0) { e.pop = Math.max(0, e.pop - dt * 2.4); mult = 1 + 0.45 * Math.sin(e.pop * Math.PI); }
        let h = e.h;
        if (e.kind === "power") h += Math.sin(t * 4 + e.wz * 0.01) * 12;
        const sx = CX + e.lane * LANE_W * s, sy = HY + (GY - HY - h) * s;
        const sc = ((e.w * s) / spr.width) * mult;
        let scx = sc;
        if (e.kind === "coin") scx = sc * (0.2 + 0.8 * Math.abs(Math.cos(t * 5 + e.wz * 0.013)));
        else if (e.kind === "power") scx = sc * (1 + 0.08 * Math.sin(t * 8));
        const alpha = clamp((ZFAR - z) / 500, 0, 1);
        spr.setVisible(true).setPosition(sx, sy).setScale(scx, sc).setDepth(100 + (4000 - z) * 0.1).setAlpha(alpha);
        if (e.wob) spr.setAngle(Math.sin(t * 6 + e.wz * 0.05) * 4);
        if (z > -40) {
          const gy = HY + (GY - HY) * s;
          const f = e.kind === "train" ? 0.95 : e.kind === "coin" || e.kind === "power" ? 0.5 : 0.8;
          const sw = e.w * s * f;
          sg.fillStyle(0x1b1f3b, 0.22 * alpha);
          sg.fillEllipse(sx, gy, sw, sw * 0.22);
        }
      }
    }

    renderHero(t, dt) {
      const hero = this.hero;
      const hx = CX + this.laneX * LANE_W;
      const hy = GY - this.h;
      const depth = this.groundH > 0 ? 800 : !this.grounded ? 650 : 500;
      hero.setPosition(hx, hy).setDepth(depth);
      hero.setAngle(clamp((this.targetLane - this.laneX) * 16, -12, 12));
      hero.setAlpha(this.invuln > 0 && !this.dead ? (Math.floor(t * 20) % 2 ? 0.35 : 1) : 1);
      this.anim.update({
        vx: this.heroVX, vy: -this.vy, grounded: this.grounded,
        sliding: this.slideT > 0, dashing: false, attacking: false, hurt: this.dead,
      }, dt);
      this.tuneRunAnim();

      // shadow
      const sh = this.heroShadowG;
      sh.clear().setDepth(depth - 1);
      const gy = GY - this.groundH;
      const air = Math.max(0, this.h - this.groundH);
      const ss = clamp(1 - air / 420, 0.35, 1);
      sh.fillStyle(0x1b1f3b, 0.3 * ss);
      sh.fillEllipse(hx, gy, 130 * ss, 32 * ss);

      // power-up auras
      const fx = this.fxG;
      fx.clear().setDepth(depth + 1);
      const cy = hy - (this.slideT > 0 ? 55 : 95);
      if (this.power.shield > 0) {
        const r = 112 + Math.sin(t * 6) * 5;
        fx.fillStyle(0x2ec4b6, 0.12); fx.fillCircle(hx, cy, r);
        fx.lineStyle(4, 0x2ec4b6, 0.85); fx.strokeCircle(hx, cy, r);
        fx.lineStyle(2, 0xf7f7f2, 0.6); fx.strokeCircle(hx - 25, cy - 35, r * 0.35);
      }
      if (this.power.magnet > 0) {
        fx.lineStyle(4, 0xff6b35, 0.75);
        for (let i = 0; i < 2; i++) {
          const a = t * 4 + i * Math.PI;
          fx.beginPath(); fx.arc(hx, cy, 135, a, a + 1.1); fx.strokePath();
        }
      }
      if (this.power.x2 > 0) {
        fx.fillStyle(0xffd23f, 0.95);
        for (let i = 0; i < 4; i++) {
          const a = t * 3 + (i * Math.PI) / 2;
          fx.fillCircle(hx + Math.cos(a) * 80, cy + Math.sin(a) * 30 - 60, 6);
        }
      }
      if (this.power.jump > 0) {
        fx.lineStyle(4, 0x8338ec, 0.8);
        fx.strokeEllipse(hx, gy, 150 + Math.sin(t * 10) * 10, 36);
      }
    }

    renderSpeedLines(dt) {
      const g = this.speedG;
      g.clear();
      const sp = this.speed;
      const alpha = clamp((sp - 560) / 600, 0, 0.55) + this.cineLines + (this.power.jump > 0 ? 0.1 : 0);
      if (alpha <= 0.01) return;
      for (const l of this.lines) {
        l.r += dt * (0.5 + sp / 450);
        if (l.r > 1) { l.r = R() * 0.15; l.a = lineAngle(); }
        const rad = 140 + l.r * l.r * 900, len = 30 + l.r * 180;
        const c = Math.cos(l.a), s = Math.sin(l.a);
        g.lineStyle(1.5 + l.r * 3, 0xffffff, clamp(alpha * l.r, 0, 0.7));
        g.lineBetween(CX + c * rad, HY + s * rad, CX + c * (rad + len), HY + s * (rad + len));
      }
    }

    render(dt) {
      const t = this.time.now / 1000;
      this.updateGround();
      this.updateDecor();
      this.drawRoad();
      this.shadowG.clear();
      this.renderEnts(t, dt);
      this.renderHero(t, dt);
      this.renderSpeedLines(dt);
      this.sky.x = CX - this.laneX * 18 + Math.sin(t * 0.1) * 8;
    }
  }

  return {
    scenes: [MainScene],
    physics: "arcade",
    gravity: 0,
    background: "#FFB27A",
    onCinematic(dt, cine) {
      const s = sceneRef;
      if (!s || !s.hero || !cine) return;
      if (cine.active) s.runCine(dt, cine);
      else if (s.cineOn) s.endCine();
    },
  };
}