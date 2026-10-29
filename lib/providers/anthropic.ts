import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { estimateAnthropicUsd } from "../usage";

let cached: { key: string; client: Anthropic } | null = null;

function client() {
  const key = config.anthropic.key();
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en .env.local: sin ella no se puede generar el código del juego.");
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

type Msg = Anthropic.MessageParam;

interface TextOpts {
  model: string;
  system: string;
  messages: Msg[];
  maxTokens: number;
  think?: boolean;
}

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  model: string;
  ms: number;
}

function isBadRequest(e: unknown) {
  return e instanceof Anthropic.APIError && e.status === 400;
}

function packUsage(model: string, msg: Anthropic.Message, ms: number): AnthropicUsage {
  const inputTokens = msg.usage?.input_tokens ?? 0;
  const outputTokens = msg.usage?.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    estimatedUsd: estimateAnthropicUsd(model, inputTokens, outputTokens),
    model,
    ms,
  };
}

async function run(params: Anthropic.MessageCreateParamsNonStreaming) {
  const t0 = Date.now();
  const msg = await client().messages.stream(params).finalMessage();
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, stop: msg.stop_reason, usage: packUsage(params.model, msg, Date.now() - t0) };
}

export async function generateText(o: TextOpts) {
  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model: o.model,
    max_tokens: o.maxTokens,
    system: o.system,
    messages: o.messages,
  };
  // Not every model accepts adaptive thinking or very large outputs; degrade gracefully.
  const attempts: Anthropic.MessageCreateParamsNonStreaming[] = [];
  if (o.think) attempts.push({ ...base, thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  attempts.push(base);
  if (o.maxTokens > 32000) attempts.push({ ...base, max_tokens: 32000 });
  let last: unknown;
  for (const params of attempts) {
    try {
      return await run(params);
    } catch (e) {
      if (!isBadRequest(e)) throw e;
      last = e;
    }
  }
  throw last;
}

export async function generateJson<T>(o: { model: string; system: string; prompt: string; schema: Record<string, unknown>; maxTokens: number }): Promise<{ data: T; usage: AnthropicUsage }> {
  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model: o.model,
    max_tokens: o.maxTokens,
    system: o.system,
    messages: [{ role: "user", content: o.prompt }],
  };
  try {
    const { text, usage } = await run({ ...base, output_config: { format: { type: "json_schema", schema: o.schema } } });
    return { data: JSON.parse(text) as T, usage };
  } catch (e) {
    if (!isBadRequest(e) && !(e instanceof SyntaxError)) throw e;
  }
  const { text, usage } = await run({
    ...base,
    system: `${o.system}\n\nResponde SOLO con un objeto JSON válido que cumpla este JSON Schema, sin texto adicional ni bloques de código:\n${JSON.stringify(o.schema)}`,
  });
  return { data: JSON.parse(extractJson(text)) as T, usage };
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fenced ? fenced[1] : text;
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("La respuesta del modelo no contiene JSON");
  return s.slice(a, b + 1);
}
