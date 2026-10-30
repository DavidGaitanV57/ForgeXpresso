import path from "node:path";
import type { ImageProvider } from "./types";

const env = (k: string, d = "") => (process.env[k] ?? "").trim() || d;

export const config = {
  dataDir: () => env("FORGE_DATA_DIR") || path.join(process.cwd(), "data", "projects"),
  anthropic: {
    key: () => env("ANTHROPIC_API_KEY"),
    codeModel: () => env("ANTHROPIC_MODEL_CODE", "claude-opus-5-5"),
    fastModel: () => env("ANTHROPIC_MODEL_FAST", "claude-sonnet-5-5"),
  },
  /** Prefer OpenAI when both keys exist; otherwise the only configured image API. */
  imageProvider: (): ImageProvider => {
    const hasOpenAI = !!env("OPENAI_API_KEY");
    const hasMiniMax = !!env("MINIMAX_API_KEY");
    if (hasOpenAI) return "openai";
    if (hasMiniMax) return "minimax";
    return env("IMAGE_PROVIDER", "openai") === "minimax" ? "minimax" : "openai";
  },
  openai: {
    key: () => env("OPENAI_API_KEY"),
    imageModel: () => env("OPENAI_IMAGE_MODEL", "gpt-image-2.5-sunburst"),
  },
  minimax: {
    key: () => env("MINIMAX_API_KEY"),
    baseUrl: () => env("MINIMAX_BASE_URL", "https://api.minimax.io").replace(/\/+$/, ""),
    imageModel: () => env("MINIMAX_IMAGE_MODEL", "image-01"),
  },
  elevenlabs: {
    key: () => env("ELEVENLABS_API_KEY"),
    voiceId: () => env("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb"),
  },
  tripo: {
    key: () => env("TRIPO_API_KEY"),
  },
};

export function capabilities() {
  return {
    code: !!config.anthropic.key(),
    images: { openai: !!config.openai.key(), minimax: !!config.minimax.key() },
    defaultImageProvider: config.imageProvider(),
    audio: !!config.elevenlabs.key(),
    models3d: !!config.tripo.key(),
  };
}

export type Capabilities = ReturnType<typeof capabilities>;
