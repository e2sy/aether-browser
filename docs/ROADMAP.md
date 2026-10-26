# Aether Roadmap

> Status: **UPDATED 2026-10-26 — THE MASTER PLAN** — shipped so far: v1.3.0 Aether Search (metasearch
> core), v1.4.0 Customization Studio, v1.4.1 Ollama auto-reconnect, v1.5.0 the real-browser core
> (bookmarks bar, session restore, downloads page, private windows, progress + site info), **v1.6.0
> Beast Search**, v1.7.0 security + default browser + OS chrome, v1.8.0 UI/UX wave, v1.9.0 privacy
> fortress, v2.0.0 the AI milestone, v2.1.0 omnibox suggestions v2 + window-controls fix,
> **v2.2.0 real-browser staples (bookmark import/export, print, save-as-PDF, spellcheck,
> download-location options)**, **v2.3.0 the power batch (password manager with an
> OS-keychain vault, PWA web apps, Tab search Ctrl+Shift+A)**, and **v2.4.0 multi-profiles +
> omnibox inline autocomplete + paste-and-go + tab hover previews**.
> The Master Plan below (118 items, 9 phases) is the contract to beat Brave/Chrome/Firefox on
> security, looks, speed, and platform reach — desktop first, then Android/iOS. Historical
> v1.3–v1.6 plans are kept at the bottom.
> Process: every build lands as its own version tag, pushed with CI green before the next one.

---

## 🔧 v2.1.x punch list — the next fixes & updates (from the field)

Ranked, concrete, each shippable as its own build.

✅ **Landed in v2.2.0 (build 16, 2026-10-26)** — outside the punch list but field-asked: one-click
bookmark import from Chrome/Edge/Brave/Chromium profiles + universal HTML export, Print (Ctrl+P),
Save Page as PDF (Ctrl+S), spellcheck with right-click fixes, download-location prompt + custom
folder. New codecs are pure + round-trip tested (test-v211, 45 assertions).

✅ **Landed in v2.3.0 (build 17, 2026-10-26)** — punch-list item #4 (Tab search, Ctrl+Shift+A,
with the AI sidebar moved to Ctrl+E) plus the priority-table batch from the field: **password
manager** (OS-keychain vault, save bar, context-menu save/fill/generate, `aether://passwords`,
blocklist), **PWA web apps** (manifest install → chromeless bridgeless window, jump list / dock,
Settings card), and the manager-page groundwork. test-v230: 119 assertions.

✅ **Landed in v2.4.0 (build 18, 2026-10-26)** — punch-list items **#1 + #2 + #3** (omnibox
inline autocomplete with ghost type-ahead + Tab-accept, middle-click **paste-and-go** with a
strict URL sanitizer, **tab hover previews** — 600ms hover → live capturePage thumbnail card)
plus the priority-table **multi-profiles**: full per-profile userData (own history, bookmarks,
passwords, cookies, extensions, settings), profile arg parsed before the single-instance lock
(two profiles can run side by side), avatar + app-menu + Settings switchers, session-flushed
relaunch, 16-profile registry. test-v240: 98 assertions.

✅ **Landed in v2.5.0 (build 19, 2026-10-26)** — Tier-A content & media power: **reader view**
(F9 / context menu, Readability + strict whitelist sanitizer, `aether://reader`), **screenshot tool**
(Ctrl+Shift+S, save + W3C-clipboard copy + folder shortcut), **picture-in-picture** (context-menu +
View-menu, Chromium-native), and the **task manager** (`aether://taskmgr`, Shift+Esc, per-tab CPU/mem
with End buttons). test-v250: 70 assertions; XSS audit extended with one audited reader sink.

