# Aether Browser 🌌

**An open-source, AI-native browser — full Chromium compatibility, powered 100% by your local model.**

Aether is a working desktop browser built on Electron (Chromium) with a built-in AI sidebar
that runs on **your own machine via Ollama**. No cloud, no API keys, no telemetry. It renders
Google, YouTube, and everything else — because under the hood it *is* Chromium.

![status](https://img.shields.io/badge/status-v1.1.5-blue) ![license](https://img.shields.io/badge/license-GPL--3.0-green) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey) [![docs](https://img.shields.io/badge/docs-online-7c8cff)](docs/index.html)

---

## ✨ Features (v1.1.5)

| Feature | What it does |
|---|---|
| 🌐 **Full browser** | **Multi-window** (Ctrl+N, move/drag tabs out into their own window), tabs (drag to reorder, **pin, mute, duplicate, discard, hibernate** + full tab context menu), omnibox with **live suggestions** (history, bookmarks, search), back/forward, **per-site zoom** with Chrome-style bubble, **download shelf** (progress / cancel / reveal), **find-in-page bar (Ctrl+F)** |
| 💬 **Chat with any page** | The sidebar reads the page via Readability, converts to clean Markdown, and answers grounded questions — streamed token-by-token |
| 🧠 **Page memory** | Sidebar conversations are remembered **per site** (locally), so follow-up visits start with prior context — toggleable, clearable |
| 🤖 **Web automation agent** | Give it a task; it navigates, clicks, types, screenshots, lists tabs and **asks you questions** when unsure — with a confirmation gate before every mutating action (configurable). v0.4 adds **stable element refs + DOM diffing** (less tokens, fewer mis-clicks) and **one-click retry** on model hiccups |
| ⏺ **Agent macros** | Tick "Record as macro" before a run, then replay the recorded actions **without the model** — elements are re-located by CSS path, confirm gate still applies. **Step editor**: rename, reorder, edit args, add/remove steps. **Import / export** macros as `.macro.json` files to share or back them up |
| 🧩 **Chrome extensions** | **One-click install of .crx / .zip packages** (file dialog, drag-and-drop onto Settings, or "Open with Aether" from your OS — .crx is a registered file type on Windows), plus **unpacked MV2/MV3 folders** (content scripts, background pages, popups, `chrome.contextMenus`) via `electron-chrome-extensions`; browser-action icons live in the toolbar, manage / disable / remove in Settings |
| 💤 **Tiered memory saver** | Idle background tabs first **hibernate** (muted + throttled to 1 fps — instant wake, no reload), then fully **discard** after 3× the delay (view unloaded, URL kept). Pinned and audio-playing tabs are exempt |
| 🔍 **AI search page** | The omnibox opens `aether://search` — free web results (DuckDuckGo → DuckDuckGo Lite → **Bing** automatic fallback chain) + a cited local-AI answer side by side (Perplexity-style, but local). If every engine fails, one click re-runs the search on Google |
| ✍️ **Write helpers** | Select text on any page → right-click → Ask / Summarize / Rewrite / Translate into your sidebar |
| 🛡️ **Ad & tracker blocking** | EasyList + EasyPrivacy via `@cliqz/adblocker-electron`, filters cached on disk after first download, toggle in Settings |
| 🔐 **Site permissions** | Chrome-style prompts for camera / mic / location / notifications with **remember per site**; manage or forget every grant in Settings |
| ☁️ **Optional cloud fallback** | If Ollama is unreachable, chat & AI search can use **any OpenAI-compatible endpoint** (Groq / OpenRouter free tiers…). Opt-in, key stays on disk, agent stays local |
| 🧭 **Manager pages** | `aether://history` (search, delete, clear), `aether://bookmarks`, `aether://settings` (model picker, search engine, **extensions manager**, **memory saver**, permissions manager, cloud fallback, privacy toggles) |
| 📦 **Model Library** | Add **any Ollama model in-app** — no CLI needed: curated catalog (Qwen 9B/4B/1.7B, Llama, Gemma, Phi, Hermes, Mistral, DeepSeek-R1, coder, vision, tiny), or type **any tag** (`qwen3.5:4b`, `hf.co/…` GGUF) → live pull progress, cancel, delete, one-click "Use" |
| 🔒 **Private by design** | All AI runs on `localhost:11434` by default. Pages can't touch the browser UI (IPC is sender-guarded); renderers are sandboxed with context isolation. One click clears history / bookmarks / memory / permissions |
| 🪪 **Chrome-like identity** | Optionally strips the `Electron/` UA token so Google and YouTube treat Aether like a regular Chrome browser |

## 🛂 v1.1.5 — the UI could talk, but the browser refused to listen

- **THE root cause of "still can't open the site":** the IPC security guard trusted only `aether://`
  senders — but the browser's own chrome UI runs on the Vite dev server in dev (`http://localhost:5173/`)
  and on `file://` in production, so **every call from the toolbar was rejected**:
  `Unauthorized IPC call to omnibox:suggest from http://localhost:5173/` on every keystroke, and pressing
  Enter in the address bar did **nothing**. (The multi-window refactor had dropped the old `isChrome()`
  check; v1.1.4 restored the bridge, which finally exposed this second lock.)
- **Fix:** the guard now trusts the chrome-UI window by **identity** — the sender must literally BE the
  registered window's own webContents — which works identically in dev and production while a normal
  `http(s)`/`file://` page opened in a tab still gets rejected. `aether://` internal pages keep the same
  access as before, and the strict `internal:*` handlers stay aether-only
- **Proven end-to-end:** the smoke suite now drives the exact user flow from the chrome UI's own execution
  context — `omnibox.suggest()` resolves (no more Unauthorized spam) and **"type example.com + Enter" in the
  top address bar opens the site** — plus 28 new trust-policy unit tests (149 total) green

## 🌉 v1.1.4 — the bridge fix (why every click was dead)

- **THE root cause of "can't search / can't open any site":** the UI bridge (`window.aether`) was never
  loading. Two independent kills: (1) tab preloads run sandboxed, where Electron only allows
  `require("electron")` — the preload's `electron-chrome-extensions` import threw "module not found" and
  **died before exposing the bridge**; (2) the chrome-UI window had **no preload at all**. Result: pages
  rendered, but the address bar, Enter-in-new-tab, buttons and sidebar all silently did nothing
- **Fix:** clean two-preload architecture — tab views get a minimal sandbox-safe bridge (single file,
  requires `electron` only, verified after every build by `scripts/patch-preload-sandbox.mjs`); the trusted
  chrome UI gets a generated `ui.js` (same bridge + extension browser-action glue, legal there because the
  chrome window runs `sandbox:false`)
- **Proven end-to-end:** new headless smoke checks boot the real app and verify the bridge in BOTH
  renderers, then **type a domain into the new-tab box, press Enter, and assert the site opened** —
  plus 121 unit tests still green
- **New-tab page hardening:** the box is a real form (Enter works under any keyboard/IME), the **AI badge
  is now a clickable button** (opens the AI search page for your query), and if the bridge ever fails
  again the page shows a **visible red error banner** with recovery steps instead of silently dying
- v1.1.3's search engine chain (DuckDuckGo → Lite → Bing + Google fallback button) unchanged

## 🔍 v1.1.3 — search that actually searches

- **Root cause fixed:** DuckDuckGo serves an HTTP-202 "anomaly" page to many networks (very common in India) —
  the old code silently parsed it to **zero results**, so the AI search page looked broken with no error
- **Multi-engine fallback chain:** DuckDuckGo → DuckDuckGo Lite → **Bing** (parses Bing's `ck/a` base64url
  redirects back to real URLs) — first engine that returns real results wins, verified live: DDG 202 →
  Bing answers in ~1s
- **Never a dead end:** if every engine fails, the search page shows the reason per engine plus a
  **"Search on Google instead"** button; a watchdog replaces the old infinite "Searching the web…" hang
- **Clearer no-Ollama state:** web results always display; the AI-answer-unavailable message now explains
  exactly what to start (Ollama in the tray) or how to switch search modes
- New-tab search box now resolves input exactly like the omnibox (typing `youtube.com` opens the site — v1.1.2)
- Regression suite `scripts/test-v113.mjs`: 19 tests covering anomaly fallthrough, Bing parsing,
  engine ordering, all-fail errors and search routing

## 🩹 v1.1.1 — bugfix release

- **Windows:** downloads with illegal names (`report:.pdf`, `CON`, trailing dots) no longer fail — filenames are sanitized for NTFS
- **Windows:** window now shows the Aether icon in the taskbar/title bar during dev & unpackaged runs
- **Windows:** "Ollama not reachable" hint now points to the Start-menu app instead of `ollama serve`
- **Auto-repair:** `npm install` now detects a broken Electron download and fixes it automatically (`npm run repair:electron` to trigger manually, `npm run setup:win` for the full Windows setup)
- **Shortcuts that work everywhere:** Ctrl+L (address bar) and Ctrl+Shift+A (AI sidebar) now fire even when a web page has keyboard focus; new: **Ctrl+Shift+T** reopen closed tab, **Ctrl+Tab / Ctrl+Shift+Tab** cycle tabs, **Ctrl+1–9** jump to tab, **F5** reload
- **Search:** AI search now falls back to DuckDuckGo Lite when the HTML endpoint fails
- Version footers no longer drift (About panel + internal pages use the live version); second-instance lock properly focuses/creates a window

## 🚀 Quickstart

**Prerequisites:** [Node.js](https://nodejs.org) 20+, and [Ollama](https://ollama.com) with a
tool-calling-capable model:

```bash
# 1. Install Ollama (https://ollama.com/download), then:
ollama pull qwen3.5:9b        # ~6GB — great tool calling + multimodal
# Alternatives: hermes3:8b, llama3.1:8b  (8GB RAM)   qwen2.5:14b (16GB RAM)

# 2. Run Aether
npm install
npm run dev
```

> On 8GB machines, use `ollama pull qwen3.5:4b` instead — Aether auto-detects whatever you have.
>
> **No CLI? No problem.** Once Ollama is running, open the sidebar → **Models** (or `Ctrl+Shift+M`) and pull any
> model from inside the browser — including the 4B class for smaller machines. First model pulled automatically
> becomes the default brain.
>
> **Do I need Ollama running?** Only for the **AI parts** — the sidebar chat, the AI answer on the search page,
> and the web agent. Regular browsing and the web-results half of AI search work without it. Leave the Ollama
> app running in the tray (it starts with Windows by default) and everything AI just works. No Ollama? Switch
> Settings → Search mode to Google or DuckDuckGo and use Aether as a plain fast browser.

**Windows 11 / 10 one-shot setup** — installs dependencies, auto-repairs the Electron binary if its
download was interrupted (antivirus / flaky network), and checks Ollama for you:

```powershell
npm run setup:win        # or: powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
npm run dev
```

The Electron auto-repair also runs automatically after every `npm install` (`postinstall`), so
"Electron failed to install correctly" fixes itself; you can also trigger it manually with
`npm run repair:electron`.

**Package installers** (NSIS / dmg / AppImage / deb):

```bash
npm run dist
```

**Headless smoke test** (used by CI — boots the real app, loads internal pages, exits):

```bash
AETHER_HEADLESS=1 AETHER_SMOKE=1 xvfb-run -a npx electron .
```

## 📦 Model Library

The **Models** tab in the sidebar manages your local model zoo end-to-end:

- **Add any model** — either from the curated catalog (with disk size + RAM hints) or by typing any exact
  Ollama tag in the custom field: `qwen3.5:4b`, `llama3.1:8b`, `deepseek-r1:8b`, `hf.co/org/model-GGUF`…
- **Live progress** — NDJSON streaming from Ollama renders per-model progress bars with percentage and status;
  pulls keep running in the main process even if you close the sidebar or switch tabs, and reopen with state intact
- **Cancel / delete / switch** — stop a download mid-flight, free disk space with a two-step delete, and make any
  installed model the active brain for chat, writing and the agent in one click
- **Smart defaults** — if no model is configured when a pull finishes, it is set as the active model automatically

## 🧠 How the agent works

The core trick that makes a **9B local model** a usable web agent is *context compression*:

1. **DOM serializer with stable refs** — the page's interactive elements (links, buttons, inputs) are
   extracted, tagged, and rendered as a numbered menu:
   ```
   [3] searchbox placeholder="Search Google or type a URL"
   [4] button "Google Search"
   [5] link "Gmail"
   ```
   Each element gets a **stable ref** (an identity key persisted per page), so the same button keeps
   the same number while you interact with the page.
2. **Tool calling** — the model picks one action per step: `navigate`, `click`, `type`,
   `press_key`, `scroll`, `go_back`, `read_page`, `find_text`, `list_tabs`, `screenshot`,
   `ask_user`, `done`.
3. **DOM diffing** — after a click or typing, the agent sends the model a **diff**
   (`+ [9] button "OK" (new)` / `- [2] link "Old" (gone)`) instead of the whole menu again —
   big token savings on small-context models, and fewer mis-clicks.
4. **Executor with retries** — each tool runs against the tab's `WebContentsView` (real input
   events + React-safe native value setters), transient model failures are retried once, and the
   loop continues (max 12 steps) until the model calls `done`.
5. **Human in the loop** — every mutating action waits for your Allow/Deny, and the agent can
   pause and *ask you a clarifying question* mid-task (both toggleable / always available).
6. **Macros** — with ⏺ Record on, successful actions are saved as a replayable script. Replay
   re-finds elements by captured CSS locators, needs **no model at all**, and still respects the
   confirm gate.

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React chrome UI): tabs, omnibox + suggestions, │
│        find bar, perm prompts, sidebar (chat/agent/models)│
├──────────────────────────────────────────────────────────┤
│ Preload (contextBridge): typed, guarded IPC API          │
├──────────────────────────────────────────────────────────┤
│ Main process                                             │
│  ├─ TabManager  — one WebContentsView per tab (+reorder) │
│  ├─ Agent       — stable refs, diffing, 12 tools, macros │
│  ├─ Brain       — Ollama first, optional cloud fallback  │
│  ├─ Memory      — per-domain page memory (local JSON)    │
│  ├─ Permissions — per-site prompts + remembered grants   │
│  ├─ Extract     — Readability + turndown → MD            │
│  ├─ Search      — DDG → Lite → Bing chain + cited AI answers │
│  ├─ Adblock     — EasyList/EasyPrivacy, cached engine    │
│  └─ Store       — settings / history / bookmarks (JSON)  │
├──────────────────────────────────────────────────────────┤
│ aether:// protocol — new tab, AI search, history,        │
│                       bookmarks, settings pages          │
└──────────────────────────────────────────────────────────┘
```

## 🗺️ Roadmap

- [x] v0.1 — browser shell, chat-with-page, write helpers, AI search, agent v0 with confirm gate
- [x] v0.2 — ad blocking, omnibox autocomplete, history/bookmarks/settings pages, tab drag-reorder, agent ask_user/list_tabs/screenshot tools, Chrome-like UA
- [x] v0.3 — **in-app model manager** (pull ANY Ollama tag with live progress, cancel, delete, active-model switch)
- [x] v0.4 — **find-in-page bar, per-site permissions UI, agent reliability (stable refs + DOM diffing + retries), page memory, agent macros (record/replay), optional cloud fallback (OpenAI-compatible)**
- [x] v1.0 — **extension support via electron-chrome-extensions, memory saver / tab discarding (+ pin, mute, duplicate, tab context menu), per-site zoom with bubble, download shelf, macro step editor, docs site**
- [x] v1.1 — **multi-window support (Ctrl+N, move/drag tab to new window), one-click CRX/ZIP extension install (dialog, drag-drop, "open with Aether"), tiered memory saver (hibernate → discard), macro import/export**
- [x] v1.1.2/1.1.3 — **new-tab omnibox parity, resilient multi-engine search (DDG → Lite → Bing + Google fallback), Windows Electron auto-repair, NTFS-safe downloads, global shortcuts**
- [x] v1.1.4 — **UI bridge fix: sandbox-safe preload + chrome-UI preload, bridge alive in every renderer, new-tab form + clickable AI button + visible bridge-error banner**
- [x] v1.1.5 — **IPC trust fix: the chrome UI is trusted by identity (dev Vite URL + prod file://), address bar & toolbar fully functional again, smoke proves suggest + Enter-navigation from the UI**
- [ ] v1.2 — extension store search UI, tab hibernation tiers UI, per-tab agent sessions

## 🔐 Security notes

- Renderers run with `contextIsolation` and no Node integration. Tab views (web pages + internal pages)
  are additionally `sandbox:true` with a preload bundle that requires only `electron` (enforced after every
  build by `scripts/patch-preload-sandbox.mjs`). The first-party chrome UI window runs `sandbox:false` so
  its preload can load the extension glue — `nodeIntegration` stays off and `window.aether` is its only bridge.
- Tab/agent/settings/history IPC handlers verify the sender is the chrome UI **by identity** (the sender must
  be the registered window's own webContents — see `src/main/trust.ts` for the policy); internal-page
  handlers verify the sender URL is `aether://`. Ollama probing (`ai:health`, `ai:status`,
  `ai:models`) and the model library (`models:pull` / `delete` / …) are blocked for regular web pages.
