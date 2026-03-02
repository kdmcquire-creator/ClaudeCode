import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid'
import { safeStorage } from 'electron'
import { getDb } from '../db/index'
let plaidClient: PlaidApi | null = null

export interface PlaidCredentials {
  clientId: string
  secret: string
  env: 'sandbox' | 'development' | 'production'
}

// ── Credential storage (Windows DPAPI via electron.safeStorage) ──────
export function storePlaidCredentials(creds: PlaidCredentials): void {
  const data = JSON.stringify(creds)
  const encrypted = safeStorage.encryptString(data)
  const { app } = require('electron')
  const fs = require('fs')
  const path = require('path')
  const credsPath = path.join(app.getPath('userData'), 'plaid_creds.enc')
  fs.writeFileSync(credsPath, encrypted)
}

export function loadPlaidCredentials(): PlaidCredentials | null {
  try {
    const { app } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const credsPath = path.join(app.getPath('userData'), 'plaid_creds.enc')
    if (!fs.existsSync(credsPath)) return null
    const encrypted = fs.readFileSync(credsPath)
    const data = safeStorage.decryptString(encrypted)
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function initPlaidClient(creds: PlaidCredentials): void {
  const config = new Configuration({
    basePath: PlaidEnvironments[creds.env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': creds.clientId,
        'PLAID-SECRET': creds.secret
      }
    }
  })
  plaidClient = new PlaidApi(config)
}

export function getPlaidClient(): PlaidApi {
  if (!plaidClient) {
    const creds = loadPlaidCredentials()
    if (!creds) throw new Error('Plaid not configured. Run setup first.')
    initPlaidClient(creds)
  }
  return plaidClient!
}

// ── Access token storage per item ────────────────────────────────────
export function storeAccessToken(itemId: string, token: string): void {
  const { app } = require('electron')
  const fs = require('fs')
  const path = require('path')
  const encrypted = safeStorage.encryptString(token)
  const tokenPath = path.join(app.getPath('userData'), `token_${itemId}.enc`)
  fs.writeFileSync(tokenPath, encrypted)
}

export function loadAccessToken(itemId: string): string | null {
  try {
    const { app } = require('electron')
    const fs = require('fs')
    const path = require('path')
    const tokenPath = path.join(app.getPath('userData'), `token_${itemId}.enc`)
    if (!fs.existsSync(tokenPath)) return null
    const encrypted = fs.readFileSync(tokenPath)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

// ── Link token creation ───────────────────────────────────────────────
export async function createLinkToken(userId: string = 'kyle-mcquire'): Promise<string> {
  const client = getPlaidClient()
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'McQuire Tracker',
    products: [Products.Transactions, Products.Investments],
    country_codes: [CountryCode.Us],
    language: 'en',
  })
  return response.data.link_token
}

// ── Exchange public token ─────────────────────────────────────────────
export async function exchangePublicToken(publicToken: string): Promise<{
  accessToken: string
  itemId: string
}> {
  const client = getPlaidClient()
  const response = await client.itemPublicTokenExchange({ public_token: publicToken })
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id
  }
}

// ── Fetch accounts for an item ────────────────────────────────────────
export async function fetchAccountsForItem(accessToken: string): Promise<Array<{
  account_id: string
  name: string
  mask: string | null
  type: string
  subtype: string | null
}>> {
  const client = getPlaidClient()
  const response = await client.accountsGet({ access_token: accessToken })
  return response.data.accounts.map(a => ({
    account_id: a.account_id,
    name: a.name,
    mask: a.mask ?? null,
    type: a.type,
    subtype: a.subtype ?? null
  }))
}

// ── Sync transactions ─────────────────────────────────────────────────
export interface PlaidTransaction {
  plaid_transaction_id: string
  account_id: string
  date: string
  authorized_date: string | null
  name: string
  merchant_name: string | null
  amount: number
  category: string[] | null
  pending: boolean
}

export async function syncTransactions(plaidItemId: string): Promise<{
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removed: string[]
  cursor: string
}> {
  const db = getDb()
  const client = getPlaidClient()

  const item = db.prepare('SELECT * FROM plaid_items WHERE plaid_item_id = ?').get(plaidItemId) as
    { id: string; plaid_item_id: string } | undefined
  if (!item) throw new Error(`Plaid item not found: ${plaidItemId}`)

  const accessToken = loadAccessToken(item.id)
  if (!accessToken) throw new Error('Access token not found for this item')

  const cursorKey = `plaid_cursor_${item.id}`
  const { getSetting, setSetting } = require('../db/index')
  const cursor = getSetting(cursorKey) || undefined

  const added: PlaidTransaction[] = []
  const modified: PlaidTransaction[] = []
  const removed: string[] = []
  let nextCursor = cursor

  let hasMore = true
  while (hasMore) {
    const resp = await client.transactionsSync({
      access_token: accessToken,
      cursor: nextCursor
    })
    const data = resp.data

    for (const tx of data.added) {
      added.push({
        plaid_transaction_id: tx.transaction_id,
        account_id: tx.account_id,
        date: tx.date,
        authorized_date: tx.authorized_date ?? null,
        name: tx.name,
        merchant_name: tx.merchant_name ?? null,
        amount: tx.amount,
        category: tx.category ?? null,
        pending: tx.pending
      })
    }
    for (const tx of data.modified) {
      modified.push({
        plaid_transaction_id: tx.transaction_id,
        account_id: tx.account_id,
        date: tx.date,
        authorized_date: tx.authorized_date ?? null,
        name: tx.name,
        merchant_name: tx.merchant_name ?? null,
        amount: tx.amount,
        category: tx.category ?? null,
        pending: tx.pending
      })
    }
    for (const tx of data.removed) removed.push(tx.transaction_id)

    nextCursor = data.next_cursor
    hasMore = data.has_more
  }

  if (nextCursor) setSetting(cursorKey, nextCursor)
  return { added, modified, removed, cursor: nextCursor || '' }
}

// ── Investment data ───────────────────────────────────────────────────
export async function fetchInvestmentHoldings(plaidItemId: string): Promise<any[]> {
  const db = getDb()
  const item = db.prepare('SELECT id FROM plaid_items WHERE plaid_item_id = ?').get(plaidItemId) as { id: string } | undefined
  if (!item) return []
  const accessToken = loadAccessToken(item.id)
  if (!accessToken) return []

  const client = getPlaidClient()
  const resp = await client.investmentsHoldingsGet({ access_token: accessToken })
  return resp.data.holdings
}

export async function fetchInvestmentTransactions(plaidItemId: string, startDate: string, endDate: string): Promise<any[]> {
  const db = getDb()
  const item = db.prepare('SELECT id FROM plaid_items WHERE plaid_item_id = ?').get(plaidItemId) as { id: string } | undefined
  if (!item) return []
  const accessToken = loadAccessToken(item.id)
  if (!accessToken) return []

  const client = getPlaidClient()
  const resp = await client.investmentsTransactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate
  })
  return resp.data.investment_transactions
}
