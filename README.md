# Aether Browser 🌌

**An open-source, AI-native browser — full Chromium compatibility, powered 100% by your local model.**

Aether is a working desktop browser built on Electron (Chromium) with a built-in AI sidebar
that runs on **your own machine via Ollama**. No cloud, no API keys, no telemetry. It renders
Google, YouTube, and everything else — because under the hood it *is* Chromium.

![status](https://img.shields.io/badge/status-v0.2.0--alpha-orange) ![license](https://img.shields.io/badge/license-MIT-blue) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ Features (v0.2.0)

| Feature | What it does |
|---|---|
| 🌐 **Full browser** | Tabs (drag to reorder), omnibox with **live suggestions** (history, bookmarks, search), back/forward, zoom, downloads, find-in-page via agent |
| 💬 **Chat with any page** | The sidebar reads the page via Readability, converts to clean Markdown, and answers grounded questions — streamed token-by-token |
| 🤖 **Web automation agent** | Give it a task ("search X and open the first result"); it navigates, clicks, types, screenshots, lists tabs and **asks you questions** when unsure — with a confirmation gate before every mutating action (configurable) |
| 🔍 **AI search page** | The omnibox opens `aether://search` — free DuckDuckGo results + a cited local-AI answer side by side (Perplexity-style, but local) |
| ✍️ **Write helpers** | Select text on any page → right-click → Ask / Summarize / Rewrite / Translate into your sidebar |
| 🛡️ **Ad & tracker blocking** | EasyList + EasyPrivacy via `@cliqz/adblocker-electron`, filters cached on disk after first download, toggle in Settings |
| 🧭 **Manager pages** | `aether://history` (search, delete, clear), `aether://bookmarks`, `aether://settings` (model picker, search engine, agent behavior, privacy toggles) |
| 🔒 **Private by design** | All AI runs on `localhost:11434`. Pages can't touch the browser UI (IPC is sender-guarded); renderers are sandboxed with context isolation. One click clears history/bookmarks |
| 🪪 **Chrome-like identity** | Optionally strips the `Electron/` UA token so Google and YouTube treat Aether like a regular Chrome browser |

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

**Package installers** (NSIS / dmg / AppImage / deb):

```bash
npm run dist
```

**Headless smoke test** (used by CI — boots the real app, loads internal pages, exits):

```bash
AETHER_HEADLESS=1 AETHER_SMOKE=1 xvfb-run -a npx electron .
```

## 🧠 How the agent works

The core trick that makes a **9B local model** a usable web agent is *context compression*:

1. **DOM serializer** — the page's interactive elements (links, buttons, inputs) are extracted,
   tagged, and rendered as a numbered menu:
   ```
   [3] searchbox placeholder="Search Google or type a URL"
   [4] button "Google Search"
   [5] link "Gmail"
   ```
2. **Tool calling** — the model picks one action per step: `navigate`, `click`, `type`,
   `press_key`, `scroll`, `go_back`, `read_page`, `find_text`, `list_tabs`, `screenshot`,
   `ask_user`, `done`.
3. **Executor** — each tool runs against the tab's `WebContentsView` (real input events +
   React-safe native value setters), the page re-serializes, and the loop continues
   (max 12 steps) until the model calls `done`.
4. **Human in the loop** — every mutating action waits for your Allow/Deny, and the agent can
   pause and *ask you a clarifying question* mid-task (both toggleable / always available).

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React chrome UI): tabs, omnibox + suggestions, │
│                             sidebar (chat/agent)         │
├──────────────────────────────────────────────────────────┤
│ Preload (contextBridge): typed, guarded IPC API          │
├──────────────────────────────────────────────────────────┤
│ Main process                                             │
│  ├─ TabManager  — one WebContentsView per tab (+reorder) │
│  ├─ Agent       — serializer + 12 tools + loop + gates  │
│  ├─ Ollama      — NDJSON streaming client                │
│  ├─ Extract     — Readability + turndown → MD            │
│  ├─ Search      — DDG HTML + cited AI answers            │
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
- [ ] v0.3 — per-site permissions UI, agent reliability (retries, DOM diffing), in-app model manager (pull/delete)
- [ ] v0.4 — hybrid local+free-cloud fallback, page memory (sqlite-vec), agent macros (record/replay), find-in-page UI
- [ ] v1.0 — extension support via electron-chrome-extensions, tab discarding, docs site, stable releases

## 🔐 Security notes

- Renderers run with `contextIsolation`, `sandbox`, and no Node integration.
- Tab/agent/settings/history IPC handlers verify the sender is the chrome UI; internal-page
  handlers verify the sender URL is `aether://`. Ollama probing (`ai:health`, `ai:models`) is
  blocked for regular web pages.
- Model output is **never** rendered as HTML — all internal pages build DOM via `textContent`.
- The agent is hard-prompted to never enter passwords or payment details, and stops at captchas/login walls.
- Still alpha: audit before daily driving. File security issues privately.

## 🧑‍💻 Contributing

PRs welcome! Good first issues: PDF viewer setup, find-in-page UI, keyboard cheat-sheet overlay,
per-site zoom, tab context menu (duplicate/pin/mute). Run `npm run typecheck` before committing.

**Renaming the project:** search-replace `aether`/`Aether` across `package.json`,
`electron-builder.yml`, `src/main/index.ts` (protocol), and this README.

## 📄 License

MIT — see [LICENSE](LICENSE). Built with [Electron](https://electronjs.org),
[Ollama](https://ollama.com), [Readability](https://github.com/mozilla/readability),
[adblocker](https://github.com/cliqz-oss/adblocker),
[React](https://react.dev) and [Zustand](https://github.com/pmndrs/zustand).
