// electron/services/plaid-link.service.ts
//
// Opens a child BrowserWindow that loads the local Plaid Link HTML page,
// waits for the user to complete (or close) the flow, then resolves/rejects.
//
// OAUTH FLOW (Chase and other OAuth institutions):
//   With the UA spoofed to Chrome 132, Plaid's SDK believes it's in a real
//   browser and uses popup mode — window.open() for the bank's OAuth page.
//   Our setWindowOpenHandler creates a BrowserWindow for the popup, which
//   inherits the same session (Chrome 132 UA + fixed Client Hints), so Chase
//   accepts it. After the user authenticates, Chase → Plaid's CDN callback
//   page → postMessage back to the Plaid Link parent window → onSuccess.
//   No redirect_uri needed.
//
// DEPLOY:
//   1. Copy this file → electron/services/plaid-link.service.ts
//   2. Copy plaid-link-preload.ts → electron/preload/plaid-link-preload.ts
//   3. Copy plaid-link.html → resources/plaid-link.html
//   4. Ensure resources/** is packed (already covered by package.json "files").

import { BrowserWindow, ipcMain, app, session } from 'electron'
import path from 'path'
import type { PlaidLinkResult } from '../../src/shared/plaid.types'

function getPreloadPath(): string {
  return path.join(app.getAppPath(), 'dist-electron', 'preload', 'plaid-link-preload.js')
}

function getHtmlPath(): string {
  return path.join(app.getAppPath(), 'resources', 'plaid-link.html')
}

export async function openPlaidLink(
  linkToken: string,
  institutionNameHint?: string
): Promise<PlaidLinkResult> {
  return new Promise<PlaidLinkResult>((resolve, reject) => {
    // ── Dedicated session — clean user agent + fixed Client Hints ─────────────
    // Each call gets a fresh in-memory session (no stale OAuth state from a
    // previous failed attempt).
    //
    // Chase requires Chrome 130+. Electron 28 ships with Chromium 120.
    // We bump the version to 132 and present as a standard Chrome release.
    // This affects:
    //   • User-Agent HTTP header           (session.setUserAgent)
    //   • navigator.userAgent in JS        (session.setUserAgent)
    //   • Sec-CH-UA / Sec-CH-UA-Full-Version-List (webRequest hook below)
    //
    // Setting everything on the SESSION means it applies before any navigation
    // starts — covering both this window and any OAuth popup windows that share
    // the session (via setWindowOpenHandler below).
    const partitionKey = `plaid-link-${Date.now()}`
    const plaidSession = session.fromPartition(partitionKey, { cache: false })

    const CHROME_VER = '132'
    const CHROME_FULL = '132.0.6834.83'
    const cleanUA = plaidSession
      .getUserAgent()
      .replace(/\s*Electron\/[\d.]+/, '')
      .replace(/Chrome\/[\d.]+/, `Chrome/${CHROME_FULL}`)
    plaidSession.setUserAgent(cleanUA)

    // Sec-CH-UA Client Hints: Electron omits "Google Chrome" from the brand
    // list. Patch all relevant headers for every request in this session.
    plaidSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase()
        if (lk === 'sec-ch-ua') {
          headers[key] = `"Not A Brand";v="8", "Chromium";v="${CHROME_VER}", "Google Chrome";v="${CHROME_VER}"`
        } else if (lk === 'sec-ch-ua-full-version-list') {
          headers[key] = `"Not A Brand";v="8.0.0.0", "Chromium";v="${CHROME_FULL}", "Google Chrome";v="${CHROME_FULL}"`
        }
      }
      callback({ requestHeaders: headers })
    })

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
        partition: partitionKey,
      },
    })

    // Force any popup windows opened by Plaid (Chase OAuth page, Plaid's own
    // CDN callback page, etc.) into the same session so they get the same
    // patched UA and Client Hints headers.
    win.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          partition: partitionKey,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false,
        },
      },
    }))

    let settled = false

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    function cleanup() {
      ipcMain.removeListener('plaid-link:success', onSuccess)
      ipcMain.removeListener('plaid-link:exit', onExit)
      ipcMain.removeListener('plaid-link:error', onError)
      if (!win.isDestroyed()) win.close()
    }

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

    win.on('closed', () => {
      settle(() => reject(new Error('Plaid Link window was closed without completing')))
    })

    const htmlPath = getHtmlPath()
    win.loadURL(`file://${htmlPath}?token=${encodeURIComponent(linkToken)}`)
  })
}
