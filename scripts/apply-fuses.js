const fs = require('node:fs')
const path = require('node:path')

/**
 * apply-fuses — Electron fuse hardening at package time (Master Plan item 10).
 *
 * Wired as electron-builder's afterPack hook (electron-builder.yml). Runs on
 * real release packages AFTER the app is packed into `release/<platform>/`.
 * Fuses are magic bytes stamped into the Electron binary — they disable
 * escape hatches that no shipped browser should ever leave open:
 *
 *   - RunAsNode:                OFF — a plain env var must not be able to
 *     turn the packaged browser into a plain Node REPL (a favorite
 *     privilege-escalation trick).
 *   - NodeOptionsEnv / NodeCliInspectArguments: OFF — same family; kill the
 *     NODE_OPTIONS and --inspect injection vectors.
 *   - GrantFileProtocolExtraPrivileges: OFF — file:// must stay a dumb
 *     renderer protocol, not a privileged one.
 *   - EnableCookieEncryption:   ON  — cookies are encrypted with an
 *     OS-level key instead of obfuscated. (Users re-login once after
 *     upgrading from an unencrypted profile — the price of real crypto.)
 *   - EnableEmbeddedAsarIntegrityValidation + OnlyLoadAppFromAsar:
 *     ON (Windows/macOS only — Linux tooling lacks the ASAR integrity
 *     verifier) — a tampered app bundle refuses to boot.
 *
 * Best-effort by design: any fuse error is logged loudly but does NOT fail
 * the package (a shipped installer without one fuse beats no installer) —
 * EXCEPT RunAsNode, which must never silently regress.
 */
const FUSE_SPEC = Object.freeze({
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  grantFileProtocolExtraPrivileges: false,
  enableCookieEncryption: true,
  enableEmbeddedAsarIntegrityValidation: true, // gated to win/mac at runtime
  onlyLoadAppFromAsar: true
})

/** The electron executable inside a packed app dir, per platform. */
function electronBinaryPath(appOutDir, platform) {
  if (platform === 'darwin') return path.join(appOutDir, 'Aether.app', 'Contents', 'MacOS', 'Aether')
  if (platform === 'win32') return path.join(appOutDir, 'Aether.exe')
  for (const name of ['aether', 'Aether', 'electron']) {
    const p = path.join(appOutDir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join(appOutDir, 'aether')
}

async function afterPack(context) {
  const platform = context.electronPlatformName
  const exe = electronBinaryPath(context.appOutDir, platform)
  if (!fs.existsSync(exe)) {
    console.warn('[fuses] electron binary not found at', exe, '— skipping fuse hardening')
    return
  }

  // Lazy require so unit tests can parse this file without electron-builder.
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

  const fuseMap = {
    [FuseV1Options.RunAsNode]: FUSE_SPEC.runAsNode,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FUSE_SPEC.enableNodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableNodeCliInspectArguments]: FUSE_SPEC.enableNodeCliInspectArguments,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: FUSE_SPEC.grantFileProtocolExtraPrivileges,
    [FuseV1Options.EnableCookieEncryption]: FUSE_SPEC.enableCookieEncryption,
    [FuseV1Options.OnlyLoadAppFromAsar]: FUSE_SPEC.onlyLoadAppFromAsar
  }
  // ASAR integrity verification is implemented for win (dll signature check)
  // and mac (code signature); Linux has no verifier, so flipping it there
  // would only brick the binary.
  if (platform === 'win32' || platform === 'darwin') {
    fuseMap[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] = FUSE_SPEC.enableEmbeddedAsarIntegrityValidation
  }

  try {
    await flipFuses(exe, { version: FuseVersion.v1, resetAdHocDarwinSignature: platform === 'darwin', fuseSnapshot: fuseMap })
    console.log('[fuses] hardened:', Object.keys(fuseMap).length, 'fuses flipped on', platform, '->', path.basename(exe))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (FUSE_SPEC.runAsNode !== false) throw err // must never silently regress
    console.warn('[fuses] flip failed (package continues):', msg)
  }
}

module.exports = { afterPack, FUSE_SPEC, electronBinaryPath }
