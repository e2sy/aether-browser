/**
 * Image-ask (v2.6.0 build 20) — multimodal "Ask AI about this image".
 *
 * Pure core: deciding whether an installed Ollama model can see images and
 * which one to prefer. The runtime half (fetching the image, capping bytes,
 * building the Ollama messages with base64 images) lives in main/imgask.ts.
 *
 * Vision capability is detected two ways, in order:
 *   1. Ollama's own /api/show capabilities array containing 'vision'
 *   2. the model's name matching a known vision-family pattern below
 * The name fallback matters because plenty of local installs predate the
 * capabilities field but still run images fine (llava etc.).
 */

/** Known vision-capable model families, most-preferred first. */
export const VISION_PATTERNS: RegExp[] = [
  /llama3\.2-vision/i,
  /llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm-v/i,
  /qwen.*-vl/i,
  /qwen.*vl\b/i,
  /gemma3(?!.*text)/i,
  /pixtral/i,
  /internvl/i
]

/** Pure: does a capabilities array (from /api/show) say this model sees? */
export function capabilitiesSayVision(caps: unknown): boolean {
  return Array.isArray(caps) && caps.some((c) => String(c).toLowerCase() === 'vision')
}

/** Pure: does a model NAME look vision-capable? */
export function nameLooksVision(name: string): boolean {
  return VISION_PATTERNS.some((re) => re.test(String(name || '')))
}

export interface VisionCandidate {
  name: string
  /** capabilities array from /api/show, when available (optional) */
  caps?: unknown
}

/**
 * Pure: pick the best vision model from installed candidates.
 * Models confirmed via capabilities win over name-guesses; within each tier
 * the VISION_PATTERNS order decides. Returns null when nothing can see.
 */
export function pickVisionModel(candidates: VisionCandidate[]): string | null {
  let bestCap: string | null = null
  let bestCapRank = Number.MAX_SAFE_INTEGER
  let bestName: string | null = null
  let bestNameRank = Number.MAX_SAFE_INTEGER
  for (const c of candidates || []) {
    const name = String(c?.name || '')
    if (!name) continue
    if (capabilitiesSayVision(c?.caps)) {
      const rank = VISION_PATTERNS.findIndex((re) => re.test(name))
      const r = rank === -1 ? VISION_PATTERNS.length : rank
      if (r < bestCapRank) {
        bestCapRank = r
        bestCap = name
      }
    } else if (nameLooksVision(name)) {
      // name tier: pattern order decides, not candidate order
      const rank = VISION_PATTERNS.findIndex((re) => re.test(name))
      if (rank < bestNameRank) {
        bestNameRank = rank
        bestName = name
      }
    }
  }
  return bestCap || bestName
}

/** Hard limits for images handed to the model (runtime enforces these). */
export const IMG_MAX_BYTES = 5 * 1024 * 1024
export const IMG_MAX_MESSAGES = 4

/** Pure: strip a data: URL to raw base64 (null when not an image data URL). */
export function dataUrlToBase64(dataUrl: string): string | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || '').trim())
  return m ? m[1].replace(/\s+/g, '') : null
}

/** Pure: rough byte size of a base64 payload (no allocation). */
export function base64Bytes(b64: string): number {
  const s = String(b64 || '')
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((s.length * 3) / 4) - padding)
}
