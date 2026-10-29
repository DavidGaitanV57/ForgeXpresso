import type { AudioAssetSpec, ImageAssetSpec, Project } from "./types";

export interface PlayManifest {
  images: { id: string; name: string; role: string; aspect: string; transparent: boolean; url: string | null }[];
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
        return { id: a.id, name: a.name, role: s.role, aspect: s.aspect, transparent: s.transparent, url: url(a) };
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

export function buildPlayHtml(p: Project, o: { base: string; gameUrl: string; version: number; fileUrl: (rel: string) => string }) {
  const design = p.design!;
  const engine = design.engine;
  const boot = {
    projectId: p.id,
    version: o.version,
    engine,
    gameUrl: o.gameUrl,
    design,
    manifest: buildManifest(p, o.fileUrl),
    cineAuto: !!p.cineAuto,
  };
  const b = o.base;
  const head =
    engine === "phaser"
      ? `<script src="${b}vendor/phaser/phaser.min.js"></script>`
      : `<script type="importmap">${json({ imports: { three: `${b}vendor/three/three.module.js`, "three/addons/": `${b}vendor/three/addons/`, rapier: `${b}vendor/rapier/rapier.mjs` } })}</script>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>${escHtml(design.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="${b}runtime/runtime.css">
${head}
<script>window.FORGE_BOOT=${json(boot)};</script>
<script type="module" src="${b}runtime/forge-runtime.js"></script>
</head>
<body></body>
</html>`;
}
