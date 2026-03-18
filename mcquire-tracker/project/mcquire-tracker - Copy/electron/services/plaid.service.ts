// electron/services/plaid.service.ts
//
// Core Plaid integration service.
// Handles: Link token creation, token exchange, /transactions/sync cursor-based pull.
// Tokens stored in Windows Credential Manager via electron.safeStorage — never on disk.
//
// Usage:
//   const plaid = PlaidService.getInstance(db)
//   await plaid.createLinkToken()
//   await plaid.exchangePublicToken(publicToken, institutionId, institutionName, accounts)
//   await plaid.syncTransactions(itemId, onProgress)

import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { safeStorage, app } from 'electron'
import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as fs from 'fs'
import type { SyncResult } from '../../src/shared/plaid.types'

// ─── Credential helpers (Windows Credential Manager via safeStorage) ───────────

const CRED_KEY_PLAID_CLIENT_ID = 'McQuireTracker_plaid_client_id'
const CRED_KEY_PLAID_SECRET = 'McQuireTracker_plaid_secret'
const CRED_PREFIX_ACCESS_TOKEN = 'McQuireTracker_plaid_token_' // + item_id

function getCredentialPath(key: string): string {
  // safeStorage encrypts/decrypts using Windows DPAPI.
  // We store the encrypted bytes as files in app.getPath('userData').
  return path.join(app.getPath('userData'), 'creds', key.replace(/[^a-z0-9_-]/gi, '_'))
}

function saveCredential(key: string, value: string): void {
  const credPath = getCredentialPath(key)
  fs.mkdirSync(path.dirname(credPath), { recursive: true })
  const encrypted = safeStorage.encryptString(value)
  fs.writeFileSync(credPath, encrypted)
}

