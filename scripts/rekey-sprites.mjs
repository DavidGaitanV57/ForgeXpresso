/**
 * Re-run sprite cutout on existing project PNGs that still have opaque plates.
 * Usage: node scripts/rekey-sprites.mjs [projectId]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Compile-free: duplicate a minimal call via dynamic import of the TS build is awkward;
// call sharp logic inline by importing from the Next-transpiled path is worse.
// Instead, spawn through tsx if available, else use a small sharp reimplementation.

import sharp from "sharp";

const projectId = process.argv[2] || "4bc8fc88-cb4c-48ab-96f4-8b6405461f30";
const root = path.join(process.cwd(), "data", "projects", projectId);
const projectPath = path.join(root, "project.json");

function hasRealCutout(px, w, h) {
  const need = Math.max(256, Math.floor(w * h * 0.08));
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 12 && ++n >= need) return true;
  return false;
}

function borderColor(px, w, h) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 40));
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    if (px[i + 3] < 8) return;
    samples.push([px[i], px[i + 1], px[i + 2]]);
  };
  for (let x = 0; x < w; x += step) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    take(0, y);
    take(w - 1, y);
  }
  if (!samples.length) return [0, 0, 0];
  const med = (k) => samples.map((s) => s[k]).sort((a, b) => a - b)[(samples.length / 2) | 0];
  return [med(0), med(1), med(2)];
}

function keyBackground(px, w, h) {
  const out = Buffer.from(px);
  const ref = borderColor(px, w, h);
  const dist = (i) => {
    const dr = px[i] - ref[0],
      dg = px[i + 1] - ref[1],
      db = px[i + 2] - ref[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const lum = (ref[0] + ref[1] + ref[2]) / 3;
  const isChroma = ref[0] > 180 && ref[2] > 180 && ref[1] < 80;
  const HARD = isChroma ? 55 : lum < 40 ? 48 : 70;
  const SOFT = isChroma ? 130 : lum < 40 ? 95 : 140;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const d = dist(i);
    if (d > SOFT) continue;
    if (d <= HARD) out[i + 3] = 0;
    else {
      const a = (d - HARD) / (SOFT - HARD);
      out[i + 3] = Math.round(out[i + 3] * a);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.max(0, Math.min(255, (px[i + c] - ref[c] * (1 - a)) / Math.max(a, 0.35))));
      continue;
    }
    const x = p % w,
      y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return out;
}

function punchDarkPlate(px, w, h) {
  const out = Buffer.from(px);
  const isPlate = (i) => {
    if (out[i + 3] < 12) return true;
    const r = out[i],
      g = out[i + 1],
      b = out[i + 2];
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    return max < 55 && max - min < 28;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!isPlate(i)) continue;
    out[i + 3] = 0;
    const x = p % w,
      y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return out;
}

function alphaBounds(px, w, h) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

async function rekey(buf) {
  const raw = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let data = raw.data;
  const { width: w, height: h } = raw.info;
  if (!hasRealCutout(data, w, h)) {
    data = keyBackground(data, w, h);
    data = punchDarkPlate(data, w, h);
  } else {
    data = punchDarkPlate(data, w, h);
  }
  const box = alphaBounds(data, w, h);
  let pipeline = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  if (box) {
    const pad = 4;
    const left = Math.max(0, box.x0 - pad);
    const top = Math.max(0, box.y0 - pad);
    const width = Math.min(w - left, box.x1 - box.x0 + 1 + pad * 2);
    const height = Math.min(h - top, box.y1 - box.y0 + 1 + pad * 2);
    pipeline = pipeline.extract({ left, top, width, height });
  }
  const out = await pipeline.png({ compressionLevel: 9, palette: false }).toBuffer({ resolveWithObject: true });
  return out.data;
}

const project = JSON.parse(await fs.readFile(projectPath, "utf8"));
let fixed = 0;
for (const a of Object.values(project.assets)) {
  if (a.type !== "image" || a.status !== "ready" || !a.file?.endsWith(".png")) continue;
  if (a.spec && (a.spec.role === "background" || a.spec.role === "texture" || a.spec.role === "portrait")) continue;
  const file = path.join(root, a.file);
  const before = await fs.readFile(file);
  const meta = await sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (hasRealCutout(meta.data, meta.info.width, meta.info.height)) {
    // Still punch residual dark plates.
    const punched = punchDarkPlate(Buffer.from(meta.data), meta.info.width, meta.info.height);
    let a0 = 0;
    for (let i = 3; i < punched.length; i += 4) if (punched[i] < 12) a0++;
    const before0 = (() => {
      let n = 0;
      for (let i = 3; i < meta.data.length; i += 4) if (meta.data[i] < 12) n++;
      return n;
    })();
    if (a0 <= before0 + 100) {
      console.log("skip (ok)", a.id);
      continue;
    }
  }
  const next = await rekey(before);
  const rev = (a.rev || 0) + 1;
  const newRel = `assets/${a.id}.r${rev}.png`;
  await fs.writeFile(path.join(root, newRel), next);
  a.file = newRel;
  a.rev = rev;
  a.mime = "image/png";
  a.updatedAt = Date.now();
  fixed++;
  console.log("rekeyed", a.id, "->", newRel, `(${before.length} → ${next.length} bytes)`);
}
await fs.writeFile(projectPath, JSON.stringify(project, null, 2));
console.log(`done. fixed=${fixed}`);
