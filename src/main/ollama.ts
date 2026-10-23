/**
 * Zero-dependency Ollama client (NDJSON streaming over fetch).
 * Default endpoint: http://127.0.0.1:11434 — override with AETHER_OLLAMA_URL.
 */
import type { OllamaModelInfo } from '../shared/types'

const BASE = process.env.AETHER_OLLAMA_URL || 'http://127.0.0.1:11434'

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>
  tool_name?: string
  images?: string[]
}

export interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export async function ollamaHealth(timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

export async function listModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
  const json = (await res.json()) as { models?: Array<{ name: string }> }
  return (json.models || []).map((m) => m.name)
}

/** Pick a sensible default model for chat + tool calling. */
export async function pickDefaultModel(): Promise<string | null> {
  try {
    const models = await listModels()
    if (!models.length) return null
    const preferences = [/qwen3\.5.*9b/i, /qwen/i, /hermes/i, /llama3/i, /gemma/i]
    for (const re of preferences) {
      const hit = models.find((m) => re.test(m))
      if (hit) return hit
    }
    return models[0]
  } catch {
    return null
  }
}

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)) {
    return 'Ollama is not reachable at ' + BASE + '. Install it from https://ollama.com, then run:  ollama serve   and pull a model:  ollama pull qwen3.5:9b'
  }
  return msg
}

async function readError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: string }
    detail = body?.error || ''
  } catch {
    /* ignore */
  }
  return `Ollama error ${res.status}${detail ? ': ' + detail : ''}`
}

/** Streaming chat. Yields content deltas. */
export async function* chatStream(
  model: string,
  messages: OllamaMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  })
  if (!res.ok) throw new Error(await readError(res))
  if (!res.body) throw new Error('Empty response body from Ollama')

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
      if (!line) continue
      let parsed: { message?: { content?: string }; error?: string }
      try {
        parsed = JSON.parse(line)
      } catch {
        continue // skip partial / malformed lines
      }
      if (parsed.error) throw new Error(parsed.error)
      const content = parsed.message?.content
      if (content) yield content
    }
  }
}

/** Non-streaming chat, used by the agent loop (needs complete tool_calls). */
export async function chatOnce(
  model: string,
  messages: OllamaMessage[],
  tools?: OllamaTool[],
  signal?: AbortSignal
): Promise<{ message: OllamaMessage }> {
  const body: Record<string, unknown> = { model, messages, stream: false }
  if (tools && tools.length) body.tools = tools
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw new Error(await readError(res))
  const json = (await res.json()) as { message?: OllamaMessage; error?: string }
  if (json.error) throw new Error(json.error)
  if (!json.message) throw new Error('Ollama returned no message')
  return { message: json.message }
}

/* ==================== model management ==================== */

interface TagModel {
  name: string
  size: number
  modified_at: string
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}

/** Full model list with on-disk size, parameter count and quantization. */
export async function listModelsDetailed(): Promise<OllamaModelInfo[]> {
  const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
  const json = (await res.json()) as { models?: TagModel[] }
  return (json.models || []).map((m) => ({
    name: m.name,
    size: Number(m.size || 0),
    parameterSize: m.details?.parameter_size || '?',
    quantization: m.details?.quantization_level || '?',
    family: m.details?.family || '?',
    modifiedAt: m.modified_at || ''
  }))
}

/** Capabilities / metadata for one model (POST /api/show). */
export async function modelInfo(name: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name }),
    signal: AbortSignal.timeout(6000)
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as Record<string, unknown>
}

/** Remove a model from disk (DELETE /api/delete). */
export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name }),
    signal: AbortSignal.timeout(10000)
  })
  if (!res.ok) throw new Error(await readError(res))
}

/** Models currently loaded in memory (GET /api/ps). */
export async function runningModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/ps`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
  const json = (await res.json()) as { models?: Array<{ name: string }> }
  return (json.models || []).map((m) => m.name)
}

export interface PullEvent {
  status: string
  total: number
  completed: number
  percent: number | null
}

/**
 * Pull (download) a model — any tag from ollama.com or an hf.co GGUF repo.
 * Streams NDJSON progress; resolves on `success`, throws on Ollama errors.
 */
export async function pullModel(
  name: string,
  onProgress: (evt: PullEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal
  })
  if (!res.ok) throw new Error(await readError(res))
  if (!res.body) throw new Error('Empty response body from Ollama')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let lastPercent: number | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let evt: { status?: string; total?: number; completed?: number; error?: string }
      try {
        evt = JSON.parse(line)
      } catch {
        continue
      }
      if (evt.error) throw new Error(evt.error)
      const total = Number(evt.total || 0)
      const completed = Number(evt.completed || 0)
      if (total > 0) lastPercent = Math.min(100, Math.round((completed / total) * 100))
      const status = evt.status || ''
      if (/^success$/i.test(status)) return
      onProgress({ status, total, completed, percent: total > 0 ? lastPercent : lastPercent })
    }
  }
}
