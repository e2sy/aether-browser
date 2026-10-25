/**
 * safe-zip — a hardened zip extractor for untrusted archives (CRX/ZIP
 * extension installs). Replaces `extract-zip`, whose advisory
 * (arbitrary file write via symlink + path traversal) has NO patched
 * release — the only real fix is to not use it.
 *
 * Threat model: an attacker-controlled .crx/.zip arrives through the
 * extension-install dialog or an OS "open with" flow. The archive may try:
 *   - path traversal   ("../../evil", "C:\\evil", "/etc/passwd" entries)
 *   - symlink escape    (symlink entries pointing outside the install dir)
 *   - zip bombs         (petabyte uncompressed sizes, millions of entries)
 *   - weird entry types (devices, sockets, encrypted entries)
 *
 * Policy (fail-closed: any violation aborts the whole extraction and the
 * caller wipes the staging directory):
 *   1. Every entry name must be a safe relative path — no `..` segments,
 *      no absolute paths, no backslashes, no NULs.
 *   2. Symlink entries are forbidden. Non-regular, non-directory types
 *      (devices, sockets, fifos) are forbidden.
 *   3. Budgets: per-entry size, total uncompressed size, entry count, and
 *      a compression-ratio kill switch for large bomb entries.
 *   4. Output containment is enforced a second time by resolving every
 *      written path and requiring it to stay inside the destination dir.
 *
 * Pure helpers (`isDangerousName`, `entryKind`, budgets check) are exported
 * for the test suite; extraction uses yauzl (zero-dependency, battle-tested
 * zip reader) — we own the extraction loop, so WE own the security policy.
 */
import yauzl from 'yauzl'
import fs from 'node:fs'
import path from 'node:path'

export interface SafeZipLimits {
  /** maximum number of entries (files + dirs) */
  maxEntries: number
  /** maximum total uncompressed bytes across all entries */
  maxTotalBytes: number
  /** maximum uncompressed bytes for a single entry */
  maxEntryBytes: number
  /** max uncompressed/compressed ratio for entries larger than ratioFloor */
  maxRatio: number
  /** entries larger than this are subject to the ratio check */
  ratioFloor: number
}

export const DEFAULT_LIMITS: Readonly<SafeZipLimits> = Object.freeze({
  maxEntries: 20_000,
  maxTotalBytes: 1_000_000_000, // 1 GB of unpacked extension is absurd already
  maxEntryBytes: 512_000_000, // 512 MB single file
  maxRatio: 500,
  ratioFloor: 10_000_000 // only ratio-check entries > 10 MB
})

export interface SafeZipResult {
  files: number
  dirs: number
  bytes: number
}

/** Pure: is this zip entry name an attack? Returns the reason or null. */
export function isDangerousName(rawName: string): string | null {
  const name = String(rawName ?? '')
  if (name.length === 0) return 'empty entry name'
  if (name.includes('\0')) return 'NUL byte in entry name'
  if (/^[a-zA-Z]:/.test(name)) return 'windows drive path in entry name'
  if (name.startsWith('/')) return 'absolute path in entry name'
  if (name.includes('\\')) return 'backslash in entry name'
  const segments = name.split('/')
  for (const seg of segments) {
    if (seg === '..') return 'parent traversal (..) in entry name'
  }
  return null
}

/** Pure: classify an entry from its unix mode bits (0 = unknown → file). */
export function entryKind(rawName: string, externalFileAttributes: number): 'dir' | 'file' | 'symlink' | 'special' {
  const name = String(rawName ?? '')
  if (name.endsWith('/')) return 'dir'
  const mode = (externalFileAttributes >>> 16) & 0xffff
  const type = mode & 0o170000
  if (type === 0o120000) return 'symlink'
  if (type === 0o040000) return 'dir'
  if (type === 0o100000 || type === 0) return 'file'
  return 'special'
}

