import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      plaid_item_id TEXT,
      plaid_account_id TEXT,
      institution TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_mask TEXT NOT NULL,
      account_type TEXT NOT NULL,
      entity TEXT NOT NULL,
      default_bucket TEXT NOT NULL,
      import_method TEXT NOT NULL DEFAULT 'plaid',
      watched_folder_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS plaid_items (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      plaid_item_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      error_code TEXT,
      consent_expiry TEXT,
      last_successful_sync TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      plaid_transaction_id TEXT,
      source_row_hash TEXT,
      transaction_date TEXT NOT NULL,
      posting_date TEXT,
      description_raw TEXT NOT NULL,
      merchant_name TEXT,
      amount REAL NOT NULL,
      category_source TEXT,
      bucket TEXT,
      p10_category TEXT,
      llc_category TEXT,
      description_notes TEXT,
      rule_id TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      flag_reason TEXT,
      split_parent_id TEXT,
      is_split_child INTEGER NOT NULL DEFAULT 0,
      period_label TEXT,
      expense_report_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(transaction_date);
    CREATE INDEX IF NOT EXISTS idx_tx_bucket ON transactions(bucket);
    CREATE INDEX IF NOT EXISTS idx_tx_review ON transactions(review_status);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_plaid_id ON transactions(plaid_transaction_id) WHERE plaid_transaction_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_hash ON transactions(source_row_hash) WHERE source_row_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      rule_name TEXT NOT NULL,
      section TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'contains',
      match_value TEXT NOT NULL,
      account_mask_filter TEXT,
      amount_min REAL,
      amount_max REAL,
      day_of_week_filter TEXT,
      date_from_filter TEXT,
      date_to_filter TEXT,
      bucket TEXT,
      p10_category TEXT,
      llc_category TEXT,
      description_notes TEXT,
      flag_reason TEXT,
      action TEXT NOT NULL DEFAULT 'classify',
      priority_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority_order) WHERE is_active = 1;

    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      raw_name TEXT UNIQUE NOT NULL,
      canonical_name TEXT NOT NULL,
      rule_id TEXT,
      times_seen INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL,
      is_known INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS investments (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      plaid_investment_transaction_id TEXT,
      record_type TEXT NOT NULL,
      security_name TEXT,
      ticker TEXT,
      quantity REAL,
      price REAL,
      market_value REAL,
      cost_basis REAL,
      transaction_type TEXT,
      transaction_amount REAL,
      transaction_date TEXT,
      snapshot_date TEXT,
      currency TEXT NOT NULL DEFAULT 'USD',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_inv_account ON investments(account_id);
    CREATE INDEX IF NOT EXISTS idx_inv_snapshot ON investments(snapshot_date);

    CREATE TABLE IF NOT EXISTS expense_reports (
      id TEXT PRIMARY KEY,
      report_period TEXT NOT NULL,
      date_generated TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      total_amount REAL NOT NULL,
      transaction_count INTEGER NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_trip_dates (
      id TEXT PRIMARY KEY,
      trip_name TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      account_id TEXT,
      source_file TEXT,
      transactions_found INTEGER NOT NULL DEFAULT 0,
      transactions_new INTEGER NOT NULL DEFAULT 0,
      transactions_duplicate INTEGER NOT NULL DEFAULT 0,
      transactions_classified INTEGER NOT NULL DEFAULT 0,
      transactions_queued INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

export function seedDefaultSettings(db: Database.Database): void {
  const defaults: Record<string, string> = {
    notification_email: '',
    auto_sync_enabled: '1',
    auto_sync_cron: '0 2 * * *',
    review_email_threshold: '1',
    last_backup_date: '',
    expense_report_period_label: 'December 2025 – February 2026',
    peak10_already_reimbursed_through: '2025-11-30'
  }
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(defaults)) {
    upsert.run(k, v)
  }
}

export function seedPersonalTripDates(db: Database.Database): void {
  const exists = db.prepare('SELECT COUNT(*) as c FROM personal_trip_dates').get() as { c: number }
  if (exists.c > 0) return
  db.prepare('INSERT OR IGNORE INTO personal_trip_dates (id, trip_name, date_from, date_to) VALUES (?,?,?,?)')
    .run('trip-nyc-2025', 'NYC Trip', '2025-11-24', '2025-11-28')
}

export function seedDefaultActionItems(db: Database.Database): void {
  const exists = db.prepare('SELECT COUNT(*) as c FROM action_items').get() as { c: number }
  if (exists.c > 0) return
  const items = [
    { id: 'ai-att-dec', text: 'AT&T Dec 26, 2025 ($478.91) — pull 832-687-0468 line cost from att.com/billdetail and split' },
    { id: 'ai-att-jan', text: 'AT&T Jan 20, 2026 ($478.20) — pull 832-687-0468 line cost from att.com/billdetail and split' },
    { id: 'ai-att-feb', text: 'AT&T Feb 20, 2026 ($463.73) — pull 832-687-0468 line cost from att.com/billdetail and split' },
    { id: 'ai-bari-jan', text: 'Bari Houston Jan 6, 2026 ($955.63) — add attendee names before submitting expense report' },
    { id: 'ai-apple-card', text: 'Link Apple Card to app via watched folder (export from wallet.apple.com to imports/apple_card/)' },
    { id: 'ai-att-separate', text: 'Long-term: request AT&T to bill business line 832-687-0468 separately' }
  ]
  const ins = db.prepare('INSERT OR IGNORE INTO action_items (id, text) VALUES (?, ?)')
  for (const item of items) ins.run(item.id, item.text)
}
