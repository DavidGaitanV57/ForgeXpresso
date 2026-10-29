/* Forge Light studio controller: wires the original UI to the generation API (SSE + REST) and the sandboxed game iframe. */
import type { ApiProvider, AssetRecord, AudioAssetSpec, ChatMsg, Dimension, ForgeEvent, ImageAssetSpec, ImageProvider, Job, Project, TuningParam, UsageReport } from "@/lib/types";
import { formatDuration, formatUsd, PROVIDER_LABEL as API_LABEL } from "@/lib/usage";

type Caps = { code: boolean; images: { openai: boolean; minimax: boolean }; defaultImageProvider: ImageProvider; audio: boolean; models3d: boolean };
type ProjectSummary = { id: string; title: string; idea: string; dimension: Dimension; status: Project["status"]; updatedAt: number; thumb: string | null };
type GameMsg = { source: "forge-game"; projectId: string; version: number; type: string; screen?: string; message?: string; stack?: string; phase?: string };

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

const ROLE_LABEL: Record<string, string> = {
  hero: "Héroe", enemy: "Enemigo", npc: "Personaje", collectible: "Coleccionable", hazard: "Peligro", prop: "Objeto", platform: "Plataforma",
  tile: "Bloque", goal: "Meta", background: "Fondo", texture: "Textura", ui: "Interfaz", portrait: "Retrato",
};
const AUDIO_LABEL: Record<string, string> = { music: "Música", sfx: "Efecto de sonido", voice: "Voz" };
const ORDER = ["hero", "enemy", "npc", "collectible", "hazard", "goal", "platform", "tile", "prop", "background", "texture", "portrait", "ui", "model", "music", "voice", "sfx"];
const COVER_ROLES = new Set(["background", "texture", "portrait"]);
const DIM_LABEL: Record<Dimension, string> = { "2d": "2D", "2.5d": "2.5D", "3d": "3D" };
const PROVIDER_LABEL: Record<ImageProvider, string> = { openai: "OpenAI", minimax: "MiniMax" };

