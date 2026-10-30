import { config } from "../config";
import { generateJson, type AnthropicUsage } from "../providers/anthropic";
import type { CinematicApproach, CinematicDirection, Dimension, GameDesign } from "../types";

const APPROACHES: CinematicApproach[] = [
  "camera_tour",
  "parallax_drift",
  "tableau_cuts",
  "character_focus",
  "topdown_sweep",
  "side_scroll_reveal",
  "orbit_showcase",
  "mood_montage",
];

const num = { type: "number" as const };
const str = { type: "string" as const };
const arr = (items: Record<string, unknown>) => ({ type: "array" as const, items });
const vec3 = { type: "array" as const, items: num, minItems: 3, maxItems: 3 };
const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const schema = obj(
  {
    approach: { type: "string", enum: APPROACHES },
    rationale: str,
    mood: str,
    notes: str,
    shots: arr(
      obj(
        {
          lineIndex: { type: "integer" },
          durationSec: num,
          staging: str,
          camera: obj(
            {
              from: vec3,
              to: vec3,
              lookAt: vec3,
              fov: num,
              ease: { type: "string", enum: ["linear", "smooth", "easeIn", "easeOut"] },
            },
            [],
          ),
          fx: arr(str),
        },
        ["lineIndex", "durationSec", "staging", "camera"],
      ),
    ),
  },
  ["approach", "rationale", "mood", "notes", "shots"],
);

type Raw = {
  approach: CinematicApproach;
  rationale: string;
  mood: string;
  notes: string;
  shots: CinematicDirection["shots"];
};

/**
 * Silent cinematic expert: plans an in-engine sequence that fits THIS design
 * (genre, dimension, artStyle, setting). Does not generate video files.
 */
export async function runCinematicDirector(
  idea: string,
  design: GameDesign,
  dimension: Dimension,
): Promise<{ direction: CinematicDirection; usage: AnthropicUsage }> {
  const lines = design.cinematic?.lines || [];
  const system = `You are Forge's cinematic director — an expert in game intro sequences, camera language and staging.
You do NOT generate video files. You author an IN-ENGINE cinematic plan the gameplay programmer will implement with the live Phaser or Three.js scene (camera moves, parallax, character poses, lighting pulses, particle cues).
Every plan must feel unique to THIS game: match its genre, dimension, artStyle, setting, mood and narration. Never reuse a generic "slow pan left" for every project.
Pick the approach that best serves the story beat — a cozy 2.5D forest may want parallax_drift + firefly bursts; a tense 3D ruins explorer may want orbit_showcase then character_focus; a 2D shmup may want side_scroll_reveal with layered starfields.
Write rationale, mood, staging, notes and fx labels in English (code-facing). Narration lines stay as provided (do not rewrite them).`;

  const prompt = `Idea: """${idea}"""
Dimension / engine: ${dimension} / ${design.engine}
Title: ${design.title}
Tagline: ${design.tagline}
Genre: ${design.genre}
Camera (gameplay): ${design.camera}
Art style: ${design.artStyle}
Setting: ${design.setting}
Hero: ${design.hero?.name} — ${design.hero?.description}
Objective: ${design.objective}
Level outline: ${design.levelOutline}
Cinematic style tag: ${design.cinematic?.style || "epica"}
Narration lines (keep indices):
${lines.map((l, i) => `  [${i}] ${l}`).join("\n") || "  (none — invent 3 staging beats with lineIndex -1)"}

Rules:
- approach: one of ${APPROACHES.join(", ")} — choose for THIS design, not a default.
- shots: 3–6 beats. Prefer one shot per narration line (lineIndex 0..n-1), plus optional bridge shots with lineIndex -1.
- durationSec: 2.2–5.5 each; total roughly 10–22s.
- camera.from/to/lookAt: meters for 2.5D/3D, or pixel-ish units for 2D side views (x right, y up). Side-scroll 2.5D often uses z≈8–14 looking at the play plane.
- staging: concrete, implementable ("dolly from mushroom grove to heart-tree silhouette while fireflies rise").
- fx: short cues the coder can wire (e.g. "firefly_burst", "soft_bloom_up", "hero_lantern_glow", "parallax_slow").
- notes: how to idle the hero/enemies during the intro and how to hand off to gameplay camera.
- Do NOT invent new story text; stage the existing lines.`;

  const { data, usage } = await generateJson<Raw>({
    model: config.anthropic.fastModel(),
    system,
    prompt,
    schema,
    maxTokens: 4000,
  });

  const direction = normalize(data, lines.length);
  return { direction, usage };
}

function normalize(raw: Raw, lineCount: number): CinematicDirection {
  const approach = APPROACHES.includes(raw.approach) ? raw.approach : "camera_tour";
  const shots = (raw.shots || [])
    .slice(0, 8)
    .map((s) => ({
      lineIndex: Number.isFinite(s.lineIndex) ? Math.max(-1, Math.min(lineCount - 1, Math.trunc(s.lineIndex))) : -1,
      durationSec: Math.max(1.5, Math.min(8, Number(s.durationSec) || 3)),
      staging: String(s.staging || "Hold framing").slice(0, 280),
      camera: {
        from: asVec3(s.camera?.from),
        to: asVec3(s.camera?.to),
        lookAt: asVec3(s.camera?.lookAt),
        fov: typeof s.camera?.fov === "number" ? s.camera.fov : undefined,
        ease: (["linear", "smooth", "easeIn", "easeOut"] as const).includes(s.camera?.ease as "smooth")
          ? s.camera!.ease
          : ("smooth" as const),
      },
      fx: Array.isArray(s.fx) ? s.fx.map(String).slice(0, 6) : [],
    }))
    .filter((s) => s.staging);
  return {
    approach,
    rationale: String(raw.rationale || "").slice(0, 400),
    mood: String(raw.mood || "").slice(0, 200),
    notes: String(raw.notes || "").slice(0, 500),
    shots: shots.length
      ? shots
      : [
          {
            lineIndex: 0,
            durationSec: 3.5,
            staging: "Gentle establish of the playfield, then ease toward the hero.",
            camera: { ease: "smooth" },
            fx: [],
          },
        ],
  };
}

function asVec3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const a = v.map((n) => Number(n));
  if (a.some((n) => !Number.isFinite(n))) return undefined;
  return [a[0], a[1], a[2]];
}
