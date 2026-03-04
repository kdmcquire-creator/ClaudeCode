// electron/services/plaid-link.service.ts
//
// Opens a child BrowserWindow that loads the local Plaid Link HTML page,
// waits for the user to complete (or close) the flow, then resolves/rejects.
//
// The window uses a dedicated preload (plaid-link-preload.ts) to expose a
// minimal contextBridge so the HTML page can send IPC messages to main.
//
// DEPLOY:
//   1. Copy this file → electron/services/plaid-link.service.ts
//   2. Copy plaid-link-preload.ts → electron/preload/plaid-link-preload.ts
//   3. Copy plaid-link.html → resources/plaid-link.html
//   4. In electron-vite / electron-builder config, ensure resources/** is packed.
//      The package.json already has "files": ["dist-electron/**/*", "dist/**/*", "resources/**/*"]
//      so this is already covered.

import { BrowserWindow, ipcMain, app } from 'electron'
import path from 'path'
import type { PlaidLinkResult } from '../../src/shared/plaid.types'

// Resolved path to the preload script.
// In dev: src is compiled by electron-vite into dist-electron/preload/
// In prod: same location inside the asar
function getPreloadPath(): string {
  // electron-vite outputs preload files here:
  return path.join(app.getAppPath(), 'dist-electron', 'preload', 'plaid-link-preload.js')
}

// Path to the static HTML page in resources/
function getHtmlPath(): string {
  return path.join(app.getAppPath(), 'resources', 'plaid-link.html')
}

export async function openPlaidLink(
  linkToken: string,
  institutionNameHint?: string
): Promise<PlaidLinkResult> {
  return new Promise<PlaidLinkResult>((resolve, reject) => {
    // ── Create the Plaid Link window ──────────────────────────────────────────
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      resizable: false,
      center: true,
      title: institutionNameHint ? `Connect ${institutionNameHint}` : 'Connect Bank Account',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // required so the preload can use ipcRenderer
        preload: getPreloadPath(),
      },
    })

    let settled = false

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    function cleanup() {
      // Remove our IPC listeners — always use the channel+listener form so we
      // don't remove other handlers that use the same channel name elsewhere.
      ipcMain.removeListener('plaid-link:success', onSuccess)
      ipcMain.removeListener('plaid-link:exit', onExit)
      ipcMain.removeListener('plaid-link:error', onError)
      if (!win.isDestroyed()) win.close()
    }

    // ── IPC handlers for this window session ──────────────────────────────────

    const onSuccess = (_event: Electron.IpcMainEvent, result: PlaidLinkResult) => {
      settle(() => resolve(result))
    }

    const onExit = () => {
      settle(() => reject(new Error('Plaid Link window was closed without completing')))
    }

    const onError = (_event: Electron.IpcMainEvent, message: string) => {
      settle(() => reject(new Error(message)))
    }

    ipcMain.on('plaid-link:success', onSuccess)
    ipcMain.on('plaid-link:exit', onExit)
    ipcMain.on('plaid-link:error', onError)

    // ── Handle window closed by user (X button) ───────────────────────────────
    win.on('closed', () => {
      settle(() => reject(new Error('Plaid Link window was closed without completing')))
    })

    // ── Load the HTML page with link token in query string ────────────────────
    // Strip "Electron/x.x.x" from the user agent — Plaid's browser detection
    // rejects Electron and shows a "download Chrome/Safari/Firefox" page.
    const stripElectron = (ua: string) => ua.replace(/\s*Electron\/[\d.]+/, '')
    win.webContents.setUserAgent(stripElectron(win.webContents.getUserAgent()))

    // Chase OAuth opens in a child popup window — strip Electron from those too.
    win.webContents.on('did-create-window', (childWin) => {
      childWin.webContents.setUserAgent(stripElectron(childWin.webContents.getUserAgent()))
    })

    const htmlPath = getHtmlPath()
    const pageUrl = `file://${htmlPath}?token=${encodeURIComponent(linkToken)}`
    win.loadURL(pageUrl)

    // Open DevTools in dev for debugging — comment out for production
    // if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' })
  })
}
