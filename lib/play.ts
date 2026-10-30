import type { AudioAssetSpec, ImageAssetSpec, Project } from "./types";

export interface PlayManifest {
  images: { id: string; name: string; role: string; aspect: string; transparent: boolean; seamless: boolean; url: string | null }[];
  audio: { id: string; name: string; kind: string; loop: boolean; url: string | null }[];
  models: { id: string; name: string; url: string | null }[];
}

export function buildManifest(p: Project, fileUrl: (rel: string) => string): PlayManifest {
  const all = Object.values(p.assets);
  const url = (a: (typeof all)[number]) => (a.status === "ready" && a.file ? fileUrl(a.file) : null);
  return {
    images: all
      .filter((a) => a.type === "image")
      .map((a) => {
        const s = a.spec as ImageAssetSpec;
        return { id: a.id, name: a.name, role: s.role, aspect: s.aspect, transparent: s.transparent, seamless: !!s.seamless, url: url(a) };
      }),
    audio: all
      .filter((a) => a.type === "audio")
      .map((a) => {
        const s = a.spec as AudioAssetSpec;
        return { id: a.id, name: a.name, kind: s.kind, loop: s.loop, url: url(a) };
      }),
    models: all.filter((a) => a.type === "model").map((a) => ({ id: a.id, name: a.name, url: url(a) })),
  };
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function ensureUi(design: Project["design"]) {
  if (!design) return design;
  if (design.ui?.settings?.length && design.ui.hud?.length) return design;
  const lang = detectDesignLocale(`${design.title} ${design.objective} ${design.tagline || ""}`);
  const L =
    lang === "fr"
      ? {
          score: "Score",
          lives: "Vies",
          resume: "Continuer",
          settings: "Réglages",
          quit: "Quitter",
          master: "Volume général",
          music: "Musique",
          sfx: "Effets",
          retry: "Réessayer",
          menu: "Menu",
          play: "Jouer",
        }
      : lang === "es"
        ? {
            score: "Puntos",
            lives: "Vidas",
            resume: "Continuar",
            settings: "Ajustes",
            quit: "Salir",
            master: "Volumen general",
            music: "Música",
            sfx: "Efectos",
            retry: "Reintentar",
            menu: "Menú",
            play: "Jugar",
          }
        : {
            score: "Score",
            lives: "Lives",
            resume: "Resume",
            settings: "Settings",
            quit: "Quit",
            master: "Master volume",
            music: "Music",
            sfx: "SFX",
            retry: "Retry",
            menu: "Menu",
            play: "Play",
          };
  return {
    ...design,
    ui: design.ui ?? {
      hud: [
        { id: "score", label: L.score, kind: "value" as const, shows: L.score },
        { id: "lives", label: L.lives, kind: "lives" as const, shows: L.lives },
      ],
      pauseMenu: [
        { id: "resume", label: L.resume, action: "resume" },
        { id: "settings", label: L.settings, action: "settings" },
        { id: "quit", label: L.quit, action: "quit" },
      ],
      settings: [
        { key: "masterVolume", label: L.master, type: "slider" as const, min: 0, max: 1, step: 0.05, defaultValue: 0.9 },
        { key: "musicVolume", label: L.music, type: "slider" as const, min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
        { key: "sfxVolume", label: L.sfx, type: "slider" as const, min: 0, max: 1, step: 0.05, defaultValue: 1 },
      ],
      gameOverActions: [L.retry, L.menu],
      startActions: [L.play],
    },
  };
}

export function buildPlayHtml(
  p: Project,
  o: {
    base: string;
    gameUrl: string;
    version: number;
    fileUrl: (rel: string) => string;
    locale?: "es" | "en" | "fr";
    /** Optional design override (localized genre/tagline/objective for the start menu). */
    design?: NonNullable<Project["design"]>;
  },
) {
  const design = ensureUi(o.design || p.design)!;
  const engine = design.engine;
  const locale = o.locale || detectDesignLocale(`${p.idea} ${design.title} ${design.objective} ${design.ui?.pauseMenu?.[0]?.label || ""}`);
  const boot = {
    projectId: p.id,
    version: o.version,
    engine,
    gameUrl: o.gameUrl,
    design,
    manifest: buildManifest(p, o.fileUrl),
    cineAuto: !!p.cineAuto,
    locale,
  };
  const b = o.base;
  const head =
    engine === "phaser"
      ? `<script src="${b}vendor/phaser/phaser.min.js"></script>`
      : `<script type="importmap">${json({ imports: { three: `${b}vendor/three/three.module.js`, "three/addons/": `${b}vendor/three/addons/`, rapier: `${b}vendor/rapier/rapier.mjs` } })}</script>`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>${escHtml(design.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&display=swap">
<link rel="stylesheet" href="${b}runtime/runtime.css">
${head}
<script>window.FORGE_BOOT=${json(boot)};</script>
<script type="module" src="${b}runtime/forge-runtime.js"></script>
</head>
<body></body>
</html>`;
}

export function detectDesignLocale(text: string): "es" | "en" | "fr" {
  if (/[àâäéèêëïîôùûüç]|forêt|jouer|vies|réglages|continuer/i.test(text)) return "fr";
  if (/[áéíóúñ¿¡]|puntos|vidas|jugar|continuar|ajustes/i.test(text)) return "es";
  return "en";
}
