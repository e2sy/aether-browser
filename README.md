# Aether Browser 🌌

**An open-source, AI-native browser — full Chromium compatibility, powered 100% by your local model.**

Aether is a working desktop browser built on Electron (Chromium) with a built-in AI sidebar
that runs on **your own machine via Ollama**. No cloud, no API keys, no telemetry. It renders
Google, YouTube, and everything else — because under the hood it *is* Chromium.

![status](https://img.shields.io/badge/status-v2.7.0-blue) ![CI](https://github.com/e2sy/aether-browser/actions/workflows/build.yml/badge.svg) ![license](https://img.shields.io/badge/license-GPL--3.0-green) ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey) [![docs](https://img.shields.io/badge/docs-online-7c8cff)](docs/index.html)

---

## ✨ Features (v2.7.0)

| Feature | What it does |
|---|---|
| 🧩 **Container tabs + 🕵️ IP masquerade + 🎭 fingerprint farbling (v2.7.0)** | **Container tabs (Firefox-style)** — every container is a fully isolated session: own cookies, logins, localStorage and cache (persist partition). Five built-ins seeded (Work, Banking, Shopping, Social, Anonymous), color-chipped tabs, right-click → “Reopen in …”, links opened from a container stay inside it, containers survive restarts, per-container **own proxy + timezone**. **IP masquerade — the honest “IP spoofer”** — no browser can fake its IP without routing, so Aether ships the real thing: a proxy manager (http/https/socks5, **global or per-container**), a **one-click Tor preset** (`socks5://127.0.0.1:9050`), the **WebRTC leak shield** (non-proxied UDP disabled — the #1 way your real IP leaks behind a proxy), and a **“Check my IP”** verifier that fetches Cloudflare's plain-text trace *through the session in question* (logs stay masked). **Fingerprint farbling (Brave-style)** — every site gets different-but-session-stable readings for canvas, WebGL GPU strings, audio, and hardware; proxied containers can spoof their timezone to match the exit region. All sandbox-safe, per-feature try/catch, one toggle in Settings. Plus **cookie-banner filter presets** (uBlock Annoyances + EasyList Cookie) that kill consent popups |
| 🧠 **Ask AI about this image + 🌐 full-page translate + 🗂️ topic tab groups (v2.6.0)** | **Image-ask (multimodal)** — right-click any image → “Ask AI about this image”: main fetches the image (http/s, 5 MB cap), the sidebar auto-asks with the picture attached, and Aether **auto-selects a vision-capable Ollama model** (capability check via `/api/show`, name-pattern fallback: llama3.2-vision / llava / qwen-vl / moondream / gemma3…) — the regular chat model stays untouched for text turns. **Full-page translate** — View → Translate Page… (Alt+Shift+T) or right-click → “Translate page…”: the readable text is extracted with Readability, then translated **chunk-by-chunk by your own local model** on `aether://translate` — 30 languages (incl. Hindi, Bengali, Tamil, Telugu, Marathi and the other 8th-schedule languages), bilingual blocks, live progress, stop button, “translation only” toggle, language choice remembered. Text never leaves the machine. **Group tabs by topic** — View → Group Tabs by Topic: open tabs are embedded with your local nomic-embed-text/mxbai/all-minilm and clustered (greedy online centroids) into **real named tab groups** (“Pasta & Dinner”, “Hooks & React”…) — only http(s) tabs, never touches manually grouped tabs |
| 📖 **Reader view + 📸 screenshots + 📺 PiP + 📊 task manager (v2.5.0)** | **Reader view (F9)** — Firefox-style clean typography for articles: capture the live page, parse it with Readability, sanitize to a strict tag+attribute whitelist, re-render on `aether://reader` with serif type, A−/A+ font controls, byline + reading time; also in the right-click menu and from any web page. **Screenshots (Ctrl+Shift+S)** — capture the visible page, save to `userData/screenshots/` with timestamped names **and** copy to the clipboard (Electron-45 W3C clipboard), notification confirms; "Open Screenshots Folder" in the View menu. **Picture-in-Picture** — right-click any video → floating always-on-top mini player (Chromium-native), View-menu item PiPs the largest video / toggles it off. **Task Manager (Shift+Esc)** — `aether://taskmgr` live per-process CPU/memory table refreshed every 1.5s, tabs carry real titles + End buttons, interface/GPU/utility processes labeled |
| 👥 **Multi-profiles + ⌨️ omnibox autocomplete + 🖼️ tab previews (v2.4.0)** | **Multi-profiles** — Chrome-style separate identities: every profile gets its **own history, bookmarks, passwords, cookies, extensions, settings and cache** (its own userData dir, its own single-instance lock, so **two profiles can run side by side**). Switch from the toolbar avatar, the app-menu **Profiles** submenu, or Settings → Profiles; switching flushes the session with a clean-exit marker and **relaunches into the other profile** (`--aether-profile=<id>` is parsed *before* the single-instance lock). The default **“Personal”** profile keeps your existing data and can never be deleted. **Omnibox inline autocomplete** — Chrome-style ghost type-ahead: the top suggestion completes in dimmed text right in the address bar, **Tab accepts**. **Paste-and-go** — middle-click the address bar and a URL-ish clipboard navigates instantly (sanitized: only http(s) URLs and domain-like blobs). **Tab hover previews** — hover any background tab for 600ms for a live thumbnail card (capturePage, stale-guarded) |
| 🔐 **Password manager + 🚀 web apps + 🔎 tab search (v2.3.0)** | **Password manager** — Aether offers to save logins when you sign in (a save bar with an editable username), right-click any field to **Save login… / Fill saved password / Generate strong password**, and manage everything on `aether://passwords` (search, strength chips, copy-with-decrypt, manual add with a generator, "never save" blocklist). The vault encrypts every pair with the **OS keychain** (DPAPI / Keychain / libsecret) — no plaintext ever touches disk, and the one IPC channel a web page may call is write-only with the host derived from the sender's real URL. **Web apps (PWA)** — right-click → "Install … as app" installs any site as its own chromeless desktop window (webmanifest name/icons/start-url when present, title+favicon fallback), launches from the context menu, Settings card, **Windows jump list** and **macOS dock menu**. **Tab search (Ctrl+Shift+A)** — Chrome-parity fuzzy switcher over open tabs with per-row close; the AI sidebar moved to Ctrl+E |
| 📦 **Migration & daily-driver staples (v2.2.0)** | **One-click bookmark import** — Aether scans this machine for **Chrome / Edge / Brave / Chromium** profiles and lists them in Settings ("Chrome — Default · 42 bookmarks → Import"), plus **import from any browser's exported HTML file** and **Chrome-JSON**. **Export** writes the universal Netscape format every browser understands (folder groups preserved, round-trip tested). **Print… (Ctrl+P)** opens the native print dialog; **Save Page as PDF (Ctrl+S)** via a save dialog. **Spellcheck** (en-US) with right-click fixes + add-to-dictionary. **Download options** — "ask where to save each file" (native save dialog) and a custom default download folder |
| 🤖 **AI, everywhere it helps (v2.0.0)** | **TL;DR toasts** — list hosts in Settings (e.g. `en.wikipedia.org`) and pages from them get an automatic **3-bullet summary from your local model** in a dismissible toast while the tab loads (private windows excluded). **AI search depth modes** — Quick / **Deep** (synthesis across all 14 sources) / **Academic** (prefers .edu/.gov, structured review) / **Code** (docs & Stack Overflow) — each mode reshapes the prompt and the source budget. **Semantic history** — "Find that article…" on `aether://history` describes what you remember and Ollama embeddings (`nomic-embed-text`) rank your 300 most recent visits & bookmarks by meaning, vectors cached locally. **VRAM calculator** — the model manager honestly estimates weights + KV cache + overhead per quant before you pull, so "fits in 8 GB" claims don't embarrass the browser |
| 🪟 **Your default browser (v1.7.0)** | One click in Settings → Aether registers as a **default-browser candidate on Windows/macOS/Linux**, opens the OS chooser, and **URLs from other apps open as foreground tabs in the running window** (second-instance forwarding). `.htm/.html` file associations included — the flagship feature that makes Aether a *real* daily driver |
| 🖥️ **OS chrome (v1.7.0)** | **System tray icon** with quick actions, **Windows jump list + macOS dock menu** (new window / private window), **unread-badge** on taskbar/dock, native **notifications** for downloads, and **startup boost** (fast boot path) |
| 🗂️ **Vertical tabs + tab groups (v1.8.0)** | The tab strip can go **vertical** (sidebar rail with favicons + close buttons), tabs **group** by color with collapse — plus **hover previews** and drag-out-to-window still works |
| ⌨️ **Command palette (v1.8.0)** | **Ctrl+K** opens a fuzzy command bar: switch tabs, toggle every UI surface, run bangs, open settings sections, trigger agent macros — keyboard-first like the rest of Aether |
| 🔖 **Reading list + context menu v2 (v1.8.0)** | Save pages to a **reading list** (`aether://readinglist`), per-tab **sound control** (mute/unmute any tab), **force-dark v2** per site, a richer link/image context menu |
| 🛡️ **Privacy fortress (v1.9.0)** | **History scrubber** (auto-trim by age), **HTTPS-only mode** (with per-site exemptions), **DNS-over-HTTPS** (off/auto/your provider), **clear-browsing-data dialog** (history/cookies/cache per time range), **origin-only referrers** — and an `aether://privacy` page that states every data claim **in plain English, enforced in code** |
| 🧭 **The real-browser core (v1.5.0)** | **Bookmarks bar** (Ctrl+Shift+B — click to open, middle-click for a background tab, right-click menu, live everywhere), **session restore** ("continue where you left off" — every window/tab/pinned state survives restarts and crashes), **aether://downloads** (Ctrl+J — search, pause/resume, cancel, re-download, remove/clear, reveal file), **private windows** (Ctrl+Shift+N — in-memory session, zero history/site-data writes, shields still up, violet strip), **loading progress line** + tab spinner + **clickable site-info chip** (connection verdict, host, live shields counts) |
| 🌐 **Full browser** | **Multi-window** (Ctrl+N, move/drag tabs out into their own window), tabs (drag to reorder, **pin, mute, duplicate, discard, hibernate** + full tab context menu), omnibox with **live suggestions** (history, bookmarks, search), back/forward, **per-site zoom** with Chrome-style bubble, **download shelf** (progress / cancel / reveal), **find-in-page bar (Ctrl+F)** |
| 💬 **Chat with any page** | The sidebar reads the page via Readability, converts to clean Markdown, and answers grounded questions — streamed token-by-token |
| 🧠 **Page memory** | Sidebar conversations are remembered **per site** (locally), so follow-up visits start with prior context — toggleable, clearable |
| 🤖 **Web automation agent** | Give it a task; it navigates, clicks, types, screenshots, lists tabs and **asks you questions** when unsure — with a confirmation gate before every mutating action (configurable). v0.4 adds **stable element refs + DOM diffing** (less tokens, fewer mis-clicks) and **one-click retry** on model hiccups |
| ⏺ **Agent macros** | Tick "Record as macro" before a run, then replay the recorded actions **without the model** — elements are re-located by CSS path, confirm gate still applies. **Step editor**: rename, reorder, edit args, add/remove steps. **Import / export** macros as `.macro.json` files to share or back them up |
| 🧩 **Chrome extensions** | **One-click install of .crx / .zip packages** (file dialog, drag-and-drop onto Settings, or "Open with Aether" from your OS — .crx is a registered file type on Windows), plus **unpacked MV2/MV3 folders** (content scripts, background pages, popups, `chrome.contextMenus`) via `electron-chrome-extensions`; browser-action icons live in the toolbar, manage / disable / remove in Settings |
| 💤 **Tiered memory saver** | Idle background tabs first **hibernate** (muted + throttled to 1 fps — instant wake, no reload), then fully **discard** after 3× the delay (view unloaded, URL kept). Pinned and audio-playing tabs are exempt |
| 🔎 **Aether Search — our own engine, beast mode (v1.6.0)** | The omnibox opens `aether://search`: a real metasearch layer that runs **five sources in parallel** (DuckDuckGo, DDG Lite, Bing, **Wikipedia's structured API**, and **Mojeek** — an independent crawler with its own index), dedupes URLs (tracking params stripped), de-clumps same-domain results with a most-constrained-first **diversity pass**, and ranks with our own scorer — every result wears a source badge with per-source filter chips. **43 DuckDuckGo-style bangs** (`!yt lofi beats` opens YouTube's own search — zero network, typo-safe, chainable), **instant answers v2 all computed on-device** (safe calculator, unit conversion across 7 dimensions, percentages, a DST-correct world clock for 90+ cities) that preview live as you type, a **Wikipedia knowledge panel**, related-search chips, an arrow-key **suggestion dropdown**, letter-tile favicons, full **keyboard control** (↓/↑ navigate, Enter opens, 1-9 quick-open, `/` focuses), per-result copy-link, and a result-stats line. The page is fully useful with zero Ollama; if everything fails, one click re-runs on Google |
| ✍️ **Write helpers** | Select text on any page → right-click → Ask / Summarize / Rewrite / Translate into your sidebar |
| 🛡️ **Ad & tracker blocking** | EasyList + EasyPrivacy via `@cliqz/adblocker-electron`, filters cached on disk after first download, toggle in Settings |
| 🔐 **Site permissions** | Chrome-style prompts for camera / mic / location / notifications with **remember per site**; manage or forget every grant in Settings |
| ☁️ **Optional cloud fallback** | If Ollama is unreachable, chat & AI search can use **any OpenAI-compatible endpoint** (Groq / OpenRouter free tiers…). Opt-in, key stays on disk, agent stays local |
| 🧭 **Manager pages** | `aether://history` (search, delete, clear, **semantic find**), `aether://bookmarks`, `aether://settings` (model picker, search engine, **AI depth**, **TL;DR hosts**, **extensions manager**, **memory saver**, permissions manager, cloud fallback, privacy toggles), `aether://privacy` (the AI privacy pledge) |
| 📦 **Model Library** | Add **any Ollama model in-app** — no CLI needed: curated catalog (Qwen 9B/4B/1.7B, Llama, Gemma, Phi, Hermes, Mistral, DeepSeek-R1, coder, vision, tiny), or type **any tag** (`qwen3.5:4b`, `hf.co/…` GGUF) → live pull progress, cancel, delete, one-click "Use" |
| 🔒 **Private by design** | All AI runs on `localhost:11434` by default. Pages can't touch the browser UI (IPC is sender-guarded); renderers are sandboxed with context isolation. One click clears history / bookmarks / memory / permissions |
| 🏰 **Hardened by the Master Plan** | `npm audit` **0 vulnerabilities**; internal pages serve a **nonce-based CSP** (`unsafe-inline` is dead), a **will-navigate lock** keeps web pages out of privileged schemes, **Electron fuses** (RunAsNode off, cookie encryption, ASAR integrity) ship in every build, extensions extract through a **zip-hardening gate** (traversal/symlink/bomb-proof), an **XSS regression gate** runs in CI, and **Dependabot + an npm-audit CI gate** watch the supply chain — see [SECURITY.md](SECURITY.md) |
| 🎨 **Customization Studio** | **Make the browser yours**: dark / light / follow-system themes (a real light theme — every internal page + the chrome), **8 accent presets + any custom color** (live preview, derives button/focus/tint variants automatically), **UI size slider** (85–125%), **5 new-tab backgrounds** (Aurora glow, Midnight, Slate, Daylight, Plain), clock toggle, restore-defaults. Themes are a typed appearance engine with per-field validation — a corrupted settings file can never break boot. Open source, so you can fork the palette too |
| 🪪 **Chrome-like identity** | Optionally strips the `Electron/` UA token so Google and YouTube treat Aether like a regular Chrome browser |

## 📦 v2.8.0 — mouse gestures, speed dial, de-amping (build 22)

The Dolphin-style browsing-flow wave — drive the browser with the mouse, pin your favorite sites, and stop loading Google's AMP copies:

- **Mouse gestures** — press the **right button and draw**: ← back, → forward, ↑ new tab, ↓ close tab, ↓↑ reload, ↑↓ reopen closed tab. A sandbox-safe plain-JS preload (next to the farbling preload, injected on **every** session incl. containers + private) detects the stroke with a 30px dominant-axis threshold and a 3-segment scribble guard; a recognized shape **swallows the native context menu** (one-shot), a plain right-click passes through untouched. The sequence maps onto the sender's own TabManager, the toggle lives in Settings (live — no restart), and when the bridge is down gestures never hijack right-click.
- **Speed dial** — the New Tab page gets a **pinned-tiles grid** above Top Sites: add any http(s) page via the **“Add to speed dial” context-menu action** (right-click any page) or the inline add-form on the New Tab itself (URL + optional name), hover-× to remove, letter-avatar tiles, **dedupe by URL (first wins), capped at 16**, persisted in `dials.json` and served with the startup payload. All rendering is createElement/textContent-only (XSS-audit clean).
- **De-amping** — AMP-cache links now load the **publisher's page**: `cdn.ampproject.org/c/s/…`, Google's `/amp/s/…` wrapper, trailing `/amp` segments and `?amp=1` params are rewritten in one combined redirect with the tracking-param scrubber (idempotent — no loops, localhost never touched). Toggled in Settings → Privacy fortress.
- **Copy-link scrubbing** — the context menu gains the standard **“Copy link address”** item (Chromium parity), and copied addresses — links and images — **never carry tracking params** (the same utm/gclid/fbclid scrubber applies to the clipboard).
- **CI unblocked** — the macOS leg switches to `continue-on-error` (GitHub's macOS runners cancelled build 21's job with **zero executed steps four times in a row**); real failures still surface as annotated jobs, Windows + Ubuntu keep gating.
- **125 new assertions** (trail→sequence math + action map + hostile-payload sanitize, dial url/title cleaning + dedupe/cap/sanitize matrix, de-amp URL matrix incl. loop safety, a **functional test that executes gesture.js under node with stubbed DOM** — enabled detection, emitter wiring, one-shot menu suppression, the disabled gate — and the runAction dispatch) — **1,888+ across 35 suites**, Xvfb smoke green.

## 📦 v2.7.0 — container tabs, IP masquerade, fingerprint farbling (build 21)

The privacy & isolation wave — isolated profiles, the honest IP spoofer, and Brave's best anti-fingerprinting trick:

- **Aether Containers** — Firefox Multi-Account Containers, rebuilt for Aether: each container gets a **persistent `persist:cnt-<id>` session partition** (own cookie jar, storage, cache, service workers), hardened on first use with the full stack — **shields pipeline, privacy fortress (scrubber/HTTPS-only/referrer), farble preload, stripped UA and the effective proxy**. Five built-ins (Work/Banking/Shopping/Social/Anonymous), custom containers with a 9-color palette, **color chips on tabs** (dot for pinned), right-click **“Reopen in …”** moves a live tab between sessions, popups and duplicates inherit the container, **session restore keeps containers across restarts**, deleting one moves its tabs back to default and wipes its storage. Managed in Settings → Container tabs (per-container proxy + timezone editors, clear-data, delete).
- **IP masquerade** — no browser can rewrite its source IP; what real browsers do is **route** and **plug leaks**, so that's what shipped: strict proxy-URL validation (http/https/socks5, IPv6 literals, credentials stripped, fail-closed), Chromium `fixed_servers` proxying **globally or per container**, **one-click Tor preset**, and the **WebRTC leak shield** (`disable_non_proxied_udp` on every view, on by default even without a proxy). The **“Check my IP”** button fetches Cloudflare's `/cdn-cgi/trace` **through the exact session you pick** (default or any container) — full IP shown to you, masked (`1.2.x.x`) in every log.
- **Fingerprint farbling** — a sandbox-safe preload (plain JS, no imports, copied verbatim by the build) re-writes the APIs trackers abuse **before page scripts run**: canvas `getImageData`/`toDataURL`/`toBlob` get deterministic noise, WebGL reports a **believable GPU from a pool** (NVIDIA/Intel/AMD/Apple) and `readPixels` gets the same noise, `AudioBuffer` gets ±1e-7 once-per-buffer noise, `hardwareConcurrency`/`deviceMemory` round into pools. Seed = FNV-1a(host + per-boot salt) — **different sites read differently, the same site stays stable all session, next boot differs again**. Every patch is individually try/catch-wrapped; mode-off does literally nothing. Proxied containers can add a **timezone spoof** (Date + Intl) so the page's clock matches the proxy exit.
- **Cookie-banner blocker presets** — two new shields lists (uBlock **Annoyances**, **EasyList Cookie**) that remove consent popups and nag screens, on top of the built-in EasyList + EasyPrivacy engine.
- **185 new assertions** (container identity/partition/registry sanitizing, proxy validation matrix + Chromium rule forms + precedence, WebRTC policy decision, Cloudflare-trace parsing, log masking, seed math — plus a **functional test that executes farble.js under node with stubbed DOM globals** and verifies every patch lands deterministically, and that mode-off leaves the page untouched) — **1,763+ across 34 suites**, Xvfb smoke green.

## 📦 v2.6.0 — image-ask, full-page translate, topic tab groups (build 20)

The Tier-B AI differentiator batch — things Chrome can only do by shipping your data to a datacenter:

- **Ask AI about this image** — right-click any image → the picture is fetched by main (http/s only, content-type checked, **5 MB cap**), injected into the AI sidebar with a thumbnail, and the question auto-sends. `ai:chat` converts the data URL to Ollama base64 images and **silently swaps to a vision-capable model** for that turn: `/api/show` capability confirmation first (`capabilities: ["vision"]`), name-pattern fallback (llama3.2-vision → llava → qwen-vl → minicpm-v → moondream → gemma3 → pixtral → internvl); none installed? You get the exact `ollama pull` command to run. Page context is skipped on image turns; text-only turns keep using your normal chat model.
- **Full-page translate** — View → **Translate Page… (Alt+Shift+T)** / right-click → “Translate page…” / command palette. The readable text (same Readability path as reader view — boilerplate gone, **plain text only, zero injection surface**) is captured, the tab navigates to `aether://translate`, and your local model translates **6-line chunks with a numbered-line protocol** — a tolerant parser re-aligns every line and keeps the original on any miscount, so a flaky 3B model degrades gracefully instead of garbling the page. Bilingual blocks (dim original + translated), live progress bar, Stop button, “translation only” toggle, **30 languages** including Hindi + the 8th-schedule set, choice remembered per install. No cloud translation service ever sees the page.
- **Group tabs by topic** — View → **Group Tabs by Topic** / command palette. Ungrouped http(s) tabs are embedded with the same local embedding models the semantic history uses and clustered by greedy online-centroid cosine similarity; every cluster of ≥3 becomes a **real Chrome-style tab group** with an auto-generated label from the member titles (stopword-filtered, uniqueness-checked against existing groups, 8-color palette). Hard guards: 60 tabs max, 8 groups max, manual grouping is never overridden, fails soft with a human message when no embedding model is installed.
- **110 new assertions** (vision-model tiers, data-URL/base64 math, cluster geometry + label policy, chunking/prompt/tolerant-parser, translate model preference, wiring gates incl. IPC guards and the textContent-only translate page) — plus the smoke test now boots `aether://translate` too. **1,648 total across 32 suites**.

## 📦 v2.5.0 — reader view, screenshots, PiP, task manager (build 19)

The content & media power batch:

- **Reader view (F9)** — the same Readability engine the AI sidebar uses now powers a real reading mode: F9 / View menu / right-click captures the current DOM, parses the article, **sanitizes it to a strict whitelist** (tags: p/h1-h6/ul/ol/li/blockquote/pre/table/img/a/…, attributes: href/src/alt/title/datetime only, `javascript:` + `data:` URLs dropped, relative URLs resolved against the article origin, forms/media/frames removed with their subtrees), stores it keyed by webContents id and navigates that same tab to `aether://reader` — serif typography, **A−/A+ font sizing**, byline + word count + reading-time meta, links open through the bridge, CSP nonce as the second line of defense. The v1.7.0 XSS audit (test-v175) was taught about this one audited sink; 13 sanitizer assertions live in test-v250.
- **Screenshots (Ctrl+Shift+S)** — visible-area capture of the active tab, saved as `aether-YYYY-MM-DD-HHMMSS.png` under `userData/screenshots/` **and copied to the clipboard** via Electron 45's new W3C-style `clipboard.write([ClipboardItem])`, with an OS notification and an "Open Screenshots Folder" menu entry.
- **Picture-in-Picture** — right-click a video → "Picture-in-Picture" floats a Chromium-native always-on-top mini player (the video under the cursor via elementFromPoint); the View-menu entry targets the largest video and **toggles PiP off** when it's already on.
- **Task Manager (Shift+Esc)** — Chrome-parity `aether://taskmgr`: `app.getAppMetrics()` mapped to human rows, **tabs matched by renderer pid** (real titles + URLs + **End** buttons that close only verified managed tab ids), the interface/GPU/utility processes labeled, CPU% smoothed as the delta between polls, memory sorted desc with a live total — textContent-only rendering, no innerHTML sinks.
- **70 new assertions** (sanitizer whitelist, metrics mapping + CPU smoothing + dead-pid GC, filename/reading-time/bytes helpers, wiring gates incl. isInternal guards and the textContent-only task-manager page) — plus the smoke test now boots both new pages end-to-end. **1,538 total across 31 suites**.

## 📦 v2.4.0 — multi-profiles, inline autocomplete, tab previews (build 18)

The identity + address-bar power batch:

- **Multi-profiles** — Chrome-style separate identities built the honest Electron way: `--aether-profile=<id>` is parsed in **preboot before the single-instance lock**, so each profile boots its **own userData dir** (own cookies, cache, history, bookmarks, passwords vault, extensions, settings — every store isolates for free) and its **own single-instance lock**, which means **two profiles can run side by side** while double-launching the same profile still focuses the existing window. The registry lives at a fixed `profiles.json` in the original userData root, normalized on every read (bad shapes dropped, default always present, MRU ordering, 16-profile cap). Switching from the **toolbar avatar**, the **Profiles app-menu**, or **Settings → Profiles** flushes the current session with a clean-exit marker (`markQuitting` + `flushSessionNow`) and **relaunches** with the target profile — no crash warning on the next boot, session restore intact per profile. Deleting a profile wipes its whole data subtree (the default "Personal" profile is undeletable and keeps existing users exactly where they were). Non-default profiles show their name in the window/taskbar title.
- **Omnibox inline autocomplete** — Chrome-style ghost type-ahead: while you type, the top suggestion completes as dimmed text right in the address bar (the pure `inlineComplete()` policy: prefix match, case-insensitive, trailing space never completes, nothing to add → no ghost), and **Tab accepts** the completion. Ghost alignment is pixel-exact (hidden base span mirrors the typed text in the omnibox font).
- **Paste-and-go** — middle-click the address bar with a URL-ish clipboard and Aether navigates instantly, skipping the dropdown. The shared `pasteGoTarget()` sanitizer accepts only http(s) URLs and domain-like blobs — search phrases, `javascript:`, `data:` and `file://` fall back to normal behavior.
- **Tab hover previews** — hover any background tab for **600ms** and a live thumbnail card appears below the strip: `capturePage()` resized to 560px, title + URL caption, viewport-clamped, request-sequence stale-guarded, skipped for the active/unloaded/hibernated tabs.
- **98 new tests** (arg parsing incl. traversal/uppercase/duplicate handling, registry normalization + cap, delete policy, ghost rules, paste sanitizer, and static wiring gates for preboot-before-lock, flush-on-switch, XSS-safe profile rows, preview throttling) — **1,464 total across 30 suites**.

## 📦 v2.3.0 — passwords, web apps, tab search (build 17)

The "make it a real browser" power batch:

- **Password manager** — a save bar slides up when you sign in (username editable, "Never" blocklists the site), right-click any field for **Save login… / Fill saved password / Generate strong password** (20-char, unambiguous-charset, copied to clipboard), and `aether://passwords` manages the vault: search, strength chips, copy-with-decrypt, manual add + generator, and the "never save on these sites" blocklist. Every pair is encrypted with **safeStorage** — DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux; if no keychain exists the vault **refuses to store** with a clear explanation instead of falling back to plaintext. Hosts always come from the sender's real URL (a page cannot plant rows for another site), subdomains never autofill across registrable domains, private windows are excluded, and the whole flow is gated by a Settings toggle.
- **Web apps (PWA install-as-app)** — right-click → "Install example.com as app…". The installer reads the site's **webmanifest** (name, start_url, best non-maskable raster icon) and degrades to the tab's title + favicon. Apps open in a dedicated chromeless window **with no Aether bridge** (real apps never see `window.aether`), same-origin popups stay inside the window, other https links open as browser tabs. Launch from the context menu, Settings → Web apps, the **Windows jump list** and **macOS dock menu**; `--aether-app=<id>` cold-starts from the OS.
- **Tab search (Ctrl+Shift+A)** — Chrome parity at last: a fuzzy switcher over this window's tabs (title/URL/host ranked, host hits boosted, pinned & active tiebreaks) with Enter-to-switch and a per-row close button; also in the app menu (Edit → Search Tabs…) so it works from any page. The **AI sidebar moved to Ctrl+E** (menu, toolbar tooltip and the command palette all updated).
- **Manager pages & cards** — new `aether://passwords` page + Settings cards for Passwords and Web apps; command palette gained "Search tabs" and "Password manager".
- **119 new tests** (tab ranking, strength bins, generator determinism, field pickers, cross-domain autofill refusal, injection-safe fill/probe/generate scripts, manifest parsing, icon picking, app-id slugs, arg parsing) + 23 static wiring gates — **1,366 total across 29 suites**.

## 📦 v2.2.0 — real-browser staples (build 16)

The things people quietly expect from a browser they're switching to:

- **Bookmark import done properly** — Settings → Import & export lists every Chrome-family profile found on the machine (Chrome, Edge, Brave, Chromium — Default and Profile 1…N) with a live bookmark count and an Import button. File import accepts **any browser's exported HTML** and **Chrome/Edge/Brave JSON**; URLs are filtered to http(s), decoded safely, deduped against the library and the batch (trailing-slash aware), capped at 10k per import / 20k in the library. Import-by-id is validated against a fresh scan — no arbitrary paths cross IPC.
- **Universal export** — `aether-bookmarks-YYYY-MM-DD.html` in the Netscape format, folder groups preserved; the export is parsed back by the same test that parses Chrome's and Firefox's files (45-assertion codec suite, round-trip included).
- **Print & Save as PDF** — **Ctrl+P** opens the native print dialog for the active tab; **Ctrl+S** saves the page as a PDF through a save dialog (filename from the page title, NTFS-safe).
- **Spellcheck** — form fields get the en-US dictionary (was hard-disabled), with **right-click suggestions + Add to dictionary**, and a Settings toggle that flips the session spellchecker live.
- **Download location options** — "ask where to save each file" hands the choice to Chromium's native save dialog; otherwise files land in a **configurable download folder** (Change location… in Settings) with the same dedupe + progress machinery as before.

## ⌨️ v2.1.0 — omnibox suggestions v2 + window controls done right

Two field-reported fixes, one upgrade:

- **Search suggestions v2** — the address bar now queries **three engines in parallel** (DuckDuckGo, Google, Bing — all keyless), merged round-robin with case-insensitive dedupe, so one dead endpoint never starves the feed. Dropdown rows grew to Chrome-scale: **Go to \<url\>** for domain-like input → *Search for …* → up to 7 engine suggestions → 3 history hits → 2 bookmarks (12 rows max). Queries from **2 characters** (was 3), 1.2 s timeout per engine, and the row policy is a pure, unit-tested module (`src/shared/omnibox.ts`).
- **THE stale-suggestion bug is dead** — typing `youtu` then quickly `youtube` used to let the slow `youtu` response land last and clobber the dropdown with rows for a query you'd already left (the exact *"Search for 'youtu'" while the input read "youtube"* report). Every keystroke now owns a sequence number; stale responses are dropped.
- **— □ × window controls fixed properly** — the buttons are now Windows-native **46 px wide**, stretch the **full height** of whichever row they live in, and sit **flush against the window edge** in both tab modes. In vertical-tabs mode they no longer float as a detached little box near the top — they render inline at the toolbar's right edge with the same geometry, restore-down glyph included.

## 🤖 v2.0.0 — the AI milestone (build 14)

Aether's AI stops being "a sidebar you open" and starts meeting you where you already are:

- **TL;DR on load** — add hosts in Settings → "TL;DR on load for" (`en.wikipedia.org, docs.python.org`) and every page from them gets a **3-bullet summary from your local model** in a bottom-right toast, 20 s auto-dismiss, per-tab, private windows excluded. One summary per tab at a time, opt-in per site, off by default.
- **AI search depth modes** — Settings → "AI search depth": **Quick** (concise, cited, 6 sources), **Deep** (synthesizes across 14 sources, structured with counterpoints), **Academic** (10 sources, prefers `.edu`/`.gov`, review-style), **Code** (10 sources, docs & Stack Overflow first). Depth reshapes both the source budget and the answer prompt.
- **Semantic history — "find that article about…"** — a button on `aether://history` takes a *description* instead of keywords ("that Rust async tutorial with the green background") and ranks your recent history + bookmarks with **Ollama embeddings** (`nomic-embed-text` → `mxbai-embed-large` → `all-minilm` auto-picked). Pure cosine similarity, top-8, vectors cached in your profile per model.
- **VRAM calculator** — the model manager now estimates **weights + KV cache + runtime overhead** per quantization (4/5/8/16-bit) before you pull a model, deliberately conservative and calibrated against real models (an 8B q4 @ 8k ctx ≈ 6.9 GB — it honestly tells you a 70B won't fit in 8 GB).
- **The AI privacy pledge** — `aether://privacy` states exactly what happens to your data in seven plain-English claims (history never leaves the device, AI runs on your machine, embeddings stay local, cloud fallback is opt-in…) — every claim enforced in code you can audit.
- 54 new tests (depth policy, VRAM honesty, cosine math, TL;DR prompt shape, wiring gates); **1,119 total across 27 suites**.

## 🛡️ v1.9.0 — Privacy Fortress (Phase 3 of the Master Plan)

- **History scrubber** — auto-trim history older than your chosen window (forever / 90 / 30 / 7 days), enforced at boot and on write.
- **HTTPS-only mode** — upgrades every navigation to https:// and shows a block page instead of silently downgrading; per-site exemptions for the stragglers.
- **DNS-over-HTTPS** — off / automatic / custom provider (Cloudflare, Google, Quad9 or any DoH template), resolving the classic plaintext-DNS leak at the network layer.
- **Clear browsing data** — one dialog for history / cookies / cache / site data across any time range, with the count of what will go.
- **Origin-only referrers** — cross-origin requests send origin-only `Referer` by default (tightened from the leaky default).

## 🎨 v1.8.0 — the UI/UX wave (Phase 2 of the Master Plan)

Four builds of interface work: **vertical tabs** (the strip becomes a favicon rail) and **tab groups** (color-coded, collapsible), a **Ctrl+K command palette** (fuzzy: switch tabs, toggle surfaces, run bangs, open settings sections, fire macros), the **New Tab v3** (grouped quick links, smarter wallpaper engine) and **History v2** (day-grouped, per-entry delete, faster search), a **reading list** (`aether://readinglist`), **context menu v2** (richer link/image/selection actions), **per-tab sound control**, and **force-dark v2** with per-site overrides.

## 🪟 v1.7.0 — Security hardening + Your default browser (Phases 0–1 of the Master Plan)

The safety work came first, then the flagship feature:

- **CSP v2** — every internal page serves a **nonce-based CSP**; `unsafe-inline` is dead for scripts; `object-src`, `base-uri`, `form-action` all `none`; CSP also re-emitted as an HTTP header with `frame-ancestors 'none'`.
- **Navigation lock** — a `will-navigate` policy: internal pages talk only through their bridge, the chrome shell can't navigate at all, web pages browse freely **except** `file://` and privileged schemes (`devtools:`, `chrome:`, `chrome-extension:`, `view-source:`, `javascript:`) — unknown targets fail closed.
- **Electron fuses** — `RunAsNode`, `NODE_OPTIONS`, `--inspect`, file privileges off; **cookie encryption** and ASAR integrity on where the OS supports it.
- **XSS regression gate** — a CI test sweeps every `innerHTML` sink, bans `document.write`/`eval`/`javascript:` and proves hostile payloads render inert in JSDOM.
- **Supply chain** — `npm audit` went **14 → 0 vulnerabilities** (self-built `safe-zip` replaced the unpatched extract-zip), an **npm-audit CI gate** and **Dependabot** keep it there; extensions extract through a **zip-hardening gate** (path traversal, symlinks, device entries, zip bombs — fail closed). Full details in [SECURITY.md](SECURITY.md).
- **THE flagship: default browser** — one click registers Aether with the OS (Windows/macOS/Linux), opens the platform chooser, and **links from other apps open as foreground tabs in your running window**; `.htm`/`.html` file associations included.
- **OS chrome** — system tray quick actions, Windows jump list / macOS dock menu, taskbar unread badges, native download notifications, startup boost.

## 🔎 v1.6.0 — Beast Search (plus: the cross buttons got fixed)

**The fix you asked for first:** the — □ × window controls used to float ~120px away from
the window's right edge (the drag filler rendered *after* them). They now hug the edge like
every real browser, the tab × and control buttons carry explicit `no-drag` regions so drag
areas can never eat their clicks, and the tab-close hit target grew to 20px.

Then the search engine went beast mode — **five sources in parallel** (DDG, DDG Lite, Bing,
Wikipedia API, Mojeek), **43 bangs** (`!yt`, `!g`, `!w`, `!gh`, `!fk`…), **instant answers v2**
(calculator + units + percentages + world clock, all on-device, previewing live as you type),
**Wikipedia knowledge panels**, **related searches**, a live suggestion dropdown, per-source
filter chips, letter-tile favicons, full keyboard navigation, and a diversity ranking pass so
no two consecutive results ever share a domain when an alternative exists.

- Bangs ship in the binary — no fetching, no telemetry, unknown bangs fall through safely
- Unit answers handle `10 km to miles`, `72 f to c`, `500 ms to s` (ms = milliseconds, not m/s)
- `time in tokyo` / `what time is it in delhi` use the Intl timezone database — DST always right
- 62 new unit tests; 433 total across the chain

## 🧭 v1.5.0 — The Real-Browser Release

Five gaps closed in five audited builds (each with its own test suite, committed and CI-verified
one at a time):

1. **Session restore** — tabs/windows are snapshotted to `session.json` (sanitized: newtab/error/
   devtools pages dropped, 10-window/50-tab caps), rebuilt at boot; unclean shutdowns are detected
   and still restored. Toggle: Settings → "restore session".
2. **aether://downloads** — full download manager page with the persisted history
   (`downloads.json`), pause/resume via `DownloadItem`, one-click re-download.
3. **Bookmarks bar** — the chrome measures its own height (ResizeObserver → `ui:chromeHeight`),
   so the bar appears without breaking the web-view bounds — even per-window and with UI zoom.
4. **Loading progress + site info** — an indeterminate accent shimmer runs under the chrome while
   the active tab loads; the omnibox's scheme chip opens a site-info popover.
5. **Private windows** — the shields pipeline was refactored to install per-session so private
   windows get the **full adblock + cosmetic + CSP stack** on their in-memory partition.

## 🦁 v1.2.0 — Brave-style Shields (the adblocker grows up)

- **THE root cause of the YouTube blank (and the "adblocker all over the web" request):** the old
  integration injected **30 anti-adblock scriptlets** into youtube.com — they hijack the page's own
  JS plumbing (JSON-response rewriting, fetch/XHR wrapping) and on Electron timing they killed
  YouTube's bootstrap entirely: the document ended up as a single 257&nbsp;KB `<script>` node with no
  title, no body and zero console output. Diagnosed with a new site-probe tool (`AETHER_PROBE=<url>`
  dumps navigation events, responses, DOM snapshots and console) and a 4-way bisection
  (`AETHER_SHIELDS_NO_CSP / NO_COSMETICS / NO_RULES / NO_SCRIPTLETS`)
- **Brave's answer, adopted: two shield tiers.** **Standard (default)** = network blocking
  (EasyList + EasyPrivacy) + cosmetic CSS hiding (CSP-safe) — YouTube loads fully while 5+
  ad/tracker requests are neutralized on boot. **Aggressive (opt-in toggle)** = adds the scriptlet
  tier for anti-adblock walls, with a warning that heavy sites can break (and the per-site toggle
  as the recovery button)
- **Per-site Shields popup in the toolbar** (Brave parity): shield button with a live blocked-count
  badge, one-click **shields on/off per site** (persisted, page reloads on apply), per-site +
  total counters, top blocked hosts, and the Aggressive toggle
- **Custom filter lists:** curated uBlock presets (Ads / Privacy / Badware) plus any
  user-supplied `https://` filter-list URL in Settings → Shields — fetched fresh at boot, cached
  for offline, network AND cosmetic rules from custom lists apply (main + custom engines are
  matched together)
- **Full pipeline control:** the Ghostery engine is now driven directly instead of its
  all-or-nothing adapter — one `onBeforeRequest` pipeline (main frame never blocked → the v1.1.6
  error page stays truthful), per-site gating, per-site counters, `$csp=` directive merging, and
  the engine's own sandboxed cosmetic preload. The AI pipeline is immune (Node fetch never
  touches session webRequest)
- **Proven end-to-end:** 35 new shields-policy unit tests (236 total), the smoke suite now asserts
  the shields IPC state AND a deterministic engine-level block+counter, and a real
  YouTube probe verifies: full render + 5 blocked trackers in one boot

## 🧯 v1.1.7 — a locked profile cache used to kill the browser silently

- **THE root cause of `Unable to move the cache: Access is denied. (0x5)` + `Gpu Cache Creation failed: -2` +
  pages refusing to load:** something else held a file lock on the profile's cache directories — usually
  **an old Aether/electron.exe still running in the background** (in the reported incident the Vite dev
  server had even moved from port 5173 to 5174 because the previous session still occupied it), but also
  antivirus or OneDrive syncing `%APPDATA%`. Chromium couldn't build its cache and the network stack
  degraded, with **zero explanation on screen**
- **Fix 1 — a single-instance lock that actually locks:** the lock used to be enforced with `app.quit()`
  *before* the app was ready, which Electron can silently ignore — the losing instance kept booting onto
  the winner's locked profile. Now a second Aether **hard-exits** (`app.exit`) and the first window is
  focused instead
- **Fix 2 — cache-lock auto-recovery:** before anything touches the profile, Aether probes the cache
  directory for writability. Locked? The whole profile relocates to a deterministic sibling
  (`aether-browser-recovered`) so **the browser still works no matter who holds the lock** — and a console
  banner names the old profile (kept, never deleted), the new one, and the exact Windows steps to reclaim
  bookmarks/history once the locking process is closed
- **Proven end-to-end:** a new CI run **simulates the exact incident** (`AETHER_SIMULATE_CACHE_LOCK=1`):
  the app relocates, prints the reclaim banner, and the full smoke suite (bridge, Enter-to-navigate, error
  pages, multi-window) still passes on the recovered profile — plus 24 new recovery-policy unit tests
  (201 total) green
- Note: the harmless `session.getPreloads is deprecated` console line comes from the
  `electron-chrome-extensions` dependency — cosmetic noise, no action needed

## 🚨 v1.1.6 — pages that fail now TELL you why (no more infinite blank)

- **THE root cause of "the website can't load" with zero feedback:** a main-frame load failure (network
  down, DNS blocked, timeout, the ad blocker cancelling the document, page crash) only renamed the tab
  title and logged to the dev console — the view stayed **blank forever**. Now every failure navigates to
  a real **aether://error page** with the human-readable reason (20+ Electron error codes mapped), the
  exact address, and recovery buttons
- **Recovery built in:** **Try again** (retries the original URL), **Turn off ad blocker & retry** (appears
  when the blocker cancelled the request — ERR_BLOCKED_BY_CLIENT; persists the setting so the next boot
  agrees), **New tab**. Chrome-like: the omnibox keeps showing the site you wanted, failed loads never
  enter history, and Ctrl+R / the reload button retries the **original** address instead of the error page
- **Crash screen:** a gone renderer ("Tab crashed") gets the same treatment with its own explanation
- **Proven end-to-end:** the smoke suite now navigates to a guaranteed-dead address and asserts the error
  page renders (title + Retry button in the DOM) while the omnibox keeps the original URL — plus 28 new
  error-mapping unit tests (177 total) green

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
- [x] v1.1.6 — **visible error pages for every failed/crashed page load (reason + Try again + ad-blocker recovery), Chrome-like omnibox/history/reload behavior**
- [x] v1.1.7 — **single-instance lock that can't be ignored + cache-lock auto-recovery (profile relocates, exact reclaim steps printed), survives zombie electron.exe / AV / OneDrive locks**
- [x] v1.2.0 — **Brave-style Shields: two tiers (Standard default / Aggressive opt-in scriptlets), per-site toolbar popup with live counters, custom filter lists (uBlock presets + any URL), YouTube-blank root cause fixed**
- [x] v1.3–v1.6 — **resilient search → Beast Search: 5 parallel sources, 43 bangs, instant answers v2, Wikipedia knowledge panels, diversity ranking; error pages that tell the truth; profile-recovery; trust-hardened IPC**
- [x] v1.7.0 — **Phase 0 (CSP v2, navlock, fuses, safe-zip, XSS gate, audit gate, SECURITY.md) + Phase 1: DEFAULT BROWSER, OS chrome (tray/jump list/dock/badges)**
- [x] v1.8.0 — **Phase 2 UI/UX: vertical tabs, tab groups, command palette, New Tab v3, History v2, reading list, context menu v2, sound control, force-dark v2**
- [x] v1.9.0 — **Phase 3 privacy fortress: history scrubber, HTTPS-only, DoH, clear-data dialog, origin-only referrers**
- [x] v2.0.0 — **Phase 4 AI milestone: TL;DR toasts, search depth modes, semantic history (local embeddings), VRAM calculator, AI privacy pledge page**
- [x] v2.1.0 — **omnibox suggestions v2 (3-engine parallel feed, stale-guard) + window controls resized full-height flush in both tab modes**
- [x] v2.2.0 — **real-browser staples: one-click bookmark import (Chrome/Edge/Brave/Chromium) + universal HTML export, Print (Ctrl+P), Save Page as PDF (Ctrl+S), spellcheck with right-click fixes, download-location prompt + custom folder**
- [ ] Next — **the remaining Master Plan phases** (see [docs/ROADMAP.md](docs/ROADMAP.md)): AI agents + MCP, performance budgets, extension store polish, then **mobile (Android/iOS)**

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
- Model output is **never** rendered as HTML — all internal pages build DOM via `textContent` (enforced by a CI XSS gate that also bans `document.write`, `eval` and `javascript:` URLs, and renders hostile payloads in JSDOM to prove they're inert).
- The agent is hard-prompted to never enter passwords or payment details, and stops at captchas/login walls.
- **v1.7.0 hardening (Master Plan Phase 0):** internal pages serve a **nonce-based CSP** (no `unsafe-inline` scripts, `object-src`/`base-uri`/`form-action` all `none`, CSP re-emitted as an HTTP header with `frame-ancestors 'none'`); a **will-navigate lock** (see `src/main/navlock.ts`) keeps web pages out of `file://` and privileged schemes and fails closed on empty targets; **Electron fuses** disable `RunAsNode`/`NODE_OPTIONS`/`--inspect` and enable cookie encryption + ASAR integrity (where the OS supports it); extension archives extract through `src/main/safe-zip.ts` which rejects path traversal, symlinks, device entries, encrypted entries and zip bombs; `npm audit` is **clean (0 vulnerabilities)** and a CI gate + Dependabot keep it clean. See [SECURITY.md](SECURITY.md) for the disclosure policy.
- v2.0.0 is a stability + AI milestone, but independent security review is still welcome — file issues privately.

## 🧑‍💻 Contributing

PRs welcome! Good first issues: Master Plan Phase 5 (performance budgets: paint metrics,
startup profiling, memory ceilings), Phase 6 (auto-update signing, i18n), and helping test
default-browser flows across Linux distros.
Run `npm run typecheck` before committing. Unit tests: `npm test` — **29 suites, 1,366 tests**, every feature lands with its own suite.

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

**Roadmap:** the full plan lives in [docs/ROADMAP.md](docs/ROADMAP.md) — **"The Master Plan: 118 items to beat Brave"** across 9 phases. Shipped so far: Phase 0 security hardening, Phase 1 default-browser + OS integration, Phase 2 UI/UX, Phase 3 privacy fortress, and the Phase 4 AI milestone (v2.0.0). Next up: AI agents + MCP, performance budgets, then **mobile (Android/iOS)**. Every build ships as its own commit once CI is green on all three OSes.

## 👤 Contributors

Built and maintained by the project owner. Thanks to everyone who files issues, tests
Windows builds and suggests features — every bug report has shipped as a fix.

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
<!-- prettier-ignore-end -->

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/e2sy">
        <img src="https://avatars.githubusercontent.com/u/e2sy?v=4&s=100" width="100px;" alt=""/>
        <br /><sub><b>Mayank Bhaskar</b></sub>
      </a><br />
      <a href="#ideas-mayank" title="Ideas">🤔</a>
      <a href="#code-mayank" title="Code">💻</a>
      <a href="#doc-mayank" title="Documentation">📖</a>
      <a href="#maintenance-mayank" title="Maintenance">🚧</a>
      <a href="#test-mayank" title="Testing">⚠️</a>
    </td>
  </tr>
</table>

Mayank Bhaskar owns and drives this project — product direction, architecture, feature
specs, release engineering and testing. Commits are authored under
`e2sy@users.noreply.github.com` so GitHub's contributor graph credits the @e2sy account
for every change landed.

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
