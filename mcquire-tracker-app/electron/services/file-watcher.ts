import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db/index'
import { parseUSAAcsv, parseAppleCardCsv, detectFileType } from './csv-parser'
import { classifyAndSave } from './classification-engine'
import type { Account } from '../../src/shared/types'

const watchers = new Map<string, FSWatcher>()

export function startWatching(syncFolder: string, onNewTransactions: (result: { account: string; count: number }) => void): void {
  const db = getDb()
  const accounts = db.prepare("SELECT * FROM accounts WHERE import_method = 'watched_folder' AND is_active = 1").all() as Account[]

  for (const account of accounts) {
    if (!account.watched_folder_path) continue
    watchFolder(account, onNewTransactions)
  }

  // Default USAA + Apple Card folders
  const usaaFolder = path.join(syncFolder, 'imports', 'usaa')
  const appleFolder = path.join(syncFolder, 'imports', 'apple_card')
  fs.mkdirSync(usaaFolder, { recursive: true })
  fs.mkdirSync(appleFolder, { recursive: true })
}

export function watchFolder(account: Account, onNew: (r: { account: string; count: number }) => void): void {
  const folderPath = account.watched_folder_path!
  if (watchers.has(folderPath)) return

  const watcher = chokidar.watch(folderPath, {
    ignored: /processed\//,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
  })

  watcher.on('add', async (filePath) => {
    if (!filePath.match(/\.(csv|ofx|qfx)$/i)) return
    console.log(`[FileWatcher] New file detected: ${filePath}`)
    await processFile(filePath, account, onNew)
  })

  watchers.set(folderPath, watcher)
  console.log(`[FileWatcher] Watching: ${folderPath}`)
}

async function processFile(
  filePath: string,
  account: Account,
  onNew: (r: { account: string; count: number }) => void
): Promise<void> {
  const db = getDb()
  const started = new Date().toISOString()
  let logId: number | null = null

  try {
    const fileType = detectFileType(filePath)
    let rows: Array<{ transaction_date: string; posting_date: string | null; description_raw: string; amount: number; category_source: string | null; source_row_hash: string }>

    if (fileType === 'apple_card') {
      rows = parseAppleCardCsv(filePath)
    } else {
      rows = parseUSAAcsv(filePath)
    }

    const logStmt = db.prepare(`
      INSERT INTO sync_log (sync_type, account_id, source_file, transactions_found, started_at)
      VALUES ('watched_folder', ?, ?, ?, ?)
    `)
    logId = Number((logStmt.run(account.id, path.basename(filePath), rows.length, started)).lastInsertRowid)

    // Dedup and insert
    let inserted = 0, dupes = 0
    const insertTx = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id, account_id, source_row_hash, transaction_date, posting_date, description_raw, amount, category_source, review_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', datetime('now'), datetime('now'))
    `)

    const run = db.transaction(() => {
      for (const row of rows) {
        const result = insertTx.run(
          uuidv4(), account.id, row.source_row_hash,
          row.transaction_date, row.posting_date, row.description_raw,
          row.amount, row.category_source
        )
        if (result.changes > 0) inserted++
        else dupes++
      }
    })
    run()

    // Get newly inserted IDs and classify
    const newIds = db.prepare(`
      SELECT t.id, t.description_raw, t.amount, t.transaction_date, a.account_mask, t.category_source
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = ? AND t.review_status = 'pending_review'
      ORDER BY t.created_at DESC LIMIT ?
    `).all(account.id, inserted) as any[]

    const { classified, queued } = classifyAndSave(db, newIds.map(r => ({
      id: r.id, description_raw: r.description_raw, amount: r.amount,
      transaction_date: r.transaction_date, account_mask: r.account_mask,
      category_source: r.category_source
    })))

    // Update log
    if (logId) {
      db.prepare(`UPDATE sync_log SET transactions_new=?, transactions_duplicate=?,
        transactions_classified=?, transactions_queued=?, status='success', completed_at=datetime('now')
        WHERE id=?`).run(inserted, dupes, classified, queued, logId)
    }

    // Move to processed
    const processedDir = path.join(path.dirname(filePath), 'processed')
    fs.mkdirSync(processedDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    fs.renameSync(filePath, path.join(processedDir, `${ts}_${path.basename(filePath)}`))

    if (inserted > 0) {
      onNew({ account: account.account_name, count: queued })
    }
  } catch (err: any) {
    console.error('[FileWatcher] Error processing file:', err)
    if (logId) {
      db.prepare("UPDATE sync_log SET status='error', error_message=?, completed_at=datetime('now') WHERE id=?")
        .run(err.message, logId)
    }
  }
}

export function stopAllWatchers(): void {
  for (const [, watcher] of watchers) watcher.close()
  watchers.clear()
}
