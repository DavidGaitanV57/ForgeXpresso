// Copies browser builds of the game engines into public/vendor so the
// generated games (and exported ZIPs) run without a bundler or CDN.
import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");
const out = join(root, "public", "vendor");

const copies = [
  ["phaser/dist/phaser.min.js", "phaser/phaser.min.js"],
  ["three/build/three.module.js", "three/three.module.js"],
  ["three/build/three.core.js", "three/three.core.js"],
  ["three/examples/jsm", "three/addons"],
  ["@dimforge/rapier3d-compat/dist/rapier.mjs", "rapier/rapier.mjs"],
];

if (!existsSync(nm)) {
  console.warn("[vendor] node_modules not found, skipping");
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  const src = join(nm, from);
  const dst = join(out, to);
  if (!existsSync(src)) {
    console.warn(`[vendor] missing ${from}`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}
console.log("[vendor] engines copied to public/vendor");
