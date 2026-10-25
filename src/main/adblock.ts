/**
 * AETHER SHIELDS (v1.2.0) — Brave-style ad & tracker blocking.
 *
 * Upgrade over v0.2's "cancel EasyList matches": the @cliqz/Ghostery engine is
 * now driven directly (not via its all-or-nothing adapter) so Aether gets the
 * full Brave shields experience:
 *
 *   - network filtering  — EasyList + EasyPrivacy (prebuilt, disk-cached)
 *                          + optional custom filter lists (uBlock presets and
 *                          any user URL), all matched in one pipeline
 *   - cosmetic filtering — ad placeholders hidden via CSS (no empty gaps),
 *                          injected at document start through the engine's
 *                          own sandboxed preload
 *   - scriptlet injection — defeats anti-adblock traps
 *   - CSP directives      — $csp= rules merged into responses
 *   - PER-SITE shields    — one click in the toolbar turns shields off for a
 *                          site (persisted), like Brave's shields panel
 *   - counters            — blocked requests per site + total, shown live
 *
 * The AI pipeline is immune: search/Ollama/cloud calls use Node fetch
 * (undici), which never passes through session webRequest.
 *
 * Everything is guarded: if the engine can't load (offline first run, API
 * drift), browsing continues normally without blocking.
 */
