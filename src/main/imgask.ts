/**
 * Image-ask runtime (v2.6.0 build 20) — fetch a page image, cap it, wrap it
 * as a data URL for the sidebar's multimodal chat. Pure decisions live in
 * shared/imgask.ts; this half touches the network and Electron.
 */
import { net } from 'electron'
import {
  IMG_MAX_BYTES,
  IMG_MAX_MESSAGES,
  base64Bytes,
  dataUrlToBase64,
  pickVisionModel,
  type VisionCandidate
} from '../shared/imgask'
import { listModels, modelInfo } from './ollama'

const FETCH_TIMEOUT_MS = 15_000

/**
 * Download an image URL and return it as a data URL (for the sidebar chip +
 * the Ollama images array). http(s) only, image/* only, IMG_MAX_BYTES cap.
 * A browser-ish UA + page referer keep hotlink blocks from biting.
 */
export async function fetchImageDataUrl(rawUrl: string, referer?: string): Promise<string> {
  let url: URL
  try {
    url = new URL(String(rawUrl || ''))
  } catch {
    throw new Error('Invalid image address')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Only http(s) images can be asked about')
  }
  let res: Response
  try {
    res = await net.fetch(url.href, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        ...(referer && /^https?:/i.test(referer) ? { referer } : {})
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow'
    })
  } catch (err) {
    throw new Error('Could not download the image: ' + (err instanceof Error ? err.message : String(err)))
  }
  if (!res.ok) throw new Error(`Image request failed (${res.status})`)
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!/^image\//i.test(type)) throw new Error('That address is not an image')
  const buf = await res.arrayBuffer()
  if (buf.byteLength > IMG_MAX_BYTES) throw new Error('Image too large to analyze (5 MB limit)')
  if (buf.byteLength === 0) throw new Error('Empty image response')
  const b64 = Buffer.from(buf).toString('base64')
  return `data:${type || 'image/png'};base64,${b64}`
}

/** Cached vision-capability verdicts per model name (name → can see). */
const visionCache = new Map<string, boolean>()

async function visionCandidates(): Promise<Array<VisionCandidate & { caps?: unknown }>> {
  const names = await listModels()
  const out: VisionCandidate[] = []
  for (const name of names) {
    let caps: unknown = undefined
    if (visionCache.has(name)) {
      if (!visionCache.get(name)) continue
      out.push({ name, caps: ['vision'] })
      continue
    }
    try {
      const info = (await modelInfo(name)) as { capabilities?: unknown }
      caps = info?.capabilities
      visionCache.set(name, Array.isArray(caps) && caps.some((c) => String(c).toLowerCase() === 'vision'))
      if (visionCache.get(name)) out.push({ name, caps })
    } catch {
      out.push({ name }) // /api/show failed — let the name patterns decide
    }
  }
  return out
}

/**
 * Which installed model should answer an image question?
 * Capability-confirmed models beat name-pattern guesses; null when none.
 */
export async function resolveVisionModel(): Promise<string | null> {
  try {
    return pickVisionModel(await visionCandidates())
  } catch {
    return null
  }
}

export const NO_VISION_HINT =
  'No vision model found. Pull one and try again — e.g.  ollama pull llama3.2-vision  or  ollama pull llava'

/**
 * Convert sidebar chat messages (which may carry image data URLs on the
 * newest user turn) into Ollama messages with base64 images attached,
 * enforcing IMG_MAX_MESSAGES. Returns null when nothing carries images.
 */
export function extractChatImages(
  messages: Array<{ role: string; content: string; images?: string[] }>
): string[] | null {
  const out: string[] = []
  for (const m of messages || []) {
    for (const img of m?.images || []) {
      const b64 = dataUrlToBase64(String(img))
      if (b64 && base64Bytes(b64) <= IMG_MAX_BYTES) out.push(b64)
      if (out.length >= IMG_MAX_MESSAGES) return out.slice(0, IMG_MAX_MESSAGES)
    }
  }
  return out.length ? out.slice(0, IMG_MAX_MESSAGES) : null
}
