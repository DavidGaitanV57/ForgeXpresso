/* Forge Xpresso studio controller: wires the original UI to the generation API (SSE + REST) and the sandboxed game iframe. */
import type { ApiProvider, AssetRecord, AudioAssetSpec, ChatMsg, Dimension, ForgeEvent, ImageAssetSpec, ImageProvider, Job, Project, TuningParam, UsageReport } from "@/lib/types";
import { formatDuration, formatUsd, PROVIDER_LABEL as API_LABEL } from "@/lib/usage";
import { applyDomI18n, getLocale, initLocale, setLocale, t, type Locale } from "@/lib/i18n";
import { sheetAnimsFor, sheetLayout, type SheetAnimSpec } from "@/lib/sheets";

type Caps = { code: boolean; images: { openai: boolean; minimax: boolean }; defaultImageProvider: ImageProvider; audio: boolean; models3d: boolean };
type ProjectSummary = { id: string; title: string; idea: string; dimension: Dimension; status: Project["status"]; updatedAt: number; thumb: string | null };
type GameMsg = { source: "forge-game"; projectId: string; version: number; type: string; screen?: string; message?: string; stack?: string; phase?: string; reason?: string };

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string, root: ParentNode = document) => Array.from(root.querySelectorAll(s)) as T[];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const ICON = {
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.6 3L13 10h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M17 13V4h3v9zM17 13l-4 8a2.5 2.5 0 0 1-2.6-3L11 14H5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 6.2 4H17"/></svg>',
};
const ICUP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const ICDN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const ICPLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const ICSTOP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const IC_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
const IC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const IC_VOICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const IC_SFX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const IC_CUBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>';

const ROLE_KEYS = ["hero", "enemy", "npc", "collectible", "hazard", "prop", "platform", "tile", "goal", "background", "texture", "ui", "portrait"] as const;
const roleLabel = (role: string) => (ROLE_KEYS.includes(role as (typeof ROLE_KEYS)[number]) ? t(`role.${role}`) : t("role.image"));
const audioLabel = (kind: string) => (kind === "music" || kind === "sfx" || kind === "voice" ? t(`audio.${kind}`) : kind);
const ORDER = ["hero", "enemy", "npc", "collectible", "hazard", "goal", "platform", "tile", "prop", "background", "texture", "portrait", "ui", "model", "music", "voice", "sfx"];
const COVER_ROLES = new Set(["background", "texture", "portrait"]);
const DIM_LABEL: Record<Dimension, string> = { "2d": "2D", "2.5d": "2.5D", "3d": "3D" };
function setScreen(next: typeof S.screen) {
  S.screen = next;
  document.body.dataset.screen = next;
}

const IDEA_DIMS: Dimension[] = ["2d", "2d", "2.5d", "3d", "3d"];
const ideasList = (): [string, Dimension][] => IDEA_DIMS.map((d, i) => [t(`idea.${i + 1}`), d]);
const tipsList = () => [1, 2, 3, 4, 5, 6].map((i) => t(`tip.${i}`));

/* ================= State ================= */
const S = {
  caps: null as Caps | null,
  dim: "2d" as Dimension,
  provider: "openai" as ImageProvider,
  p: null as Project | null,
  es: null as EventSource | null,
  screen: "intro" as "intro" | "loader" | "studio" | "pro",
  ptab: "guia" as "guia" | "recursos" | "cine",
  lib: "chars",
  open: 0,
  playing: false,
  sound: true,
  volume: 0.9,
  debug: false,
  gameVersion: 0,
  gameReady: false,
  gameScreen: "",
  repairAsked: 0,
  sending: false,
  tourSeen: false,
  assetsOpen: true,
};
const FILE = (a: AssetRecord) => (S.p && a.file ? `/api/files/${S.p.id}/${a.file}` : "");
const assets = () => (S.p ? Object.values(S.p.assets) : []);
const roleOf = (a: AssetRecord) => (a.type === "image" ? (a.spec as ImageAssetSpec).role : a.type === "audio" ? (a.spec as AudioAssetSpec).kind : "model");
const kindOf = (a: AssetRecord) => (a.type === "image" ? roleLabel(roleOf(a)) : a.type === "audio" ? audioLabel(roleOf(a)) : t("kind.model"));
const sorted = (list: AssetRecord[]) => list.slice().sort((a, b) => ORDER.indexOf(roleOf(a)) - ORDER.indexOf(roleOf(b)) || a.name.localeCompare(b.name));
const jobRunning = () => !!S.p?.job && !S.p.job.finishedAt;
const design = () => S.p?.design;

async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json", ...(init?.headers || {}) } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Error ${res.status}`), { status: res.status });
  return data as T;
}

