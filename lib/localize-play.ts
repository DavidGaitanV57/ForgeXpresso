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
};

const LANG_NAME = { es: "Spanish", en: "English", fr: "French" } as const;

function sourceKey(d: GameDesign) {
  return `${d.genre || ""}\n${d.tagline || ""}\n${d.objective || ""}`;
}

/** Design clone with start-menu copy localized to the studio/play locale (title stays as authored). */
export async function designForPlayLocale(p: Project, locale: "es" | "en" | "fr"): Promise<GameDesign> {
  const d = p.design;
  if (!d) throw new Error("missing design");
  const srcLang = detectDesignLocale(`${p.idea} ${d.title} ${d.tagline || ""} ${d.objective || ""}`);
  if (srcLang === locale) return d;

  const key = sourceKey(d);
  const cached = p.playCopy?.[locale];
  if (cached && cached.sourceKey === key && (cached.tagline || cached.objective || cached.genre)) {
    return applyCopy(d, cached);
  }

  if (!config.anthropic.key()) return d;

  try {
    const { data } = await generateJson<{ genre: string; tagline: string; objective: string }>({
      model: config.anthropic.fastModel(),
      system: `You localize short game menu copy. Translate into natural ${LANG_NAME[locale]} for a start screen.
Keep proper names (e.g. Lumi, Arbre-Cœur) when they are character/place names; translate the rest.
Return only the JSON fields. Do not add explanations.`,
      prompt: `Target language: ${LANG_NAME[locale]}
genre: """${d.genre || ""}"""
tagline: """${d.tagline || ""}"""
objective: """${d.objective || ""}"""`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["genre", "tagline", "objective"],
        properties: {
          genre: { type: "string" },
          tagline: { type: "string" },
          objective: { type: "string" },
        },
      },
      maxTokens: 600,
    });
    const copy: PlayOverlayCopy = {
      sourceKey: key,
      genre: String(data.genre || d.genre || "").trim() || d.genre,
      tagline: String(data.tagline || d.tagline || "").trim() || d.tagline,
      objective: String(data.objective || d.objective || "").trim() || d.objective,
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
    genre: copy.genre || d.genre,
    tagline: copy.tagline || d.tagline,
    objective: copy.objective || d.objective,
  };
}
