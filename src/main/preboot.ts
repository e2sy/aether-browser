/**
 * PREBOOT — the first module imported by the main process (index.ts imports
 * './preboot' before anything else). Everything here MUST run before any other
 * module touches the profile:
 *
 *   - store.ts reads settings.json from userData at import time
 *   - Chromium builds its HTTP cache / Gpu Cache from userData at app.ready
 *
 * Two boot-critical jobs:
 *
 * 1. SINGLE INSTANCE — a second Aether must never boot onto a profile already
 *    owned by a running instance. v1.1.6 used `app.quit()` here, which is
 *    unreliable before app.ready (the losing instance could keep booting onto
 *    the winner's locked cache -> "Unable to move the cache: Access is denied.
 *    (0x5)" + pages refusing to load). `app.exit()` is unconditional; the
 *    process.exit fallback guarantees the loser never reaches the cache probe.
 *
 * 2. CACHE-LOCK AUTO-RECOVERY — if something else (zombie electron.exe,
 *    antivirus, OneDrive) holds the profile's Cache directory, relocate the
 *    whole userData to a deterministic `-recovered` sibling so the browser
 *    still works, and print the exact reclaim instructions. See
 *    profile-recovery.ts for the (pure, unit-tested) policy.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { decideProfileDir, recoveryBanner } from './profile-recovery'

// --- 1. single instance -----------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  console.warn('[Aether] another Aether instance already owns this profile — focusing it and exiting.')
  app.exit(0)
  process.exit(0) // belt & braces: app.quit() pre-ready has historically failed
}

// --- 2. cache-lock auto-recovery --------------------------------------------
/** Can we create + write + delete a file inside dir (creating dir if needed)? */
function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const probeFile = path.join(dir, `aether-probe-${process.pid}.tmp`)
    fs.writeFileSync(probeFile, 'ok')
    fs.unlinkSync(probeFile)
    return true
  } catch {
    return false
  }
}

const originalUserData = app.getPath('userData')
const decision = decideProfileDir(
  originalUserData,
  writable,
  process.env.AETHER_SIMULATE_CACHE_LOCK === '1'
)

if (decision.relocated) {
  // Must happen before app.ready — that is when Chromium initializes the
  // HTTP cache, GPU cache and the default session from userData.
  app.setPath('userData', decision.dir)
  console.warn(recoveryBanner(decision.original, decision.dir).join('\n'))
}

if (process.env.AETHER_SMOKE) {
  console.log('[smoke] profileRecovery:', decision.relocated ? `YES -> ${decision.dir}` : 'NO')
}
