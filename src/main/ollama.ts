/**
 * Zero-dependency Ollama client (NDJSON streaming over fetch).
 * Default endpoint: http://127.0.0.1:11434 — override with AETHER_OLLAMA_URL.
 */
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
