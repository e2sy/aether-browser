/**
 * Extension security — manifest validation + Chrome-style permission consent
 * (Master Plan Phase 0, items #4 and #5).
 *
 * Quarantine flow for any .crx/.zip/unpacked-folder install:
 *   1. size-capped package read (crx.ts)
 *   2. hardened unzip (safe-zip.ts, fail-closed)
 *   3. manifest.json validated BEFORE anything is loaded or enabled
 *   4. Chrome-style consent screen listing the requested permissions
 *   5. only then: loadExtension + persist the record
 * Any failure wipes the freshly-created staging dir (crx.ts) and leaves no
 * partial install behind.
 *
 * The pure half of this module (validateManifest, permissionSummary,
 * consentKey) is unit-tested in scripts/test-v177.mjs without Electron.
 */
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { JsonStore } from './store'

/** Hard ceiling for a single .crx/.zip package handed to the installer. */
export const MAX_EXT_PACKAGE_BYTES = 200 * 1024 * 1024

export interface ManifestVerdict {
  ok: boolean
  error?: string
  name?: string
  version?: string
  manifestVersion?: 2 | 3
  /** normalized, de-duplicated requested permission strings */
  permissions?: string[]
  /** host-permission match patterns (MV3 host_permissions + MV2 <all_urls> style entries) */
  hostPermissions?: string[]
}

const CHROME_VERSION_RE = /^\d+(\.\d+){0,3}$/

