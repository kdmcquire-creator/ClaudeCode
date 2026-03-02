import { ipcMain, dialog, shell } from 'electron'
import { getDb, getSetting, setSetting, getAllSettings } from '../db/index'
import { classifyAndSave, reclassifyPendingAfterRuleChange, loadActiveRules } from './classification-engine'
import { syncAllPlaidAccounts, syncInvestments } from './plaid-sync'
import { storePlaidCredentials, loadPlaidCredentials, createLinkToken, exchangePublicToken, fetchAccountsForItem, storeAccessToken } from './plaid-service'
import { generatePeak10ExpenseReport, generateFullTrackerExport, validateExpenseReportReadiness } from './excel-export'
import { storeSmtpConfig, loadSmtpConfig, sendTestEmail, sendNotification } from './email-service'
import { runBackup } from './backup-service'
import { parseMonarchCsv } from './csv-parser'
import { v4 as uuidv4 } from 'uuid'
import type { Rule, Account, Transaction } from '../../src/shared/types'
import path from 'path'
import fs from 'fs'

export function registerIpcHandlers(syncFolder: string): void {

  // ── Dashboard ────────────────────────────────────────────────────
  ipcMain.handle('dashboard:getData', () => {
    const db = getDb()
    const peak10 = db.prepare("SELECT COUNT(*) as c, SUM(ABS(amount)) as t FROM transactions WHERE bucket='Peak 10' AND review_status!='auto_classified' OR (bucket='Peak 10' AND review_status='auto_classified')").get() as any
    const llc = db.prepare("SELECT COUNT(*) as c, SUM(ABS(amount)) as t FROM transactions WHERE bucket='Moonsmoke LLC'").get() as any
    const personalExp = db.prepare("SELECT COUNT(*) as c, SUM(ABS(amount)) as t FROM transactions WHERE bucket='Personal' AND amount>0").get() as any
    const personalInc = db.prepare("SELECT SUM(ABS(amount)) as t FROM transactions WHERE bucket='Personal' AND amount<0").get() as any
    const pending = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE review_status='pending_review'").get() as any
    const flagged = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE review_status='flagged'").get() as any
    const recent = db.prepare("SELECT t.*, a.account_name, a.account_mask, a.institution FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.review_status='auto_classified' ORDER BY t.transaction_date DESC LIMIT 20").all()
    const actions = db.prepare("SELECT * FROM action_items WHERE resolved=0 ORDER BY created_at").all()
    const invTotal = db.prepare("SELECT SUM(market_value) as t FROM investments WHERE record_type='holding' AND snapshot_date=(SELECT MAX(snapshot_date) FROM investments WHERE record_type='holding')").get() as any
    const accounts = db.prepare("SELECT * FROM accounts WHERE is_active=1").all()

    return {
      buckets: {
        peak10: { count: peak10?.c ?? 0, total: peak10?.t ?? 0 },
        llc: { count: llc?.c ?? 0, total: llc?.t ?? 0 },
        personal: { income: personalInc?.t ?? 0, expenses: personalExp?.t ?? 0, count: personalExp?.c ?? 0 },
        pending_review: pending?.c ?? 0,
        flagged: flagged?.c ?? 0
      },
      accounts, recent_transactions: recent, action_items: actions,
      investment_total: invTotal?.t ?? 0
    }
  })

  // ── Transactions ─────────────────────────────────────────────────
  ipcMain.handle('transactions:list', (_, filters: {
    bucket?: string; dateFrom?: string; dateTo?: string; search?: string
    accountId?: string; reviewStatus?: string; limit?: number; offset?: number
  }) => {
    const db = getDb()
    let sql = "SELECT t.*, a.account_name, a.account_mask, a.institution FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE 1=1"
    const params: unknown[] = []

    if (filters.bucket) { sql += " AND t.bucket=?"; params.push(filters.bucket) }
    if (filters.dateFrom) { sql += " AND t.transaction_date>=?"; params.push(filters.dateFrom) }
    if (filters.dateTo) { sql += " AND t.transaction_date<=?"; params.push(filters.dateTo) }
    if (filters.accountId) { sql += " AND t.account_id=?"; params.push(filters.accountId) }
    if (filters.reviewStatus) { sql += " AND t.review_status=?"; params.push(filters.reviewStatus) }
    if (filters.search) { sql += " AND (t.merchant_name LIKE ? OR t.description_raw LIKE ?)"; params.push(`%${filters.search}%`, `%${filters.search}%`) }

    sql += " ORDER BY t.transaction_date DESC"
    sql += ` LIMIT ${filters.limit ?? 500} OFFSET ${filters.offset ?? 0}`

    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('transactions:update', (_, id: string, updates: Partial<Transaction>) => {
    const db = getDb()
    const allowed = ['bucket','p10_category','llc_category','description_notes','review_status','flag_reason','period_label']
    const sets = Object.keys(updates).filter(k => allowed.includes(k)).map(k => `${k}=?`)
    if (!sets.length) return
    const vals = Object.keys(updates).filter(k => allowed.includes(k)).map(k => (updates as any)[k])
    db.prepare(`UPDATE transactions SET ${sets.join(',')}, review_status='manually_classified', updated_at=datetime('now') WHERE id=?`).run(...vals, id)
  })

  ipcMain.handle('transactions:split', (_, txId: string, fragments: Array<{ amount: number; bucket: string; p10_category?: string; llc_category?: string; description_notes?: string }>) => {
    const db = getDb()
    const orig = db.prepare("SELECT * FROM transactions WHERE id=?").get(txId) as Transaction
    if (!orig) throw new Error('Transaction not found')

    const insert = db.prepare(`INSERT INTO transactions (id,account_id,transaction_date,description_raw,merchant_name,amount,bucket,p10_category,llc_category,description_notes,review_status,split_parent_id,is_split_child,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'manually_classified',?,1,datetime('now'),datetime('now'))`)

    db.transaction(() => {
      for (const frag of fragments) {
        insert.run(uuidv4(), orig.account_id, orig.transaction_date, orig.description_raw, orig.merchant_name,
          frag.amount, frag.bucket, frag.p10_category??null, frag.llc_category??null, frag.description_notes??null, txId)
      }
      db.prepare("UPDATE transactions SET bucket='Exclude',review_status='auto_classified',flag_reason=NULL,updated_at=datetime('now') WHERE id=?").run(txId)
    })()
  })

  ipcMain.handle('transactions:getReviewQueue', () => {
    const db = getDb()
    return db.prepare(`SELECT t.*, a.account_name, a.account_mask, a.institution FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.review_status IN ('pending_review','flagged') ORDER BY t.transaction_date DESC LIMIT 200`).all()
  })

  ipcMain.handle('transactions:getContext', (_, merchantName: string, currentId: string) => {
    const db = getDb()
    return db.prepare(`SELECT t.*, a.account_name FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.merchant_name LIKE ? AND t.id != ? AND t.review_status != 'pending_review' ORDER BY t.transaction_date DESC LIMIT 5`).all(`%${merchantName}%`, currentId)
  })

  // ── Rules ────────────────────────────────────────────────────────
  ipcMain.handle('rules:list', () => {
    const db = getDb()
    return db.prepare("SELECT * FROM rules ORDER BY priority_order").all()
  })

  ipcMain.handle('rules:create', (_, rule: Omit<Rule, 'id'|'created_at'|'updated_at'>) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare(`INSERT INTO rules (id,rule_name,section,match_type,match_value,account_mask_filter,amount_min,amount_max,day_of_week_filter,date_from_filter,date_to_filter,bucket,p10_category,llc_category,description_notes,flag_reason,action,priority_order,is_active,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
      id,rule.rule_name,rule.section,rule.match_type,rule.match_value,
      rule.account_mask_filter??null,rule.amount_min??null,rule.amount_max??null,
      rule.day_of_week_filter??null,rule.date_from_filter??null,rule.date_to_filter??null,
      rule.bucket??null,rule.p10_category??null,rule.llc_category??null,
      rule.description_notes??null,rule.flag_reason??null,rule.action,
      rule.priority_order,rule.is_active??1,rule.notes??null)
    const result = reclassifyPendingAfterRuleChange()
    return { id, resolved: result.resolved }
  })

  ipcMain.handle('rules:update', (_, id: string, updates: Partial<Rule>) => {
    const db = getDb()
    const allowed = ['rule_name','section','match_type','match_value','account_mask_filter','amount_min','amount_max','day_of_week_filter','date_from_filter','date_to_filter','bucket','p10_category','llc_category','description_notes','flag_reason','action','priority_order','is_active','notes']
    const sets = Object.keys(updates).filter(k => allowed.includes(k)).map(k => `${k}=?`)
    const vals = Object.keys(updates).filter(k => allowed.includes(k)).map(k => (updates as any)[k])
    db.prepare(`UPDATE rules SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals, id)
    const result = reclassifyPendingAfterRuleChange()
    return { resolved: result.resolved }
  })

  ipcMain.handle('rules:delete', (_, id: string) => {
    const db = getDb()
    db.prepare("UPDATE rules SET is_active=0, updated_at=datetime('now') WHERE id=?").run(id)
  })

  ipcMain.handle('rules:testMatch', (_, rule: Partial<Rule>) => {
    const db = getDb()
    const allTxs = db.prepare("SELECT t.*, a.account_mask FROM transactions t JOIN accounts a ON a.id=t.account_id LIMIT 2000").all() as any[]
    const mockRule = { ...rule, id: 'test', is_active: 1 } as Rule
    const { classifyTransaction } = require('./classification-engine')
    let matches = 0
    const examples: any[] = []
    for (const tx of allTxs) {
      const r = classifyTransaction({ description_raw: tx.description_raw, amount: tx.amount, transaction_date: tx.transaction_date, account_mask: tx.account_mask }, [mockRule])
      if (r.rule_id === 'test') {
        matches++
        if (examples.length < 5) examples.push({ date: tx.transaction_date, merchant: tx.merchant_name, amount: tx.amount, current_bucket: tx.bucket })
      }
    }
    return { matches, examples }
  })

  // ── Accounts ─────────────────────────────────────────────────────
  ipcMain.handle('accounts:list', () => {
    return getDb().prepare("SELECT * FROM accounts ORDER BY institution, account_name").all()
  })

  ipcMain.handle('accounts:create', (_, account: Omit<Account, 'id'|'created_at'|'last_synced_at'>) => {
    const db = getDb()
    const id = uuidv4()
    db.prepare(`INSERT INTO accounts (id,plaid_item_id,plaid_account_id,institution,account_name,account_mask,account_type,entity,default_bucket,import_method,watched_folder_path,is_active,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,datetime('now'))`).run(
      id,account.plaid_item_id??null,account.plaid_account_id??null,
      account.institution,account.account_name,account.account_mask,
      account.account_type,account.entity,account.default_bucket,
      account.import_method,account.watched_folder_path??null,account.notes??null)
    return id
  })

  ipcMain.handle('accounts:update', (_, id: string, updates: Partial<Account>) => {
    const db = getDb()
    const allowed = ['account_name','entity','default_bucket','watched_folder_path','is_active','notes']
    const sets = Object.keys(updates).filter(k => allowed.includes(k)).map(k => `${k}=?`)
    const vals = Object.keys(updates).filter(k => allowed.includes(k)).map(k => (updates as any)[k])
    if (sets.length) db.prepare(`UPDATE accounts SET ${sets.join(',')} WHERE id=?`).run(...vals, id)
  })

  // ── Sync ─────────────────────────────────────────────────────────
  ipcMain.handle('sync:runAll', async () => {
    return syncAllPlaidAccounts()
  })

  ipcMain.handle('sync:getLog', () => {
    return getDb().prepare("SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 50").all()
  })

  // ── Plaid ─────────────────────────────────────────────────────────
  ipcMain.handle('plaid:getCredentials', () => {
    const c = loadPlaidCredentials()
    return c ? { clientId: c.clientId, env: c.env } : null // never return secret
  })

  ipcMain.handle('plaid:saveCredentials', (_, creds: { clientId: string; secret: string; env: string }) => {
    storePlaidCredentials(creds as any)
    const { initPlaidClient } = require('./plaid-service')
    initPlaidClient(creds as any)
  })

  ipcMain.handle('plaid:createLinkToken', async () => {
    return createLinkToken()
  })

  ipcMain.handle('plaid:exchangeToken', async (_, publicToken: string) => {
    const { accessToken, itemId } = await exchangePublicToken(publicToken)
    const db = getDb()
    const internalId = uuidv4()
    storeAccessToken(internalId, accessToken)
    // Fetch institution info
    const { PlaidApi } = require('plaid')
    const client = (require('./plaid-service') as any).getPlaidClient()
    const itemResp = await client.itemGet({ access_token: accessToken })
    const instResp = await client.institutionsGetById({
      institution_id: itemResp.data.item.institution_id,
      country_codes: ['US']
    })
    const instName = instResp.data.institution.name

    db.prepare("INSERT OR IGNORE INTO plaid_items (id,institution_id,institution_name,plaid_item_id,status,created_at) VALUES (?,?,?,?,'active',datetime('now'))")
      .run(internalId, itemResp.data.item.institution_id, instName, itemId)

    const plaidAccounts = await fetchAccountsForItem(accessToken)
    return { internalItemId: internalId, plaidItemId: itemId, institutionName: instName, accounts: plaidAccounts }
  })

  // ── Reports / Exports ─────────────────────────────────────────────
  ipcMain.handle('reports:validate', (_, dateFrom: string, dateTo: string) => {
    return validateExpenseReportReadiness(dateFrom, dateTo)
  })

  ipcMain.handle('reports:generateExpenseReport', async (_, dateFrom: string, dateTo: string, periodLabel: string) => {
    const exportsDir = path.join(syncFolder, 'exports', 'expense_reports')
    fs.mkdirSync(exportsDir, { recursive: true })
    const fileName = `Peak10_ExpenseReport_${periodLabel.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.xlsx`
    const outputPath = path.join(exportsDir, fileName)
    const result = await generatePeak10ExpenseReport(dateFrom, dateTo, periodLabel, outputPath)
    shell.showItemInFolder(outputPath)
    return result
  })

  ipcMain.handle('reports:generateFullExport', async () => {
    const exportsDir = path.join(syncFolder, 'exports', 'statements')
    fs.mkdirSync(exportsDir, { recursive: true })
    const fileName = `McQuire_Tracker_${new Date().toISOString().substring(0,10)}.xlsx`
    const outputPath = path.join(exportsDir, fileName)
    await generateFullTrackerExport(outputPath)
    shell.showItemInFolder(outputPath)
    return outputPath
  })

  // ── Settings ─────────────────────────────────────────────────────
  ipcMain.handle('settings:getAll', () => getAllSettings())

  ipcMain.handle('settings:set', (_, key: string, value: string) => setSetting(key, value))

  ipcMain.handle('settings:getSmtp', () => {
    const c = loadSmtpConfig()
    return c ? { host: c.host, port: c.port, secure: c.secure, user: c.user } : null
  })

  ipcMain.handle('settings:saveSmtp', (_, config: { host: string; port: number; secure: boolean; user: string; password: string }) => {
    storeSmtpConfig(config)
  })

  ipcMain.handle('settings:testEmail', async (_, toEmail: string) => {
    return sendTestEmail(toEmail)
  })

  ipcMain.handle('settings:browseFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.filePaths[0] ?? null
  })

  // ── Action Items ─────────────────────────────────────────────────
  ipcMain.handle('actionItems:resolve', (_, id: string) => {
    getDb().prepare("UPDATE action_items SET resolved=1, resolved_at=datetime('now') WHERE id=?").run(id)
  })

  ipcMain.handle('actionItems:add', (_, text: string) => {
    const id = uuidv4()
    getDb().prepare("INSERT INTO action_items (id,text) VALUES (?,?)").run(id, text)
    return id
  })

  // ── Monarch import ────────────────────────────────────────────────
  ipcMain.handle('import:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      properties: ['openFile']
    })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('import:monarchCsv', async (_, filePath: string, accountMappings: Record<string, string>) => {
    const db = getDb()
    const rows = parseMonarchCsv(filePath) as any[]
    let inserted = 0, dupes = 0

    const insertTx = db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id,account_id,source_row_hash,transaction_date,description_raw,amount,category_source,review_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'pending_review',datetime('now'),datetime('now'))
    `)

    // Wait — Monarch rows have a monarch_account field. Map it to account_id.
    db.transaction(() => {
      for (const row of rows) {
        const accountId = accountMappings[row.monarch_account] ?? null
        if (!accountId) continue
        const r = insertTx.run(uuidv4(), accountId, row.source_row_hash, row.transaction_date, row.description_raw, row.amount, row.category_source)
        if (r.changes > 0) { inserted++ } else { dupes++ }
      }
    })()

    // Classify
    const newTxs = db.prepare("SELECT t.id, t.description_raw, t.amount, t.transaction_date, a.account_mask, t.category_source FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.review_status='pending_review'").all() as any[]
    const { classified, queued } = classifyAndSave(newTxs)

    return { total: rows.length, inserted, dupes, classified, queued }
  })

  // ── Investments ───────────────────────────────────────────────────
  ipcMain.handle('investments:getHoldings', () => {
    const db = getDb()
    const latestDate = (db.prepare("SELECT MAX(snapshot_date) as d FROM investments WHERE record_type='holding'").get() as any)?.d
    if (!latestDate) return []
    return db.prepare("SELECT i.*, a.account_name, a.institution FROM investments i JOIN accounts a ON a.id=i.account_id WHERE i.record_type='holding' AND i.snapshot_date=? ORDER BY i.market_value DESC").all(latestDate)
  })

  ipcMain.handle('investments:getTransactions', (_, filters: { dateFrom?: string; dateTo?: string; accountId?: string }) => {
    const db = getDb()
    let sql = "SELECT i.*, a.account_name, a.institution FROM investments i JOIN accounts a ON a.id=i.account_id WHERE i.record_type='transaction'"
    const params: unknown[] = []
    if (filters.dateFrom) { sql += " AND i.transaction_date>=?"; params.push(filters.dateFrom) }
    if (filters.dateTo) { sql += " AND i.transaction_date<=?"; params.push(filters.dateTo) }
    if (filters.accountId) { sql += " AND i.account_id=?"; params.push(filters.accountId) }
    sql += " ORDER BY i.transaction_date DESC LIMIT 500"
    return db.prepare(sql).all(...params)
  })

  ipcMain.handle('investments:sync', async () => syncInvestments())

  // ── Personal Trip Dates ───────────────────────────────────────────
  // Preload exposes trips.getAll/save/delete — channels must match.
  // The UI sends { trip_name, start_date, end_date }; we map → date_from/date_to (DB column names).
  ipcMain.handle('trips:get-all', () => getDb().prepare("SELECT * FROM personal_trip_dates ORDER BY date_from").all())
  ipcMain.handle('trips:save', (_, trip: { trip_name: string; start_date: string; end_date: string; notes?: string }) => {
    const id = uuidv4()
    getDb().prepare("INSERT INTO personal_trip_dates (id,trip_name,date_from,date_to,notes) VALUES (?,?,?,?,?)").run(id, trip.trip_name, trip.start_date, trip.end_date, trip.notes??null)
    return id
  })
  ipcMain.handle('trips:delete', (_, id: string) => getDb().prepare("DELETE FROM personal_trip_dates WHERE id=?").run(id))

  console.log('[IPC] All handlers registered')
}
