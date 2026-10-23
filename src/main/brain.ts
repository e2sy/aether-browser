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

/** Human-friendly error that mentions the fallback state. */
export function brainError(err: unknown): string {
  return friendlyError(err)
}
