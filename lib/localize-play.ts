import { config } from "./config";
import { generateJson } from "./providers/anthropic";
import { updateProject } from "./store";
import type { GameDesign, Project } from "./types";
import { detectDesignLocale } from "./play";

export type PlayOverlayCopy = {
  sourceKey: string;
  genre: string;
  tagline: string;
  objective: string;
  /** Control action labels, same order as design.controls. */
  controls?: string[];
};

const LANG_NAME = { es: "Spanish", en: "English", fr: "French" } as const;

/** Everything the start menu shows in words. Older caches without controls get a new key and are redone once. */
function sourceKey(d: GameDesign) {
  return [d.tagline || "", d.objective || "", ...(d.controls || []).map((c) => c.action || "")].join("\n");
}

/** Design clone with start-menu copy localized to the studio/play locale (title stays as authored). */
export async function designForPlayLocale(p: Project, locale: "es" | "en" | "fr"): Promise<GameDesign> {
  const d = p.design;
  if (!d) throw new Error("missing design");
  const srcLang = detectDesignLocale(`${p.idea} ${d.title} ${d.tagline || ""} ${d.objective || ""}`);
  if (srcLang === locale) return d;

  const key = sourceKey(d);
  const cached = p.playCopy?.[locale];
  if (cached && cached.sourceKey === key && (cached.tagline || cached.objective)) {
    return applyCopy(d, cached);
  }

  if (!config.anthropic.key()) return d;

  try {
    const actions = (d.controls || []).map((c) => c.action || "");
    const { data } = await generateJson<{ tagline: string; objective: string; controls: string[] }>({
      model: config.anthropic.fastModel(),
      system: `You localize short game menu copy. Translate into natural ${LANG_NAME[locale]} for a start screen.
Keep proper names (e.g. Lumi, Arbre-Cœur) when they are character/place names; translate the rest.
"controls" are short control labels ("Jump", "Change lane"): translate each one, same order and count, 1-4 words.
Return only the JSON fields. Do not add explanations.`,
      prompt: `Target language: ${LANG_NAME[locale]}
tagline: """${d.tagline || ""}"""
objective: """${d.objective || ""}"""
controls: ${JSON.stringify(actions)}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["tagline", "objective", "controls"],
        properties: {
          tagline: { type: "string" },
          objective: { type: "string" },
          controls: { type: "array", items: { type: "string" } },
        },
      },
      maxTokens: 800,
    });
    const copy: PlayOverlayCopy = {
      sourceKey: key,
      // The genre shown on screen comes from the catalog (lib/genres.ts), not from a translation.
      genre: d.genre,
      tagline: String(data.tagline || d.tagline || "").trim() || d.tagline,
      objective: String(data.objective || d.objective || "").trim() || d.objective,
      controls: actions.map((a, i) => String(data.controls?.[i] || "").trim() || a),
    };
    await updateProject(p.id, (pp) => {
      pp.playCopy = { ...(pp.playCopy || {}), [locale]: copy };
    });
    p.playCopy = { ...(p.playCopy || {}), [locale]: copy };
    return applyCopy(d, copy);
  } catch (e) {
    console.warn("[forge] play copy localize failed", e);
    return d;
  }
}

function applyCopy(d: GameDesign, copy: PlayOverlayCopy): GameDesign {
  return {
    ...d,
    tagline: copy.tagline || d.tagline,
    objective: copy.objective || d.objective,
    controls: (d.controls || []).map((c, i) => ({ ...c, action: copy.controls?.[i] || c.action })),
  };
}
