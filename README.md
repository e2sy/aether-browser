# Aether Browser 🌌

**An open-source, AI-native browser — full Chromium compatibility, powered 100% by your local model.**

Aether is a working desktop browser built on Electron (Chromium) with a built-in AI sidebar
that runs on **your own machine via Ollama**. No cloud, no API keys, no telemetry. It renders
Google, YouTube, and everything else — because under the hood it *is* Chromium.

![status](https://img.shields.io/badge/status-v0.1.0--alpha-orange) ![license](https://img.shields.io/badge/license-MIT-blue) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ Features (v0.1.0)

| Feature | What it does |
|---|---|
| 🌐 **Full browser** | Tabs, omnibox (URL + search), back/forward, bookmarks, history, top sites, downloads-ready |
| 💬 **Chat with any page** | The sidebar reads the page via Readability, converts to clean Markdown, and answers grounded questions — streamed token-by-token |
| 🤖 **Web automation agent** | Give it a task ("search X and open the first result"); it navigates, clicks, types and reads pages using tool-calling, **asking your permission before every action** (configurable) |
| 🔍 **AI search page** | The omnibox opens `aether://search` — free DuckDuckGo results + a cited local-AI answer side by side (Perplexity-style, but local) |
| ✍️ **Write helpers** | Select text on any page → right-click → Ask / Summarize / Rewrite / Translate into your sidebar |
| 🔒 **Private by design** | All AI runs on `localhost:11434`. Pages can't touch the browser UI (IPC is sender-guarded); renderers are sandboxed with context isolation |

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
   `press_key`, `scroll`, `go_back`, `read_page`, `find_text`, `done`.
3. **Executor** — each tool runs against the tab's `WebContentsView` (real input events +
   React-safe native value setters), the page re-serializes, and the loop continues
   (max 12 steps) until the model calls `done`.
4. **Confirmation gate** — every mutating action waits for your Allow/Deny (toggleable in settings).

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────┐
│ Renderer (React chrome UI): tabs, omnibox, sidebar │
├────────────────────────────────────────────────────┤
│ Preload (contextBridge): typed, guarded IPC API    │
├────────────────────────────────────────────────────┤
│ Main process                                       │
│  ├─ TabManager  — one WebContentsView per tab      │
│  ├─ Agent       — serializer + tools + loop        │
│  ├─ Ollama      — NDJSON streaming client          │
│  ├─ Extract     — Readability + turndown → MD      │
│  ├─ Search      — DDG HTML + cited AI answers      │
│  └─ Store       — settings / history / bookmarks   │
├────────────────────────────────────────────────────┤
│ aether:// protocol — new tab + AI search pages     │
└────────────────────────────────────────────────────┘
```

## 🗺️ Roadmap

- [x] v0.1 — browser shell, chat-with-page, write helpers, AI search, agent v0 with confirm gate
- [ ] v0.2 — ad blocking (@cliqz/adblocker), per-site permissions, agent reliability (retries, DOM diffing)
- [ ] v0.3 — in-app model manager (pull/delete), hybrid local+free-cloud mode, page memory (sqlite-vec)
- [ ] v0.4 — agent macros (record/replay JSON workflows), multi-tab tasks, screenshot tool
- [ ] v1.0 — extension support via electron-chrome-extensions, tab discarding, docs site, stable releases

## 🔐 Security notes

- Renderers run with `contextIsolation`, `sandbox`, and no Node integration.
- Tab/agent/settings IPC handlers verify the sender is the chrome UI; internal-page handlers
  verify the sender URL is `aether://`.
- Model output is **never** rendered as HTML — all internal pages build DOM via `textContent`.
- The agent is hard-prompted to never enter passwords or payment details, and stops at captchas/login walls.
- Still alpha: audit before daily driving. File security issues privately.

## 🧑‍💻 Contributing

PRs welcome! Good first issues: omnibox autocomplete, PDF viewer setup, find-in-page UI,
tab drag-reorder, keyboard cheat-sheet overlay. Run `npm run typecheck` before committing.

**Renaming the project:** search-replace `aether`/`Aether` across `package.json`,
`electron-builder.yml`, `src/main/index.ts` (protocol), and this README.

## 📄 License

MIT — see [LICENSE](LICENSE). Built with [Electron](https://electronjs.org),
[Ollama](https://ollama.com), [Readability](https://github.com/mozilla/readability),
[React](https://react.dev) and [Zustand](https://github.com/pmndrs/zustand).