const IDEAS: [string, Dimension][] = [
  ["Un plataformero de un zorro ninja que cruza una ciudad neón saltando entre azoteas", "2d"],
  ["Un shoot'em up espacial con jefes gigantes y power-ups de colores", "2d"],
  ["Un plataformero 2.5D en un bosque encantado con luciérnagas y setas que rebotan", "2.5d"],
  ["Un juego de carreras 3D en un desierto con dunas, rampas y turbo", "3d"],
  ["Un explorador 3D en tercera persona que recolecta cristales en ruinas flotantes", "3d"],
];
const TIPS = [
  "El director escribe un documento de diseño antes de tocar una línea de código",
  "Las imágenes, el audio y el código se generan en paralelo",
  "Después podrás pedir cambios con tus palabras, incluso mientras juegas",
  "Marca con “me gusta” los recursos que quieras conservar",
  "Si algo falla al jugar, Forge lo detecta y lo repara solo",
  "Cada cambio crea una versión nueva: puedes volver atrás cuando quieras",
];

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
  debug: false,
  gameVersion: 0,
  gameReady: false,
  gameScreen: "",
  repairAsked: 0,
  sending: false,
  tourSeen: false,
};
const FILE = (a: AssetRecord) => (S.p && a.file ? `/api/files/${S.p.id}/${a.file}` : "");
const assets = () => (S.p ? Object.values(S.p.assets) : []);
const roleOf = (a: AssetRecord) => (a.type === "image" ? (a.spec as ImageAssetSpec).role : a.type === "audio" ? (a.spec as AudioAssetSpec).kind : "model");
const kindOf = (a: AssetRecord) => (a.type === "image" ? ROLE_LABEL[roleOf(a)] || "Imagen" : a.type === "audio" ? AUDIO_LABEL[roleOf(a)] || "Audio" : "Modelo 3D");
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
    showVpErr("Este juego todavía no tiene código. Pide a Forge que lo intente de nuevo.", "retry");
    return;
  }
  if (!force && S.gameVersion === p.currentVersion && fr.getAttribute("src")) return;
  S.gameVersion = p.currentVersion;
  S.gameReady = false;
  S.gameScreen = "";
  hideVpErr();
  fr.src = `/play/${p.id}?v=${p.currentVersion}&t=${Date.now().toString(36)}`;
}
function reloadGameSoon() {
  clearTimeout(reloadT);
  reloadT = setTimeout(() => loadGame(true), 250);
}
function showVpErr(text: string, action?: "repair" | "retry") {
  const el = $("#vpErr");
  el.hidden = false;
  el.innerHTML = `<span title="${esc(text)}">${esc(text)}</span>${action === "repair" ? '<button class="btn small" type="button" data-vperr="repair">Reparar</button>' : action === "retry" ? '<button class="btn small" type="button" data-vperr="retry">Reintentar</button>' : ""}<button class="iconbtn" type="button" data-vperr="x" aria-label="Cerrar" style="width:26px;height:26px">×</button>`;
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
    if (S.debug) postGame({ type: "debug", on: true });
    if (design()?.tuning) postGame({ type: "tuning", tuning: design()!.tuning });
    if (S.playing) postGame({ type: "focus" });
  } else if (m.type === "screen") {
    S.gameScreen = m.screen || "";
  } else if (m.type === "win") {
    chatHint("¡Lo lograste! Si quieres más reto, pídeme “haz el nivel más difícil”.");
  } else if (m.type === "lose") {
    chatHint("¿Muy difícil? Dime “más vidas” o “enemigos más lentos” y lo ajusto.");
  } else if (m.type === "error") {
    lastError = { message: m.message || "Error", stack: m.stack || "", phase: m.phase || "runtime" };
    if (m.version !== S.p.currentVersion || jobRunning()) return;
    if (S.repairAsked === m.version) return;
    S.repairAsked = m.version;
    await requestRepair(false);
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
      dockHint("Encontré un error en el juego y lo estoy reparando…");
    } else if (r.reason === "limit") {
      showVpErr(`El juego tiene un error: ${lastError.message}`, "repair");
    } else if (r.reason === "busy") {
      S.repairAsked = 0;
    }
  } catch (err) {
    showVpErr(`No pude reparar el juego: ${(err as Error).message}`, "repair");
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
      if (S.screen === "studio" && S.ptab === "guia") renderFlow();
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
async function initIntro() {
  try {
    S.caps = await api<Caps>("/api/config");
  } catch {
    S.caps = null;
  }
  const c = S.caps;
  if (c) {
    S.provider = c.images[c.defaultImageProvider] ? c.defaultImageProvider : c.images.openai ? "openai" : c.images.minimax ? "minimax" : c.defaultImageProvider;
    const chip = (ok: boolean, label: string, req = false) => `<span class="${ok ? "ok" : ""} ${req ? "req" : ""}" title="${ok ? "Configurado" : "Falta la clave en .env.local"}"><i></i>${label}</span>`;
    $("#keysStatus").innerHTML =
      chip(c.code, "Claude · código", true) + chip(c.images.openai, "OpenAI · imágenes") + chip(c.images.minimax, "MiniMax · imágenes") + chip(c.audio, "ElevenLabs · audio") + chip(c.models3d, "Tripo · 3D");
    $("#agentTxt").textContent = c.code ? "Director de juego · listo" : "Falta ANTHROPIC_API_KEY en .env.local";
    $("#agentDot").style.background = c.code ? "" : "var(--rose)";
  }
  renderProvider();
  $("#sugs").innerHTML = IDEAS.map(([t, d], i) => `<button type="button" data-i="${i}">${DIM_LABEL[d]} · ${esc(t.split(" ").slice(0, 5).join(" "))}…</button>`).join("");
  void loadProjects();
}
function renderProvider() {
  $$("#provSw button").forEach((b) => {
    const pv = b.dataset.p as ImageProvider;
    b.classList.toggle("on", pv === S.provider);
    b.classList.toggle("na", !!S.caps && !S.caps.images[pv]);
    b.title = S.caps && !S.caps.images[pv] ? "Sin clave configurada: las imágenes se omitirán" : `Imágenes con ${PROVIDER_LABEL[pv]}`;
  });
}
function setIntroDim(d: Dimension) {
  S.dim = d;
  $$(".dimsw:not(.prov) button").forEach((x) => x.classList.toggle("on", x.dataset.d === d));
}
async function loadProjects() {
  try {
    const list = await api<ProjectSummary[]>("/api/projects");
    const box = $("#projects");
    box.hidden = !list.length;
    $("#projGrid").innerHTML = list
      .slice(0, 12)
      .map(
        (p, j) => `<div class="pj" role="button" tabindex="0" data-id="${esc(p.id)}" style="--j:${j}">
        <div class="th" style="${p.thumb ? `background-image:url('${esc(p.thumb)}');background-size:contain` : ""}">${p.thumb ? "" : DIM_LABEL[p.dimension]}</div>
        <b title="${esc(p.idea)}">${esc(p.title)}</b><small>${DIM_LABEL[p.dimension]} · ${p.status === "generating" ? "Generando…" : p.status === "error" ? "Con error" : new Date(p.updatedAt).toLocaleDateString()}</small>
        <button type="button" class="del" data-del="${esc(p.id)}" title="Eliminar" aria-label="Eliminar juego">×</button></div>`,
      )
      .join("");
  } catch {}
}
async function createGame(idea: string) {
  if (S.caps && !S.caps.code) {
    toast("Configura <b>ANTHROPIC_API_KEY</b> en <b>.env.local</b> y reinicia el servidor", 5000);
    return;
  }
  const btn = $<HTMLButtonElement>("#askSend");
  btn.disabled = true;
  try {
    const p = await api<Project>("/api/projects", { method: "POST", json: { idea, dimension: S.dim, imageProvider: S.provider } });
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
    history.replaceState(null, "", "/");
  }
}
function openProject(p: Project) {
  S.p = p;
  S.gameVersion = 0;
  S.repairAsked = 0;
  history.replaceState(null, "", `/?p=${encodeURIComponent(p.id)}`);
  connect(p.id);
  $("#intro").hidden = true;
  $("#intro").classList.remove("leaving");
  const creating = p.status !== "ready" || (p.job?.kind === "create" && !p.job.finishedAt);
  if (creating || !p.versions.length) runLoader();
  else enterStudio(null);
}

/* ================= Loader ================= */
const LD = { raf: 0, t0: 0, shown: 0, target: 0, stageT: {} as Record<string, number>, tipTimer: 0 as unknown as ReturnType<typeof setInterval>, gallery: [] as string[], galI: 0, galT: 0, finishing: false, typed: "" };
function runLoader() {
  S.screen = "loader";
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
  $("#ldEyebrow").textContent = "Los agentes están forjando tu juego";
  let tipI = Math.floor(Math.random() * TIPS.length);
  const showTip = () => ($("#ldTip").innerHTML = `<span>Consejo · ${esc(TIPS[tipI++ % TIPS.length])}</span>`);
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
  setLoaderTitle(p.design ? `Forjando ${p.design.title}` : "Forjando tu juego");
  const job = p.job?.kind === "create" ? p.job : undefined;
  const stages = job?.stages || [{ id: "director", label: "Director de juego", status: "run" as const, detail: "Leyendo tu idea" }];
  const ol = $("#ldSteps");
  if (ol.children.length !== stages.length) {
    ol.innerHTML = stages
      .map((s, j) => `<li style="--i:${j}" data-id="${s.id}"><span class="ic"></span><div style="min-width:0"><b>${esc(s.label)}</b><small></small></div><em></em></li>`)
      .join("");
  }
  stages.forEach((s, j) => {
    const li = ol.children[j] as HTMLElement;
    const cls = s.status === "wait" ? "" : s.status;
    if (li.className !== cls) li.className = cls;
    li.querySelector("small")!.textContent = s.detail || (s.status === "skip" ? "Omitido (sin clave)" : "");
    const t0 = LD.stageT[s.id];
    if (s.status === "run" && !t0) LD.stageT[s.id] = performance.now();
    if ((s.status === "ok" || s.status === "error") && t0 && !li.dataset.done) {
      li.dataset.done = "1";
      li.querySelector("em")!.textContent = `${((performance.now() - t0) / 1000).toFixed(0)} s`;
    }
  });
  const cur = stages.find((s) => s.status === "run");
  $("#ldTag").querySelector("span")!.textContent = p.status === "ready" ? "Listo para jugar" : cur ? `${cur.label}…` : p.status === "error" ? "Detenido" : "Preparando…";
  $("#ldTag").classList.toggle("ok", p.status === "ready");
  LD.target = p.status === "ready" ? 1 : jobProgress(job);
  const errBox = $("#ldError");
  if (p.status === "error" && !jobRunning()) {
    errBox.hidden = false;
    errBox.innerHTML = `<p><b>No se pudo terminar el juego.</b> ${esc(p.job?.error || "Error desconocido")}</p><button class="btn small primary-s" type="button" id="ldRetry">Reintentar</button>`;
    $("#ldEyebrow").textContent = "La forja se detuvo";
  } else errBox.hidden = true;
  renderUsageReport();
  renderLoaderAssets();
}
function usageHTML(report: UsageReport | undefined, opts?: { title?: string; live?: boolean }) {
  if (!report || (!report.totals.calls && !Object.keys(report.byProvider).length)) {
    return `<div class="ur-head"><b>${esc(opts?.title || "Consumo de APIs")}</b><span>—</span></div><p class="ur-note">Aún no hay mediciones. El reporte se llena en vivo en generados nuevos.</p>`;
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
  return `<div class="ur-head"><b>${esc(opts?.title || "Consumo de APIs")}</b><span>${opts?.live && !report.finishedAt ? "en vivo · " : ""}${formatDuration(wall)}</span></div>
    <div class="ur-grid">${rows
      .map(
        (u) =>
          `<div class="ur-row"><strong>${esc(API_LABEL[u.provider])}</strong><em>${formatUsd(u.estimatedUsd)}</em><small>${esc(bits(u))}</small></div>`,
      )
      .join("")}</div>
    <div class="ur-total"><span>Total estimado</span><b>${formatUsd(report.totals.estimatedUsd)}</b>
      <p class="ur-note">Costos estimados a partir de tarifas públicas (tokens reales de Claude; imágenes/audio/3D aproximados). Revisa la factura de cada proveedor para el monto exacto.</p></div>`;
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
  box.innerHTML = usageHTML(report, { title: "Consumo de esta forja", live: true });
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
    el.innerHTML = `<div class="la-in"><div class="thumb">${thumbHTML(a)}</div><div class="k">${esc(kindOf(a))}${a.status === "generating" ? " · …" : a.status === "error" ? " · error" : a.status === "skipped" ? " · omitido" : ""}</div><div class="nm" title="${esc(a.error || a.name)}">${esc(a.name)}</div></div>`;
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
    const t = (now - LD.t0) / 1000;
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
    mas.style.transform = `translateY(${(-Math.abs(Math.sin(t * sp)) * amp).toFixed(1)}px) rotate(${(Math.sin(t * sp * 0.5) * rot).toFixed(1)}deg)`;
    if (LD.gallery.length > 1 && now - LD.galT > 3200) showGallery((LD.galI + 1) % LD.gallery.length);
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ectx.clearRect(0, 0, ec.width, ec.height);
    const ew = ld.clientWidth,
      eh = ld.clientHeight;
    if (embers.length < 70 && Math.random() < 0.6) embers.push({ x: Math.random() * ew, y: eh + 10, vy: 30 + Math.random() * 60, vx: (Math.random() - 0.5) * 20, r: 1 + Math.random() * 2.4, l: 0, ml: 3 + Math.random() * 4, ph: Math.random() * 6 });
    for (let k = embers.length - 1; k >= 0; k--) {
      const m = embers[k];
      m.l += dt;
      m.y -= m.vy * dt;
      m.x += m.vx * dt + Math.sin(t * 2 + m.ph) * 0.3;
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
  $("#ldEyebrow").textContent = "Tu juego está listo";
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
  S.screen = "studio";
  S.ptab = "guia";
  S.open = -1;
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
      else dockHint("Tu juego está listo. Juega en el visor o pídeme cambios aquí.");
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
}
function renderTop() {
  const p = S.p,
    d = design();
  if (!p) return;
  const title = d?.title || p.idea.slice(0, 40);
  $("#bnEyebrow").textContent = d ? `${d.genre} · ${DIM_LABEL[d.dimension]} · ${d.engine === "phaser" ? "Phaser" : "Three.js + Rapier"}` : DIM_LABEL[p.dimension];
  $("#stHero").textContent = title;
  $("#stIdea").textContent = d?.tagline || `“${p.idea}”`;
  $("#stIdea").title = p.idea;
  $("#projName").textContent = title;
  $("#playTitle").textContent = title;
  $("#loopPill").textContent = d?.genre || "Juego";
  $("#verPill").textContent = `Versión ${p.currentVersion || 0}`;
  document.title = `${title} · Forge`;
}
function renderBusy() {
  const job = S.p?.job;
  const box = $("#vpBusy");
  const running = !!job && !job.finishedAt && job.kind !== "create";
  box.hidden = !running;
  if (!running) return;
  const cur = job!.stages.find((s) => s.status === "run") || job!.stages.find((s) => s.status === "wait");
  $("#vpBusyT").textContent = job!.kind === "repair" ? "Forge está reparando un error…" : job!.kind === "asset" ? "Regenerando un recurso…" : "Forge está aplicando tus cambios…";
  $("#vpBusyS").textContent = cur ? `${cur.label}${cur.detail ? ` · ${cur.detail}` : ""}` : "";
  box.classList.toggle("full", !S.p?.versions.length);
}

/* ---------- Asset cards ---------- */
function cardHTML(a: AssetRecord, i: number) {
  const v = a.liked || 0;
  const url = FILE(a);
  const st = a.status;
  const badge = st === "generating" ? "Generando…" : st === "error" ? "Error" : st === "skipped" ? "Sin clave" : st === "pending" ? "En cola" : "";
  return `<div class="asset ${v > 0 ? "liked" : v < 0 ? "disliked" : ""} ${st}" data-id="${esc(a.id)}" style="--ai:${i}">
    <div class="tw"><button type="button" class="tv" data-a="view" aria-label="Ver ${esc(a.name)} en grande">${thumbHTML(a)}${badge ? `<span class="st-badge ${st}">${badge}</span>` : ""}</button>
    <div class="tb"><button type="button" data-a="upload" title="Subir tu propio archivo" aria-label="Subir archivo">${ICUP}</button>${url ? `<a href="${esc(url)}" download="${esc(a.id)}.${esc((a.file || "").split(".").pop())}" title="Descargar" aria-label="Descargar">${ICDN}</a>` : ""}</div></div>
    <div><div class="k">${esc(kindOf(a))}${a.custom ? '<span class="upl">· Tuyo</span>' : ""}${v > 0 ? ' · <span class="likebadge">Favorito</span>' : ""}</div><div class="nm" title="${esc(a.error || a.name)}">${esc(a.name)}</div></div>
    <div class="tg">${a.provider ? `<span>${esc(a.provider)}</span>` : ""}${a.type === "audio" ? `<span>${(a.spec as AudioAssetSpec).durationSec}s</span>` : ""}</div>
    <div class="acts"><button type="button" data-a="regen" title="Generar otra versión" aria-label="Regenerar">${ICON.swap}<span class="tx">Regenerar</span></button><button type="button" class="up" data-a="like" title="Me gusta" aria-label="Me gusta">${ICON.up}</button><button type="button" data-a="dislike" title="No me gusta: generar otro" aria-label="No me gusta">${ICON.down}</button></div></div>`;
}
function renderAssets() {
  const list = sorted(assets());
  $("#assets").innerHTML = list.length ? list.map((a, i) => cardHTML(a, i)).join("") : '<div class="empty-n">Aún no hay recursos.</div>';
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
    if (v) toast(`<b>${esc(a.name)}</b> guardado como favorito`);
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
  if (a.type === "image" && S.caps && !S.caps.images[p.imageProvider] && !S.caps.images.openai && !S.caps.images.minimax) return toast("No hay clave de <b>OpenAI</b> ni de <b>MiniMax</b> configurada");
  if (a.type === "audio" && S.caps && !S.caps.audio) return toast("Falta <b>ELEVENLABS_API_KEY</b> para generar audio");
  if (a.type === "model" && S.caps && !S.caps.models3d) return toast("Falta <b>TRIPO_API_KEY</b> para generar modelos 3D");
  try {
    await api(`/api/projects/${p.id}/assets/${id}`, { method: "POST", json: { action: "regenerate", prompt } });
    toast(`Regenerando <b>${esc(a.name)}</b>…`);
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
  if (f.size > 25 * 1024 * 1024) return toast("Ese archivo pesa más de 25 MB. Prueba con uno más liviano.");
  const fd = new FormData();
  fd.append("file", f);
  toast(`Subiendo <b>${esc(f.name)}</b>…`);
  try {
    await api(`/api/projects/${S.p.id}/assets/${id}`, { method: "PUT", body: fd });
    toast(`<b>${esc(f.name)}</b> ya está en el juego`);
  } catch (e) {
    toast(esc((e as Error).message), 4000);
  }
}

/* ---------- Flow panel ---------- */
const PTABS: [typeof S.ptab, string][] = [
  ["guia", "Guía"],
  ["recursos", "Recursos"],
  ["cine", "Cinemática"],
];
const LIBTABS: [string, string, (a: AssetRecord) => boolean][] = [
  ["chars", "Personajes", (a) => a.type === "image" && ["hero", "enemy", "npc", "portrait"].includes(roleOf(a))],
  ["objs", "Objetos", (a) => a.type === "image" && ["collectible", "hazard", "prop", "goal", "platform", "tile", "ui"].includes(roleOf(a))],
  ["bgs", "Fondos", (a) => a.type === "image" && ["background", "texture"].includes(roleOf(a))],
  ["m3d", "3D", (a) => a.type === "model"],
  ["audio", "Audio", (a) => a.type === "audio"],
];
let tabAnim = false;
function guideHTML() {
  const p = S.p!,
    d = design();
  const sections: { name: string; detail: string; body: string }[] = [];
  sections.push({
    name: "Tu idea",
    detail: `“${p.idea}”`,
    body: `<div class="dz"><p>${esc(p.idea)}</p><div class="dz-row"><span>${DIM_LABEL[p.dimension]}</span><span>${d?.engine === "phaser" ? "Phaser 3" : "Three.js + Rapier"}</span>${d ? `<span>${esc(d.camera)}</span>` : ""}</div>
      <div class="lbl">Proveedor de imágenes para nuevos recursos</div>
      <div class="presets">${(["openai", "minimax"] as ImageProvider[]).map((pv) => `<button type="button" class="preset ${p.imageProvider === pv ? "on" : ""}" data-prov="${pv}" ${S.caps && !S.caps.images[pv] ? 'title="Sin clave configurada"' : ""}>${PROVIDER_LABEL[pv]}${S.caps && !S.caps.images[pv] ? " · sin clave" : ""}</button>`).join("")}</div></div>`,
  });
  if (d) {
    sections.push({
      name: "Diseño del juego",
      detail: d.genre,
      body: `<div class="dz"><p><b>${esc(d.title)}</b> — ${esc(d.tagline)}</p>
        <div class="lbl">Objetivo</div><div class="goal">${esc(d.objective)}</div>
        <div class="lbl">Mecánicas</div><ul>${d.mechanics.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
        <div class="lbl">Controles</div><div class="keys">${d.controls.map((c) => `<div><kbd>${esc(c.input)}</kbd>${esc(c.action)}</div>`).join("")}</div>
        <div class="lbl">Nivel</div><p>${esc(d.levelOutline)}</p>
        <div class="lbl">Estilo visual</div><p>${esc(d.artStyle)}</p><div class="dz-row">${d.palette.map((c) => `<span style="background:${esc(c)};color:transparent;width:22px" title="${esc(c)}">.</span>`).join("")}</div></div>`,
    });
    sections.push({
      name: "Ajustes en vivo",
      detail: `${d.tuning.length} parámetros`,
      body: `<p>Cambia la jugabilidad sin recargar el juego. También puedes pedirlo en el chat: “salta más alto”.</p><div class="tune">${d.tuning
        .map((t) => {
          const step = t.max - t.min > 20 ? 1 : (t.max - t.min) / 100;
          return `<div class="tune-r"><label for="tn-${esc(t.key)}" title="${esc(t.key)}">${esc(t.label)}</label><output id="tno-${esc(t.key)}">${fmt(t.value)}</output><input type="range" id="tn-${esc(t.key)}" data-tune="${esc(t.key)}" min="${t.min}" max="${t.max}" step="${step}" value="${t.value}"></div>`;
        })
        .join("")}</div>`,
    });
  }
  sections.push({
    name: "Versiones",
    detail: `${p.versions.length} guardadas · actual v${p.currentVersion}`,
    body: `<div class="vers">${p.versions
      .slice()
      .reverse()
      .map(
        (v) =>
          `<div class="ver ${v.n === p.currentVersion ? "on" : ""}"><b>v${v.n}</b><span title="${esc(v.note)}">${esc(v.note)} · ${new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>${v.n === p.currentVersion ? '<em class="likebadge">En uso</em>' : `<button type="button" data-ver="${v.n}">Usar</button>`}</div>`,
      )
      .join("")}</div>`,
  });
  const jobU = p.jobUsage;
  const allU = p.usage;
  const hasJob = !!jobU && (jobU.totals.calls > 0 || Object.keys(jobU.byProvider).length > 0);
  const hasAll = !!allU && (allU.totals.calls > 0 || Object.keys(allU.byProvider).length > 0);
  sections.push({
    name: "Consumo de APIs",
    detail: hasAll ? `${formatUsd(allU!.totals.estimatedUsd)} · ${formatDuration((allU!.finishedAt ?? Date.now()) - allU!.startedAt)}` : hasJob ? formatUsd(jobU!.totals.estimatedUsd) : "sin datos aún",
    body: `<div class="usage-card">${usageHTML(hasJob ? jobU : allU, { title: hasJob ? "Último trabajo" : "Consumo del proyecto" })}</div>
      ${hasJob && hasAll && allU !== jobU ? `<div class="usage-card" style="margin-top:10px">${usageHTML(allU, { title: "Acumulado del proyecto" })}</div>` : ""}
      ${!hasJob && !hasAll ? `<p class="ur-note">Esta partida se generó antes del medidor. Los próximos trabajos mostrarán tokens, costo estimado y tiempos por API.</p>` : ""}`,
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
  const tab = LIBTABS.find((t) => t[0] === S.lib) || LIBTABS[0];
  const items = sorted(assets().filter(tab[2]));
  let note = "";
  if (S.lib === "m3d" && !S.caps?.models3d)
    note = `<div class="lockn">${LOCK}Añade TRIPO_API_KEY para generar modelos 3D con IA. Mientras tanto, los juegos 2.5D/3D usan geometría procedural con texturas generadas.</div>`;
  if (S.lib === "audio" && !S.caps?.audio) note = `<div class="lockn">${LOCK}Añade ELEVENLABS_API_KEY para generar música, efectos y voz. Sin ella el juego usa sonidos sintetizados.</div>`;
  return `<div class="lib-h"><div class="ctabs" role="tablist">${LIBTABS.map(([id, n]) => `<button type="button" class="${S.lib === id ? "on" : ""}" data-lib="${id}">${n}</button>`).join("")}</div>
    <div class="lib-meta"><span>${items.length} recurso${items.length === 1 ? "" : "s"}</span></div></div>
    ${items.length ? `<div class="lib-grid">${items
      .map(
        (a, j) => `<div class="li ${a.liked === 1 ? "on" : ""}" style="--j:${j}" data-id="${esc(a.id)}"><div class="li-t"><button type="button" class="tv" data-view="${esc(a.id)}" aria-label="Ver ${esc(a.name)}">${thumbHTML(a)}</button>${a.type === "model" ? '<span class="li-3d">3D</span>' : ""}</div>
        <b title="${esc(a.name)}">${esc(a.name)}</b><span>${esc(kindOf(a))} · ${a.status === "ready" ? esc(a.provider || "listo") : a.status === "skipped" ? "sin clave" : a.status === "error" ? "error" : "generando"}</span>
        ${a.type === "audio" && a.status === "ready" ? `<button type="button" data-listen="${esc(a.id)}">${ICPLAY}Escuchar</button>` : `<button type="button" data-view="${esc(a.id)}">Ver</button>`}</div>`,
      )
      .join("")}</div>` : '<div class="empty-n">No hay recursos en esta categoría.</div>'}${note}`;
}
const CSTY: [string, string][] = [
  ["epica", "Épica"],
  ["misteriosa", "Misteriosa"],
  ["comica", "Cómica"],
];
function cineHTML() {
  const d = design();
  if (!d) return "<p>La cinemática estará disponible cuando el juego esté listo.</p>";
  const lines = [0, 1, 2].map((i) => d.cinematic.lines[i] || "");
  const voice = assets().find((a) => a.type === "audio" && a.id === "narration");
  return `<div class="cine-h"><span class="mascot" aria-hidden="true"></span><p>Una escena antes de jugar: aparecen los subtítulos${voice?.status === "ready" ? " con la narración generada" : ""} y cierra con el título de tu juego.</p></div>
    <div class="lbl">Estilo</div><div class="presets">${CSTY.map(([id, n]) => `<button type="button" class="preset ${d.cinematic.style === id ? "on" : ""}" data-cs="${id}">${n}</button>`).join("")}</div>
    <div class="lbl">Guion</div><div class="shots">${lines.map((l, i) => `<label class="shot"><em class="mono">Toma ${i + 1}</em><input class="field" data-line="${i}" value="${esc(l)}" maxlength="90"></label>`).join("")}</div>
    ${voice ? `<div class="note">La voz de narración se generó con el guion original. Si cambias el texto, pídele a Forge “regenera la narración”.</div>` : ""}
    <label class="tog"><input type="checkbox" id="cineAuto" ${S.p?.cineAuto ? "checked" : ""}><span class="sw"></span>Mostrar al empezar a jugar</label>
    <button type="button" class="btn primary-s" id="cinePlay">${ICPLAY}Reproducir cinemática</button>`;
}
function renderFlow() {
  const f = $("#flow");
  if (!S.p) return;
  const body = S.ptab === "recursos" ? libHTML() : S.ptab === "cine" ? cineHTML() : guideHTML();
  f.innerHTML = `<div class="flowbox"><div class="ptabs" role="tablist">${PTABS.map(([id, n]) => `<button type="button" role="tab" class="${S.ptab === id ? "on" : ""}" aria-selected="${S.ptab === id}" data-ptab="${id}">${n}</button>`).join("")}<i class="ptab-ink" style="--x:${PTABS.findIndex((t) => t[0] === S.ptab)}"></i></div><div class="tabc ${tabAnim ? "anim" : ""}">${body}</div></div>`;
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
  if (!S.gameReady) return toast("Espera a que el juego termine de cargar");
  postGame({ type: "cinematic", lines: d.cinematic.lines, title: d.title });
}

/* ---------- Chat ---------- */
const chatOpen = () => !$("#chatWin").hidden;
function msgHTML(l: Pick<ChatMsg, "who" | "text" | "tags">, thinking = false) {
  return `<div class="msg ${l.who}">${l.who === "forge" ? '<span class="mascot ava" aria-hidden="true"></span>' : ""}<div class="mb ${thinking ? "thinking" : ""}">${esc(l.text)}${l.tags?.length ? `<div class="tagrow">${l.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}</div></div>`;
}
function renderChat() {
  const p = S.p;
  if (!p) return;
  const job = p.job;
  const thinking = !!job && !job.finishedAt && job.kind === "chat";
  const cur = thinking ? job!.stages.find((s) => s.status === "run") : null;
  const html =
    p.chat.map((l) => msgHTML(l)).join("") + (thinking ? msgHTML({ who: "forge", text: cur ? `${cur.label}${cur.detail ? ` · ${cur.detail}` : ""}` : "Pensando…" }, true) : "");
  const d = $("#dockLog");
  d.innerHTML = html || msgHTML({ who: "forge", text: "Hola, soy Forge. Pídeme cambios con tus palabras y los aplico al juego." });
  d.scrollTop = d.scrollHeight;
  railUpdate();
  setTimeout(railUpdate, 350);
  const lg = $("#chatLog");
  lg.innerHTML = d.innerHTML;
  lg.scrollTop = lg.scrollHeight;
  $("#chatCtx").innerHTML = S.playing
    ? `<span class="ctx-chip">En partida</span>Los ajustes se aplican al instante; los cambios de código recargan el juego.`
    : `<span class="ctx-chip">${esc(design()?.title || "")}</span>${esc(design()?.genre || "")}`;
}
async function sendChat(text: string) {
  text = text.trim();
  if (!text || !S.p) return;
  if (jobRunning()) return toast("Forge sigue trabajando en el cambio anterior. Espera un momento.");
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
  if (S.gameScreen === "start") postGame({ type: "start" });
  renderChat();
  setTimeout(() => chatHint("¿Muy difícil o muy fácil? Dime “salta más alto” o “más lento” y lo ajusto en vivo."), 1600);
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
    b.classList.toggle("on", on);
    const w = b.querySelector<SVGElement>("#sndWave, .sndWave2");
    if (w) w.style.display = on ? "" : "none";
  }
  postGame({ type: "mute", on: !on });
}

/* ---------- Asset viewer ---------- */
const AV = { id: "" as string, audio: null as HTMLAudioElement | null, three: null as null | { dispose: () => void } };
function openViewer(id: string) {
  const a = S.p?.assets[id];
  if (!a) return;
  AV.id = id;
  const av = $("#av");
  av.hidden = false;
  av.classList.remove("closing");
  fillViewer();
  setTimeout(() => $("#avClose").focus({ preventScroll: true }), 50);
}
function fillViewer() {
  const a = S.p?.assets[AV.id];
  if (!a) return;
  const url = FILE(a);
  $("#avKind").textContent = kindOf(a);
  $("#avName").textContent = a.name;
  const spec = a.spec as ImageAssetSpec & AudioAssetSpec;
  const tags = [a.provider, a.custom ? "Subido por ti" : "", a.liked === 1 ? "Favorito" : "", `rev ${a.rev}`].filter(Boolean) as string[];
  $("#avTags").innerHTML = tags.map((t) => `<span>${esc(t)}</span>`).join("");
  const rows: [string, string][] = [["Estado", { ready: "Listo", generating: "Generando…", pending: "En cola", error: "Error", skipped: "Omitido (sin clave)" }[a.status]]];
  if (a.type === "image") rows.push(["Rol", ROLE_LABEL[spec.role] || spec.role], ["Formato", `${spec.aspect}${spec.transparent ? " · transparente" : ""}`]);
  if (a.type === "audio") rows.push(["Tipo", AUDIO_LABEL[spec.kind]], ["Duración", `${spec.durationSec} s${spec.loop ? " · bucle" : ""}`]);
  if (a.mime) rows.push(["Archivo", a.mime]);
  $("#avSpec").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("") + (a.spec.usage ? `<dt>Uso</dt><dd style="text-align:left;font-family:inherit">${esc(a.spec.usage)}</dd>` : "");
  const pr = $<HTMLTextAreaElement>("#avPrompt");
  if (document.activeElement !== pr) pr.value = a.spec.prompt || "";
  $("#avNote").textContent = a.error ? `Último error: ${a.error}` : a.status === "generating" ? "Generando una nueva versión…" : "Edita la descripción y regenera; el juego se recargará con el nuevo recurso.";
  $<HTMLButtonElement>("#avRegen").disabled = a.status === "generating";
  $("#avActs").innerHTML = `<button type="button" class="btn small" data-ava="like">${ICON.up}${a.liked === 1 ? "Quitar favorito" : "Me gusta"}</button><button type="button" class="btn small" data-ava="up">${ICUP}Subir el mío</button>${url ? `<a class="btn small" href="${esc(url)}" download="${esc(a.id)}.${esc((a.file || "").split(".").pop())}">${ICDN}Descargar</a>` : ""}`;
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
    $("#avLoadT").textContent = a.status === "generating" || a.status === "pending" ? "Generando…" : a.status === "skipped" ? "Sin clave de API: se usa un marcador" : "No disponible";
    return;
  }
  if (a.type === "image") {
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
    $("#avHint").textContent = "Arrastra para girar · rueda para acercar";
    void viewModel(url, c3);
  }
}
function avPlayBtn() {
  const playing = !!AV.audio && !AV.audio.paused;
  $("#avPlayBtn").innerHTML = `${playing ? ICSTOP : ICPLAY}${playing ? "Detener" : "Escuchar"}`;
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
  $("#avLoadT").textContent = "Cargando modelo…";
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
    $("#avLoadT").textContent = `No pude cargar el modelo: ${(e as Error).message}`;
  }
}
function stopViewerMedia() {
  AV.audio?.pause();
  AV.audio = null;
  AV.three?.dispose();
  AV.three = null;
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
  if (libAudio && !libAudio.paused && libAudio.dataset.id === id) {
    libAudio.pause();
    btn.innerHTML = `${ICPLAY}Escuchar`;
    return;
  }
  libAudio?.pause();
  $$("[data-listen]").forEach((b) => (b.innerHTML = `${ICPLAY}Escuchar`));
  libAudio = new Audio(FILE(a));
  libAudio.dataset.id = id;
  libAudio.play().catch(() => {});
  libAudio.addEventListener("ended", () => (btn.innerHTML = `${ICPLAY}Escuchar`));
  btn.innerHTML = `${ICSTOP}Detener`;
}

/* ---------- Export ---------- */
let exportBlob: { url: string; name: string } | null = null;
async function openExport() {
  if (!S.p) return;
  if (S.playing) closePlay(true);
  const m = $("#modal");
  m.hidden = false;
  const st = ["Reuniendo código y recursos", "Empaquetando motor y runtime", "Comprimiendo el paquete"];
  $("#mStages").innerHTML = st.map((s) => `<div class="stg"><i></i>${s}</div>`).join("");
  $("#mTitle").textContent = "Empaquetando tu juego";
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
    $("#mTitle").textContent = `Listo · ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
    $<HTMLButtonElement>("#dlSrc").disabled = false;
    $<HTMLButtonElement>("#dlWeb").disabled = false;
  } catch (e) {
    clearInterval(tick);
    $("#mTitle").textContent = "No se pudo exportar";
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
    S.screen = "pro";
    const pro = $("#pro");
    pro.hidden = false;
    pro.classList.remove("leaving");
    const d = design();
    $("#proProj").textContent = d?.title || "";
    $("#proMeta").textContent = `${d?.genre || ""} · ${S.p?.versions.length || 0} versiones · ${assets().filter((a) => a.status === "ready").length} recursos`;
    const imgs = sorted(assets().filter((a) => a.type === "image" && a.status === "ready"));
    const pick = [imgs.find((a) => roleOf(a) === "hero"), imgs.find((a) => roleOf(a) === "background"), imgs.find((a) => !["hero", "background"].includes(roleOf(a)))];
    $$<HTMLElement>(".pc-img").forEach((el, i) => {
      const a = pick[i] || imgs[i];
      el.style.backgroundImage = a ? `url('${FILE(a)}')` : "";
      el.style.backgroundSize = a && COVER_ROLES.has(roleOf(a)) ? "cover" : "contain";
    });
    window.scrollTo(0, 0);
    const bot = $("#proBot") as HTMLElement & { _t?: ReturnType<typeof setInterval> };
    bot.textContent = "";
    const msg = "Listo: 3 conceptos generados. Apruébalos para conectarlos al resto del pipeline.";
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
    S.screen = "studio";
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
const TOUR = [
  { sel: null, t: "Bienvenido a tu estudio", d: "Tu juego ya está creado por el equipo de agentes. En un minuto te muestro dónde está cada cosa. Puedes saltar el recorrido y volver a verlo con el botón de ayuda (?)." },
  { sel: "#vp", t: "El visor: tu juego en vivo", d: "Haz clic en el visor para jugar aquí mismo. Esc pone pausa. El botón ⤢ de la esquina lo abre en pantalla completa." },
  { sel: "#playBtn", t: "Jugar en pantalla completa", d: "Primera jugada sin distracciones, con el chat flotante a mano para pedir ajustes mientras juegas." },
  { sel: "#dock", t: "Chat con Forge", d: "Escribe cambios con tus palabras: “salta más alto”, “añade un jefe final”, “música más épica”. El director decide qué agentes intervienen: ajustes en vivo, nuevo arte, nuevo audio o nuevo código." },
  { sel: ".st-assets", t: "Recursos del juego", d: "Todo lo que generaron los agentes de imagen, audio y 3D. Toca un recurso para verlo, editar su descripción y regenerarlo, marcar si te gusta, subir el tuyo o descargarlo." },
  { sel: "#flow", t: "Panel de creación", d: "Guía: el diseño, los ajustes en vivo y el historial de versiones. Recursos: la biblioteca por categorías. Cinemática: la escena de presentación." },
  { sel: "#exportBtn", t: "Exportar", d: "Descarga el juego completo como paquete HTML5 listo para publicar. A su lado, Abrir en Forge Pro lleva tu proyecto a la versión para estudios." },
  { sel: "#homeBtn", t: "Volver al inicio", d: "Toca el logo para volver al lobby, ver tus juegos guardados y crear otro." },
];
let tourI = 0;
function startTour() {
  tourI = 0;
  const t = $("#tour");
  t.hidden = false;
  t.classList.remove("closing");
  $("#tourDots").innerHTML = TOUR.map((_, i) => `<i data-i="${i}"></i>`).join("");
  showTourStep(true);
}
function endTour() {
  const t = $("#tour");
  if (t.hidden) return;
  t.classList.add("closing");
  setTimeout(() => {
    t.hidden = true;
    t.classList.remove("closing");
  }, 280);
  S.tourSeen = true;
  try {
    localStorage.setItem("forge.tourSeen", "1");
  } catch {}
  dockHint("Cuando quieras, pídeme cambios aquí.");
}
function tourGo(d: number) {
  const n = tourI + d;
  if (n < 0) return;
  if (n >= TOUR.length) return endTour();
  tourI = n;
  showTourStep();
}
function showTourStep(first = false) {
  const st = TOUR[tourI];
  const card = $("#tourCard"),
    spot = $("#tourSpot");
  $("#tourStep").textContent = `${tourI + 1} de ${TOUR.length}`;
  $("#tourT").textContent = st.t;
  $("#tourD").textContent = st.d;
  $<HTMLButtonElement>("#tourBack").disabled = tourI === 0;
  $("#tourNext").textContent = tourI === TOUR.length - 1 ? "Empezar a crear" : "Siguiente";
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
    S.screen = "intro";
    document.title = "Forge Light";
    history.replaceState(null, "", "/");
    const it = $("#intro");
    it.classList.remove("leaving");
    it.classList.add("back");
    it.hidden = false;
    $<HTMLTextAreaElement>("#askIn").value = "";
    $<HTMLButtonElement>("#askSend").disabled = true;
    window.scrollTo(0, 0);
    setTimeout(() => it.classList.remove("back"), 600);
    void loadProjects();
  }, 380);
}

/* ================= Wiring ================= */
let mounted = false;
export function mount() {
  if (mounted) return;
  mounted = true;
  try {
    S.tourSeen = localStorage.getItem("forge.tourSeen") === "1";
  } catch {}
  const askIn = $<HTMLTextAreaElement>("#askIn"),
    askSend = $<HTMLButtonElement>("#askSend");
  askIn.addEventListener("input", () => (askSend.disabled = !askIn.value.trim()));
  askIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (askIn.value.trim()) $<HTMLFormElement>("#askForm").requestSubmit();
    }
  });
  $("#askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = askIn.value.trim();
    if (t) void createGame(t);
  });
  $$(".dimsw:not(.prov) button").forEach((b) => b.addEventListener("click", () => setIntroDim(b.dataset.d as Dimension)));
  $$("#provSw button").forEach((b) =>
    b.addEventListener("click", () => {
      S.provider = b.dataset.p as ImageProvider;
      renderProvider();
      if (S.caps && !S.caps.images[S.provider]) toast(`No hay clave de <b>${PROVIDER_LABEL[S.provider]}</b>: las imágenes se omitirán`);
    }),
  );
  $("#sugs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (!b) return;
    const [t, d] = IDEAS[Number(b.dataset.i)];
    askIn.value = t;
    askSend.disabled = false;
    setIntroDim(d);
    askIn.focus();
  });
  $("#projGrid").addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    const del = t.closest<HTMLElement>("[data-del]");
    if (del) {
      e.stopPropagation();
      if (!confirm("¿Eliminar este juego y todos sus recursos?")) return;
      try {
        await api(`/api/projects/${del.dataset.del}`, { method: "DELETE" });
        void loadProjects();
      } catch (err) {
        toast(esc((err as Error).message));
      }
      return;
    }
    const card = t.closest<HTMLElement>(".pj");
    if (card) {
      $("#intro").classList.add("leaving");
      await sleep(380);
      await openProjectById(card.dataset.id!);
    }
  });
  $("#projGrid").addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.target as HTMLElement).closest<HTMLElement>(".pj")?.click();
  });

  // loader
  $("#ldBack").addEventListener("click", () => {
    toast("La forja sigue en segundo plano. Encontrarás el juego en <b>Tus juegos</b>.");
    goLobby();
  });
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
  $("#dbgBtn").addEventListener("click", () => {
    S.debug = !S.debug;
    $("#dbgBtn").classList.toggle("on", S.debug);
    postGame({ type: "debug", on: S.debug });
    toast(S.debug ? "Depuración: colisiones visibles" : "Depuración desactivada");
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
    else if (b.dataset.vperr === "retry") void sendChat("El juego no tiene código todavía o falló al generarse. Por favor vuelve a programarlo completo.");
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
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-ptab]");
    if (tab) {
      if (S.ptab !== tab.dataset.ptab) {
        S.ptab = tab.dataset.ptab as typeof S.ptab;
        tabAnim = true;
        renderFlow();
      }
      return;
    }
    const row = t.closest<HTMLElement>(".fs-row");
    if (row) {
      const i = Number(row.parentElement!.dataset.i);
      S.open = S.open === i ? -1 : i;
      setOpen();
      return;
    }
    const lib = t.closest<HTMLElement>("[data-lib]");
    if (lib) {
      S.lib = lib.dataset.lib!;
      tabAnim = true;
      renderFlow();
      return;
    }
    const view = t.closest<HTMLElement>("[data-view]");
    if (view) return openViewer(view.dataset.view!);
    const li = t.closest<HTMLElement>("[data-listen]");
    if (li) return listen(li.dataset.listen!, li);
    const ver = t.closest<HTMLElement>("[data-ver]");
    if (ver) {
      void patchProject({ currentVersion: Number(ver.dataset.ver) }).then((p) => p && toast(`Volviste a la <b>versión ${ver.dataset.ver}</b>`));
      return;
    }
    const prov = t.closest<HTMLElement>("[data-prov]");
    if (prov) {
      void patchProject({ imageProvider: prov.dataset.prov }).then(() => renderFlow());
      return;
    }
    const cs = t.closest<HTMLElement>("[data-cs]");
    if (cs) {
      void patchProject({ cinematicStyle: cs.dataset.cs }).then(() => renderFlow());
      return;
    }
    if (t.closest("#cinePlay")) playCine();
  });
  flow.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.tune) onTune(t);
  });
  flow.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "cineAuto") {
      void patchProject({ cineAuto: t.checked });
      toast(t.checked ? "La cinemática se verá al empezar a jugar" : "Cinemática al inicio desactivada");
    } else if (t.dataset.line !== undefined) {
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
  $("#avClose").addEventListener("click", closeViewer);
  $("#av").addEventListener("click", (e) => {
    if (e.target === $("#av")) closeViewer();
  });
  $("#avPlayBtn").addEventListener("click", () => {
    if (!AV.audio) return;
    if (AV.audio.paused) void AV.audio.play().catch(() => {});
    else AV.audio.pause();
    setTimeout(avPlayBtn, 30);
  });
  $("#avRegen").addEventListener("click", () => {
    const v = $<HTMLTextAreaElement>("#avPrompt").value.trim();
    if (AV.id) void regenerate(AV.id, v || undefined);
  });
  $("#avActs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-ava]");
    if (!b || !AV.id) return;
    if (b.dataset.ava === "like") void assetAction(AV.id, "like").then(fillViewer);
    else if (b.dataset.ava === "up") startUpload(AV.id);
  });

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
  const proSign = () => toast("Vista previa: el acceso a <b>Forge Pro</b> es por invitación para estudios");
  $("#proSign").addEventListener("click", proSign);
  $("#proSign2").addEventListener("click", proSign);
  $("#proImport").addEventListener("click", () => toast(`<b>${esc(design()?.title || "Tu juego")}</b> quedará listo para importar cuando tengas acceso a Forge Pro`));

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
      const st = TOUR[tourI];
      const el = st.sel ? document.querySelector<HTMLElement>(st.sel) : null;
      if (el) positionTour(el);
    },
    { passive: true },
  );

  // global keys + game messages
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#tour").hidden) return endTour();
    if (!$("#av").hidden) return closeViewer();
    if (!$("#modal").hidden) return void ($("#modal").hidden = true);
    if (chatOpen()) return closeChat();
    if (S.playing) closePlay();
  });
  addEventListener("message", (e) => void onGameMessage(e));

  void initIntro().then(() => {
    const id = new URLSearchParams(location.search).get("p");
    if (id) void openProjectById(id);
    else askIn.focus({ preventScroll: true });
  });
}