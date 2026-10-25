# Aether Roadmap — v1.3 "Aether Search" & v1.4 "Customization Studio"

> Status: **FRAMED 2026-10-25** — specs below are the contract the builds must satisfy.
> Process: every build lands as its own version tag, pushed to GitHub with CI green
> before the next one starts (fix → commit → push → verify, the loop that got us here).

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