const HOST_PATTERN_RE = /^(https?|\*):\/\/(\*|\*\.[^\/*]+|[^\/*]+)(\/.*)?$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate an extension manifest.json (already JSON.parse-d by the caller or
 * read from disk when you pass a string). Deliberately Chrome-like but
 * pragmatic: reject clearly-broken or hostile manifests, don't try to
 * re-implement the full Web Store linter.
 */
export function validateManifest(raw: unknown): ManifestVerdict {
  if (!isPlainObject(raw)) return { ok: false, error: 'manifest.json is not a JSON object' }

  const mv = raw['manifest_version']
  if (mv !== 2 && mv !== 3) {
    return { ok: false, error: `Unsupported manifest_version ${String(mv)} (only 2 and 3)` }
  }

  const name = raw['name']
  if (typeof name !== 'string' || !name.trim() || name.length > 200) {
    return { ok: false, error: 'manifest.json has no usable "name"' }
  }

  const version = raw['version']
  if (typeof version !== 'string' || !CHROME_VERSION_RE.test(version) || version.length > 100) {
    return { ok: false, error: `Invalid extension version "${String(version).slice(0, 40)}"` }
  }

  if (raw['description'] !== undefined && typeof raw['description'] !== 'string') {
    return { ok: false, error: '"description" must be a string' }
  }

  const strArr = (key: string): string[] | null => {
    const v = raw[key]
    if (v === undefined) return []
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return null
    return v as string[]
  }
  const permissions = strArr('permissions')
  const optional = strArr('optional_permissions')
  const hostPerms = strArr('host_permissions')
  if (permissions === null || optional === null || hostPerms === null) {
    return { ok: false, error: '"permissions"/"host_permissions" must be arrays of strings' }
  }
  if (permissions.length + optional.length > 200) {
    return { ok: false, error: 'Extension requests an implausible number of permissions' }
  }
  // MV2 keeps host patterns inside `permissions`; split them out for the
  // consent screen so both manifest generations summarize identically.
  const hostLike = mv === 2 ? permissions.filter((p) => HOST_PATTERN_RE.test(p) || p === '<all_urls>') : []
  const plainPerms = mv === 2 ? permissions.filter((p) => !HOST_PATTERN_RE.test(p) && p !== '<all_urls>') : permissions

  return {
    ok: true,
    name: name.trim(),
    version,
    manifestVersion: mv,
    permissions: [...new Set([...plainPerms, ...optional])],
    hostPermissions: [...new Set([...(mv === 2 ? hostLike : hostPerms)])]
  }
}

/** Read + validate the manifest.json sitting at the root of `dir`. */
export function validateManifestOnDisk(dir: string): ManifestVerdict {
  const file = path.join(dir, 'manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    return { ok: false, error: 'manifest.json is not valid JSON: ' + (err instanceof Error ? err.message : String(err)) }
  }
  return validateManifest(raw)
}

// ---------- consent summary (Chrome-style phrasing) ----------

const PERMISSION_LABELS: Record<string, string> = {
  tabs: 'Read your browsing activity and tab contents',
  cookies: 'Read and change cookies on all sites',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  downloads: 'Manage your downloads',
  storage: 'Store data on your device',
  unlimitedStorage: 'Store unlimited data on your device',
  notifications: 'Show notifications',
  contextMenus: 'Add items to the right-click menu',
  alarms: 'Schedule actions in the background',
  scripting: 'Run code on websites',
  activeTab: 'Access the site you are visiting when you click the extension',
  idle: 'Detect when your machine is idle',
  webNavigation: 'See every page you navigate to',
  webRequest: 'See and analyze your web traffic',
  webRequestBlocking: 'Intercept and block your web traffic',
  declarativeNetRequest: 'Block or redirect web requests',
  geolocation: 'Know your physical location',
  clipboardRead: 'Read everything you copy',
  clipboardWrite: 'Change data you copy and paste',
  nativeMessaging: 'Exchange messages with native programs on your computer',
  proxy: 'Route your traffic through proxies it chooses',
  privacy: 'Read and change privacy-related browser settings',
  management: 'Manage other extensions and browser apps',
  debugger: 'Debug and take full control of pages (debugger access)',
  devtools: 'Extend the developer tools',
  identity: 'Know your email address and sign-in state',
  tts: 'Speak text aloud',
  ttsEngine: 'Convert spoken speech to text',
  topSites: 'Read the list of sites you visit most',
  fontSettings: 'Change your font settings',
  wallpaper: 'Change the browser wallpaper',
  vpnProvider: 'Act as a VPN for all your traffic',
  fileBrowserHandler: 'Access files you open with the extension',
  unlimited_storage: 'Store unlimited data on your device'
}

function domainOfPattern(pattern: string): string {
  // "*://*.example.com/*" -> "example.com"; "https://mail.google.com/*" -> mail.google.com
  const m = HOST_PATTERN_RE.exec(pattern)
  if (!m) return pattern
  let host = m[2] || ''
  if (host.startsWith('*.')) host = host.slice(2)
  return host || pattern
}

/**
 * Human-readable permission lines for the consent screen, Chrome-style.
 * Host permissions collapse to domains, capped at 3 lines + "…and N more".
 */
export function permissionSummary(verdict: ManifestVerdict): string[] {
  if (!verdict.ok) return []
  const lines: string[] = []
  const seen = new Set<string>()
  for (const p of verdict.permissions || []) {
    const label = PERMISSION_LABELS[p] || p
    if (seen.has(label)) continue
    seen.add(label)
    lines.push(label)
  }
  const hosts = (verdict.hostPermissions || []).map(domainOfPattern)
  const hostSet = [...new Set(hosts)]
  if (hostSet.length === 1) {
    lines.push(hostSet[0] === '<all_urls>' || hosts[0] === '<all_urls>'
      ? 'Read and change all your data on all websites'
      : `Read and change your data on ${hostSet[0]}`)
  } else if (hostSet.length > 1) {
    const extra = hostSet.length - 3
    for (const h of hostSet.slice(0, 3)) lines.push(`Read and change your data on ${h}`)
    if (extra > 0) lines.push(`…and ${extra} more site${extra === 1 ? '' : 's'}`)
  }
  return lines
}

/** True when the extension asks for power that deserves the scary dialog. */
export function isHighRisk(verdict: ManifestVerdict): boolean {
  const risky = new Set(['tabs', 'cookies', 'history', 'webRequestBlocking', 'debugger', 'nativeMessaging', 'clipboardRead', 'proxy', 'vpnProvider', 'management'])
  if ((verdict.permissions || []).some((p) => risky.has(p))) return true
  return (verdict.hostPermissions || []).some((p) => p === '<all_urls>' || HOST_PATTERN_RE.test(p))
}

// ---------- consent memory ----------

export interface ConsentRecord {
  /** path::version — a changed version re-prompts */
  key: string
  name: string
  version: string
  permissions: string[]
  ts: number
}

const consents = new JsonStore<Record<string, ConsentRecord>>('ext-consents.json', {})

export function consentKey(dir: string, version: string): string {
  const resolved = path.resolve(String(dir || ''))
  return `${resolved}::${String(version || '')}`
}

export function hasExtensionConsent(dir: string, version: string): boolean {
  return Boolean(consents.data[consentKey(dir, version)])
}

export function forgetExtensionConsents(): number {
  const n = Object.keys(consents.data).length
  consents.data = {}
  consents.save()
  return n
}

/**
 * Chrome-style consent gate. Returns true when the extension may be enabled
 * (already consented to this exact version, or the user just accepted).
 * Records the decision so the dialog shows once per version.
 */
export async function ensureExtensionConsent(
  dir: string,
  verdict: ManifestVerdict,
  opts: { parent?: BrowserWindow; skipDialog?: boolean } = {}
): Promise<boolean> {
  if (!verdict.ok || !verdict.name || !verdict.version) return false
  const key = consentKey(dir, verdict.version)
  if (consents.data[key]) return true

  if (opts.skipDialog) {
    consents.data[key] = { key, name: verdict.name, version: verdict.version, permissions: permissionSummary(verdict), ts: Date.now() }
    consents.save()
    return true
  }

  const summary = permissionSummary(verdict)
  const risky = isHighRisk(verdict)
  const lines = [
    `“${verdict.name}” version ${verdict.version} wants to:`,
    '',
    ...summary.map((l) => `• ${l}`),
    '',
    risky ? 'This extension asks for powerful access. Only add it if you trust the author.' : 'You can remove it any time in Settings → Extensions.'
  ]
  let accepted = false
  try {
    const r = await dialog.showMessageBox(opts.parent ?? (undefined as unknown as BrowserWindow), {
      type: risky ? 'warning' : 'question',
      title: 'Add extension?',
      message: `Add “${verdict.name}” to Aether?`,
      detail: lines.join('\n'),
      buttons: ['Cancel', 'Add extension'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    accepted = r.response === 1
  } catch {
    accepted = false
  }
  if (!accepted) return false
  consents.data[key] = { key, name: verdict.name, version: verdict.version, permissions: summary, ts: Date.now() }
  consents.save()
  return true
}

/** Boot-time no-op kept for symmetry with other subsystems (store is lazy). */
export function initExtSec(): void {
  app.getPath('userData')
}
