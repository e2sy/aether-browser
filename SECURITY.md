# Security Policy

Aether is a local-first browser: your history, bookmarks, AI models and
browsing data never leave your machine through us. This document explains how
to report vulnerabilities and what we support.

## Supported versions

Only the latest tagged release receives security fixes. The browser updates
itself via GitHub Releases; check the badge in the README for the live
version.

| Version | Supported |
|---------|-----------|
| latest release | ✅ |
| older releases | ❌ — upgrade |

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

1. Use GitHub's **Private vulnerability reporting**:
   *Security* tab → *Report a vulnerability* on
   <https://github.com/e2sy/aether-browser/security>.
2. Include: affected version (`aether://settings` footer or `Aether --version`),
   OS, reproduction steps, and impact assessment.
3. You will get an acknowledgment within **72 hours** and a fix-or-status
   update within **7 days**.

We credit reporters in the release notes by default — say so if you prefer
to stay anonymous.

## Scope

In scope:

- The Electron main process, preload bridges and IPC surface
- `aether://` internal pages (XSS, CSP bypass, navigation hijack)
- The extension install pipeline (CRX/ZIP parsing, `safe-zip` extractor)
- The metasearch pipeline and instant-answer parser (injection, ReDoS)
- Session/profile storage and permission persistence

Out of scope:

- Vulnerabilities in upstream Chromium/Electron themselves — report those
  upstream; we track and ship Electron security releases promptly
- Social-engineering users into granting permissions
- Issues requiring physical access to an unlocked machine

## Security posture (what's already hard)

- Tabs render in **sandboxed** processes with `contextIsolation: on`,
  `nodeIntegration: off`; the chrome shell is navigation-locked (`navlock`)
- Internal pages ship a **nonce-locked CSP** — injected script cannot run —
  served as both `<meta>` and HTTP header, with `frame-ancestors 'none'`
- Untrusted CRX/ZIP extension archives are unpacked by a hardened extractor
  (`safe-zip`): traversal, symlink, device and zip-bomb entries fail closed
- Release binaries are **fuse-hardened**: RunAsNode / NODE_OPTIONS /
  --inspect escape hatches are stamped off, cookies encrypted, ASAR
  integrity checked on Windows/macOS
- Zero telemetry, zero cloud accounts — nothing to breach on our side

## Disclosure timeline

We aim for a fix release within 30 days for critical issues, 90 days for
everything else, followed by a public advisory crediting the reporter.

## Maintainer notes

- Rotate any GitHub PAT immediately if it ever lands in a log, screenshot or
  message — tokens in `.ghtoken`-style files must stay outside the repo
- `npm audit --audit-level=high` gates CI; Dependabot opens weekly bumps