import { app, ipcMain, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { FiltersEngine } from '@cliqz/adblocker'
import { ElectronBlocker, fromElectronDetails } from '@cliqz/adblocker-electron'
import { parse as parseDomain } from 'tldts-experimental'
import type {
  AdblockStats,
  CosmeticsResult,
  ShieldsPolicy
} from './shields-core'
import {
  EMPTY_COSMETICS,
  EMPTY_STATS,
  FILTER_PRESETS,
  hostFromUrl,
  mergeCosmetics,
  normalizeHost,
  recordBlocked,
  resolveListUrls,
  shouldShieldFor
} from './shields-core'
import { JsonStore, mergedSettings, settings } from './store'

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

let mainEngine: ElectronBlocker | null = null
let loading: Promise<ElectronBlocker | null> | null = null
let customEngines: { url: string; engine: FiltersEngine; status: 'ok' | 'cached' | 'error' }[] = []
let customLoading: Promise<void> | null = null
let pipelineInstalled = false
let globalEnabled = false

const statsStore = new JsonStore<AdblockStats>('adblock-stats.json', { ...EMPTY_STATS, perHost: {} })

/** webContentsId -> normalized host of the page's main frame (set by tabs.ts). */
const topHosts = new Map<number, string>()

function engineCachePath(): string {
  return path.join(app.getPath('userData'), 'adblock-engine.bin')
}

function listCachePath(url: string): string {
  const id = Buffer.from(url).toString('base64url').slice(0, 60)
  return path.join(app.getPath('userData'), 'adblock-lists', `${id}.txt`)
}

/* ------------------------------------------------------------------ */
/* policy helpers                                                      */
/* ------------------------------------------------------------------ */

function offHosts(): string[] {
  return Array.isArray(settings.data.shieldsOffHosts) ? settings.data.shieldsOffHosts : []
}

function currentPolicy(): ShieldsPolicy {
  return { globalEnabled, offHosts: offHosts().map((h) => normalizeHost(h)) }
}

/**
 * Aggressive tier (Brave parity): adds SCRIPTLET injection — the code that
 * defeats anti-adblock walls. Scriptlets are powerful but touch the page's
 * own JS plumbing: on heavy SPA sites (YouTube's bootstrap in particular)
 * they can kill the page's script execution entirely, leaving a silent
 * script-only document. Standard shields (default) therefore inject only
 * network blocking + cosmetic CSS (CSP-safe), while Aggressive opts into
 * scriptlets — and the per-site toggle recovers any site that breaks.
 */
function aggressive(): boolean {
  if (process.env.AETHER_SHIELDS_NO_SCRIPTLETS === '1') return false
  return mergedSettings().shieldsAggressive === true
}

/** Is shields filtering active for the site that owns this request/frame? */
function shieldsOnForHost(host: string, pageUrl?: string): boolean {
  const policy = currentPolicy()
  if (pageUrl) return shouldShieldFor(pageUrl, policy)
  if (!policy.globalEnabled) return false
  if (host && policy.offHosts.includes(host)) return false
  return true
}

/** tabs.ts reports every main-frame navigation here. */
export function noteSiteHost(webContentsId: number, url: string): void {
  topHosts.set(webContentsId, hostFromUrl(url))
}

export function forgetSiteHost(webContentsId: number): void {
  topHosts.delete(webContentsId)
}

function topHostOf(webContentsId: number | undefined): string {
  if (webContentsId === undefined) return ''
  return topHosts.get(webContentsId) ?? ''
}

/* ------------------------------------------------------------------ */
/* engines                                                             */
/* ------------------------------------------------------------------ */

async function loadMainEngine(): Promise<ElectronBlocker | null> {
  try {
    const cache = engineCachePath()
    if (fs.existsSync(cache)) {
      try {
        const engine = ElectronBlocker.deserialize(fs.readFileSync(cache))
        console.log('[shields] engine loaded from cache')
        return prepEngine(engine)
      } catch {
        fs.rmSync(cache, { force: true }) // corrupted cache — refetch
      }
    }
    // fromPrebuiltAdsAndTracking is the runtime-verified prebuilt builder in
    // adblocker 1.34 (EasyList + EasyPrivacy); 'fromPrebuiltFetch' appears in
    // some docs but does not exist in this release — verified at runtime.
    const build: (() => Promise<ElectronBlocker>) | undefined =
      (ElectronBlocker as any).fromPrebuiltAdsAndTracking?.bind(ElectronBlocker)
    if (!build) throw new Error('no prebuilt engine builder in @cliqz/adblocker-electron')
    const engine = await build()
    try {
      fs.writeFileSync(cache, engine.serialize())
    } catch {
      /* cache write is best-effort */
    }
    console.log('[shields] engine downloaded and cached (EasyList + EasyPrivacy)')
    return prepEngine(engine)
  } catch (err) {
    console.warn('[shields] engine unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Runtime tweaks shared by every engine (better Electron type detection). */
function prepEngine(engine: ElectronBlocker): ElectronBlocker {
  try {
    // guessRequestTypeFromUrl makes extension-less requests (common on
    // Electron) match $script/$image rules correctly. Disable with
    // AETHER_SHIELDS_NO_GUESS=1 when bisecting site breakage.
    if (process.env.AETHER_SHIELDS_NO_GUESS !== '1') {
      ;(engine.config as any).guessRequestTypeFromUrl = true
    }
  } catch {
    /* config is best-effort */
  }
  return engine
}

function getMainEngine(): Promise<ElectronBlocker | null> {
  if (!loading) loading = loadMainEngine()
  return loading
}

/** Parse a filter list body into a network+cosmetic engine. */
function parseListEngine(text: string): FiltersEngine {
  return FiltersEngine.parse(text, {
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadGenericCosmeticsFilters: true,
    loadExtendedSelectors: true,
    enableMutationObserver: false, // DOM mutations are observed once (main engine's preload)
    enableHtmlFiltering: false // needs body interception we don't do in Electron
  } as any)
}

async function fetchListText(url: string): Promise<{ text: string; cached: boolean }> {
  const cache = listCachePath(url)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (/<html/i.test(text.slice(0, 200))) throw new Error('got an HTML page, not a filter list')
    try {
      fs.mkdirSync(path.dirname(cache), { recursive: true })
      fs.writeFileSync(cache, text)
    } catch {
      /* cache write is best-effort */
    }
    return { text, cached: false }
  } catch {
    if (fs.existsSync(cache)) return { text: fs.readFileSync(cache, 'utf-8'), cached: true }
    throw new Error(`unreachable and no cached copy: ${url}`)
  }
}

async function rebuildCustomEngines(): Promise<void> {
  const s = mergedSettings()
  const urls = resolveListUrls(s.filterPresetIds || [], s.filterLists || [])
  const next: typeof customEngines = []
  await Promise.all(
    urls.map(async (url) => {
      try {
        const { text, cached } = await fetchListText(url)
        next.push({ url, engine: parseListEngine(text), status: cached ? 'cached' : 'ok' })
      } catch (err) {
        console.warn('[shields] custom list failed:', url, err instanceof Error ? err.message : err)
        next.push({ url, engine: FiltersEngine.parse('', {} as any), status: 'error' })
      }
    })
  )
  customEngines = [
    // keep non-list engines (e.g. the CI smoke rule engine) — the rebuild
    // only manages the http(s) lists from settings
    ...customEngines.filter((c) => !/^https?:/i.test(c.url)),
    ...next
  ]
  console.log('[shields] custom lists active:', next.filter((c) => c.status !== 'error').length, '/', next.length)
}

function ensureCustomEngines(): Promise<void> {
  if (!customLoading) customLoading = rebuildCustomEngines()
  return customLoading
}

/** Called by IPC when the user adds/removes a list — forces a refetch. */
export async function refreshCustomEngines(): Promise<void> {
  customLoading = null
  customEngines = []
  await ensureCustomEngines()
}

function getCustomEngines(): Promise<{ url: string; engine: FiltersEngine; status: string }[]> {
  return ensureCustomEngines().then(() => customEngines)
}

/* ------------------------------------------------------------------ */
/* cosmetic filtering (gated per site)                                 */
/* ------------------------------------------------------------------ */

function cosmeticsForFrame(
  url: string,
  opts: { first: boolean; classes?: string[]; hrefs?: string[]; ids?: string[] }
): CosmeticsResult {
  const parts: CosmeticsResult[] = []
  const engines: FiltersEngine[] = mainEngine ? [mainEngine, ...customEngines.map((c) => c.engine)] : customEngines.map((c) => c.engine)
  for (const engine of engines) {
    try {
      const hostname = parseDomain(url).hostname || ''
      const domain = parseDomain(url).domain || hostname
      const out = engine.getCosmeticsFilters({
        domain,
        hostname,
        url,
        getBaseRules: opts.first,
        getInjectionRules: opts.first,
        getExtendedRules: opts.first,
        getRulesFromHostname: opts.first,
        getRulesFromDOM: !opts.first,
        classes: opts.classes,
        hrefs: opts.hrefs,
        ids: opts.ids,
        callerContext: {}
      } as any)
      parts.push({ active: out.active !== false, styles: out.styles || '', scripts: out.scripts || [], extended: out.extended || [] })
    } catch {
      /* one engine failing must not kill the others */
    }
  }
  return parts.length ? mergeCosmetics(parts) : EMPTY_COSMETICS
}

function siteAllowsCosmetics(event: Electron.IpcMainEvent, frameUrl: string): boolean {
  const siteHost = topHostOf((event.sender as Electron.WebContents).id) || hostFromUrl(frameUrl)
  return shieldsOnForHost(siteHost)
}

/* ------------------------------------------------------------------ */
/* pipeline (installed once, gated live)                               */
/* ------------------------------------------------------------------ */

function ensurePipeline(): void {
  if (pipelineInstalled) return
  // The pipeline can run with custom engines alone (CI smoke installs one
  // before the big EasyList engine has finished downloading).
  if (!mainEngine && customEngines.length === 0 && !process.env.AETHER_SMOKE) return
  pipelineInstalled = true

  // Default session + the shared in-memory private session (v1.5.0 private
  // windows) each get their own network/cosmetic/CSP arms — the per-site
  // gating below is webContents-id based, so it works across sessions.
  const sessions: Electron.Session[] = [session.defaultSession]
  try {
    sessions.push(session.fromPartition('aether-private'))
  } catch (err) {
    console.warn('[shields] private session unavailable:', err instanceof Error ? err.message : err)
  }
  for (const ses of sessions) installPipelineOnSession(ses)

  // --- global cosmetic-filtering IPC arms (session-agnostic, install ONCE) ---
  ipcMain.on('is-mutation-observer-enabled', (event) => {
    event.returnValue = mainEngine?.config?.enableMutationObserver !== false
  })

  ipcMain.on('get-cosmetic-filters-first', (event, url: string) => {
    // AETHER_SHIELDS_NO_RULES=1: preload attached but never fed rules
    // (bisect — distinguishes "preload breaks the site" from "rules break it")
    if (process.env.AETHER_SHIELDS_NO_RULES === '1') {
      event.returnValue = null
      return
    }
    if (!siteAllowsCosmetics(event, url)) {
      event.returnValue = null
      return
    }
    const merged = cosmeticsForFrame(url, { first: true })
    if (!merged.active) {
      event.returnValue = null
      return
    }
    try {
      ;(mainEngine as any).injectStyles(event.sender, merged.styles)
    } catch {
      /* insertCSS is best-effort */
    }
    // Scriptlets only in the Aggressive tier — see the aggressive() note.
    event.returnValue = aggressive() ? merged.scripts : []
    event.sender.send('get-cosmetic-filters-response', {
      active: merged.active,
      extended: merged.extended,
      styles: ''
    })
  })

  ipcMain.on('get-cosmetic-filters', (event, url: string, msg: any) => {
    if (process.env.AETHER_SHIELDS_NO_RULES === '1') return
    if (!siteAllowsCosmetics(event, url)) return
    const { active, styles, extended } = cosmeticsForFrame(url, {
      first: false,
      classes: msg?.classes,
      hrefs: msg?.hrefs,
      ids: msg?.ids
    })
    if (!active) return
    try {
      ;(mainEngine as any).injectStyles(event.sender, styles)
    } catch {
      /* insertCSS is best-effort */
    }
    event.sender.send('get-cosmetic-filters-response', { active, extended, styles: '' })
  })

  console.log(`[shields] pipeline installed (network + cosmetics + CSP) on ${sessions.length} session(s)`)
}

function installPipelineOnSession(ses: Electron.Session): void {
  // --- cosmetic filtering preload (the engine's own sandboxed script) ---
  // AETHER_SHIELDS_NO_COSMETICS=1 skips this arm when bisecting site breakage.
  if (process.env.AETHER_SHIELDS_NO_COSMETICS === '1') {
    console.log('[shields] cosmetics arm disabled by env (bisect mode)')
  } else
  try {
    const preloadPath = require.resolve('@cliqz/adblocker-electron-preload')
    const existing: string[] = (ses as any).getPreloads?.() || []
    if (!existing.includes(preloadPath)) {
      // setPreloads is deprecated but still the only session-wide mechanism the
      // engine's preload understands — same mechanism its own adapter uses.
      ;(ses as any).setPreloads([...existing, preloadPath])
    }
  } catch (err) {
    console.warn('[shields] cosmetic preload unavailable:', err instanceof Error ? err.message : err)
  }

  // --- network filtering (the one onBeforeRequest slot for this session) ---
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    // main-frame navigations are never blocked (Chrome/Brave parity — the
    // v1.1.6 error page handles unreachable sites instead of a silent blank)
    if (details.resourceType === 'mainFrame') {
      callback({})
      return
    }
    const siteHost = topHostOf(details.webContentsId)
    if (!shieldsOnForHost(siteHost)) {
      callback({})
      return
    }
    try {
      const request = fromElectronDetails(details)
      if (request.isMainFrame()) {
        callback({})
        return
      }
      let redirect: { dataUrl: string } | undefined
      let matched = false
      if (mainEngine) {
        const r = mainEngine.match(request)
        if (r.redirect) redirect = r.redirect
        else if (r.match) matched = true
      }
      if (!redirect && !matched) {
        for (const custom of customEngines) {
          const r = custom.engine.match(request)
          if (r.redirect) {
            redirect = r.redirect
            break
          }
          if (r.match) {
            matched = true
            break
          }
        }
      }
      if (matched || redirect) {
        statsStore.data = recordBlocked(statsStore.data, siteHost)
        statsStore.save()
        // AETHER_SHIELDS_VERBOSE=1: print every cancel/redirect (site-bug bisecting)
        if (process.env.AETHER_SHIELDS_VERBOSE === '1') {
          console.log('[shields] BLOCKED', details.resourceType, String(details.url).slice(0, 140))
        }
        callback(redirect ? { redirectURL: redirect.dataUrl } : { cancel: true })
        return
      }
      callback({})
    } catch {
      callback({})
    }
  })

  // --- $csp= directives (merged into main frame / sub frame responses) ---
  // AETHER_SHIELDS_NO_CSP=1 skips this arm when bisecting site breakage.
  if (process.env.AETHER_SHIELDS_NO_CSP === '1') {
    console.log('[shields] CSP arm disabled by env (bisect mode)')
    return
  }
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
      callback({})
      return
    }
    const siteHost = topHostOf(details.webContentsId)
    if (!mainEngine || !shieldsOnForHost(siteHost)) {
      callback({})
      return
    }
    try {
      const rawCsp = mainEngine.getCSPDirectives(fromElectronDetails(details))
      if (!rawCsp) {
        callback({})
        return
      }
      const responseHeaders = details.responseHeaders || {}
      const policies = rawCsp.split(';').map((c) => c.trim())
      for (const [name, values] of Object.entries(responseHeaders)) {
        if (name.toLowerCase() === 'content-security-policy') {
          policies.push(...values)
          delete responseHeaders[name]
        }
      }
      responseHeaders['content-security-policy'] = [policies.join(';')]
      callback({ responseHeaders })
    } catch {
      callback({})
    }
  })

  console.log('[shields] pipeline installed (network + cosmetics + CSP)')
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Apply the user's global shields setting (Settings toggle / boot). */
export async function applyAdblockSetting(enabled: boolean): Promise<boolean> {
  globalEnabled = enabled
  if (!enabled) {
    console.log('[shields] disabled (global)')
    return false
  }
  mainEngine = await getMainEngine()
  ensurePipeline()
  void ensureCustomEngines()
  console.log(
    '[shields] enabled (global) — EasyList + EasyPrivacy',
    mainEngine ? '' : '(main engine still downloading)',
    customEngines.length ? '+ custom lists' : ''
  )
  return true
}

