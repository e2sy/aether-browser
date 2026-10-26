/**
 * Password manager (v2.3.0) — a real browser's login vault, local-only.
 *
 * Storage model:
 *  - one row per (host, username); the pair {username, password} is encrypted
 *    as a single blob with Electron safeStorage (DPAPI on Windows, Secret
 *    Service / Keychain elsewhere) and only the ciphertext touches disk
 *  - safeStorage unavailable (hardened Linux without a keyring) ⇒ the vault
 *    refuses to store, with a clear reason — no plaintext fallback, ever
 *  - hosts are ALWAYS derived from the sending webContents' real URL; the
 *    only channel a web page may call (creds:submit) is write-only and
 *    validated here, never through the generic guard
 *
 * Flows:
 *  - auto-capture: tabs.ts injects SUBMIT_HOOK_SCRIPT on http(s) loads; the
 *    hook reports real form submissions → save bar in the owning window
 *  - context menu: Save login… / Fill saved password / Generate strong
 *    password (menu.ts) — all main-side executeJavaScript, no page trust
 *  - manager UI: aether://passwords (search, copy, add, delete, blocklist)
 */
import { BrowserWindow, app, clipboard, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { JsonStore, mergedSettings } from './store'
import { allEntries } from './windows'
import { notify } from './osshell'
import {
  normalizeHost,
  sanitizeUsername,
  sanitizePassword,
  passwordStrength,
  generatePassword,
  matchCreds,
  buildFillScript,
  buildGenerateScript,
  SUBMIT_HOOK_SCRIPT,
  PROBE_SCRIPT,
  type CredRecord
} from '../shared/creds'

interface VaultFile {
  records: CredRecord[]
  blocked: string[]
}

const vault = new JsonStore<VaultFile>('passwords.json', { records: [], blocked: [] })

export interface PendingPrompt {
  requestId: string
  host: string
  url: string
  username: string
  password: string
  winId: number | null
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingPrompt>()
const PROMPT_TTL_MS = 90_000

/** Which tab views belong to private windows (keyed by webContents id). */
const privateViews = new Set<number>()

/** tabs.ts spawnView registers each tab view here (private flag lives only in main). */
export function noteCredContext(wcId: number, isPrivate: boolean): void {
  if (isPrivate) privateViews.add(wcId)
  else privateViews.delete(wcId)
}

export function forgetCredContext(wcId: number): void {
  privateViews.delete(wcId)
}

export function isPrivateView(wcId: number): boolean {
  return privateViews.has(wcId)
}

// ---------- crypto ----------

export function vaultReady(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptPair(username: string, password: string): string {
  if (!vaultReady()) throw new Error('OS keychain unavailable — password saving is disabled')
  return safeStorage.encryptString(JSON.stringify({ u: username, p: password })).toString('base64')
}

function decryptPair(enc: string): { u: string; p: string } {
  try {
    const buf = Buffer.from(String(enc || ''), 'base64')
    // safeStorage.decryptString already returns a string (Electron 45 typings)
    const obj = JSON.parse(safeStorage.decryptString(buf)) as { u?: string; p?: string }
    return { u: String(obj?.u || ''), p: String(obj?.p || '') }
  } catch {
    return { u: '', p: '' }
  }
}

// ---------- prompts (save bar in the owning chrome window) ----------

function ownerWindowOf(winId: number | null): BrowserWindow | undefined {
  if (winId != null) {
    const w = BrowserWindow.fromId(winId)
    if (w && !w.isDestroyed()) return w
  }
  const entry = allEntries().find((e) => !e.win.isDestroyed())
  return entry && !entry.win.isDestroyed() ? entry.win : undefined
}

/** Pop the save bar for a captured credential pair. */
export function promptSave(host: string, url: string, username: string, password: string, winId: number | null): void {
  if (!host || !password) return
  if (vault.data.blocked.includes(host)) return
  // duplicate pending prompt for the same host+user? replace it
  for (const [rid, p] of pending) {
    if (p.host === host && p.username === username) {
      clearTimeout(p.timer)
      pending.delete(rid)
    }
  }
  const requestId = randomUUID().replace(/-/g, '').slice(0, 12)
  const timer = setTimeout(() => pending.delete(requestId), PROMPT_TTL_MS)
  pending.set(requestId, { requestId, host, url, username, password, winId, timer })
  const win = ownerWindowOf(winId)
  if (!win) return
  try {
    win.webContents.send('creds:prompt', {
      requestId,
      host,
      url,
      username,
      provider: vaultReady() ? 'keychain' : 'unavailable'
    })
  } catch {
    /* window racing shutdown */
  }
}

/** User answered the save bar (chrome UI only — caller applies guard()).
 *  An edited username from the bar overrides the captured one on save. */
export function respondPrompt(requestId: string, save: boolean, never: boolean, usernameOverride = ''): void {
  const p = pending.get(String(requestId || ''))
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(p.requestId)
  if (never) {
    if (!vault.data.blocked.includes(p.host)) {
      vault.data.blocked.push(p.host)
      vault.save()
    }
    return
  }
  if (save) {
    const user = usernameOverride.trim() ? sanitizeUsername(usernameOverride) : p.username
    upsertRecord(p.host, p.url, user, p.password)
  }
}

function upsertRecord(host: string, url: string, username: string, password: string): void {
  try {
    const enc = encryptPair(username, password)
    const strong = passwordStrength(password).score
    const existing = vault.data.records.find((r) => r.host === host && r.username === username)
    if (existing) {
      existing.enc = enc
      existing.strong = strong
      existing.ts = Date.now()
      if (url) existing.url = url
    } else {
      vault.data.records.unshift({ id: randomUUID(), host, url: url || undefined, username, enc, ts: Date.now(), strong })
      vault.data.records = vault.data.records.slice(0, 2000)
    }
    vault.save()
    notify('Login saved', `${username || 'A user'} · ${host}`)
  } catch (err) {
    notify('Could not save login', err instanceof Error ? err.message : 'keychain unavailable')
  }
}

// ---------- IPC-facing API ----------

export function listCreds(): { available: boolean; records: Array<Omit<CredRecord, 'enc'>>; blocked: string[] } {
  return {
    available: vaultReady(),
    records: vault.data.records.map((r) => ({ id: r.id, host: r.host, url: r.url, username: r.username, strong: r.strong, ts: r.ts })),
    blocked: [...vault.data.blocked]
  }
}

export function revealCred(id: string): string {
  const rec = vault.data.records.find((r) => r.id === String(id || ''))
  if (!rec) return ''
  return decryptPair(rec.enc).p
}

export function addCred(url: string, username: string, password: string): { ok: boolean; error?: string } {
  const host = normalizeHost(url)
  if (!host) return { ok: false, error: 'Enter the site address the login belongs to (e.g. https://example.com)' }
  const u = sanitizeUsername(username)
  const p = sanitizePassword(password)
  if (!p) return { ok: false, error: 'Password cannot be empty' }
  try {
    upsertRecord(host, url, u, p)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'save failed' }
  }
}

export function removeCred(id: string): void {
  vault.data.records = vault.data.records.filter((r) => r.id !== String(id || ''))
  vault.save()
}

export function blockHost(host: string): void {
  const h = normalizeHost(host) || String(host || '').trim()
  if (h && !vault.data.blocked.includes(h)) {
    vault.data.blocked.push(h)
    vault.data.records = vault.data.records.filter((r) => r.host !== h)
    vault.save()
  }
}

export function unblockHost(host: string): void {
  const h = normalizeHost(host) || String(host || '').trim()
  vault.data.blocked = vault.data.blocked.filter((b) => b !== h)
  vault.save()
}

// ---------- page-facing capture channel (the one https pages may call) ----------

/**
 * 'creds:submit' handler body. A web page reported a login form submission.
 * Main-side validation does the real security work: the host comes from the
 * sender's URL, never from the payload; private windows and blocked hosts
 * are dropped; settings gate the whole flow.
 */
export function onCredSubmit(senderUrl: string, isPrivate: boolean, payload: unknown, senderWcId = -1): void {
  if (isPrivate) return
  if (mergedSettings().passwordManager === false) return
  const url = String(senderUrl || '')
  if (!/^https?:/i.test(url)) return
  const host = normalizeHost(url)
  if (!host || vault.data.blocked.includes(host)) return
  const raw = (payload && typeof payload === 'object' ? payload : {}) as { username?: unknown; password?: unknown }
  const username = sanitizeUsername(typeof raw.username === 'string' ? raw.username : '')
  const password = sanitizePassword(typeof raw.password === 'string' ? raw.password : '')
  if (!password) return
  // already stored verbatim? stay silent instead of re-prompting forever
  const known = vault.data.records.filter((r) => r.host === host)
  for (const rec of known) {
    const pair = decryptPair(rec.enc)
    if (pair.u === username && pair.p === password) return
  }
  let winId: number | null = null
  try {
    winId = wcOwnerWindowId(senderWcId)
  } catch {
    winId = null
  }
  promptSave(host, url, username, password, winId)
}

/** The browser window that hosts a tab view (WebContentsView-aware). */
function wcOwnerWindowId(wcId: number): number | null {
  // 1) exact path: the submitting view's owner window
  for (const entry of allEntries()) {
    if (entry.win.isDestroyed()) continue
    for (const id of entry.tabs.listIds()) {
      const t = entry.tabs.get(id)
      if (t && t.view && !t.view.webContents.isDestroyed() && t.view.webContents.id === wcId) return entry.win.id
    }
  }
  // 2) fallback: focused window (submissions happen on the focused window)
  return BrowserWindow.getFocusedWindow()?.id ?? null
}

// ---------- context-menu actions (menu.ts calls these) ----------

/** Inject the submit detector on an http(s) page load. */
export function wireCredCapture(wc: Electron.WebContents, isPrivate: boolean): void {
  wc.on('did-finish-load', () => {
    try {
      if (isPrivate) return
      if (mergedSettings().passwordManager === false) return
      const url = wc.getURL() || ''
      if (!/^https?:/i.test(url)) return
      void wc.executeJavaScript(SUBMIT_HOOK_SCRIPT, true).catch(() => undefined)
    } catch {
      /* destroyed mid-load */
    }
  })
}

/** Context menu "Save login…" — probe the focused login form. */
export function saveLoginFromContext(wc: Electron.WebContents): void {
  const url = wc.getURL() || ''
  const host = normalizeHost(url)
  if (!/^https?:/i.test(url) || !host) return
  void wc
    .executeJavaScript(PROBE_SCRIPT, true)
    .then((hit: { username?: string; password?: string } | null) => {
      if (!hit || !hit.password) {
        notify('No login found on this page', 'Click inside the password field and try again')
        return
      }
      const entry = allEntries().find((e) => !e.win.isDestroyed())
      promptSave(host, url, sanitizeUsername(hit.username || ''), sanitizePassword(hit.password || ''), entry?.win.id ?? null)
    })
    .catch(() => undefined)
}

/** Context menu "Fill saved password" — main picks the row, never the page. */
export function fillLoginFor(wc: Electron.WebContents): void {
  const url = wc.getURL() || ''
  const rec = matchCreds(vault.data.records, url)
  if (!rec) {
    notify('No saved login for this site', normalizeHost(url) || 'unknown site')
    return
  }
  const pair = decryptPair(rec.enc)
  if (!pair.p) {
    notify('Could not decrypt the saved login', 'The OS keychain refused access')
    return
  }
  void wc
    .executeJavaScript(buildFillScript(pair.u, pair.p), true)
    .then((filled: number) => {
      notify(filled ? 'Login filled' : 'No login form found', rec.host)
    })
    .catch(() => undefined)
}

/** Context menu "Generate strong password" — fills the focused field + copies. */
export function generateAndFill(wc: Electron.WebContents): void {
  const gen = generatePassword(20)
  void wc
    .executeJavaScript(buildGenerateScript(gen), true)
    .then((filled: number) => {
      clipboard.writeText(gen)
      notify(filled ? 'Strong password generated' : 'Password copied', 'Also copied to the clipboard')
    })
    .catch(() => undefined)
}

/** App-icon helper used by apps.ts (icon lives next to the vault file). */
export function vaultDir(): string {
  const dir = path.join(app.getPath('userData'), 'creds')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* cosmetic */
  }
  return dir
}
