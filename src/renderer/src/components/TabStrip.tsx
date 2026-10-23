import { useRef } from 'react'
import { useApp } from '../state/store'
import { IconClose, IconPlus } from './Icons'

export default function TabStrip(): JSX.Element {
  const { tabs, activeId, maximized } = useApp()
  const set = useApp((s) => s.set)
  const dragIdx = useRef<number | null>(null)
  const isMac = window.aether.platform === 'darwin'
  const isWinLike = !isMac

  const favicon = (url: string, fav: string | null): JSX.Element => {
    if (fav) {
      return <img src={fav} width="14" height="14" style={{ borderRadius: 3, flexShrink: 0 }} alt="" />
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
        {/^aether:/i.test(url) ? '✦' : '·'}
      </div>
    )
  }

  return (
    <div className={`tabstrip ${isMac ? 'pad-mac' : ''}`}>
      <div className="tabs">
        {tabs.map((t, idx) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? 'active' : ''}`}
            draggable
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
            title={t.title}
          >
            {favicon(t.url, t.favicon)}
            <span className="tab-title">{t.loading ? 'Loading…' : t.title || 'New Tab'}</span>
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
    </div>
  )
}
