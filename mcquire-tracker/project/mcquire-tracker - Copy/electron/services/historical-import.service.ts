// electron/services/historical-import.service.ts
//
// Phase 4 — Historical Data Import Wizard (backend)
// Handles importing the Monarch CSV export and optionally seeding from
// the existing McQuire_Tracker_v3.xlsx into SQLite.
//
// This is a one-time operation on first setup. The wizard walks Kyle through:
//   Step 1: Select Monarch CSV → preview → map columns → classify → import
//   Step 2: (Optional) Select existing Excel workbook → extract already-classified
//           transactions → merge into DB (skip duplicates)

import * as Papa from 'papaparse'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { ipcMain, dialog } from 'electron'

// ─── Monarch CSV column mapping ───────────────────────────────────────────────
// Monarch export columns: Date, Merchant, Category, Account, Original Statement,
// Notes, Amount, Tags, Owner, Business Entity

const MONARCH_COLUMN_MAP: Record<string, string> = {
  'Date':               'transaction_date',
  'Merchant':           'merchant_name',
  'Category':           'category_source',
  'Account':            'account_raw',
  'Original Statement': 'description_raw',
  'Notes':              'notes_raw',
  'Amount':             'amount',
  'Tags':               'tags',
  'Owner':              'owner',
  'Business Entity':    'business_entity',
}

// Account name → mask lookup (from workflow doc)
const ACCOUNT_NAME_TO_MASK: Record<string, string> = {
  'K. MCQUIRE':          '5829',
  'K. McQuire':          '5829',
  'CREDIT CARD':         '9007',  // will need context to disambiguate 9007 vs 2419
  'BUS COMPLETE CHK':    '2255',
  'Main Checking':       '8178',
  'USAA':                '8178',
}

// Always-exclude Monarch categories
const EXCLUDE_CATEGORIES = new Set([
  'Credit Card Payment',
  'Transfer',
  'Transfers',
  'Payment',
])

export interface ImportPreview {
  total_rows: number
  date_range: { start: string; end: string }
  accounts_found: string[]
  excluded_count: number
  already_imported_count: number
  new_count: number
  columns_detected: string[]
  column_mapping_valid: boolean
  errors: string[]
}

export interface ImportProgress {
  stage: 'parsing' | 'deduplicating' | 'classifying' | 'inserting' | 'done' | 'error'
  current: number
  total: number
  message: string
  classified: number
  queued: number
  excluded: number
  duplicates: number
  errors: string[]
}

export class HistoricalImportService {
  private static instance: HistoricalImportService | null = null
  private db: Database.Database

  private constructor(db: Database.Database) {
    this.db = db
  }

  static getInstance(db: Database.Database): HistoricalImportService {
    if (!HistoricalImportService.instance) {
      HistoricalImportService.instance = new HistoricalImportService(db)
    }
    return HistoricalImportService.instance
  }

  // ─── Preview CSV before committing ───────────────────────────────────────────

