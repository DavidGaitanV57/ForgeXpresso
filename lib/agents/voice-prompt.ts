/** Join cinematic lines for TTS (blank line ≈ short pause between beats). */
export function voicePromptFromLines(lines: string[]): string {
  return lines
    .map((l) => String(l || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

const VOICE_DIRECTION =
  /\b(storyteller|narrator|voice\s+in\s+(french|spanish|english|german|italian|portuguese)|reading\s+exactly|short\s+pause|gentle\s+voice|warm,?\s+gentle|speak(?:ing)?\s+(?:slowly|softly)|delivery\s+style|intonation|magical,?\s+reading)\b/i;

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith("'") && t.endsWith("'") && t.length > 1) ||
    (t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
    (t.startsWith("«") && t.endsWith("»") && t.length > 1)
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * ElevenLabs speech speaks `prompt` verbatim. LLMs often wrap the script in English
 * delivery notes ("Warm gentle storyteller…"); strip those and keep only spoken lines.
 *
 * `lines` from design.cinematic are a FALLBACK when the prompt is empty or is only
 * delivery direction — never when the user (or a regen) supplied a real script.
 * Overwriting with lines on every call made "Regenerar" ignore textarea edits.
 */
export function sanitizeVoicePrompt(prompt: string, lines?: string[]): string {
  const fromLines = lines?.length ? voicePromptFromLines(lines) : "";
  let raw = String(prompt || "").trim();
  if (!raw) return fromLines;

  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (fromLines && norm(raw) === norm(fromLines)) return fromLines;

  if (VOICE_DIRECTION.test(raw) || /^[\s\S]{0,240}:\s*['"«]/.test(raw)) {
    const quotedStart = raw.search(/:\s*['"«]/);
    if (quotedStart >= 0 && quotedStart < 280) raw = raw.slice(quotedStart + 1).trim();
    else {
      const colon = raw.indexOf(":");
      if (colon > 0 && colon < 280 && VOICE_DIRECTION.test(raw.slice(0, colon))) {
        raw = raw.slice(colon + 1).trim();
      }
    }
    raw = stripOuterQuotes(raw).trim();
    // Direction-only fluff with no usable script → cinematic lines.
    if (!raw || (VOICE_DIRECTION.test(raw) && raw.length < 80)) return fromLines || raw;
  }

  const parts = raw
    .split(/\s+\/\s+/)
    .map(stripOuterQuotes)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts.join("\n\n");

  return stripOuterQuotes(raw).trim();
}
