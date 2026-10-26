/**
 * Translation model preference (v2.6.0 build 20) — pure.
 *
 * Local translation quality depends heavily on the model's multilingual
 * training. Ranked patterns, most-preferred first; anything unlisted still
 * works (first installed model) rather than failing.
 */

export const TRANSLATE_MODEL_PATTERNS: RegExp[] = [
  /qwen3/i,
  /qwen/i,
  /gemma/i,
  /aya/i,
  /mistral|mixtral/i,
  /llama3|llama/i,
  /phi/i,
  /deepseek/i
]

/**
 * Pure: pick the installed model best suited for translating.
 * Falls back to the first installed name; null when nothing is installed.
 */
export function pickTranslateModelFrom(names: string[]): string | null {
  const models = (names || []).map((n) => String(n || '')).filter(Boolean)
  if (!models.length) return null
  for (const re of TRANSLATE_MODEL_PATTERNS) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models[0]
}
