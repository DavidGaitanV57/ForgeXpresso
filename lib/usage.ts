import type { ApiProvider, UsageEvent, UsageReport, UsageTotals } from "./types";

/** Approximate list prices (USD). Marked as estimates in the UI. */
const ANTHROPIC_RATE: Record<string, { in: number; out: number }> = {
  // $ / 1M tokens
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 },
  default: { in: 5, out: 25 },
};

function anthropicRate(model: string) {
  const m = model.toLowerCase();
  if (m.includes("opus")) return ANTHROPIC_RATE.opus;
  if (m.includes("sonnet")) return ANTHROPIC_RATE.sonnet;
  if (m.includes("haiku")) return ANTHROPIC_RATE.haiku;
  return ANTHROPIC_RATE.default;
}

export function estimateAnthropicUsd(model: string, inputTokens: number, outputTokens: number) {
  const r = anthropicRate(model);
  return (inputTokens * r.in + outputTokens * r.out) / 1_000_000;
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

/** Rough ElevenLabs list estimates. */
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
