# Aether Browser 🌌

**An open-source, AI-native browser — full Chromium compatibility, powered 100% by your local model.**

Aether is a working desktop browser built on Electron (Chromium) with a built-in AI sidebar
that runs on **your own machine via Ollama**. No cloud, no API keys, no telemetry. It renders
Google, YouTube, and everything else — because under the hood it *is* Chromium.

![status](https://img.shields.io/badge/status-v0.4.0--alpha-orange) ![license](https://img.shields.io/badge/license-MIT-blue) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ Features (v0.4.0)

| Feature | What it does |
|---|---|
| 🌐 **Full browser** | Tabs (drag to reorder), omnibox with **live suggestions** (history, bookmarks, search), back/forward, zoom, downloads, **find-in-page bar (Ctrl+F)** |
| 💬 **Chat with any page** | The sidebar reads the page via Readability, converts to clean Markdown, and answers grounded questions — streamed token-by-token |
| 🧠 **Page memory** | Sidebar conversations are remembered **per site** (locally), so follow-up visits start with prior context — toggleable, clearable |
| 🤖 **Web automation agent** | Give it a task; it navigates, clicks, types, screenshots, lists tabs and **asks you questions** when unsure — with a confirmation gate before every mutating action (configurable). v0.4 adds **stable element refs + DOM diffing** (less tokens, fewer mis-clicks) and **one-click retry** on model hiccups |
| ⏺ **Agent macros** | Tick "Record as macro" before a run, then replay the recorded actions **without the model** — elements are re-located by CSS path, confirm gate still applies |
| 🔍 **AI search page** | The omnibox opens `aether://search` — free DuckDuckGo results + a cited local-AI answer side by side (Perplexity-style, but local) |
| ✍️ **Write helpers** | Select text on any page → right-click → Ask / Summarize / Rewrite / Translate into your sidebar |
| 🛡️ **Ad & tracker blocking** | EasyList + EasyPrivacy via `@cliqz/adblocker-electron`, filters cached on disk after first download, toggle in Settings |
| 🔐 **Site permissions** | Chrome-style prompts for camera / mic / location / notifications with **remember per site**; manage or forget every grant in Settings |
| ☁️ **Optional cloud fallback** | If Ollama is unreachable, chat & AI search can use **any OpenAI-compatible endpoint** (Groq / OpenRouter free tiers…). Opt-in, key stays on disk, agent stays local |
| 🧭 **Manager pages** | `aether://history` (search, delete, clear), `aether://bookmarks`, `aether://settings` (model picker, search engine, permissions manager, cloud fallback, privacy toggles) |
| 📦 **Model Library** | Add **any Ollama model in-app** — no CLI needed: curated catalog (Qwen 9B/4B/1.7B, Llama, Gemma, Phi, Hermes, Mistral, DeepSeek-R1, coder, vision, tiny), or type **any tag** (`qwen3.5:4b`, `hf.co/…` GGUF) → live pull progress, cancel, delete, one-click "Use" |
| 🔒 **Private by design** | All AI runs on `localhost:11434` by default. Pages can't touch the browser UI (IPC is sender-guarded); renderers are sandboxed with context isolation. One click clears history / bookmarks / memory / permissions |
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
>
> **No CLI? No problem.** Once Ollama is running, open the sidebar → **Models** (or `Ctrl+Shift+M`) and pull any
> model from inside the browser — including the 4B class for smaller machines. First model pulled automatically
> becomes the default brain.

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
- [x] v0.3 — **in-app model manager** (pull ANY Ollama tag with live progress, cancel, delete, active-model switch)
- [x] v0.4 — **find-in-page bar, per-site permissions UI, agent reliability (stable refs + DOM diffing + retries), page memory, agent macros (record/replay), optional cloud fallback (OpenAI-compatible)**
- [ ] v1.0 — extension support via electron-chrome-extensions, tab discarding, per-site zoom, docs site, stable releases

## 🔐 Security notes

- Renderers run with `contextIsolation`, `sandbox`, and no Node integration.
- Tab/agent/settings/history IPC handlers verify the sender is the chrome UI; internal-page
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
- Still alpha: audit before daily driving. File security issues privately.

## 🧑‍💻 Contributing

PRs welcome! Good first issues: PDF viewer setup, keyboard cheat-sheet overlay,
per-site zoom, tab context menu (duplicate/pin/mute), macro step editing UI.
Run `npm run typecheck` before committing. Unit tests: `node scripts/test-v04.mjs`.

**Headless checks** (used by CI — typecheck, build, boot + internal pages, unit tests):

```bash
npm run typecheck && npm run build
AETHER_HEADLESS=1 AETHER_SMOKE=1 xvfb-run -a npx electron .
node scripts/test-v04.mjs
```

**Renaming the project:** search-replace `aether`/`Aether` across `package.json`,
`electron-builder.yml`, `src/main/index.ts` (protocol), and this README.

## 📄 License

MIT — see [LICENSE](LICENSE). Built with [Electron](https://electronjs.org),
[Ollama](https://ollama.com), [Readability](https://github.com/mozilla/readability),
[adblocker](https://github.com/cliqz-oss/adblocker),
[React](https://react.dev) and [Zustand](https://github.com/pmndrs/zustand).
