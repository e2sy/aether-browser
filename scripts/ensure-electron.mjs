#!/usr/bin/env node
/**
 * ensure-electron.mjs — runs automatically after `npm install` (postinstall).
 *
 * Fixes the classic Windows error:
 *   "Error: Electron failed to install correctly, please delete
 *    node_modules/electron and try installing again"
 *
 * The Electron npm package downloads a ~110 MB platform binary during its
 * own postinstall. That download silently fails on flaky networks, behind
 * proxies, or when antivirus blocks it — leaving a broken install.
 * This script detects the missing binary and repairs it automatically,
 * retrying through a fast mirror if the default source fails.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const MIRROR = 'https://npmmirror.com/mirrors/electron/'

/** Platform-specific binary that must exist for Electron to work. */
function binaryPath() {
  const dist = join(process.cwd(), 'node_modules', 'electron', 'dist')
  switch (process.platform) {
    case 'win32':
      return join(dist, 'electron.exe')
    case 'darwin':
      return join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    default:
      return join(dist, 'electron')
  }
}

function runInstall(extraEnv = {}) {
  const installJs = join(process.cwd(), 'node_modules', 'electron', 'install.js')
  if (!existsSync(installJs)) return false // electron package itself missing; npm install failed earlier
  const r = spawnSync(process.execPath, [installJs], {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })
  return r.status === 0 && existsSync(binaryPath())
}

const bin = binaryPath()
if (existsSync(bin)) process.exit(0) // healthy — nothing to do

console.log('\n[aether] Electron binary is missing — repairing automatically…\n')

if (runInstall()) {
  console.log('\n[aether] Electron repaired successfully.\n')
  process.exit(0)
}

console.log('\n[aether] Default download failed — retrying via mirror (npmmirror)…\n')
if (runInstall({ ELECTRON_MIRROR: MIRROR })) {
  console.log('\n[aether] Electron repaired successfully (via mirror).\n')
  process.exit(0)
}

console.error(`
────────────────────────────────────────────────────────────────
[aether] Could not download the Electron binary automatically.

Try these fixes, in order:

  1) Add an antivirus exclusion for this project folder, then run:
       node node_modules/electron/install.js

  2) Use the mirror for the whole install:
       Windows (PowerShell):  $env:ELECTRON_MIRROR = "${MIRROR}"
                              npm install electron
       macOS / Linux:         ELECTRON_MIRROR="${MIRROR}" npm install electron

  3) Windows users: run  scripts\\setup-windows.ps1  which does all of this
     for you and checks Ollama too.
────────────────────────────────────────────────────────────────
`)
process.exit(1)
