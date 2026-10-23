import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../state/store'
import type { CatalogModel, OllamaModelInfo, PullProgress } from '../../../shared/types'

const NAME_RE = /^[a-zA-Z0-9._\/:-]{1,120}$/

function fmtGB(bytes: number): string {
  if (!bytes) return '—'
  return (bytes / 1024 ** 3).toFixed(1) + ' GB'
}

function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

export default function ModelManager(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const set = useApp((s) => s.set)

  const [health, setHealth] = useState<boolean | null>(null)
  const [installed, setInstalled] = useState<OllamaModelInfo[]>([])
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({})
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState('')
  const [customErr, setCustomErr] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<string>('')

  const refresh = useCallback(async (): Promise<void> => {
    const h = await window.aether.ai.health()
    setHealth(h.ok)
    if (h.ok) {
      const d = await window.aether.models.detailed()
      if (d.models) setInstalled(d.models)
    }
  }, [])

  // initial load: health, installed, catalog, in-flight pulls, active model
  useEffect(() => {
    void refresh()
    void window.aether.models.catalog().then((r) => setCatalog(r.catalog || []))
    void window.aether.models.pulls().then((r) => {
      const map: Record<string, PullProgress> = {}
      for (const p of (r.pulls || []) as PullProgress[]) map[p.name] = p
      setPulls(map)
    })
    void window.aether.settings.get().then((s) => setActiveModel(s.model || ''))
  }, [refresh])

  // live pull progress (survives closing/reopening the sidebar — main keeps pulling)
  useEffect(() => {
    const offProgress = window.aether.models.onProgress((raw) => {
      const p = raw as PullProgress
      setPulls((cur) => ({ ...cur, [p.name]: p }))
      if (p.done) {
        if (!p.error && !p.cancelled) void refresh()
        window.setTimeout(() => {
          setPulls((cur) => {
            const copy = { ...cur }
            if (copy[p.name] && copy[p.name].pullId === p.pullId) delete copy[p.name]
            return copy
          })
        }, 8000)
      }
    })
    const offChanged = window.aether.models.onChanged(() => void refresh())
    return () => {
      offProgress()
      offChanged()
    }
  }, [refresh])

  const pull = useCallback(async (name: string): Promise<void> => {
    try {
      setCustomErr('')
      await window.aether.models.pull(name)
    } catch (err) {
      setCustomErr(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const pullCustom = useCallback((): void => {
    const name = custom.trim()
    if (!name) return
    if (!NAME_RE.test(name)) {
      setCustomErr('That doesn\'t look like a model tag. Try "qwen3.5:4b" or "hf.co/org/model-GGUF".')
      return
    }
    void pull(name)
    setCustom('')
  }, [custom, pull])

  const useModel = useCallback(
    (name: string): void => {
      setActiveModel(name)
      set({ settings: settings ? { ...settings, model: name || null } : settings })
      void window.aether.settings.set({ model: name || null })
    },
    [settings, set]
  )

  const removeModel = useCallback(
    async (name: string): Promise<void> => {
      try {
        setCustomErr('')
        await window.aether.models.remove(name)
        if (activeModel === name) {
          const next = installed.find((m) => m.name !== name)?.name || ''
          useModel(next)
        }
        setConfirmDel(null)
        await refresh()
      } catch (err) {
        setCustomErr(err instanceof Error ? err.message : String(err))
        setConfirmDel(null)
      }
    },
    [activeModel, installed, useModel, refresh]
  )

  const shown = catalog.filter((c) => {
    const f = filter.trim().toLowerCase()
    if (!f) return true
    return (
      c.name.toLowerCase().includes(f) ||
      c.params.toLowerCase().includes(f) ||
      c.family.toLowerCase().includes(f) ||
      c.blurb.toLowerCase().includes(f) ||
      c.tags.some((t) => t.includes(f))
    )
  })

  return (
    <div className="models">
      <div className="mm-status">
        <span className={`dot ${health === null ? 'wait' : health ? 'ok' : 'bad'}`} />
        <span>{health === null ? 'Checking…' : health ? 'Ollama connected' : 'Ollama not reachable'}</span>
        <span className="mm-host">127.0.0.1:11434</span>
        <button className="icon-btn" onClick={() => void refresh()} title="Refresh">
          ⟳
        </button>
      </div>

      {health === false && (
        <div className="ollama-hint">
          <b>Start Ollama to manage models.</b>
          <br />
          Install it from <span className="code">ollama.com</span>, then run <span className="code">ollama serve</span>.
          <button className="retry" onClick={() => void refresh()}>
            Retry connection
          </button>
        </div>
      )}

      {health !== false && (
        <>
          {/* ---- active model ---- */}
          <div className="mm-active">
            <label>Active model</label>
            <select value={activeModel} onChange={(e) => useModel(e.target.value)}>
              {installed.length === 0 && <option value="">no models installed yet</option>}
              {installed.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* ---- installed ---- */}
          <div className="mm-section">
            <div className="mm-label">INSTALLED ({installed.length})</div>
            {installed.length === 0 && (
              <div className="mm-empty">Nothing here yet — pick a model below and hit Pull.</div>
            )}
            {installed.map((m) => {
              const prog = pulls[m.name]
              const pulling = prog && !prog.done
              return (
                <div className="mm-row" key={m.name}>
                  <div className="mm-row-main">
                    <div className="mm-name">
                      {m.name}
                      {m.name === activeModel && <span className="mm-badge">active</span>}
                    </div>
                    <div className="mm-sub">
                      {m.parameterSize} · {m.quantization} · {fmtGB(m.size)}
                      {m.modifiedAt ? ` · ${fmtDate(m.modifiedAt)}` : ''}
                    </div>
                    {pulling && (
                      <div className="mm-progress">
                        <div className="mm-bar">
                          <div style={{ width: `${prog.percent ?? 0}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mm-row-actions">
                    {m.name !== activeModel && (
                      <button className="mm-btn" onClick={() => useModel(m.name)} title="Use for chat + agent">
                        Use
                      </button>
                    )}
                    {confirmDel === m.name ? (
                      <>
                        <button className="mm-btn danger" onClick={() => void removeModel(m.name)}>
                          Sure?
                        </button>
                        <button className="mm-btn" onClick={() => setConfirmDel(null)}>
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        className="mm-btn danger-ghost"
                        disabled={installed.length === 1}
                        title={installed.length === 1 ? 'Your only model' : 'Delete from disk'}
                        onClick={() => setConfirmDel(m.name)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ---- add any model ---- */}
          <div className="mm-section">
            <div className="mm-label">ADD A MODEL — ANY MODEL FROM OLLAMA</div>
            <div className="mm-custom">
              <input
                value={custom}
                placeholder="type any tag, e.g. qwen3.5:4b"
                spellCheck={false}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') pullCustom()
                }}
              />
              <button className="mm-pull" disabled={!custom.trim() || health !== true} onClick={pullCustom}>
                Pull
              </button>
            </div>
            {customErr && <div className="mm-error">{customErr}</div>}
            <input
              className="mm-filter"
              value={filter}
              placeholder="Filter the list — try “4b”…"
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="mm-catalog">
              {shown.length === 0 && <div className="mm-empty">No catalog match — type the exact tag above.</div>}
              {shown.map((c) => {
                const prog = pulls[c.name]
                const pulling = prog && !prog.done
                const failed = prog && prog.done && prog.error
                const already = installed.some((m) => m.name === c.name)
                return (
                  <div className="mm-card" key={c.name}>
                    <div className="mm-card-top">
                      <span className="mm-card-name">{c.name}</span>
                      <span className="mm-card-params">{c.params}</span>
                    </div>
                    <div className="mm-card-blurb">{c.blurb}</div>
                    <div className="mm-card-meta">
                      {c.disk} · needs ~{c.ram} RAM
                    </div>
                    {pulling ? (
                      <div className="mm-progress">
                        <div className="mm-bar">
                          <div style={{ width: `${prog.percent ?? 0}%` }} />
                        </div>
                        <div className="mm-progress-row">
                          <span>
                            {prog.status}
                            {prog.percent !== null ? ` · ${prog.percent}%` : ''}
                          </span>
                          <button className="mm-btn" onClick={() => void window.aether.models.cancel(prog.pullId)}>
                            Stop
                          </button>
                        </div>
                      </div>
                    ) : failed ? (
                      <div className="mm-error">{prog.error}</div>
                    ) : (
                      <div className="mm-card-actions">
                        <button className="mm-pull" disabled={health !== true} onClick={() => void pull(c.name)}>
                          {prog?.done && prog.status === 'success' ? 'Done ✓' : already ? 'Re-pull' : 'Pull'}
                        </button>
                        {already && !(prog && prog.done) && <span className="mm-ok">✓ installed</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mm-note">
              Any tag from <span className="code">ollama.com/library</span> works — 4B, 8B, 9B, vision, coding, custom
              fine-tunes, even <span className="code">hf.co/…</span> GGUF repos. Downloads run in the background; keep
              browsing while you pull.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
