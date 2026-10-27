import { useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'
import { IconBack, IconForward, IconReload, IconStop, IconStar, IconSidebar, IconShield } from './Icons'
import { SECURITY_LABEL, securityOf } from '../../../shared/security'
import { buildOmniboxRows, inlineComplete, pasteGoTarget, type SugRow } from '../../../shared/omnibox'
import { profileInitial, PROFILE_COLORS, type Profile } from '../../../shared/profiles'

interface ShieldsInfo {
  enabled: boolean
  aggressive: boolean
  totalBlocked: number
  siteHost: string
  siteShieldsOn: boolean
  siteBlocked: number
  topOffenders: Array<{ host: string; count: number }>
}

type Sug = SugRow

const KIND_ICON: Record<SugRow['kind'], string> = {
  search: '✦',
  url: '↗',
  history: '🕘',
  bookmark: '★'
}

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
  const [siteOpen, setSiteOpen] = useState(false)
  const [siteInfo, setSiteInfo] = useState<ShieldsInfo | null>(null)
  // v2.4.0 build 18 — inline autocomplete ghost + profile switcher
  const [ghost, setGhost] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<{ list: Profile[]; activeId: string } | null>(null)
  const [profOpen, setProfOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** monotonically increasing request id — the stale-guard for the async
   *  suggestion pipeline (see refreshSuggestions) */
  const reqSeq = useRef(0)
  const vertical = useApp((s) => s.tabOrientation) === 'left'
  const maximized = useApp((s) => s.maximized)

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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
        // v2.3.0 — the AI sidebar lives on Ctrl+E now; Ctrl+Shift+A belongs
        // to tab search and is handled by the TabSearch overlay itself.
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

  // site-info popover: security class + live shields counters for this site
  useEffect(() => {
    if (!siteOpen) return
    let dead = false
    window.aether.shields
      .state(tab?.url)
      .then((s) => {
        if (!dead) setSiteInfo(s as ShieldsInfo)
      })
      .catch(() => undefined)
    return () => {
      dead = true
    }
  }, [siteOpen, tab?.url])

  // close the site-info popover on any outside click
  useEffect(() => {
    if (!siteOpen) return
    const close = (): void => setSiteOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [siteOpen])

  // profile switcher: lazily load the registry when the popup opens
  useEffect(() => {
    if (!profOpen) return
    let dead = false
    window.aether.profiles
      .list()
      .then((r) => {
        if (!dead) setProfiles({ list: r.profiles, activeId: r.activeId })
      })
      .catch(() => undefined)
    const close = (): void => setProfOpen(false)
    window.addEventListener('mousedown', close)
    return () => {
      dead = true
      window.removeEventListener('mousedown', close)
    }
  }, [profOpen])

  // v2.9.0 — inline profile creation from the popover (no Settings detour)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(PROFILE_COLORS[1])
  const [profErr, setProfErr] = useState('')
  const createProfileInline = async (): Promise<void> => {
    setProfErr('')
    try {
      const res = (await window.aether.profiles.create(newName, newColor)) as { ok: boolean; error?: string }
      if (!res?.ok) {
        setProfErr(res?.error || 'Could not create the profile')
        return
      }
      setCreateOpen(false)
      setNewName('')
      setProfiles(null) // force a re-read on next paint of the open popup
      const r = await window.aether.profiles.list()
      setProfiles({ list: r.profiles, activeId: r.activeId })
    } catch (err) {
      setProfErr(err instanceof Error ? err.message : String(err))
    }
  }

  const sec = securityOf(tab?.url || '')

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
      // v2.1.0 STALE-GUARD: the last keystroke wins. An older, slower request
      // (remote feeds take up to 1.2s) must never clobber the dropdown with
      // rows for a query the user already left — that was the reported bug
      // ("Search for 'youtu'" showing while the input read "youtube").
      const mySeq = ++reqSeq.current
      try {
        const { history, bookmarks, suggestions } = (await window.aether.omnibox.suggest(text)) as {
          history: Array<{ url: string; title: string; host: string }>
          bookmarks: Array<{ url: string; title: string }>
          suggestions?: string[]
        }
        if (mySeq !== reqSeq.current) return
        const rows = buildOmniboxRows(text, { history, bookmarks, suggestions })
        setSugs(rows)
        setSugIdx(-1)
        // v2.4.0 — ghost type-ahead always mirrors the TOP row
        setGhost(inlineComplete(text, rows[0] ?? null))
      } catch {
        if (mySeq === reqSeq.current) {
          setSugs([])
          setGhost(null)
        }
      }
    }, 110)
  }

  const commitValue = (value?: string): void => {
    const text = (value !== undefined ? value : omnibox).trim()
    if (text && tab) {
      window.aether.tabs.omnibox(tab.id, text)
      setSugs([])
      setSugIdx(-1)
      setGhost(null)
      inputRef.current?.blur()
      setFocused(false)
    }
  }

  /** Tab accepts the inline completion (Chrome-style type-ahead). */
  const acceptGhost = (): void => {
    const full = ghost && sugs[0] ? sugs[0].value : null
    if (!full) return
    setOmnibox(full)
    setGhost(null)
    refreshSuggestions(full)
  }

  /** v2.4.0 — middle-click paste-and-go: URL-ish clipboard navigates instantly. */
  const pasteAndGo = async (): Promise<void> => {
    try {
      const text = await window.aether.clipboard.readText()
      const target = pasteGoTarget(text)
      if (target) commitValue(target)
    } catch {
      /* clipboard unavailable — ignore */
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
        <button
          className={`scheme-chip scheme-${sec.kind} ${siteOpen ? 'open' : ''}`}
          onClick={() => setSiteOpen((o) => !o)}
          title={SECURITY_LABEL[sec.kind]}
        >
          {sec.kind === 'secure' ? '🔒' : sec.kind === 'insecure' ? '⚠' : sec.kind === 'file' ? '🗂' : '✦'}
        </button>
        <div className="omni-input-wrap">
          <input
            ref={inputRef}
            value={omnibox}
            placeholder={focused ? 'Search, or enter a URL — Tab completes · ↑↓ to pick' : ''}
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
                setGhost(null)
              }, 160)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && sugs.length) {
                e.preventDefault()
                setSugIdx((i) => (i + 1) % sugs.length)
              } else if (e.key === 'ArrowUp' && sugs.length) {
                e.preventDefault()
                setSugIdx((i) => (i - 1 + sugs.length) % sugs.length)
              } else if (e.key === 'Tab' && ghost) {
                e.preventDefault()
                acceptGhost()
              } else if (e.key === 'Enter') {
                commitValue(sugIdx >= 0 && sugs[sugIdx] ? sugs[sugIdx].value : undefined)
              } else if (e.key === 'Escape') {
                setSugs([])
                setSugIdx(-1)
                setGhost(null)
                inputRef.current?.blur()
                setFocused(false)
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void pasteAndGo()
              }
            }}
            spellCheck={false}
          />
          {focused && ghost && (
            <div className="omni-ghost" aria-hidden="true">
              <span className="omni-ghost-base">{omnibox}</span>
              <span className="omni-ghost-dim">{ghost}</span>
            </div>
          )}
        </div>
        <button
          className={`icon-btn star ${bookmarked ? 'on' : ''}`}
          onClick={toggleBookmark}
          title="Bookmark (add/remove)"
          style={{ display: tab && /^https?:/i.test(tab.url) ? 'flex' : 'none' }}
        >
          <IconStar filled={bookmarked} size={14} />
        </button>
        {siteOpen && (
          <div className="site-pop" onMouseDown={(e) => e.stopPropagation()}>
            <div className="site-pop-head">{SECURITY_LABEL[sec.kind]}</div>
            {sec.host && <div className="site-pop-host">{sec.host}</div>}
            {siteInfo && (
              <div className="site-pop-stats">
                <div>
                  <b>{siteInfo.siteBlocked}</b>
                  <span>blocked on this site</span>
                </div>
                <div>
                  <b>{siteInfo.totalBlocked}</b>
                  <span>blocked in total</span>
                </div>
              </div>
            )}
            <button
              className="site-pop-link"
              onClick={() => {
                setSiteOpen(false)
                setShieldsOpen(true)
              }}
            >
              Shields &amp; tracking controls →
            </button>
          </div>
        )}

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

      <button className={`icon-btn ${sidebarOpen ? 'accent' : ''}`} onClick={toggleSidebar} title="AI sidebar (Ctrl+E)">
        <IconSidebar />
      </button>

      {/* v2.4.0 build 18 — Chrome-style profile avatar + switcher */}
      <div className="profile-wrap">
        <button
          className="profile-btn"
          style={{ background: profiles?.list.find((p) => p.id === profiles.activeId)?.color ?? '#7c8cff' }}
          onClick={() => setProfOpen((o) => !o)}
          title="Profiles"
        >
          {profileInitial(profiles?.list.find((p) => p.id === profiles?.activeId)?.name ?? 'A')}
        </button>
        {profOpen && profiles && (
          <div className="profile-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">Profiles</div>
            {profiles.list.map((p) => (
              <button
                key={p.id}
                className={`profile-row ${p.id === profiles.activeId ? 'on' : ''}`}
                onClick={() => {
                  if (p.id !== profiles.activeId) void window.aether.profiles.switch(p.id)
                }}
              >
                <span className="profile-dot" style={{ background: p.color }}>
                  {profileInitial(p.name)}
                </span>
                <span className="profile-name">{p.name}</span>
                {p.id === profiles.activeId ? (
                  <span className="profile-state">Current</span>
                ) : (
                  <span
                    className="profile-state profile-launch"
                    title={`Open “${p.name}” side-by-side in its own window`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void window.aether.profiles.launch(p.id)
                    }}
                  >
                    Open in new window
                  </span>
                )}
              </button>
            ))}
            <div className="profile-menu-sep" />
            {createOpen ? (
              <div className="profile-create" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  value={newName}
                  autoFocus
                  maxLength={40}
                  placeholder="Profile name (e.g. Work)"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createProfileInline()
                    if (e.key === 'Escape') setCreateOpen(false)
                  }}
                />
                <div className="profile-colors">
                  {PROFILE_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`profile-swatch ${newColor === c ? 'on' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewColor(c)}
                      title={`Color ${PROFILE_COLORS.indexOf(c) + 1}`}
                    />
                  ))}
                </div>
                {profErr && <div className="profile-err">{profErr}</div>}
                <div className="profile-create-btns">
                  <button className="profile-cancel" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </button>
                  <button className="profile-ok" disabled={!newName.trim()} onClick={() => void createProfileInline()}>
                    Create profile
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="profile-row"
                onClick={() => {
                  setProfErr('')
                  setCreateOpen(true)
                }}
              >
                <span className="profile-dot add">＋</span>
                <span className="profile-name">New profile…</span>
                <span className="profile-state" />
              </button>
            )}
            <button
              className="profile-row"
              onClick={() => {
                setProfOpen(false)
                if (tab) window.aether.tabs.omnibox(tab.id, 'aether://settings')
              }}
            >
              <span className="profile-dot gear">⚙</span>
              <span className="profile-name">Manage profiles</span>
              <span className="profile-state" />
            </button>
          </div>
        )}
      </div>

      {/* v2.1.0 — in vertical-tab mode the strip is gone, so the — □ × cluster
          lives inline at the right edge of the toolbar row: full-height,
          flush with the window edge, same geometry as the TabStrip cluster.
          The old absolute-positioned .win-controls-float box (top:6 right:8)
          hovered detached over the chrome — the "buttons in the wrong place". */}
      {vertical && window.aether.platform !== 'darwin' && (
        <div className="win-controls">
          <button onClick={() => window.aether.win.minimize()} title="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth={1.1} /></svg>
          </button>
          <button onClick={() => window.aether.win.maximizeToggle()} title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10">
              {maximized ? (
                <g fill="none" stroke="currentColor" strokeWidth={1.1}><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></g>
              ) : (
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth={1.1} />
              )}
            </svg>
          </button>
          <button className="close" onClick={() => window.aether.win.close()} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth={1.1} /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
