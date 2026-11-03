export default function createGame(forge, Phaser) {
  const W = 1280, H = 720;
  const LINO_X = 430, RIVAL_X = 850, FLOOR_Y = 652, FIGHTER_H = 380;
  const NARRATION_ID = "narration"; // played only by the runtime during the intro
  const RIVALS = [
    { id: "pua", name: "Púa", warn: "none", color: 0x2e8b3d, css: "#2e8b3d" },
    { id: "muro", name: "Muro", warn: "walk", color: 0x2a5db0, css: "#2a5db0" },
    { id: "chispa", name: "Chispa", warn: "jump", color: 0xf7c820, css: "#f7c820" },
  ];
  const PALETTE_NUM = [0xd62839, 0xf5f1e6, 0x2e8b3d, 0x2a5db0, 0xf7c820];
  let sceneRef = null;

  const T = (k, f) => {
    const v = Number(forge.tune(k, f));
    return Number.isFinite(v) ? v : f;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    smooth: (t) => t * t * (3 - 2 * t),
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeIn: (t) => t * t * t,
    linear: (t) => t,
  };
  const backOut = (t) => {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };

  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      sceneRef = this;
      this.ready = false;
      this.hasVoice = forge.assets.list("audio").some((a) => a.id === NARRATION_ID);
      const cam = this.cameras.main;
      cam.setBackgroundColor("#1b1b2f");

      // --- Scenery ---
      this.add.image(W / 2, H / 2, "gym_bg").setDisplaySize(W, H).setDepth(0);
      this.add.image(W / 2, H, "ring_canvas").setOrigin(0.5, 1).setDisplaySize(W, 200).setDepth(2);
      this.add.image(W / 2, 612, "ring_ropes").setOrigin(0.5, 1).setDisplaySize(W, 430).setDepth(3);

      this.bell = this.add.sprite(W / 2, 96, "ring_bell");
      this.bellAnim = forge.phaser.animate(this.bell);
      forge.phaser.fit(this.bell, 130);
      this.bell.setDepth(4);
      if (this.bellAnim.has && this.bellAnim.has("idle")) this.bellAnim.play("idle");

      // --- Fighters ---
      this.lino = this.makeFighter("lino", LINO_X, false);
      this.rivals = RIVALS.map((r) => this.makeFighter(r.id, RIVAL_X, true));

      // --- FX layers ---
      this.dark = this.add.rectangle(W / 2, H / 2, 4000, 4000, 0x05050c, 0).setScrollFactor(0).setDepth(20);
      this.lightG = this.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
      this.moteG = this.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
      this.bloom = this.add.rectangle(W / 2, H / 2, 4000, 4000, 0xf7c820, 0)
        .setScrollFactor(0).setDepth(22).setBlendMode(Phaser.BlendModes.ADD);
      this.motes = [];
      for (let i = 0; i < 26; i++) {
        this.motes.push({ x: forge.rand(), y: forge.rand(), v: 0.03 + forge.rand() * 0.05, p: forge.rand() * 6.28, r: 1 + forge.rand() * 2.2 });
      }
      this.lightT = 0;

      forge.audio.music("music_ring", { volume: 0.6 });

      this.inCine = false;
      this.ended = false;
      this.events.once("shutdown", () => { if (sceneRef === this) sceneRef = null; });

      this.ready = true;
      if (forge.cinematic && forge.cinematic.active) {
        this.enterCine();
      } else {
        this.resetRun();
      }
    }

    makeFighter(id, x, flip) {
      const s = this.add.sprite(x, FLOOR_Y, id);
      const anim = forge.phaser.animate(s);
      forge.phaser.fit(s, FIGHTER_H);
      s.setOrigin(0.5, 1);
      s.setFlipX(flip);
      s.setDepth(10);
      const shadow = this.add.ellipse(x, FLOOR_Y - 4, 180, 30, 0x000000, 0.4).setDepth(9);
      return { s, anim, shadow, baseX: x, baseY: FLOOR_Y, sx: s.scaleX, sy: s.scaleY, offX: 0, offY: 0 };
    }

    // ================= RUN / BOUT =================
    resetRun() {
      this.maxLives = Math.max(1, Math.min(9, Math.round(T("linoLives", 3))));
      this.linoLives = this.maxLives;
      this.stats = { hits: 0, dodges: 0, taken: 0, time: 0 };
      this.linoHurt = 0; this.linoAtk = 0; this.linoCd = 0;
      this.kHeld = 0; this.linoDashing = false; this.wasDashing = false;
      this.hitStop = 0; this.ended = false; this.overT = 0;
      this.lino.offX = 0; this.lino.offY = 0;
      this.lino.s.clearTint(); this.lino.s.setAlpha(1).setVisible(true).setScale(this.lino.sx, this.lino.sy);
      this.lino.s.setFlipX(false);
      this.beginBout(0);
    }

    leadFor(cfg) {
      if (cfg.warn === "walk") return Math.max(T("muroWalkLead", 0.3), 0.18);
      if (cfg.warn === "jump") return 0.32;
      return 0.18;
    }
    atkLeadFor(cfg) {
      if (cfg.warn === "walk") return 0.15;
      if (cfg.warn === "jump") return 0.12;
      return 0.18;
    }

    beginBout(i) {
      this.bout = i;
      const cfg = RIVALS[i];
      this.rivals.forEach((f, k) => {
        this.tweens.killTweensOf(f.s);
        f.s.setVisible(k === i); f.shadow.setVisible(k === i);
        f.s.setAlpha(1).setAngle(0).setFlipX(true).setScale(f.sx, f.sy);
        f.offX = 0; f.offY = 0; f.s.x = RIVAL_X; f.s.y = FLOOR_Y; f.baseX = RIVAL_X;
        f.shadow.x = RIVAL_X; f.shadow.setScale(1);
      });
      this.rival = this.rivals[i];
      this.rivalLives = Math.max(1, Math.min(9, Math.round(T("rivalLives", 3))));
      this.rivalHurt = 0; this.rivalAtk = 0;
      this.clock = 0; this.windup = false; this.jumpT = -1;
      this.nextImpact = 1.0 + this.leadFor(cfg);
      this.phase = "bell"; this.phaseT = 1.6;

      const r = this.rival;
      r.s.setScale(0.01, 0.01);
      this.tweens.add({ targets: r.s, scaleX: r.sx, scaleY: r.sy, duration: 420, ease: "Back.easeOut" });
      this.ringBell();
      forge.phaser.burst(this, RIVAL_X, FLOOR_Y - 180, { color: cfg.color, count: 26, speed: 260, life: 600, size: 6 });
      if (i === 0) forge.hud.message(`Combate 1: ${cfg.name} · J golpear · K (mantener) esquivar`, 2600);
      else forge.hud.message(`Combate ${i + 1}: ${cfg.name}`, 1600);
      this.updateHud();
    }

    ringBell() {
      forge.audio.play("sfx_bell", { volume: 0.8 });
      this.tweens.killTweensOf(this.bell);
      this.bell.setAngle(0);
      this.tweens.add({
        targets: this.bell, angle: { from: -20, to: 20 }, duration: 110, yoyo: true, repeat: 3,
        onComplete: () => this.bell.setAngle(0),
      });
    }

    updateHud() {
      forge.hud.set("lino_lives", this.linoLives, { label: "Lino", icon: "heart_icon" });
      forge.hud.set("rival_lives", Math.max(0, this.rivalLives), { label: "Vidas del rival", icon: "heart_icon" });
      forge.hud.set("rival_name", RIVALS[this.bout].name, { label: "Rival" });
    }

    heartPop(x, y, dir) {
      const h = this.add.image(x, y, "heart_icon").setDepth(30);
      forge.phaser.fit(h, 54);
      this.tweens.add({
        targets: h, x: x + dir * 90, y: y - 110, alpha: 0, angle: dir * 40,
        duration: 800, ease: "Cubic.easeOut", onComplete: () => h.destroy(),
      });
    }

    speedLines() {
      const g = this.add.graphics().setDepth(11);
      g.lineStyle(5, 0xf5f1e6, 0.85);
      for (let i = 0; i < 7; i++) {
        const y = FLOOR_Y - 60 - i * 42 - forge.rand() * 18;
        const x = LINO_X - 70 - forge.rand() * 50;
        g.lineBetween(x, y, x - 90 - forge.rand() * 70, y);
      }
      this.tweens.add({ targets: g, x: -70, alpha: 0, duration: 320, onComplete: () => g.destroy() });
    }

    // ================= COMBAT =================
    linoPunch() {
      this.linoAtk = 0.26;
      this.linoCd = 0.7;
      this.lino.offX = 26;
      const hx = RIVAL_X - 70, hy = FLOOR_Y - 270;
      if (this.rivalHurt > 0) {
        forge.audio.play("step", { volume: 0.35, rate: 1.4 });
        forge.phaser.floatText(this, hx, hy, "¡Cubierto!", { color: "#f5f1e6", size: 26 });
        return;
      }
      this.rivalLives -= 1;
      this.rivalHurt = T("hurtDuration", 0.45);
      this.stats.hits++;
      this.hitStop = 0.07;
      this.rival.offX = 28;
      forge.audio.play("sfx_hit", { volume: 0.85, rate: 1.1 });
      forge.shake(0.25);
      forge.phaser.burst(this, hx, hy, { color: 0xf7c820, count: 22, speed: 320, life: 380, size: 6 });
      forge.phaser.floatText(this, hx, hy - 30, "¡PUM! -1", { color: "#f7c820", size: 34 });
      this.heartPop(RIVAL_X, FLOOR_Y - FIGHTER_H - 10, 1);
      this.updateHud();
      if (this.rivalLives <= 0) this.knockout();
    }

    knockout() {
      this.phase = "ko";
      this.phaseT = 2.6;
      this.windup = false; this.jumpT = -1;
      this.rival.offY = 0;
      forge.audio.play("sfx_win", { volume: 0.8 });
      forge.shake(0.5);
      forge.phaser.floatText(this, RIVAL_X, FLOOR_Y - 330, "¡K.O.!", { color: "#d62839", size: 64 });
      for (let i = 0; i < 5; i++) {
        this.time.delayedCall(i * 160, () => {
          forge.phaser.burst(this, 300 + forge.rand() * 680, 160 + forge.rand() * 200,
            { color: PALETTE_NUM[i % PALETTE_NUM.length], count: 28, speed: 300, life: 900, size: 7 });
        });
      }
      const next = RIVALS[this.bout + 1];
      forge.hud.message(next ? `¡${RIVALS[this.bout].name} K.O.! Siguiente: ${next.name}` : `¡${RIVALS[this.bout].name} K.O.!`, 1800);
      const r = this.rival;
      this.tweens.add({ targets: r.s, angle: 80, alpha: 0, duration: 900, delay: 300, ease: "Cubic.easeIn" });
      this.tweens.add({ targets: r.shadow, alpha: 0, duration: 900, delay: 300 });
    }

    rivalImpact() {
      this.rivalAtk = 0.24;
      this.rival.offX = -22;
      if (this.linoDashing) {
        this.stats.dodges++;
        this.lino.offX = -46;
        this.hitStop = 0.05;
        forge.audio.play("sfx_dodge", { volume: 0.85 });
        this.speedLines();
        forge.phaser.floatText(this, LINO_X, FLOOR_Y - 330, "¡Esquiva!", { color: "#2e8b3d", size: 34 });
        forge.phaser.burst(this, LINO_X + 90, FLOOR_Y - 250, { color: 0xf5f1e6, count: 12, speed: 200, life: 300, size: 4 });
        return;
      }
      if (this.linoHurt > 0) return;
      this.linoLives -= 1;
      this.stats.taken++;
      this.linoHurt = T("hurtDuration", 0.45);
      this.lino.offX = -34;
      this.hitStop = 0.09;
      forge.audio.play("sfx_hit", { volume: 0.9, rate: 0.85 });
      forge.shake(0.55);
      this.cameras.main.flash(130, 214, 40, 57);
      forge.phaser.burst(this, LINO_X + 50, FLOOR_Y - 270, { color: 0xd62839, count: 24, speed: 300, life: 420, size: 6 });
      this.heartPop(LINO_X, FLOOR_Y - FIGHTER_H - 10, -1);
      this.updateHud();
      if (this.linoLives <= 0) {
        this.phase = "over";
        this.overT = 1.3;
        forge.audio.play("sfx_lose", { volume: 0.85 });
        forge.hud.message("¡Lino cae a la lona!", 1300);
        this.tweens.add({ targets: this.lino.s, angle: -75, alpha: 0.6, duration: 900, delay: 200, ease: "Cubic.easeIn" });
      }
    }

    winGame() {
      if (this.ended) return;
      this.ended = true;
      this.phase = "done";
      forge.audio.play("sfx_win", { volume: 0.9 });
      const best = forge.load("bestTime", 0);
      const t = this.stats.time;
      if (!best || t < best) forge.save("bestTime", t);
      forge.win({
        title: "¡Campeón del barrio!",
        subtitle: "Púa, Muro y Chispa han caído. La gloria es de Lino.",
        stats: {
          "Vidas restantes": `${this.linoLives}/${this.maxLives}`,
          "Golpes conectados": this.stats.hits,
          "Esquivas": this.stats.dodges,
          "Tiempo": `${t.toFixed(1)} s`,
          "Mejor tiempo": `${(best && best < t ? best : t).toFixed(1)} s`,
        },
      });
    }

    loseGame() {
      if (this.ended) return;
      this.ended = true;
      this.phase = "done";
      forge.lose({
        title: "K.O. técnico",
        subtitle: `${RIVALS[this.bout].name} te ha tumbado. ¡Lee su aviso y esquiva con K!`,
        stats: {
          "Rival": RIVALS[this.bout].name,
          "Rivales vencidos": this.bout,
          "Golpes conectados": this.stats.hits,
          "Esquivas": this.stats.dodges,
        },
      });
    }

    // ================= UPDATE =================
    update(time, delta) {
      if (!this.ready) return;
      const dt = Math.min(0.05, Math.max(0, (delta || 0) / 1000));
      const cine = forge.cinematic;
      if (cine && cine.active) {
        if (!this.inCine) this.enterCine();
        return;
      }
      if (this.inCine) this.exitCine();

      let gdt = dt;
      if (this.hitStop > 0) { this.hitStop -= dt; gdt = 0; }

      this.lightT += dt;
      this.bellAnim.update({ vx: 0, vy: 0, grounded: true }, dt);
      const pulse = 0.06 + Math.sin(this.lightT * 2.2) * 0.012;
      this.drawLights(pulse, this.phase === "ko" || this.phase === "done" ? pulse * 0.5 : pulse);
      this.moteG.clear();

      // timers
      this.linoHurt = Math.max(0, this.linoHurt - gdt);
      this.linoAtk = Math.max(0, this.linoAtk - gdt);
      this.linoCd = Math.max(0, this.linoCd - gdt);
      this.rivalHurt = Math.max(0, this.rivalHurt - gdt);
      this.rivalAtk = Math.max(0, this.rivalAtk - gdt);

      // Lino input
      const fighting = this.phase === "fight";
      const kDown = forge.input.down("action2");
      if (forge.input.pressed("action2")) this.kHeld = 0;
      if (kDown) this.kHeld += gdt; else this.kHeld = 0;
      const dashLimit = T("dashHoldWindow", 0.25) + 0.25;
      this.linoDashing = fighting && kDown && this.kHeld <= dashLimit && this.linoHurt <= 0 && this.linoAtk <= 0;
      if (this.linoDashing && !this.wasDashing) forge.audio.play("sfx_dash", { volume: 0.35, rate: 1.2 });
      this.wasDashing = this.linoDashing;

      if (fighting && forge.input.pressed("action") && this.linoHurt <= 0 && this.linoCd <= 0 && !this.linoDashing) {
        this.linoPunch();
      }

      // phases
      if (this.phase === "bell") {
        this.phaseT -= dt;
        if (this.phaseT <= 0) { this.phase = "fight"; forge.hud.message("¡A pelear!", 800); }
      } else if (this.phase === "fight") {
        this.updateRivalAI(gdt);
      } else if (this.phase === "ko") {
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.bout < RIVALS.length - 1) this.beginBout(this.bout + 1);
          else this.winGame();
        }
      } else if (this.phase === "over") {
        this.overT -= dt;
        if (this.overT <= 0) this.loseGame();
      }
      if (fighting || this.phase === "bell") this.stats.time += gdt;

      this.updateVisuals(dt, gdt);
    }

    updateRivalAI(gdt) {
      if (this.phase !== "fight") return;
      this.clock += gdt;
      const cfg = RIVALS[this.bout];
      const lead = this.leadFor(cfg);
      const toImpact = this.nextImpact - this.clock;
      if (!this.windup && toImpact <= lead) {
        if (this.rivalHurt > 0) {
          this.nextImpact = this.clock + lead + 0.02;
        } else {
          this.windup = true;
          if (cfg.warn === "jump") { this.jumpT = 0; forge.audio.play("sfx_jump", { volume: 0.6 }); }
          else if (cfg.warn === "walk") forge.audio.play("step", { volume: 0.45, rate: 0.8 });
        }
      }
      if (this.windup && this.nextImpact - this.clock <= 0) {
        this.windup = false;
        this.rivalImpact();
        this.nextImpact = this.clock + Math.max(0.8, T("enemyAttackInterval", 2));
      }
    }

    updateVisuals(dt, gdt) {
      const k = Math.min(1, dt * 12);
      // Lino
      const L = this.lino;
      const lTarget = this.linoDashing ? -34 : 0;
      L.offX += (lTarget - L.offX) * k;
      L.s.x = L.baseX + L.offX;
      L.s.y = L.baseY + L.offY;
      L.shadow.x = L.s.x;
      if (this.linoHurt > 0) {
        if (Math.floor(this.linoHurt * 20) % 2 === 0) L.s.setTint(0xff8a8a); else L.s.clearTint();
      } else L.s.clearTint();
      L.anim.update({
        vx: 0, vy: 0, grounded: true,
        dashing: this.linoDashing,
        attacking: this.linoAtk > 0,
        hurt: this.linoHurt > 0,
      }, gdt);

      // Rival
      const R = this.rival;
      if (!R) return;
      const cfg = RIVALS[this.bout];
      const toImpact = this.nextImpact - this.clock;
      const atkLead = this.atkLeadFor(cfg);
      const attackPose = this.phase === "fight" && this.windup && toImpact <= atkLead;
      const walking = this.phase === "fight" && cfg.warn === "walk" && this.windup && toImpact > atkLead;
      let airborne = false, vy = 0;
      if (cfg.warn === "jump" && this.jumpT >= 0) {
        this.jumpT += gdt;
        const dur = 0.55;
        const u = this.jumpT / dur;
        if (u >= 1) { this.jumpT = -1; R.offY = 0; forge.phaser.burst(this, RIVAL_X, FLOOR_Y, { color: 0xf5f1e6, count: 8, speed: 120, life: 260, size: 4 }); }
        else { airborne = true; R.offY = -85 * Math.sin(Math.PI * u); vy = u < 0.5 ? -320 : 320; }
      } else R.offY = 0;
      R.offX += (0 - R.offX) * k;
      if (this.phase !== "ko" && this.phase !== "done") {
        R.s.x = R.baseX + R.offX + (walking ? Math.sin(this.clock * 40) * 3 : 0);
        R.s.y = R.baseY + R.offY;
      }
      R.shadow.x = R.s.x;
      R.shadow.setScale(1 + R.offY / 260);
      if (this.rivalHurt > 0) {
        if (Math.floor(this.rivalHurt * 20) % 2 === 0) R.s.setTint(0xffd0d0); else R.s.clearTint();
      } else R.s.clearTint();
      R.anim.update({
        vx: walking ? -70 : 0,
        vy,
        grounded: !airborne,
        attacking: attackPose || this.rivalAtk > 0,
        hurt: this.rivalHurt > 0,
      }, gdt);
    }

    drawLights(leftA, rightA) {
      const g = this.lightG;
      g.clear();
      const cone = (x, a) => {
        if (a <= 0) return;
        g.fillStyle(0xffe7a8, a);
        g.beginPath();
        g.moveTo(x - 40, -20); g.lineTo(x + 40, -20);
        g.lineTo(x + 210, FLOOR_Y); g.lineTo(x - 210, FLOOR_Y);
        g.closePath(); g.fillPath();
        g.fillStyle(0xfff4d0, Math.min(1, a * 1.6));
        g.fillEllipse(x, FLOOR_Y, 440, 72);
      };
      cone(LINO_X, leftA);
      cone(RIVAL_X, rightA);
    }

    drawMotes(t, alpha, x0, x1) {
      const g = this.moteG;
      g.clear();
      if (alpha <= 0) return;
      for (const m of this.motes) {
        const y = ((m.y - t * m.v) % 1 + 1) % 1;
        const x = lerp(x0, x1, m.x) + Math.sin(t * 1.3 + m.p) * 14;
        g.fillStyle(0xfff6d8, alpha * (0.4 + 0.6 * Math.abs(Math.sin(t + m.p))));
        g.fillCircle(x, 40 + y * (FLOOR_Y - 60), m.r);
      }
    }

    // ================= CINEMATIC (tableau cuts) =================
    enterCine() {
      this.inCine = true;
      this.cineShot = -1;
      this.cineT = 0;
      this.cineTotal = 0;
      this.fired = {};
      this.tweens.killTweensOf(this.lino.s);
      this.rivals.forEach((f) => this.tweens.killTweensOf(f.s));
      this.lino.s.setAngle(0).setAlpha(1).clearTint();
      this.phase = "cine";
    }

    exitCine() {
      this.inCine = false;
      const cam = this.cameras.main;
      cam.setZoom(1);
      cam.centerOn(W / 2, H / 2);
      this.dark.setAlpha(0);
      this.bloom.setAlpha(0);
      this.moteG.clear();
      this.lino.s.setPosition(LINO_X, FLOOR_Y).setScale(this.lino.sx, this.lino.sy).setVisible(true).setAngle(0).setAlpha(1);
      this.lino.shadow.setPosition(LINO_X, FLOOR_Y - 4).setVisible(true);
      this.rivals.forEach((f) => {
        f.baseX = RIVAL_X;
        f.s.setPosition(RIVAL_X, FLOOR_Y).setScale(f.sx, f.sy).setAngle(0).setAlpha(1).clearTint();
        f.shadow.setPosition(RIVAL_X, FLOOR_Y - 4).setScale(1).setAlpha(0.4);
      });
      this.resetRun();
    }

    placeRival(f, x, k, visible) {
      f.s.setVisible(visible && k > 0.001);
      f.shadow.setVisible(visible && k > 0.001);
      f.s.setFlipX(true).setAngle(0).setAlpha(1);
      f.s.setPosition(x, FLOOR_Y);
      f.s.setScale(f.sx * Math.max(0.001, k), f.sy * Math.max(0.001, k));
      f.shadow.setPosition(x, FLOOR_Y - 4).setScale(Math.max(0.001, k)).setAlpha(0.4);
    }

    cineStep(dt, cine) {
      if (!this.inCine) this.enterCine();
      dt = Math.min(0.05, Math.max(0, dt || 0));
      const dir = (cine && cine.direction) || (forge.design.cinematic && forge.design.cinematic.direction) || {};
      const shots = dir.shots || [];
      let idx = cine && Number.isFinite(cine.shotIndex) ? cine.shotIndex : 0;
      const shot = (cine && cine.shot) || shots[idx] || null;
      if (idx !== this.cineShot) {
        this.cineShot = idx;
        this.cineT = 0;
        this.fired = {};
      }
      this.cineT += dt;
      this.cineTotal += dt;
      const dur = (shot && shot.durationSec) || 4;
      const u = clamp01(this.cineT / dur);
      const stage = Math.max(0, Math.min(3, idx));
      const once = (key, fn) => { if (!this.fired[key]) { this.fired[key] = true; fn(); } };

      // camera from shot data (designed on a 960×540 plane → mapped to 1280×720)
      const ZOOMS = [[1.0, 1.75], [2.2, 1.0], [1.55, 1.75], [1.35, 1.0]];
      const cam = this.cameras.main;
      const cdat = shot && shot.camera;
      const ease = EASE[(cdat && cdat.ease) || "smooth"] || EASE.smooth;
      const e = ease(u);
      const S = W / 960;
      const fx = cdat && cdat.from ? cdat.from[0] * S : W / 2;
      const fy = cdat && cdat.from ? cdat.from[1] * S : H / 2;
      const tx = cdat && cdat.to ? cdat.to[0] * S : W / 2;
      const ty = cdat && cdat.to ? cdat.to[1] * S : H / 2;
      const z = ZOOMS[stage];
      cam.setZoom(lerp(z[0], z[1], e));
      cam.centerOn(lerp(fx, tx, e), lerp(fy, ty, e));

      this.bellAnim.update({ vx: 0, vy: 0, grounded: true }, dt);
      const L = this.lino;
      L.s.setVisible(true).setPosition(LINO_X, FLOOR_Y).setScale(L.sx, L.sy).clearTint();
      L.shadow.setVisible(true).setPosition(LINO_X, FLOOR_Y - 4);
      let lAtk = false, lDash = false, lHurt = false;
      const rFlags = [{}, {}, {}];
      const breathe = Math.sin(this.cineTotal * 2.4);

      if (stage === 0) {
        this.rivals.forEach((f) => this.placeRival(f, RIVAL_X, 0, false));
        this.dark.setAlpha(0.62);
        this.bloom.setAlpha(0);
        this.drawLights(0.11 + breathe * 0.025, 0);
        this.drawMotes(this.cineTotal, 0.7, LINO_X - 190, LINO_X + 190);
      } else if (stage === 1) {
        once("bell", () => { this.ringBell(); cam.flash(220, 255, 240, 200); });
        const xs = [800, 965, 1130];
        const starts = [0.35, 0.55, 0.75];
        this.rivals.forEach((f, i) => {
          const p = clamp01((u - starts[i]) / 0.12);
          if (p > 0) once("pop" + i, () => {
            forge.phaser.burst(this, xs[i], FLOOR_Y - 200, { color: RIVALS[i].color, count: 24, speed: 260, life: 520, size: 6 });
            forge.audio.play("step", { volume: 0.4, rate: 1 + i * 0.2 });
          });
          this.placeRival(f, xs[i], p > 0 ? backOut(p) : 0, true);
        });
        const lightsOn = clamp01((u - 0.25) / 0.3);
        this.dark.setAlpha(lerp(0.5, 0.08, lightsOn));
        this.bloom.setAlpha(0);
        this.drawLights(0.1, 0.08 * lightsOn);
        this.drawMotes(this.cineTotal, 0.5 * (1 - lightsOn), LINO_X - 190, LINO_X + 190);
      } else if (stage === 2) {
        this.rivals.forEach((f, i) => this.placeRival(f, RIVAL_X, i === 0 ? 1 : 0, i === 0));
        this.dark.setAlpha(0.12);
        this.moteG.clear();
        lAtk = u > 0.1 && u < 0.3;
        const hurtP = u > 0.17 && u < 0.45;
        if (u > 0.17) once("spark", () => {
          forge.audio.play("sfx_hit", { volume: this.hasVoice ? 0.5 : 0.8, rate: 1.1 });
          forge.phaser.burst(this, RIVAL_X - 70, FLOOR_Y - 270, { color: 0xf7c820, count: 22, speed: 320, life: 380, size: 6 });
          forge.shake(0.25);
        });
        const pAtk = u > 0.52 && u < 0.7;
        lDash = u > 0.55 && u < 0.85;
        if (u > 0.58) once("dodge", () => {
          forge.audio.play("sfx_dodge", { volume: this.hasVoice ? 0.5 : 0.8 });
          this.speedLines();
        });
        const p = this.rivals[0];
        p.s.x = RIVAL_X + (hurtP ? 18 : 0);
        L.s.x = LINO_X + (lAtk ? 22 : 0) + (lDash ? -36 : 0);
        L.shadow.x = L.s.x;
        rFlags[0] = { attacking: pAtk, hurt: hurtP };
        const bloomP = clamp01((u - 0.82) / 0.18);
        this.bloom.setAlpha(0.22 * bloomP);
        this.drawLights(0.09 + 0.08 * bloomP, 0.07);
      } else {
        once("bell3", () => this.ringBell());
        this.rivals.forEach((f, i) => this.placeRival(f, RIVAL_X, i === 0 ? 1 : 0, i === 0));
        this.dark.setAlpha(0.1 * (1 - u));
        this.bloom.setAlpha(0.15 * (1 - clamp01(u * 2)));
        this.moteG.clear();
        const pulse = 0.06 + breathe * 0.012;
        this.drawLights(pulse, pulse);
      }

      L.anim.update({ vx: 0, vy: 0, grounded: true, dashing: lDash, attacking: lAtk, hurt: lHurt }, dt);
      this.rivals.forEach((f, i) => {
        const fl = rFlags[i];
        f.anim.update({ vx: 0, vy: 0, grounded: true, attacking: !!fl.attacking, hurt: !!fl.hurt }, dt);
      });
    }
  }

  return {
    scenes: [MainScene],
    physics: "arcade",
    gravity: 0,
    background: "#1b1b2f",
    onCinematic(dt, cine) {
      if (sceneRef && sceneRef.ready && cine && cine.active) sceneRef.cineStep(dt, cine);
    },
  };
}