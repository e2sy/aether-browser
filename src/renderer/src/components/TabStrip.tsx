import { useEffect, useRef, useState } from 'react'
import type { TabMeta } from '../../../shared/types'
import { useApp } from '../state/store'
import { IconClose, IconPlus } from './Icons'

interface MenuState {
  x: number
  y: number
  tab: TabMeta
}

export default function TabStrip(): JSX.Element {
  const { tabs, activeId, maximized } = useApp()
  const set = useApp((s) => s.set)
  const dragIdx = useRef<number | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const isMac = window.aether.platform === 'darwin'
  const isWinLike = !isMac

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const favicon = (t: TabMeta): JSX.Element => {
    if (t.loading && t.id === activeId) {
      return <span className="tab-spinner" title="Loading" />
    }
    if (t.discarded) {
      return (
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            background: '#2a2d35',
            color: '#565b66',
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
          title="Unloaded to save memory"
        >
          z
        </div>
      )
    }
    if (t.favicon) {
      return <img src={t.favicon} width="14" height="14" style={{ borderRadius: 3, flexShrink: 0 }} alt="" />
    }
    return (
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: '#3a3e49',
          color: '#9aa0ae',
          fontSize: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
      >
        {/^aether:/i.test(t.url) ? '✦' : '·'}
      </div>
    )
  }

  const menuItems = (t: TabMeta): Array<{ label: string; action?: () => void; sep?: boolean; disabled?: boolean }> => [
    { label: 'Reload', action: () => window.aether.tabs.reload(t.id), disabled: t.discarded },
    { label: 'Duplicate tab', action: () => window.aether.tabs.duplicate(t.id), disabled: t.discarded },
    { label: t.pinned ? 'Unpin tab' : 'Pin tab', action: () => window.aether.tabs.setPinned(t.id, !t.pinned) },
    {
      label: t.muted ? 'Unmute tab' : 'Mute tab',
      action: () => window.aether.tabs.toggleMuted(t.id),
      disabled: t.discarded
    },
    {
      label: t.hibernated ? 'Wake tab' : 'Hibernate (light sleep)',
      action: () => window.aether.tabs.hibernate(t.id),
      disabled: t.discarded || t.id === activeId
    },
    {
      label: 'Discard (free memory)',
      action: () => window.aether.tabs.discard(t.id),
      disabled: t.discarded || t.pinned || t.id === activeId
    },
    { label: 'Move to new window', action: () => window.aether.tabs.popout(t.id), disabled: t.discarded },
    { label: '', sep: true },
    { label: 'Close tab', action: () => window.aether.tabs.close(t.id) },
    { label: 'Close other tabs', action: () => window.aether.tabs.closeOthers(t.id) },
    { label: 'Close tabs to the right', action: () => window.aether.tabs.closeRight(t.id) }
  ]

  return (
    <div className={`tabstrip ${isMac ? 'pad-mac' : ''}`}>
      <div className="tabs">
        {tabs.map((t, idx) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? 'active' : ''} ${t.pinned ? 'pinned' : ''} ${
              t.discarded ? 'discarded' : ''
            } ${t.hibernated ? 'hibernated' : ''}`}
            draggable={!t.pinned}
            onDragStart={(e) => {
              dragIdx.current = idx
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(idx))
            }}
            onDragOver={(e) => {
              if (dragIdx.current !== null && dragIdx.current !== idx) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragIdx.current
              dragIdx.current = null
              if (from !== null && from !== idx) window.aether.tabs.reorder(from, idx)
            }}
            onDragEnd={() => {
              dragIdx.current = null
            }}
            onClick={() => window.aether.tabs.activate(t.id)}
            onAuxClick={(e) => {
              if (e.button === 1) window.aether.tabs.close(t.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, tab: t })
            }}
            title={
              t.discarded
                ? `${t.title}\nUnloaded to save memory — click to reload`
                : t.hibernated
                  ? `${t.title}\nHibernated — click to wake instantly`
                  : t.muted
                    ? `${t.title}\nMuted`
                    : t.title
            }
          >
            {favicon(t)}
            {!t.pinned && (
              <span className="tab-title">
                {t.loading
                  ? 'Loading…'
                  : t.discarded
                    ? `${t.title} (unloaded)`
                    : t.hibernated
                      ? `${t.title} (asleep)`
                      : t.title || 'New Tab'}
              </span>
            )}
            {t.hibernated && <span className="tab-hibernated" title="Hibernated — wakes instantly">🌙</span>}
            {t.muted && <span className="tab-muted" title="Muted">🔇</span>}
            {t.audible && !t.muted && <span className="tab-audible" title="Playing audio">♪</span>}
            {!t.pinned && (
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  window.aether.tabs.close(t.id)
                }}
                title="Close tab"
              >
                <IconClose size={11} />
              </button>
            )}
          </div>
        ))}
        <button className="icon-btn new-tab" onClick={() => window.aether.tabs.create()} title="New tab (Ctrl+T)">
          <IconPlus size={14} />
        </button>
      </div>
      {isWinLike && (
        <div className="win-controls">
          <button onClick={() => window.aether.win.minimize()} title="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
          </button>
          <button onClick={() => window.aether.win.maximizeToggle()} title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10">
              {maximized ? (
                <g fill="none" stroke="currentColor"><rect x="0.5" y="2.5" width="7" height="7" /><path d="M2.5 2.5v-2h7v7h-2" /></g>
              ) : (
                <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
              )}
            </svg>
          </button>
          <button className="close" onClick={() => window.aether.win.close()} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
          </button>
        </div>
      )}
      <div className="tabstrip-drag" />
      {menu && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menuItems(menu.tab).map((item, i) =>
            item.sep ? (
              <div key={i} className="tab-menu-sep" />
            ) : (
              <button
                key={i}
                className="tab-menu-item"
                disabled={item.disabled}
                onClick={() => {
                  item.action?.()
                  setMenu(null)
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