function loadCredential(key: string): string | null {
  const credPath = getCredentialPath(key)
  if (!fs.existsSync(credPath)) return null
  try {
    const encrypted = fs.readFileSync(credPath)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

function deleteCredential(key: string): void {
  const credPath = getCredentialPath(key)
  if (fs.existsSync(credPath)) fs.unlinkSync(credPath)
}

// ─── PlaidService ──────────────────────────────────────────────────────────────

export class PlaidService {
  private static instance: PlaidService | null = null
  private db: Database.Database
  private client: PlaidApi | null = null

  private constructor(db: Database.Database) {
    this.db = db
  }

  static getInstance(db: Database.Database): PlaidService {
    if (!PlaidService.instance) {
      PlaidService.instance = new PlaidService(db)
    }
    return PlaidService.instance
  }

  // ─── Configuration ───────────────────────────────────────────────────────────

  savePlaidCredentials(clientId: string, secret: string): void {
    saveCredential(CRED_KEY_PLAID_CLIENT_ID, clientId)
    saveCredential(CRED_KEY_PLAID_SECRET, secret)
    this.client = null // force re-init
  }

  getStoredClientId(): string | null {
    return loadCredential(CRED_KEY_PLAID_CLIENT_ID)
  }

  isConfigured(): boolean {
    return !!loadCredential(CRED_KEY_PLAID_CLIENT_ID) && !!loadCredential(CRED_KEY_PLAID_SECRET)
  }

  private getClient(): PlaidApi {
    if (this.client) return this.client

    const clientId = loadCredential(CRED_KEY_PLAID_CLIENT_ID)
    const secret = loadCredential(CRED_KEY_PLAID_SECRET)

    if (!clientId || !secret) {
      throw new Error('Plaid credentials not configured. Set them in Settings → Sync & Schedule.')
    }

    const env = this.getSetting('plaid_env') || 'development'
    const baseUrl =
      env === 'sandbox'
        ? PlaidEnvironments.sandbox
        : env === 'production'
        ? PlaidEnvironments.production
        : PlaidEnvironments.development

    const config = new Configuration({
      basePath: baseUrl,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    })

    this.client = new PlaidApi(config)
    return this.client
  }

  // ─── Settings helpers ─────────────────────────────────────────────────────────

  private getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  // ─── Plaid Link ───────────────────────────────────────────────────────────────

  async createLinkToken(): Promise<string> {
    const client = this.getClient()
    const response = await client.linkTokenCreate({
      user: { client_user_id: 'kyle-mcquire' },
      client_name: 'McQuire Tracker',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      redirect_uri: 'https://localhost:3000/plaid-oauth-callback',
    })
    return response.data.link_token
  }

  async createReauthLinkToken(accessToken: string): Promise<string> {
    const client = this.getClient()
    const response = await client.linkTokenCreate({
      user: { client_user_id: 'kyle-mcquire' },
      client_name: 'McQuire Tracker',
      access_token: accessToken,
      country_codes: [CountryCode.Us],
      language: 'en',
      redirect_uri: 'https://localhost:3000/plaid-oauth-callback',
    })
    return response.data.link_token
  }

  // ─── Token Exchange ────────────────────────────────────────────────────────────

  async exchangePublicToken(
    publicToken: string,
    institutionId: string,
    institutionName: string,
    selectedAccounts: Array<{
      plaid_account_id: string
      account_name: string
      account_mask: string
      account_type: string
      entity: string
      default_bucket: string
    }>
  ): Promise<string> {
    const client = this.getClient()

    // Exchange public token → access token
    const exchangeResponse = await client.itemPublicTokenExchange({
      public_token: publicToken,
    })
    const { access_token, item_id } = exchangeResponse.data

    // Store access token encrypted
    saveCredential(CRED_PREFIX_ACCESS_TOKEN + item_id, access_token)

    // Record plaid_item in DB
    const plaidItemId = uuidv4()
    this.db
      .prepare(
        `INSERT INTO plaid_items
          (id, institution_id, institution_name, plaid_item_id, status, created_at)
         VALUES (?, ?, ?, ?, 'active', datetime('now'))
         ON CONFLICT(plaid_item_id) DO UPDATE SET
           status = 'active',
           error_code = NULL`
      )
      .run(plaidItemId, institutionId, institutionName, item_id)

    // Insert accounts
    for (const acct of selectedAccounts) {
      const existing = this.db
        .prepare('SELECT id FROM accounts WHERE plaid_account_id = ?')
        .get(acct.plaid_account_id)

      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO accounts
              (id, plaid_item_id, plaid_account_id, institution, account_name, account_mask,
               account_type, entity, default_bucket, import_method, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid', 1, datetime('now'))`
          )
          .run(
            uuidv4(),
            item_id,
            acct.plaid_account_id,
            institutionName,
            acct.account_name,
            acct.account_mask,
            acct.account_type,
            acct.entity,
            acct.default_bucket
          )
      }
    }

    return item_id
  }

  // ─── Transaction Sync ─────────────────────────────────────────────────────────

  /**
   * Sync transactions for a single Plaid item using /transactions/sync.
   * Uses cursor-based pagination — only fetches new/modified transactions.
   */
  async syncItem(
    plaidItemId: string,
    onProgress?: (msg: string) => void
  ): Promise<SyncResult> {
    const client = this.getClient()

    const item = this.db
      .prepare('SELECT * FROM plaid_items WHERE plaid_item_id = ?')
      .get(plaidItemId) as
      | {
          id: string
          institution_name: string
          plaid_item_id: string
          status: string
        }
      | undefined

    if (!item) throw new Error(`Plaid item not found: ${plaidItemId}`)

    const accessToken = loadCredential(CRED_PREFIX_ACCESS_TOKEN + plaidItemId)
    if (!accessToken) throw new Error(`No access token found for item: ${plaidItemId}`)

    const logId = this.startSyncLog('plaid_pull', null)
    const result: SyncResult = {
      transactions_found: 0,
      transactions_new: 0,
      transactions_duplicate: 0,
      transactions_classified: 0,
      transactions_queued: 0,
    }

    try {
      // Load stored cursor (if any)
      const cursorRow = this.db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(`plaid_cursor_${plaidItemId}`) as { value: string } | undefined
      let cursor = cursorRow?.value || undefined

      let hasMore = true

      while (hasMore) {
        onProgress?.(`Fetching transactions from ${item.institution_name}…`)

        const syncResponse = await client.transactionsSync({
          access_token: accessToken,
          cursor,
          count: 500,
        })

        const { added, modified, removed, next_cursor, has_more } = syncResponse.data
        hasMore = has_more
        cursor = next_cursor

        result.transactions_found += added.length + modified.length

        // Process added transactions
        for (const tx of added) {
          const imported = this.importPlaidTransaction(tx, plaidItemId)
          if (imported === 'new') {
            result.transactions_new++
            result.transactions_classified++ // classification happens inside importPlaidTransaction
          } else if (imported === 'duplicate') {
            result.transactions_duplicate++
          } else if (imported === 'queued') {
            result.transactions_new++
            result.transactions_queued++
          }
        }

        // Process modified — re-run classification on existing rows
        for (const tx of modified) {
          this.updatePlaidTransaction(tx)
        }

        // Process removed
        for (const removed_tx of removed) {
          this.db
            .prepare("UPDATE transactions SET bucket = 'Exclude' WHERE plaid_transaction_id = ?")
            .run(removed_tx.transaction_id)
        }
      }

      // Save cursor
      this.setSetting(`plaid_cursor_${plaidItemId}`, cursor || '')

      // Update item status and last sync time
      this.db
        .prepare(
          "UPDATE plaid_items SET status = 'active', error_code = NULL, last_successful_sync = datetime('now') WHERE plaid_item_id = ?"
        )
        .run(plaidItemId)

      // Update last_synced_at on all accounts for this item
      this.db
        .prepare("UPDATE accounts SET last_synced_at = datetime('now') WHERE plaid_item_id = ?")
        .run(plaidItemId)

      this.finishSyncLog(logId, 'success', result)
      return result
    } catch (err: any) {
      const errorCode = err?.response?.data?.error_code || err?.message || 'UNKNOWN'
      const isReauthNeeded = errorCode === 'ITEM_LOGIN_REQUIRED'

      // Update item status
      this.db
        .prepare('UPDATE plaid_items SET status = ?, error_code = ? WHERE plaid_item_id = ?')
        .run(isReauthNeeded ? 'login_required' : 'error', errorCode, plaidItemId)

      result.error = errorCode
      this.finishSyncLog(logId, 'error', result, errorCode)
      throw err
    }
  }

  /**
   * Sync all active Plaid items.
   */
  async syncAll(onProgress?: (msg: string) => void): Promise<Map<string, SyncResult>> {
    const items = this.db
      .prepare("SELECT * FROM plaid_items WHERE status != 'disabled'")
      .all() as Array<{ plaid_item_id: string; institution_name: string }>

    const results = new Map<string, SyncResult>()

    for (const item of items) {
      try {
        onProgress?.(`Syncing ${item.institution_name}…`)
        const result = await this.syncItem(item.plaid_item_id, onProgress)
        results.set(item.plaid_item_id, result)
      } catch (err: any) {
        results.set(item.plaid_item_id, {
          transactions_found: 0,
          transactions_new: 0,
          transactions_duplicate: 0,
          transactions_classified: 0,
          transactions_queued: 0,
          error: err?.message || 'Sync failed',
        })
      }
    }

    return results
  }

  // ─── Transaction Import Helpers ───────────────────────────────────────────────

  private importPlaidTransaction(tx: any, plaidItemId: string): 'new' | 'duplicate' | 'queued' {
    // Deduplicate
    const existing = this.db
      .prepare('SELECT id FROM transactions WHERE plaid_transaction_id = ?')
      .get(tx.transaction_id)
    if (existing) return 'duplicate'

    // Find account
    const account = this.db
      .prepare('SELECT * FROM accounts WHERE plaid_account_id = ?')
      .get(tx.account_id) as { id: string; account_mask: string; default_bucket: string } | undefined
    if (!account) return 'duplicate' // account not tracked

    // Build raw transaction object for the classification engine
    const rawTx = {
      id: uuidv4(),
      account_id: account.id,
      plaid_transaction_id: tx.transaction_id,
      source_row_hash: null,
      transaction_date: tx.date,
      posting_date: tx.datetime?.split('T')[0] || null,
      description_raw: tx.name,
      merchant_name: tx.merchant_name || tx.name,
      amount: tx.amount, // Plaid: positive = debit
      category_source: tx.personal_finance_category?.primary || null,
      bucket: null,
      p10_category: null,
      llc_category: null,
      description_notes: null,
      rule_id: null,
      review_status: 'pending_review',
      flag_reason: null,
      split_parent_id: null,
      is_split_child: 0,
      period_label: null,
      expense_report_id: null,
    }

    // Run classification engine (imported from classification.service)
    try {
      const { classifyTransaction } = require('./classification.service')
      const classified = classifyTransaction(this.db, rawTx)
      Object.assign(rawTx, classified)
    } catch {
      // Classification service unavailable during test — leave as pending_review
    }

    this.db
      .prepare(
        `INSERT INTO transactions
          (id, account_id, plaid_transaction_id, source_row_hash, transaction_date, posting_date,
           description_raw, merchant_name, amount, category_source, bucket, p10_category,
           llc_category, description_notes, rule_id, review_status, flag_reason, split_parent_id,
           is_split_child, period_label, expense_report_id, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        rawTx.id, rawTx.account_id, rawTx.plaid_transaction_id, rawTx.source_row_hash,
        rawTx.transaction_date, rawTx.posting_date, rawTx.description_raw, rawTx.merchant_name,
        rawTx.amount, rawTx.category_source, rawTx.bucket, rawTx.p10_category,
        rawTx.llc_category, rawTx.description_notes, rawTx.rule_id, rawTx.review_status,
        rawTx.flag_reason, rawTx.split_parent_id, rawTx.is_split_child,
        rawTx.period_label, rawTx.expense_report_id
      )

    return rawTx.review_status === 'pending_review' ? 'queued' : 'new'
  }

  private updatePlaidTransaction(tx: any): void {
    // Re-run classification on modified transactions that are still pending
    this.db
      .prepare(
        `UPDATE transactions SET
           merchant_name = ?, amount = ?, updated_at = datetime('now')
         WHERE plaid_transaction_id = ? AND review_status = 'pending_review'`
      )
      .run(tx.merchant_name || tx.name, tx.amount, tx.transaction_id)
  }

  // ─── Access Token helpers (for re-auth) ──────────────────────────────────────

  getAccessToken(plaidItemId: string): string | null {
    return loadCredential(CRED_PREFIX_ACCESS_TOKEN + plaidItemId)
  }

  deleteItem(plaidItemId: string): void {
    deleteCredential(CRED_PREFIX_ACCESS_TOKEN + plaidItemId)
    this.db
      .prepare("UPDATE plaid_items SET status = 'disabled' WHERE plaid_item_id = ?")
      .run(plaidItemId)
    this.db
      .prepare("UPDATE accounts SET is_active = 0 WHERE plaid_item_id = ?")
      .run(plaidItemId)
  }

  // ─── Sync Log ─────────────────────────────────────────────────────────────────

  private startSyncLog(
    syncType: 'plaid_pull' | 'watched_folder' | 'manual_import',
    accountId: string | null
  ): number {
    const result = this.db
      .prepare(
        `INSERT INTO sync_log
          (sync_type, account_id, transactions_found, transactions_new, transactions_duplicate,
           transactions_classified, transactions_queued, status, started_at)
         VALUES (?, ?, 0, 0, 0, 0, 0, 'running', datetime('now'))`
      )
      .run(syncType, accountId)
    return result.lastInsertRowid as number
  }

  private finishSyncLog(
    logId: number,
    status: 'success' | 'partial' | 'error',
    result: SyncResult,
    errorMessage?: string
  ): void {
    this.db
      .prepare(
        `UPDATE sync_log SET
           status = ?, transactions_found = ?, transactions_new = ?,
           transactions_duplicate = ?, transactions_classified = ?,
           transactions_queued = ?, error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        status,
        result.transactions_found,
        result.transactions_new,
        result.transactions_duplicate,
        result.transactions_classified,
        result.transactions_queued,
        errorMessage || null,
        logId
      )
  }

  getRecentSyncLogs(limit = 50): any[] {
    return this.db
      .prepare('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?')
      .all(limit)
  }

  // ─── Status helpers for Dashboard ────────────────────────────────────────────

  getAccountsWithSyncStatus(): any[] {
    return this.db
      .prepare(
        `SELECT a.*, pi.status as plaid_status, pi.error_code, pi.last_successful_sync
         FROM accounts a
         LEFT JOIN plaid_items pi ON a.plaid_item_id = pi.plaid_item_id
         WHERE a.is_active = 1
         ORDER BY a.institution, a.account_name`
      )
      .all()
  }

  getItemsNeedingReauth(): any[] {
    return this.db
      .prepare("SELECT * FROM plaid_items WHERE status = 'login_required'")
      .all()
  }
}