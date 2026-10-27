import { app, Menu, MenuItemConstructorOptions, clipboard, shell } from 'electron'
import type { WebContents } from 'electron'
import fs from 'node:fs'
import type { TabManager } from './tabs'
import { focusedEntry, createBrowserWindow, popoutTab, allEntries } from './windows'
import { toggleLastPanel } from './panelhost'
import { contextMenuItems } from './extensions'
import { mergedSettings, settings } from './store'
import { addReading } from './readinglist'
import { notify } from './osshell'
import { printActive, savePageAsPdf } from './printpdf'
import { importFromFileFlow, exportBookmarksFlow } from './bkmimport'
import { saveLoginFromContext, fillLoginFor, generateAndFill } from './passwords'
import { appForHost, launchApp, installFromTab } from './apps'
import { listProfiles, activeProfileId } from './profiles'
import { switchToProfile } from './windows'
import { captureReaderArticle } from './reader'
import { captureScreenshot, screenshotsDir } from './shot'
import { fetchImageDataUrl } from './imgask'
import { captureTranslatePage } from './translate'
import { clusterTabsByTopic } from './tabcluster'
import { stripTrackingParams } from './privacy'
import { addDial } from './dials'

/** v2.5.0 — capture the active tab's article, then move that tab to the reader. */
function openReaderView(): void {
  const entry = focusedEntry()
  const id = entry?.tabs.activeId
  const wc = entry?.tabs.activeView()?.webContents
  if (!entry || typeof id !== 'number' || !wc) return
  captureReaderArticle(wc)
    .then(() => entry.tabs.navigate(id, 'aether://reader'))
    .catch((err) => notify('Reader view unavailable', err instanceof Error ? err.message : String(err)))
}

/** v2.6.0 — capture the active tab's text, then move that tab to the translator. */
export function translateActiveTab(): void {
  const entry = focusedEntry()
  const id = entry?.tabs.activeId
  const wc = entry?.tabs.activeView()?.webContents
  if (!entry || typeof id !== 'number' || !wc) return
  notify('Translating page…', 'Capturing the readable text — pick a language on the next screen.')
  captureTranslatePage(wc)
    .then(() => entry.tabs.navigate(id, 'aether://translate'))
    .catch((err) => notify('Translate unavailable', err instanceof Error ? err.message : String(err)))
}

/** v2.6.0 — cluster the focused window's ungrouped tabs into topic groups. */
function groupTabsByTopic(): void {
  const tm = focusedEntry()?.tabs
  if (!tm) return
  notify('Grouping tabs…', 'Embedding open tabs with your local model.')
  clusterTabsByTopic(tm)
    .then((res) => {
      if (res.ok) {
        notify('Tabs grouped', `${res.groups} topic group${res.groups === 1 ? '' : 's'} · ${res.tabs} tab${res.tabs === 1 ? '' : 's'}: ${res.labels?.join(', ')}`)
      } else {
        notify('Could not group tabs', res.error || 'unknown error')
      }
    })
    .catch((err) => notify('Could not group tabs', err instanceof Error ? err.message : String(err)))
}

/** v2.5.0 — PiP the video under the cursor (context menu) or the largest one. */
function pipVideo(wc: WebContents, x?: number, y?: number): void {
  const findVideo =
    typeof x === 'number' && typeof y === 'number'
      ? // video under the cursor (context-menu path — walk up from the point)
        `var v=document.elementFromPoint(${x | 0},${y | 0});` +
        `while(v&&v.tagName!=='VIDEO')v=v.parentElement;`
      : // largest video on the page (menu path); toggles PiP off if already on
        `var vs=[].slice.call(document.querySelectorAll('video'));` +
        `var v=vs.sort(function(a,b){return b.videoWidth*b.videoHeight-a.videoWidth*a.videoHeight})[0];`
  const js =
    `(function(){` +
    findVideo +
    `if(!v){return 'no-video'}` +
    `if(!document.pictureInPictureEnabled){return 'pip-disabled'}` +
    `if(document.pictureInPictureElement){` +
    `return document.exitPictureInPicture().then(function(){return 'exited'}).catch(function(e){return String(e&&e.message||e)})}` +
    `return v.requestPictureInPicture().then(function(){return 'ok'}).catch(function(e){return String(e&&e.message||e)})})()`
  void wc
    .executeJavaScript(js, true)
    .then((res: unknown) => {
      const r = String(res)
      if (r === 'no-video') notify('Picture-in-Picture', 'No video found on this page')
      else if (r === 'pip-disabled') notify('Picture-in-Picture', 'This page does not allow picture-in-picture')
    })
    .catch(() => undefined)
}

