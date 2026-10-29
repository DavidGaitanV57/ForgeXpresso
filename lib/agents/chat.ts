import { config } from "../config";
import { generateJson } from "../providers/anthropic";
import type { AssetRecord, AudioAssetSpec, ChatMsg, GameDesign, ImageAssetSpec, TuningParam } from "../types";

export interface ChangePlan {
  reply: string;
  tags: string[];
  tuning: { key: string; value: number }[];
  newTuning: TuningParam[];
  regenerate: { id: string; prompt: string }[];
  newImages: ImageAssetSpec[];
  newAudio: AudioAssetSpec[];
  code: string;
  title: string;
  cinematicLines: string[];
}

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

const schema = obj({
  reply: str,
  tags: arr(str),
  tuning: arr(obj({ key: str, value: num })),
  newTuning: arr(obj({ key: str, label: str, value: num, min: num, max: num })),
  regenerate: arr(obj({ id: str, prompt: str })),
  newImages: arr(
    obj({
      id: str,
      name: str,
      role: { type: "string", enum: ["hero", "enemy", "npc", "collectible", "hazard", "prop", "platform", "tile", "goal", "background", "texture", "ui", "portrait"] },
      prompt: str,
      transparent: bool,
      aspect: { type: "string", enum: ["1:1", "16:9", "9:16", "3:2", "2:3"] },
      usage: str,
    }),
  ),
  newAudio: arr(obj({ id: str, name: str, kind: { type: "string", enum: ["music", "sfx", "voice"] }, prompt: str, durationSec: num, loop: bool, usage: str })),
  code: str,
  title: str,
  cinematicLines: arr(str),
});

export async function planChange(o: { design: GameDesign; assets: AssetRecord[]; history: ChatMsg[]; message: string; playing: boolean }) {
  const system = `You are Forge, the game director that talks with the player/creator while they iterate on their game.
You receive a change request and decide the cheapest set of actions that fulfils it:
1. "tuning": if the request is just about a number that already exists in the tuning list (speed, jump, gravity, difficulty…), set new values (respect min/max; you may widen nothing). This applies instantly without reloading.
2. "regenerate": redraw/re-record existing assets (give the new subject prompt in English, or "" to just try again).
3. "newImages"/"newAudio": only when the change needs new content (new enemy, new sound, new music). ids snake_case, unique.
4. "code": precise instructions for the programmer (in English) when gameplay/logic/visual code must change (new mechanic, new level layout, bug fix, HUD change…). "" when not needed. If you add newTuning keys or new assets, tell the programmer to use them.
5. "title" ("" = keep) and "cinematicLines" ([] = keep, or exactly 3 lines).
Answer in "reply" in the user's language, short and friendly (1-2 sentences), saying what you changed. "tags": 1-4 very short labels of the applied changes (e.g. "Salto +18%", "Nuevo enemigo").
If the request is a question, answer it in reply and leave every action empty.`;

  const tuning = o.design.tuning.map((t) => `${t.key} (${t.label}) = ${t.value} [${t.min}..${t.max}]`).join("\n");
  const assets = o.assets.map((a) => `${a.id} · ${a.type} · ${a.name}${a.liked === 1 ? " · liked" : a.liked === -1 ? " · disliked" : ""}`).join("\n");
  const history = o.history
    .slice(-10)
    .map((m) => `${m.who === "you" ? "User" : "Forge"}: ${m.text}`)
    .join("\n");
  const prompt = `Game: ${o.design.title} — ${o.design.genre} (${o.design.dimension}, ${o.design.engine}).
Objective: ${o.design.objective}
Mechanics: ${o.design.mechanics.join("; ")}
Art style: ${o.design.artStyle}

Tuning:
${tuning || "(none)"}

Assets:
${assets}

Recent conversation:
${history || "(none)"}

The user is ${o.playing ? "currently playing" : "in the studio"}.
New request: """${o.message}"""`;

  const { data, usage } = await generateJson<ChangePlan>({ model: config.anthropic.fastModel(), system, prompt, schema, maxTokens: 4000 });
  return { plan: data, usage };
}
