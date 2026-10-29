// Forge runtime core: boots a generated game module on top of Phaser (2D) or Three.js + Rapier (2.5D / 3D).
// Provides the `forge` API documented in lib/agents/runtime-docs.ts.

const BOOT = window.FORGE_BOOT;
const embedded = window.parent !== window;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ICPLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICPAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

function post(msg) {
  if (embedded) parent.postMessage({ source: "forge-game", projectId: BOOT.projectId, version: BOOT.version, ...msg }, "*");
}

/* ---------------- DOM ---------------- */
const root = document.createElement("div");
root.id = "forge-root";
root.innerHTML = `
<div id="forge-stage"></div>
<div class="fx-hud" id="fxHud"></div>
<div class="fx-msg" id="fxMsg"></div>
<div id="fxFloats"></div>
<button class="fx-pausebtn" id="fxPauseBtn" aria-label="Pausa">${ICPAUSE}</button>
<div class="fx-touch"><div><button data-a="left">◀</button><button data-a="right">▶</button></div><div><button data-a="action2">✧</button><button data-a="action">✦</button><button data-a="jump">▲</button></div></div>
<div class="fx-cine" id="fxCine" hidden><i class="bar t"></i><i class="bar b"></i><div class="sub" id="fxCineSub"></div><div class="ttl" id="fxCineTtl"></div><button class="skip" id="fxCineSkip">Saltar ›</button></div>
<div class="fx-ov" id="fxOv" hidden><div class="fx-card" id="fxCard"></div></div>
<div class="fx-load" id="fxLoad"><b>Cargando ${esc(BOOT.design?.title || "juego")}…</b><i><u id="fxLoadBar"></u></i></div>`;
document.body.appendChild(root);
if (!embedded) root.classList.add("standalone");
if (matchMedia("(pointer: coarse)").matches) root.classList.add("touch");
const stage = $("#forge-stage");
const setLoad = (r) => ($("#fxLoadBar").style.width = `${Math.round(clamp(r, 0, 1) * 100)}%`);

/* ---------------- Errors ---------------- */
let phase = "boot";
let reported = false;
function errText(e) {
  if (!e) return "Error desconocido";
  if (typeof e === "string") return e;
  return `${e.name ? e.name + ": " : ""}${e.message || String(e)}`;
}
function reportError(e, where) {
  const message = errText(e);
  const stack = (e && e.stack) || "";
  console.error("[forge]", e);
  if (reported) return;
  reported = true;
  try {
    host && host.pause();
  } catch {}
  post({ type: "error", phase: where || phase, message, stack: String(stack).split("\n").slice(0, 12).join("\n") });
  $("#fxLoad").hidden = true;
  showOverlay(
    "err",
    `<em>Error en el juego</em><h1>Algo se rompió</h1><p>${embedded ? "Forge está revisando el código para corregirlo." : "Revisa el mensaje:"}</p><pre>${esc(message)}\n${esc(String(stack).split("\n").slice(0, 6).join("\n"))}</pre>`,
  );
}
addEventListener("error", (e) => reportError(e.error || e.message));
addEventListener("unhandledrejection", (e) => reportError(e.reason));