/** Toolbar / settings read this through IPC. */
export async function shieldsState(pageUrl?: string): Promise<any> {
  const host = hostFromUrl(pageUrl)
  const perHost = statsStore.data.perHost || {}
  await ensureCustomEngines()
  const s = mergedSettings()
  return {
    enabled: globalEnabled,
    aggressive: mergedSettings().shieldsAggressive === true,
    totalBlocked: statsStore.data.total || 0,
    siteHost: host,
    siteShieldsOn: host ? shieldsOnForHost(host) : true,
    siteBlocked: host ? perHost[host] || 0 : perHost['(local)'] || 0,
    offHosts: offHosts(),
    topOffenders: Object.entries(perHost)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([h, n]) => ({ host: h, count: n })),
    lists: customEngines.map((c) => ({ url: c.url, status: c.status })),
    presets: FILTER_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      enabled: (s.filterPresetIds || []).includes(p.id)
    }))
  }
}

/** Per-site shields toggle (toolbar popup). Returns the new state. */
export async function toggleSiteShields(url: string, on: boolean): Promise<void> {
  const host = hostFromUrl(url)
  if (!host) return
  const current = new Set(offHosts())
  if (on) current.delete(host)
  else current.add(host)
  settings.data = { ...mergedSettings(), shieldsOffHosts: [...current] }
  settings.save()
  console.log('[shields]', host, on ? 'ON' : 'OFF')
}