/* ================= Toast ================= */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(html: string, ms = 2800) {
  const t = $("#toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}

/* ================= Game iframe ================= */
const gameFrame = () => $<HTMLIFrameElement>("#game");
function postGame(msg: Record<string, unknown>) {
  gameFrame()?.contentWindow?.postMessage({ source: "forge-studio", ...msg }, "*");
}
let reloadT: ReturnType<typeof setTimeout> | undefined;
function loadGame(force = false) {
  const p = S.p;
  const fr = gameFrame();
  if (!p || !fr) return;
  if (!p.versions.length) {
    fr.removeAttribute("src");
    showVpErr(t("vp.noCode"), "retry");
    return;
  }
  if (!force && S.gameVersion === p.currentVersion && fr.getAttribute("src")) return;
  S.gameVersion = p.currentVersion;
  S.gameReady = false;
  S.gameScreen = "";
  hideVpErr();
  fr.src = `/play/${p.id}?v=${p.currentVersion}&lang=${encodeURIComponent(getLocale())}&t=${Date.now().toString(36)}`;
}
function reloadGameSoon() {
  clearTimeout(reloadT);
  reloadT = setTimeout(() => loadGame(true), 250);
}
function showVpErr(text: string, action?: "repair" | "retry") {
  const el = $("#vpErr");
  el.hidden = false;
  el.innerHTML = `<span title="${esc(text)}">${esc(text)}</span>${action === "repair" ? `<button class="btn small" type="button" data-vperr="repair">${esc(t("vp.repair"))}</button>` : action === "retry" ? `<button class="btn small" type="button" data-vperr="retry">${esc(t("vp.retry"))}</button>` : ""}<button class="iconbtn" type="button" data-vperr="x" aria-label="${esc(t("vp.close"))}" style="width:26px;height:26px">×</button>`;
}
function hideVpErr() {
  $("#vpErr").hidden = true;
}

let lastError: { message: string; stack: string; phase: string } | null = null;
async function onGameMessage(e: MessageEvent) {
  const m = e.data as GameMsg;
  if (!m || m.source !== "forge-game" || !S.p || m.projectId !== S.p.id) return;
  if (e.source !== gameFrame()?.contentWindow) return;
  if (m.type === "ready") {
    S.gameReady = true;
    postGame({ type: "mute", on: !S.sound });
    postGame({ type: "volume", master: S.volume });
    if (S.debug) postGame({ type: "debug", on: true });
    if (design()?.tuning) postGame({ type: "tuning", tuning: design()!.tuning });
    if (S.playing) postGame({ type: "focus" });
  } else if (m.type === "screen") {
    S.gameScreen = m.screen || "";
  } else if (m.type === "win") {
    chatHint(t("chat.hintWin"));
  } else if (m.type === "lose") {
    chatHint(t("chat.hintLose"));
  } else if (m.type === "error") {
    lastError = { message: m.message || "Error", stack: m.stack || "", phase: m.phase || "runtime" };
    if (m.version !== S.p.currentVersion || jobRunning()) return;
    if (S.repairAsked === m.version) return;
    S.repairAsked = m.version;
    await requestRepair(false);
  } else if (m.type === "needReload") {
    reloadGameSoon();
  }
}
async function requestRepair(manual: boolean) {
  if (!S.p || !lastError) return;
  try {
    const r = await api<{ started: boolean; reason?: string }>(`/api/projects/${S.p.id}/repair`, {
      method: "POST",
      json: { ...lastError, version: S.p.currentVersion, manual },
    });
    if (r.started) {
      hideVpErr();
      dockHint(t("chat.hintRepairing"));
    } else if (r.reason === "limit") {
      showVpErr(t("chat.errLimit", { msg: lastError.message }), "repair");
    } else if (r.reason === "busy") {
      S.repairAsked = 0;
    }
  } catch (err) {
    showVpErr(t("chat.errRepair", { msg: (err as Error).message }), "repair");
  }
}

/* ================= SSE ================= */
function connect(id: string) {
  S.es?.close();
  const es = new EventSource(`/api/projects/${id}/events`);
  S.es = es;
  es.onmessage = (ev) => {
    let data: ForgeEvent | { type: "busy"; busy: boolean };
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!S.p || (data.type === "project" && data.project.id !== S.p.id)) return;
    onEvent(data);
  };
}
function disconnect() {
  S.es?.close();
  S.es = null;
}

function onEvent(ev: ForgeEvent | { type: "busy"; busy: boolean }) {
  const p = S.p!;
  switch (ev.type) {
    case "project": {
      const prevVersion = p.currentVersion;
      S.p = ev.project;
      if (S.screen === "loader") {
        if (ev.project.status === "ready" && !jobRunning()) void finishLoader();
        else renderLoader();
      } else if (S.screen === "studio") {
        renderStudio();
        if (ev.project.currentVersion !== prevVersion || !gameFrame().getAttribute("src")) loadGame();
      }
      break;
    }
    case "job": {
      const wasRunning = jobRunning();
      p.job = ev.job;
      if (S.screen === "loader") renderLoader();
      if (S.screen === "studio") {
        renderBusy();
        if (ev.job.finishedAt && wasRunning) {
          if (ev.job.reload) reloadGameSoon();
          if (ev.job.error && ev.job.kind !== "create") toast(`<b>Forge:</b> ${esc(ev.job.error)}`, 5000);
          renderChat();
        }
      }
      break;
    }
    case "asset": {
      p.assets[ev.asset.id] = ev.asset;
      if (S.screen === "loader") renderLoaderAssets();
      if (S.screen === "studio") {
        updateAssetCard(ev.asset);
        if (S.ptab === "recursos") renderFlow();
        if (AV.id === ev.asset.id) fillViewer();
      }
      break;
    }
    case "design": {
      p.design = ev.design;
      if (S.screen === "loader") renderLoader();
      if (S.screen === "studio") {
        renderTop();
        if (!document.activeElement?.closest("#flow")) renderFlow();
        else if (S.ptab === "guia") syncTuningSliders();
      }
      break;
    }
    case "chat": {
      if (!p.chat.some((c) => c.at === ev.msg.at && c.text === ev.msg.text)) p.chat.push(ev.msg);
      renderChat();
      if (ev.msg.who === "forge" && S.playing && !chatOpen()) {
        $("#chatDot").hidden = false;
        chatHint(ev.msg.text);
      }
      break;
    }
    case "tuning": {
      if (p.design) p.design.tuning = ev.tuning;
      postGame({ type: "tuning", tuning: ev.tuning });
      if (S.screen === "studio" && S.ptab === "guia") syncTuningSliders();
      break;
    }
    case "version": {
      p.currentVersion = ev.n;
      S.repairAsked = 0;
      // The SSE payload only carries the version number — refresh so `versions[]` is populated
      // (otherwise loadGame thinks there is no code: "0 guardadas · actual v1").
      void refreshProject().then(() => {
        if (S.screen === "studio") {
          renderTop();
          renderFlow();
          reloadGameSoon();
        } else if (S.screen === "loader") renderLoader();
      });
      break;
    }
    case "status": {
      p.status = ev.status;
      if (S.screen === "loader") {
        if (ev.status === "ready") void finishLoader();
        else renderLoader();
      }
      break;
    }
    case "usage": {
      p.jobUsage = ev.usage;
      // Keep cumulative in sync when the server sends it.
      if (ev.cumulative) p.usage = ev.cumulative;
      if (S.screen === "loader") renderUsageReport();
      if (S.screen === "studio") {
        renderUsageBtn();
        if (!$("#usagePop").hidden) openUsagePop();
      }
      break;
    }
    default:
      break;
  }
}
async function refreshProject() {
  if (!S.p) return;
  try {
    const fresh = await api<Project>(`/api/projects/${S.p.id}`);
    S.p = fresh;
  } catch {}
}

/* ================= Intro ================= */
function pickImageProvider(c: Caps): ImageProvider {
  // Server + both keys → OpenAI first (end users never pick).
  if (c.images.openai) return "openai";
  if (c.images.minimax) return "minimax";
  return c.defaultImageProvider;
}
function isDebugApis() {
  try {
    if (localStorage.getItem("forge.debugApis") === "1") return true;
  } catch {}
  return /(?:^|[?&#])debug(?:apis)?(?:=1|&|$)/i.test(location.search + location.hash);
}
function syncDebugApisUi(announce = false) {
  const on = isDebugApis();
  document.body.classList.toggle("debug-apis", on);
  const box = $("#keysStatus");
  if (box) {
    box.hidden = !on;
    box.setAttribute("aria-hidden", on ? "false" : "true");
  }
  if (announce) toast(on ? "Debug APIs ON (Ctrl+Shift+D)" : "Debug APIs OFF", 2200);
}
function toggleDebugApis() {
  const next = !isDebugApis();
  try {
    localStorage.setItem("forge.debugApis", next ? "1" : "0");
  } catch {}
  syncDebugApisUi(true);
}
async function initIntro() {
  try {
    S.caps = await api<Caps>("/api/config");
  } catch {
    S.caps = null;
  }
  const c = S.caps;
  if (c) {
    S.provider = pickImageProvider(c);
    const chip = (ok: boolean, label: string, req = false) =>
      `<span class="${ok ? "ok" : ""} ${req ? "req" : ""}" title="${ok ? t("keys.configured") : t("keys.missing")}"><i></i>${label}</span>`;
    const ks = $("#keysStatus");
    if (ks) {
      ks.innerHTML =
        chip(c.code, "Claude", true) + chip(c.images.openai, "OpenAI") + chip(c.images.minimax, "MiniMax") + chip(c.audio, "ElevenLabs") + chip(c.models3d, "Tripo");
    }
    $("#agentTxt").textContent = c.code ? t("intro.agentReady") : t("intro.agentMissing");
    $("#agentDot").style.background = c.code ? "" : "var(--rose)";
  }
  syncDebugApisUi();
  $("#sugs").innerHTML = ideasList()
    .map(([txt, d], i) => `<button type="button" data-i="${i}">${DIM_LABEL[d]} · ${esc(txt.split(" ").slice(0, 5).join(" "))}…</button>`)
    .join("");
  void loadProjects();
}
function setIntroDim(d: Dimension) {
  S.dim = d;
  $$(".dimsw button[data-d]").forEach((x) => x.classList.toggle("on", x.dataset.d === d));
  void syncIntroMascot();
}

/** Drop Forgy GLB at public/brand/forgy.glb — until then intro 3D uses an orange debug sphere. */
const FORGY_GLB = "/brand/forgy.glb";
const intro3d = {
  ready: false,
  usingPlaceholder: false,
  loading: null as Promise<boolean> | null,
  raf: 0,
  root: null as { rotation: { y: number } } | null,
  scene: null as { add: (o: unknown) => void; remove: (o: unknown) => void } | null,
  placeholder: null as { parent?: unknown } | null,
  render: null as null | (() => void),
  dispose: null as null | (() => void),
};
function stopIntroMascot3d(full = false) {
  if (intro3d.raf) cancelAnimationFrame(intro3d.raf);
  intro3d.raf = 0;
  if (!full) return;
  intro3d.dispose?.();
  intro3d.dispose = null;
  intro3d.render = null;
  intro3d.root = null;
  intro3d.scene = null;
  intro3d.placeholder = null;
  intro3d.ready = false;
  intro3d.usingPlaceholder = false;
  intro3d.loading = null;
}
function startIntroMascotLoop() {
  if (!intro3d.render || intro3d.raf) return;
  const tick = () => {
    if (intro3d.root) intro3d.root.rotation.y += 0.012;
    intro3d.render?.();
    intro3d.raf = requestAnimationFrame(tick);
  };
  tick();
}
function showIntroMascot3dUi(on: boolean) {
  const wrap = document.querySelector<HTMLElement>("#introMascot");
  const cv = document.querySelector<HTMLCanvasElement>("#introMascot3d");
  if (!wrap || !cv) return;
  wrap.classList.toggle("is-3d", on);
  cv.hidden = !on;
}
async function bootIntroMascotScene(): Promise<boolean> {
  if (intro3d.render) return true;
  const cv = document.querySelector<HTMLCanvasElement>("#introMascot3d");
  if (!cv) return false;
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(140, 140, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffe6c8, 0x2a2030, 0.95));
  const key = new THREE.DirectionalLight(0xfff2dd, 1.35);
  key.position.set(2.2, 3.4, 1.6);
  scene.add(key);
  // Models are normalized to a bounding sphere of radius 0.5 at the origin; frame that sphere with a small margin.
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
  const fitDist = (0.5 / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.06;
  cam.position.set(0.55, 0.35, 1.55).setLength(fitDist);
  cam.lookAt(0, 0, 0);
  intro3d.scene = scene;
  intro3d.render = () => renderer.render(scene, cam);
  intro3d.dispose = () => {
    if (intro3d.raf) cancelAnimationFrame(intro3d.raf);
    intro3d.raf = 0;
    renderer.dispose();
    pm.dispose();
    scene.environment = null;
  };
  return true;
}
async function tryLoadForgyGlb(): Promise<boolean> {
  const head = await fetch(FORGY_GLB, { method: "HEAD", cache: "no-cache" }).catch(() => null);
  if (!head?.ok) return false;
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().loadAsync(FORGY_GLB);
  if (S.dim !== "3d" || S.screen !== "intro" || !intro3d.scene) return false;
  const root = gltf.scene;
  root.traverse((c: { isMesh?: boolean; material?: unknown; castShadow?: boolean }) => {
    if (!c.isMesh) return;
    c.castShadow = false;
    const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
    for (const m of mats as { side?: number; map?: unknown; transparent?: boolean; opacity?: number; alphaTest?: number; metalness?: number; roughness?: number; needsUpdate?: boolean }[]) {
      if (!m) continue;
      m.side = THREE.DoubleSide;
      if (m.map && m.transparent && (m.opacity ?? 1) >= 0.99 && (m.alphaTest == null || m.alphaTest < 0.05)) {
        m.alphaTest = 0.35;
        m.transparent = false;
      }
      if (typeof m.metalness === "number" && m.metalness > 0.35) m.metalness = Math.min(m.metalness, 0.25);
      if (typeof m.roughness === "number" && m.roughness < 0.4) m.roughness = 0.55;
      m.needsUpdate = true;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.001);
  root.position.sub(center);
  const pivot = new THREE.Group();
  pivot.add(root);
  pivot.scale.setScalar(0.5 / radius);
  if (intro3d.placeholder) {
    intro3d.scene.remove(intro3d.placeholder);
    intro3d.placeholder = null;
  }
  intro3d.scene.add(pivot);
  intro3d.root = pivot;
  intro3d.usingPlaceholder = false;
  intro3d.ready = true;
  return true;
}
async function ensureIntroMascot3d(): Promise<boolean> {
  if (intro3d.ready) return true;
  if (intro3d.loading) return intro3d.loading;
  intro3d.loading = (async () => {
    try {
      if (!(await bootIntroMascotScene())) return false;
      // Prefer real Forgy; otherwise keep orange sphere as the stand-in model.
      const loaded = await tryLoadForgyGlb().catch((e) => {
        console.warn("[forge] intro Forgy 3D", e);
        return false;
      });
      if (!loaded) {
        const THREE = await import("three");
        if (!intro3d.placeholder && intro3d.scene) {
          const placeholder = new THREE.Mesh(
            new THREE.SphereGeometry(0.42, 32, 24),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.45, metalness: 0.15, emissive: 0xff4f1a, emissiveIntensity: 0.22 }),
          );
          intro3d.scene.add(placeholder);
          intro3d.placeholder = placeholder;
          intro3d.root = placeholder;
          intro3d.usingPlaceholder = true;
        }
      }
      return true;
    } catch (e) {
      console.warn("[forge] intro mascot 3D", e);
      return false;
    } finally {
      intro3d.loading = null;
    }
  })();
  return intro3d.loading;
}
async function syncIntroMascot() {
  const want3d = S.dim === "3d" && S.screen === "intro";
  if (!want3d) {
    stopIntroMascot3d(false);
    showIntroMascot3dUi(false);
    return;
  }
  // Placeholder mode: re-check for forgy.glb each time user picks 3D.
  if (intro3d.usingPlaceholder && !intro3d.ready) {
    const head = await fetch(FORGY_GLB, { method: "HEAD", cache: "no-cache" }).catch(() => null);
    if (head?.ok) {
      stopIntroMascot3d(true);
    }
  }
  const ok = await ensureIntroMascot3d();
  if (!ok || S.dim !== "3d" || S.screen !== "intro") {
    showIntroMascot3dUi(false);
    return;
  }
  showIntroMascot3dUi(true);
  startIntroMascotLoop();
}

async function loadProjects() {
  try {
    const list = await api<ProjectSummary[]>("/api/projects");
    const box = $("#projects");
    if (!box || !$("#projGrid")) return;
    box.hidden = !list.length;
    $("#projGrid").innerHTML = list
      .slice(0, 12)
      .map(
        (p, j) => `<div class="pj" role="button" tabindex="0" data-id="${esc(p.id)}" style="--j:${j}">
        <div class="th" style="${p.thumb ? `background-image:url('${esc(p.thumb)}');background-size:contain` : ""}">${p.thumb ? "" : DIM_LABEL[p.dimension]}</div>
        <b title="${esc(p.idea)}">${esc(p.title)}</b><small>${DIM_LABEL[p.dimension]} · ${p.status === "generating" ? t("intro.generating") : p.status === "error" ? t("intro.error") : new Date(p.updatedAt).toLocaleDateString(getLocale())}</small>
        <button type="button" class="del" data-del="${esc(p.id)}" title="${esc(t("intro.delete"))}" aria-label="${esc(t("intro.delete"))}">×</button></div>`,
      )
      .join("");
  } catch (e) {
    console.warn("[forge] loadProjects", e);
    toast(esc((e as Error).message || t("intro.loadFail")), 4000);
  }
}
async function createGame(idea: string) {
  if (S.caps && !S.caps.code) {
    toast(t("keys.anthropic"), 5000);
    return;
  }
  const btn = $<HTMLButtonElement>("#askSend");
  btn.disabled = true;
  try {
    const p = await api<Project>("/api/projects", { method: "POST", json: { idea, dimension: S.dim } });
    $("#intro").classList.add("leaving");
    await sleep(430);
    openProject(p);
  } catch (e) {
    toast(esc((e as Error).message), 5000);
    btn.disabled = false;
  }
}
async function openProjectById(id: string) {
  try {
    const p = await api<Project & { busy?: boolean }>(`/api/projects/${id}`);
    openProject(p);
  } catch (e) {
    toast(esc((e as Error).message));
    history.replaceState(null, "", "/studio");
  }
}
function openProject(p: Project) {
  S.p = p;
  S.gameVersion = 0;
  S.repairAsked = 0;
  history.replaceState(null, "", `/studio?p=${encodeURIComponent(p.id)}`);
  connect(p.id);
  stopIntroMascot3d(true);
  $("#intro").hidden = true;
  $("#intro").classList.remove("leaving");
  const creating = p.status !== "ready" || (p.job?.kind === "create" && !p.job.finishedAt);
  if (creating || !p.versions.length) runLoader();
  else enterStudio(null);
}

/* ================= Loader ================= */
const LD = { raf: 0, t0: 0, shown: 0, target: 0, stageT: {} as Record<string, number>, tipTimer: 0 as unknown as ReturnType<typeof setInterval>, gallery: [] as string[], galI: 0, galT: 0, finishing: false, typed: "" };
function runLoader() {
  setScreen("loader");
  const ld = $("#loader");
  ld.hidden = false;
  ld.classList.remove("leaving", "handoff");
  LD.t0 = performance.now();
  LD.shown = 0;
  LD.stageT = {};
  LD.gallery = [];
  LD.galI = 0;
  LD.finishing = false;
  LD.typed = "";
  $("#ldGallery").innerHTML = "";
  $("#ldAssets").innerHTML = "";
  $("#ldSteps").innerHTML = "";
  $("#ldError").hidden = true;
  const ur = $("#ldReport");
  if (ur) {
    ur.hidden = true;
    ur.innerHTML = "";
  }
  $("#ldEyebrow").textContent = t("loader.eyebrow");
  let tipI = Math.floor(Math.random() * 6);
  const showTip = () => {
    const tips = tipsList();
    $("#ldTip").innerHTML = `<span>${esc(t("loader.tip", { tip: tips[tipI++ % tips.length] }))}</span>`;
  };
  showTip();
  clearInterval(LD.tipTimer);
  LD.tipTimer = setInterval(showTip, 4200);
  const idea = $("#ldIdea");
  idea.classList.remove("done");
  idea.textContent = "";
  const text = S.p!.idea;
  let ci = 0;
  const tw = setInterval(() => {
    ci += 2;
    idea.textContent = "“" + text.slice(0, ci) + (ci >= text.length ? "”" : "");
    if (ci >= text.length) {
      clearInterval(tw);
      idea.classList.add("done");
    }
  }, 22);
  renderLoader();
  cancelAnimationFrame(LD.raf);
  startEmbers();
}
function setLoaderTitle(title: string) {
  if (LD.typed === title) return;
  LD.typed = title;
  let i = 0;
  $("#ldTitle").innerHTML = title
    .split(" ")
    .map((w, wi) => `<span style="display:inline-block;white-space:nowrap">${[...w].map((ch) => `<span style="--i:${i++}" class="${wi > 0 ? "hl" : ""}">${esc(ch)}</span>`).join("")}</span>`)
    .join(" ");
}
function stageLabel(id: string, fallback: string) {
  const key = `stage.${id}`;
  const v = t(key);
  return v === key ? fallback : v;
}
function stageDetail(detail: string | undefined, status: string) {
  if (!detail) return status === "skip" ? t("stage.skipped") : "";
  const exact: Record<string, string> = {
    "Leyendo tu idea": "stage.detail.reading",
    "Escribiendo el código": "stage.detail.writing",
    "Corrigiendo el error": "stage.detail.fixing",
    "Editando el código": "stage.detail.editing",
    "Analizando el error": "stage.detail.analyzing",
    "Validando": "stage.detail.validating",
    "Listo para jugar": "stage.detail.ready",
    "Sin cambios": "stage.detail.noChanges",
    "Nueva versión": "stage.detail.newVersion",
    "Error corregido": "stage.detail.fixed",
    "Entendiendo el cambio": "stage.detail.understanding",
    Generando: "stage.detail.generating",
  };
  if (exact[detail]) return t(exact[detail]);
  const lines = /^(\d+)\s*líneas$/i.exec(detail);
  if (lines) return t("stage.detail.lines", { n: lines[1] });
  const fixAttempt = /^Corrigiendo validación \(intento (\d+)\)$/i.exec(detail);
  if (fixAttempt) return t("stage.detail.fixAttempt", { n: fixAttempt[1] });
  const updated = /^(\d+)\s*actualizados$/i.exec(detail);
  if (updated) return t("stage.detail.updated", { n: updated[1] });
  return detail;
}
function jobProgress(job: Job | undefined) {
  if (!job) return 0.02;
  const now = performance.now();
  let s = 0;
  for (const st of job.stages) {
    if (st.status === "ok" || st.status === "skip" || st.status === "error") s += 1;
    else if (st.status === "run") {
      const m = /(\d+)\/(\d+)/.exec(st.detail || "");
      const started = (LD.stageT[st.id] ??= now);
      const el = (now - started) / 1000;
      s += m ? 0.1 + 0.85 * (+m[1] / Math.max(1, +m[2])) : 0.9 * (1 - Math.exp(-el / (st.id === "code" ? 120 : 30)));
    }
  }
  return clamp(s / job.stages.length, 0.02, 1);
}
function renderLoader() {
  const p = S.p;
  if (!p || S.screen !== "loader") return;
  setLoaderTitle(p.design ? t("loader.forgingNamed", { title: p.design.title }) : t("loader.forging"));
  const job = p.job?.kind === "create" ? p.job : undefined;
  const stages = job?.stages || [{ id: "director", label: t("stage.director"), status: "run" as const, detail: t("stage.detail.reading") }];
  const ol = $("#ldSteps");
  if (ol.children.length !== stages.length) {
    ol.innerHTML = stages
      .map((s, j) => `<li style="--i:${j}" data-id="${s.id}"><span class="ic"></span><div style="min-width:0"><b></b><small></small></div><em></em></li>`)
      .join("");
  }
  stages.forEach((s, j) => {
    const li = ol.children[j] as HTMLElement;
    const cls = s.status === "wait" ? "" : s.status;
    if (li.className !== cls) li.className = cls;
    const label = stageLabel(s.id, s.label);
    li.querySelector("b")!.textContent = label;
    li.querySelector("small")!.textContent = stageDetail(s.detail, s.status);
    const t0 = LD.stageT[s.id];
    if (s.status === "run" && !t0) LD.stageT[s.id] = performance.now();
    if ((s.status === "ok" || s.status === "error") && t0 && !li.dataset.done) {
      li.dataset.done = "1";
      li.querySelector("em")!.textContent = `${((performance.now() - t0) / 1000).toFixed(0)} s`;
    }
  });
  const cur = stages.find((s) => s.status === "run");
  const curLabel = cur ? stageLabel(cur.id, cur.label) : "";
  $("#ldTag").querySelector("span")!.textContent =
    p.status === "ready" ? t("studio.ready") : cur ? `${curLabel}…` : p.status === "error" ? t("loader.stopped") : `${t("loader.preparing")}…`;
  $("#ldTag").classList.toggle("ok", p.status === "ready");
  LD.target = p.status === "ready" ? 1 : jobProgress(job);
  const errBox = $("#ldError");
  if (p.status === "error" && !jobRunning()) {
    errBox.hidden = false;
    errBox.innerHTML = `<p><b>${esc(t("loader.failTitle"))}</b> ${esc(p.job?.error || "—")}</p><button class="btn small primary-s" type="button" id="ldRetry">${esc(t("loader.retry"))}</button>`;
    $("#ldEyebrow").textContent = t("loader.failTitle");
  } else errBox.hidden = true;
  renderUsageReport();
  renderLoaderAssets();
}
function usageHTML(report: UsageReport | undefined, opts?: { title?: string; live?: boolean }) {
  if (!report || (!report.totals.calls && !Object.keys(report.byProvider).length)) {
    return `<div class="ur-head"><b>${esc(opts?.title || t("usage.title"))}</b><span>—</span></div><p class="ur-note">${esc(t("usage.empty"))}</p>`;
  }
  const wall = (report.finishedAt ?? Date.now()) - report.startedAt;
  const rows = (Object.keys(report.byProvider) as ApiProvider[])
    .map((k) => report.byProvider[k]!)
    .sort((a, b) => b.estimatedUsd - a.estimatedUsd);
  const bits = (u: (typeof rows)[0]) => {
    const parts: string[] = [];
    if (u.inputTokens || u.outputTokens) parts.push(`${(u.inputTokens + u.outputTokens).toLocaleString()} tok (${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out)`);
    if (u.images) parts.push(`${u.images} imagen${u.images === 1 ? "" : "es"}`);
    if (u.audioSec) parts.push(`${Math.round(u.audioSec)}s audio`);
    if (u.models) parts.push(`${u.models} modelo${u.models === 1 ? "" : "s"}`);
    parts.push(`${u.calls} llamada${u.calls === 1 ? "" : "s"} · ${formatDuration(u.ms)}`);
    return parts.join(" · ");
  };
  return `<div class="ur-head"><b>${esc(opts?.title || t("usage.title"))}</b><span>${opts?.live && !report.finishedAt ? `${t("usage.live")} · ` : ""}${formatDuration(wall)}</span></div>
    <div class="ur-grid">${rows
      .map(
        (u) =>
          `<div class="ur-row"><strong>${esc(API_LABEL[u.provider])}</strong><em>${formatUsd(u.estimatedUsd)}</em><small>${esc(bits(u))}</small></div>`,
      )
      .join("")}</div>
    <div class="ur-total"><span>${esc(t("usage.total"))}</span><b>${formatUsd(report.totals.estimatedUsd)}</b></div>`;
}
function renderUsageReport() {
  const box = $("#ldReport");
  if (!box) return;
  const report = S.p?.jobUsage || S.p?.usage;
  if (!report || (!report.totals.calls && !Object.keys(report.byProvider).length)) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = usageHTML(report, { title: t("usage.thisForge"), live: true });
}
function thumbHTML(a: AssetRecord, extra = "") {
  const url = FILE(a);
  if (a.type === "image" && a.status === "ready" && url) {
    return `<img src="${esc(url)}" alt="" loading="lazy" class="${COVER_ROLES.has(roleOf(a)) ? "cover" : ""} ${extra}">`;
  }
  if (a.type === "audio") {
    const h = hash(a.id);
    const bars = Array.from({ length: 22 }, (_, i) => `<i style="height:${20 + ((h >> i % 24) & 7) * 10 + ((i * 37) % 23)}%"></i>`).join("");
    const ic = roleOf(a) === "music" ? IC_NOTE : roleOf(a) === "voice" ? IC_VOICE : IC_SFX;
    return `<div class="ico-tile audio ${extra}">${ic}<div class="wv">${bars}</div></div>`;
  }
  if (a.type === "model") return `<div class="ico-tile model ${extra}">${IC_CUBE}</div>`;
  return `<div class="ico-tile ${extra}">${IC_IMG}</div>`;
}
function renderLoaderAssets() {
  const box = $("#ldAssets");
  const list = sorted(assets());
  if (!list.length) return;
  for (const a of list) {
    let el = box.querySelector<HTMLElement>(`.la[data-id="${CSS.escape(a.id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "la";
      el.dataset.id = a.id;
      box.appendChild(el);
    }
    const key = `${a.status}:${a.rev}`;
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    el.className = `la ${a.status === "ready" ? "ready" : a.status === "error" ? "err" : a.status === "skipped" ? "skip" : ""}`;
    el.innerHTML = `<div class="la-in"><div class="thumb">${thumbHTML(a)}</div><div class="k">${esc(kindOf(a))}${a.status === "generating" ? " · …" : a.status === "error" ? ` · ${esc(t("lib.error"))}` : a.status === "skipped" ? ` · ${esc(t("asset.skipped"))}` : ""}</div><div class="nm" title="${esc(a.error || a.name)}">${esc(a.name)}</div></div>`;
    if (a.type === "image" && a.status === "ready" && !LD.gallery.includes(a.id)) {
      LD.gallery.push(a.id);
      const img = document.createElement("img");
      img.src = FILE(a);
      img.className = COVER_ROLES.has(roleOf(a)) ? "" : "sprite";
      img.dataset.id = a.id;
      $("#ldGallery").appendChild(img);
      if (LD.gallery.length === 1 || roleOf(a) === "background") showGallery(LD.gallery.length - 1);
    }
  }
}
function showGallery(i: number) {
  LD.galI = i;
  LD.galT = performance.now();
  $$("#ldGallery img").forEach((im, j) => im.classList.toggle("on", j === i));
}
function startEmbers() {
  const ld = $("#loader");
  const ec = $<HTMLCanvasElement>("#embers");
  const ectx = ec.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const embers: { x: number; y: number; vy: number; vx: number; r: number; l: number; ml: number; ph: number }[] = [];
  const mk = ld.querySelector<HTMLElement>(".ld-mark")!;
  const mas = mk.querySelector<HTMLElement>(".mascot")!;
  let last = performance.now();
  const frame = (now: number) => {
    if (ld.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const elapsed = (now - LD.t0) / 1000;
    if (ec.width !== ld.clientWidth * dpr || ec.height !== ld.clientHeight * dpr) {
      ec.width = ld.clientWidth * dpr;
      ec.height = ld.clientHeight * dpr;
    }
    if (S.p?.job && S.screen === "loader" && !LD.finishing) LD.target = Math.max(LD.target, S.p.status === "ready" ? 1 : jobProgress(S.p.job.kind === "create" ? S.p.job : undefined));
    LD.shown += (LD.target - LD.shown) * Math.min(1, dt * 3);
    const c = LD.shown;
    $("#ldBar").style.width = (c * 100).toFixed(1) + "%";
    $("#ldPct").textContent = Math.round(c * 100) + "%";
    mk.style.setProperty("--gray", (1 - c).toFixed(3));
    mk.style.setProperty("--bri", (0.7 + 0.3 * c).toFixed(3));
    mk.style.setProperty("--glow", (2 + 16 * c).toFixed(1) + "px");
    mk.style.setProperty("--gla", (0.1 + 0.6 * c).toFixed(2));
    mk.style.setProperty("--ringo", (0.35 + 0.65 * c).toFixed(2));
    const sp = 1.6 + 4.4 * c,
      amp = 1 + 7 * c,
      rot = 1.5 + 9 * c;
    mas.style.transform = `translateY(${(-Math.abs(Math.sin(elapsed * sp)) * amp).toFixed(1)}px) rotate(${(Math.sin(elapsed * sp * 0.5) * rot).toFixed(1)}deg)`;
    if (LD.gallery.length > 1 && now - LD.galT > 3200) showGallery((LD.galI + 1) % LD.gallery.length);
    const liveReport = S.p?.jobUsage || S.p?.usage;
    const liveSpan = $("#ldReport")?.querySelector<HTMLElement>(".ur-head span");
    if (liveSpan && liveReport && !liveReport.finishedAt && (liveReport.totals.calls || Object.keys(liveReport.byProvider).length)) {
      liveSpan.textContent = `${t("usage.live")} · ${formatDuration(Date.now() - liveReport.startedAt)}`;
    }
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ectx.clearRect(0, 0, ec.width, ec.height);
    const ew = ld.clientWidth,
      eh = ld.clientHeight;
    if (embers.length < 70 && Math.random() < 0.6) embers.push({ x: Math.random() * ew, y: eh + 10, vy: 30 + Math.random() * 60, vx: (Math.random() - 0.5) * 20, r: 1 + Math.random() * 2.4, l: 0, ml: 3 + Math.random() * 4, ph: Math.random() * 6 });
    for (let k = embers.length - 1; k >= 0; k--) {
      const m = embers[k];
      m.l += dt;
      m.y -= m.vy * dt;
      m.x += m.vx * dt + Math.sin(elapsed * 2 + m.ph) * 0.3;
      const a = Math.sin(Math.PI * clamp(m.l / m.ml, 0, 1));
      if (m.l > m.ml || m.y < -10) {
        embers.splice(k, 1);
        continue;
      }
      ectx.fillStyle = `rgba(255,${120 + ((m.ph * 20) | 0)},40,${a * 0.7})`;
      ectx.beginPath();
      ectx.arc(m.x, m.y, m.r, 0, 7);
      ectx.fill();
    }
    LD.raf = requestAnimationFrame(frame);
  };
  LD.raf = requestAnimationFrame(frame);
}
async function finishLoader() {
  if (LD.finishing || S.screen !== "loader") return;
  LD.finishing = true;
  LD.target = 1;
  // Pull the saved version list before entering the studio (SSE "version" alone is not enough).
  await refreshProject();
  renderLoader();
  $("#ldEyebrow").textContent = t("studio.ready");
  $$("#ldTitle .hl").forEach((x) => {
    x.style.color = "var(--emerald)";
    x.style.transition = "color .4s";
  });
  const ld = $("#loader");
  setTimeout(() => ld.classList.add("handoff"), 700);
  setTimeout(() => {
    const r = $(".ld-preview").getBoundingClientRect();
    leaveLoader();
    enterStudio(r);
  }, 1100);
}
function leaveLoader() {
  const ld = $("#loader");
  ld.hidden = true;
  ld.classList.remove("handoff");
  clearInterval(LD.tipTimer);
  cancelAnimationFrame(LD.raf);
}

/* ================= Studio ================= */
function enterStudio(from: DOMRect | null) {
  setScreen("studio");
  S.ptab = "guia";
  S.open = 1; // Consumo de APIs (segunda sección de la guía)
  S.playing = false;
  const st = $("#studio");
  st.classList.add("assemble");
  st.classList.remove("assembled");
  st.hidden = false;
  window.scrollTo(0, 0);
  renderStudio();
  // Ensure versions[] is present even if we arrived with a stale client snapshot.
  void (async () => {
    if (!S.p?.versions.length) await refreshProject();
    renderStudio();
    loadGame(true);
  })();
  const pv = $(".st-preview");
  const go = () => {
    st.classList.remove("assemble");
    setTimeout(() => {
      st.classList.add("assembled");
      pv.classList.remove("landing");
      if (!S.tourSeen) startTour();
      else dockHint(t("chat.hintReady"));
    }, 1500);
  };
  if (from && from.width) {
    const to = pv.getBoundingClientRect();
    pv.style.transformOrigin = "0 0";
    pv.style.transition = "none";
    pv.style.transform = `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width},${from.height / to.height})`;
    pv.getBoundingClientRect();
    requestAnimationFrame(() => {
      pv.style.transition = "transform .75s cubic-bezier(.65,0,.25,1)";
      pv.style.transform = "none";
      pv.classList.add("landing");
      setTimeout(() => {
        pv.style.transition = "";
        pv.style.transform = "";
        pv.style.transformOrigin = "";
        go();
      }, 720);
    });
  } else go();
}
function renderStudio() {
  renderTop();
  renderAssets();
  renderFlow();
  renderChat();
  renderBusy();
  renderUsageBtn();
  syncAssetsCollapse();
}
function renderTop() {
  const p = S.p,
    d = design();
  if (!p) return;
  const title = d?.title || p.idea.slice(0, 40);
  $("#bnEyebrow").textContent = d ? `${d.genre} · ${DIM_LABEL[d.dimension]}` : DIM_LABEL[p.dimension];
  $("#stHero").textContent = title;
  $("#stIdea").textContent = d?.tagline || `“${p.idea}”`;
  $("#stIdea").title = p.idea;
  $("#projName").textContent = title;
  $("#playTitle").textContent = title;
  $("#loopPill").textContent = d?.genre || t("guide.game");
  $("#verPill").textContent = t("guide.versionN", { n: p.currentVersion || 0 });
  document.title = `${title} · Forge Xpresso`;
}
function renderBusy() {
  const job = S.p?.job;
  const box = $("#studioBusy");
  const running = !!job && !job.finishedAt && job.kind !== "create";
  box.hidden = !running;
  document.body.classList.toggle("studio-job-busy", running);
  if (!running) return;
  const cur = job!.stages.find((s) => s.status === "run") || job!.stages.find((s) => s.status === "wait");
  $("#studioBusyT").textContent = job!.kind === "repair" ? t("studio.busyRepair") : job!.kind === "asset" ? t("studio.busyAsset") : t("studio.busy");
  $("#studioBusyS").textContent = cur
    ? `${stageLabel(cur.id, cur.label)}${cur.detail ? ` · ${stageDetail(cur.detail, cur.status)}` : ""}`
    : "";
}
function usageSummary() {
  const p = S.p;
  if (!p) return { primary: undefined as UsageReport | undefined, job: undefined as UsageReport | undefined, showJob: false };
  const jobU = p.jobUsage;
  const allU = p.usage;
  const hasJob = !!jobU && (jobU.totals.calls > 0 || Object.keys(jobU.byProvider).length > 0);
  const hasAll = !!allU && (allU.totals.calls > 0 || Object.keys(allU.byProvider).length > 0);
  const primary = hasAll ? allU! : hasJob ? jobU! : undefined;
  const showJob = hasJob && hasAll && jobU !== allU && (jobU!.totals.estimatedUsd > 0 || jobU!.totals.calls > 0);
  return { primary, job: jobU, showJob };
}
function renderUsageBtn() {
  const btn = $<HTMLButtonElement>("#usageBtn");
  if (!btn) return;
  const { primary } = usageSummary();
  btn.hidden = S.screen !== "studio" || !S.p;
  btn.textContent = primary ? `${t("guide.usage")} · ${formatUsd(primary.totals.estimatedUsd)}` : t("guide.usage");
}
function openUsagePop() {
  const { primary, job, showJob } = usageSummary();
  const body = $("#usagePopBody");
  body.innerHTML = `<div class="usage-card">${usageHTML(primary, { title: t("guide.projectUsage") })}</div>
    ${showJob && job ? `<div class="usage-card" style="margin-top:10px">${usageHTML(job, { title: t("guide.lastJob") })}</div>` : ""}
    ${!primary ? `<p class="ur-note">${esc(t("guide.usageOld"))}</p>` : ""}`;
  $("#usagePop").hidden = false;
}
function closeUsagePop() {
  $("#usagePop").hidden = true;
}
function syncAssetsCollapse() {
  const sec = $("#stAssets");
  const btn = $<HTMLButtonElement>("#assetsToggle");
  if (!sec || !btn) return;
  sec.classList.toggle("collapsed", !S.assetsOpen);
  btn.setAttribute("aria-expanded", S.assetsOpen ? "true" : "false");
}

/* ---------- Asset cards ---------- */
function cardHTML(a: AssetRecord, i: number) {
  const v = a.liked || 0;
  const url = FILE(a);
  const st = a.status;
  const badge =
    st === "generating" ? t("intro.generating") : st === "error" ? t("lib.error") : st === "skipped" ? t("lib.nokey") : st === "pending" ? t("lib.generating") : "";
  return `<div class="asset ${v > 0 ? "liked" : v < 0 ? "disliked" : ""} ${st}" data-id="${esc(a.id)}" style="--ai:${i}">
    <div class="tw"><button type="button" class="tv" data-a="view" aria-label="${esc(t("lib.view"))} ${esc(a.name)}">${thumbHTML(a)}${badge ? `<span class="st-badge ${st}">${badge}</span>` : ""}${a.rev > 1 ? `<span class="rev-badge">r${a.rev}</span>` : ""}</button>
    <div class="tb"><button type="button" data-a="upload" title="${esc(t("asset.upload"))}" aria-label="${esc(t("asset.upload"))}">${ICUP}</button>${url ? `<a href="${esc(url)}" download="${esc(a.id)}.${esc((a.file || "").split(".").pop())}" title="${esc(t("asset.download"))}" aria-label="${esc(t("asset.download"))}">${ICDN}</a>` : ""}</div></div>
    <div><div class="k">${esc(kindOf(a))}${a.custom ? `<span class="upl">${esc(t("asset.yours"))}</span>` : ""}${v > 0 ? ` · <span class="likebadge">${esc(t("asset.fav"))}</span>` : ""}</div><div class="nm" title="${esc(a.error || a.name)}">${esc(a.name)}</div></div>
    <div class="tg">${a.provider ? `<span>${esc(a.provider)}</span>` : ""}${a.type === "audio" ? `<span>${(a.spec as AudioAssetSpec).durationSec}s</span>` : ""}</div>
    <div class="acts"><button type="button" data-a="regen" title="${esc(t("asset.regen"))}" aria-label="${esc(t("asset.regen"))}">${ICON.swap}<span class="tx">${esc(t("asset.regen"))}</span></button><button type="button" class="up" data-a="like" title="${esc(t("asset.like"))}" aria-label="${esc(t("asset.like"))}">${ICON.up}</button><button type="button" data-a="dislike" title="${esc(t("asset.dislike"))}" aria-label="${esc(t("asset.dislike"))}">${ICON.down}</button></div></div>`;
}
function renderAssets() {
  const list = sorted(assets());
  $("#assets").innerHTML = list.length ? list.map((a, i) => cardHTML(a, i)).join("") : `<div class="empty-n">${esc(t("asset.empty"))}</div>`;
}
function updateAssetCard(a: AssetRecord) {
  const el = $("#assets").querySelector<HTMLElement>(`.asset[data-id="${CSS.escape(a.id)}"]`);
  if (!el) {
    renderAssets();
    return;
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = cardHTML(a, 0);
  const fresh = tmp.firstElementChild as HTMLElement;
  fresh.style.setProperty("--ai", "0");
  el.replaceWith(fresh);
  if (a.status === "ready") {
    fresh.classList.add("pulse");
    setTimeout(() => fresh.classList.remove("pulse"), 2200);
  }
}
async function assetAction(id: string, action: string) {
  const p = S.p;
  const a = p?.assets[id];
  if (!p || !a) return;
  if (action === "view") return openViewer(id);
  if (action === "upload") return startUpload(id);
  if (action === "like") {
    const v = a.liked === 1 ? 0 : 1;
    a.liked = v;
    updateAssetCard(a);
    if (v) toast(t("asset.favorited", { name: esc(a.name) }));
    await api(`/api/projects/${p.id}/assets/${id}`, { method: "POST", json: { action: "like", value: v } }).catch(() => {});
    return;
  }
  if (action === "dislike") {
    a.liked = -1;
    await api(`/api/projects/${p.id}/assets/${id}`, { method: "POST", json: { action: "like", value: -1 } }).catch(() => {});
  }
  if (action === "regen" || action === "dislike") await regenerate(id);
}
async function regenerate(id: string, prompt?: string) {
  const p = S.p;
  const a = p?.assets[id];
  if (!p || !a) return;
  if (a.type === "image" && S.caps && !S.caps.images[p.imageProvider] && !S.caps.images.openai && !S.caps.images.minimax) return toast(t("keys.images"));
  if (a.type === "audio" && S.caps && !S.caps.audio) return toast(t("keys.elevenlabs"));
  if (a.type === "model" && S.caps && !S.caps.models3d) return toast(t("keys.tripo"));
  try {
    await api(`/api/projects/${p.id}/assets/${id}`, { method: "POST", json: { action: "regenerate", prompt } });
    toast(t("asset.regenerating", { name: esc(a.name) }));
  } catch (e) {
    toast(esc((e as Error).message), 4000);
  }
}
let upId: string | null = null;
function startUpload(id: string) {
  const a = S.p?.assets[id];
  if (!a) return;
  upId = id;
  const inp = $<HTMLInputElement>("#upIn");
  inp.value = "";
  inp.accept = a.type === "audio" ? "audio/*,.mp3,.wav,.ogg,.m4a" : a.type === "model" ? ".glb" : "image/png,image/jpeg,image/webp,image/gif";
  inp.click();
}
async function onUploadChosen() {
  const inp = $<HTMLInputElement>("#upIn");
  const f = inp.files?.[0];
  const id = upId;
  if (!f || !id || !S.p) return;
  if (f.size > 25 * 1024 * 1024) return toast(t("asset.fileTooBig"));
  const fd = new FormData();
  fd.append("file", f);
  toast(t("asset.uploading", { name: esc(f.name) }));
  try {
    await api(`/api/projects/${S.p.id}/assets/${id}`, { method: "PUT", body: fd });
    toast(t("asset.uploadedInGame", { name: esc(f.name) }));
  } catch (e) {
    toast(esc((e as Error).message), 4000);
  }
}

/* ---------- Flow panel ---------- */
const PTABS = (): [typeof S.ptab, string][] => [
  ["guia", t("tab.guide")],
  ["recursos", t("tab.assets")],
  ["cine", t("tab.cine")],
];
const LIBTABS = (): [string, string, (a: AssetRecord) => boolean][] => [
  ["chars", t("lib.chars"), (a) => a.type === "image" && ["hero", "enemy", "npc", "portrait"].includes(roleOf(a))],
  ["objs", t("lib.objs"), (a) => a.type === "image" && ["collectible", "hazard", "prop", "goal", "platform", "tile", "ui"].includes(roleOf(a))],
  ["bgs", t("lib.bgs"), (a) => a.type === "image" && ["background", "texture"].includes(roleOf(a))],
  ["m3d", t("lib.m3d"), (a) => a.type === "model"],
  ["audio", t("lib.audio"), (a) => a.type === "audio"],
];
let tabAnim = false;
function guideHTML() {
  const p = S.p!,
    d = design();
  const sections: { name: string; detail: string; body: string }[] = [];
  sections.push({
    name: t("guide.idea"),
    detail: `“${p.idea}”`,
    body: `<div class="dz"><p>${esc(p.idea)}</p><div class="dz-row"><span>${DIM_LABEL[p.dimension]}</span>${d ? `<span>${esc(d.camera)}</span>` : ""}</div></div>`,
  });
  if (d) {
    sections.push({
      name: t("guide.design"),
      detail: d.genre,
      body: `<div class="dz"><p><b>${esc(d.title)}</b> — ${esc(d.tagline)}</p>
        <div class="lbl">${esc(t("guide.objective"))}</div><div class="goal">${esc(d.objective)}</div>
        <div class="lbl">${esc(t("guide.mechanics"))}</div><ul>${d.mechanics.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        <div class="lbl">${esc(t("guide.controls"))}</div><div class="keys">${d.controls.map((c) => `<div><kbd>${esc(c.input)}</kbd>${esc(c.action)}</div>`).join("")}</div>
        <div class="lbl">${esc(t("guide.level"))}</div><p>${esc(d.levelOutline)}</p>
        <div class="lbl">${esc(t("guide.style"))}</div><p>${esc(d.artStyle)}</p><div class="dz-row">${d.palette.map((c) => `<span style="background:${esc(c)};color:transparent;width:22px" title="${esc(c)}">.</span>`).join("")}</div></div>`,
    });
    sections.push({
      name: t("guide.live"),
      detail: t("guide.liveDetail", { n: d.tuning.length }),
      body: `<p>${esc(t("guide.liveHelp"))}</p><div class="tune">${d.tuning
        .map((tp) => {
          const step = tp.max - tp.min > 20 ? 1 : (tp.max - tp.min) / 100;
          return `<div class="tune-r"><label for="tn-${esc(tp.key)}" title="${esc(tp.key)}">${esc(tp.label)}</label><output id="tno-${esc(tp.key)}">${fmt(tp.value)}</output><input type="range" id="tn-${esc(tp.key)}" data-tune="${esc(tp.key)}" min="${tp.min}" max="${tp.max}" step="${step}" value="${tp.value}"></div>`;
        })
        .join("")}</div>`,
    });
  }
  sections.push({
    name: t("guide.versions"),
    detail: t("guide.versionsDetail", { n: p.versions.length, v: p.currentVersion }),
    body: `<div class="vers">${p.versions
      .slice()
      .reverse()
      .map(
        (v) =>
          `<div class="ver ${v.n === p.currentVersion ? "on" : ""}"><b>v${v.n}</b><span title="${esc(v.note)}">${esc(v.note)} · ${new Date(v.createdAt).toLocaleTimeString(getLocale(), { hour: "2-digit", minute: "2-digit" })}</span>${v.n === p.currentVersion ? `<em class="likebadge">${esc(t("guide.inUse"))}</em>` : `<button type="button" data-ver="${v.n}">${esc(t("guide.use"))}</button>`}</div>`,
      )
      .join("")}</div>`,
  });
  return sections
    .map(
      (s, i) => `<div class="fs ok ${i === S.open ? "open" : ""}" data-i="${i}">
      <button type="button" class="fs-row" aria-expanded="${i === S.open}"><span class="ic"></span><div style="min-width:0"><b>${esc(s.name)}</b><small>${esc(s.detail)}</small></div><em>${i + 1}/${sections.length}</em>${CHEV}</button>
      <div class="fs-body"><div class="fs-inner"><div class="fs-pad">${s.body}</div></div></div></div>`,
    )
    .join("");
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
function libHTML() {
  const tabs = LIBTABS();
  const tab = tabs.find((x) => x[0] === S.lib) || tabs[0];
  const items = sorted(assets().filter(tab[2]));
  let note = "";
  if (S.lib === "m3d" && !S.caps?.models3d) note = `<div class="lockn">${LOCK}TRIPO_API_KEY</div>`;
  if (S.lib === "audio" && !S.caps?.audio) note = `<div class="lockn">${LOCK}ELEVENLABS_API_KEY</div>`;
  const countKey = items.length === 1 ? "lib.count" : "lib.count_plural";
  const stLabel = (a: AssetRecord) =>
    a.status === "ready" ? a.provider || t("lib.ready") : a.status === "skipped" ? t("lib.nokey") : a.status === "error" ? t("lib.error") : t("lib.generating");
  return `<div class="lib-h"><div class="ctabs" role="tablist">${tabs.map(([id, n]) => `<button type="button" class="${S.lib === id ? "on" : ""}" data-lib="${id}">${n}</button>`).join("")}</div>
    <div class="lib-meta"><span>${esc(t(countKey, { n: items.length }))}</span></div></div>
    ${items.length ? `<div class="lib-grid">${items
      .map(
        (a, j) => `<div class="li ${a.liked === 1 ? "on" : ""}" style="--j:${j}" data-id="${esc(a.id)}"><div class="li-t"><button type="button" class="tv" data-view="${esc(a.id)}" aria-label="${esc(t("lib.view"))} ${esc(a.name)}">${thumbHTML(a)}${a.rev > 1 ? `<span class="rev-badge">r${a.rev}</span>` : ""}</button>${a.type === "model" ? '<span class="li-3d">3D</span>' : ""}</div>
        <b title="${esc(a.name)}">${esc(a.name)}</b><span>${esc(kindOf(a))} · ${esc(stLabel(a))}</span>
        ${a.type === "audio" && a.status === "ready" ? `<button type="button" data-listen="${esc(a.id)}">${ICPLAY}${esc(t("lib.listen"))}</button>` : `<button type="button" data-view="${esc(a.id)}">${esc(t("lib.view"))}</button>`}</div>`,
      )
      .join("")}</div>` : `<div class="empty-n">${esc(t("lib.empty"))}</div>`}${note}`;
}
const CSTY = (): [string, string][] => [
  ["epica", t("cine.epica")],
  ["misteriosa", t("cine.misteriosa")],
  ["comica", t("cine.comica")],
];
function cineHTML() {
  const d = design();
  if (!d) return `<p>${esc(t("cine.unavailable"))}</p>`;
  const lines = [0, 1, 2].map((i) => d.cinematic.lines[i] || "");
  const voice = assets().find((a) => a.type === "audio" && a.id === "narration");
  return `<div class="cine-h"><span class="mascot" aria-hidden="true"></span><p>${esc(t("cine.blurb", { voice: voice?.status === "ready" ? t("cine.withVoice") : "" }))}</p></div>
    <div class="lbl">${esc(t("cine.style"))}</div><div class="presets">${CSTY().map(([id, n]) => `<button type="button" class="preset ${d.cinematic.style === id ? "on" : ""}" data-cs="${id}">${n}</button>`).join("")}</div>
    <div class="lbl">${esc(t("cine.script"))}</div><div class="shots">${lines.map((l, i) => `<label class="shot"><em class="mono">${esc(t("cine.shot", { n: i + 1 }))}</em><input class="field" data-line="${i}" value="${esc(l)}" maxlength="90"></label>`).join("")}</div>
    ${voice ? `<div class="note">${esc(t("cine.voiceNote"))}</div>` : ""}
    <label class="tog"><input type="checkbox" id="cineAuto" ${S.p?.cineAuto ? "checked" : ""}><span class="sw"></span>${esc(t("cine.auto"))}</label>
    <button type="button" class="btn primary-s" id="cinePlay">${ICPLAY}${esc(t("studio.cine"))}</button>`;
}
function renderFlow() {
  const f = $("#flow");
  if (!S.p) return;
  const tabs = PTABS();
  const body = S.ptab === "recursos" ? libHTML() : S.ptab === "cine" ? cineHTML() : guideHTML();
  f.innerHTML = `<div class="flowbox"><div class="ptabs" role="tablist">${tabs.map(([id, n]) => `<button type="button" role="tab" class="${S.ptab === id ? "on" : ""}" aria-selected="${S.ptab === id}" data-ptab="${id}">${n}</button>`).join("")}<i class="ptab-ink" style="--x:${tabs.findIndex((x) => x[0] === S.ptab)}"></i></div><div class="tabc ${tabAnim ? "anim" : ""}">${body}</div></div>`;
  tabAnim = false;
  $$(".fs-pad", f).forEach((pad) => Array.from(pad.children).forEach((c, j) => (c as HTMLElement).style.setProperty("--c", String(j))));
}
function setOpen() {
  $$("#flow .fs").forEach((el) => {
    const on = Number(el.dataset.i) === S.open;
    if (on && !el.classList.contains("open")) {
      el.classList.add("opening");
      setTimeout(() => el.classList.remove("opening"), 900);
    }
    el.classList.toggle("open", on);
    el.querySelector(".fs-row")!.setAttribute("aria-expanded", String(on));
  });
}
function syncTuningSliders() {
  for (const t of design()?.tuning || []) {
    const inp = document.getElementById(`tn-${t.key}`) as HTMLInputElement | null;
    if (inp && document.activeElement !== inp) inp.value = String(t.value);
    const o = document.getElementById(`tno-${t.key}`);
    if (o) o.textContent = fmt(t.value);
  }
}
let tuneSaveT: ReturnType<typeof setTimeout> | undefined;
function onTune(inp: HTMLInputElement) {
  const d = design();
  if (!d || !S.p) return;
  const t = d.tuning.find((x) => x.key === inp.dataset.tune);
  if (!t) return;
  t.value = Number(inp.value);
  const o = document.getElementById(`tno-${t.key}`);
  if (o) o.textContent = fmt(t.value);
  postGame({ type: "tuning", tuning: d.tuning });
  clearTimeout(tuneSaveT);
  const id = S.p.id;
  tuneSaveT = setTimeout(() => void api(`/api/projects/${id}`, { method: "PATCH", json: { tuning: d.tuning.map((x: TuningParam) => ({ key: x.key, value: x.value })) } }).catch(() => {}), 500);
}
async function patchProject(body: Record<string, unknown>) {
  if (!S.p) return;
  try {
    const p = await api<Project>(`/api/projects/${S.p.id}`, { method: "PATCH", json: body });
    S.p.cineAuto = p.cineAuto;
    S.p.imageProvider = p.imageProvider;
    if (p.design) S.p.design = p.design;
    return p;
  } catch (e) {
    toast(esc((e as Error).message));
  }
}
function playCine() {
  const d = design();
  if (!d) return;
  if (!S.gameReady) return toast(t("play.waitLoad"));
  postGame({ type: "cinematic", lines: d.cinematic.lines, title: d.title });
}

/* ---------- Chat ---------- */
const chatOpen = () => !$("#chatWin").hidden;
function chatText(l: Pick<ChatMsg, "who" | "text" | "tags">) {
  if (l.tags?.includes("sys:ready")) return t("chat.ready", { title: l.text });
  // Legacy Spanish ready blurb from older forges.
  const legacy = /^¡(.+?) está listo!/.exec(l.text);
  if (legacy) return t("chat.ready", { title: legacy[1] });
  return l.text;
}
function msgHTML(l: Pick<ChatMsg, "who" | "text" | "tags">, thinking = false) {
  const body = thinking ? l.text : chatText(l);
  const tags = (l.tags || []).filter((x) => !x.startsWith("sys:"));
  return `<div class="msg ${l.who}">${l.who === "forge" ? '<span class="mascot ava" aria-hidden="true"></span>' : ""}<div class="mb ${thinking ? "thinking" : ""}">${esc(body)}${tags.length ? `<div class="tagrow">${tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}</div></div>`;
}
function renderChat() {
  const p = S.p;
  if (!p) return;
  const job = p.job;
  const thinking = !!job && !job.finishedAt && job.kind === "chat";
  const cur = thinking ? job!.stages.find((s) => s.status === "run") : null;
  const thinkLabel = cur
    ? `${stageLabel(cur.id, cur.label)}${cur.detail ? ` · ${stageDetail(cur.detail, cur.status)}` : ""}`
    : t("chat.thinking");
  const html =
    p.chat.map((l) => msgHTML(l)).join("") + (thinking ? msgHTML({ who: "forge", text: thinkLabel }, true) : "");
  const d = $("#dockLog");
  d.innerHTML = html || msgHTML({ who: "forge", text: t("chat.hello") });
  d.scrollTop = d.scrollHeight;
  railUpdate();
  setTimeout(railUpdate, 350);
  const lg = $("#chatLog");
  lg.innerHTML = d.innerHTML;
  lg.scrollTop = lg.scrollHeight;
  $("#chatCtx").innerHTML = S.playing
    ? `<span class="ctx-chip">${esc(t("chat.inGame"))}</span>${esc(t("chat.inGameHint"))}`
    : `<span class="ctx-chip">${esc(design()?.title || "")}</span>${esc(design()?.genre || "")}`;
}
async function sendChat(text: string) {
  text = text.trim();
  if (!text || !S.p) return;
  if (jobRunning()) return toast(t("chat.busy"));
  try {
    await api(`/api/projects/${S.p.id}/chat`, { method: "POST", json: { message: text, playing: S.playing } });
  } catch (e) {
    toast(esc((e as Error).message), 4000);
  }
}
function openChat() {
  const w = $("#chatWin");
  w.hidden = false;
  w.classList.remove("closing");
  $("#chatTip").hidden = true;
  $("#chatDot").hidden = true;
  $("#chatFab").setAttribute("aria-expanded", "true");
  renderChat();
  setTimeout(() => $<HTMLInputElement>("#chatIn").focus({ preventScroll: true }), 60);
}
function closeChat() {
  const w = $("#chatWin");
  if (w.hidden) return;
  w.classList.add("closing");
  $("#chatFab").setAttribute("aria-expanded", "false");
  setTimeout(() => {
    w.hidden = true;
    w.classList.remove("closing");
    if (S.playing) gameFrame().focus();
  }, 220);
}
let tipT: ReturnType<typeof setTimeout> | undefined;
function chatHint(text: string) {
  if (!S.playing) {
    if (S.screen === "studio") dockHint(text);
    return;
  }
  if (chatOpen()) return;
  const t = $("#chatTip");
  $("#chatTipTxt").textContent = text;
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(tipT);
  tipT = setTimeout(() => (t.hidden = true), 7000);
}
let dockT: ReturnType<typeof setTimeout> | undefined;
function dockHint(text: string) {
  const h = $("#dockHint");
  h.textContent = text;
  h.hidden = false;
  h.classList.remove("show");
  void h.offsetWidth;
  h.classList.add("show");
  clearTimeout(dockT);
  dockT = setTimeout(() => (h.hidden = true), 6500);
}
function railUpdate() {
  const d = $("#dockLog"),
    rail = $("#dockRail"),
    th = $("#dockThumb");
  const over = d.scrollHeight > d.clientHeight + 2;
  rail.hidden = !over;
  d.classList.toggle("more", over && d.scrollTop > 4);
  if (!over) return;
  const rh = rail.clientHeight,
    h = Math.max(18, (rh * d.clientHeight) / d.scrollHeight);
  const top = (rh - h) * (d.scrollTop / (d.scrollHeight - d.clientHeight));
  th.style.height = h + "px";
  th.style.transform = `translateY(${top}px)`;
}

/* ---------- Play mode ---------- */
function openPlay() {
  if (S.playing || !S.p?.versions.length) return;
  closeViewer();
  $("#chatTip").hidden = true;
  S.playing = true;
  $("#play").hidden = false;
  $("#play").classList.remove("leaving");
  $(".st-preview").classList.add("away");
  document.body.classList.add("is-playing");
  gameFrame().focus();
  postGame({ type: "focus" });
  // Don't auto-start: keep the in-game start menu (Jugar / Ajustes / cinemática) visible when maximizing.
  renderChat();
  setTimeout(() => chatHint(t("chat.hintPlay")), 1600);
  setTimeout(() => chatHint(t("chat.hintStyle")), 12000);
}
function closePlay(instant = false) {
  if (!S.playing) return;
  S.playing = false;
  closeChat();
  $("#chatTip").hidden = true;
  if (S.gameScreen === "play") postGame({ type: "pause" });
  $(".st-preview").classList.remove("away");
  document.body.classList.remove("is-playing");
  const pl = $("#play");
  if (instant) {
    pl.hidden = true;
    return;
  }
  pl.classList.add("leaving");
  setTimeout(() => {
    pl.hidden = true;
    pl.classList.remove("leaving");
  }, 420);
}
function setSound(on: boolean) {
  S.sound = on;
  for (const id of ["#sndBtn", "#sndBtn2"]) {
    const b = $(id);
    if (!b) continue;
    b.classList.toggle("on", on);
    const w = b.querySelector<SVGElement>("#sndWave, .sndWave2");
    if (w) w.style.display = on ? "" : "none";
  }
  postGame({ type: "mute", on: !on });
  if (on && S.volume <= 0.01) setVolume(0.5);
}
function setVolume(v: number) {
  S.volume = clamp(v, 0, 1);
  for (const id of ["#volSlider", "#volSlider2"]) {
    const el = $<HTMLInputElement>(id);
    if (el && Math.abs(Number(el.value) - S.volume) > 0.001) el.value = String(S.volume);
  }
  if (S.volume <= 0.01) {
    if (S.sound) setSound(false);
  } else if (!S.sound) {
    S.sound = true;
    for (const id of ["#sndBtn", "#sndBtn2"]) $(id)?.classList.add("on");
  }
  postGame({ type: "mute", on: !S.sound });
  postGame({ type: "volume", master: S.volume });
}

/* ---------- Asset viewer ---------- */
const AV = {
  id: "" as string,
  viewRev: 0,
  audio: null as HTMLAudioElement | null,
  three: null as null | { dispose: () => void },
  sheet: null as null | (() => void),
};
function assetRevList(a: AssetRecord): { rev: number; file: string }[] {
  if (!a.file || !a.rev) return a.file ? [{ rev: Math.max(1, a.rev), file: a.file }] : [];
  const m = /^(assets\/.+)\.r(\d+)\.([^.]+)$/.exec(a.file);
  if (!m) return [{ rev: a.rev, file: a.file }];
  const [, stem, curRev, ext] = m;
  const max = Math.max(a.rev, Number(curRev) || 1);
  return Array.from({ length: max }, (_, i) => ({ rev: i + 1, file: `${stem}.r${i + 1}.${ext}` }));
}
function assetActiveRev(a: AssetRecord) {
  const m = a.file ? /\.r(\d+)\.[^.]+$/.exec(a.file) : null;
  return m ? Number(m[1]) : a.rev || 1;
}
function assetFileUrl(file: string) {
  return S.p ? `/api/files/${S.p.id}/${file}` : "";
}
async function useAssetRev(rev: number) {
  const a = S.p?.assets[AV.id];
  if (!S.p || !a) return;
  if (rev === assetActiveRev(a)) {
    toast(t("asset.revAlready"));
    return;
  }
  try {
    const out = await api<AssetRecord>(`/api/projects/${S.p.id}/assets/${a.id}`, { method: "POST", json: { action: "useRev", rev } });
    S.p.assets[a.id] = out;
    AV.viewRev = rev;
    fillViewer();
    updateAssetCard(out);
    if (S.ptab === "recursos") renderFlow();
    const url = FILE(out);
    if ((out.type === "image" || out.type === "audio") && url && S.gameReady) {
      postGame({ type: "swapAsset", id: out.id, url, assetType: out.type });
    } else if (S.p?.versions.length) {
      reloadGameSoon();
    }
    toast(t("asset.revApplied", { n: rev }));
  } catch (e) {
    toast(esc((e as Error).message), 4000);
  }
}
function openViewer(id: string) {
  const a = S.p?.assets[id];
  if (!a) return;
  AV.id = id;
  AV.viewRev = assetActiveRev(a);
  const av = $("#av");
  av.hidden = false;
  av.classList.remove("closing");
  fillViewer();
  setTimeout(() => $("#avClose").focus({ preventScroll: true }), 50);
}
function fillViewer() {
  const a = S.p?.assets[AV.id];
  if (!a) return;
  const revs = assetRevList(a);
  const active = assetActiveRev(a);
  if (!AV.viewRev || AV.viewRev > Math.max(a.rev || 1, active)) AV.viewRev = active;
  const cur = revs.find((r) => r.rev === AV.viewRev) || revs.at(-1);
  const url = cur ? assetFileUrl(cur.file) : FILE(a);
  const viewingActive = AV.viewRev === active;
  $("#avKind").textContent = kindOf(a);
  $("#avName").textContent = a.name;
  const spec = a.spec as ImageAssetSpec & AudioAssetSpec;
  const tags = [
    a.provider,
    a.custom ? t("asset.uploaded") : "",
    a.liked === 1 ? t("asset.favorite") : "",
    a.rev > 1 ? t("asset.revN", { n: AV.viewRev, total: a.rev }) : a.rev ? t("asset.revOne", { n: a.rev }) : "",
    viewingActive && a.rev > 1 ? t("asset.inGame") : "",
  ].filter(Boolean) as string[];
  $("#avTags").innerHTML = tags.map((x) => `<span>${esc(x)}</span>`).join("");
  const rows: [string, string][] = [
    [
      t("asset.status"),
      { ready: t("lib.ready"), generating: t("lib.generating"), pending: t("lib.generating"), error: t("lib.error"), skipped: t("lib.nokey") }[a.status],
    ],
  ];
  if (a.type === "image") rows.push([t("asset.role"), roleLabel(spec.role)], [t("asset.format"), `${spec.aspect}${spec.transparent ? ` · ${t("asset.transparent")}` : ""}`]);
  if (a.type === "audio") rows.push([t("asset.type"), audioLabel(spec.kind)], [t("asset.duration"), `${spec.durationSec} s${spec.loop ? ` · ${t("asset.loop")}` : ""}`]);
  if (a.mime) rows.push([t("asset.file"), a.mime]);
  $("#avSpec").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("") + (a.spec.usage ? `<dt>${esc(t("asset.usage"))}</dt><dd style="text-align:left;font-family:inherit">${esc(a.spec.usage)}</dd>` : "");
  const pr = $<HTMLTextAreaElement>("#avPrompt");
  if (document.activeElement !== pr) pr.value = a.spec.prompt || "";
  $("#avNote").textContent = a.error
    ? `${t("asset.lastError")}: ${a.error}`
    : a.status === "generating"
      ? t("asset.generatingNew")
      : revs.length > 1 && !viewingActive
        ? t("asset.revHint")
        : t("asset.editHint");
  $<HTMLButtonElement>("#avRegen").disabled = a.status === "generating";
  const useBtn =
    revs.length > 1 && !viewingActive
      ? `<button type="button" class="btn small primary-s" data-ava="useRev">${t("asset.useRev", { n: AV.viewRev })}</button>`
      : "";
  $("#avActs").innerHTML = `${useBtn}<button type="button" class="btn small" data-ava="like">${ICON.up}${a.liked === 1 ? t("asset.unlike") : t("asset.like")}</button><button type="button" class="btn small" data-ava="up">${ICUP}${t("asset.upload")}</button>${url ? `<a class="btn small" href="${esc(url)}" download="${esc(a.id)}.${esc((cur?.file || a.file || "").split(".").pop() || "bin")}">${ICDN}${t("asset.download")}</a>` : ""}`;
  const revBox = $("#avRevs");
  if (revs.length > 1) {
    revBox.hidden = false;
    revBox.innerHTML = revs
      .map(
        (r) =>
          `<button type="button" data-arev="${r.rev}" class="${r.rev === AV.viewRev ? "on" : ""}${r.rev === active ? " active" : ""}" title="${esc(
            r.rev === active ? t("asset.inGame") : t("asset.showRev", { n: r.rev }),
          )}">r${r.rev}${r.rev === active ? " ✓" : ""}</button>`,
      )
      .join("");
  } else {
    revBox.hidden = true;
    revBox.innerHTML = "";
  }
  // stage
  const img = $<HTMLImageElement>("#avImg"),
    wave = $<HTMLCanvasElement>("#avWave"),
    c3 = $<HTMLCanvasElement>("#av3d");
  img.hidden = wave.hidden = c3.hidden = true;
  $("#avPlay").hidden = true;
  $("#avHint").hidden = true;
  $("#avLoad").hidden = true;
  stopViewerMedia();
  if (a.status !== "ready" || !url) {
    $("#avLoad").hidden = false;
    $("#avLoadT").textContent =
      a.status === "generating" || a.status === "pending" ? t("lib.generating") : a.status === "skipped" ? t("asset.noKey") : t("asset.unavailable");
    return;
  }
  const stage = $("#avStage");
  stage.classList.toggle("is-cutout", a.type === "image" && !!(a.spec as ImageAssetSpec).transparent && !COVER_ROLES.has(roleOf(a)));
  if (a.type === "image" && spec.sheet) {
    wave.hidden = false;
    viewSheet(url, wave, sheetAnimsFor(spec.sheet, cur?.file || a.file));
  } else if (a.type === "image") {
    img.hidden = false;
    img.className = COVER_ROLES.has(roleOf(a)) ? "cover" : "";
    img.src = url;
  } else if (a.type === "audio") {
    wave.hidden = false;
    $("#avPlay").hidden = false;
    AV.audio = new Audio(url);
    AV.audio.loop = !!spec.loop;
    AV.audio.addEventListener("ended", () => avPlayBtn());
    avPlayBtn();
    void drawWave(url, wave);
  } else {
    c3.hidden = false;
    $("#avHint").hidden = false;
    $("#avHint").textContent = t("asset.orbitHint");
    void viewModel(url, c3);
  }
}
/** Plays a spritesheet's clips in the viewer (feet on a fixed floor line) with one chip per animation. */
function viewSheet(url: string, cv: HTMLCanvasElement, anims: SheetAnimSpec[]) {
  const layout = sheetLayout(anims);
  const hint = $("#avHint");
  hint.hidden = false;
  hint.classList.add("chips");
  let pick = layout.anims.find((x) => x.name === "walk") || layout.anims[0];
  const chips = () => {
    hint.innerHTML = layout.anims
      .map((x) => `<button type="button" data-sheet-anim="${x.name}" class="${x === pick ? "on" : ""}">${esc(x.name)}</button>`)
      .join("");
  };
  chips();
  hint.onclick = (e) => {
    const n = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet-anim]")?.dataset.sheetAnim;
    const next = layout.anims.find((x) => x.name === n);
    if (!next) return;
    pick = next;
    t0 = performance.now();
    chips();
  };
  const im = new Image();
  im.src = url;
  let raf = 0;
  let t0 = performance.now();
  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    if (!im.complete || !im.naturalWidth) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const x = cv.getContext("2d")!;
    x.clearRect(0, 0, w, h);
    const el = (now - t0) / 1000;
    const step = Math.floor(el * pick.fps);
    const k = pick.loop ? step % pick.frames : Math.min(pick.frames - 1, step);
    if (!pick.loop && step >= pick.frames + Math.ceil(pick.fps * 0.6)) t0 = now;
    const idx = pick.start + k;
    const cell = layout.cell;
    const size = Math.min(h * 0.82, w * 0.7);
    const floor = h * 0.9;
    x.imageSmoothingQuality = "high";
    x.drawImage(im, (idx % layout.cols) * cell, Math.floor(idx / layout.cols) * cell, cell, cell, (w - size) / 2, floor - size, size, size);
    x.strokeStyle = "rgba(255,176,32,.45)";
    x.setLineDash([6 * dpr, 4 * dpr]);
    x.beginPath();
    x.moveTo(w * 0.2, floor - size * 0.03);
    x.lineTo(w * 0.8, floor - size * 0.03);
    x.stroke();
  };
  raf = requestAnimationFrame(draw);
  AV.sheet = () => {
    cancelAnimationFrame(raf);
    hint.onclick = null;
    hint.classList.remove("chips");
  };
}
function avPlayBtn() {
  const playing = !!AV.audio && !AV.audio.paused;
  $("#avPlayBtn").innerHTML = `${playing ? ICSTOP : ICPLAY}${playing ? t("asset.stop") : t("lib.listen")}`;
}
async function drawWave(url: string, cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.max(1, r.width * dpr);
  cv.height = Math.max(1, r.height * dpr);
  const x = cv.getContext("2d")!;
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const audio = await ac.decodeAudioData(buf);
    void ac.close();
    const data = audio.getChannelData(0);
    const n = 160,
      step = Math.floor(data.length / n) || 1;
    const w = cv.width,
      h = cv.height,
      bw = w / n;
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#ff7a1a");
    g.addColorStop(1, "#ffd36b");
    x.fillStyle = g;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let j = 0; j < step; j += 16) peak = Math.max(peak, Math.abs(data[i * step + j] || 0));
      const bh = Math.max(2 * dpr, peak * h * 0.7);
      x.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh);
    }
  } catch {
    x.fillStyle = "rgba(255,122,26,.4)";
    x.fillRect(0, cv.height / 2 - 1, cv.width, 2);
  }
}
async function viewModel(url: string, cv: HTMLCanvasElement) {
  $("#avLoad").hidden = false;
  $("#avLoadT").textContent = t("asset.loadingModel");
  const id = AV.id;
  try {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    if (AV.id !== id) return;
    const r = cv.getBoundingClientRect();
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(r.width, r.height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const cam = new THREE.PerspectiveCamera(40, r.width / r.height, 0.01, 100);
    const ctl = new OrbitControls(cam, cv);
    ctl.enableDamping = true;
    ctl.autoRotate = true;
    const gltf = await new GLTFLoader().loadAsync(url);
    const obj = gltf.scene;
    obj.traverse((c: { isMesh?: boolean; material?: unknown }) => {
      if (!c.isMesh) return;
      const mats = Array.isArray(c.material) ? c.material : c.material ? [c.material] : [];
      for (const m of mats as { side?: number; map?: unknown; transparent?: boolean; opacity?: number; alphaTest?: number; metalness?: number; roughness?: number; needsUpdate?: boolean }[]) {
        if (!m) continue;
        m.side = THREE.DoubleSide;
        if (m.map && m.transparent && (m.opacity ?? 1) >= 0.99 && (m.alphaTest == null || m.alphaTest < 0.05)) {
          m.alphaTest = 0.35;
          m.transparent = false;
        }
        if (typeof m.metalness === "number" && m.metalness > 0.35) m.metalness = Math.min(m.metalness, 0.25);
        if (typeof m.roughness === "number" && m.roughness < 0.4) m.roughness = 0.55;
        m.needsUpdate = true;
      }
    });
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    scene.add(obj);
    cam.position.set(size * 0.7, size * 0.45, size * 0.9);
    ctl.target.set(0, 0, 0);
    $("#avLoad").hidden = true;
    let raf = 0;
    const loop = () => {
      ctl.update();
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    loop();
    AV.three = {
      dispose: () => {
        cancelAnimationFrame(raf);
        ctl.dispose();
        renderer.dispose();
        pm.dispose();
      },
    };
  } catch (e) {
    $("#avLoadT").textContent = t("asset.modelFail", { msg: (e as Error).message });
  }
}
function stopViewerMedia() {
  AV.audio?.pause();
  AV.audio = null;
  AV.three?.dispose();
  AV.three = null;
  AV.sheet?.();
  AV.sheet = null;
}
function closeViewer() {
  const av = $("#av");
  if (av.hidden) return;
  stopViewerMedia();
  AV.id = "";
  av.classList.add("closing");
  setTimeout(() => {
    av.hidden = true;
    av.classList.remove("closing");
  }, 240);
}
let libAudio: HTMLAudioElement | null = null;
function listen(id: string, btn: HTMLElement) {
  const a = S.p?.assets[id];
  if (!a) return;
  const labelListen = () => `${ICPLAY}${esc(t("lib.listen"))}`;
  const labelStop = () => `${ICSTOP}${esc(t("asset.stop"))}`;
  if (libAudio && !libAudio.paused && libAudio.dataset.id === id) {
    libAudio.pause();
    btn.innerHTML = labelListen();
    return;
  }
  libAudio?.pause();
  $$("[data-listen]").forEach((b) => (b.innerHTML = labelListen()));
  libAudio = new Audio(FILE(a));
  libAudio.dataset.id = id;
  libAudio.play().catch(() => {});
  libAudio.addEventListener("ended", () => (btn.innerHTML = labelListen()));
  btn.innerHTML = labelStop();
}

/* ---------- Export ---------- */
let exportBlob: { url: string; name: string } | null = null;
async function openExport() {
  if (!S.p) return;
  if (S.playing) closePlay(true);
  const m = $("#modal");
  m.hidden = false;
  const st = [t("export.stageGather"), t("export.stagePack"), t("export.stageZip")];
  $("#mStages").innerHTML = st.map((s) => `<div class="stg"><i></i>${s}</div>`).join("");
  $("#mTitle").textContent = t("export.title");
  $$<HTMLButtonElement>(".dl button").forEach((b) => (b.disabled = true));
  const bar = $("#mProg");
  bar.style.width = "0%";
  const rows = $$("#mStages .stg");
  let i = 0;
  rows[0].className = "stg run";
  const tick = setInterval(() => {
    if (i < rows.length - 1) {
      rows[i].className = "stg ok";
      i++;
      rows[i].className = "stg run";
      bar.style.width = `${(i / rows.length) * 100}%`;
    }
  }, 700);
  try {
    const res = await fetch(`/api/projects/${S.p.id}/export`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || "juego.zip";
    if (exportBlob) URL.revokeObjectURL(exportBlob.url);
    exportBlob = { url: URL.createObjectURL(blob), name };
    clearInterval(tick);
    rows.forEach((r) => (r.className = "stg ok"));
    bar.style.width = "100%";
    $("#mTitle").textContent = t("export.ready", { size: (blob.size / 1024 / 1024).toFixed(1) });
    $<HTMLButtonElement>("#dlSrc").disabled = false;
    $<HTMLButtonElement>("#dlWeb").disabled = false;
  } catch (e) {
    clearInterval(tick);
    $("#mTitle").textContent = t("export.fail");
    toast(esc((e as Error).message), 4000);
  }
}

/* ---------- Forge Pro ---------- */
let proRAF = 0;
let proPts: { x: number; y: number; vx: number; vy: number; c: string; s: number; p: number }[] | null = null;
function openPro() {
  if (S.playing) closePlay(true);
  const st = $("#studio");
  st.classList.add("leaving");
  setTimeout(() => {
    st.hidden = true;
    st.classList.remove("leaving");
    setScreen("pro");
    const pro = $("#pro");
    pro.hidden = false;
    pro.classList.remove("leaving");
    const d = design();
    $("#proProj").textContent = d?.title || "";
    $("#proMeta").textContent = `${d?.genre || ""} · ${t("pro.meta", { versions: S.p?.versions.length || 0, assets: assets().filter((a) => a.status === "ready").length })}`;
    const imgs = sorted(assets().filter((a) => a.type === "image" && a.status === "ready" && !(a.spec as ImageAssetSpec).sheet));
    const pick = [imgs.find((a) => roleOf(a) === "hero"), imgs.find((a) => roleOf(a) === "background"), imgs.find((a) => !["hero", "background"].includes(roleOf(a)))];
    $$<HTMLElement>(".pc-img").forEach((el, i) => {
      const a = pick[i] || imgs[i];
      el.style.backgroundImage = a ? `url('${FILE(a)}')` : "";
      el.style.backgroundSize = a && COVER_ROLES.has(roleOf(a)) ? "cover" : "contain";
    });
    window.scrollTo(0, 0);
    const bot = $("#proBot") as HTMLElement & { _t?: ReturnType<typeof setInterval> };
    bot.textContent = "";
    const msg = t("pro.botReady");
    let i = 0;
    clearInterval(bot._t);
    setTimeout(() => {
      bot._t = setInterval(() => {
        i += 2;
        bot.textContent = msg.slice(0, i);
        if (i >= msg.length) clearInterval(bot._t);
      }, 28);
    }, 1500);
    startSky();
  }, 320);
}
function closePro() {
  const pro = $("#pro");
  pro.classList.add("leaving");
  cancelAnimationFrame(proRAF);
  setTimeout(() => {
    pro.hidden = true;
    pro.classList.remove("leaving");
    setScreen("studio");
    const st = $("#studio");
    st.hidden = false;
    st.classList.add("assemble");
    window.scrollTo(0, 0);
    renderStudio();
    requestAnimationFrame(() => requestAnimationFrame(() => st.classList.remove("assemble")));
  }, 330);
}
function startSky() {
  const c = $<HTMLCanvasElement>("#proSky"),
    x = c.getContext("2d")!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = () => {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
  };
  fit();
  if (!proPts) {
    let s = 42;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    proPts = Array.from({ length: 70 }, () => ({ x: r(), y: r(), vx: (r() - 0.5) * 0.012, vy: (r() - 0.5) * 0.012, c: ["#ff7a1a", "#8b5cf6", "#2dd4bf", "#f5a524", "#60a5fa"][Math.floor(r() * 5)], s: 0.8 + r() * 1.6, p: r() * 6 }));
  }
  let last = performance.now();
  const loop = (now: number) => {
    if ($("#pro").hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (c.width !== innerWidth * dpr) fit();
    const w = innerWidth,
      h = innerHeight;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    for (const p of proPts!) {
      p.x = (p.x + p.vx * dt + 1) % 1;
      p.y = (p.y + p.vy * dt + 1) % 1;
    }
    x.lineWidth = 0.6;
    for (let i = 0; i < proPts!.length; i++) {
      const a = proPts![i];
      for (let j = i + 1; j < proPts!.length; j++) {
        const b = proPts![j];
        const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
        if (d < 130) {
          x.strokeStyle = `rgba(139,92,246,${(1 - d / 130) * 0.22})`;
          x.beginPath();
          x.moveTo(a.x * w, a.y * h);
          x.lineTo(b.x * w, b.y * h);
          x.stroke();
        }
      }
    }
    for (const p of proPts!) {
      x.globalAlpha = 0.55 + 0.45 * Math.sin(now / 600 + p.p);
      x.fillStyle = p.c;
      x.beginPath();
      x.arc(p.x * w, p.y * h, p.s, 0, 7);
      x.fill();
    }
    x.globalAlpha = 1;
    proRAF = requestAnimationFrame(loop);
  };
  cancelAnimationFrame(proRAF);
  proRAF = requestAnimationFrame(loop);
}

/* ---------- Tour ---------- */
const TOUR_SELS = [null, "#vp", "#playBtn", "#dock", ".st-assets", "#flow", "#exportBtn", "#homeBtn"] as const;
const tourSteps = () => TOUR_SELS.map((sel, i) => ({ sel, t: t(`tour.${i + 1}.t`), d: t(`tour.${i + 1}.d`) }));
let tourI = 0;
function startTour() {
  tourI = 0;
  const el = $("#tour");
  el.hidden = false;
  el.classList.remove("closing");
  $("#tourDots").innerHTML = tourSteps().map((_, i) => `<i data-i="${i}"></i>`).join("");
  showTourStep(true);
}
function endTour() {
  const tourEl = $("#tour");
  if (tourEl.hidden) return;
  tourEl.classList.add("closing");
  setTimeout(() => {
    tourEl.hidden = true;
    tourEl.classList.remove("closing");
  }, 280);
  S.tourSeen = true;
  try {
    localStorage.setItem("forge.tourSeen", "1");
  } catch {}
  dockHint(t("chat.hintAsk"));
}
function tourGo(d: number) {
  const steps = tourSteps();
  const n = tourI + d;
  if (n < 0) return;
  if (n >= steps.length) return endTour();
  tourI = n;
  showTourStep();
}
function showTourStep(first = false) {
  const steps = tourSteps();
  const st = steps[tourI];
  const card = $("#tourCard"),
    spot = $("#tourSpot");
  $("#tourStep").textContent = t("tour.step", { n: tourI + 1, total: steps.length });
  $("#tourT").textContent = st.t;
  $("#tourD").textContent = st.d;
  $<HTMLButtonElement>("#tourBack").disabled = tourI === 0;
  $("#tourNext").textContent = tourI === steps.length - 1 ? t("tour.start") : t("tour.next");
  $$("#tourDots i").forEach((d, i) => d.classList.toggle("on", i === tourI));
  card.classList.remove("swap");
  void card.offsetWidth;
  card.classList.add("swap");
  const el = st.sel ? document.querySelector<HTMLElement>(st.sel) : null;
  if (!el) {
    $("#tour").classList.add("center");
    spot.style.cssText = "";
    placeTourCard(null);
    return;
  }
  $("#tour").classList.remove("center");
  const r0 = el.getBoundingClientRect();
  if (r0.top < 70 || r0.bottom > innerHeight - 20) el.scrollIntoView({ behavior: first ? "auto" : "smooth", block: "center" });
  setTimeout(() => positionTour(el), first ? 30 : 380);
}
function positionTour(el: HTMLElement) {
  if ($("#tour").hidden) return;
  const r = el.getBoundingClientRect(),
    pad = 8;
  const spot = $("#tourSpot");
  spot.style.left = r.left - pad + "px";
  spot.style.top = r.top - pad + "px";
  spot.style.width = r.width + pad * 2 + "px";
  spot.style.height = r.height + pad * 2 + "px";
  placeTourCard(r);
}
function placeTourCard(r: DOMRect | null) {
  const card = $("#tourCard");
  const cw = card.offsetWidth,
    ch = card.offsetHeight,
    M = 16;
  if (!r || innerWidth < 640) {
    card.style.left = "";
    card.style.top = "";
    card.classList.toggle("dock-b", !!r);
    return;
  }
  card.classList.remove("dock-b");
  let left: number, top: number;
  if (innerHeight - r.bottom > ch + M * 2) {
    top = r.bottom + M + 8;
    left = r.left;
  } else if (r.top > ch + M * 2) {
    top = r.top - ch - M - 8;
    left = r.left;
  } else if (innerWidth - r.right > cw + M * 2) {
    left = r.right + M + 8;
    top = r.top;
  } else {
    left = r.left - cw - M - 8;
    top = r.top;
  }
  card.style.left = clamp(left, M, innerWidth - cw - M) + "px";
  card.style.top = clamp(top, M, innerHeight - ch - M) + "px";
}

/* ---------- Lobby ---------- */
function goLobby() {
  if (S.playing) closePlay(true);
  closeChat();
  closeViewer();
  $("#modal").hidden = true;
  $("#tour").hidden = true;
  $("#chatTip").hidden = true;
  disconnect();
  const leave = S.screen === "loader" ? $("#loader") : $("#studio");
  leave.classList.add("leaving");
  setTimeout(() => {
    if (S.screen === "loader") leaveLoader();
    $("#studio").hidden = true;
    leave.classList.remove("leaving");
    gameFrame().removeAttribute("src");
    S.p = null;
    setScreen("intro");
    document.title = "Forge Xpresso";
    history.replaceState(null, "", "/studio");
    const it = $("#intro");
    it.classList.remove("leaving");
    it.classList.add("back");
    it.hidden = false;
    $<HTMLTextAreaElement>("#askIn").value = "";
    $<HTMLButtonElement>("#askSend").disabled = true;
    window.scrollTo(0, 0);
    setTimeout(() => it.classList.remove("back"), 600);
    void syncIntroMascot();
    void loadProjects();
  }, 380);
}

/* ================= i18n ================= */
function ensureLangSwitcherHosts() {
  let intro = $("#introLang");
  if (!intro) {
    intro = document.createElement("div");
    intro.id = "introLang";
    intro.className = "langsw langsw-fixed";
    intro.setAttribute("role", "group");
    document.body.appendChild(intro);
  } else if (intro.parentElement !== document.body) {
    // Keep fixed top-right of the viewport (not clipped/centered by #intro).
    document.body.appendChild(intro);
  }
  let studio = $("#studioLang");
  if (!studio) {
    const top = document.querySelector(".top .spacer");
    studio = document.createElement("div");
    studio.id = "studioLang";
    studio.className = "langsw";
    studio.setAttribute("role", "group");
    if (top?.parentElement) top.parentElement.insertBefore(studio, top.nextSibling);
    else document.body.appendChild(studio);
  }
}
function renderLangSwitchers() {
  ensureLangSwitcherHosts();
  const loc = getLocale();
  for (const id of ["#introLang", "#studioLang"]) {
    const box = $(id);
    if (!box) continue;
    box.className = id === "#introLang" ? "langsw langsw-fixed" : "langsw";
    box.setAttribute("aria-label", t("intro.lang"));
    box.innerHTML = (["es", "en", "fr"] as Locale[])
      .map((idL) => `<button type="button" data-locale="${idL}" class="${loc === idL ? "on" : ""}" title="${idL.toUpperCase()}">${idL.toUpperCase()}</button>`)
      .join("");
    box.querySelectorAll<HTMLButtonElement>("[data-locale]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        applyLocale(btn.getAttribute("data-locale") as Locale | null);
      });
    });
  }
}
function refreshLocaleUI() {
  applyDomI18n(document);
  renderLangSwitchers();
  document.documentElement.style.setProperty("--vol-label", `"${t("studio.volume")}"`);
  document.documentElement.lang = getLocale();
  // Force the most visible lobby strings (in case attributes were stripped).
  const h1 = document.querySelector<HTMLElement>("#introIn h1");
  if (h1) h1.innerHTML = t("intro.title");
  const sub = document.querySelector<HTMLElement>("#introIn .sub");
  if (sub) sub.textContent = t("intro.sub");
  const yourGames = document.querySelector<HTMLElement>("#projects .lbl");
  if (yourGames) yourGames.textContent = t("intro.yourGames");
  void initIntro();
  if (S.p && S.screen === "studio") {
    renderAssets();
    renderFlow();
    renderBusy();
    renderUsageBtn();
    syncAssetsCollapse();
  }
  if (S.screen === "loader") {
    $("#ldEyebrow").textContent = t("loader.eyebrow");
    LD.typed = "";
    renderLoader();
  }
  if (S.p && (S.screen === "studio" || S.playing)) renderChat();
}
function applyLocale(next: Locale | null) {
  if (!next || (next !== "es" && next !== "en" && next !== "fr")) return;
  const same = next === getLocale();
  setLocale(next);
  refreshLocaleUI();
  if (S.p?.versions.length && (S.screen === "studio" || S.playing)) loadGame(true);
  if (!same) toast(`🌐 ${next.toUpperCase()}`, 1200);
}
function onLocaleClick(e: MouseEvent) {
  const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-locale]");
  if (!b) return;
  // Direct listeners on #introLang / #studioLang already handle those buttons.
  if (b.closest("#introLang, #studioLang")) return;
  e.preventDefault();
  e.stopPropagation();
  applyLocale(b.getAttribute("data-locale") as Locale | null);
}