/* ---------------- Seeded random ---------------- */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- Input ---------------- */
const KEYMAP = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  Space: "jump", KeyJ: "action", KeyX: "action", Enter: "action", KeyK: "action2", ShiftLeft: "action2", ShiftRight: "action2", Escape: "pause", KeyP: "pause",
};
const input = (() => {
  const src = {}; // action -> Set of sources
  let pressed = new Set();
  let padPrev = {};
  const press = (a, s) => {
    (src[a] ||= new Set());
    if (!src[a].size) pressed.add(a);
    src[a].add(s);
  };
  const release = (a, s) => src[a] && src[a].delete(s);
  const down = (a) => !!(src[a] && src[a].size);
  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(Boolean);
    const now = {};
    if (p) {
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      now.left = b(14) || ax < -0.4; now.right = b(15) || ax > 0.4; now.up = b(12) || ay < -0.4; now.down = b(13) || ay > 0.4;
      now.jump = b(0); now.action = b(2); now.action2 = b(1) || b(3); now.pause = b(9);
      input._stick = { x: Math.abs(ax) > 0.2 ? ax : 0, y: Math.abs(ay) > 0.2 ? ay : 0 };
    } else input._stick = { x: 0, y: 0 };
    for (const a of ["left", "right", "up", "down", "jump", "action", "action2", "pause"]) {
      if (now[a] && !padPrev[a]) press(a, "pad");
      if (!now[a] && padPrev[a]) release(a, "pad");
    }
    padPrev = now;
  }
  return {
    _stick: { x: 0, y: 0 },
    down,
    pressed: (a) => pressed.has(a),
    axis() {
      const s = this._stick;
      const x = s.x || (down("right") ? 1 : 0) - (down("left") ? 1 : 0);
      const y = s.y || (down("down") ? 1 : 0) - (down("up") ? 1 : 0);
      return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    },
    _press: press,
    _release: release,
    _begin: poll,
    _end() {
      pressed = new Set();
    },
    _clear() {
      for (const k in src) src[k].clear();
      pressed = new Set();
    },
  };
})();
addEventListener("keydown", (e) => {
  const a = KEYMAP[e.code];
  if (a || e.code === "KeyR") e.preventDefault();
  if (e.repeat) return;
  if (state.screen === "start" && (e.code === "Space" || e.code === "Enter")) return startGame();
  if (state.screen === "cine" && ["Space", "Enter", "Escape"].includes(e.code)) return endCinematic();
  if (state.screen === "end" && (e.code === "Space" || e.code === "Enter")) return restart();
  if (a === "pause" && (state.screen === "play" || state.screen === "pause")) return state.screen === "play" ? pauseGame(true) : resumeGame();
  if (e.code === "KeyR" && state.screen === "play") return restart();
  if (a) input._press(a, e.code);
});
addEventListener("keyup", (e) => {
  const a = KEYMAP[e.code];
  if (a) input._release(a, e.code);
});
addEventListener("blur", () => input._clear());
root.querySelectorAll(".fx-touch button").forEach((b) => {
  const a = b.dataset.a;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    b.classList.add("on");
    input._press(a, "touch" + e.pointerId);
    unlockAudio();
  });
  const up = (e) => {
    b.classList.remove("on");
    input._release(a, "touch" + e.pointerId);
  };
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
});
$("#fxPauseBtn").addEventListener("click", () => (state.screen === "play" ? pauseGame(true) : state.screen === "pause" ? resumeGame() : null));

