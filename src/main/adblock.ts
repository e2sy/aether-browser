/**
 * Optional ad/tracker blocking via @cliqz/adblocker-electron with prebuilt
 * EasyList + EasyPrivacy filters, cached on disk after the first download.
 * Everything is guarded: if the engine can't load (offline first run, API
 * drift), browsing continues normally without blocking.
 */
import { app, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/* eslint-disable @typescript-eslint/no-explicit-any */
let blocker: any | null = null
let loading: Promise<any | null> | null = null

function cachePath(): string {
  return path.join(app.getPath('userData'), 'adblock-engine.bin')
}

async function loadBlocker(): Promise<any | null> {
  try {
    const mod: any = await import('@cliqz/adblocker-electron')
    const ElectronBlocker = mod.ElectronBlocker || mod.default?.ElectronBlocker
    if (!ElectronBlocker) throw new Error('ElectronBlocker export not found')

    const cache = cachePath()
    if (fs.existsSync(cache)) {
      try {
        const engine = ElectronBlocker.deserialize(fs.readFileSync(cache))
        console.log('[adblock] engine loaded from cache')
        return engine
      } catch {
        fs.rmSync(cache, { force: true }) // corrupted cache — refetch
      }
    }

    const fetchFn =
      mod.fromPrebuiltFetch || ElectronBlocker.fromPrebuiltFetch
        ? () => ElectronBlocker.fromPrebuiltFetch()
        : () => ElectronBlocker.fromPrebuiltAdsAndTracking()
    const engine = await fetchFn()
    try {
      fs.writeFileSync(cache, engine.serialize())
    } catch {
      /* cache write is best-effort */
    }
    console.log('[adblock] engine downloaded and cached')
    return engine
  } catch (err) {
    console.warn('[adblock] unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

function getBlocker(): Promise<any | null> {
  if (!loading) loading = loadBlocker()
  return loading
}

/** Apply the user's adblock setting to the default session. */
export async function applyAdblockSetting(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    try {
      blocker?.disableBlockingInSession(session.defaultSession)
    } catch {
      /* ignore */
    }
    return false
  }
  const engine = await getBlocker()
  if (!engine) return false
  try {
    engine.enableBlockingInSession(session.defaultSession)
    console.log('[adblock] enabled')
    return true
  } catch (err) {
    console.warn('[adblock] enable failed:', err instanceof Error ? err.message : err)
    return false
  }
}
