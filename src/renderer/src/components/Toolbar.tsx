import { useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconBack, IconForward, IconReload, IconStop, IconStar, IconSidebar } from './Icons'

export default function Toolbar(): JSX.Element {
  const tab = useActiveTab()
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const set = useApp((s) => s.set)
  const [omnibox, setOmnibox] = useState('')
  const [focused, setFocused] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleSidebar = (): void => {
    const next = !useApp.getState().sidebarOpen
    set({ sidebarOpen: next })
    void window.aether.ui.setSidebar(next)
  }

  const commit = (): void => {
    const text = omnibox.trim()
    if (text && tab) {
      window.aether.tabs.omnibox(tab.id, text)
      inputRef.current?.blur()
      setFocused(false)
    }
  }

  const toggleBookmark = async (): Promise<void> => {
    if (!tab || !/^https?:/i.test(tab.url)) return
    const now = await window.aether.bookmarks.toggle({ url: tab.url, title: tab.title })
    setBookmarked(now)
  }

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
          placeholder={focused ? 'Search with Aether AI or enter a URL' : ''}
          onChange={(e) => setOmnibox(e.target.value)}
          onFocus={(e) => {
            setFocused(true)
            e.currentTarget.select()
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
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
      </div>

      <button className={`icon-btn ${sidebarOpen ? 'accent' : ''}`} onClick={toggleSidebar} title="AI sidebar (Ctrl+Shift+A)">
        <IconSidebar />
      </button>
    </div>
  )
}
