import { app, Menu, MenuItemConstructorOptions, clipboard, shell } from 'electron'
import type { WebContents } from 'electron'
import type { TabManager } from './tabs'
import { contextMenuItems } from './extensions'

interface Deps {
  getTabs: () => TabManager | undefined
}

export function buildMenu(deps: Deps): Menu {
  const tabs = (): TabManager | undefined => deps.getTabs()
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
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => withActive((tm, id) => tm.close(id))
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
        { role: 'toggleDevTools' },
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
          label: 'Browse History',
          accelerator: 'CmdOrCtrl+H',
          click: (): void => openInternal('aether://history')
        },
        {
          label: 'Bookmarks',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: (): void => openInternal('aether://bookmarks')
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
              applicationVersion: '1.0.0',
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