/* ---------------- Audio ---------------- */
const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain();
const musicBus = AC.createGain();
const sfxBus = AC.createGain();
musicBus.connect(master);
sfxBus.connect(master);
master.connect(AC.destination);
master.gain.value = 0.9;
const buffers = {};
let muted = false;
let music = null;
function unlockAudio() {
  if (AC.state === "suspended" && state.screen !== "pause") AC.resume().catch(() => {});
}
addEventListener("pointerdown", unlockAudio, true);
async function loadAudio(list, onEach) {
  await Promise.all(
    list.map(async (a) => {
      try {
        if (a.url) {
          const r = await fetch(a.url);
          buffers[a.id] = await AC.decodeAudioData(await r.arrayBuffer());
        }
      } catch (e) {
        console.warn("[forge] audio", a.id, e);
      }
      onEach();
    }),
  );
}
const SYNTH = [
  [/jump|salt|hop/, (t) => tone(t, 320, 0.14, "square", 0.08, 2.1)],
  [/coin|pick|collect|gem|item|moned|recog|star|point/, (t) => (tone(t, 988, 0.08, "sine", 0.14), tone(t + 0.07, 1319, 0.16, "sine", 0.12))],
  [/power|level|upgrade/, (t) => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.06, f, 0.12, "triangle", 0.1))],
  [/win|victor|goal|complete|clear/, (t) => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, 0.3, "triangle", 0.12))],
  [/lose|die|death|game.?over|muert|fail/, (t) => [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.14, f, 0.3, "sawtooth", 0.06))],
  [/shoot|laser|fire|disparo|blast/, (t) => tone(t, 880, 0.12, "sawtooth", 0.06, 0.25)],
  [/explo|boom|crash/, (t) => noise(t, 0.45, 0.35)],
  [/hit|hurt|damage|golpe|impact|punch|slash|attack/, (t) => (tone(t, 160, 0.22, "sawtooth", 0.12, 0.35), noise(t, 0.08, 0.15))],
  [/step|walk|footstep/, (t) => noise(t, 0.05, 0.08)],
];
function tone(t, f, dur, type, vol, slide) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function noise(t, dur, vol) {
  const n = AC.createBufferSource();
  const b = AC.createBuffer(1, Math.ceil(AC.sampleRate * dur), AC.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = b;
  const g = AC.createGain();
  g.gain.value = vol;
  n.connect(g).connect(sfxBus);
  n.start(t);
}
const audio = {
  play(id, o = {}) {
    const buf = buffers[id];
    if (!buf) {
      const name = String(id).toLowerCase();
      const hit = SYNTH.find(([re]) => re.test(name));
      if (hit) hit[1](AC.currentTime);
      return { stop() {} };
    }
    const s = AC.createBufferSource();
    s.buffer = buf;
    s.loop = !!o.loop;
    s.playbackRate.value = o.rate ?? 1;
    const g = AC.createGain();
    g.gain.value = o.volume ?? 1;
    s.connect(g).connect(sfxBus);
    s.start();
    return {
      stop() {
        try {
          s.stop();
        } catch {}
      },
    };
  },
  music(id, o = {}) {
    if (music && music.id === id) return;
    audio.stopMusic(1.2);
    const buf = buffers[id];
    if (!buf) return;
    const s = AC.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const g = AC.createGain();
    const v = o.volume ?? 0.55;
    g.gain.setValueAtTime(0.0001, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(v, AC.currentTime + 1.2);
    s.connect(g).connect(musicBus);
    s.start();
    music = { id, s, g };
  },
  stopMusic(fade = 0.6) {
    if (!music) return;
    const { s, g } = music;
    music = null;
    try {
      g.gain.cancelScheduledValues(AC.currentTime);
      g.gain.setValueAtTime(g.gain.value, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + fade);
      s.stop(AC.currentTime + fade + 0.05);
    } catch {}
  },
};
function setMuted(on) {
  muted = on;
  master.gain.setTargetAtTime(on ? 0 : 0.9, AC.currentTime, 0.05);
}

/* ---------------- HUD ---------------- */
const hudEl = $("#fxHud");
const hudItems = new Map();
const hud = {
  set(key, value, o = {}) {
    let el = hudItems.get(key);
    if (!el) {
      el = document.createElement("span");
      el.className = "fx-chip";
      hudEl.appendChild(el);
      hudItems.set(key, el);
    }
    const html = `${o.icon ? esc(o.icon) + " " : ""}<span class="lb">${esc(o.label ?? key)}</span> <b>${esc(value)}</b>`;
    if (el._h !== html) {
      el._h = html;
      el.innerHTML = html;
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
      setTimeout(() => el.classList.remove("bump"), 160);
    }
  },
  bar(key, ratio, o = {}) {
    let el = hudItems.get(key);
    if (!el) {
      el = document.createElement("span");
      el.className = "fx-bar";
      el.innerHTML = `<span></span><i><u></u></i>`;
      hudEl.appendChild(el);
      hudItems.set(key, el);
    }
    el.firstChild.textContent = o.label ?? key;
    el.style.setProperty("--c", o.color || "#10b981");
    el.querySelector("u").style.width = `${clamp(Number(ratio) || 0, 0, 1) * 100}%`;
  },
  remove(key) {
    const el = hudItems.get(key);
    if (el) el.remove();
    hudItems.delete(key);
  },
  message(text, ms = 1800) {
    const m = $("#fxMsg");
    m.textContent = text;
    m.classList.add("on");
    clearTimeout(m._t);
    m._t = setTimeout(() => m.classList.remove("on"), ms);
  },
  _reset() {
    hudItems.forEach((el) => el.remove());
    hudItems.clear();
    $("#fxMsg").classList.remove("on");
    $("#fxFloats").innerHTML = "";
  },
};

/* ---------------- Screen shake ---------------- */
let shakeT = 0, shakeI = 0;
function shake(i = 0.5) {
  shakeI = Math.max(shakeI, clamp(i, 0, 1));
  shakeT = 0.3;
}
function shakeTick(dt) {
  if (shakeT <= 0) return;
  shakeT -= dt;
  const k = shakeI * (shakeT / 0.3) * 14;
  stage.style.translate = shakeT > 0 ? `${(Math.random() - 0.5) * k}px ${(Math.random() - 0.5) * k}px` : "";
  if (shakeT <= 0) shakeI = 0;
}

/* ---------------- Storage ---------------- */
const mem = {};
const ns = `forge:${BOOT.projectId}:`;
function save(k, v) {
  mem[k] = v;
  try {
    localStorage.setItem(ns + k, JSON.stringify(v));
  } catch {}
}
function load(k, d) {
  if (k in mem) return mem[k];
  try {
    const v = localStorage.getItem(ns + k);
    if (v != null) return JSON.parse(v);
  } catch {}
  return d;
}

/* ---------------- Placeholder art ---------------- */
function placeholderCanvas(img) {
  const pal = BOOT.design?.palette?.length ? BOOT.design.palette : ["#1b1f2b", "#6366f1", "#ff7a1a", "#10b981", "#f5c542"];
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  const role = img.role;
  if (role === "background") {
    c.width = 1280;
    c.height = 720;
    const g = x.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, pal[0]);
    g.addColorStop(1, pal[1] || pal[0]);
    x.fillStyle = g;
    x.fillRect(0, 0, 1280, 720);
    x.fillStyle = (pal[2] || "#333") + "55";
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.moveTo(i * 160 - 80, 720);
      x.lineTo(i * 160 + 40, 380 + ((i * 97) % 160));
      x.lineTo(i * 160 + 180, 720);
      x.fill();
    }
    return c;
  }
  if (role === "texture" || role === "tile" || role === "platform") {
    c.width = c.height = 256;
    x.fillStyle = pal[1] || "#555";
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = (pal[0] || "#222") + "88";
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) x.fillRect(i * 32, j * 32, 32, 32);
    x.fillStyle = pal[3] || "#7c7";
    if (role !== "texture") x.fillRect(0, 0, 256, 26);
    return c;
  }
  c.width = c.height = 256;
  const col = { hero: pal[2], enemy: "#ff5a6e", collectible: "#ffd36b", hazard: "#ff4f4f", goal: "#10b981" }[role] || pal[3] || "#8b5cf6";
  x.fillStyle = col;
  x.strokeStyle = "rgba(0,0,0,.45)";
  x.lineWidth = 8;
  x.beginPath();
  if (role === "collectible") x.arc(128, 128, 80, 0, 7);
  else if (role === "hazard") (x.moveTo(28, 228), x.lineTo(128, 28), x.lineTo(228, 228), x.closePath());
  else x.roundRect(48, 24, 160, 208, 48);
  x.fill();
  x.stroke();
  if (role === "hero" || role === "enemy" || role === "npc") {
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(150, 90, 16, 0, 7);
    x.arc(196, 90, 16, 0, 7);
    x.fill();
    x.fillStyle = "#111";
    x.beginPath();
    x.arc(156, 92, 7, 0, 7);
    x.arc(200, 92, 7, 0, 7);
    x.fill();
  }
  x.fillStyle = "#fff";
  x.font = "bold 22px sans-serif";
  x.textAlign = "center";
  x.fillText(String(img.name || img.id).slice(0, 18), 128, 250);
  return c;
}