/* ================= Wiring ================= */
/** Abort previous mount listeners when React Strict Mode remounts. */
let mountAbort: AbortController | null = null;
export function mount() {
  mountAbort?.abort();
  stopIntroMascot3d(true);
  mountAbort = new AbortController();
  const { signal } = mountAbort;

  initLocale();
  setLocale(getLocale());
  applyDomI18n(document);
  setScreen(S.screen);
  renderLangSwitchers();
  syncDebugApisUi();
  document.documentElement.style.setProperty("--vol-label", `"${t("studio.volume")}"`);
  try {
    S.tourSeen = localStorage.getItem("forge.tourSeen") === "1";
  } catch {}

  document.addEventListener("click", onLocaleClick, { capture: true, signal });
  const askIn = $<HTMLTextAreaElement>("#askIn"),
    askSend = $<HTMLButtonElement>("#askSend");
  askIn.addEventListener("input", () => (askSend.disabled = !askIn.value.trim()), { signal });
  askIn.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (askIn.value.trim()) $<HTMLFormElement>("#askForm").requestSubmit();
      }
    },
    { signal },
  );
  $("#askForm").addEventListener(
    "submit",
    (e) => {
      e.preventDefault();
      const idea = askIn.value.trim();
      if (idea) void createGame(idea);
    },
    { signal },
  );
  $$(".dimsw button[data-d]").forEach((b) => b.addEventListener("click", () => setIntroDim(b.dataset.d as Dimension), { signal }));
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        toggleDebugApis();
      }
    },
    { signal },
  );
  $("#sugs").addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      const [idea, d] = ideasList()[Number(b.dataset.i)];
      askIn.value = idea;
      askSend.disabled = false;
      setIntroDim(d);
      askIn.focus();
    },
    { signal },
  );
  $("#projGrid").addEventListener(
    "click",
    async (e) => {
      const el = e.target as HTMLElement;
      const del = el.closest<HTMLElement>("[data-del]");
      if (del) {
        e.stopPropagation();
        if (!confirm(t("intro.deleteConfirm"))) return;
        try {
          await api(`/api/projects/${del.dataset.del}`, { method: "DELETE" });
          void loadProjects();
        } catch (err) {
          toast(esc((err as Error).message));
        }
        return;
      }
      const card = el.closest<HTMLElement>(".pj");
      if (card) {
        $("#intro").classList.add("leaving");
        await sleep(380);
        await openProjectById(card.dataset.id!);
      }
    },
    { signal },
  );
  $("#projGrid").addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") (e.target as HTMLElement).closest<HTMLElement>(".pj")?.click();
    },
    { signal },
  );

  // loader
  $("#ldBack").addEventListener(
    "click",
    () => {
      toast(t("loader.bgToast"));
      goLobby();
    },
    { signal },
  );
  $("#ldError").addEventListener("click", async (e) => {
    if (!(e.target as HTMLElement).closest("#ldRetry") || !S.p) return;
    try {
      await api(`/api/projects/${S.p.id}/retry`, { method: "POST" });
      S.p.status = "generating";
      LD.target = 0.02;
      renderLoader();
    } catch (err) {
      toast(esc((err as Error).message));
    }
  });

  // studio header
  $("#homeBtn").addEventListener("click", goLobby);
  $("#helpBtn").addEventListener("click", startTour);
  $("#proBtn").addEventListener("click", openPro);
  $("#exportBtn").addEventListener("click", () => void openExport());
  $("#playBtn").addEventListener("click", openPlay);
  $("#vpExpand").addEventListener("click", (e) => {
    e.stopPropagation();
    openPlay();
  });
  $("#playExit").addEventListener("click", () => closePlay());
  $("#cineBtn").addEventListener("click", playCine);
  $("#reloadBtn").addEventListener("click", () => loadGame(true));
  $("#sndBtn").addEventListener("click", () => setSound(!S.sound));
  $("#sndBtn2").addEventListener("click", () => setSound(!S.sound));
  for (const id of ["#volSlider", "#volSlider2"]) {
    $(id)?.addEventListener("input", (e) => setVolume(Number((e.target as HTMLInputElement).value)));
  }
  $("#dbgBtn").addEventListener("click", () => {
    S.debug = !S.debug;
    $("#dbgBtn").classList.toggle("on", S.debug);
    postGame({ type: "debug", on: S.debug });
    toast(S.debug ? t("play.debugOn") : t("play.debugOff"));
  });
  $("#rstBtn").addEventListener("click", () => {
    postGame({ type: "restart" });
    gameFrame().focus();
  });
  $("#vpErr").addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-vperr]");
    if (!b) return;
    if (b.dataset.vperr === "x") hideVpErr();
    else if (b.dataset.vperr === "repair") void requestRepair(true);
    else if (b.dataset.vperr === "retry") void sendChat(t("chat.retryCode"));
  });

  // assets
  $("#assets").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
    const card = (e.target as HTMLElement).closest<HTMLElement>(".asset");
    if (!b || !card) return;
    void assetAction(card.dataset.id!, b.dataset.a!);
  });
  $("#upIn").addEventListener("change", () => void onUploadChosen());

  // flow panel (delegated)
  const flow = $("#flow");
  flow.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const tab = el.closest<HTMLElement>("[data-ptab]");
    if (tab) {
      if (S.ptab !== tab.dataset.ptab) {
        S.ptab = tab.dataset.ptab as typeof S.ptab;
        tabAnim = true;
        renderFlow();
      }
      return;
    }
    const row = el.closest<HTMLElement>(".fs-row");
    if (row) {
      const i = Number(row.parentElement!.dataset.i);
      S.open = S.open === i ? -1 : i;
      setOpen();
      return;
    }
    const lib = el.closest<HTMLElement>("[data-lib]");
    if (lib) {
      S.lib = lib.dataset.lib!;
      tabAnim = true;
      renderFlow();
      return;
    }
    const view = el.closest<HTMLElement>("[data-view]");
    if (view) return openViewer(view.dataset.view!);
    const li = el.closest<HTMLElement>("[data-listen]");
    if (li) return listen(li.dataset.listen!, li);
    const ver = el.closest<HTMLElement>("[data-ver]");
    if (ver) {
      void patchProject({ currentVersion: Number(ver.dataset.ver) }).then((p) => p && toast(t("guide.versionRestored", { n: ver.dataset.ver! })));
      return;
    }
    const cs = el.closest<HTMLElement>("[data-cs]");
    if (cs) {
      void patchProject({ cinematicStyle: cs.dataset.cs }).then(() => renderFlow());
      return;
    }
    if (el.closest("#cinePlay")) playCine();
  });
  flow.addEventListener("input", (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.tune) onTune(inp);
  });
  flow.addEventListener("change", (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.id === "cineAuto") {
      void patchProject({ cineAuto: inp.checked });
      toast(inp.checked ? t("cine.on") : t("cine.off"));
    } else if (inp.dataset.line !== undefined) {
      const lines = $$<HTMLInputElement>("[data-line]", flow).map((x) => x.value.trim());
      void patchProject({ cinematicLines: lines });
    }
  });

  // chat
  $("#dockForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>("#dockIn");
    const v = inp.value;
    inp.value = "";
    void sendChat(v);
  });
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>("#chatIn");
    const v = inp.value;
    inp.value = "";
    void sendChat(v);
  });
  $("#chatFab").addEventListener("click", () => (chatOpen() ? closeChat() : openChat()));
  $("#chatClose").addEventListener("click", closeChat);
  $("#chatTip").addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "chatTipX") {
      $("#chatTip").hidden = true;
      return;
    }
    openChat();
  });
  $("#chatIn").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeChat();
    }
  });
  $("#dockLog").addEventListener("scroll", railUpdate, { passive: true });
  {
    const rail = $("#dockRail"),
      d = $("#dockLog");
    let drag = false;
    const toScroll = (y: number) => {
      const r = rail.getBoundingClientRect(),
        th = $("#dockThumb").offsetHeight;
      const k = clamp((y - r.top - th / 2) / (r.height - th), 0, 1);
      d.style.scrollBehavior = "auto";
      d.scrollTop = k * (d.scrollHeight - d.clientHeight);
    };
    rail.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      rail.setPointerCapture(e.pointerId);
      rail.classList.add("drag");
      drag = true;
      toScroll(e.clientY);
    });
    rail.addEventListener("pointermove", (e) => drag && toScroll(e.clientY));
    const up = () => {
      drag = false;
      rail.classList.remove("drag");
      d.style.scrollBehavior = "";
    };
    rail.addEventListener("pointerup", up);
    rail.addEventListener("pointercancel", up);
  }

  // viewer
  $("#avClose").addEventListener("click", closeViewer, { signal });
  $("#av").addEventListener(
    "click",
    (e) => {
      if (e.target === $("#av")) closeViewer();
    },
    { signal },
  );
  $("#avPlayBtn").addEventListener(
    "click",
    () => {
      if (!AV.audio) return;
      if (AV.audio.paused) void AV.audio.play().catch(() => {});
      else AV.audio.pause();
      setTimeout(avPlayBtn, 30);
    },
    { signal },
  );
  $("#avRegen").addEventListener(
    "click",
    () => {
      const v = $<HTMLTextAreaElement>("#avPrompt").value.trim();
      if (AV.id) void regenerate(AV.id, v || undefined);
    },
    { signal },
  );
  $("#avActs").addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ava]");
      if (!b || !AV.id) return;
      if (b.dataset.ava === "like") void assetAction(AV.id, "like").then(fillViewer);
      else if (b.dataset.ava === "up") startUpload(AV.id);
      else if (b.dataset.ava === "useRev") void useAssetRev(AV.viewRev);
    },
    { signal },
  );
  // Delegate on the dialog so clicks survive remounts / innerHTML refreshes of #avRevs.
  $("#av").addEventListener(
    "click",
    (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-arev]");
      if (!b || !AV.id) return;
      e.preventDefault();
      e.stopPropagation();
      const n = Number(b.getAttribute("data-arev"));
      if (!Number.isFinite(n) || n < 1 || n === AV.viewRev) return;
      AV.viewRev = n;
      fillViewer();
    },
    { capture: true, signal },
  );
  $("#av").addEventListener(
    "dblclick",
    (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-arev]");
      if (!b || !AV.id) return;
      e.preventDefault();
      e.stopPropagation();
      const n = Number(b.getAttribute("data-arev"));
      if (!Number.isFinite(n) || n < 1) return;
      AV.viewRev = n;
      void useAssetRev(n);
    },
    { capture: true, signal },
  );

  $("#usageBtn")?.addEventListener("click", () => openUsagePop(), { signal });
  $("#usagePopX")?.addEventListener("click", () => closeUsagePop(), { signal });
  $("#usagePop")?.addEventListener(
    "click",
    (e) => {
      if (e.target === $("#usagePop")) closeUsagePop();
    },
    { signal },
  );
  $("#assetsToggle")?.addEventListener(
    "click",
    () => {
      S.assetsOpen = !S.assetsOpen;
      syncAssetsCollapse();
    },
    { signal },
  );

  // export modal
  $("#mClose").addEventListener("click", () => ($("#modal").hidden = true));
  $("#dlSrc").addEventListener("click", () => {
    if (!exportBlob) return;
    const a = document.createElement("a");
    a.href = exportBlob.url;
    a.download = exportBlob.name;
    a.click();
  });
  $("#dlWeb").addEventListener("click", () => S.p && window.open(`/play/${S.p.id}`, "_blank", "noopener"));

  // pro
  $("#proBack").addEventListener("click", closePro);
  $("#proHome").addEventListener("click", closePro);
  const goFeat = () => $("#proFeat").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#proWhat").addEventListener("click", goFeat);
  $("#proWhat2").addEventListener("click", goFeat);
  const proSign = () => toast(t("pro.toast"));
  $("#proSign").addEventListener("click", proSign);
  $("#proSign2").addEventListener("click", proSign);
  $("#proImport").addEventListener("click", () => toast(t("pro.importToast", { title: esc(design()?.title || t("guide.yourGame")) })));

  // tour
  $("#tourNext").addEventListener("click", () => tourGo(1));
  $("#tourBack").addEventListener("click", () => tourGo(-1));
  $("#tourSkip").addEventListener("click", endTour);
  $("#tourDots").addEventListener("click", (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>("i");
    if (d) {
      tourI = Number(d.dataset.i);
      showTourStep();
    }
  });
  addEventListener("resize", () => {
    if (!$("#tour").hidden) showTourStep(true);
    railUpdate();
  });
  addEventListener(
    "scroll",
    () => {
      if ($("#tour").hidden) return;
      const st = tourSteps()[tourI];
      const el = st?.sel ? document.querySelector<HTMLElement>(st.sel) : null;
      if (el) positionTour(el);
    },
    { passive: true },
  );

  // global keys + game messages
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#tour").hidden) return endTour();
    if (!$("#av").hidden) return closeViewer();
    if (!$("#usagePop").hidden) return closeUsagePop();
    if (!$("#modal").hidden) return void ($("#modal").hidden = true);
    if (chatOpen()) return closeChat();
    if (S.playing) closePlay();
  });
  addEventListener("message", (e) => void onGameMessage(e));

  void initIntro().then(() => {
    const id = new URLSearchParams(location.search).get("p");
    if (id) void openProjectById(id);
    else {
      void syncIntroMascot();
      askIn.focus({ preventScroll: true });
    }
  });
}