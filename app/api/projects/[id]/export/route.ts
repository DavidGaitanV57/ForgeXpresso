import { promises as fs } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { jsonError, loadProject, type Ctx } from "@/lib/http";
import { buildPlayHtml } from "@/lib/play";
import { readCurrentCode, readProjectFile } from "@/lib/store";

export const dynamic = "force-dynamic";

const PUBLIC = path.join(process.cwd(), "public");

async function addDir(zip: JSZip, abs: string, rel: string, skip: (rel: string) => boolean = () => false) {
  for (const e of await fs.readdir(abs, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (skip(r)) continue;
    if (e.isDirectory()) await addDir(zip, path.join(abs, e.name), r, skip);
    else zip.file(r, await fs.readFile(path.join(abs, e.name)));
  }
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "juego"
  );
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await loadProject(id);
  if (!p?.design || !p.versions.length) return jsonError("El juego todavía no está listo", 409);
  const code = await readCurrentCode(p);
  const zip = new JSZip();
  const slug = slugify(p.design.title);
  const dir = zip.folder(slug)!;

  dir.file("game.js", code ?? "");
  for (const a of Object.values(p.assets)) {
    if (a.status === "ready" && a.file) dir.file(a.file, await readProjectFile(id, a.file));
  }
  dir.file(
    "index.html",
    buildPlayHtml(p, { base: "./", version: p.currentVersion, gameUrl: "./game.js", fileUrl: (rel) => `./${rel}` }),
  );
  await addDir(dir as unknown as JSZip, path.join(PUBLIC, "runtime"), "runtime");
  if (p.design.engine === "phaser") {
    dir.file("vendor/phaser/phaser.min.js", await fs.readFile(path.join(PUBLIC, "vendor/phaser/phaser.min.js")));
  } else {
    for (const f of ["three.module.js", "three.core.js"]) dir.file(`vendor/three/${f}`, await fs.readFile(path.join(PUBLIC, "vendor/three", f)));
    dir.file("vendor/rapier/rapier.mjs", await fs.readFile(path.join(PUBLIC, "vendor/rapier/rapier.mjs")));
    await addDir(dir as unknown as JSZip, path.join(PUBLIC, "vendor/three/addons"), "vendor/three/addons", (r) => /\/libs\//.test(r) && !/\/libs\/(fflate|meshopt|lil-gui)/.test(r));
  }
  dir.file("design.json", JSON.stringify(p.design, null, 2));
  dir.file(
    "LEEME.txt",
    `${p.design.title}\n\nJuego generado con Forge.\n\nPara jugar, sirve esta carpeta con cualquier servidor estático (los navegadores no cargan módulos desde file://):\n  npx serve .\no\n  python -m http.server 8080\ny abre http://localhost:8080 (o el puerto que indique).\n\nControles:\n${p.design.controls.map((c) => `  ${c.input}: ${c.action}`).join("\n")}\n`,
  );

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug}.zip"` },
  });
}
