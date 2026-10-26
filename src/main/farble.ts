/**
 * Fingerprint farbling — main-process side (v2.7.0 build 21).
 *
 * The PATCHING lives in preload/farble.js (sandbox-safe plain JS). This
 * module:
 *   - registers that preload on every session (default, private, containers)
 *     via session.setPreloads — the same mechanism the shields cosmetic
 *     engine uses;
 *   - answers the preload's one config round-trip ('aether:farble-config')
 *     with { mode, timezone, salt }: mode from settings, timezone from the
 *     sender's container (proxied containers spoof tz to match the exit),
 *     salt from a per-boot random value.
 *
 * The resolver is injected (no import of containers.ts) to keep the
 * dependency graph one-way.
 */
import { ipcMain, session } from 'electron'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { normalizeFarbleMode, type FarbleConfig } from '../shared/farble'
import { mergedSettings } from './store'

/** Random per boot — same-site readings are stable within a session only. */
let bootSalt = randomBytes(8).toString('hex')

/** Injected at boot: sender webContents → its container timezone ('' = none). */
type TzResolver = (wc: Electron.WebContents) => string
let resolveTimezone: TzResolver = () => ''

export function initFarble(resolver: TzResolver): void {
  resolveTimezone = resolver

  ipcMain.on('aether:farble-config', (event) => {
    let timezone = ''
    try {
      timezone = resolveTimezone(event.sender)
    } catch {
      timezone = ''
    }
    const config: FarbleConfig = {
      mode: normalizeFarbleMode(mergedSettings().farbleMode),
      timezone,
      salt: bootSalt
    }
    event.returnValue = config
  })
}

/** Path of the copied preload (out/preload/farble.js — see vite config). */
export function farblePreloadPath(): string {
  return path.join(__dirname, '../preload/farble.js')
}

/** Register the farble preload on a session (idempotent, best-effort). */
export function registerFarbleOnSession(ses: Electron.Session): void {
  try {
    const p = farblePreloadPath()
    const existing: string[] = (ses as any).getPreloads?.() || []
    if (!existing.includes(p)) {
      ;(ses as any).setPreloads([...existing, p])
    }
  } catch (err) {
    console.warn('[farble] preload registration failed:', err instanceof Error ? err.message : err)
  }
}

/** Boot hook: default + private sessions. Containers register on creation. */
export function registerFarbleEverywhere(): void {
  registerFarbleOnSession(session.defaultSession)
  try {
    registerFarbleOnSession(session.fromPartition('aether-private'))
  } catch {
    /* private session registration is best-effort */
  }
}

/** Test hook — deterministic salt for the farbling test suite. */
export function setSaltForTests(salt: string): void {
  bootSalt = salt
}
