import { app, Menu, MenuItemConstructorOptions, clipboard, shell } from 'electron'
import type { WebContents } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { TabManager } from './tabs'
import { focusedEntry, createBrowserWindow, popoutTab, allEntries } from './windows'
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
    items.push({
      label: 'Copy image address',
      click: (): void => {
        void clipboard.writeText(params.srcURL)
      }
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

  // Aether actions group (#45) — reading list + screenshot on any page
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
      label: 'Save screenshot',
      click: (): void => {
        void wc
          .capturePage()
          .then((img) => {
            const dir = path.join(app.getPath('userData'), 'screenshots')
            fs.mkdirSync(dir, { recursive: true })
            const file = path.join(dir, `aether-${Date.now()}.png`)
            fs.writeFileSync(file, img.toPNG())
            notify('Screenshot saved', file)
          })
          .catch(() => undefined)
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
