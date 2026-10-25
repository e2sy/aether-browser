# Release signing — the path to verified installers

**Phase 0 item #11.** ASAR integrity is already enforced at runtime
(`scripts/apply-fuses.js` → `embeddedAsarIntegrity` on Windows/macOS; Electron
verifies the ASAR hash against the fuses on every launch). What remains for a
production release is OS-level code signing, wired below and documented here.

## Status

| Platform | Mechanism | Wired | Blocked on |
|----------|-----------|-------|------------|
| Windows | Authenticode (SHA-256) via electron-builder `signtoolOptions` | ✅ env-driven (`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`) | purchasing an OV/EV code-signing certificate |
| macOS | Developer ID Application + notarization via electron-builder | ✅ env-driven (`MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`) | Apple Developer Program enrollment |
| Linux | No OS-mandated signing; deb/rpm repos use GPG | ✅ documented below | signing key + repo hosting decision |

## How the wiring works

electron-builder reads signing material from standard environment variables.
The CI release job (`.github/workflows/build.yml`, `release:`) simply exports
them from repository **Secrets** — nothing secret is ever in the tree:

```yaml
# release job, per-OS (only when secrets exist — dev builds stay unsigned)
env:
  WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}        # .pfx base64 or file path
  WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
  MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}        # .p12
  MAC_CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

When the variables are absent electron-builder packages unsigned artifacts —
exactly what our CI does today — so the pipeline is identical for dev builds
and release builds; signing switches itself on when the secrets appear.

## Linux repository signing (deb/rpm)

After the `.deb` is built, sign the repository metadata (not each package):

```bash
gpg --detach-sign --armor dist/aether_<ver>_amd64.deb
# ReleaseOps: generate InRelease metadata for the apt repo with the same key
```

Publish the public key at `https://aether-browser.dev/aether.gpg` and document
the fingerprint in the README. Fingerprint mismatches must be treated as a
security incident (see `SECURITY.md`).

## Verification (users)

- **Windows:** `Get-AuthenticodeSignature .\Aether-Setup-<ver>.exe` → `Valid`.
- **macOS:** `codesign --verify --deep --strict Aether.app` and
  `spctl -a -vv Aether.app` after notarization staples.
- **Linux (deb):** `apt` verifies GPG signatures automatically once the repo
  key is trusted.

## Rule

Release artifacts are published **only** from the tagged CI `release` job —
never `electron-builder` from a laptop — so every public installer is
reproducible from a git ref and carries exactly the signing material from
repository secrets.
