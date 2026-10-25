/**
 * External-protocol handling (Master Plan items #26 + #32).
 *
 * When a web page (or the OS) hands Aether a non-web URL — mailto:, magnet:,
 * zoommtg: … — the browser must not navigate to it (that's a dead end) and
 * must not silently launch an arbitrary app either (drive-by app launch is
 * an attack vector). Chrome's behavior: ask, with an optional "remember".
 * That's exactly what this module implements.
 *
 * Also owns the "can this URL open as a tab in the running browser?" policy
 * used by second-instance/open-url forwarding: http/https always, aether://
 * only for our own known internal routes — an OS link to aether://settings
 * works, aether://evil-injection does not.
 *
 * Pure logic is unit-tested (test-v179.mjs); the dialog half is Electron.
 */
import { app, dialog, shell } from 'electron'
import path from 'node:path'
import { JsonStore } from './store'

/** Schemes we will OFFER to open in the OS's default app (curated). */
export const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  'mailto', 'magnet', 'tel', 'sms', 'webcal', 'feed', 'news', 'nntp', 'irc',
  'zoommtg', 'zoomus', 'slack', 'spotify', 'steam', 'discord', 'msteams',
  'vlc', 'vnc', 'ftp', 'sftp', 'bitcoin', 'whatsapp'
])

/** Internal routes reachable from outside via aether:// links (#32). */
export const AETHER_ROUTES: ReadonlySet<string> = new Set([
  'newtab', 'search', 'history', 'bookmarks', 'settings', 'downloads'
])

/** Pure: scheme of a URL (lowercased), '' when it has none/is garbage. */
export function schemeOf(url: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(String(url || '').trim())
  return m ? m[1].toLowerCase() : ''
}

/** Pure: should THIS url be offered to the OS instead of navigating? */
export function isExternalCandidate(url: string): boolean {
  const s = schemeOf(url)
  if (!s) return false
  if (s === 'http' || s === 'https' || s === 'aether') return false
  return EXTERNAL_SCHEMES.has(s)
}

/** Pure: may this URL open as a tab in the running browser (forwarding)? */
export function canOpenAsTab(url: string): boolean {
  const u = String(url || '').trim()
  if (/^https?:\/\//i.test(u)) return u.length <= 4096
  const s = schemeOf(u)
  if (s !== 'aether') return false
  const rest = u.slice('aether://'.length).split(/[/?#]/)[0].toLowerCase()
  return AETHER_ROUTES.has(rest)
}

// ---------- remembered per-scheme choices ----------

export interface ExternalChoice {
  scheme: string
  decision: 'allow' | 'block'
  ts: number
}

type ChoiceStore = { data: Record<string, ExternalChoice>; save(): void }

/** Pure: what should we do for this scheme right now? */
export function rememberedDecision(store: ChoiceStore, scheme: string): 'ask' | 'allow' | 'block' {
  const rec = store.data[String(scheme || '')]
  if (!rec || (rec.decision !== 'allow' && rec.decision !== 'block')) return 'ask'
  return rec.decision
}

/** Pure: persist (or skip) a remember-me choice. Unknown schemes never stick. */
export function applyRemember(
  store: ChoiceStore,
  url: string,
  decision: 'allow' | 'block',
  remember: boolean
): void {
  const s = schemeOf(url)
  if (!remember || !s || !EXTERNAL_SCHEMES.has(s)) return
  store.data[s] = { scheme: s, decision, ts: Date.now() }
  store.save()
}

// ---------- real store + runtime ----------

const choices = new JsonStore<Record<string, ExternalChoice>>('extproto.json', {})

function getStore(): ChoiceStore {
  return choices
}

export type ExternalOutcome = 'opened' | 'remembered-open' | 'remembered-block' | 'declined' | 'not-external'

/**
 * Ask (or remember) + open `url` in the OS handler. Never navigates the
 * tab, never throws. Returns what happened, for logs/tests.
 */
export async function maybeOpenExternal(url: string): Promise<ExternalOutcome> {
  const clean = String(url || '').trim()
  if (!isExternalCandidate(clean)) return 'not-external'
  const scheme = schemeOf(clean)
  const remembered = rememberedDecision(getStore(), scheme)
  if (remembered === 'allow') {
    await shell.openExternal(clean)
    return 'remembered-open'
  }

  let open = false
  let remember = false
  if (remembered !== 'block') {
    try {
      const r = await dialog.showMessageBox({
        type: 'question',
        title: 'Open external link?',
        message: `Aether can't display ${scheme}: links`,
        detail: [
          `This page wants to hand off to an app on your computer:`,
          clean.length > 300 ? clean.slice(0, 300) + '…' : clean,
          '',
          `“Open app” launches your system's default ${scheme} handler.`
        ].join('\n'),
        buttons: ['Cancel', 'Open app'],
        defaultId: 0,
        cancelId: 0,
        checkboxLabel: `Remember my choice for ${scheme}: links`,
        checkboxChecked: false,
        noLink: true
      })
      open = r.response === 1
      remember = Boolean(r.checkboxChecked)
    } catch {
      open = false
    }
  }

  if (open && remember) applyRemember(getStore(), clean, 'allow', true)
  if (!open && remember) applyRemember(getStore(), clean, 'block', true)

  if (open) {
    try {
      await shell.openExternal(clean)
      return 'opened'
    } catch {
      return 'declined'
    }
  }
  return remembered === 'block' ? 'remembered-block' : 'declined'
}

export function listExternalChoices(): ExternalChoice[] {
  return Object.values(getStore().data).sort((a, b) => b.ts - a.ts)
}

/** Settings → "Reset remembered app-launch choices". Returns count. */
export function forgetExternalChoices(): number {
  const s = getStore()
  const n = Object.keys(s.data).length
  s.data = {}
  s.save()
  return n
}

/**
 * Boot-time registration for the aether:// scheme so internal links work
 * from outside the browser (#32). Idempotent; in dev (unpackaged) we pass
 * the entry script explicitly so the OS spawns the dev CLI correctly.
 */
export function registerAetherProtocol(): void {
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient('aether')
    } else if (process.platform === 'win32') {
      app.setAsDefaultProtocolClient('aether', process.execPath, [path.resolve(process.argv[1] || '.')])
    } else {
      app.setAsDefaultProtocolClient('aether', process.execPath, [path.resolve(process.argv[1] || '.')])
    }
  } catch (err) {
    console.warn('[extproto] aether:// registration failed:', err instanceof Error ? err.message : err)
  }
}