/** Custom filter list management (settings page). */
export async function addFilterList(url: string): Promise<{ ok: boolean; error?: string }> {
  const u = (url || '').trim()
  if (!/^https:\/\//i.test(u)) return { ok: false, error: 'URL must start with https://' }
  const s = mergedSettings()
  const lists = new Set(s.filterLists || [])
  if (lists.has(u)) return { ok: false, error: 'already added' }
  lists.add(u)
  settings.data = { ...mergedSettings(), filterLists: [...lists] }
  settings.save()
  await refreshCustomEngines()
  return { ok: true }
}

export async function removeFilterList(url: string): Promise<void> {
  const s = mergedSettings()
  settings.data = {
    ...mergedSettings(),
    filterLists: (s.filterLists || []).filter((l) => l !== url),
    filterPresetIds: (s.filterPresetIds || []).filter((id) => FILTER_PRESETS.find((p) => p.id === id)?.url !== url)
  }
  settings.save()
  await refreshCustomEngines()
}

/** AETHER_SMOKE: deterministic engine used by the CI block-counter check. */
export function installSmokeEngine(rule: string): void {
  customEngines = [...customEngines, { url: 'smoke://test-rule', engine: parseListEngine(rule), status: 'ok' }]
}

export function shieldsStatsForTests(): AdblockStats {
  return statsStore.data
}
