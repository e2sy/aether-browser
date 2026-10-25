/**
 * CRX one-click install — parse Chrome .crx packages and install them as
 * unpacked extensions, no manual unzipping required.
 *
 * CRX container format (v2 and v3):
 *   magic   "Cr24"          4 bytes
 *   version uint32 LE       4 bytes  (2 or 3)
 *   header  uint32 LE       4 bytes  (length of the protobuf header)
 *   header  protobuf        `header` bytes
 *   payload zip archive     rest of the file
 *
 * The header carries signatures / public keys — we do not verify them (same
 * trust model as "Load unpacked": the user chose this file deliberately).
 */
import { app, dialog, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { safeUnzip } from './safe-zip'
import { MAX_EXT_PACKAGE_BYTES, validateManifestOnDisk } from './extsec'
import { notify } from './osshell'
import type { ExtensionInfo } from '../shared/types'
import { installFromFolder } from './extensions'

export interface CrxParseResult {
  ok: boolean
  /** the appended zip payload */
  zip?: Buffer
  version?: 2 | 3
  error?: string
}

/** Pure parser — unit-tested in scripts/test-v11.mjs. */
export function parseCrx(buf: Buffer): CrxParseResult {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return { ok: false, error: 'File is too small to be a CRX package' }
  if (buf.toString('ascii', 0, 4) !== 'Cr24') return { ok: false, error: 'Not a CRX file (missing Cr24 magic)' }
  const version = buf.readUInt32LE(4)
  if (version !== 2 && version !== 3) {
    return { ok: false, error: `Unsupported CRX version ${version} (only CRX2 and CRX3 are supported)` }
  }
  const headerLen = buf.readUInt32LE(8)
  const zipStart = 12 + headerLen
  if (zipStart <= 0 || zipStart >= buf.length) {
    return { ok: false, error: 'CRX header is truncated — the zip payload is missing' }
  }
  return { ok: true, zip: buf.subarray(zipStart), version }
}

function safeStem(name: string): string {
  return (
    path
      .basename(String(name || 'extension'))
      .replace(/\.(crx|zip)$/i, '')
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 40) || 'extension'
  )
}

/**
 * Install a .crx or .zip extension file:
 *   1. parse the CRX container (or use the zip directly)
 *   2. unpack it under userData/extensions/<name>-<rand>
 *   3. validate manifest.json (with one nested-folder fallback)
 *   4. hand off to the shared unpacked-extension installer
 */
export async function installExtensionFromFile(filePath: string): Promise<ExtensionInfo> {
  const clean = String(filePath || '').trim()
  if (!/\.(crx|zip)$/i.test(clean)) throw new Error('Pick a .crx or .zip extension file')
  if (!fs.existsSync(clean)) throw new Error('File not found: ' + clean)

  // package size cap — a giant archive is never a legitimate extension
  const st = fs.statSync(clean)
  if (!st.isFile()) throw new Error('Not a file: ' + clean)
  if (st.size > MAX_EXT_PACKAGE_BYTES) {
    throw new Error(`Package is ${Math.round(st.size / 1048576)} MB — the limit for extension packages is ${Math.round(MAX_EXT_PACKAGE_BYTES / 1048576)} MB`)
  }

  const buf = fs.readFileSync(clean)
  let zip: Buffer
  if (/\.crx$/i.test(clean)) {
    const parsed = parseCrx(buf)
    if (!parsed.ok || !parsed.zip) throw new Error(parsed.error || 'Invalid CRX package')
    zip = parsed.zip
  } else {
    zip = buf
  }

  const root = path.join(app.getPath('userData'), 'extensions')
  fs.mkdirSync(root, { recursive: true })
  let dir = ''
  for (let i = 0; i < 5 && !dir; i++) {
    const cand = path.join(root, `${safeStem(clean)}-${crypto.randomBytes(3).toString('hex')}`)
    if (!fs.existsSync(cand)) dir = cand
  }
  if (!dir) throw new Error('Could not create an install folder')

  // Hardened extraction (safe-zip): rejects traversal/symlinks/zip bombs.
  // The staging dir is treated as tainted on ANY failure and wiped.
  const zipPath = dir + '.zip'
  fs.writeFileSync(zipPath, zip)
  try {
    await safeUnzip(zipPath, dir)
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('Could not unpack the archive: ' + (err instanceof Error ? err.message : String(err)))
  } finally {
    fs.rmSync(zipPath, { force: true })
  }

  // zip archives often wrap everything in a single folder — descend into it
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    const kids = fs.readdirSync(dir).filter((k) => !k.startsWith('.'))
    if (kids.length === 1 && fs.existsSync(path.join(dir, kids[0], 'manifest.json'))) {
      const inner = path.join(dir, kids[0])
      const finalDir = path.join(path.dirname(dir), path.basename(inner) + '-' + crypto.randomBytes(3).toString('hex'))
      fs.renameSync(inner, finalDir)
      fs.rmSync(dir, { recursive: true, force: true })
      dir = finalDir
    }
  }
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('The archive has no manifest.json at its root — is it really an extension?')
  }

  // Quarantine gate #2: validate the manifest BEFORE anything is loaded or
  // enabled. A broken/hostile manifest means the staging dir never survives.
  const verdict = validateManifestOnDisk(dir)
  if (!verdict.ok) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('Invalid extension manifest: ' + (verdict.error || 'rejected'))
  }

  // The consent screen lives inside installFromFolder (shared with the
  // unpacked flow). Any failure here — declined consent, bad manifest,
  // loader crash — wipes the staging dir we created.
  try {
    return await installFromFolder(dir, { ownStaging: true })
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

/** File-picker flow behind Settings → “Install from .crx / .zip…”. */
export async function installExtensionFromDialog(parent?: BrowserWindow): Promise<ExtensionInfo | null> {
  const res = await dialog.showOpenDialog(parent ?? (undefined as unknown as BrowserWindow), {
    title: 'Install extension from file',
    buttonLabel: 'Install',
    defaultPath: app.getPath('downloads'),
    filters: [
      { name: 'Extension packages', extensions: ['crx', 'zip'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return null
  return installExtensionFromFile(res.filePaths[0])
}

/**
 * One-click install paths: "Open with Aether" on a .crx in the OS file
 * manager (Windows/Linux argv, macOS open-file event). Never throws.
 */
export async function installCrxFromArgv(argv: string[]): Promise<void> {
  const crx = argv.filter((a) => /\.crx$/i.test(a))
  for (const file of crx) {
    try {
      const info = await installExtensionFromFile(file)
      // native notification (#30) — click focuses the browser
      notify('Extension installed', `${info.name} — manage it in Settings → Extensions.`)
    } catch (err) {
      dialog.showErrorBox('Extension install failed', String(err instanceof Error ? err.message : err))
    }
  }
}
