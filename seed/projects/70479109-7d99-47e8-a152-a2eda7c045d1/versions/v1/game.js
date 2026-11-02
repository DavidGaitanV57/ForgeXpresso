export default function createGame(forge, Phaser) {
  const W = 7800, TOWER_X = 7500, TOWER_BASE = 440, FLOOR = 900, DEATH_Y = 800, HERO_H = 84;
  const C = { ink: 0x0b0620, deep: 0x2a1458, pink: 0xff2e97, cyan: 0x16e0ff, yellow: 0xf9f871, violet: 0x7b5cff, navy: 0x1a1a2e };
  const NEON = [C.pink, C.cyan, C.yellow, C.violet];
  let sceneRef = null;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const ease = (n, t) => (n === "linear" ? t : n === "easeIn" ? t * t : n === "easeOut" ? 1 - (1 - t) * (1 - t) : t * t * (3 - 2 * t));
  const mapCineX = (x) => (x <= 1000 ? x : 1000 + ((x - 1000) * (TOWER_X - 1000)) / 4450);
  const overlap = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  const fmtTime = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  function setting(key, def) {
    try { const s = forge.settings; if (s && s[key] !== undefined && s[key] !== null) return s[key]; } catch (e) { /* noop */ }
    return def;
  }
  const truthy = (v) => !(v === false || v === 0 || v === "0" || v === "false" || v === "off");
  const shake = (i) => { if (truthy(setting("screenShake", true))) forge.shake(i); };
  const diffMul = () => { const d = setting("difficulty", "Normal"); return d === "Fácil" ? 0.75 : d === "Difícil" ? 1.3 : 1; };

  // ---------------- Level data (default tuning: jump ≈107px high / 207px long, double ≈214 / 350) ----------------
  const PLATFORMS = [
    [0, 560, 520], [660, 540, 360], [1180, 480, 200], [1520, 380, 160], [1840, 560, 380],
    [2460, 560, 520], [2980, 300, 340], [3580, 380, 320],
    [4480, 380, 300], [4980, 440, 260], [5240, 220, 260],
    [5640, 300, 110], [5880, 260, 100], [6120, 340, 110], [6560, 320, 100], [6800, 380, 110], [7040, 440, 760],
  ];
  const SIGNS = [[4020, 400, 130, 0, C.pink], [4240, 360, 130, 0.75, C.cyan], [6340, 300, 110, 0.4, C.yellow]];
  const SPIKES = [[3840, 50, 380], [4700, 60, 380], [5440, 50, 220]];
  const DRONES = [
    [2720, 480, "h", 120, 0.6, 0], [3150, 230, "h", 100, 0.7, 0], [3780, 310, "h", 40, 0.8, 0],
    [4600, 280, "w", 60, 1.0, 50], [5100, 330, "w", 60, 1.0, 40],
    [5815, 210, "w", 40, 1.2, 40], [6050, 250, "w", 50, 1.3, 50], [6505, 220, "h", 60, 1.3, 0],
    [6730, 280, "w", 50, 1.4, 45], [7280, 380, "h", 120, 1.2, 0],
  ];
  const CRATES = [[860, 540], [3200, 300], [7250, 440]];
  const CHECKPOINTS = [[200, 560], [1960, 560], [3620, 380], [5300, 220]];
  const TIPS = [
    [700, "J o clic: rompe la caja con la katana"],
    [1300, "Pulsa saltar otra vez en el aire: ¡doble salto!"],
    [2150, "Hueco grande: Shift = dash, también en el aire"],
    [2500, "Corta los drones con la katana antes de que te toquen"],
    [2800, "Salta contra el muro y vuelve a saltar: ¡salto de pared!"],
    [3700, "¡Cuidado con las antenas eléctricas!"],
    [3930, "Los carteles se apagan cada 1,5 s: ¡calcula el salto!"],
    [5520, "¡Tramo final! Sigue los peces hasta la antena maestra"],
  ];
  function buildFish() {
    const out = [];
    const row = (x0, x1, y, n) => { for (let i = 0; i < n; i++) out.push([n === 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1), y]); };
    const ab = (x0, y0, x1, y1, h, n) => { for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push([lerp(x0, x1, t), lerp(y0, y1, t) - Math.sin(t * Math.PI) * h]); } };
    row(240, 480, 520, 4); ab(500, 520, 690, 500, 60, 4); row(740, 800, 500, 2); ab(960, 500, 1200, 440, 70, 4);
    row(1230, 1350, 440, 3); ab(1360, 440, 1540, 340, 80, 4); row(1570, 1650, 340, 3); ab(1670, 340, 1860, 520, 60, 4); row(1900, 2180, 520, 5);
    ab(2200, 520, 2480, 520, 110, 6); row(2520, 2640, 520, 3);
    row(2950, 2950, 480, 1); row(2950, 2950, 420, 1); row(2950, 2950, 360, 1); row(2950, 2950, 300, 1); row(2995, 2995, 250, 1);
    row(3040, 3140, 260, 3); row(3250, 3300, 260, 2); ab(3320, 260, 3600, 340, 80, 5); row(3620, 3700, 340, 2);
    ab(3880, 300, 4060, 360, 40, 3); ab(4110, 360, 4280, 320, 50, 3); ab(4330, 320, 4500, 340, 50, 3); row(4540, 4660, 340, 3);
    ab(4700, 320, 5000, 400, 110, 5); row(5020, 5200, 400, 4); row(5215, 5215, 330, 1); row(5215, 5215, 260, 1); row(5270, 5420, 180, 4);
    ab(5440, 160, 5680, 260, 70, 4); ab(5730, 260, 5900, 220, 60, 3); ab(5960, 220, 6150, 300, 60, 3); ab(6210, 300, 6370, 260, 60, 3);
    ab(6430, 260, 6590, 280, 60, 3); ab(6640, 280, 6830, 340, 60, 3); ab(6890, 340, 7070, 400, 60, 3); row(7100, 7400, 400, 6);
    return out;
  }

  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      sceneRef = this;
      this.ready = false;
      this.env = 0; this.levelTime = 0; this.neonReveal = 1; this.neonDim = 1; this.cineDead = false;
      this.cineWas = false; this.cineIdx = -1; this.cineT = 0; this.hintShown = false; this.sparkT = 0;
      this.makeTextures();
      this.physics.world.gravity.y = 0;
      this.physics.world.setBounds(0, -2000, W, 4000);
      this.physics.world.setBoundsCollision(true, true, false, false);
      this.buildBackground();
      this.buildLevel();
      this.buildPlayer();
      this.buildRain();
      this.cameras.main.setBackgroundColor("#0b0620");
      this.restoreCamera();

      this.lives = Math.max(1, Math.round(forge.tune("startLives", 3)));
      this.score = 0; this.fishCount = 0; this.kills = 0; this.cratesBroken = 0; this.deaths = 0; this.cpIndex = 0;
      this.facing = 1; this.coyote = 0; this.jumpBuffer = 0; this.airJumps = 1; this.airDash = true; this.jumping = false;
      this.dashTimer = 0; this.dashCd = 0; this.dashCdTotal = 1; this.trail = null; this.trailT = 0;
      this.wallDir = 0; this.wallCoyote = 0; this.lockTimer = 0; this.slideT = 0;
      this.attackTimer = 0; this.attackCd = 0; this.clickAttack = false; this.invuln = 0;
      this.dead = false; this.deadTimer = 0; this.ended = false; this.won = false;
      this.wasGrounded = true; this.lastVy = 0; this.chain = 0; this.chainT = 0;
      this.tips = TIPS.map(([x, text]) => ({ x, text, shown: false }));
      this.hudCache = {};

      this.input.on("pointerdown", (p) => { if (p && !p.wasTouch && (p.button === 0 || p.button === undefined)) this.clickAttack = true; });
      this.events.once("shutdown", () => this.cleanup());
      forge.audio.music("music_neon_rooftops", { volume: 0.6 });
      this.updateHud(true);
      this.ready = true;
    }

    makeTextures() {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      if (!this.textures.exists("nk_rain")) { g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 2, 22); g.generateTexture("nk_rain", 2, 22); }
      if (!this.textures.exists("nk_slash")) {
        g.clear(); g.lineStyle(12, C.cyan, 0.85); g.beginPath(); g.arc(20, 60, 58, -1.2, 1.2, false); g.strokePath();
        g.lineStyle(4, 0xffffff, 1); g.beginPath(); g.arc(20, 60, 54, -1.0, 1.0, false); g.strokePath(); g.generateTexture("nk_slash", 100, 120);
      }
      if (!this.textures.exists("nk_lantern")) {
        g.clear(); g.fillStyle(C.pink, 0.3); g.fillCircle(24, 30, 24); g.fillStyle(C.pink, 1); g.fillEllipse(24, 30, 26, 34);
        g.fillStyle(C.yellow, 0.9); g.fillEllipse(24, 30, 12, 22); g.fillStyle(C.ink, 1); g.fillRect(17, 10, 14, 5); g.fillRect(17, 45, 14, 5);
        g.generateTexture("nk_lantern", 48, 60);
      }
      g.destroy();
    }

    buildBackground() {
      forge.phaser.parallax(this, "bg_sky_clouds", 0.04, { depth: -100 });
      forge.phaser.parallax(this, "bg_skyline", 0.15, { depth: -90, alpha: 0.95 });
      const g = this.add.graphics().setScrollFactor(0.45, 0.6).setDepth(-80);
      const span = W * 0.45 + 1600;
      this.neons = [];
      let x = -100;
      while (x < span) {
        const w = 80 + forge.rand() * 140, h = 180 + forge.rand() * 260, top = 760 - h;
        g.fillStyle(C.deep, 0.92); g.fillRect(x, top, w, 900);
        g.fillStyle(C.ink, 0.5); g.fillRect(x + w - 12, top, 12, 900);
        for (let wy = top + 20; wy < 740; wy += 28) for (let wx = x + 10; wx < x + w - 16; wx += 22) {
          if (forge.rand() < 0.18) { g.fillStyle(NEON[(forge.rand() * 4) | 0], 0.35); g.fillRect(wx, wy, 8, 12); }
        }
        if (forge.rand() < 0.55) {
          const r = this.add.rectangle(x + w / 2, top + 30 + forge.rand() * 60, w * 0.6, 18 + forge.rand() * 30, NEON[(forge.rand() * 4) | 0], 0.8)
            .setScrollFactor(0.45, 0.6).setDepth(-79).setStrokeStyle(3, 0xffffff, 0.5);
          this.neons.push({ r, base: 0.6 + forge.rand() * 0.3, order: x / span, flick: 0 });
        }
        x += w + 10 + forge.rand() * 40;
      }
    }

    buildLevel() {
      this.solidGroup = this.physics.add.staticGroup();
      this.signGroup = this.physics.add.staticGroup();
      this.crateGroup = this.physics.add.staticGroup();
      const g = this.add.graphics().setDepth(0);
      for (const [x, top, w] of PLATFORMS) {
        const h = FLOOR - top;
        g.fillStyle(C.navy, 1); g.fillRect(x, top, w, h);
        g.fillStyle(C.ink, 0.55); g.fillRect(x + w - 14, top, 14, h);
        for (let wy = top + 70; wy < FLOOR - 20; wy += 46) for (let wx = x + 18; wx < x + w - 30; wx += 36) {
          if (forge.rand() < 0.3) { g.fillStyle(NEON[(forge.rand() * 4) | 0], 0.45); g.fillRect(wx, wy, 14, 20); }
        }
        g.lineStyle(2, C.violet, 0.7); g.strokeRect(x, top, w, h);
        if (w > 180 && forge.rand() < 0.7) {
          const ax = x + 30 + forge.rand() * (w - 60), ah = 50 + forge.rand() * 70;
          g.lineStyle(3, C.ink, 1); g.lineBetween(ax, top, ax, top - ah); g.lineBetween(ax - 12, top - ah * 0.6, ax + 12, top - ah * 0.6);
          g.fillStyle(0xff4466, 1); g.fillCircle(ax, top - ah, 4);
        }
        const t = forge.phaser.tiles(this, "tile_rooftop", x + w / 2, top + 14, w, 40);
        t.setOrigin(0.5, 0.5); t.setPosition(x + w / 2, top + 14); t.setDepth(1);
        this.add.rectangle(x + w / 2, top, w, 3, C.cyan, 0.8).setDepth(2);
        this.solidGroup.add(this.add.zone(x + w / 2, top + h / 2, w, h));
      }
      this.signs = SIGNS.map(([x, top, w, off, col]) => {
        g.lineStyle(2, C.ink, 1); g.lineBetween(x + 12, top, x + 12, top - 220); g.lineBetween(x + w - 12, top, x + w - 12, top - 220);
        const glow = this.add.rectangle(x + w / 2, top + 14, w + 24, 46, col, 0.25).setDepth(1);
        const r = this.add.rectangle(x + w / 2, top + 14, w, 28, col, 1).setDepth(2).setStrokeStyle(3, 0xffffff, 0.8);
        const z = this.add.zone(x + w / 2, top + 10, w, 20);
        this.signGroup.add(z);
        z.body.checkCollision.down = false; z.body.checkCollision.left = false; z.body.checkCollision.right = false;
        const s = { r, glow, off, on: true };
        z.sign = s;
        return s;
      });
      this.spikes = SPIKES.map(([x, w, top]) => {
        const n = Math.max(1, Math.round(w / 55));
        for (let i = 0; i < n; i++) {
          const im = this.add.image(x + ((i + 0.5) * w) / n, top + 4, "hazard_spikes").setDepth(4);
          forge.phaser.fit(im, 46); im.setOrigin(0.5, 1);
        }
        return { x, w, top };
      });
      this.crates = CRATES.map(([x, top]) => {
        const im = this.add.image(x, top, "prop_crate").setDepth(4);
        forge.phaser.fit(im, 58); im.setOrigin(0.5, 1);
        const z = this.add.zone(x, top - 26, 50, 52);
        this.crateGroup.add(z);
        return { im, z, x, top, alive: true };
      });
      this.cps = CHECKPOINTS.map(([x, top], i) => {
        g.lineStyle(4, C.ink, 1); g.lineBetween(x, top, x, top - 90); g.lineBetween(x, top - 90, x + 24, top - 90);
        const im = this.add.image(x + 24, top - 62, "nk_lantern").setDepth(3).setAlpha(i === 0 ? 1 : 0.45).setTint(i === 0 ? 0xffffff : 0x664477);
        return { x, top, im };
      });
      this.fish = [];
      for (const [fx, fy] of buildFish()) this.spawnFish(fx, fy, 0);
      this.drones = DRONES.map(([x, y, type, range, mul, amp], i) => {
        const im = this.add.image(x, y, "enemy_drone").setDepth(6);
        forge.phaser.fit(im, 58);
        const light = this.add.circle(x, y + 30, 8, C.pink, 0.5).setDepth(5);
        return { im, light, x0: x, y0: y, type, range, mul, amp, ph: i * 1.7, alive: true, x, y };
      });
      this.tower = this.add.image(TOWER_X, TOWER_BASE + 6, "goal_tower").setDepth(3);
      forge.phaser.fit(this.tower, 400); this.tower.setOrigin(0.5, 1);
      this.beaconGlow = this.add.circle(TOWER_X, TOWER_BASE - 385, 40, 0xff3355, 0).setDepth(3);
      this.beacon = this.add.circle(TOWER_X, TOWER_BASE - 385, 14, 0xff3355, 0.25).setDepth(4);
    }

    spawnFish(x, y, readyIn, fromX, fromY) {
      const im = this.add.image(fromX ?? x, fromY ?? y, "collect_fish").setDepth(5);
      forge.phaser.fit(im, 34);
      const bob = () => this.tweens.add({ targets: im, y: y - 6, duration: 700 + (x % 300), yoyo: true, repeat: -1, ease: "Sine.inOut" });
      if (fromX !== undefined) this.tweens.add({ targets: im, x, y, duration: 380, ease: "Back.out", onComplete: bob });
      else bob();
      const f = { im, alive: true, ready: this.env + readyIn };
      this.fish.push(f);
      return f;
    }

    buildPlayer() {
      const cp = this.cps[0];
      this.player = this.physics.add.sprite(cp.x + 40, cp.top - HERO_H / 2 - 4, "hero_kuro").setDepth(10);
      forge.phaser.fit(this.player, HERO_H);
      forge.phaser.body(this.player, { w: 0.42, h: 0.82 });
      this.player.setCollideWorldBounds(true);
      this.player.body.setMaxVelocity(1200, 1100);
      this.puppet = forge.phaser.puppet(this.player);
      this.physics.add.collider(this.player, this.solidGroup);
      this.physics.add.collider(this.player, this.crateGroup);
      this.physics.add.collider(this.player, this.signGroup, null, (pl, z) => !!(z.sign && z.sign.on && pl.body.velocity.y >= 0), this);
      this.slash = this.add.image(0, 0, "nk_slash").setDepth(11).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.shadow = this.add.ellipse(0, 0, 46, 10, 0x000000, 0.4).setDepth(9);
    }

    buildRain() {
      this.rain = this.add.particles(0, 0, "nk_rain", {
        x: { min: -100, max: 1500 }, y: -40, lifespan: 1000,
        speedY: { min: 950, max: 1150 }, speedX: { min: -260, max: -200 }, rotate: 12,
        alpha: { start: 0.45, end: 0.12 }, scaleY: { min: 0.6, max: 1.2 }, quantity: 2, frequency: 18,
        tint: [0xbfe9ff, C.cyan, 0xffb3dd],
      }).setScrollFactor(0).setDepth(50);
    }

    restoreCamera() {
      const cam = this.cameras.main;
      cam.setZoom(1);
      cam.setBounds(0, -300, W, 1060);
      cam.startFollow(this.player, true, 0.12, 0.12);
      cam.setFollowOffset(-120, 40);
      cam.setDeadzone(80, 100);
    }

    endCinematic() {
      this.restoreCamera();
      this.neonReveal = 1; this.neonDim = 1; this.cineDead = false; this.cineIdx = -1;
      if (!this.dead) this.player.setVisible(true);
    }

    cineDrive(dt, cine) {
      const dir = cine.direction || (forge.design.cinematic && forge.design.cinematic.direction) || {};
      const shots = dir.shots || [];
      const idx = clamp(Math.round(num(cine.shotIndex, 0)), 0, Math.max(0, shots.length - 1));
      const shot = cine.shot || shots[idx];
      if (!shot || !shot.camera) return;
      if (idx !== this.cineIdx) { this.cineIdx = idx; this.cineT = 0; }
      this.cineT += Math.max(0, num(dt, 0.016));
      const t = clamp(this.cineT / Math.max(0.2, num(shot.durationSec, 3)), 0, 1);
      const c = shot.camera, f = c.from || [640, 360, 1], to = c.to || f, k = ease(c.ease, t);
      const cam = this.cameras.main;
      cam.stopFollow();
      cam.setZoom(clamp(lerp(num(f[2], 1), num(to[2], 1), k), 0.6, 2));
      cam.centerOn(mapCineX(lerp(num(f[0], 640), num(to[0], 640), k)), 720 - lerp(num(f[1], 360), num(to[1], 360), k));
      const fx = shot.fx || [];
      this.neonReveal = fx.includes("neon_sign_flicker_sequence") ? t * 1.2 : 1;
      this.neonDim = fx.includes("neon_dim_pulse") ? 0.45 + 0.25 * Math.sin(this.env * 5) : 1;
      this.cineDead = fx.includes("antenna_dead_flicker");
      const heroShot = idx >= shots.length - 1 || fx.includes("hero_rim_light_magenta");
      if (!this.dead) { this.player.setVisible(heroShot); this.player.setFlipX(false); }
    }

    update(time, delta) {
      if (!this.ready) return;
      const dt = clamp(num(delta, 16) / 1000, 0, 0.05);
      this.env += dt;
      this.envUpdate(dt);
      const b = this.player.body;
      const cine = forge.cinematic;
      if (cine && cine.active) {
        this.cineWas = true;
        b.setVelocityX(0);
      } else {
        if (this.cineWas) { this.cineWas = false; this.endCinematic(); }
        if (!this.hintShown) { this.hintShown = true; forge.hud.message("A/D mover · Espacio saltar (doble / pared) · Shift dash · J katana", 4200); }
        if (!this.ended) {
          this.levelTime += dt;
          if (this.dead) { this.deadTimer -= dt; if (this.deadTimer <= 0) this.respawn(); }
          else { this.updatePlayer(dt); if (!this.dead) this.checkWorld(); }
        }
        this.updateHud(false);
      }
      const grounded = b.blocked.down || b.touching.down;
      this.player.setAlpha(this.invuln > 0 && !this.dead ? (Math.floor(this.env * 20) % 2 ? 0.35 : 1) : 1);
      this.shadow.setVisible(grounded && this.player.visible).setPosition(b.center.x, b.bottom);
      this.puppet.update({ vx: b.velocity.x, vy: b.velocity.y, grounded, attacking: this.attackTimer > 0, hurt: this.invuln > 1.2 }, dt);
    }

    envUpdate(dt) {
      const rainOn = truthy(setting("rain", true));
      this.rain.emitting = rainOn; this.rain.setVisible(rainOn);
      for (const n of this.neons) {
        if (n.flick > 0) n.flick -= dt; else if (forge.rand() < 0.002) n.flick = 0.12 + forge.rand() * 0.2;
        const shown = n.order <= this.neonReveal ? 1 : 0.05;
        n.r.setAlpha(n.base * this.neonDim * shown * (n.flick > 0 && forge.rand() < 0.5 ? 0.2 : 1));
      }
      for (const s of this.signs) {
        const ph = (this.env + s.off) % 3;
        s.on = ph < 1.5;
        const a = s.on ? (ph > 1.05 && Math.floor(this.env * 16) % 2 ? 0.35 : 1) : 0.12;
        s.r.setAlpha(a); s.glow.setAlpha(s.on ? a * 0.3 : 0);
      }
      const sp = forge.tune("droneSpeed", 120) * diffMul();
      for (const d of this.drones) {
        if (!d.alive) continue;
        d.ph += (dt * sp * d.mul) / Math.max(20, d.range);
        d.x = d.x0 + Math.sin(d.ph) * d.range;
        d.y = d.y0 + (d.type === "w" ? Math.sin(this.env * 2.4 + d.x0) * d.amp : Math.sin(this.env * 3 + d.x0) * 6);
        d.im.setPosition(d.x, d.y).setFlipX(Math.cos(d.ph) < 0);
        d.light.setPosition(d.x, d.y + 30).setAlpha(0.35 + 0.25 * Math.sin(this.env * 8 + d.x0));
      }
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.22;
        const s = this.spikes[(forge.rand() * this.spikes.length) | 0];
        if (s && Math.abs(s.x - this.cameras.main.midPoint.x) < 800)
          forge.phaser.burst(this, s.x + forge.rand() * s.w, s.top - 32, { color: C.cyan, count: 5, speed: 120, life: 250, size: 3 });
      }
      if (!this.won) this.beacon.setAlpha(this.cineDead && forge.rand() < 0.08 ? 0.85 : 0.2);
    }

    updatePlayer(dt) {
      const p = this.player, b = p.body, inp = forge.input;
      const speed = forge.tune("playerSpeed", 300), jf = forge.tune("jumpForce", 620);
      const dashSpeed = forge.tune("dashSpeed", 700), dashCdMax = Math.max(0.05, forge.tune("dashCooldown", 0.8));
      b.setGravityY(forge.tune("gravity", 1800));
      const grounded = b.blocked.down || b.touching.down;
      const ax = num(inp.axis().x, 0);
      let dir = Math.abs(ax) > 0.2 ? Math.sign(ax) : 0;
      if (!dir) dir = (inp.down("right") ? 1 : 0) - (inp.down("left") ? 1 : 0);
      const jumpPressed = inp.pressed("jump") || inp.pressed("up");
      const jumpHeld = inp.down("jump") || inp.down("up");
      this.dashCd = Math.max(0, this.dashCd - dt);
      this.invuln = Math.max(0, this.invuln - dt);
      this.attackCd = Math.max(0, this.attackCd - dt);
      this.lockTimer = Math.max(0, this.lockTimer - dt);
      this.chainT -= dt;
      if (this.trail) { this.trailT -= dt; if (this.trailT <= 0) { this.trail.destroy(); this.trail = null; } }

      if (grounded && !this.wasGrounded && this.lastVy > 350) {
        forge.phaser.burst(this, b.center.x, b.bottom, { color: C.violet, count: 8, speed: 110, life: 300, size: 3 });
        forge.audio.play("step", { volume: 0.35 });
        if (this.lastVy > 900) shake(0.12);
      }
      if (grounded) { this.coyote = 0.1; this.airJumps = 1; this.airDash = true; } else this.coyote -= dt;
      const wallDir = !grounded ? (b.blocked.left ? -1 : b.blocked.right ? 1 : 0) : 0;
      if (wallDir) { this.wallDir = wallDir; this.wallCoyote = 0.12; this.airJumps = 1; this.airDash = true; } else this.wallCoyote -= dt;

      if (this.dashTimer > 0) {
        this.dashTimer -= dt;
        b.setVelocity(this.facing * dashSpeed, 0);
        if (this.dashTimer <= 0) { b.setAllowGravity(true); b.setVelocityX(this.facing * speed); }
      } else if (inp.pressed("action2") && this.dashCd <= 0 && (grounded || this.airDash)) {
        if (dir) this.facing = dir;
        this.dashTimer = 0.18; this.dashCd = dashCdMax; this.dashCdTotal = dashCdMax; this.jumping = false;
        if (!grounded) this.airDash = false;
        b.setAllowGravity(false); b.setVelocity(this.facing * dashSpeed, 0);
        forge.audio.play("sfx_dash", { volume: 0.7 });
        forge.phaser.burst(this, b.center.x, b.center.y, { color: C.pink, count: 10, speed: 160, life: 300, size: 4 });
        if (this.trail) this.trail.destroy();
        this.trail = forge.phaser.trail(this, p, { color: C.pink }); this.trailT = 0.35;
        shake(0.08);
      }

      if (this.dashTimer <= 0) {
        if (dir && this.lockTimer <= 0) this.facing = dir;
        const target = this.lockTimer > 0 ? b.velocity.x : dir * speed;
        const acc = grounded ? (dir ? 2600 : 3000) : dir ? 1600 : 700;
        b.setVelocityX(approach(b.velocity.x, target, acc * dt));
        if (jumpPressed) {
          if (grounded || this.coyote > 0) this.doJump(jf, false);
          else if (this.wallCoyote > 0) {
            b.setVelocity(-this.wallDir * speed * 1.15, -jf * 0.95);
            this.facing = -this.wallDir; this.lockTimer = 0.16; this.wallCoyote = 0; this.jumping = true;
            forge.audio.play("sfx_jump", { volume: 0.7, rate: 1.1 });
            forge.phaser.burst(this, b.center.x + this.wallDir * 14, b.center.y, { color: C.cyan, count: 10, speed: 150, life: 300, size: 3 });
          } else if (this.airJumps > 0) { this.airJumps--; this.doJump(jf * 0.95, true); }
          else this.jumpBuffer = 0.12;
        } else if (this.jumpBuffer > 0) {
          this.jumpBuffer -= dt;
          if (grounded) this.doJump(jf, false);
        }
        if (this.jumping && !jumpHeld && b.velocity.y < 0) { b.setVelocityY(b.velocity.y * 0.45); this.jumping = false; }
        if (b.velocity.y >= 0) this.jumping = false;
        if (wallDir && dir === wallDir && b.velocity.y > 130) {
          b.setVelocityY(130);
          this.slideT -= dt;
          if (this.slideT <= 0) { this.slideT = 0.08; forge.phaser.burst(this, b.center.x + wallDir * 12, b.top + 10, { color: C.violet, count: 2, speed: 50, life: 250, size: 2 }); }
        }
      }
      p.setFlipX(this.facing < 0);

      if ((inp.pressed("action") || this.clickAttack) && this.attackCd <= 0) {
        this.attackTimer = 0.16; this.attackCd = 0.3;
        forge.audio.play("sfx_slash", { volume: 0.7, rate: 0.95 + forge.rand() * 0.1 });
        this.slash.setVisible(true).setAlpha(1).setScale(0.8).setFlipX(this.facing < 0);
        this.tweens.killTweensOf(this.slash);
        this.tweens.add({ targets: this.slash, alpha: 0, scale: 1.15, duration: 200, onComplete: () => this.slash.setVisible(false) });
      }
      this.clickAttack = false;
      if (this.attackTimer > 0) {
        this.attackTimer -= dt;
        this.slash.setPosition(b.center.x + this.facing * 40, b.center.y - 4);
        const rx = this.facing > 0 ? b.center.x - 10 : b.center.x - 90, ry = b.center.y - 55;
        for (const d of this.drones) if (d.alive && overlap(rx, ry, 100, 100, d.x - 26, d.y - 24, 52, 48)) this.killDrone(d);
        for (const c of this.crates) if (c.alive && overlap(rx, ry, 100, 100, c.x - 30, c.top - 58, 60, 58)) this.breakCrate(c);
      }
      this.wasGrounded = grounded;
      this.lastVy = b.velocity.y;
    }

    doJump(v, double) {
      const b = this.player.body;
      b.setVelocityY(-v);
      this.jumping = true; this.coyote = 0; this.jumpBuffer = 0;
      forge.audio.play("sfx_jump", { volume: 0.6, rate: double ? 1.25 : 1 });
      forge.phaser.burst(this, b.center.x, b.bottom, { color: double ? C.cyan : C.violet, count: double ? 12 : 6, speed: double ? 160 : 90, life: 300, size: 3 });
    }

    checkWorld() {
      const b = this.player.body;
      if (b.top > DEATH_Y) { this.die("fall"); return; }
      const vuln = this.invuln <= 0 && this.dashTimer <= 0;
      if (vuln) {
        for (const d of this.drones) if (d.alive && overlap(b.x, b.y, b.width, b.height, d.x - 20, d.y - 18, 40, 36)) { this.die("drone"); return; }
        for (const s of this.spikes) if (overlap(b.x, b.y, b.width, b.height, s.x + 6, s.top - 36, s.w - 12, 36)) { this.die("spike"); return; }
      }
      const cx = b.center.x, cy = b.center.y;
      for (const f of this.fish) if (f.alive && this.env >= f.ready && Math.abs(f.im.x - cx) < 36 && Math.abs(f.im.y - cy) < 50) this.collectFish(f);
      for (let i = this.cpIndex + 1; i < this.cps.length; i++) {
        const cp = this.cps[i];
        if (cx > cp.x - 10 && b.bottom <= cp.top + 6) { this.activateCp(i); break; }
      }
      for (const tip of this.tips) if (!tip.shown && cx > tip.x) { tip.shown = true; forge.hud.message(tip.text, 2800); break; }
      if (cx > TOWER_X - 60 && b.bottom > TOWER_BASE - 260) this.winGame();
    }

    collectFish(f) {
      f.alive = false;
      this.tweens.killTweensOf(f.im);
      this.tweens.add({ targets: f.im, y: f.im.y - 30, alpha: 0, scale: f.im.scale * 1.6, duration: 220, onComplete: () => f.im.destroy() });
      this.fishCount++; this.score += 10;
      this.chain = this.chainT > 0 ? Math.min(this.chain + 1, 10) : 0; this.chainT = 0.6;
      forge.audio.play("sfx_pickup", { volume: 0.6, rate: 1 + this.chain * 0.04 });
      forge.phaser.burst(this, f.im.x, f.im.y, { color: C.yellow, count: 8, speed: 120, life: 300, size: 3 });
      forge.phaser.floatText(this, f.im.x, f.im.y - 20, "+10", { color: "#f9f871", size: 18 });
      if (this.fishCount % 20 === 0) {
        this.lives++;
        forge.hud.message("¡20 peces! Vida extra 🐱", 1500);
        forge.audio.play("powerup", { volume: 0.8 });
        forge.phaser.burst(this, this.player.x, this.player.y, { color: C.pink, count: 24, speed: 220, life: 500, size: 4 });
      }
    }

    breakCrate(c) {
      c.alive = false; this.cratesBroken++; this.score += 20;
      this.crateGroup.remove(c.z, true, true);
      forge.audio.play("sfx_hit", { volume: 0.5, rate: 1.3 });
      forge.audio.play("explode", { volume: 0.3 });
      shake(0.15);
      forge.phaser.burst(this, c.x, c.top - 30, { color: C.yellow, count: 16, speed: 200, life: 450, size: 4 });
      forge.phaser.floatText(this, c.x, c.top - 70, "+20", { color: "#16e0ff", size: 18 });
      this.tweens.add({ targets: c.im, alpha: 0, angle: 25, y: c.top + 20, duration: 250, onComplete: () => c.im.destroy() });
      for (let i = 0; i < 3; i++) this.spawnFish(c.x + (i - 1) * 40, c.top - 95, 0.35, c.x, c.top - 30);
    }

    killDrone(d) {
      d.alive = false; this.kills++; this.score += 50;
      forge.audio.play("sfx_hit", { volume: 0.8 });
      forge.audio.play("explode", { volume: 0.4 });
      shake(0.25);
      forge.phaser.burst(this, d.x, d.y, { color: C.pink, count: 20, speed: 260, life: 500, size: 4 });
      forge.phaser.burst(this, d.x, d.y, { color: C.cyan, count: 10, speed: 180, life: 400, size: 3 });
      forge.phaser.floatText(this, d.x, d.y - 30, "+50", { color: "#ff2e97", size: 22 });
      d.light.destroy();
      this.tweens.add({ targets: d.im, angle: 200, alpha: 0, y: d.y + 120, duration: 500, ease: "Quad.in", onComplete: () => d.im.destroy() });
    }

    activateCp(i) {
      this.cpIndex = i; this.score += 100;
      const cp = this.cps[i];
      cp.im.clearTint().setAlpha(1);
      this.tweens.add({ targets: cp.im, scale: 1.3, yoyo: true, duration: 180 });
      forge.phaser.burst(this, cp.x + 24, cp.top - 62, { color: C.yellow, count: 18, speed: 160, life: 500, size: 4 });
      forge.audio.play("powerup", { volume: 0.6 });
      forge.hud.message("Farolillo encendido · punto de control", 1300);
    }

    die(reason) {
      if (this.dead || this.ended) return;
      this.dead = true; this.deaths++; this.lives--;
      const p = this.player, b = p.body;
      if (this.trail) { this.trail.destroy(); this.trail = null; }
      this.dashTimer = 0; this.attackTimer = 0; this.slash.setVisible(false);
      forge.audio.play("sfx_hit", { volume: 0.9 });
      shake(reason === "fall" ? 0.35 : 0.5);
      forge.phaser.burst(this, b.center.x, Math.min(b.center.y, 700), { color: C.pink, count: 26, speed: 260, life: 600, size: 5 });
      b.setVelocity(0, 0); b.setAllowGravity(true); b.enable = false;
      p.setVisible(false);
      this.updateHud(true);
      if (this.lives <= 0) {
        this.ended = true;
        forge.audio.stopMusic();
        forge.audio.play("sfx_lose", { volume: 0.9 });
        this.time.delayedCall(900, () => forge.lose({
          title: "Fin de la partida",
          subtitle: "La antena maestra sigue apagada… ¡inténtalo de nuevo, Kuro!",
          stats: { Puntos: this.score, Peces: this.fishCount, "Drones cortados": this.kills, "Tramo alcanzado": this.cpIndex + 1 + "/4", Tiempo: fmtTime(this.levelTime) },
        }));
      } else {
        this.deadTimer = 0.9;
        forge.hud.message(reason === "fall" ? "¡Caíste al vacío! −1 vida" : "¡Ay! −1 vida", 1100);
      }
    }

    respawn() {
      const cp = this.cps[this.cpIndex], p = this.player;
      this.dead = false;
      p.body.enable = true;
      p.body.reset(cp.x + 40, cp.top - HERO_H / 2 - 4);
      p.setVisible(true);
      this.invuln = 1.6; this.dashCd = 0; this.facing = 1; this.jumping = false; this.lastVy = 0;
      forge.phaser.burst(this, cp.x + 40, cp.top - 40, { color: C.cyan, count: 18, speed: 180, life: 500, size: 4 });
      forge.audio.play("powerup", { volume: 0.5 });
    }

    winGame() {
      if (this.ended) return;
      this.ended = true; this.won = true;
      this.player.body.setVelocity(0, 0); this.player.body.setAllowGravity(true);
      if (this.trail) { this.trail.destroy(); this.trail = null; }
      forge.audio.play("sfx_win", { volume: 0.9 });
      this.beacon.setFillStyle(C.cyan, 1).setAlpha(1);
      this.beaconGlow.setFillStyle(C.cyan, 1);
      this.tweens.add({ targets: this.beaconGlow, alpha: 0.6, scale: 3, duration: 600, yoyo: true, repeat: -1 });
      for (let i = 0; i < 5; i++) this.time.delayedCall(i * 220, () =>
        forge.phaser.burst(this, TOWER_X + (forge.rand() - 0.5) * 160, TOWER_BASE - 300 - forge.rand() * 120, { color: NEON[i % 4], count: 26, speed: 280, life: 700, size: 5 }));
      shake(0.3);
      const lifeBonus = this.lives * 500, timeBonus = Math.max(0, Math.round((300 - this.levelTime) * 10));
      this.score += lifeBonus + timeBonus;
      const best = Math.max(num(Number(forge.load("nekoNeonBest", 0)), 0), this.score);
      forge.save("nekoNeonBest", best);
      this.updateHud(true);
      forge.hud.message("¡Antena maestra restaurada!", 1500);
      this.time.delayedCall(1600, () => forge.win({
        title: "¡Antena maestra restaurada!",
        subtitle: "La ciudad neón vuelve a brillar gracias a Kuro.",
        stats: { Puntos: this.score, Peces: this.fishCount, "Drones cortados": this.kills, "Cajas rotas": this.cratesBroken, Tiempo: fmtTime(this.levelTime), "Bonus vidas": lifeBonus, "Mejor puntuación": best },
      }));
    }

    updateHud(force) {
      const h = this.hudCache;
      const livesStr = this.lives > 6 ? "🐱 ×" + this.lives : "🐱".repeat(Math.max(0, this.lives)) || "—";
      if (force || h.lives !== livesStr) { h.lives = livesStr; forge.hud.set("lives", livesStr, { label: "Vidas" }); }
      const fishStr = this.fishCount + " (" + (this.fishCount % 20) + "/20)";
      if (force || h.fish !== fishStr) { h.fish = fishStr; forge.hud.set("fish", fishStr, { label: "Peces", icon: "🐟" }); }
      if (force || h.score !== this.score) { h.score = this.score; forge.hud.set("score", this.score, { label: "Puntos", icon: "★" }); }
      const dashR = Math.round(clamp(1 - this.dashCd / Math.max(0.05, this.dashCdTotal), 0, 1) * 50) / 50;
      if (force || h.dash !== dashR) { h.dash = dashR; forge.hud.bar("dash", dashR, { label: "Dash", color: "#16e0ff" }); }
      const prog = Math.round(clamp(this.player.x / TOWER_X, 0, 1) * 100) / 100;
      if (force || h.prog !== prog) { h.prog = prog; forge.hud.bar("progress", prog, { label: "Recorrido", color: "#ff2e97" }); }
    }

    cleanup() {
      if (this.trail) { this.trail.destroy(); this.trail = null; }
      this.ready = false;
      if (sceneRef === this) sceneRef = null;
    }
  }

  return {
    scenes: [MainScene],
    physics: "arcade",
    gravity: 0,
    background: "#0b0620",
    onCinematic(dt, cine) {
      const s = sceneRef;
      if (!s || !s.ready || !cine || !cine.active) return;
      s.cineDrive(dt, cine);
    },
  };
}