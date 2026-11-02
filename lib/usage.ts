import type { ApiProvider, UsageEvent, UsageReport, UsageTotals } from "./types";

type AnthropicRate = { in: number; out: number; cacheRead: number };

/**
 * Anthropic list prices, $ / 1M tokens (docs.claude.com/en/docs/about-claude/pricing), first match wins.
 * Override with ANTHROPIC_PRICE_IN / ANTHROPIC_PRICE_OUT for custom contracts.
 */
const ANTHROPIC_RATES: [RegExp, AnthropicRate][] = [
  [/opus-5-5/, { in: 4, out: 20, cacheRead: 0.2 }],
  [/opus-(5|4-[5-9])/, { in: 5, out: 25, cacheRead: 0.5 }],
  [/opus/, { in: 15, out: 75, cacheRead: 1.5 }],
  [/sonnet-5/, { in: 2, out: 10, cacheRead: 0.1 }],
  [/sonnet/, { in: 3, out: 15, cacheRead: 0.3 }],
  [/haiku-5-5/, { in: 0.1, out: 0.5, cacheRead: 0.01 }],
  [/haiku/, { in: 1, out: 5, cacheRead: 0.1 }],
];
const ANTHROPIC_DEFAULT: AnthropicRate = { in: 4, out: 20, cacheRead: 0.2 };

function anthropicRate(model: string, inputTokens: number): AnthropicRate {
  const m = model.toLowerCase();
  let rate = ANTHROPIC_RATES.find(([re]) => re.test(m))?.[1] ?? ANTHROPIC_DEFAULT;
  if (/haiku-5-5/.test(m) && inputTokens > 100_000) rate = { in: 0.5, out: 2.5, cacheRead: 0.05 };
  const envIn = Number(process.env.ANTHROPIC_PRICE_IN);
  const envOut = Number(process.env.ANTHROPIC_PRICE_OUT);
  return {
    in: envIn > 0 ? envIn : rate.in,
    out: envOut > 0 ? envOut : rate.out,
    cacheRead: envIn > 0 ? envIn * 0.1 : rate.cacheRead,
  };
}

/** Thinking tokens are already included in outputTokens by the API. */
export function estimateAnthropicUsd(model: string, inputTokens: number, outputTokens: number, cache: { read?: number; write?: number } = {}) {
  const r = anthropicRate(model, inputTokens + (cache.read ?? 0) + (cache.write ?? 0));
  return (inputTokens * r.in + (cache.write ?? 0) * r.in * 1.25 + (cache.read ?? 0) * r.cacheRead + outputTokens * r.out) / 1_000_000;
}

/** gpt-image-2.5-sunburst approximate output-only list price at 1024²; landscape ×1.5. */
export function estimateOpenAIImageUsd(quality: "low" | "medium" | "high", aspect: string) {
  const base = quality === "high" ? 0.053 : quality === "low" ? 0.006 : 0.013;
  const wide = aspect === "16:9" || aspect === "9:16" || aspect === "3:2" || aspect === "2:3";
  return base * (wide ? 1.5 : 1);
}

export function estimateMiniMaxImageUsd() {
  return 0.02;
}

/**
 * ElevenLabs bills subscription credits, so by default a measured call costs $0 extra and the UI shows credits.
 * Set ELEVENLABS_USD_PER_CREDIT (plan price / plan credits, e.g. 22/100000) to prorate them into dollars.
 */
export function elevenLabsUsdPerCredit() {
  const v = Number(process.env.ELEVENLABS_USD_PER_CREDIT);
  return v > 0 ? v : 0;
}

/** Rough ElevenLabs list estimates, used only when the account's credit counter can't be read. */
export function estimateElevenLabsUsd(kind: "music" | "sfx" | "voice", durationSec: number, chars = 0) {
  if (kind === "voice") return Math.max(0.01, (chars || 80) * 0.00018);
  if (kind === "music") return Math.max(0.15, (durationSec || 60) * 0.008);
  return Math.max(0.02, (durationSec || 1.5) * 0.04);
}

export function estimateTripoUsd() {
  return 0.2;
}

function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, images: 0, audioSec: 0, models: 0, estimatedUsd: 0, ms: 0 };
}

export function emptyUsage(startedAt = Date.now()): UsageReport {
  return { startedAt, byProvider: {}, events: [], totals: emptyTotals() };
}

export function addUsageEvent(report: UsageReport, ev: Omit<UsageEvent, "at"> & { at?: number }): UsageReport {
  const event: UsageEvent = { ...ev, at: ev.at ?? Date.now() };
  const prev = report.byProvider[ev.provider] ?? {
    provider: ev.provider,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    images: 0,
    audioSec: 0,
    models: 0,
    estimatedUsd: 0,
    ms: 0,
  };
  const credits = (prev.credits ?? 0) + (ev.credits ?? 0);
  const next = {
    ...prev,
    calls: prev.calls + (ev.calls ?? 1),
    inputTokens: prev.inputTokens + (ev.inputTokens ?? 0),
    outputTokens: prev.outputTokens + (ev.outputTokens ?? 0),
    images: prev.images + (ev.images ?? 0),
    audioSec: prev.audioSec + (ev.audioSec ?? 0),
    models: prev.models + (ev.models ?? 0),
    estimatedUsd: prev.estimatedUsd + (ev.estimatedUsd ?? 0),
    ms: prev.ms + (ev.ms ?? 0),
    ...(credits ? { credits } : {}),
  };
  const byProvider = { ...report.byProvider, [ev.provider]: next };
  const totals = emptyTotals();
  for (const p of Object.values(byProvider)) {
    totals.calls += p.calls;
    totals.inputTokens += p.inputTokens;
    totals.outputTokens += p.outputTokens;
    totals.images += p.images;
    totals.audioSec += p.audioSec;
    totals.models += p.models;
    totals.estimatedUsd += p.estimatedUsd;
    totals.ms += p.ms;
  }
  const wall = (report.finishedAt ?? Date.now()) - report.startedAt;
  totals.ms = Math.max(totals.ms, wall);
  return {
    ...report,
    byProvider,
    events: [...report.events, event].slice(-200),
    totals,
  };
}

export function finishUsage(report: UsageReport, finishedAt = Date.now()): UsageReport {
  const wall = Math.max(0, finishedAt - report.startedAt);
  return {
    ...report,
    finishedAt,
    totals: { ...report.totals, ms: Math.max(report.totals.ms, wall) },
  };
}

export const PROVIDER_LABEL: Record<ApiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (imágenes)",
  minimax: "MiniMax (imágenes)",
  elevenlabs: "ElevenLabs (audio)",
  tripo: "Tripo (3D)",
};

export function formatUsd(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, "0")}m`;
}
