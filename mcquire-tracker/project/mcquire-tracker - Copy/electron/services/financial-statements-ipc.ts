// electron/services/financial-statements-ipc.ts
//
// Phase 4 — IPC handlers for all financial statement exports.
// Register by calling registerFinancialStatementsHandlers() in main process.

import { ipcMain, shell } from 'electron'
import Database from 'better-sqlite3'
import { FinancialStatementsService } from './financial-statements.service'

export function registerFinancialStatementsHandlers(
  db: Database.Database,
  getSyncFolder: () => string
): void {
  const svc = FinancialStatementsService.getInstance(db)

  // ── P&L ──────────────────────────────────────────────────────────────────────
  ipcMain.handle('statements:pandl', async () => {
    try {
      const outputPath = await svc.generatePandL(getSyncFolder())
      return { success: true, data: outputPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Balance Sheet ─────────────────────────────────────────────────────────────
  ipcMain.handle('statements:balance-sheet', async () => {
    try {
      const outputPath = await svc.generateBalanceSheet(getSyncFolder())
      return { success: true, data: outputPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Cashflow ──────────────────────────────────────────────────────────────────
  ipcMain.handle('statements:cashflow', async () => {
    try {
      const outputPath = await svc.generateCashflow(getSyncFolder())
      return { success: true, data: outputPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Personal Summary ──────────────────────────────────────────────────────────
  ipcMain.handle('statements:personal-summary', async () => {
    try {
      const outputPath = await svc.generatePersonalSummary(getSyncFolder())
      return { success: true, data: outputPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Full Tracker Export ───────────────────────────────────────────────────────
  ipcMain.handle('statements:full-tracker', async () => {
    try {
      const outputPath = await svc.generateFullTracker(getSyncFolder())
      return { success: true, data: outputPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Open exports folder in Explorer ──────────────────────────────────────────
  ipcMain.handle('statements:open-folder', async () => {
    const { path } = require('path')
    const exportDir = require('path').join(getSyncFolder(), 'exports', 'statements')
    require('fs').mkdirSync(exportDir, { recursive: true })
    shell.openPath(exportDir)
    return { success: true }
  })

  // ── Cash balance manual entry (for Balance Sheet) ─────────────────────────────
  ipcMain.handle('statements:set-cash-balance', async (_event, { date, amount }: { date: string; amount: number }) => {
    try {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(`cash_balance_${date}`, String(amount))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Revenue manual entry (for P&L — Strawn wire amounts) ─────────────────────
  ipcMain.handle('statements:set-revenue', async (_event, { month, amount }: { month: string; amount: number }) => {
    try {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(`revenue_${month}`, String(amount))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Get current manual entries (for Reports UI display) ───────────────────────
  ipcMain.handle('statements:get-manual-entries', async () => {
    try {
      const revenue = db
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'revenue_%' ORDER BY key")
        .all() as Array<{ key: string; value: string }>

      const cashBalances = db
        .prepare("SELECT key, value FROM settings WHERE key LIKE 'cash_balance_%' ORDER BY key")
        .all() as Array<{ key: string; value: string }>

      return {
        success: true,
        data: {
          revenue: revenue.map((r) => ({
            month: r.key.replace('revenue_', ''),
            amount: parseFloat(r.value),
          })),
          cash_balances: cashBalances.map((r) => ({
            date: r.key.replace('cash_balance_', ''),
            amount: parseFloat(r.value),
          })),
        },
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
