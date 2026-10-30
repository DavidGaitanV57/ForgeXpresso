import * as acorn from "acorn";
import { config } from "../config";
import { generateText, type AnthropicUsage } from "../providers/anthropic";
import { wantsMeshCharacters } from "./director";
import type { AssetRecord, AudioAssetSpec, GameDesign, ImageAssetSpec, ModelAssetSpec } from "../types";
import { runtimeDocs } from "./runtime-docs";

type Mode = "create" | "edit" | "repair";

interface CodeInput {
  design: GameDesign;
  assets: AssetRecord[];
  mode: Mode;
  idea?: string;
  instructions?: string;
  previousCode?: string;
  error?: string;
  onProgress?: (detail: string) => void;
  onUsage?: (usage: AnthropicUsage, label: string) => void;
}

function manifest(assets: AssetRecord[]) {
  return assets.map((a) => {
    if (a.type === "image") {
      const s = a.spec as ImageAssetSpec;
      return { id: a.id, type: "image", role: s.role, name: a.name, aspect: s.aspect, transparent: s.transparent, usage: s.usage };
    }
    if (a.type === "audio") {
      const s = a.spec as AudioAssetSpec;
      return { id: a.id, type: "audio", kind: s.kind, name: a.name, durationSec: s.durationSec, loop: s.loop, usage: s.usage };
    }
    const s = a.spec as ModelAssetSpec;
    return { id: a.id, type: "model", name: a.name, usage: s.usage, available: a.status === "ready" };
  });
}

function designBrief(d: GameDesign) {
  const { assets: _assets, ...rest } = d;
  return rest;
}

const SYSTEM = (engine: "phaser" | "three") => `You are Forge's senior gameplay programmer. You write complete, polished, bug-free browser games as a single ES module that runs inside the Forge runtime.
You are excellent at game feel, level design and clean architecture. You never leave TODOs or stubs: everything you reference is implemented.
${runtimeDocs(engine)}
## Output format
Reply with ONLY the complete module inside one \`\`\`js code block. No explanations before or after.`;

