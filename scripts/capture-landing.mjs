/**
 * Captures real Forge Xpresso screenshots for the landing page (one set per locale)
 * by driving headless Edge/Chrome over the DevTools protocol. Needs `npm run dev` running.
 *
 * Usage: node scripts/capture-landing.mjs [--only=name,name] [--locales=es,en,fr]
 * Env:   BASE (default http://localhost:3000), BROWSER (path to msedge/chrome)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const BROWSER =
  process.env.BROWSER ||
  ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(existsSync);
const OUT = join(process.cwd(), "public", "landing");
const PORT = 9333;
const W = 1440,
  H = 900,
  DPR = 1.5;

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",");
const LOCALES = (arg("locales") || "es,en,fr").split(",");

const P = {
  sky: "eea89b8b-c294-4b1c-b7bb-78c9a3aa592b",
  lumi: "356b8829-d8ad-45fe-a686-4b86dbafa280",
  nova: "4bc8fc88-cb4c-48ab-96f4-8b6405461f30",
};
const IDEA = {
  es: "Un zorro ninja que cruza una ciudad neón saltando entre azoteas",
  en: "A ninja fox crossing a neon city by leaping between rooftops",
  fr: "Un renard ninja qui traverse une ville néon en sautant de toit en toit",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- CDP plumbing ---------- */
let ws,
  seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)} → ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result?.value;
}
async function go(path, wait = 2500) {
  await send("Page.navigate", { url: BASE + path });
  await waitFor("document.readyState === 'complete'", 30000);
  await sleep(wait);
}
async function waitFor(expr, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(`!!(${expr})`).catch(() => false)) return true;
    await sleep(150);
  }
  console.warn(`  ! timeout waiting for ${expr}`);
  return false;
}
const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error(${JSON.stringify(`missing ${sel}`)}); el.click(); return true; })()`);
async function shot(loc, name) {
  const { data } = await send("Page.captureScreenshot", { format: "webp", quality: 82 });
  const dir = join(OUT, loc);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.webp`), Buffer.from(data, "base64"));
  console.log(`  ✓ ${loc}/${name}.webp`);
}
async function key(k, code, keyCode) {
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: keyCode });
}

/* ---------- shots ---------- */
// Marketing captures hide operator-only chrome (API cost meter) and the projects' internal dev chat log.
const CLEAN_CSS = "#usageBtn{display:none!important}#dockLog .msg,#chatLog .msg{display:none!important}#dockRail{display:none!important}nextjs-portal{display:none!important}";
const clean = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(CLEAN_CSS)}; document.head.appendChild(s); })()`);
const startGame = () => evaluate(`document.querySelector('#game').contentWindow.postMessage({ source: 'forge-studio', type: 'start' }, '*')`);
const studio = async (id, settle = 9000, play = true) => {
  await go(`/studio?p=${id}`, 1000);
  await clean();
  await waitFor("!document.querySelector('#studio').hidden", 20000);
  await sleep(settle);
  if (play) {
    await startGame();
    await sleep(3500);
  }
};
const fullPlay = async (id, run = 4500) => {
  await studio(id, 6000, false);
  await click("#playBtn");
  await sleep(2000);
  await startGame();
  // The game iframe is sandboxed (opaque origin): skip an opening cinematic with Enter from inside it.
  await sleep(2500);
  await evaluate("document.querySelector('#game').focus()");
  await key("Enter", "Enter", 13);
  await sleep(800);
  await startGame();
  await sleep(run);
  await evaluate("document.querySelector('#chatTip').hidden = true");
  await sleep(300);
};
const SHOTS = {
  async lobby(loc) {
    await go("/studio", 2500);
    await clean();
    await evaluate(`(() => { const t = document.querySelector('#askIn'); t.value = ${JSON.stringify(IDEA[loc])}; t.dispatchEvent(new Event('input')); t.blur(); })()`);
    await sleep(600);
  },
  async "studio-3d"() {
    await studio(P.sky);
  },
  async "studio-25d"() {
    await studio(P.lumi);
  },
  async "studio-2d"() {
    await studio(P.nova);
  },
  play: () => fullPlay(P.lumi),
  "play-2d": () => fullPlay(P.nova, 7000),
  "play-3d": () => fullPlay(P.sky),
  async chat() {
    await studio(P.sky, 6000, false);
    await click("#playBtn");
    await sleep(1000);
    await startGame();
    await waitFor("!document.querySelector('#chatTip').hidden", 8000);
    await sleep(1200);
  },
  async viewer() {
    await studio(P.sky, 4000, false);
    await evaluate(`(() => {
      const cards = [...document.querySelectorAll('.st-assets .asset[data-id]')];
      const pick = cards.find((c) => /hero.*_3d/.test(c.dataset.id)) || cards.find((c) => /_3d/.test(c.dataset.id)) || cards[0];
      pick.querySelector('[data-a="view"]').click();
    })()`);
    await sleep(7000);
  },
  async library() {
    await studio(P.lumi, 5000);
    await click('[data-ptab="recursos"]');
    await sleep(1800);
  },
  async cinematic() {
    await studio(P.sky, 5000);
    await click('[data-ptab="cine"]');
    await sleep(1800);
  },
  async export() {
    await studio(P.nova, 5000);
    await click("#exportBtn");
    await waitFor("!document.querySelector('#dlWeb')?.disabled", 60000);
    await sleep(800);
  },
  async pro() {
    await studio(P.lumi, 4000);
    await click("#proBtn");
    await sleep(7000);
  },
  async tour() {
    await evaluate("localStorage.removeItem('forge.tourSeen')");
    await studio(P.sky, 3500, false);
    await waitFor("!document.querySelector('#tour').hidden", 10000);
    await sleep(1200);
    await evaluate("localStorage.setItem('forge.tourSeen','1')");
  },
};

/* ---------- main ---------- */
async function main() {
  if (!BROWSER) throw new Error("No Edge/Chrome found; set BROWSER");
  const profile = mkdtempSync(join(tmpdir(), "forge-cap-"));
  const proc = spawn(BROWSER, [`--headless=new`, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--mute-audio", "--no-first-run", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
        .then((r) => r.json())
        .then((l) => l.find((t) => t.type === "page"))
        .catch(() => null);
    }
    if (!target) throw new Error("DevTools endpoint not reachable");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      const p = msg.id && pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
      else p.res(msg.result);
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });

    for (const loc of LOCALES) {
      await go("/studio", 800);
      await evaluate(`localStorage.setItem('forge.locale', '${loc}'); localStorage.setItem('forge.tourSeen', '1');`);
      for (const [name, run] of Object.entries(SHOTS)) {
        if (ONLY && !ONLY.includes(name)) continue;
        try {
          await run(loc);
          await shot(loc, name);
        } catch (e) {
          console.warn(`  ✗ ${loc}/${name}: ${e.message}`);
        }
      }
    }
  } finally {
    ws?.close();
    proc.kill();
    await sleep(500);
    rmSync(profile, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
