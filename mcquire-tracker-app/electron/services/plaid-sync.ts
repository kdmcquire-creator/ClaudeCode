import { getDb, getSetting } from '../db/index'
import { syncTransactions, fetchInvestmentHoldings, fetchInvestmentTransactions } from './plaid-service'
import { classifyAndSave } from './classification-engine'
import { sendNotification } from './email-service'
import { v4 as uuidv4 } from 'uuid'
import type { Transaction } from '../../src/shared/types'

export async function syncAllPlaidAccounts(): Promise<{ success: number; errors: number }> {
  const db = getDb()
  const items = db.prepare("SELECT * FROM plaid_items WHERE status != 'error'").all() as any[]

  let success = 0, errors = 0

  for (const item of items) {
    try {
      await syncPlaidItem(item.plaid_item_id, item.institution_name)
      db.prepare("UPDATE plaid_items SET status='active', last_successful_sync=datetime('now') WHERE plaid_item_id=?").run(item.plaid_item_id)
      success++
    } catch (err: any) {
      errors++
      const errorCode = err?.response?.data?.error_code || 'UNKNOWN'
      const isLoginRequired = errorCode === 'ITEM_LOGIN_REQUIRED'
      db.prepare("UPDATE plaid_items SET status=?, error_code=? WHERE plaid_item_id=?")
        .run(isLoginRequired ? 'login_required' : 'error', errorCode, item.plaid_item_id)

      await sendNotification(
        isLoginRequired ? 'reauth_required' : 'sync_error',
        { institution: item.institution_name, error: err.message }
      )
      console.error(`[PlaidSync] Error syncing ${item.institution_name}:`, err.message)
    }
  }

  return { success, errors }
}

async function syncPlaidItem(plaidItemId: string, institutionName: string): Promise<void> {
  const db = getDb()
  const { added, modified, removed } = await syncTransactions(plaidItemId)

  const started = new Date().toISOString()
  let newCount = 0, dupes = 0, classified = 0, queued = 0

  // Get account map
  const accountMap = new Map<string, { db_id: string; mask: string }>()
  const accounts = db.prepare("SELECT id, plaid_account_id, account_mask FROM accounts WHERE plaid_item_id IN (SELECT id FROM plaid_items WHERE plaid_item_id=?)").all(plaidItemId) as any[]
  for (const a of accounts) accountMap.set(a.plaid_account_id, { db_id: a.id, mask: a.account_mask })

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (id, account_id, plaid_transaction_id, transaction_date, posting_date, description_raw, merchant_name, amount, category_source, review_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,'','pending_review',datetime('now'),datetime('now'))
  `)

  const insertedIds: Array<{ id: string; description_raw: string; amount: number; transaction_date: string; account_mask: string }> = []

  db.transaction(() => {
    for (const tx of added) {
      if (tx.pending) continue // Skip pending transactions
      const account = accountMap.get(tx.account_id)
      if (!account) continue

      const result = insertTx.run(
        uuidv4(), account.db_id, tx.plaid_transaction_id,
        tx.date, tx.authorized_date,
        tx.name, tx.merchant_name, tx.amount, tx.category?.join(', ') ?? null
      )
      if (result.changes > 0) {
        newCount++
        insertedIds.push({ id: '', description_raw: tx.name, amount: tx.amount, transaction_date: tx.date, account_mask: account.mask })
      } else dupes++
    }

    // Modified transactions — update amount and merchant
    for (const tx of modified) {
      db.prepare("UPDATE transactions SET amount=?, merchant_name=?, updated_at=datetime('now') WHERE plaid_transaction_id=?")
        .run(tx.amount, tx.merchant_name, tx.plaid_transaction_id)
    }

    // Removed transactions — mark as excluded
    for (const txId of removed) {
      db.prepare("UPDATE transactions SET bucket='Exclude', review_status='auto_classified', updated_at=datetime('now') WHERE plaid_transaction_id=?")
        .run(txId)
    }
  })()

  // Re-fetch inserted IDs (need actual db IDs)
  if (newCount > 0) {
    const freshIds = db.prepare(`
      SELECT t.id, t.description_raw, t.amount, t.transaction_date, a.account_mask
      FROM transactions t JOIN accounts a ON a.id=t.account_id
      WHERE t.review_status='pending_review' AND t.account_id IN (SELECT id FROM accounts WHERE plaid_item_id IN (SELECT id FROM plaid_items WHERE plaid_item_id=?))
      ORDER BY t.created_at DESC LIMIT ?
    `).all(plaidItemId, newCount) as any[]

    const result = classifyAndSave(freshIds)
    classified = result.classified
    queued = result.queued
  }

  // Log
  db.prepare(`INSERT INTO sync_log (sync_type, account_id, transactions_found, transactions_new, transactions_duplicate, transactions_classified, transactions_queued, status, started_at, completed_at) VALUES ('plaid_pull',?,?,?,?,?,?,'success',?,datetime('now'))`)
    .run(null, added.length, newCount, dupes, classified, queued, started)

  // Notify
  if (queued > 0) {
    const pending = db.prepare(`
      SELECT t.transaction_date as date, t.merchant_name as merchant, t.amount, a.account_name as account
      FROM transactions t JOIN accounts a ON a.id=t.account_id
      WHERE t.review_status='pending_review' ORDER BY t.transaction_date DESC LIMIT 20
    `).all() as any[]
    await sendNotification('review_pending', { count: queued, transactions: pending })
  }

  console.log(`[PlaidSync] ${institutionName}: +${newCount} new, ${dupes} dupes, ${classified} classified, ${queued} queued`)
}

export async function syncInvestments(): Promise<void> {
  const db = getDb()
  const investmentItems = db.prepare(`
    SELECT pi.* FROM plaid_items pi
    JOIN accounts a ON a.plaid_item_id = pi.id
    WHERE a.account_type IN ('investment','brokerage') AND pi.status='active'
    GROUP BY pi.id
  `).all() as any[]

  for (const item of investmentItems) {
    try {
      const holdings = await fetchInvestmentHoldings(item.plaid_item_id)
      const today = new Date().toISOString().substring(0, 10)

      const insertHolding = db.prepare(`
        INSERT INTO investments (id, account_id, record_type, security_name, ticker, quantity, price, market_value, cost_basis, snapshot_date, created_at)
        VALUES (?,?,\'holding\',?,?,?,?,?,?,?,datetime(\'now\'))
      `)

      db.transaction(() => {
        for (const h of holdings) {
          const account = db.prepare("SELECT id FROM accounts WHERE plaid_account_id=?").get(h.account_id) as { id: string } | undefined
          if (!account) continue
          insertHolding.run(
            uuidv4(), account.id,
            h.security?.name ?? 'Unknown', h.security?.ticker_symbol ?? null,
            h.quantity, h.institution_price, h.institution_value, h.cost_basis, today
          )
        }
      })()

      console.log(`[Investments] Synced ${holdings.length} holdings for ${item.institution_name}`)
    } catch (err: any) {
      console.error(`[Investments] Error syncing ${item.institution_name}:`, err.message)
    }
  }
}
