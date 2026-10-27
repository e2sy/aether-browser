/**
 * Side panels — main-process store (v2.10.0).
 *
 * User-pinned sites for the side-panel rail, persisted in panels.json via the
 * same debounced JsonStore every other module uses. Validation lives in
 * shared/panels.ts; this module is the thin runtime wrapper + the IPC-facing
 * API surface (list/add/rename/remove).
 */
import { JsonStore } from './store'
import { pushPanel, sanitizePanels, makePanel, type Panel } from '../shared/panels'

export interface PanelStore {
  panels: Panel[]
}

export const panelsStore = new JsonStore<PanelStore>('panels.json', { panels: [] })

// one-time sanitize of whatever is on disk
panelsStore.data = { panels: sanitizePanels((panelsStore.data as PanelStore | undefined)?.panels) }

export function listPanels(): Panel[] {
  return panelsStore.data.panels
}

/** Add a panel (dedupe by URL, cap 12). Returns null for unusable input. */
export function addPanel(url: unknown, title: unknown): Panel | null {
  const panel = makePanel(url, title)
  if (!panel) return null
  panelsStore.data = { panels: pushPanel(panelsStore.data.panels, panel) }
  panelsStore.save()
  return panel
}

export function renamePanel(id: string, title: unknown): boolean {
  const clean = String(title ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 40)
  if (!clean) return false
  const list = panelsStore.data.panels
  const hit = list.some((p) => p.id === id)
  if (!hit) return false
  panelsStore.data = { panels: list.map((p) => (p.id === id ? { ...p, title: clean } : p)) }
  panelsStore.save()
  return true
}

export function removePanel(id: string): boolean {
  const before = panelsStore.data.panels.length
  panelsStore.data = { panels: panelsStore.data.panels.filter((p) => p.id !== id) }
  if (panelsStore.data.panels.length === before) return false
  panelsStore.save()
  return true
}
