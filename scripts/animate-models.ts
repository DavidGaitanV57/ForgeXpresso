/**
 * Tripo auto-rig + retarget for existing GLB model assets of one project.
 * Usage: npx tsx scripts/animate-models.ts <projectId> <assetId>[:rigType] [...]
 *   rigType is optional (biped | quadruped | hexapod | octopod | serpentine | aquatic);
 *   without it Tripo's pre-rig check decides.
 */
import fs from "fs";
import path from "path";
import { animateExistingGlb } from "../lib/providers/tripo";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

function glbClips(buf: Buffer) {
  const n = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + n).toString("utf8"));
  return {
    skins: (json.skins || []).length as number,
    clips: (json.animations || []).map((a: { name?: string }) => a.name || "?") as string[],
  };
}

async function main() {
  loadEnv();
  const [projectId, ...targets] = process.argv.slice(2);
  if (!projectId || !targets.length) {
    console.error("Usage: npx tsx scripts/animate-models.ts <projectId> <assetId>[:rigType] [...]");
    process.exit(1);
  }
  if (!process.env.TRIPO_API_KEY) {
    console.error("Missing TRIPO_API_KEY");
    process.exit(1);
  }
  const projDir = path.join(process.cwd(), "data/projects", projectId);
  const pjPath = path.join(projDir, "project.json");
  const project = JSON.parse(fs.readFileSync(pjPath, "utf8").replace(/^\uFEFF/, ""));

  for (const target of targets) {
    const [id, rigType] = target.split(":");
    const rec = project.assets[id];
    try {
      if (!rec?.file) throw new Error(`missing asset ${id}`);
      const glb = fs.readFileSync(path.join(projDir, rec.file));
      console.log(`\n=== ${id} (${(glb.length / 1024).toFixed(0)} KB)${rigType ? ` rig=${rigType}` : ""} ===`);
      const result = await animateExistingGlb(glb, {
        rigType: rigType || undefined,
        onProgress: (label, p) => {
          if (p === 0 || p >= 100) console.log(`  ${label} ${Math.round(p)}%`);
        },
      });
      const check = glbClips(result.data);
      if (!check.skins || !check.clips.length) throw new Error(`Tripo devolvió un GLB sin skin/clips (${JSON.stringify(check)})`);
      const rev = (rec.rev || 0) + 1;
      const file = `assets/${id}.r${rev}.glb`;
      fs.writeFileSync(path.join(projDir, file), result.data);
      Object.assign(rec, { status: "ready", file, mime: "model/gltf-binary", rev, provider: "Tripo", error: undefined, updatedAt: Date.now() });
      console.log(`  SAVED ${file} rig=${result.rigType} clips=${check.clips.join(",")} ~$${result.estimatedUsd.toFixed(2)}`);
    } catch (e) {
      console.error(`FAIL ${id}`, e instanceof Error ? e.message : e);
    }
  }

  fs.writeFileSync(pjPath, JSON.stringify(project, null, 2));
  console.log("\nDone. Hard-refresh the play view.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