/** Pure: enforce the size budgets. Returns the violation reason or null. */
export function checkBudgets(
  limits: Readonly<SafeZipLimits>,
  state: { entries: number; totalBytes: number },
  entrySize: number,
  compressedSize: number
): string | null {
  if (state.entries + 1 > limits.maxEntries) return `archive has too many entries (limit ${limits.maxEntries})`
  if (entrySize > limits.maxEntryBytes) return `entry exceeds the per-entry size limit (${entrySize} bytes)`
  if (state.totalBytes + entrySize > limits.maxTotalBytes) return 'archive exceeds the total uncompressed size budget (zip bomb?)'
  if (entrySize > limits.ratioFloor && compressedSize > 0 && entrySize / compressedSize > limits.maxRatio) {
    return `decompression ratio ${Math.round(entrySize / compressedSize)} exceeds the limit (zip bomb?)`
  }
  return null
}

/**
 * Extract `zipPath` into `destDir` (created if needed) under the hardened
 * policy. Throws on ANY policy violation — callers must treat the staging
 * directory as tainted and remove it.
 */
export async function safeUnzip(zipPath: string, destDir: string, limits?: Partial<SafeZipLimits>): Promise<SafeZipResult> {
  const lim: Readonly<SafeZipLimits> = { ...DEFAULT_LIMITS, ...(limits ?? {}) }
  const destRoot = path.resolve(destDir)
  fs.mkdirSync(destRoot, { recursive: true })

  const zipfile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zf) => {
      if (err) reject(new Error(`Could not read the archive: ${err.message}`))
      else resolve(zf)
    })
  })

  const state = { entries: 0, totalBytes: 0 }
  let files = 0
  let dirs = 0

  const fail = async (reason: string): Promise<never> => {
    try {
      zipfile.close()
    } catch {
      /* already closed */
    }
    throw new Error(reason)
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      err ? reject(err) : resolve()
    }

    zipfile.on('error', (err) => done(new Error(`Corrupt archive: ${err.message}`)))
    zipfile.on('end', () => done())
    zipfile.on('entry', (entry: yauzl.Entry) => {
      void (async () => {
        try {
          const danger = isDangerousName(entry.fileName)
          if (danger) await fail(`Unsafe archive: ${danger} ("${entry.fileName}")`)

          const kind = entryKind(entry.fileName, entry.externalFileAttributes)
          if (kind === 'symlink') await fail('Unsafe archive: symlink entries are not allowed')
          if (kind === 'special') await fail('Unsafe archive: non-file entries (device/socket/fifo) are not allowed')

          const budget = checkBudgets(lim, state, entry.uncompressedSize, entry.compressedSize)
          if (budget) await fail(`Unsafe archive: ${budget}`)

          if (entry.generalPurposeBitFlag & 0x1) await fail('Unsafe archive: encrypted entries are not supported')

          state.entries += 1
          state.totalBytes += entry.uncompressedSize

          const outPath = path.resolve(destRoot, entry.fileName)
          if (outPath !== destRoot && !outPath.startsWith(destRoot + path.sep)) {
            await fail(`Unsafe archive: entry escapes the install folder ("${entry.fileName}")`)
          }

          if (kind === 'dir') {
            fs.mkdirSync(outPath, { recursive: true })
            dirs += 1
            zipfile.readEntry()
            return
          }

          // parent dirs may not exist as their own entries — create them
          fs.mkdirSync(path.dirname(outPath), { recursive: true })
          await new Promise<void>((streamDone, streamErr) => {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return streamErr(new Error(`Could not read entry "${entry.fileName}": ${err.message}`))
              if (!readStream) return streamErr(new Error(`Empty stream for entry "${entry.fileName}"`))
              const out = fs.createWriteStream(outPath, { mode: 0o644 })
              readStream.on('error', streamErr)
              out.on('error', streamErr)
              out.on('finish', () => streamDone())
              readStream.pipe(out)
            })
          })
          files += 1
          zipfile.readEntry()
        } catch (e) {
          done(e instanceof Error ? e : new Error(String(e)))
        }
      })()
    })
    zipfile.readEntry()
  })

  try {
    zipfile.close()
  } catch {
    /* close is best-effort */
  }
  return { files, dirs, bytes: state.totalBytes }
}
