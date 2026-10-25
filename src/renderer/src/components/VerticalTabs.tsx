import { useEffect, useRef, useState } from 'react'
import type { TabMeta, TabGroupInfo } from '../../../shared/types'
import { useApp } from '../state/store'
import { IconClose, IconPlus } from './Icons'

/**
 * Vertical tabs (Master Plan Phase 2, item #33) — a full-height strip on the
 * window's left edge with a pinned zone, collapsible tab groups (#34) and a
 * collapsed 46px rail mode (favicon-only). The main process shifts the web
 * area right by exactly this panel's measured width (ui.setVtabWidth).
 */

const VTAB_W = 224
const VRAIL_W = 46

interface MenuState {
  x: number
  y: number
  kind: 'tab' | 'group'
  tab?: TabMeta
  group?: TabGroupInfo
}

export default function VerticalTabs(): JSX.Element {
  const { tabs, activeId, groups } = useApp()
  const set = useApp((s) => s.set)
  const [rail, setRail] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#1a73e8')
  const ref = useRef<HTMLDivElement>(null)

  // tell the main process how wide we are (it shifts the web area accordingly)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const send = (): void => {
      const w = Math.round(el.getBoundingClientRect().width)
      void window.aether.ui.setVtabWidth(w)
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    return () => {
      ro.disconnect()
      void window.aether.ui.setVtabWidth(0)
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const favicon = (t: TabMeta): JSX.Element => {
    if (t.loading && t.id === activeId) return <span className="tab-spinner" title="Loading" />
    if (t.favicon) return <img src={t.favicon} width="14" height="14" style={{ borderRadius: 3, flexShrink: 0 }} alt="" />
    return (
      <div className="vtab-fallback" title="No favicon">
        {/^aether:/i.test(t.url) ? '✦' : '·'}
      </div>
    )
  }

  const tabRow = (t: TabMeta): JSX.Element => (
    <div
      key={t.id}
      className={`vtab ${t.id === activeId ? 'active' : ''} ${t.discarded ? 'discarded' : ''} ${
        t.hibernated ? 'hibernated' : ''
      }`}
      onClick={() => window.aether.tabs.activate(t.id)}
      onAuxClick={(e) => {
        if (e.button === 1) window.aether.tabs.close(t.id)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, kind: 'tab', tab: t })
      }}
      title={t.title || 'New Tab'}
    >
      {favicon(t)}
      {!rail && (
        <>
          <span className="vtab-title">{t.loading ? 'Loading…' : t.title || 'New Tab'}</span>
          {t.muted && <span className="tab-muted" title="Muted">🔇</span>}
          {t.audible && !t.muted && <span className="tab-audible" title="Playing audio">♪</span>}
          <button
            className="vtab-close"
            onClick={(e) => {
              e.stopPropagation()
              window.aether.tabs.close(t.id)
            }}
            title="Close tab"
          >
            <IconClose size={11} />
          </button>
        </>
      )}
    </div>
  )

  const pinned = tabs.filter((t) => t.pinned)
  const rest = tabs.filter((t) => !t.pinned)
  const grouped = rest.filter((t) => t.groupId)
  const ungrouped = rest.filter((t) => !t.groupId)

  const groupTabs = (gid: string): TabMeta[] => grouped.filter((t) => t.groupId === gid)

  const submitNewGroup = (): void => {
    const name = newName.trim()
    if (name) {
      void window.aether.tabs.groupCreate(name, newColor)
    }
    setNewName('')
    setCreating(false)
  }

  const menuItems = (): Array<{ label: string; action?: () => void; sep?: boolean; disabled?: boolean }> => {
    if (menu?.kind === 'tab' && menu.tab) {
      const t = menu.tab
      return [
        { label: 'Reload', action: () => window.aether.tabs.reload(t.id), disabled: t.discarded },
        { label: t.pinned ? 'Unpin tab' : 'Pin tab', action: () => window.aether.tabs.setPinned(t.id, !t.pinned) },
        { label: 'Move to new window', action: () => window.aether.tabs.popout(t.id) },
        { label: '', sep: true },
        ...(groups.length
          ? [
              { label: 'Remove from group', action: () => void window.aether.tabs.groupAssign(t.id, null), disabled: !t.groupId },
              ...groups.map((g) => ({
                label: `Move to “${g.name}”`,
                action: () => void window.aether.tabs.groupAssign(t.id, g.id),
                disabled: t.groupId === g.id
              }))
            ]
          : []),
        { label: '', sep: true },
        { label: 'Close tab', action: () => window.aether.tabs.close(t.id) }
      ]
    }
    if (menu?.kind === 'group' && menu.group) {
      const g = menu.group
      return [
        { label: g.collapsed ? 'Expand group' : 'Collapse group', action: () => void window.aether.tabs.groupUpdate(g.id, { collapsed: !g.collapsed }) },
        { label: 'New tab in group', action: () => void window.aether.tabs.create().then((id: number) => window.aether.tabs.groupAssign(id, g.id)) },
        { label: 'Delete group (keep tabs)', action: () => void window.aether.tabs.groupDelete(g.id) }
      ]
    }
    return []
  }

  return (
    <div
      ref={ref}
      className={`vtabs ${rail ? 'rail' : ''}`}
      style={{ width: rail ? VRAIL_W : VTAB_W }}
    >
      <div className="vtabs-head">
        {!rail && <span className="vtabs-brand">Tabs</span>}
        <button
          className="icon-btn vtabs-collapse"
          onClick={() => setRail(!rail)}
          title={rail ? 'Expand tab panel' : 'Collapse to rail'}
        >
          {rail ? '»' : '«'}
        </button>
      </div>

      <div className="vtabs-scroll">
        {pinned.length > 0 && (
          <div className="vtab-zone">
            {!rail && <div className="vtab-zone-label">Pinned</div>}
            {pinned.map(tabRow)}
          </div>
        )}

        {!rail && (
          <div className="vtab-zone">
            <div className="vtab-zone-label">
              Groups
              <button className="vtab-add-group" onClick={() => setCreating(!creating)} title="New tab group">
                <IconPlus size={12} />
              </button>
            </div>
            {creating && (
              <div className="vtab-newgroup">
                <input
                  autoFocus
                  value={newName}
                  placeholder="Group name"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNewGroup()
                    if (e.key === 'Escape') setCreating(false)
                  }}
                />
                <div className="vtab-colors">
                  {['#5f6368', '#1a73e8', '#d93025', '#f9ab00', '#188038', '#d01884', '#9334e6', '#007b83'].map((c) => (
                    <button
                      key={c}
                      className={`vtab-color ${newColor === c ? 'sel' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewColor(c)}
                    />
                  ))}
                </div>
                <button className="save-btn vtab-create-btn" onClick={submitNewGroup}>
                  Create
                </button>
              </div>
            )}
            {groups.map((g) => {
              const members = groupTabs(g.id)
              return (
                <div key={g.id} className="vtab-group">
                  <div
                    className={`vtab-group-head ${g.collapsed ? 'collapsed' : ''}`}
                    onClick={() => void window.aether.tabs.groupUpdate(g.id, { collapsed: !g.collapsed })}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, kind: 'group', group: g })
                    }}
                    title={g.collapsed ? `Expand “${g.name}”` : `Collapse “${g.name}”`}
                  >
                    <span className="vtab-dot" style={{ background: g.color }} />
                    <span className="vtab-group-name">{g.name}</span>
                    <span className="vtab-count">{members.length}</span>
                    <span className="vtab-chevron">{g.collapsed ? '▸' : '▾'}</span>
                  </div>
                  {!g.collapsed && members.map(tabRow)}
                </div>
              )
            })}
          </div>
        )}

        {!rail && ungrouped.length > 0 && (
          <div className="vtab-zone">
            <div className="vtab-zone-label">Ungrouped</div>
            {ungrouped.map(tabRow)}
          </div>
        )}
        {rail && tabs.map(tabRow)}
      </div>

      <button className="icon-btn vtab-new" onClick={() => window.aether.tabs.create()} title="New tab (Ctrl+T)">
        <IconPlus size={14} />
        {!rail && <span>New tab</span>}
      </button>

      {menu && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menuItems().map((item, i) =>
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
