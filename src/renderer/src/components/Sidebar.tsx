import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconSend, IconSparkles, IconClose } from './Icons'
import ModelManager from './ModelManager'
import type { ChatMsg, SidebarInject, AgentEvent, SidebarMode, Macro, MacroStep } from '../../../shared/types'

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

interface AskState {
  requestId: string
  question: string
}

export default function Sidebar(): JSX.Element {
  const tab = useActiveTab()
  const settings = useApp((s) => s.settings)
  const set = useApp((s) => s.set)

  const [mode, setMode] = useState<SidebarMode>('chat')
  const [health, setHealth] = useState<{ ollama: boolean; cloud: boolean } | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState<string>('')

  // menu / toolbar can request a specific sidebar tab (e.g. Model Library)
  const sidebarMode = useApp((s) => s.sidebarMode)
  useEffect(() => {
    if (sidebarMode) {
      setMode(sidebarMode)
      useApp.getState().set({ sidebarMode: null })
    }
  }, [sidebarMode])

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
  const [askState, setAskState] = useState<AskState | null>(null)
  const [askInput, setAskInput] = useState('')
  const [record, setRecord] = useState(false)
  const [savedSteps, setSavedSteps] = useState<MacroStep[] | null>(null)
  const [macroName, setMacroName] = useState('')
  const [macros, setMacros] = useState<Macro[]>([])
  const [macrosOpen, setMacrosOpen] = useState(false)
  const canUsePage = Boolean(tab && /^https?:/i.test(tab.url))

  const loadMacros = useCallback(async (): Promise<void> => {
    try {
      setMacros((await window.aether.macros.list()) as Macro[])
    } catch {
      setMacros([])
    }
  }, [])

  // ----- init: health, models, settings -----
  useEffect(() => {
    void refresh()
    void loadMacros()
    void window.aether.settings.get().then((s) => {
      set({ settings: s })
      if (s.model) setModel(s.model)
    })
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const st = await window.aether.ai.status()
    setHealth(st)
    if (st.ollama) {
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

  // model library changed elsewhere (a pull finished) → refresh the picker
  useEffect(() => {
    return window.aether.models.onChanged(() => void refresh())
  }, [refresh])

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
        setAskState(null)
        setConfirmState(null)
        setSavedSteps(null)
        const d = ev.data as { model?: string; record?: boolean; macro?: string } | undefined
        setLog([
          {
            kind: 'info',
            text: d?.macro
              ? `Replaying macro "${d.macro}" (no model needed)`
              : `Agent started with model: ${d?.model || 'default'}${d?.record ? ' · recording' : ''}`
          }
        ])
      } else if (ev.type === 'step') {
        const res = (ev.data as { result?: string })?.result || ''
        setLog((l) => [...l, { kind: 'step', tool: ev.tool, text: describe(ev.tool, ev.args) + (res ? `  → ${res.slice(0, 160)}` : '') }])
      } else if (ev.type === 'confirm') {
        setConfirmState({ requestId: ev.requestId, tool: ev.tool || '', args: ev.args || {} })
      } else if (ev.type === 'ask_user') {
        setAskState({ requestId: ev.requestId, question: String((ev.data as string) || '') })
        setAskInput('')
      } else if (ev.type === 'done') {
        setRunning(false)
        setConfirmState(null)
        setAskState(null)
        const d = ev.data as { answer?: string; steps?: MacroStep[] } | undefined
        if (d?.steps && d.steps.length) {
          setSavedSteps(d.steps)
          if (!macroName) setMacroName('')
        }
        setLog((l) => [...l, { kind: 'answer', text: String(d?.answer || 'Done.') }])
      } else if (ev.type === 'error') {
        setRunning(false)
        setConfirmState(null)
        setAskState(null)
        setLog((l) => [...l, { kind: 'error', text: String(ev.data) }])
      } else if (ev.type === 'cancelled') {
        setRunning(false)
        setConfirmState(null)
        setAskState(null)
        setLog((l) => [...l, { kind: 'info', text: 'Agent stopped.' }])
      }
    })
  }, [macroName])

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
    setSavedSteps(null)
    await window.aether.agent.run(t, record)
  }, [task, running, record])

  const saveMacro = useCallback(async (): Promise<void> => {
    if (!savedSteps || !macroName.trim()) return
    try {
      await window.aether.macros.save(macroName.trim(), task.trim(), savedSteps as Array<{ tool: string; args: Record<string, unknown> }>)
      setSavedSteps(null)
      setMacroName('')
      setMacrosOpen(true)
      void loadMacros()
    } catch (err) {
      setLog((l) => [...l, { kind: 'error', text: 'Could not save macro: ' + String((err as Error)?.message || err) }])
    }
  }, [savedSteps, macroName, task, loadMacros])

  const runMacro = useCallback(
    async (id: string): Promise<void> => {
      if (running) return
      setRunning(true)
      setSavedSteps(null)
      try {
        await window.aether.macros.run(id)
      } catch (err) {
        setRunning(false)
        setLog((l) => [...l, { kind: 'error', text: String((err as Error)?.message || err) }])
      }
    },
    [running]
  )

  const removeMacro = useCallback(
    async (id: string): Promise<void> => {
      await window.aether.macros.remove(id)
      void loadMacros()
    },
    [loadMacros]
  )

  // ----- macro editor (edit steps / rename / reorder) -----
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSteps, setEditSteps] = useState<MacroStep[]>([])
  const [editErr, setEditErr] = useState('')

  const startEdit = useCallback((m: Macro): void => {
    setEditId(m.id)
    setEditName(m.name)
    setEditSteps(m.steps.map((s) => ({ tool: s.tool, args: { ...s.args } })))
    setEditErr('')
  }, [])

  const saveEdit = useCallback(async (): Promise<void> => {
    if (!editId) return
    try {
      await window.aether.macros.update(editId, { name: editName.trim(), steps: editSteps })
      setEditId(null)
      void loadMacros()
    } catch (err) {
      setEditErr(String((err as Error)?.message || err))
    }
  }, [editId, editName, editSteps, loadMacros])

  const updArg = (i: number, key: string, value: string | boolean): void => {
    setEditSteps((steps) =>
      steps.map((s, j) => {
        if (j !== i) return s
        let v: unknown = value
        if (typeof value === 'string') {
          if (key === 'ref' || key === 'amount') {
            const n = Number(value)
            if (value !== '' && !Number.isNaN(n)) v = n
          } else if (key === 'submit') {
            v = value === 'true'
          }
        }
        return { ...s, args: { ...s.args, [key]: v } }
      })
    )
  }
  const moveStep = (i: number, dir: number): void => {
    setEditSteps((steps) => {
      const next = [...steps]
      const j = i + dir
      if (j < 0 || j >= next.length) return steps
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  const delStep = (i: number): void => setEditSteps((steps) => steps.filter((_, j) => j !== i))
  const addStep = (tool: string): void => {
    const defaults: Record<string, Record<string, unknown>> = {
      navigate: { url: 'https://' },
      click: { ref: 1 },
      type: { ref: 1, text: '', submit: false },
      press_key: { key: 'Enter' },
      scroll: { direction: 'down', amount: 600 },
      go_back: {}
    }
    setEditSteps((steps) => [...steps, { tool, args: { ...(defaults[tool] || {}) } }])
  }

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

  const submitAnswer = useCallback((): void => {
    if (askState) {
      window.aether.agent.answer(askState.requestId, askInput)
      setAskState(null)
      setAskInput('')
    }
  }, [askState, askInput])

  const skipAnswer = useCallback((): void => {
    if (askState) {
      window.aether.agent.answer(askState.requestId, '')
      setAskState(null)
    }
  }, [askState])

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <IconSparkles size={15} />
          <span>Aether AI</span>
          <span
            className={`dot ${health === null ? 'wait' : health?.ollama ? 'ok' : health?.cloud ? 'cloud' : 'bad'}`}
            title={
              health === null
                ? 'Checking…'
                : health?.ollama
                  ? 'Ollama connected (local brain)'
                  : health?.cloud
                    ? 'Ollama offline — using cloud fallback for chat'
                    : 'Ollama not reachable'
            }
          />
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
        <button className={mode === 'models' ? 'on' : ''} onClick={() => setMode('models')} title="Model library — add any Ollama model">
          Models
        </button>
      </div>

      {health && !health.ollama && !health.cloud && (
        <div className="ollama-hint">
          <b>Ollama is not running.</b>
          <br />
          Install from <span className="code">ollama.com</span>, then:
          <div className="code block">ollama pull qwen3.5:9b</div>
          <button className="retry" onClick={() => void refresh()}>
            Retry connection
          </button>
          <button
            className="retry ghost"
            onClick={() => setMode('models')}
            title="Model library — download models in-app once Ollama is running"
          >
            Open Model Library
          </button>
        </div>
      )}

      {mode === 'models' ? (
        <ModelManager />
      ) : mode === 'chat' ? (
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
          <div className="agent-options">
            <button className={`chip small ${record ? 'on' : ''}`} onClick={() => setRecord(!record)} title="Record every action so you can replay it later without the model">
              ⏺ Record as macro
            </button>
          </div>
          {savedSteps && !running && (
            <div className="macro-save">
              <input
                className="task"
                value={macroName}
                autoFocus
                placeholder="Name this macro…"
                maxLength={60}
                onChange={(e) => setMacroName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveMacro()
                }}
              />
              <button className="macro-save-btn" onClick={() => void saveMacro()} disabled={!macroName.trim()}>
                💾 Save ({savedSteps.length} steps)
              </button>
              <button className="macro-dismiss" onClick={() => setSavedSteps(null)} title="Discard recording">
                ✕
              </button>
            </div>
          )}
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
          {askState && (
            <div className="ask">
              <div className="ask-title">
                The agent asks: <b>{askState.question}</b>
              </div>
              <div className="composer-row">
                <input
                  className="task"
                  autoFocus
                  value={askInput}
                  placeholder="Your answer…"
                  onChange={(e) => setAskInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAnswer()
                  }}
                />
                <button className="send" onClick={submitAnswer} title="Answer">
                  <IconSend size={15} />
                </button>
              </div>
              <button className="ask-skip" onClick={skipAnswer}>
                Skip — let the agent decide
              </button>
            </div>
          )}
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
          <div className="macros">
            <button className="macros-toggle" onClick={() => setMacrosOpen(!macrosOpen)}>
              <span>{macrosOpen ? '▾' : '▸'} Macros</span>
              <span className="macros-count">{macros.length}</span>
            </button>
            {macrosOpen && (
              <div className="macros-list">
                {macros.length === 0 && <div className="macros-empty">Run the agent with ⏺ Record to save a replayable macro.</div>}
                {macros.map((m) =>
                  editId === m.id ? (
                    <div key={m.id} className="macro-edit">
                      <input
                        className="macro-edit-name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Macro name"
                      />
                      {editSteps.map((st, i) => (
                        <div key={i} className="macro-step">
                          <div className="macro-step-head">
                            <span className="macro-step-tool">{st.tool}</span>
                            <span className="macro-step-btns">
                              <button disabled={i === 0} onClick={() => moveStep(i, -1)} title="Move up">↑</button>
                              <button disabled={i === editSteps.length - 1} onClick={() => moveStep(i, 1)} title="Move down">↓</button>
                              <button onClick={() => delStep(i)} title="Remove step">✕</button>
                            </span>
                          </div>
                          {Object.entries(st.args).map(([k, v]) => (
                            <label key={k} className="macro-arg">
                              <span>{k}</span>
                              {typeof v === 'boolean' ? (
                                <input type="checkbox" checked={v} onChange={(e) => updArg(i, k, e.target.checked)} />
                              ) : (
                                <input value={String(v ?? '')} onChange={(e) => updArg(i, k, e.target.value)} />
                              )}
                            </label>
                          ))}
                        </div>
                      ))}
                      <div className="macro-add">
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) addStep(e.target.value)
                            e.currentTarget.value = ''
                          }}
                        >
                          <option value="">+ Add step…</option>
                          <option value="navigate">navigate</option>
                          <option value="click">click</option>
                          <option value="type">type</option>
                          <option value="press_key">press_key</option>
                          <option value="scroll">scroll</option>
                          <option value="go_back">go_back</option>
                        </select>
                      </div>
                      {editErr && <div className="macro-edit-err">{editErr}</div>}
                      <div className="macro-edit-btns">
                        <button onClick={() => setEditId(null)}>Cancel</button>
                        <button className="primary" onClick={() => void saveEdit()}>
                          Save macro
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="macro-row">
                      <div className="macro-info">
                        <div className="macro-name">{m.name}</div>
                        <div className="macro-meta">
                          {m.steps.length} steps · {m.runs} runs
                        </div>
                      </div>
                      <button className="macro-run" disabled={running} onClick={() => void runMacro(m.id)} title="Replay on the current tab">
                        ▶
                      </button>
                      <button className="macro-run" onClick={() => startEdit(m)} title="Edit steps">
                        ✎
                      </button>
                      <button className="macro-del" onClick={() => void removeMacro(m.id)} title="Delete macro">
                        ✕
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function describe(tool?: string, args?: Record<string, unknown>): string {
  if (!tool) return ''
  if (tool === 'navigate') return `→ ${args?.url}`
  if (tool === 'click') return args?.__locator ? `→ ${String(args.__locator)}` : `→ element [${args?.ref}]`
  if (tool === 'type')
    return args?.__locator
      ? `→ ${String(args.__locator)} "${String(args?.text || '').slice(0, 40)}"`
      : `→ element [${args?.ref}] "${String(args?.text || '').slice(0, 40)}"`
  if (tool === 'find_text') return `→ "${args?.query}"`
  if (tool === 'scroll') return `→ ${args?.direction}`
  if (tool === 'read_page') return '→ extracting page'
  if (tool === 'list_tabs') return '→ listing open tabs'
  if (tool === 'screenshot') return '→ saving screenshot'
  if (tool === 'ask_user') return `→ "${String(args?.question || '').slice(0, 80)}"`
  if (tool === 'press_key') return `→ ${args?.key}`
  if (tool === 'go_back') return '→ back'
  if (tool === 'thinking') return '· thinking'
  return ''
}

function closeSidebar(): void {
  const { set } = useApp.getState()
  set({ sidebarOpen: false })
  void window.aether.ui.setSidebar(false)
}