/* ---------------- Assets ---------------- */
const M = BOOT.manifest;
const assets = {
  image: (id) => M.images.find((i) => i.id === id) || null,
  list: (type) => (type === "audio" ? M.audio : type === "model" ? M.models : M.images),
};

/* ---------------- Tuning ---------------- */
const tuning = {};
for (const t of BOOT.design?.tuning || []) tuning[t.key] = t.value;

/* ---------------- forge API ---------------- */
let rand = mulberry(hashStr(BOOT.projectId));
let ended = false;
const forge = {
  design: BOOT.design,
  tune: (k, d) => (typeof tuning[k] === "number" && isFinite(tuning[k]) ? tuning[k] : d),
  assets,
  input,
  audio,
  hud,
  rand: () => rand(),
  shake,
  save,
  load,
  get paused() {
    return state.screen !== "play";
  },
  win(o = {}) {
    endRun("win", o);
  },
  lose(o = {}) {
    endRun("lose", o);
  },
  _placeholder: placeholderCanvas,
};
window.forge = forge;

/* ---------------- Screens ---------------- */
const state = { screen: "load" };
function showOverlay(kind, html) {
  const ov = $("#fxOv");
  ov.className = `fx-ov ${kind}`;
  $("#fxCard").innerHTML = html;
  ov.hidden = false;
}
function hideOverlay() {
  $("#fxOv").hidden = true;
}
function controlsHtml() {
  const c = BOOT.design?.controls || [];
  if (!c.length) return "";
  return `<div class="fx-keys">${c
    .slice(0, 6)
    .map((k) => `<span>${String(k.input).split(/\s+/).map((p) => `<kbd>${esc(p)}</kbd>`).join("")} ${esc(k.action)}</span>`)
    .join("")}</div>`;
}
function showStart() {
  state.screen = "start";
  root.classList.add("paused");
  const d = BOOT.design || {};
  showOverlay(
    "start",
    `<em>${esc(d.genre || "Juego")}</em><h1>${esc(d.title || "")}</h1><p>${esc(d.tagline || "")}</p>
    ${d.objective ? `<div class="fx-goal"><b>Objetivo</b>${esc(d.objective)}</div>` : ""}${controlsHtml()}
    <div class="fx-acts"><button class="fx-btn" id="fxStart">${ICPLAY}Jugar</button>${d.cinematic?.lines?.length ? `<button class="fx-btn ghost" id="fxCineBtn">Ver cinemática</button>` : ""}</div>`,
  );
  $("#fxStart").onclick = () => startGame();
  const cb = $("#fxCineBtn");
  if (cb) cb.onclick = () => playCinematic();
  post({ type: "screen", screen: "start" });
}
function startGame() {
  if (state.screen !== "start") return;
  unlockAudio();
  hideOverlay();
  root.classList.remove("paused");
  state.screen = "play";
  window.focus();
  host.resume();
  post({ type: "screen", screen: "play" });
}
function pauseGame(showMenu) {
  if (state.screen !== "play") return;
  state.screen = "pause";
  host.pause();
  AC.suspend().catch(() => {});
  input._clear();
  root.classList.add("paused");
  if (showMenu) showPauseMenu();
  post({ type: "screen", screen: "pause" });
}
function showPauseMenu() {
  showOverlay(
    "pause",
    `<em>Pausa</em><h1>${esc(BOOT.design?.title || "")}</h1>${controlsHtml()}<div class="fx-acts"><button class="fx-btn" id="fxResume">${ICPLAY}Continuar</button><button class="fx-btn ghost" id="fxRestart">Reiniciar</button></div>`,
  );
  $("#fxResume").onclick = resumeGame;
  $("#fxRestart").onclick = restart;
}
function resumeGame() {
  if (state.screen !== "pause") return;
  hideOverlay();
  root.classList.remove("paused");
  state.screen = "play";
  AC.resume().catch(() => {});
  window.focus();
  host.resume();
  post({ type: "screen", screen: "play" });
}
function endRun(kind, o) {
  if (ended || state.screen !== "play") return;
  ended = true;
  state.screen = "end";
  const stats = o.stats || {};
  post({ type: kind, stats });
  setTimeout(() => {
    host.pause();
    input._clear();
    root.classList.add("paused");
    showOverlay(
      kind,
      `<em>${kind === "win" ? "¡Victoria!" : "Fin de la partida"}</em><h1>${esc(o.title || (kind === "win" ? "¡Nivel completado!" : "¡Oh no!"))}</h1>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ""}
      ${Object.keys(stats).length ? `<div class="fx-stats">${Object.entries(stats).map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>` : ""}
      <div class="fx-acts"><button class="fx-btn" id="fxAgain">${ICPLAY}${kind === "win" ? "Jugar otra vez" : "Reintentar"}</button></div>`,
    );
    $("#fxAgain").onclick = restart;
  }, 700);
}
async function restart() {
  hideOverlay();
  hud._reset();
  audio.stopMusic(0.2);
  input._clear();
  ended = false;
  reported = false;
  rand = mulberry(hashStr(BOOT.projectId));
  phase = "runtime";
  await host.restart();
  root.classList.remove("paused");
  state.screen = "play";
  AC.resume().catch(() => {});
  host.resume();
  window.focus();
  post({ type: "screen", screen: "play" });
}

/* ---------------- Cinematic ---------------- */
let cine = null;
function playCinematic(onEnd) {
  const d = BOOT.design || {};
  const lines = d.cinematic?.lines || [];
  if (!lines.length) return onEnd && onEnd();
  const prev = state.screen;
  state.screen = "cine";
  hideOverlay();
  unlockAudio();
  AC.resume().catch(() => {});
  root.classList.remove("paused");
  root.classList.add("cine");
  const el = $("#fxCine");
  el.hidden = false;
  el.classList.remove("titled");
  $("#fxCineTtl").innerHTML = `<b>${esc(d.title || "")}</b><span>${esc(d.tagline || "")}</span>`;
  requestAnimationFrame(() => el.classList.add("on"));
  const voice = buffers.narration ? audio.play("narration", { volume: 1 }) : null;
  const per = buffers.narration ? Math.max(2.6, buffers.narration.duration / lines.length) : 3;
  cine = { t: 0, lines, per, voice, prev, onEnd, dur: per * lines.length + 2.6 };
  post({ type: "screen", screen: "cine" });
}
function cineTick(dt) {
  if (!cine) return;
  cine.t += dt;
  const i = Math.floor(cine.t / cine.per);
  const sub = $("#fxCineSub");
  if (i < cine.lines.length) {
    const local = cine.t - i * cine.per;
    sub.textContent = cine.lines[i].slice(0, Math.floor(local * 34));
  } else {
    sub.textContent = "";
    $("#fxCine").classList.add("titled");
  }
  if (cine.t >= cine.dur) endCinematic();
}
function endCinematic() {
  if (!cine) return;
  const c = cine;
  cine = null;
  if (c.voice) c.voice.stop();
  const el = $("#fxCine");
  el.classList.remove("on", "titled");
  root.classList.remove("cine");
  setTimeout(() => {
    if (!cine) el.hidden = true;
  }, 600);
  state.screen = c.prev;
  if (c.onEnd) c.onEnd();
  else if (c.prev === "start") showStart();
  else if (c.prev === "play") host.resume();
  else if (c.prev === "pause") {
    root.classList.add("paused");
    AC.suspend().catch(() => {});
    showPauseMenu();
  }
}
$("#fxCineSkip").onclick = () => endCinematic();

/* ---------------- Studio messages ---------------- */
addEventListener("message", (e) => {
  const m = e.data;
  if (!m || m.source !== "forge-studio") return;
  if (m.type === "tuning") {
    for (const t of m.tuning || []) tuning[t.key] = t.value;
    if (BOOT.design) BOOT.design.tuning = m.tuning;
  } else if (m.type === "mute") setMuted(!!m.on);
  else if (m.type === "start") {
    if (state.screen === "start") startGame();
    else if (state.screen === "pause") resumeGame();
  } else if (m.type === "pause") pauseGame(true);
  else if (m.type === "resume") resumeGame();
  else if (m.type === "restart") restart();
  else if (m.type === "cinematic") {
    if (BOOT.design && Array.isArray(m.lines)) BOOT.design.cinematic = { ...(BOOT.design.cinematic || {}), lines: m.lines };
    if (BOOT.design && m.title) BOOT.design.title = m.title;
    if (state.screen === "play") pauseGame(false);
    playCinematic();
  } else if (m.type === "debug") host && host.setDebug && host.setDebug(!!m.on);
  else if (m.type === "focus") window.focus();
});

/* ---------------- Frame hooks used by hosts ---------------- */
let lastT = performance.now();
function rafTick(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  shakeTick(dt);
  cineTick(dt);
  requestAnimationFrame(rafTick);
}
requestAnimationFrame(rafTick);

/* ---------------- Boot ---------------- */
let host = null;
(async () => {
  try {
    const total = M.images.length + M.audio.length + M.models.length + 1;
    let done = 0;
    const step = () => setLoad(++done / total);
    const audioP = loadAudio(M.audio, step);
    const mod = await import(new URL(BOOT.gameUrl, document.baseURI).href);
    if (typeof mod.default !== "function") throw new Error("El módulo del juego no exporta createGame por defecto");
    const ctx = { forge, stage, manifest: M, boot: BOOT, input, onProgress: step, reportError };
    host = BOOT.engine === "phaser" ? await (await import("./host-phaser.js")).createHost(mod.default, ctx) : await (await import("./host-three.js")).createHost(mod.default, ctx);
    await audioP;
    phase = "warmup";
    await host.start();
    // Run briefly behind the start screen so early runtime errors surface before the player presses play.
    await new Promise((r) => setTimeout(r, 900));
    if (reported) return;
    host.pause();
    phase = "runtime";
    $("#fxLoad").hidden = true;
    post({ type: "ready" });
    if (BOOT.cineAuto && BOOT.design?.cinematic?.lines?.length) {
      state.screen = "start";
      playCinematic(() => showStart());
    } else showStart();
  } catch (e) {
    reportError(e, phase);
  }
})();