/** v1.5.0 — toggle the bookmarks bar globally: persist, inform every window,
 *  rebuild the menu so the checkbox stays truthful. */
export function setShowBookmarksBar(show: boolean): void {
  const next = Boolean(show)
  if (mergedSettings().showBookmarksBar === next) return
  settings.data = { ...settings.data, showBookmarksBar: next }
  settings.save()
  for (const entry of allEntries()) {
    if (!entry.win.isDestroyed()) entry.win.webContents.send('chrome:bookmarksBar', next)
  }
  Menu.setApplicationMenu(buildMenu())
}

export function buildMenu(): Menu {
  const tabs = (): TabManager | undefined => focusedEntry()?.tabs
  const activeId = (): number | null => tabs()?.activeId ?? null
  const withActive = (fn: (tm: TabManager, id: number) => void): void => {
    const tm = tabs()
    const id = activeId()
    if (tm && id !== null) fn(tm, id)
  }
  const openInternal = (url: string): void => {
    const tm = tabs()
    const id = activeId()
    if (tm && id !== null) tm.navigate(id, url)
    else tm?.create(url)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => tabs()?.create() },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: (): void => {
            createBrowserWindow()
          }
        },
        {
          label: 'New Private Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: (): void => {
            createBrowserWindow(undefined, { private: true })
          }
        },
        {
          label: 'Move Tab to New Window',
          click: (): void => {
            const entry = focusedEntry()
            const id = entry?.tabs.activeId
            if (entry && typeof id === 'number') popoutTab(entry.win.id, id)
          }
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => withActive((tm, id) => tm.close(id))
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (): void => {
            tabs()?.reopenClosedTab()
          }
        },
        { type: 'separator' },
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: (): void => printActive()
        },
        {
          label: 'Save Page as PDF',
          accelerator: 'CmdOrCtrl+S',
          click: (): void => {
            void savePageAsPdf()
          }
        },
        { type: 'separator' },
        {
          label: 'Import Bookmarks…',
          click: (): void => {
            void importFromFileFlow()
          }
        },
        {
          label: 'Export Bookmarks…',
          click: (): void => {
            void exportBookmarksFlow()
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: (): void => openInternal('aether://settings')
        },
        {
          label: 'Model Library',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: (): void => tabs()?.sendToChrome('sidebar:show', { mode: 'models' })
        },
        { type: 'separator' },
        {
          label: 'Duplicate Tab',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => withActive((tm, id) => tm.duplicate(id))
        },
        {
          label: 'Pin Tab',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => withActive((tm, id) => tm.togglePinned(id))
        },
        {
          label: 'Mute Tab',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => withActive((tm, id) => tm.toggleMuted(id))
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in Page',
          accelerator: 'CmdOrCtrl+F',
          click: (): void => tabs()?.sendToChrome('find:show', {})
        },
        { type: 'separator' },
        {
          label: 'Focus Address Bar',
          accelerator: 'CmdOrCtrl+L',
          click: (): void => tabs()?.sendToChrome('omnibox:focus', {})
        },
        {
          label: 'Search Tabs…',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: (): void => tabs()?.sendToChrome('tabsearch:show', {})
        },
        {
          label: 'Toggle AI Sidebar',
          accelerator: 'CmdOrCtrl+E',
          click: (): void => tabs()?.sendToChrome('sidebar:toggle', {})
        },
        { type: 'separator' },
        {
          label: 'Password Manager',
          accelerator: 'CmdOrCtrl+Shift+Y',
          click: (): void => openInternal('aether://passwords')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Page',
          accelerator: 'CmdOrCtrl+R',
          click: () => withActive((tm, id) => tm.reload(id))
        },
        {
          label: 'Reload Page (F5)',
          accelerator: 'F5',
          click: () => withActive((tm, id) => tm.reload(id))
        },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Show Next Tab',
          accelerator: 'CmdOrCtrl+Tab',
          click: (): void => tabs()?.cycleTab(1)
        },
        {
          label: 'Show Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: (): void => tabs()?.cycleTab(-1)
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => withActive((tm, id) => tm.zoom(id, 'in'))
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => withActive((tm, id) => tm.zoom(id, 'out'))
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => withActive((tm, id) => tm.zoom(id, 'reset'))
        },
        { type: 'separator' },
        {
          label: 'Show Bookmarks Bar',
          type: 'checkbox',
          checked: mergedSettings().showBookmarksBar !== false,
          accelerator: 'CmdOrCtrl+Shift+B',
          click: (item): void => setShowBookmarksBar(item.checked)
        },
        { type: 'separator' },
        {
          label: 'Toggle Side Panel',
          accelerator: 'CmdOrCtrl+Alt+P',
          click: (): void => {
            const entry = focusedEntry()
            if (entry) toggleLastPanel(entry)
          }
        },
        { type: 'separator' },
        {
          label: 'Reader View',
          accelerator: 'F9',
          click: (): void => openReaderView()
        },
        {
          label: 'Translate Page…',
          accelerator: 'Alt+Shift+T',
          click: (): void => translateActiveTab()
        },
        {
          label: 'Group Tabs by Topic',
          click: (): void => groupTabsByTopic()
        },
        {
          label: 'Take Screenshot',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (): void => {
            void captureScreenshot()
          }
        },
        {
          label: 'Picture-in-Picture',
          accelerator: 'Alt+P',
          click: (): void => {
            const wc = focusedEntry()?.tabs.activeView()?.webContents
            if (wc) pipVideo(wc)
          }
        },
        {
          label: 'Open Screenshots Folder',
          click: (): void => {
            try {
              fs.mkdirSync(screenshotsDir(), { recursive: true })
            } catch {
              /* open anyway */
            }
            void shell.openPath(screenshotsDir())
          }
        },
        {
          label: 'Task Manager',
          accelerator: 'Shift+Escape',
          click: (): void => openInternal('aether://taskmgr')
        },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => withActive((tm, id) => tm.back(id))
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => withActive((tm, id) => tm.forward(id))
        },
        { type: 'separator' },
        {
          label: 'Go to Tab',
          submenu: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
            label: n === 9 ? 'Last Tab' : `Tab ${n}`,
            accelerator: `CmdOrCtrl+${n}`,
            click: (): void => tabs()?.activateIndex(n)
          }))
        },
        {
          label: 'Downloads',
          accelerator: 'CmdOrCtrl+J',
          click: (): void => openInternal('aether://downloads')
        },
        {
          label: 'Browse History',
          accelerator: 'CmdOrCtrl+H',
          click: (): void => openInternal('aether://history')
        },
        {
          label: 'Bookmarks',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: (): void => openInternal('aether://bookmarks')
        },
        {
          label: 'Reading list',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: (): void => openInternal('aether://readinglist')
        },
        {
          label: 'Mute all tabs',
          accelerator: 'CmdOrCtrl+Alt+M',
          click: (): void => {
            const e = focusedEntry()
            if (e) e.tabs.muteAll(true)
          }
        },
        {
          label: 'Unmute all tabs',
          click: (): void => {
            const e = focusedEntry()
            if (e) e.tabs.muteAll(false)
          }
        }
      ]
    },
    {
      // v2.4.0 build 18 — Chrome-style profile switcher. Rebuilt by every
      // buildMenu() call, so registry changes show up the next time any
      // menu opens. Switching flushes + relaunches (windows.switchToProfile).
      label: 'Profiles',
      submenu: [
        ...listProfiles().map((p) => ({
          label: `${p.id === activeProfileId() ? '● ' : ''}${p.name}`,
          enabled: p.id !== activeProfileId(),
          click: (): void => {
            switchToProfile(p.id)
          }
        })),
        { type: 'separator' as const },
        {
          label: 'Open profile manager',
          click: (): void => openInternal('aether://settings')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Aether on GitHub',
          click: (): void => {
            void shell.openExternal('https://github.com/')
          }
        },
        {
          label: 'About Aether',
          click: (): void => {
            app.setAboutPanelOptions({
              applicationName: 'Aether Browser',
              applicationVersion: app.getVersion(),
              credits: 'Open-source AI browser powered by your local model.'
            })
            app.showAboutPanel()
          }
        }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

/** Right-click menu inside web pages: edit roles + AI write helpers. */
export function onContextMenu(wc: WebContents, params: Electron.ContextMenuParams, tm: TabManager): void {
  const items: MenuItemConstructorOptions[] = []

  // extension-provided context menu items (chrome.contextMenus) come first
  const extItems = contextMenuItems(wc, params)
  if (extItems.length) {
    items.push(...(extItems as unknown as MenuItemConstructorOptions[]), { type: 'separator' })
  }

  // spellcheck fixes (v2.2.0) — dictionary suggestions + add-to-dictionary
  if (params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions || []).slice(0, 5)
    if (suggestions.length) {
      for (const sug of suggestions) {
        items.push({ label: sug, click: (): void => wc.replaceMisspelling(sug) })
      }
    } else {
      items.push({ label: 'No spelling suggestions', enabled: false })
    }
    items.push(
      {
        label: `Add “${params.misspelledWord.slice(0, 28)}” to dictionary`,
        click: (): void => {
          try {
            wc.session.addWordToSpellCheckerDictionary(params.misspelledWord)
          } catch {
            /* cosmetic */
          }
        }
      },
      { type: 'separator' }
    )
  }

  if (params.selectionText?.trim()) {
    const selection = params.selectionText.trim()
    const send = (prompt: string): void => tm.sendToChrome('sidebar:inject', { text: prompt, focus: true })
    const quoted = selection.length > 600 ? selection.slice(0, 600) + '…' : selection

    items.push(
      {
        label: 'Ask AI about selection',
        click: (): void => send(quoted + '\n\n—\nExplain this: ')
      },
      {
        label: 'Summarize selection',
        click: (): void => send('Summarize this in 3 bullet points:\n\n' + quoted)
      },
      {
        label: 'Rewrite selection',
        click: (): void => send('Rewrite this more clearly, keeping the meaning:\n\n' + quoted)
      },
      {
        label: 'Translate selection',
        click: (): void => send('Translate this to English (or to Hindi if it is already English):\n\n' + quoted)
      },
      { type: 'separator' },
      {
        label: 'Copy',
        enabled: params.editFlags.canCopy,
        click: (): void => {
          void clipboard.writeText(selection)
        }
      },
      { type: 'separator' }
    )
  }

  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      {
        label: 'Ask AI about this image',
        click: (): void => {
          // fetch → data URL → sidebar auto-asks with the image attached
          fetchImageDataUrl(params.srcURL, wc.getURL())
            .then((dataUrl) =>
              tm.sendToChrome('sidebar:inject', {
                text: 'What is in this image? Describe it, then note anything unusual.',
                image: dataUrl,
                focus: true
              })
            )
            .catch((err) =>
              notify('Image unavailable', err instanceof Error ? err.message : String(err))
            )
        }
      },
      {
        label: 'Copy image address',
        click: (): void => {
          // v2.8.0 — the copied address never carries tracking params
          void clipboard.writeText(stripTrackingParams(params.srcURL) || params.srcURL)
        }
      }
    )
  }

  // v2.8.0 — standard "Copy link address" (Chromium parity) with the same
  // tracking-param scrub the navigation scrubber applies
  if (params.linkURL?.trim()) {
    items.push({
      label: 'Copy link address',
      click: (): void => {
        const raw = params.linkURL.trim()
        void clipboard.writeText(stripTrackingParams(raw) || raw)
      }
    })
  }

  // v2.5.0 — floating mini-player for videos (Chromium-native PiP window)
  if (params.mediaType === 'video') {
    items.push({
      label: 'Picture-in-Picture',
      click: (): void => pipVideo(wc, params.x, params.y)
    })
  }

  // v2.3.0 password manager — right-click inside an editable field (or any
  // page when the vault has a login for this site) to save / fill / generate.
  // (Electron 45 dropped inputFieldType from the typings; the Save probe
  // self-explains via a notification when the page has no login form.)
  const pageUrlCred = wc.getURL()
  if (/^https?:/i.test(pageUrlCred) && mergedSettings().passwordManager !== false) {
    if (params.isEditable) {
      items.push(
        {
          label: 'Save login…',
          click: (): void => saveLoginFromContext(wc)
        },
        {
          label: 'Fill saved password',
          click: (): void => fillLoginFor(wc)
        },
        {
          label: 'Generate strong password',
          click: (): void => generateAndFill(wc)
        },
        { type: 'separator' }
      )
    }
  }

  // v2.3.0 web apps — install the site as its own window (or relaunch it)
  const pageUrlApp = wc.getURL()
  if (/^https?:/i.test(pageUrlApp)) {
    const installed = appForHost(pageUrlApp)
    if (installed) {
      items.push({
        label: `Open “${installed.name}” in its window`,
        click: (): void => {
          launchApp(installed.id)
        }
      })
    } else {
      items.push({
        label: `Install ${hostLabel(pageUrlApp)} as app…`,
        click: (): void => {
          const tabId = findTabIdByWc(wc, tm)
          if (tabId === null) {
            notify('Install failed', 'This tab is no longer available')
            return
          }
          void installFromTab(tm, tabId).then((res) => {
            if (res.ok) notify('App installed', `${res.name} — find it in Settings → Web apps`)
            else notify('Install failed', res.error || 'unknown error')
          })
        }
      })
    }
  }

  // Aether actions group (#45) — reading list + reader view + screenshot
  const pageUrl = wc.getURL()
  if (/^https?:/i.test(pageUrl)) {
    items.push({
      label: 'Add to reading list',
      click: (): void => {
        // grab a word count while the page is open — drives the time estimate
        void wc
          .executeJavaScript('document.body ? String(document.body.innerText || "").split(/\\s+/).length : 0', true)
          .then((words: number) => addReading({ url: pageUrl, title: wc.getTitle(), words: Number(words) || 0 }))
          .catch(() => addReading({ url: pageUrl, title: wc.getTitle() }))
      }
    })
    items.push({
      label: 'Open in reader view',
      click: (): void => {
        const tabId = findTabIdByWc(wc, tm)
        if (tabId === null) return
        captureReaderArticle(wc)
          .then(() => tm.navigate(tabId, 'aether://reader'))
          .catch((err) => notify('Reader view unavailable', err instanceof Error ? err.message : String(err)))
      }
    })
    items.push({
      label: 'Translate page…',
      click: (): void => {
        const tabId = findTabIdByWc(wc, tm)
        if (tabId === null) return
        captureTranslatePage(wc)
          .then(() => tm.navigate(tabId, 'aether://translate'))
          .catch((err) => notify('Translate unavailable', err instanceof Error ? err.message : String(err)))
      }
    })
    items.push({
      label: 'Screenshot — save & copy',
      click: (): void => {
        void captureScreenshot(wc)
      }
    })
    items.push({
      label: 'Add to speed dial',
      click: (): void => {
        const dial = addDial(pageUrl, wc.getTitle())
        if (dial) notify('Added to speed dial', dial.title || hostLabel(pageUrl))
        else notify('Could not add', 'Only http(s) pages can be pinned')
      }
    })
    items.push({ type: 'separator' })
  }

  items.push(
    {
      label: 'Back',
      enabled: wc.navigationHistory.canGoBack(),
      click: (): void => {
        void wc.navigationHistory.goBack()
      }
    },
    {
      label: 'Reload',
      click: (): void => {
        wc.reload()
      }
    },
    { type: 'separator' },
    { label: 'Inspect', click: (): void => wc.openDevTools({ mode: 'detach' }) }
  )

  Menu.buildFromTemplate(items).popup()
}

/** "example.com" from a URL for context-menu labels; '' when unparseable. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'this site'
  }
}

/** Which tab of this manager owns the given webContents? */
function findTabIdByWc(wc: WebContents, tm: TabManager): number | null {
  try {
    for (const id of tm.listIds()) {
      const t = tm.get(id)
      if (t && t.view && t.view.webContents === wc) return id
    }
  } catch {
    /* destroyed */
  }
  return null
}