✅ **Landed in v2.6.0 (build 20, 2026-10-26)** — Tier-B AI differentiators: **image-ask** (right-click
any image → sidebar auto-asks with the picture; `ai:chat` swaps to a vision-capable Ollama model for
the turn — /api/show capabilities first, name-pattern fallback), **full-page translate**
(`aether://translate` — Readability text capture, local-model chunked translation with a
numbered-line protocol + tolerant realigner, 30 languages incl. Hindi + the 8th-schedule set,
bilingual blocks, live progress, stop; Master Plan #76 v1 + Tier-2 #20), and **smart tab
clustering** (local-embedding topic groups — Master Plan #157/#71: greedy online-centroid cosine
clustering over ungrouped http(s) tabs, auto-labeled real tab groups). test-v260: 110 assertions;
smoke boots the translate page. Vector math extracted to shared/semvec.ts (semhistory re-exports).

The rest, ranked, still open:

4. **Per-extension permission consent screen** (#5) — the last unshipped Phase-0 item
5. **Certificate-error UX (#14)** — real interstitial with "proceed anyway" escape hatch instead of the generic error page
6. **Chrome-UI sandbox re-audit (#17)** — get the first-party chrome window to `sandbox:true` (split the extension glue preload)
7. **Auto-update channel (#87)** — signed updates via electron-updater + GitHub Releases, plus update badge in Settings
8. **PDF viewer polish** — zoom controls, TOC sidebar, form-fill pass on the built-in viewer
9. **Find-in-page v2** — match count in the bar, highlight-all, Ctrl+G cycles
10. **Session tiles on New Tab** — "continue where you left off" cards for the last session's tabs
11. **Download bubbles v2** — per-download virus-scan hook + duplicate-name handling
12. **Keyboard shortcut editor** — remap every binding in Settings (Phase 6 #99)
13. **i18n skeleton** — en/hi/de first locales, externalized strings (Phase 6 #100)
14. **Performance budgets (#86-90)** — startup < 1.5s cold, paint < 100ms, tab-switch < 50ms, memory ceiling alarms — measured in CI

---

# 🐉 THE MASTER PLAN — 118 items to beat Brave

Audited 2026-10-25 against the actual codebase (dependency audit: 14 npm advisories incl.
1 critical + a runtime `extract-zip` path-traversal with **no patched version**; sandbox posture:
tabs sandboxed, chrome-UI window `sandbox:false`; CSP uses `unsafe-inline`). Numbers are
execution order inside each phase, not strict priority — phases interleave.

## Phase 0 — Security & Vulnerability Hardening (v1.7.0 "Harden") — 18 items

1. **Kill the critical `tar` CVE** in the build tree — electron-builder 25→26.18.0 + `overrides` for stragglers
2. **Replace `extract-zip` (advisory has NO patched release) with own hardened unzipper** — `safe-zip.ts`: rejects `../` traversal, absolute paths, symlink entries; enforced output containment
3. **Zip-bomb defenses** — total uncompressed budget, per-entry cap, max-files cap, decompression-ratio kill switch
4. **CRX/ZIP quarantine flow** — unpack → validate manifest → only then load; any failure wipes the staging dir (tighten the existing flow)
5. **Extension permission consent screen** — show requested permissions before first enable, Chrome-style
6. **Bump `@mozilla/readability` 0.5→0.6** (ReDoS advisory) + hostile-HTML extraction tests
7. **electron-builder 26.18.0** — also fixes updater token-leak via cross-origin redirect + search-path injection
8. **CSP v2 for every aether:// page** — nonce-based `script-src`, drop `unsafe-inline`, `object-src 'none'`, `form-action 'none'`
9. **Navigation lockdown** — `will-navigate` guards on chrome UI + tabs; only omnibox/history/links may drive top-frame navigation
10. **Electron fuses** — runAsNode off, nodeCliInspect off, embeddedAsarIntegrity on, cookieEncryption on
11. **ASAR integrity + signing path** on release builds
12. **XSS escape audit** — automated tests inject `<img onerror>` payloads through every bridge (suggestions, history titles, result snippets, file names) into every internal page
13. **Permission grants review** — persistence model, "revoke all sites", idle-grant expiry
14. **Certificate-error UX hardening** — no silent bypass; typed-consent "proceed anyway"; per-host memo
15. **SECURITY.md + private disclosure channel + threat-model doc**
16. **CI security gate** — `npm audit` fails the build on critical/high; Dependabot weekly
17. **Sandbox re-audit of the chrome-UI window** (`sandbox:false` today) — attempt sandboxed preload with contextBridge-only glue
18. **Secrets hygiene** — git-secrets pre-commit hook, PAT rotation guide, repo secret scan

## Phase 1 — Default Browser & OS Integration (v1.7.x "Own the OS") — 14 items

19. **`app.setAsDefaultProtocolClient`** for http/https on Windows/macOS/Linux
20. **Settings "Default browser" card** — live `isDefaultBrowser` check, one-click set, per-OS manual fallback
21. **File associations** — .html/.htm/.xhtml open in Aether (electron-builder fileAssociations)
22. **Windows ProgID polish** — AppUserModelId + registry icons so Aether renders properly in Settings → Default apps
23. **macOS LaunchServices** — CFBundleURLTypes/CFBundleDocumentTypes in the release pipeline
24. **Linux .desktop MimeType** — x-scheme-handler/http;https;text/html + xdg-settings integration
25. **Single-instance lock + second-instance forwarding** — clicking a link opens a tab in the running window
26. **External-protocol dialog** — mailto:/magnet:/zoommtg: ask-once-per-scheme with remember
27. **OS integration chrome** — Windows jump lists, macOS dock menu, taskbar download progress
28. **System tray** — quick actions (new tab, new private, pause shields), close-to-tray option
29. **Startup boost** — opt-in login item + pre-warmed hidden window for <700 ms warm start
30. **Native notifications** — download complete, extension installed, update available
31. **Badge counters** — macOS dock badge, Windows taskbar overlay icon
32. **aether:// protocol registration** — internal links work from outside the browser

## Phase 2 — Look & Feel: out-design Chrome/Brave/Firefox (v1.8.0 "Gorgeous") — 22 items

33. **Vertical tabs mode** — full-height collapsible strip, pinned zone, fits Customization Studio
34. **Tab groups** — named, colored, collapsible, saveable across restarts
35. **Split view** — two tabs side-by-side in one window
36. **Workspaces** — separate tab sets per project with own names/colors/icons
37. **Command palette (Ctrl+K)** — every action/tab/setting/bookmark, fuzzy search
38. **Tab hover previews** — live thumbnail cards (capturePage)
39. **Native window effects** — Win11 Mica/Acrylic, macOS vibrancy, Linux blur
40. **Animation system** — tab morphs, progress shimmer, page fades; honors prefers-reduced-motion
41. **Toolbar customization** — drag-reorder controls, hide/show anything
42. **Theme engine v2** — import/export `.aether-theme` files, per-site theme overrides
43. **Glass mode** — depth-aware translucent chrome
44. **New Tab v3** — editable widget grid: top sites, quick notes, RSS, calendar strip
45. **Context menu v2** — iconed, grouped, with Aether actions (Summarize, Screenshot, Add to reading list)
46. **Reading list** — separate from bookmarks, reading-time estimates
47. **History v2** — day-grouped timeline, search, per-domain filters
48. **Screenshot v2** — region-select overlay, annotate, full-page stitch
49. **PDF mode** — themed viewer with TOC sidebar
50. **Media mini-player** — unified play/pause across tabs, media-key support
51. **PiP everywhere** — button on every video, drag-resize, always-on-top
52. **Force-Dark v2** — per-site toggle + night scheduler
53. **Sound control** — per-tab volume slider, mute-all, audio indicator upgrade
54. **Font pack** — curated open fonts + per-element overrides

## Phase 3 — Privacy: out-shield Brave (v1.9.0 "Fortress") — 14 items

55. **Adblock v2** — uBO-syntax parity, EasyList + regional lists (incl. Indian lists), trusted sites
56. **aether://shields dashboard** — blocked counts, per-site breakdown, data-saved estimate
57. **Fingerprint randomization** — canvas/audio/webgl noise, timezone pockets, hardware profiles
58. **Query-param scrubber** — strip utm/gclid/fbclid on every navigation, not just search
59. **Bounce-tracking defense** — ephemeral partition for tracker redirects
60. **HTTPS-only mode** — auto-upgrade + downgrade warning banner
61. **DoH selector** — Cloudflare/Quad9/Google/custom
62. **Cookie-consent auto-handler** — local heuristics click "reject all" (opt-in)
63. **Clear-data dialog** — history/cache/cookies/site-data × time ranges
64. **Site-data manager page** — per-site cookies, storage, service workers + wipe
65. **Password breach monitor** — k-anonymity HIBP check (opt-in, no account)
66. **Private window hardening v2** — no-disk-writes audit trail + Tor-mode experiment (SOCKS5 UI)
67. **Per-site shields presets** — aggressive/standard/trust like Brave
68. **Referrer & cross-site policy tightening** — strict-referrer default, per-site exceptions

## Phase 4 — AI: the beast differentiator (v2.0 "Aether Intelligence") — 14 items

69. **Page-aware chat v2** — streaming DOM-grounded answers with element citations, per-tab memory
70. **Agent v2** — multi-step web tasks with approval checkpoints + undo
71. **Smart tab orchestrator** — local-embedding clustering into auto tab groups
72. **TL;DR badge** — summarize-on-load, opt-in per site
73. **Local semantic history** — embeddings over history/bookmarks: "find that article about…"
74. **Multimodal** — right-click image → "Ask AI about this" (llava-class Ollama models)
75. **Voice control** — local STT → "open youtube", "summarize this tab"
76. **AI translate v2** — full-page with layout preservation, inline dual-language view
77. **Form-fill assistant** — local-only autofill with model extraction
78. **Search depth modes** — quick/deep/academic/code re-ranking
79. **Model manager v2** — VRAM calculator, per-task presets, benchmark page
80. **Macro marketplace (local)** — import/export agent macros as JSON
81. **AI privacy pledge page** — what never leaves the machine, documented and testable
82. **Study/Work profiles** — model presets + distraction shields + session scopes

## Phase 5 — Performance: faster than all of them (v2.1 "Swift") — 10 items

83. **Cold-start budget < 1.5 s** — lazy-load modules, defer extension boot, profile-guided init
84. **Warm-start < 700 ms** — startup boost + pre-warmed window (opt-in)
85. **Memory governor** — smarter discard, per-tab memory column
86. **aether://task-manager** — live per-tab CPU/memory/network
87. **Paint holding** — no white flash during navigations
88. **Omnibox first-paint < 100 ms** after window show
89. **Installer diet** — strip locales, exclude dev assets, target < 90 MB
90. **Battery saver** — throttle background tabs harder on battery
91. **CI speed benchmark suite** — page-load fixtures as regression gate
92. **Boot waterfall page** — dev-only startup-phase diagnostics (local-only)

## Phase 6 — Ecosystem & Desktop Maturity (v2.2–2.3 "Everyday") — 14 items

93. **Password vault v1** — safeStorage-encrypted, generator, autofill, export
94. **Import everything** — Chrome/Edge/Firefox bookmarks+history+passwords (CSV) + HTML export
95. **Multiple profiles** — avatars, per-profile themes/extensions, toolbar switcher
96. **Auto-update flow** — electron-updater vs GitHub Releases, hash-verified, "What's new" card
97. **Signed installers** — Windows Authenticode, macOS notarization, Linux repo signing
98. **Package matrix** — nsis/msi/portable zip, deb/rpm/AppImage/flatpak, dmg/pkg, arm64
99. **Crash reporter** — local minidumps + one-click GitHub issue prefill (no auto-send)
100. **i18n** — extraction framework, English + Hindi first, RTL-ready
101. **Accessibility pass** — keyboard-complete chrome, screen-reader labels, AA contrast
102. **Shortcuts page + remapping** — aether://settings/shortcuts
103. **Site-info manager page** — per-site permissions/cookies/zoom/shields in one place
104. **Downloads v2** — scheduler, checksum verify, resume across restarts
105. **Print & save-page completion** — MHTML save, print-to-PDF with headers
106. **First-run wizard v2** — import, theme, search choice, Ollama check, tour

## Phase 7 — Aether Everywhere: Mobile & beyond (v3.x "Odyssey") — 12 items

107. **Extract `@aether/core`** — engine-agnostic packages (search, session, adblock rules, model glue) — the mobile foundation
108. **Android v1** — WebView shell: Aether Search, bookmarks, reading mode, sync target
109. **Android v2** — GeckoView engine: real extensions + Brave-class privacy on mobile
110. **iOS v1** — WKWebView shell (Apple mandates WebKit): Aether Search + reader + sync
111. **Mobile UI** — bottom-omnibox layout, gesture nav, tablet layouts
112. **Cross-device sync (local-first)** — end-to-end encrypted, LAN pairing + export file, zero cloud accounts
113. **Android default-browser + Custom Tabs** provider registration
114. **iOS share extension** — save links/pages from other apps into Aether
115. **Store pipeline** — Play Store, App Store, F-Droid packaging + compliance
116. **Windows on ARM** build
117. **Kiosk / digital-signage mode** — `--kiosk` fullscreen lockdown for Linux/Windows
118. **Public power-user docs** — aether:// scheme reference, CLI flags, unattended install

---

# Historical plans (shipped)
---

## v1.3.0 — Aether Search (our own search engine)

### Why

Today `aether://search` is a thin client over whichever engine answers first
(DDG → DDG Lite → Bing) plus an AI answer when Ollama is up. There is no
"Aether" in the results: no own ranking, no dedupe, no instant answers, no
suggestion feed. Every serious browser owns its search *experience* — that is
the gap this closes.

### What "our own engine" honestly means

Aether is local-first and does not crawl the web (no server, no index). So
Aether Search = **an open metasearch layer**: we run the pipeline, we rank the
results, we brand the page, we generate the instant answers — and we say
transparently which upstream sources (DDG/Bing) fed each result. No fake
claims of a proprietary index, ever.

### Scope

1. **Aggregation + own ranking** (`src/main/search-engine.ts`, pure & tested)
   - `searchAll(q)` runs all upstream engines **in parallel** (allSettled, per-engine
     timeout) instead of the old first-success chain; every engine is tagged.
   - `aggregate(perEngine)` — dedupe by normalized URL (strip tracking params
     `utm_*/fbclid/gclid`), score = source-reliability + title↔query token
     overlap + snippet presence, then round-robin interleave so no single
     source owns the top slots. Deterministic (stable tie-breaks) for tests.
2. **Instant answers, 100% local** — `instantAnswer(q)`:
   - Safe arithmetic calculator (own tokenizer/parser — **no eval/Function**),
     `+ - * / % ^ ( )`, sqrt, constants; fires on "math-looking" queries.
   - Rendered as a card above web results, zero network needed.
3. **Omnibox suggestion feed** — `searchSuggestions(q)` via the DDG ac endpoint
   (1.5 s timeout, silent failure), merged with local history/bookmark matches
   by `mergeSuggestions()` (dedupe, local first, cap 8). Wired into
   `omnibox:suggest` for q ≥ 3 chars. The address bar finally suggests like a
   real engine.
4. **Branded search page** — rebuilt `aether://search`:
   - "Aether Search" identity header with the wordmark.
   - Instant-answer card, "Web" result list with per-result source badge
     (DDG/Bing), search-time stats (how many results, which sources, ms).
   - AI answer card stays **optional** (streams when Ollama is up; the page is
     fully useful without it — no more red banner dominating the experience).
   - Google-fallback button survives for total-outage cases.
5. **Brain pipeline** — AI answer now grounds on the *aggregated* result set.

### Acceptance criteria

- New suite `test-v130.mjs` ≥ 30 tests: tokenizer/parser (incl. hostile input),
  dedupe/scoring/interleave determinism, suggestion merge, tracking-param strip.
- All 9 existing suites still green (v113's webSearch chain contract untouched).
- Search page renders with zero network and zero Ollama (instant answer + empty
  state that explains itself).
- CI green on all three OSes → tag `v1.3.0` → GitHub Release.

---

## v1.4.0 — Customization Studio (make the browser yours)

### Why

It's open source — the user should *feel* that. Today every aether:// page is
hardcoded dark with one accent. v1.4 turns appearance into a first-class
Settings section.

### Scope

1. **Appearance model** (`src/main/appearance.ts`, pure & tested)
   - `AppearanceSettings`: `theme: 'dark' | 'light' | 'system'`,
     `accent: #rrggbb`, `fontScale: 0.85–1.25`, `newtabBg: 'aurora' | 'midnight' |
     'slate' | 'light' | 'solid'`, `newtabClock: boolean`.
   - `normalizeAppearance(patch)` — clamps, validates hex, rejects garbage
     (unknown values fall back to defaults; invalid patches never crash boot).
   - `appearanceCss(a)` — emits the `:root` CSS variable block consumed by all
     internal pages (`--ax-bg`, `--ax-fg`, `--ax-card`, `--ax-border`,
     `--ax-accent`, `--ax-accent-soft`, `--ax-muted`, base font size).
2. **All aether:// pages themed** — `pageShell()` injects the variable block;
   every hardcoded color in new-tab / search / settings / history / bookmarks /
   error pages moves to variables. Light theme is a real theme, not an
   afterthought (readable cards, borders, muted text tuned separately).
3. **Settings → "Customization" section** — theme radio, 8 accent presets +
   custom hex picker with live preview, font-scale slider, new-tab background
   gallery, clock toggle, **Restore defaults**. Saves via the existing settings
   IPC; re-opening any internal page re-themes instantly.
4. **New-tab personalization** — background presets (gradients incl. a light
   one), clock on/off. Top sites / bookmarks honor the theme variables.
5. **Chrome UI picks up accent + font scale** — `styles.css` moves to the same
   variables, applied live from settings at boot (chrome theme follows system
   in `system` mode).

### Acceptance criteria

- New suite `test-v140.mjs` ≥ 25 tests: normalize (valid/invalid/clamp/hex),
  CSS emission, light+dark palettes both present, defaults restore.
- Boot with a corrupted `settings.json` appearance blob → defaults, no crash.
- No internal page uses a hardcoded bg/accent color anymore (grep-enforced).
- CI green on all three OSes → tag `v1.4.0` → GitHub Release.

---

## Release process (every build, no exceptions)

```
build → full suite locally (all suites) → commit → push → CI green on 3 OSes
      → tag vX.Y.Z → release workflow builds installers → GitHub Release + notes
```

README features table + version badge updated in the same commit as each release.

---

## v1.5+ — "The Real-Browser Gap List" (audited 2026-10-25)

Everything a daily-driver browser has that Aether still lacks, audited against
the codebase. Already shipped (NOT listed): tabs w/ pin/mute/duplicate/discard/
reopen/hibernate + drag reorder, multi-window, Chrome extensions (CRX/ZIP),
Shields engine + per-site popup + custom filters, omnibox + suggestions,
aether:// newtab/search/history/bookmarks/settings/error pages, download bar,
find-in-page, per-site zoom bubble, permission prompts, agent + macros, model
manager, Customization Studio (theme/accent/scale/newtab), UA scrub, fullscreen.

### Tier 1 — "feels like a browser" (target: v1.5)

| # | Feature | Notes |
|---|---------|-------|
| 1 | Bookmarks bar | toggleable favicon row under omnibox; drag, folders on bar |
| 2 | Session restore | persist open tabs/windows to disk; "continue where you left off" on boot; crash → Restore bubble (in-memory reopenClosedTab exists) |
| 3 | Full downloads page | aether://downloads: search, pause/resume (DownloadItem API), re-download, open folder, clear |
| 4 | Print + Save page | Ctrl+P via printToPDF/print, Ctrl+S "save as" (HTML/MHTML), export to PDF |
| 5 | Private windows | ephemeral in-memory session, no history/cache writes, distinct chrome tint |
| 6 | Omnibox polish | favicons in suggestions, switch-to-open-tab rows, inline URL autocomplete |
| 7 | Search engine choice | settings UI: default among Aether Search/DDG/Bing/Google + @bookmarks @history @tabs bangs |
| 8 | Loading progress | spinner in tab + Chrome-style top progress line; site-info padlock chip in omnibox (click → shields/permissions summary) |
| 9 | Tab context menu completion | Close others, Close to the right, Reopen closed (exists), Mute site |
| 10 | First-run welcome | aether://welcome: theme pick, search choice, Ollama check, import hint |

### Tier 2 — Privacy + content power (target: v1.6)

| # | Feature | Notes |
|---|---------|-------|
| 11 | Multiple profiles | separate userData dirs + profile switcher in toolbar |
| 12 | Clear browsing data dialog | history/cache/cookies/site-data × time-range granular |
| 13 | Cookies & site-data viewer | per-site storage/cookies list + clear (shields popup extension) |
| 14 | Import from Chrome/Edge | bookmarks + history via HTML/JSON import (passwords need vault, see Tier 3) |
| 15 | HTTPS-only mode | auto-upgrade + warn-on-downgrade toggle |
| 16 | Secure DNS (DoH) | app.commandLine.appendSwitch DoH provider selector |
| 17 | Force dark webpages | WebContentsForceDark feature switch + toggle |
| 18 | Screenshot tool | Ctrl+Shift+S visible-area capture → copy/save; full-page later |
| 19 | Reader mode | reuse the existing Readability extraction (already in sidebar AI) |
| 20 | Full-page AI translate | extract → local-model translate → re-inject; sidebar translate exists for selections |
| 21 | Picture-in-picture | PIP button on <video>, media session integration |
| 22 | Download settings | default dir picker, ask-every-file toggle, auto-open types |

### Tier 3 — Differentiators & long tail (v1.7+)

| # | Feature | Notes |
|---|---------|-------|
| 23 | Tab groups + vertical tabs | named/colored collapsible groups; vertical strip mode (fits Customization Studio) |
| 24 | Tab hover previews | hover card w/ title+favicon, live thumbnail later |
| 25 | Password vault | local encrypted store (safeStorage) + autofill + generator |
| 26 | Form autofill | addresses; verify Chromium autofill support in Electron first |
| 27 | Auto-update flow | check GitHub Releases API → "update available" chip → download installer |
| 28 | Shortcuts page + remap | aether://settings/shortcuts listing accelerators; remap later |
| 29 | i18n | string extraction; English + Hindi first |
| 30 | Site-info manager page | per-site permissions/cookies/zoom/shields in one aether:// page |
| 31 | PDF viewer verify | ensure Chromium PDF plugin renders in-tab (else route to viewer page) |
| 32 | Portable / extra formats | Windows zip portable, Linux rpm/flatpak |
| 33 | Fingerprint defenses | Brave-style randomization (canvas/UA/ timezone) — long-term |
| 34 | Accessibility pass | aria on chrome UI, focus rings, light-theme contrast |

### Non-goals (stay honest)

- Own crawler/index (metasearch only, transparently branded)
- Telemetry, accounts, sync cloud (local-first identity)
- Bundled proprietary codecs beyond what Chromium/Electron ships legally
