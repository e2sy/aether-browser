/**
 * Brain resolution: prefer the local Ollama model; optionally fall back to an
 * OpenAI-compatible cloud endpoint (Groq / OpenRouter free tiers, LM Studio…)
 * when Ollama is unreachable. Cloud is strictly opt-in and configured in Settings.
 */
import { mergedSettings } from './store'
import { ollamaHealth, pickDefaultModel, chatStream, friendlyError, OllamaMessage } from './ollama'
import type { CloudFallbackConfig } from '../shared/types'

export interface BrainChoice {
  provider: 'local' | 'cloud'
  model: string
  reason?: string
}

function cloudConfigured(c: CloudFallbackConfig | undefined): c is CloudFallbackConfig & { baseUrl: string; model: string } {
  return Boolean(c && c.enabled && c.baseUrl.trim() && c.model.trim())
}

/** Pick who answers: local model if reachable, else the configured cloud fallback. */
export async function resolveBrain(): Promise<BrainChoice | null> {
  const s = mergedSettings()
  let ollamaUp = false
  try {
    ollamaUp = await ollamaHealth()
  } catch {
    ollamaUp = false
  }
  if (ollamaUp) {
    const model = s.model || (await pickDefaultModel())
    if (model) return { provider: 'local', model }
  }
  if (cloudConfigured(s.cloudFallback)) {
    return { provider: 'cloud', model: s.cloudFallback.model.trim(), reason: ollamaUp ? undefined : 'Ollama is not reachable' }
  }
  return null
}

export async function aiStatus(): Promise<{ ollama: boolean; cloud: boolean }> {
  const s = mergedSettings()
  let ollama = false
  try {
    ollama = await ollamaHealth()
  } catch {
    ollama = false
  }
  return { ollama, cloud: cloudConfigured(s.cloudFallback) }
}

/** Map an Ollama-style message list onto OpenAI chat format (tool results become plain text). */
function toOpenAiMessages(messages: OllamaMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'user', content: `[tool result${m.tool_name ? ': ' + m.tool_name : ''}]\n${m.content}` }
    }
    return { role: m.role, content: m.content }
  })
}

/** Stream from any OpenAI-compatible /chat/completions endpoint (SSE). */
export async function* cloudChatStream(
  cfg: CloudFallbackConfig,
  model: string,
  messages: OllamaMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
    },
    body: JSON.stringify({ model, messages: toOpenAiMessages(messages), stream: true }),
    signal
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } | string }
      detail = typeof body?.error === 'string' ? body.error : body?.error?.message || ''
    } catch {
      /* ignore */
    }
    throw new Error(`Cloud fallback error ${res.status}${detail ? ': ' + detail : ''}`)
  }
  if (!res.body) throw new Error('Empty response body from cloud fallback')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        continue // partial SSE line
      }
    }
  }
}

/** Stream a chat completion from whichever brain was resolved. */
export async function* streamBrain(choice: BrainChoice, messages: OllamaMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  if (choice.provider === 'local') {
    yield* chatStream(choice.model, messages, signal)
  } else {
    const cfg = mergedSettings().cloudFallback
    yield* cloudChatStream(cfg, choice.model, messages, signal)
  }
}

/* ==================== v2.9.0 stall watchdogs ==================== */
/**
 * "Connected but never replies" had a second face: a wedged backend. Ollama
 * accepts the POST, then the model load stalls / the server hangs mid-token,
 * and the stream sits silent forever — the UI spins with no error and no
 * text. watchBrainStream() wraps any brain stream with two race clocks:
 *   • FIRST-TOKEN — nothing at all within `firstTokenMs` (generous: cold
 *     model loads on slow disks can legitimately take minutes);
 *   • IDLE — the stream stops producing for `idleMs` after it started.
 * On trigger the underlying fetch is hard-aborted through the caller's
 * controller and a descriptive error is thrown, so the chat always surfaces
 * something actionable instead of an eternal typing indicator.
 */
export const FIRST_TOKEN_TIMEOUT_MS = 180_000
export const STREAM_IDLE_TIMEOUT_MS = 120_000

export interface WatchdogOpts {
  firstTokenMs?: number
  idleMs?: number
}

export async function* watchBrainStream(
  choice: BrainChoice,
  messages: OllamaMessage[],
  ctrl: AbortController,
  opts: WatchdogOpts = {}
): AsyncGenerator<string> {
  const firstTokenMs = opts.firstTokenMs ?? FIRST_TOKEN_TIMEOUT_MS
  const idleMs = opts.idleMs ?? STREAM_IDLE_TIMEOUT_MS
  const src = streamBrain(choice, messages, ctrl.signal)
  let gotFirst = false
  while (true) {
    const budget = gotFirst ? idleMs : firstTokenMs
    let timer: ReturnType<typeof setTimeout> | undefined
    const gate = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!ctrl.signal.aborted) ctrl.abort() // hard-kill the underlying fetch
        reject(
          new Error(
            gotFirst
              ? `The model stalled — no output for ${Math.round(idleMs / 1000)}s. It may have run out of memory; try again or pick a smaller model.`
              : `The model accepted the request but produced no output within ${Math.round(firstTokenMs / 1000)}s (still loading, wedged, or out of memory). Retry, or pick a smaller model.`
          )
        )
      }, budget)
    })
    try {
      const step = await Promise.race([src.next(), gate])
      if (step.done) return
      gotFirst = true
      yield step.value
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

/** Human-friendly error that mentions the fallback state. */
export function brainError(err: unknown): string {
  return friendlyError(err)
}
