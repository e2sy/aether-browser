/**
 * Speed dial — main-process store (v2.8.0).
 *
 * User-pinned tiles for the New Tab page, persisted in dials.json via the
 * same debounced JsonStore every other module uses. Validation lives in
 * shared/dials.ts; this module is the thin runtime wrapper + the IPC-facing
 * API surface (list/add/rename/remove).
 */
import { JsonStore } from './store'
import { pushDial, sanitizeDials, makeDial, type Dial } from '../shared/dials'

export interface DialStore {
  dials: Dial[]
}

export const dialsStore = new JsonStore<DialStore>('dials.json', { dials: [] })

// one-time sanitize of whatever is on disk
dialsStore.data = { dials: sanitizeDials((dialsStore.data as DialStore | undefined)?.dials) }

export function listDials(): Dial[] {
  return dialsStore.data.dials
}

/** Add a dial (dedupe by URL, cap 16). Returns null for unusable input. */
export function addDial(url: unknown, title: unknown): Dial | null {
  const dial = makeDial(url, title)
  if (!dial) return null
  dialsStore.data = { dials: pushDial(dialsStore.data.dials, dial) }
  dialsStore.save()
  return dial
}

export function renameDial(id: string, title: unknown): boolean {
  const clean = String(title ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60)
  if (!clean) return false
  const list = dialsStore.data.dials
  const hit = list.some((d) => d.id === id)
  if (!hit) return false
  dialsStore.data = { dials: list.map((d) => (d.id === id ? { ...d, title: clean } : d)) }
  dialsStore.save()
  return true
}

export function removeDial(id: string): boolean {
  const before = dialsStore.data.dials.length
  dialsStore.data = { dials: dialsStore.data.dials.filter((d) => d.id !== id) }
  if (dialsStore.data.dials.length === before) return false
  dialsStore.save()
  return true
}