- **Permissions**: harmless capabilities (fullscreen, clipboard write) are auto-allowed; camera /
  mic / location / notifications / MIDI / screen-capture show an in-browser prompt with an optional
  per-site "remember"; everything else is denied by default. All grants are listed and revocable in Settings.
- **Cloud fallback is opt-in and off by default**; it only covers sidebar chat & AI search (the agent
  stays local), and your API key is stored in the local settings file only.
- **Macros replay with the same confirm gate** as live agent runs — a recorded click can't bypass Allow/Deny.
- Model output is **never** rendered as HTML — all internal pages build DOM via `textContent`.
- The agent is hard-prompted to never enter passwords or payment details, and stops at captchas/login walls.
- v1.0 is a stability milestone, but independent security review is still welcome — file issues privately.

## 🧑‍💻 Contributing

PRs welcome! Good first issues: per-extension permission prompts, macro import/export,
tab hibernation tiers, multi-window support.
Run `npm run typecheck` before committing. Unit tests: `npm test` (all suites).

**Headless checks** (used by CI — typecheck, build, boot + internal pages + discard/wake, unit tests):

```bash
npm run typecheck && npm run build
AETHER_HEADLESS=1 AETHER_SMOKE=1 xvfb-run -a npx electron .
npm test
```

**Renaming the project:** search-replace `aether`/`Aether` across `package.json`,
`electron-builder.yml`, `src/main/index.ts` (protocol), and this README.

**Documentation:** the full user guide lives in [docs/index.html](docs/index.html) — it is published
to GitHub Pages by `.github/workflows/docs.yml` on every push to `main`.

## 📄 License

**GPL-3.0** — see [LICENSE](LICENSE).

Aether is GPL-3.0 because its extension support is built on
[`electron-chrome-extensions`](https://github.com/samuelmaddock/electron-chrome-extensions), which is
dual-licensed GPL-3.0 / patron. Adopting GPL-3.0 keeps the whole project free and open source
(the same choice the reference browser shell made). All other dependencies are MIT/BSD/Apache.

Built with [Electron](https://electronjs.org), [Ollama](https://ollama.com),
[electron-chrome-extensions](https://github.com/samuelmaddock/electron-chrome-extensions),
[Readability](https://github.com/mozilla/readability),
[adblocker](https://github.com/cliqz-oss/adblocker),
[React](https://react.dev) and [Zustand](https://github.com/pmndrs/zustand).
