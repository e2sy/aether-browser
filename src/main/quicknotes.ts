/**
 * Quick notes widget storage (Master Plan Phase 2, item #44 — New Tab v3).
 * One scratchpad per profile, kept in userData/quicknotes.json. Plain text,
 * hard length cap (a scratchpad is not a database), sanitized on read.
 */
import { JsonStore } from './store'

export const MAX_NOTES = 20_000

export function sanitizeNotes(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // strip control chars except newline+tab
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, MAX_NOTES)
}

const store = new JsonStore<{ text: string }>('quicknotes.json', { text: '' })

export function getNotes(): string {
  return sanitizeNotes(store.data?.text)
}

export function setNotes(text: unknown): string {
  const clean = sanitizeNotes(text)
  store.data = { text: clean }
  store.save()
  return clean
}
