# Aether Roadmap

> Status: **UPDATED 2026-10-25 after v1.6.0** — shipped so far: v1.3.0 Aether Search (metasearch
> core), v1.4.0 Customization Studio, v1.4.1 Ollama auto-reconnect, v1.5.0 the real-browser core
> (bookmarks bar, session restore, downloads page, private windows, progress + site info), and
> **v1.6.0 Beast Search** (43 bangs, instant answers v2 — units/percent/world clock, Wikipedia +
> Mojeek sources, domain-diversity ranking, knowledge panels, full keyboard UX) plus the
> window-controls fix. Everything below is the contract the builds satisfied; the remaining
> Tier-2/Tier-3 tables are what comes next.
> Process: every build lands as its own version tag, pushed with CI green before the next one.
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