  async previewCSV(filePath: string): Promise<ImportPreview> {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true })

    const errors: string[] = []
    if (parsed.errors.length > 0) {
      errors.push(...parsed.errors.slice(0, 5).map((e) => e.message))
    }

    const rows = parsed.data as Record<string, string>[]
    const columns = parsed.meta.fields || []

    // Validate required columns
    const requiredCols = ['Date', 'Merchant', 'Amount', 'Account']
    const missingCols = requiredCols.filter((c) => !columns.includes(c))
    if (missingCols.length > 0) {
      errors.push(`Missing required columns: ${missingCols.join(', ')}`)
    }

    const dates = rows
      .map((r) => r['Date'])
      .filter(Boolean)
      .sort()

    const accountsFound = Array.from(new Set(rows.map((r) => r['Account']).filter(Boolean)))

    let excludedCount = 0
    let alreadyImported = 0
    let newCount = 0

    for (const row of rows) {
      const category = row['Category'] || ''
      if (EXCLUDE_CATEGORIES.has(category)) {
        excludedCount++
        continue
      }

      const hash = this.rowHash(row)
      const exists = this.db
        .prepare('SELECT id FROM transactions WHERE source_row_hash = ?')
        .get(hash)
      if (exists) {
        alreadyImported++
      } else {
        newCount++
      }
    }

    return {
      total_rows: rows.length,
      date_range: {
        start: dates[0] || '',
        end: dates[dates.length - 1] || '',
      },
      accounts_found: accountsFound,
      excluded_count: excludedCount,
      already_imported_count: alreadyImported,
      new_count: newCount,
      columns_detected: columns,
      column_mapping_valid: missingCols.length === 0,
      errors,
    }
  }

  // ─── Run the import ───────────────────────────────────────────────────────────

  async importCSV(
    filePath: string,
    onProgress: (progress: ImportProgress) => void
  ): Promise<{ imported: number; classified: number; queued: number; errors: string[] }> {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true })
    const rows = parsed.data as Record<string, string>[]

    const progress: ImportProgress = {
      stage: 'parsing',
      current: 0,
      total: rows.length,
      message: 'Parsing CSV…',
      classified: 0,
      queued: 0,
      excluded: 0,
      duplicates: 0,
      errors: [],
    }
    onProgress({ ...progress })

    let imported = 0
    let classified = 0
    let queued = 0
    const errors: string[] = []

    // Process in batches of 100 to allow progress updates
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      progress.stage = i === 0 ? 'deduplicating' : 'classifying'
      progress.current = i
      progress.message = `Processing rows ${i}–${Math.min(i + BATCH, rows.length)} of ${rows.length}…`
      onProgress({ ...progress })

      const insertBatch = this.db.transaction((txRows: any[]) => {
        for (const txRow of txRows) {
          try {
            this.db
              .prepare(
                `INSERT OR IGNORE INTO transactions
                  (id, account_id, plaid_transaction_id, source_row_hash,
                   transaction_date, posting_date, description_raw, merchant_name,
                   amount, category_source, bucket, p10_category, llc_category,
                   description_notes, rule_id, review_status, flag_reason,
                   split_parent_id, is_split_child, period_label, expense_report_id,
                   created_at, updated_at)
                 VALUES
                  (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, NULL,
                   datetime('now'), datetime('now'))`
              )
              .run(
                txRow.id, txRow.account_id, txRow.hash,
                txRow.transaction_date, txRow.description_raw, txRow.merchant_name,
                txRow.amount, txRow.category_source, txRow.bucket, txRow.p10_category,
                txRow.llc_category, txRow.description_notes, txRow.rule_id,
                txRow.review_status, txRow.flag_reason, txRow.period_label
              )
          } catch (err: any) {
            errors.push(`Row ${txRow.transaction_date} ${txRow.merchant_name}: ${err.message}`)
          }
        }
      })

      const processedBatch: any[] = []

      for (const row of batch) {
        const category = row['Category'] || ''
        if (EXCLUDE_CATEGORIES.has(category)) {
          progress.excluded++
          continue
        }

        const hash = this.rowHash(row)
        const exists = this.db
          .prepare('SELECT id FROM transactions WHERE source_row_hash = ?')
          .get(hash)
        if (exists) {
          progress.duplicates++
          continue
        }

        const accountId = this.findOrCreateAccount(row['Account'] || '')
        if (!accountId) continue

        const amount = this.parseAmount(row['Amount'] || '0')
        const merchantName = this.cleanMerchant(row['Merchant'] || row['Original Statement'] || '')

        const rawTx = {
          id: uuidv4(),
          account_id: accountId,
          hash,
          transaction_date: this.normalizeDate(row['Date'] || ''),
          description_raw: row['Original Statement'] || row['Merchant'] || '',
          merchant_name: merchantName,
          amount,
          category_source: category,
          bucket: null as string | null,
          p10_category: null as string | null,
          llc_category: null as string | null,
          description_notes: row['Notes'] || null,
          rule_id: null as string | null,
          review_status: 'pending_review',
          flag_reason: null as string | null,
          period_label: null as string | null,
        }

        // Run classification engine
        try {
          const { classifyTransaction } = require('./classification.service')
          const result = classifyTransaction(this.db, rawTx)
          Object.assign(rawTx, result)
          if (rawTx.bucket && rawTx.bucket !== 'Exclude') classified++
          else if (!rawTx.bucket) queued++
        } catch {
          queued++
        }

        processedBatch.push(rawTx)
      }

      if (processedBatch.length > 0) {
        insertBatch(processedBatch)
        imported += processedBatch.length
      }

      progress.classified = classified
      progress.queued = queued
      onProgress({ ...progress })
    }

    progress.stage = 'done'
    progress.current = rows.length
    progress.message = `Import complete. ${imported} transactions imported.`
    onProgress({ ...progress })

    return { imported, classified, queued, errors }
  }

  // ─── Helper methods ───────────────────────────────────────────────────────────

  private rowHash(row: Record<string, string>): string {
    const key = `${row['Date']}|${row['Merchant']}|${row['Amount']}|${row['Account']}`
    return crypto.createHash('sha256').update(key).digest('hex')
  }

  private findOrCreateAccount(accountName: string): string | null {
    // Try to find existing account by name match
    const normalizedName = accountName.trim()

    // Direct match by account_name
    let account = this.db
      .prepare("SELECT id FROM accounts WHERE account_name LIKE ? AND is_active = 1 LIMIT 1")
      .get(`%${normalizedName.slice(0, 12)}%`) as { id: string } | undefined

    if (account) return account.id

    // Try mask lookup
    const mask = ACCOUNT_NAME_TO_MASK[normalizedName] ||
      Object.entries(ACCOUNT_NAME_TO_MASK).find(([k]) =>
        normalizedName.toLowerCase().includes(k.toLowerCase())
      )?.[1]

    if (mask) {
      account = this.db
        .prepare("SELECT id FROM accounts WHERE account_mask = ? AND is_active = 1 LIMIT 1")
        .get(mask) as { id: string } | undefined
      if (account) return account.id
    }

    // Create a placeholder account if none found
    const id = uuidv4()
    const derivedMask = mask || normalizedName.slice(-4)
    try {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO accounts
            (id, institution, account_name, account_mask, account_type, entity,
             default_bucket, import_method, is_active, created_at)
           VALUES (?, 'Unknown', ?, ?, 'credit', 'Personal', 'Personal', 'watched_folder', 1, datetime('now'))`
        )
        .run(id, normalizedName, derivedMask)
      return id
    } catch {
      return null
    }
  }

  private parseAmount(raw: string): number {
    // Monarch exports amounts as positive for debits and negative for credits
    const cleaned = raw.replace(/[$,\s]/g, '')
    return parseFloat(cleaned) || 0
  }

  private normalizeDate(raw: string): string {
    // Handle MM/DD/YYYY or YYYY-MM-DD
    if (raw.includes('/')) {
      const [month, day, year] = raw.split('/')
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
    return raw
  }

  private cleanMerchant(raw: string): string {
    return raw
      .replace(/^(TST\*|SQ \*|PY \*|DoorDash\s+)/i, '')
      .replace(/\s+\d{3,}$/, '')
      .trim()
  }
}

// ─── IPC registration ─────────────────────────────────────────────────────────

export function registerHistoricalImportHandlers(
  db: Database.Database,
  getMainWindow: () => Electron.BrowserWindow | null
): void {
  const service = HistoricalImportService.getInstance(db)

  ipcMain.handle('import:select-file', async () => {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select Monarch CSV Export',
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile'],
    })
    if (result.canceled) return { success: false }
    return { success: true, data: result.filePaths[0] }
  })

  ipcMain.handle('import:preview', async (_event, filePath: string) => {
    try {
      const preview = await service.previewCSV(filePath)
      return { success: true, data: preview }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('import:run', async (event, filePath: string) => {
    try {
      const result = await service.importCSV(filePath, (progress) => {
        // Push progress to renderer
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('import:progress', progress)
        }
      })
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
