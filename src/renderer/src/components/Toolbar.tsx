import { useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconBack, IconForward, IconReload, IconStop, IconStar, IconSidebar } from './Icons'

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
        const { history, bookmarks } = (await window.aether.omnibox.suggest(text)) as {
          history: Array<{ url: string; title: string; host: string }>
          bookmarks: Array<{ url: string; title: string }>
        }
        const out: Sug[] = [{ kind: 'search', label: `Search for “${text}”`, sub: 'address bar search', value: text }]
        if (!/\s/.test(text) && DOMAINISH.test(text)) {
          out.push({ kind: 'url', label: `Go to ${text}`, sub: 'open URL', value: text })
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

      <button className={`icon-btn ${sidebarOpen ? 'accent' : ''}`} onClick={toggleSidebar} title="AI sidebar (Ctrl+Shift+A)">
        <IconSidebar />
      </button>
    </div>
  )
}
