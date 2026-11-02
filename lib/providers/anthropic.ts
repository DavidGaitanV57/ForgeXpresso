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
  const cache = { read: msg.usage?.cache_read_input_tokens ?? 0, write: msg.usage?.cache_creation_input_tokens ?? 0 };
  return {
    inputTokens: inputTokens + cache.read + cache.write,
    outputTokens,
    estimatedUsd: estimateAnthropicUsd(model, inputTokens, outputTokens, cache),
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

const JSON_MAX_TOKENS = 32000;

export class TruncatedJsonError extends Error {
  constructor(maxTokens: number) {
    super(`La respuesta del modelo se cortó al superar ${maxTokens} tokens de salida; el diseño quedó incompleto.`);
    this.name = "TruncatedJsonError";
  }
}

function addUsage(a: AnthropicUsage | null, b: AnthropicUsage): AnthropicUsage {
  if (!a) return b;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedUsd: a.estimatedUsd + b.estimatedUsd,
    model: b.model,
    ms: a.ms + b.ms,
  };
}

export async function generateJson<T>(o: { model: string; system: string; prompt: string; schema: Record<string, unknown>; maxTokens: number }): Promise<{ data: T; usage: AnthropicUsage }> {
  const budgets = [...new Set([o.maxTokens, Math.min(o.maxTokens * 2, JSON_MAX_TOKENS)])];
  const fallbackSystem = `${o.system}\n\nResponde SOLO con un objeto JSON válido que cumpla este JSON Schema, sin texto adicional ni bloques de código:\n${JSON.stringify(o.schema)}`;
  let structured = true;
  let total: AnthropicUsage | null = null;
  let last: unknown;
  for (const maxTokens of budgets) {
    const base: Anthropic.MessageCreateParamsNonStreaming = {
      model: o.model,
      max_tokens: maxTokens,
      system: structured ? o.system : fallbackSystem,
      messages: [{ role: "user", content: o.prompt }],
    };
    let r: Awaited<ReturnType<typeof run>>;
    try {
      r = await run(structured ? { ...base, output_config: { format: { type: "json_schema", schema: o.schema } } } : base);
    } catch (e) {
      if (!structured || !isBadRequest(e)) throw e;
      structured = false;
      r = await run({ ...base, system: fallbackSystem });
    }
    total = addUsage(total, r.usage);
    // Parsing a cut-off response yields misleading errors like "Expected ',' or ']' after array element".
    if (r.stop === "max_tokens") {
      last = new TruncatedJsonError(maxTokens);
      console.warn(`[generateJson] ${o.model} hit max_tokens=${maxTokens} (${r.text.length} chars)`);
      continue;
    }
    try {
      return { data: JSON.parse(structured ? r.text : extractJson(r.text)) as T, usage: total };
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      last = e;
      structured = false;
    }
  }
  throw last;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = fenced ? fenced[1] : text;
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("La respuesta del modelo no contiene JSON");
  return s.slice(a, b + 1);
}
