import { useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconBack, IconForward, IconReload, IconStop, IconStar, IconSidebar, IconShield } from './Icons'

interface ShieldsInfo {
  enabled: boolean
  aggressive: boolean
  totalBlocked: number
  siteHost: string
  siteShieldsOn: boolean
  siteBlocked: number
  topOffenders: Array<{ host: string; count: number }>
}

interface Sug {
  kind: 'search' | 'url' | 'history' | 'bookmark'
  label: string
  sub?: string
  value: string
}

const KIND_ICON: Record<Sug['kind'], string> = {
  search: '✦',
  url: '↗',
  history: '🕘',
  bookmark: '★'
}

const DOMAINISH = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/

export default function Toolbar(): JSX.Element {
  const tab = useActiveTab()
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const set = useApp((s) => s.set)
  const [omnibox, setOmnibox] = useState('')
  const [focused, setFocused] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [sugs, setSugs] = useState<Sug[]>([])
  const [sugIdx, setSugIdx] = useState(-1)
  const [shields, setShields] = useState<ShieldsInfo | null>(null)
  const [shieldsOpen, setShieldsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!focused) setOmnibox(tab?.url === 'aether://newtab' ? '' : tab?.url || '')
    setBookmarked(false)
    if (tab && /^https?:/i.test(tab.url)) {
      window.aether.bookmarks.is(tab.url).then(setBookmarked)
    }
  }, [tab?.id, tab?.url, focused])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        toggleSidebar()
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        void window.aether.tabs.zoom('in')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        void window.aether.tabs.zoom('out')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        void window.aether.tabs.zoom('reset')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // menu → Focus Address Bar (works even when a web page has keyboard focus)
  useEffect(() => {
    const unsub = window.aether.state.onOmniboxFocus(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return unsub
  }, [])

  // shields popup: live counters for the current site (Brave-style)
  useEffect(() => {
    if (!shieldsOpen) return
    let dead = false
    const load = (): void => {
      window.aether.shields
        .state(tab?.url)
        .then((s) => {
          if (!dead) setShields(s as ShieldsInfo)
        })
        .catch(() => undefined)
    }
    load()
    const timer = setInterval(load, 1500) // blocked counts tick live
    return () => {
      dead = true
      clearInterval(timer)
    }
  }, [shieldsOpen, tab?.url])

  const toggleSiteShields = async (): Promise<void> => {
    if (!shields || !tab) return
    await window.aether.shields.toggleSite(tab.url, !shields.siteShieldsOn)
    setShields({ ...shields, siteShieldsOn: !shields.siteShieldsOn })
    // Brave parity: applying a shields change reloads the page
    window.aether.tabs.reload(tab.id)
  }

  const toggleAggressive = async (): Promise<void> => {
    if (!shields) return
    const next = !shields.aggressive
    await window.aether.settings.set({ shieldsAggressive: next })
    setShields({ ...shields, aggressive: next })
    if (tab) window.aether.tabs.reload(tab.id) // scriptlet tier applies on next load
  }

  const toggleSidebar = (): void => {
    const next = !useApp.getState().sidebarOpen
    set({ sidebarOpen: next })
    void window.aether.ui.setSidebar(next)
  }

  const refreshSuggestions = (q: string): void => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    const text = q.trim()
    if (!text) {
      setSugs([])
      setSugIdx(-1)
      return
    }
    suggestTimer.current = setTimeout(async () => {
      try {
        const { history, bookmarks, suggestions } = (await window.aether.omnibox.suggest(text)) as {
          history: Array<{ url: string; title: string; host: string }>
          bookmarks: Array<{ url: string; title: string }>
          suggestions?: string[]
        }
        const out: Sug[] = [{ kind: 'search', label: `Search for “${text}”`, sub: 'address bar search', value: text }]
        if (!/\s/.test(text) && DOMAINISH.test(text)) {
          out.push({ kind: 'url', label: `Go to ${text}`, sub: 'open URL', value: text })
        }
        // v1.3.0 — remote search suggestions from the Aether Search feed
        for (const s of suggestions || []) {
          if (out.length >= 6) break
          if (s.toLowerCase() === text.toLowerCase()) continue
          out.push({ kind: 'search', label: s, sub: 'search suggestion', value: s })
        }
        for (const h of history) {
          if (out.length >= 7) break
          out.push({ kind: 'history', label: h.title || h.url, sub: h.host, value: h.url })
        }
        for (const b of bookmarks) {
          if (out.some((s) => s.value === b.url)) continue
          if (out.length >= 8) break
          out.push({ kind: 'bookmark', label: b.title || b.url, sub: 'bookmark', value: b.url })
        }
        setSugs(out)
        setSugIdx(-1)
      } catch {
        setSugs([])
      }
    }, 110)
  }

  const commitValue = (value?: string): void => {
    const text = (value !== undefined ? value : omnibox).trim()
    if (text && tab) {
      window.aether.tabs.omnibox(tab.id, text)
      setSugs([])
      setSugIdx(-1)
      inputRef.current?.blur()
      setFocused(false)
    }
  }

  const toggleBookmark = async (): Promise<void> => {
    if (!tab || !/^https?:/i.test(tab.url)) return
    const now = await window.aether.bookmarks.toggle({ url: tab.url, title: tab.title })
    setBookmarked(now)
  }

  const pickSug = (s: Sug): void => commitValue(s.value)

  return (
    <div className="toolbar">
      <button className="icon-btn" disabled={!tab?.canGoBack} onClick={() => tab && window.aether.tabs.back(tab.id)} title="Back (Alt+←)">
        <IconBack />
      </button>
      <button className="icon-btn" disabled={!tab?.canGoForward} onClick={() => tab && window.aether.tabs.forward(tab.id)} title="Forward (Alt+→)">
        <IconForward />
      </button>
      {tab?.loading ? (
        <button className="icon-btn" onClick={() => tab && window.aether.tabs.stop(tab.id)} title="Stop">
          <IconStop />
        </button>
      ) : (
        <button className="icon-btn" onClick={() => tab && window.aether.tabs.reload(tab.id)} title="Reload (Ctrl+R)">
          <IconReload />
        </button>
      )}

      <div className={`omnibox ${focused ? 'focused' : ''}`}>
        <span className={`scheme ${tab && /^https:/i.test(tab.url) ? 'secure' : ''}`}>
          {tab && /^https:/i.test(tab.url) ? '🔒' : tab && /^http:/i.test(tab.url) ? '⚠' : '✦'}
        </span>
        <input
          ref={inputRef}
          value={omnibox}
          placeholder={focused ? 'Search, or enter a URL — ↑↓ to pick a suggestion' : ''}
          onChange={(e) => {
            setOmnibox(e.target.value)
            refreshSuggestions(e.target.value)
          }}
          onFocus={(e) => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            setFocused(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => {
              setFocused(false)
              setSugs([])
              setSugIdx(-1)
            }, 160)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && sugs.length) {
              e.preventDefault()
              setSugIdx((i) => (i + 1) % sugs.length)
            } else if (e.key === 'ArrowUp' && sugs.length) {
              e.preventDefault()
              setSugIdx((i) => (i - 1 + sugs.length) % sugs.length)
            } else if (e.key === 'Enter') {
              commitValue(sugIdx >= 0 && sugs[sugIdx] ? sugs[sugIdx].value : undefined)
            } else if (e.key === 'Escape') {
              setSugs([])
              setSugIdx(-1)
              inputRef.current?.blur()
              setFocused(false)
            }
          }}
          spellCheck={false}
        />
        <button
          className={`icon-btn star ${bookmarked ? 'on' : ''}`}
          onClick={toggleBookmark}
          title="Bookmark (add/remove)"
          style={{ display: tab && /^https?:/i.test(tab.url) ? 'flex' : 'none' }}
        >
          <IconStar filled={bookmarked} size={14} />
        </button>
        {focused && sugs.length > 0 && (
          <div className="omni-suggest">
            {sugs.map((s, i) => (
              <div
                key={`${s.kind}-${s.value}-${i}`}
                className={`sug-item ${i === sugIdx ? 'on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickSug(s)
                }}
                onMouseEnter={() => setSugIdx(i)}
              >
                <span className={`sug-ico ${s.kind}`}>{KIND_ICON[s.kind]}</span>
                <span className="sug-label">{s.label}</span>
                {s.sub && <span className="sug-sub">{s.sub}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <browser-action-list />

      <div className="shields-wrap">
        <button
          className={`icon-btn shields-btn ${shields && shields.enabled && shields.siteShieldsOn ? 'on' : 'off'}`}
          onClick={() => setShieldsOpen((o) => !o)}
          title="Shields — ads & trackers blocked"
        >
          <IconShield size={15} />
          {shields && shields.siteBlocked > 0 && <span className="shields-count">{shields.siteBlocked > 99 ? '99+' : shields.siteBlocked}</span>}
        </button>
        {shieldsOpen && shields && (
          <div className="shields-popup">
            <div className="shields-head">
              <span className={`shields-dot ${shields.enabled && shields.siteShieldsOn ? 'up' : 'down'}`} />
              <div>
                <div className="shields-title">{shields.enabled && shields.siteShieldsOn ? 'Shields are UP' : 'Shields are DOWN'}</div>
                <div className="shields-host">{shields.siteHost || 'this page'}</div>
              </div>
            </div>
            <button className={`shields-toggle ${shields.siteShieldsOn ? 'on' : ''}`} onClick={toggleSiteShields} disabled={!shields.siteHost}>
              <span className="knob" />
              <span>{shields.siteShieldsOn ? 'Turn shields off for this site' : 'Turn shields on for this site'}</span>
            </button>
            <button className={`shields-toggle ${shields.aggressive ? 'on' : ''}`} onClick={toggleAggressive} title="Also inject anti-adblock scriptlets. Stronger blocking, but can break heavy sites like YouTube — the per-site toggle recovers them.">
              <span className="knob" />
              <span>Aggressive mode (anti-adblock scriptlets)</span>
            </button>
            <div className="shields-stats">
              <div className="shields-stat">
                <b>{shields.siteBlocked}</b>
                <span>blocked on this site</span>
              </div>
              <div className="shields-stat">
                <b>{shields.totalBlocked}</b>
                <span>blocked in total</span>
              </div>
            </div>
            {shields.topOffenders.length > 0 && (
              <div className="shields-offenders">
                <div className="shields-sub">Top blocked</div>
                {shields.topOffenders.map((o) => (
                  <div key={o.host} className="shields-offender">
                    <span>{o.host}</span>
                    <b>{o.count}</b>
                  </div>
                ))}
              </div>
            )}
            <button
              className="shields-link"
              onClick={() => {
                setShieldsOpen(false)
                if (tab) window.aether.tabs.omnibox(tab.id, 'aether://settings')
              }}
            >
              Filter lists &amp; settings →
            </button>
          </div>
        )}
      </div>

      <button className={`icon-btn ${sidebarOpen ? 'accent' : ''}`} onClick={toggleSidebar} title="AI sidebar (Ctrl+Shift+A)">
        <IconSidebar />
      </button>
    </div>
  )
}
