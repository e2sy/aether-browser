import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconSend, IconSparkles, IconClose } from './Icons'
import type { ChatMsg, SidebarInject, AgentEvent } from '../../../shared/types'

interface LogEntry {
  kind: 'step' | 'info' | 'error' | 'answer'
  tool?: string
  text: string
}

interface ConfirmState {
  requestId: string
  tool: string
  args: Record<string, unknown>
}

export default function Sidebar(): JSX.Element {
  const tab = useActiveTab()
  const settings = useApp((s) => s.settings)
  const set = useApp((s) => s.set)

  const [mode, setMode] = useState<'chat' | 'agent'>('chat')
  const [health, setHealth] = useState<boolean | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState<string>('')

  // chat state
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [usePage, setUsePage] = useState(true)
  const [reqId, setReqId] = useState<string | null>(null)
  const chatScroll = useRef<HTMLDivElement>(null)

  // agent state
  const [task, setTask] = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [agentReq, setAgentReq] = useState<string | null>(null)
  const canUsePage = Boolean(tab && /^https?:/i.test(tab.url))

  // ----- init: health, models, settings -----
  useEffect(() => {
    void refresh()
    void window.aether.settings.get().then((s) => {
      set({ settings: s })
      if (s.model) setModel(s.model)
    })
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const h = await window.aether.ai.health()
    setHealth(h.ok)
    if (h.ok) {
      const m = await window.aether.ai.models()
      setModels(m.models)
      setModel((cur) => {
        if (cur && m.models.includes(cur)) return cur
        const preferred = m.models.find((x: string) => /qwen3|9b/i.test(x)) || m.models[0] || ''
        if (preferred) void window.aether.settings.set({ model: preferred })
        return preferred
      })
    }
  }, [])

  useEffect(() => {
    chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight })
  }, [messages, streaming])

  // ----- context menu → prefill -----
  useEffect(() => {
    return window.aether.state.onSidebarInject((data) => {
      const inj = data as SidebarInject
      setMode('chat')
      setInput((cur) => (cur ? cur + '\n\n' + inj.text : inj.text))
    })
  }, [])

  // ----- agent events -----
  useEffect(() => {
    return window.aether.agent.onEvent((raw) => {
      const ev = raw as AgentEvent
      if (ev.type === 'start') {
        setAgentReq(ev.requestId)
        setRunning(true)
        setLog([{ kind: 'info', text: `Agent started with model: ${(ev.data as { model?: string })?.model || 'default'}` }])
      } else if (ev.type === 'step') {
        const res = (ev.data as { result?: string })?.result || ''
        setLog((l) => [...l, { kind: 'step', tool: ev.tool, text: describe(ev.tool, ev.args) + (res ? `  → ${res.slice(0, 160)}` : '') }])
      } else if (ev.type === 'confirm') {
        setConfirmState({ requestId: ev.requestId, tool: ev.tool || '', args: ev.args || {} })
      } else if (ev.type === 'done') {
        setRunning(false)
        setConfirmState(null)
        setLog((l) => [...l, { kind: 'answer', text: String((ev.data as { answer?: string })?.answer || 'Done.') }])
      } else if (ev.type === 'error') {
        setRunning(false)
        setConfirmState(null)
        setLog((l) => [...l, { kind: 'error', text: String(ev.data) }])
      } else if (ev.type === 'cancelled') {
        setRunning(false)
        setConfirmState(null)
        setLog((l) => [...l, { kind: 'info', text: 'Agent stopped.' }])
      }
    })
  }, [])

  // ----- chat send -----
  const send = useCallback(async (): Promise<void> => {
    const text = input.trim()
    if (!text || streaming) return
    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setInput('')
    setStreaming(true)
    setMessages([...history, { role: 'assistant', content: '' }])

    const req = window.aether.ai.chat(history, usePage && canUsePage, model || undefined)
    setReqId(req.requestId)
    req.onData((chunk) => {
      if (chunk.delta) {
        setMessages((m) => {
          const copy = [...m]
          const last = copy[copy.length - 1]
          if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + String(chunk.delta) }
          return copy
        })
      }
    })
    const res = await req.result
    setStreaming(false)
    setReqId(null)
    if (res.error) {
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ ' + String(res.error) }])
    } else if (res.content) {
      setMessages((m) => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant' && !last.content) copy[copy.length - 1] = { ...last, content: String(res.content) }
        return copy
      })
    }
  }, [input, messages, streaming, usePage, canUsePage, model])

  const stop = useCallback((): void => {
    if (reqId) void window.aether.ai.abort(reqId)
    setStreaming(false)
  }, [reqId])

  // ----- agent run -----
  const runAgent = useCallback(async (): Promise<void> => {
    const t = task.trim()
    if (!t || running) return
    setRunning(true)
    await window.aether.agent.run(t)
  }, [task, running])

  const cancelAgent = useCallback((): void => {
    if (agentReq) window.aether.agent.cancel(agentReq)
    setRunning(false)
    setConfirmState(null)
  }, [agentReq])

  const respond = useCallback(
    (approved: boolean): void => {
      if (confirmState) {
        window.aether.agent.respond(confirmState.requestId, approved)
        setConfirmState(null)
      }
    },
    [confirmState]
  )

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <IconSparkles size={15} />
          <span>Aether AI</span>
          <span className={`dot ${health === null ? 'wait' : health ? 'ok' : 'bad'}`} title={health ? 'Ollama connected' : 'Ollama not reachable'} />
        </div>
        <div className="sidebar-head-actions">
          <select
            className="model-select"
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              void window.aether.settings.set({ model: e.target.value })
            }}
            title="Local model"
          >
            {models.length === 0 && <option value="">no models</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button className="icon-btn" onClick={() => void refresh()} title="Reconnect to Ollama">
            ⟳
          </button>
          <button className="icon-btn" onClick={closeSidebar} title="Close sidebar">
            <IconClose size={13} />
          </button>
        </div>
      </div>

      <div className="mode-tabs">
        <button className={mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}>
          Chat
        </button>
        <button className={mode === 'agent' ? 'on' : ''} onClick={() => setMode('agent')}>
          Agent
        </button>
      </div>

      {health === false && (
        <div className="ollama-hint">
          <b>Ollama is not running.</b>
          <br />
          Install from <span className="code">ollama.com</span>, then:
          <div className="code block">ollama pull qwen3.5:9b</div>
          <button className="retry" onClick={() => void refresh()}>
            Retry connection
          </button>
        </div>
      )}

      {mode === 'chat' ? (
        <>
          <div className="chat" ref={chatScroll}>
            {messages.length === 0 && (
              <div className="empty">
                <IconSparkles size={28} />
                <p>Ask anything about the page you're on — or just chat.</p>
                {canUsePage && <p className="dim">Page context is ON: I can see "{tab?.title}".</p>}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
                {m.role === 'assistant' && i === messages.length - 1 && streaming && <span className="caret" />}
              </div>
            ))}
          </div>
          <div className="composer">
            {canUsePage && (
              <button
                className={`chip ${usePage ? 'on' : ''}`}
                onClick={() => setUsePage(!usePage)}
                title="Include current page content in the AI's context"
              >
                📄 Use this page {usePage ? 'ON' : 'OFF'}
              </button>
            )}
            <div className="composer-row">
              <textarea
                value={input}
                placeholder="Ask about this page, or anything…"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
              />
              {streaming ? (
                <button className="send stop" onClick={stop} title="Stop">
                  ■
                </button>
              ) : (
                <button className="send" onClick={() => void send()} disabled={!input.trim()} title="Send">
                  <IconSend size={15} />
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="agent">
          <div className="composer-row">
            <input
              className="task"
              value={task}
              placeholder='e.g. "Search for open-source AI browsers and summarize the top 3"'
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runAgent()
              }}
            />
            {running ? (
              <button className="send stop" onClick={cancelAgent} title="Stop agent">
                ■
              </button>
            ) : (
              <button className="send" onClick={() => void runAgent()} disabled={!task.trim()} title="Run agent">
                <IconSend size={15} />
              </button>
            )}
          </div>
          {settings?.confirmAgentActions === false && (
            <div className="warn-line">⚠ Confirm-each-action is OFF in settings — the agent acts without asking.</div>
          )}
          <div className="agent-log">
            {log.length === 0 && !running && (
              <div className="empty">
                <p>The agent can navigate, click, type and read pages for you.</p>
                <p className="dim">It asks for confirmation before every action by default.</p>
              </div>
            )}
            {log.map((l, i) => (
              <div key={i} className={`log ${l.kind}`}>
                {l.kind === 'step' && <span className="tool">{l.tool}</span>}
                <span>{l.text}</span>
              </div>
            ))}
          </div>
          {confirmState && (
            <div className="confirm">
              <div className="confirm-title">
                Allow <b>{confirmState.tool}</b>?
              </div>
              <pre>{JSON.stringify(confirmState.args, null, 1)}</pre>
              <div className="confirm-row">
                <button className="deny" onClick={() => respond(false)}>
                  Deny
                </button>
                <button className="allow" onClick={() => respond(true)}>
                  Allow
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function describe(tool?: string, args?: Record<string, unknown>): string {
  if (!tool) return ''
  if (tool === 'navigate') return `→ ${args?.url}`
  if (tool === 'click') return `→ element [${args?.ref}]`
  if (tool === 'type') return `→ element [${args?.ref}] "${String(args?.text || '').slice(0, 40)}"`
  if (tool === 'find_text') return `→ "${args?.query}"`
  if (tool === 'scroll') return `→ ${args?.direction}`
  if (tool === 'read_page') return '→ extracting page'
  return ''
}

function closeSidebar(): void {
  const { set } = useApp.getState()
  set({ sidebarOpen: false })
  void window.aether.ui.setSidebar(false)
}