export function extractCode(text: string) {
  const blocks = [...text.matchAll(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.sort((a, b) => b.length - a.length)[0].trim();
  return text.trim();
}

export type ValidateCodeOpts = {
  /** Reject forge.three.sprite — required for full 3D or mesh-character 2.5D. */
  forbidSprites?: boolean;
  /** Require forge.three.character or forge.three.model at least once. */
  requireCharacterMeshes?: boolean;
};

export function validateCode(code: string, engine: "phaser" | "three", opts: ValidateCodeOpts = {}): string | null {
  let ast: acorn.Program;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch (e) {
    return `SyntaxError: ${(e as Error).message}`;
  }
  const hasDefault = ast.body.some((n) => n.type === "ExportDefaultDeclaration");
  if (!hasDefault) return "The module must have `export default function createGame(...)`.";
  for (const n of ast.body) {
    if (n.type === "ImportDeclaration") {
      const src = String(n.source.value);
      if (engine === "phaser") return `Imports are not allowed in Phaser games (found import from "${src}"). Phaser is a global.`;
      if (src !== "three" && !src.startsWith("three/addons/")) return `Only "three" and "three/addons/..." can be imported (found "${src}").`;
    }
  }
  if (/\bfetch\s*\(|XMLHttpRequest|document\.cookie|\blocalStorage\b|\balert\s*\(/.test(code))
    return "Forbidden API used (fetch, XMLHttpRequest, document.cookie, localStorage or alert). Use the forge API instead.";
  if (engine === "three" && opts.forbidSprites && /forge\.three\.sprite\s*\(/.test(code)) {
    return "forge.three.sprite is forbidden for this design (3D / mesh characters required). Use forge.three.character(imageId, height) — it loads *_3d GLB when available, otherwise builds low-poly Capsule/Sphere primitives with the image texture. For décor use backdrop, skydome, or textured PlaneGeometry — not sprite.";
  }
  if (engine === "three" && opts.requireCharacterMeshes && !/forge\.three\.(character|model)\s*\(/.test(code)) {
    return "This design requires 3D characters: call forge.three.character(imageId, height) for hero/enemies/NPCs (GLB if present, else low-poly primitives). Do not use billboard sprites.";
  }
  return null;
}

export async function codeAgent(input: CodeInput): Promise<string> {
  const engine = input.design.engine;
  const ideaBlob = `${input.idea || ""} ${input.design.title} ${input.design.tagline} ${input.design.setting} ${input.design.levelOutline} ${input.design.mechanics.join(" ")}`;
  const meshChars = engine === "three" && wantsMeshCharacters(ideaBlob, input.design.dimension);
  const forceMesh = engine === "three" && (input.design.dimension === "3d" || meshChars);
  const meshValidate: ValidateCodeOpts = forceMesh ? { forbidSprites: true, requireCharacterMeshes: true } : {};
  const header = `# Design document\n${JSON.stringify(designBrief(input.design), null, 1)}\n\n# Asset manifest (ids you can use)\n${JSON.stringify(manifest(input.assets), null, 1)}\n`;
  let task: string;
  if (input.mode === "create") {
    const cine = input.design.cinematic?.direction;
    const cineHint = cine?.shots?.length
      ? ` CRITICAL CINEMATIC: design.cinematic.direction is a unique in-engine intro for THIS game (approach=${cine.approach}). Implement onCinematic(dt, cine) that ONLY drives camera/parallax/staging from cine.shot / direction.shots while forge.cinematic.active — do NOT leave a static frame. Sync to cine.lineIndex / shotIndex / progress. After it ends, restore the gameplay camera. FORBIDDEN: DIY letterbox, subtitle meshes, skip tips, duplicate narration play, or an initial state==="cine" intro — the runtime already shows bars/subs/voice/skip.`
      : " CRITICAL CINEMATIC: if design.cinematic.lines exist, implement onCinematic(dt, cine) with a short camera/parallax move only (no DIY subtitle/skip UI — runtime owns that).";
    task = `Write the complete game for this design. Implement every mechanic, the level outline, the objective and lose condition, juice and audio. Use the tuning keys via forge.tune.${
      forceMesh
        ? input.design.dimension === "3d"
          ? " CRITICAL: full 3D — mesh entities via forge.three.character(logicalId, height, { yaw: -Math.PI/2 }) (Tripo +X→+Z) or primitives; never sprite. FACING: root.rotation.y = atan2(vx,vz) smoothed. Do NOT also += Math.PI on the model (profile-while-walking bug)."
          : " CRITICAL: CHARACTERS via forge.three.character(logicalId, height) (GLB or primitives; never sprites). Décor/sky MAY stay 2D. SIDE-SCROLL FACING: sideYaw=(d)=>d>=0?-PI/2-0.55:PI/2+0.55 (do not pass third-person yaw -PI/2)."
        : ""
    }${cineHint}`;
  } else if (input.mode === "edit") {
    task = `# Current game code\n\`\`\`js\n${input.previousCode}\n\`\`\`\n\n# Requested change\n${input.instructions}\n\nApply the change carefully, keep everything else working exactly as before, and return the full updated module.${
      forceMesh
        ? " Keep 3D characters as forge.three.character(...) / model(...); do not introduce forge.three.sprite for hero/enemies/NPCs."
        : ""
    }`;
  } else {
    task = `# Current game code\n\`\`\`js\n${input.previousCode}\n\`\`\`\n\n# Runtime error reported by the browser\n${input.error}\n\nFind the root cause and fix it (and any similar latent bug you notice). Keep the gameplay identical otherwise. Return the full corrected module.${
      forceMesh ? " Preserve forge.three.character / model for characters; do not replace them with sprite billboards." : ""
    }`;
  }

  const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: `${header}\n${task}` }];
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    input.onProgress?.(attempt === 0 ? (input.mode === "repair" ? "Corrigiendo el error" : "Escribiendo el código") : `Corrigiendo validación (intento ${attempt + 1})`);
    const { text, stop, usage } = await generateText({
      model: config.anthropic.codeModel(),
      system: SYSTEM(engine),
      messages,
      maxTokens: 64000,
      think: true,
    });
    input.onUsage?.(usage, attempt === 0 ? `code:${input.mode}` : `code:fix${attempt + 1}`);
    const code = extractCode(text);
    const err = stop === "max_tokens" ? "The response was cut off (too long). Write a more compact version of the module." : validateCode(code, engine, meshValidate);
    if (!err) return code;
    lastErr = err;
    messages.push({ role: "assistant", content: "```js\n" + code + "\n```" }, { role: "user", content: `Validation failed: ${err}\nReturn the full corrected module.` });
  }
  throw new Error(`El código generado no pasó la validación: ${lastErr}`);
}
