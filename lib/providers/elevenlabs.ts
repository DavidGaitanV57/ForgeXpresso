import { config } from "../config";
import { estimateElevenLabsUsd } from "../usage";
import { fetchWithRetry, ProviderError } from "./http";

const BASE = "https://api.elevenlabs.io/v1";
const FORMAT = "mp3_44100_128";

export interface AudioResult {
  data: Buffer;
  estimatedUsd: number;
  ms: number;
  audioSec: number;
}

function headers() {
  const key = config.elevenlabs.key();
  if (!key) throw new ProviderError("ElevenLabs", 401, "falta ELEVENLABS_API_KEY");
  return { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" };
}

async function audio(url: string, body: unknown, kind: "music" | "sfx" | "voice", durationSec: number, chars = 0): Promise<AudioResult> {
  const t0 = Date.now();
  const res = await fetchWithRetry(url, { method: "POST", headers: headers(), body: JSON.stringify(body) }, { provider: "ElevenLabs", timeoutMs: 300_000 });
  return {
    data: Buffer.from(await res.arrayBuffer()),
    estimatedUsd: estimateElevenLabsUsd(kind, durationSec, chars),
    ms: Date.now() - t0,
    audioSec: durationSec,
  };
}

export async function soundEffect(prompt: string, durationSec: number, loop: boolean) {
  const duration = Math.min(30, Math.max(0.5, durationSec || 1.5));
  const url = `${BASE}/sound-generation?output_format=${FORMAT}`;
  try {
    return await audio(url, { text: prompt, duration_seconds: duration, prompt_influence: 0.6, loop, model_id: "eleven_text_to_sound_v2" }, "sfx", duration);
  } catch (e) {
    if (e instanceof ProviderError && e.status === 422) return audio(url, { text: prompt, duration_seconds: duration, prompt_influence: 0.6 }, "sfx", duration);
    throw e;
  }
}

export async function music(prompt: string, durationSec: number) {
  const sec = Math.min(180, Math.max(15, durationSec || 60));
  const ms = Math.round(sec * 1000);
  try {
    return await audio(
      `${BASE}/music?output_format=${FORMAT}`,
      {
        prompt: `${prompt}. Instrumental video game soundtrack, seamless loop, no vocals.`,
        music_length_ms: ms,
        model_id: "music_v1",
        force_instrumental: true,
      },
      "music",
      sec,
    );
  } catch (e) {
    // Accounts without the music API still get a looping ambience bed.
    if (e instanceof ProviderError && e.status !== 401) return soundEffect(`${prompt}, looping instrumental game music`, 22, true);
    throw e;
  }
}

export async function speech(text: string) {
  const approxSec = Math.max(2, text.length / 14);
  return audio(
    `${BASE}/text-to-speech/${encodeURIComponent(config.elevenlabs.voiceId())}?output_format=${FORMAT}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 },
    },
    "voice",
    approxSec,
    text.length,
  );
}
