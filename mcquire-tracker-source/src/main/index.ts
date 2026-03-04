// src/main/index.ts
// McQuire Financial Tracker — Electron Main Process
// All four phases wired: Phase 1 (core) + Phase 2 (Plaid) + Phase 3 (Investments) + Phase 4 (Polish)

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import * as path from 'path'
import * as fs from 'fs'
import Database from 'better-sqlite3'

// ── Phase 2: Plaid sync ───────────────────────────────────────────────────────
import { PlaidService } from '../../electron/services/plaid.service'
import { SyncScheduler } from '../../electron/services/sync-scheduler.service'
import { registerPlaidIpcHandlers } from '../../electron/services/plaid-ipc'

// ── Phase 3: Investment tracking ──────────────────────────────────────────────
import { PlaidInvestmentsService } from '../../electron/services/plaid-investments.service'
import { registerInvestmentsIpcHandlers } from '../../electron/services/investments-ipc'

// ── Phase 4: Financial statements, import wizard, lifecycle ───────────────────
import { registerFinancialStatementsHandlers } from '../../electron/services/financial-statements-ipc'
import { registerHistoricalImportHandlers } from '../../electron/services/historical-import.service'
import { AppLifecycleService } from '../../electron/services/app-lifecycle.service'
import { reclassifyPendingAfterRuleChange } from '../../electron/services/classification-engine'

// ─────────────────────────────────────────────────────────────────────────────
// Protocol registration (must happen before app.whenReady)
// ─────────────────────────────────────────────────────────────────────────────
app.setAsDefaultProtocolClient('mcquire-tracker')

// ─────────────────────────────────────────────────────────────────────────────
// App state
// ─────────────────────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let db: Database.Database | null = null
let syncFolderPath: string = ''

// ─────────────────────────────────────────────────────────────────────────────
// Sync folder path — loaded from userData config, or set during setup wizard
// ─────────────────────────────────────────────────────────────────────────────
function loadSyncFolderPath(): string {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      return config.syncFolder || ''
    } catch {
      return ''
    }
  }
  return ''
}

function saveSyncFolderPath(folder: string): void {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({ syncFolder: folder }, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Database initialization
// Creates all tables, sets WAL mode, seeds classification rules on first run.
// ─────────────────────────────────────────────────────────────────────────────
function initDatabase(folder: string): Database.Database {
  const dbDir = path.join(folder, 'db')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'mcquire.db')

  const database = new Database(dbPath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')

  database.exec(`
    -- Accounts
    CREATE TABLE IF NOT EXISTS accounts (
      id                  TEXT PRIMARY KEY,
      plaid_item_id       TEXT NULL,
      plaid_account_id    TEXT NULL,
      institution         TEXT NOT NULL,
      account_name        TEXT NOT NULL,
      account_mask        TEXT NOT NULL,
      account_type        TEXT NOT NULL,
      entity              TEXT NOT NULL,
      default_bucket      TEXT NOT NULL,
      import_method       TEXT NOT NULL DEFAULT 'watched_folder',
      watched_folder_path TEXT NULL,
      is_active           INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      last_synced_at      TEXT NULL,
      notes               TEXT NULL
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id                    TEXT PRIMARY KEY,
      account_id            TEXT NOT NULL REFERENCES accounts(id),
      plaid_transaction_id  TEXT NULL UNIQUE,
      source_row_hash       TEXT NULL UNIQUE,
      transaction_date      TEXT NOT NULL,
      posting_date          TEXT NULL,
      description_raw       TEXT NOT NULL DEFAULT '',
      merchant_name         TEXT NULL,
      amount                REAL NOT NULL,
      category_source       TEXT NULL,
      bucket                TEXT NULL,
      p10_category          TEXT NULL,
      llc_category          TEXT NULL,
      description_notes     TEXT NULL,
      rule_id               TEXT NULL,
      review_status         TEXT NOT NULL DEFAULT 'pending_review',
      flag_reason           TEXT NULL,
      split_parent_id       TEXT NULL,
      is_split_child        INTEGER NOT NULL DEFAULT 0,
      period_label          TEXT NULL,
      expense_report_id     TEXT NULL,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Classification rules
    CREATE TABLE IF NOT EXISTS rules (
      id                  TEXT PRIMARY KEY,
      rule_name           TEXT NOT NULL,
      section             TEXT NOT NULL,
      match_type          TEXT NOT NULL DEFAULT 'contains',
      match_value         TEXT NOT NULL,
      account_mask_filter TEXT NULL,
      amount_min          REAL NULL,
      amount_max          REAL NULL,
      day_of_week_filter  TEXT NULL,
      date_from_filter    TEXT NULL,
      date_to_filter      TEXT NULL,
      bucket              TEXT NOT NULL,
      p10_category        TEXT NULL,
      llc_category        TEXT NULL,
      description_notes   TEXT NULL,
      flag_reason         TEXT NULL,
      action              TEXT NOT NULL DEFAULT 'classify',
      priority_order      INTEGER NOT NULL,
      is_active           INTEGER NOT NULL DEFAULT 1,
      notes               TEXT NULL,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority_order) WHERE is_active = 1;

    -- Vendors (merchant normalization)
    CREATE TABLE IF NOT EXISTS vendors (
      id             TEXT PRIMARY KEY,
      raw_name       TEXT NOT NULL UNIQUE,
      canonical_name TEXT NOT NULL,
      rule_id        TEXT NULL,
      times_seen     INTEGER NOT NULL DEFAULT 1,
      last_seen      TEXT NOT NULL,
      is_known       INTEGER NOT NULL DEFAULT 0
    );

    -- Investments
    CREATE TABLE IF NOT EXISTS investments (
      id                                TEXT PRIMARY KEY,
      account_id                        TEXT NOT NULL REFERENCES accounts(id),
      plaid_investment_transaction_id   TEXT NULL UNIQUE,
      record_type                       TEXT NOT NULL,
      security_name                     TEXT NULL,
      ticker                            TEXT NULL,
      quantity                          REAL NULL,
      price                             REAL NULL,
      market_value                      REAL NULL,
      cost_basis                        REAL NULL,
      transaction_type                  TEXT NULL,
      transaction_amount                REAL NULL,
      transaction_date                  TEXT NULL,
      snapshot_date                     TEXT NULL,
      currency                          TEXT NOT NULL DEFAULT 'USD',
      created_at                        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Expense reports
    CREATE TABLE IF NOT EXISTS expense_reports (
      id                TEXT PRIMARY KEY,
      report_period     TEXT NOT NULL,
      date_generated    TEXT NOT NULL,
      file_path         TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'draft',
      total_amount      REAL NOT NULL DEFAULT 0,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      notes             TEXT NULL
    );

    -- Plaid items (one per institution connection)
    CREATE TABLE IF NOT EXISTS plaid_items (
      id                   TEXT PRIMARY KEY,
      institution_id       TEXT NOT NULL,
      institution_name     TEXT NOT NULL,
      plaid_item_id        TEXT NOT NULL UNIQUE,
      status               TEXT NOT NULL DEFAULT 'active',
      error_code           TEXT NULL,
      consent_expiry       TEXT NULL,
      last_successful_sync TEXT NULL,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sync log
    CREATE TABLE IF NOT EXISTS sync_log (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type               TEXT NOT NULL,
      account_id              TEXT NULL,
      source_file             TEXT NULL,
      transactions_found      INTEGER NOT NULL DEFAULT 0,
      transactions_new        INTEGER NOT NULL DEFAULT 0,
      transactions_duplicate  INTEGER NOT NULL DEFAULT 0,
      transactions_classified INTEGER NOT NULL DEFAULT 0,
      transactions_queued     INTEGER NOT NULL DEFAULT 0,
      status                  TEXT NOT NULL DEFAULT 'success',
      error_message           TEXT NULL,
      started_at              TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at            TEXT NULL
    );

    -- Personal trip exclusion dates (for Mon-Thu restaurant rule)
    CREATE TABLE IF NOT EXISTS personal_trip_dates (
      id         TEXT PRIMARY KEY,
      trip_name  TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date   TEXT NOT NULL
    );

    -- Settings (key-value)
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Migration tracking
    CREATE TABLE IF NOT EXISTS migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Seed default settings
  const insertSetting = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  )
  insertSetting.run('plaid_env', 'development')
  insertSetting.run('auto_sync_enabled', '1')
  insertSetting.run('auto_sync_cron', '0 2 * * *')
  insertSetting.run('review_email_threshold', '1')
  insertSetting.run('peak10_already_reimbursed_through', '2025-11-30')

  // Seed NYC personal trip exclusion
  database.prepare(
    `INSERT OR IGNORE INTO personal_trip_dates (id, trip_name, start_date, end_date)
     VALUES ('nyc-nov-2025', 'NYC Trip (Personal)', '2025-11-24', '2025-11-28')`
  ).run()

  // Seed all classification rules (from workflow doc Section 4)
  seedClassificationRules(database)

  // Run one-time data migrations
  runMigrations(database)

  return database
}

// ─────────────────────────────────────────────────────────────────────────────
// One-time migrations — safe to run on every startup (INSERT OR IGNORE guards)
// ─────────────────────────────────────────────────────────────────────────────
function runMigrations(database: Database.Database): void {
  const applied = (id: string) =>
    !!database.prepare('SELECT id FROM migrations WHERE id = ?').get(id)

  // Migration 001: fix conditional restaurant rule match_value
  if (!applied('001-conditional-restaurant-fix')) {
    database
      .prepare("UPDATE rules SET match_value = 'conditional_restaurant' WHERE id = 'p10-cond-001' AND match_value = 'restaurant'")
      .run()
    database.prepare("INSERT OR IGNORE INTO migrations (id) VALUES (?)").run('001-conditional-restaurant-fix')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed classification rules (all rules from the workflow document)
// Uses INSERT OR IGNORE so re-runs are safe.
// ─────────────────────────────────────────────────────────────────────────────
function seedClassificationRules(database: Database.Database): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO rules
      (id, rule_name, section, match_type, match_value, account_mask_filter,
       amount_min, amount_max, day_of_week_filter, date_from_filter, date_to_filter,
       bucket, p10_category, llc_category, description_notes, flag_reason, action, priority_order, notes)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const seed = database.transaction((rules: any[]) => {
    for (const r of rules) insert.run(...r)
  })

  seed([
    // ── Exclusions (100–199) ─────────────────────────────────────────────────
    ['excl-001','CC Payment Exclude','exclusion','contains','credit card payment',null,null,null,null,null,null,'Exclude',null,null,null,null,'exclude',100,''],
    ['excl-002','Transfer Exclude','exclusion','contains','transfer',null,null,null,null,null,null,'Exclude',null,null,null,null,'exclude',101,''],
    ['excl-003','Apple Card Payment Exclude','exclusion','contains','apple card payment',null,null,null,null,null,null,'Exclude',null,null,null,null,'exclude',102,''],
    ['excl-004','Payment Category Exclude','exclusion','contains','payment',null,null,null,null,null,null,'Exclude',null,null,null,null,'exclude',103,''],

    // ── LLC Always (200–299) ─────────────────────────────────────────────────
    ['llc-001','Gexa Energy','llc_always','contains','gexa energy',null,null,null,null,null,null,'Moonsmoke LLC',null,'Utilities - Home Office',null,null,'classify',200,'Houston apt electricity'],
    ['llc-002','Bilt Rent','llc_always','contains','bilt',null,null,null,null,null,null,'Moonsmoke LLC',null,'Rent - Business Lodging',null,null,'classify',201,'Houston apt rent while working away from Austin'],
    ['llc-003','Bowen River Oak','llc_always','contains','bowen river',null,null,null,null,null,null,'Moonsmoke LLC',null,'Lodging - Business Housing',null,null,'classify',202,''],
    ['llc-004','Nickson','llc_always','contains','nickson',null,null,null,null,null,null,'Moonsmoke LLC',null,'Lodging - Business Housing',null,null,'classify',203,''],
    ['llc-005','Rvefit','llc_always','contains','rvefit',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',204,''],
    ['llc-006','TrueCoach','llc_always','contains','truecoach',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',205,'See backdating rule 4.6a'],
    ['llc-007','Lifetime Fitness','llc_always','contains','lifetime fitness',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',206,''],
    ['llc-008','LTFitness','llc_always','contains','ltfitness',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',207,''],
    ['llc-009','Clubcorp','llc_always','contains','clubcorp',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',208,'Country club executive wellness'],
    ['llc-010','Patriot Software 2255','llc_always','contains','patriot software','2255',null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Payroll',null,null,'classify',209,'Monthly payroll processing fee'],
    ['llc-011','AT&T Business Line Small','llc_always','exact','at&t','5829',null,99.99,null,null,null,'Moonsmoke LLC',null,'Telephone - Business Line',null,null,'classify',210,'Supplemental line < $100'],
    ['llc-012','Backvac','llc_always','contains','backvac',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Expenses - Other',null,null,'classify',211,''],
    ['llc-013','Apple App Store','llc_always','contains','apple.com',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Software',null,null,'classify',212,'All Apple charges'],
    ['llc-014','App Store','llc_always','contains','app store',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Software',null,null,'classify',213,''],
    ['llc-015','Google One','llc_always','contains','google one',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Software',null,null,'classify',214,'Cloud storage — not Google Fiber'],
    ['llc-016','Microsoft','llc_always','contains','microsoft',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Software',null,null,'classify',215,'Microsoft 365'],
    ['llc-017','BeenVerified','llc_always','contains','beenverified',null,null,null,null,null,null,'Moonsmoke LLC',null,'Business Services - Other',null,null,'classify',216,''],
    ['llc-018','Chase Monthly Fee 2255','llc_always','contains','monthly service fee','2255',null,null,null,null,null,'Moonsmoke LLC',null,'Bank Fees',null,null,'classify',217,'Chase BUS 2255 monthly fee'],
    ['llc-019','Chase ATM Fee 2255','llc_always','contains','atm fee','2255',null,null,null,null,null,'Moonsmoke LLC',null,'Bank Fees',null,null,'classify',218,''],
    ['llc-020','Chase Wire Fee 2255','llc_always','contains','wire fee','2255',null,null,null,null,null,'Moonsmoke LLC',null,'Bank Fees',null,null,'classify',219,''],

    // ── P10 Always (300–399) ─────────────────────────────────────────────────
    ['p10-001','Park House Houston','p10_always','contains','park house',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',300,''],
    ['p10-002','Houston Club Parkhouse','p10_always','contains','houston club',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',301,''],
    ['p10-003','Briar Club Jan 2026+','p10_always','contains','briar club',null,null,null,null,'2026-01-01',null,'Peak 10','Meals & Meetings - external',null,null,'⚠️ Confirm split with Kyle','split_flag',302,'Split flag — ask Kyle for P10 vs personal allocation'],
    ['p10-004','P Fitness','p10_always','contains','p fitness',null,null,null,null,null,null,'Peak 10','Other - Executive Wellness',null,null,null,'classify',303,''],
    ['p10-005','CSC Service Works','p10_always','contains','csc service works',null,null,null,null,null,null,'Peak 10','Other - Executive Wellness',null,null,null,'classify',304,''],
    ['p10-006','Fjorn Consulting','p10_always','contains','fjorn',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,'Recruiting',null,'classify',305,''],
    ['p10-007','Hart Energy','p10_always','contains','hart energy',null,null,null,null,null,null,'Peak 10','Dues & Subscriptions',null,null,null,'classify',306,''],
    ['p10-008','Bari Houston','p10_always','contains','bari houston',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,'⚠️ Add attendee names','classify',307,''],
    ['p10-009','TST Bari','p10_always','contains','tst* bari',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,'⚠️ Add attendee names','classify',308,''],
    ['p10-010','Mexta','p10_always','contains','mexta',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',309,''],
    ['p10-011','Ducky McShweeney','p10_always','contains','ducky',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',310,''],
    ['p10-012','Melrose','p10_always','contains','melrose',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',311,''],
    ['p10-013','Topgolf','p10_always','contains','topgolf',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',312,''],
    ['p10-014','Texas Richmond Corp','p10_always','contains','texas richmond',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',313,''],
    ['p10-015','Adobe 5829','p10_always','contains','adobe','5829',null,null,null,null,null,'Peak 10','Office Supplies & Expenses',null,null,null,'classify',314,''],
    ['p10-016','Bloomberg','p10_always','contains','bloomberg',null,null,null,null,null,null,'Peak 10','Dues & Subscriptions',null,null,null,'classify',315,''],
    ['p10-017','Wall Street Journal','p10_always','contains','wall street journal',null,null,null,null,null,null,'Peak 10','Dues & Subscriptions',null,null,null,'classify',316,''],
    ['p10-018','Anthropic Claude','p10_always','contains','anthropic',null,null,null,null,null,null,'Peak 10','Office Supplies & Expenses',null,null,null,'classify',317,'Claude subscription'],
    ['p10-019','Alamo Rent-A-Car','p10_always','contains','alamo rent',null,null,null,null,null,null,'Peak 10','Travel',null,null,null,'classify',318,'Not Alamo Toll'],
    ['p10-020','Hilton Hotels 5829','p10_always','contains','hilton','5829',null,null,null,null,null,'Peak 10','Lodging',null,null,null,'classify',319,''],
    ['p10-021','Four Seasons 5829','p10_always','contains','four seasons','5829',null,null,null,null,null,'Peak 10','Lodging',null,null,null,'classify',320,''],
    ['p10-022','Four Points Boat 5829','p10_always','contains','four points boat','5829',null,null,null,null,null,'Peak 10','Travel',null,null,null,'classify',321,''],
    ['p10-023','Kasa Living','p10_always','contains','kasa living',null,null,null,null,null,null,'Peak 10','Lodging',null,null,null,'classify',322,''],
    ['p10-024','AT&T Work Line 5829','p10_always','exact','at&t','5829',100,299,null,null,null,'Peak 10','Telephone & Communication',null,'Work line ~$199',null,'classify',323,''],
    ['p10-025','AT&T Large Bill Split','p10_always','exact','at&t','5829',300,null,null,null,null,'Peak 10','Telephone & Communication',null,null,'⚠️ AT&T split required — pull 832-687-0468 line cost from att.com','split_flag',324,''],
    ['p10-026','Payrix Numero 28 Austin','p10_always','contains','numero 28 austin','5829',null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',325,''],
    ['p10-027','Annual Membership Sep 2025','p10_always','contains','annual membership fee','5829',299,299,null,'2025-09-01','2025-09-30','Peak 10','Dues & Subscriptions',null,null,null,'classify',326,''],
    ['p10-028','W 2nd Street Parking','p10_always','contains','2nd street parking',null,null,null,null,null,null,'Peak 10','Travel',null,'Office parking',null,'classify',327,''],
    ['p10-029','W 2nd St Garage','p10_always','contains','2nd st garage',null,null,null,null,null,null,'Peak 10','Travel',null,'Office parking',null,'classify',328,''],
    ['p10-030','UPS','p10_always','contains','ups',null,null,null,null,null,null,'Peak 10','Office Supplies & Expenses',null,null,null,'classify',329,''],
    ['p10-031','ParkMobile','p10_always','contains','parkmobile',null,null,null,null,null,null,'Peak 10','Travel',null,null,null,'classify',330,''],
    ['p10-032','Shell Gas','p10_always','contains','shell',null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',331,''],
    ['p10-033','ExxonMobil','p10_always','contains','exxon',null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',332,''],
    ['p10-034','Buc-ees','p10_always','contains',"buc-ee",null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',333,''],
    ['p10-035','7-Eleven Gas','p10_always','contains','7-eleven',null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',334,''],
    ['p10-036','Chevron','p10_always','contains','chevron',null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',335,''],
    ['p10-037','Valero','p10_always','contains','valero',null,null,null,null,null,null,'Peak 10','Travel',null,'Fuel',null,'classify',336,''],

    // ── P10 Conditional (400–499) ────────────────────────────────────────────
    ['p10-cond-001','Mon-Thu Restaurant ≥$95','p10_conditional','contains','conditional_restaurant','5829',95,null,'1,2,3,4',null,null,'Peak 10','Meals & Meetings - external',null,null,'⚠️ Add attendee names','classify',400,'Mon=1 Tue=2 Wed=3 Thu=4; Monarch category = Restaurants & Bars'],
    ['p10-cond-002','Postoak Houston','p10_conditional','contains','postoak',null,45,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',401,'Houston-only venue'],
    ['p10-cond-003','Arnaldo Richards','p10_conditional','contains','arnaldo',null,45,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',402,'Houston-only venue'],
    ['p10-cond-004','Toca Madera Houston','p10_conditional','contains','toca madera',null,45,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',403,'Houston-only venue'],
    ['p10-cond-005','Eugenes Gulf Coast','p10_conditional','contains','eugene',null,45,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',404,'Houston-only venue'],
    ['p10-cond-006','Balboa Surf Club','p10_conditional','contains','balboa surf',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',405,''],
    ['p10-cond-007','Remedy Austin','p10_conditional','contains','remedy austin',null,null,null,null,null,null,'Peak 10','Meals & Meetings - external',null,null,null,'classify',406,''],

    // ── Personal Overrides (500–599) ─────────────────────────────────────────
    ['pers-001','Westlake Market','personal_override','contains','westlake market',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',500,'Personal grocery'],
    ['pers-002','Briar Club Pre-2026','personal_override','contains','briar club',null,null,null,null,null,'2025-12-31','Personal',null,null,null,null,'classify',501,'Personal membership pre-Jan 2026'],
    ['pers-003','Hotel ZaZa','personal_override','contains','zazaa',null,null,null,null,null,null,'Personal',null,null,null,null,'ask_kyle',502,'Ask Kyle: P10 business or personal?'],
    ['pers-004','Alamo Toll','personal_override','contains','alamo toll',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',503,'Driving toll — not Alamo Rent-A-Car'],
    ['pers-005','Covert Cadillac','personal_override','contains','covert cadillac',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',504,'Personal auto'],
    ['pers-006','Google Fiber','personal_override','contains','google fiber',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',505,'Home internet — not Google One'],
    ['pers-007','Stan Taylor','personal_override','contains','stan taylor',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',506,''],
    ['pers-008','Relaxing Thai Massage','personal_override','contains','relaxing thai',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',507,''],
    ['pers-009','Gimmersta','personal_override','contains','gimmersta',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',508,''],
    ['pers-010','ATX Bikes','personal_override','contains','atx bikes',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',509,''],
    ['pers-011','Mod Bikes','personal_override','contains','mod bikes',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',510,''],
    ['pers-012','Gray Taxidermy','personal_override','contains','gray taxidermy',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',511,''],
    ['pers-013','Emerald Point Ship Store','personal_override','contains','emerald point',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',512,''],
    ['pers-014','Toolsons','personal_override','contains','toolsons',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',513,''],
    ['pers-015','Onsite Partners','personal_override','contains','onsite partners',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',514,''],
    ['pers-016','Legendary Dec 2025','personal_override','contains','legendary',null,null,null,'2025-12-01','2025-12-31',null,'Personal',null,null,null,null,'classify',515,''],
    ['pers-017','Payrix Eanes ISD 9007','personal_override','contains','eanes isd','9007',null,null,null,null,null,'Personal',null,null,null,null,'classify',516,'School lunch'],
    ['pers-018','Payrix Longhorn Boat 9007','personal_override','contains','longhorn boat','9007',null,null,null,null,null,'Personal',null,null,null,null,'classify',517,'Summer camp'],
    ['pers-019','Annual Membership 9007 695','personal_override','contains','annual membership fee','9007',695,695,null,null,null,'Personal',null,null,null,null,'classify',518,'Personal club membership'],
    ['pers-020','Crosswell Counseling','personal_override','contains','crosswell',null,null,null,null,null,null,'Moonsmoke LLC',null,'Executive Wellness',null,null,'classify',519,'LLC executive wellness — not personal override despite name'],

    // ── Split Flags (700–799) ────────────────────────────────────────────────
    ['split-001','Southwest Airlines','special','contains','southwest airlines',null,null,null,null,null,null,'Peak 10',null,null,null,'⚠️ Southwest: P10 business or personal trip? Confirm per flight.','split_flag',700,''],
    ['split-002','Hotel ZaZa Split','special','contains','hotel zaza',null,null,null,null,null,null,'Peak 10',null,null,null,'⚠️ Hotel ZaZa: P10 business or personal stay?','split_flag',701,''],
    ['split-003','Payrix General','special','contains','payrix',null,null,null,null,null,null,'Peak 10',null,null,null,'⚠️ Payrix: confirm venue — school lunch (personal), camp (personal), or business meal?','ask_kyle',702,'Except 5829 Numero 28 Austin (rule p10-026) and 9007 rules above'],

    // ── Ask Kyle (800–899) ───────────────────────────────────────────────────
    ['ask-001','The Wayback','ask_kyle','contains','wayback',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 business meal or LLC meals & entertainment?','ask_kyle',800,''],
    ['ask-002','Sway West Lake','ask_kyle','contains','sway',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 or LLC business meal?','ask_kyle',801,''],
    ['ask-003','Sammies Italian','ask_kyle','contains','sammie',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 or LLC business meal?','ask_kyle',802,''],
    ['ask-004','Bartletts','ask_kyle','contains','bartlett',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 or LLC business meal?','ask_kyle',803,''],
    ['ask-005','Perlas Seafood','ask_kyle','contains','perlas',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 or LLC business meal?','ask_kyle',804,''],
    ['ask-006','Austin Proper Hotel','ask_kyle','contains','austin proper',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 lodging or LLC business housing?','ask_kyle',805,''],
    ['ask-007','DoorDash','ask_kyle','contains','doordash',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 business meal, LLC, or personal?','ask_kyle',806,''],
    ['ask-008','Pak Mail','ask_kyle','contains','pak mail',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 shipping, LLC, or personal?','ask_kyle',807,''],
    ['ask-009','Uber','ask_kyle','contains','uber',null,null,null,null,null,null,'Personal',null,null,null,'⚠️ Ask Kyle: P10 travel, LLC, or personal?','ask_kyle',808,''],

    // ── Default fallback (9000) ───────────────────────────────────────────────
    ['default-001','Default Personal','default','contains','',null,null,null,null,null,null,'Personal',null,null,null,null,'classify',9000,'Unknown vendor → Personal, flag for review if > $25'],
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync folder directory structure — creates all required subdirectories
// ─────────────────────────────────────────────────────────────────────────────
function initSyncFolderStructure(folder: string): void {
  const dirs = [
    path.join(folder, 'db'),
    path.join(folder, 'exports', 'expense_reports'),
    path.join(folder, 'exports', 'statements'),
    path.join(folder, 'imports', 'usaa'),
    path.join(folder, 'imports', 'usaa', 'processed'),
    path.join(folder, 'imports', 'apple_card'),
    path.join(folder, 'imports', 'apple_card', 'processed'),
    path.join(folder, 'backups'),
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create main window
// ─────────────────────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#F9FAFB',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Load app
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'))
  }

  return win
}

// ─────────────────────────────────────────────────────────────────────────────
// App startup
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  mainWindow = createWindow()

  // Load sync folder path from userData config
  syncFolderPath = loadSyncFolderPath()

  // If sync folder is already configured, initialize everything now.
  // If not, the setup wizard will call app:set-sync-folder + app:init-database.
  if (syncFolderPath && fs.existsSync(syncFolderPath)) {
    await bootstrapServices(syncFolderPath)
  }

  // Show window once ready
  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
  })

  // Register app-level IPC handlers (used by setup wizard + general app)
  registerAppIpcHandlers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap all services — called once DB is ready (either on startup or after
// the setup wizard picks a sync folder)
// ─────────────────────────────────────────────────────────────────────────────
async function bootstrapServices(folder: string): Promise<void> {
  // Initialize folder structure + database
  initSyncFolderStructure(folder)
  db = initDatabase(folder)

  // ── Phase 2: Plaid sync ─────────────────────────────────────────────────
  const plaidService = PlaidService.getInstance(db)
  const syncScheduler = SyncScheduler.getInstance(db, plaidService, () => mainWindow)
  registerPlaidIpcHandlers(db, plaidService, syncScheduler)

  // ── Phase 3: Investment tracking ────────────────────────────────────────
  const invService = PlaidInvestmentsService.getInstance(db, plaidService)
  registerInvestmentsIpcHandlers(db, invService, () => folder)

  // Extend the SyncScheduler to also snapshot investments on each sync
  const originalRunSync = (syncScheduler as any).runSync?.bind(syncScheduler)
  if (originalRunSync) {
    ;(syncScheduler as any).runSync = async () => {
      await originalRunSync()
      try {
        await invService.syncAll()
      } catch (err) {
        console.warn('[Main] Investment sync during auto-sync failed:', err)
      }
    }
  }

  // ── Phase 4: Financial statements + import wizard + lifecycle ───────────
  registerFinancialStatementsHandlers(db, () => folder)
  registerHistoricalImportHandlers(db, () => mainWindow)

  const lifecycle = AppLifecycleService.getInstance(folder, () => mainWindow)
  const { lockConflict, lockInfo } = await lifecycle.initialize()
  lifecycle.registerIpcHandlers()

  // Notify renderer of lock conflict after window loads
  if (lockConflict && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow!.webContents.send('lifecycle:lock-conflict', { lockInfo })
    })
  }

  // System tray
  const iconPath = path.join(__dirname, '../../resources/icon.ico')
  lifecycle.setupTray(iconPath, () => { syncScheduler.syncNow().catch(console.error) })

  // Release lock and stop background services on quit
  app.on('before-quit', () => {
    ;(app as any).isQuiting = true
    lifecycle.releaseLock()
  })

  // Start Plaid staleness check + cron (after window is shown)
  mainWindow?.once('ready-to-show', async () => {
    await syncScheduler.onAppReady()
  })

  // Phase 1: File watcher for USAA + Apple Card drop folders
  registerWatchedFolderHandlers(db, folder)

  console.log('[Main] All services bootstrapped for sync folder:', folder)
}

// ─────────────────────────────────────────────────────────────────────────────
// Watched folder import (Phase 1) — chokidar watches USAA + Apple Card folders
// ─────────────────────────────────────────────────────────────────────────────
function registerWatchedFolderHandlers(database: Database.Database, folder: string): void {
  try {
    const chokidar = require('chokidar')

    const watchedDirs = [
      { dir: path.join(folder, 'imports', 'usaa'), type: 'USAA' },
      { dir: path.join(folder, 'imports', 'apple_card'), type: 'Apple Card' },
    ]

    for (const { dir, type } of watchedDirs) {
      const watcher = chokidar.watch(dir, {
        ignored: [/(^|[/\\])\../, /processed\//],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
      })

      watcher.on('add', async (filePath: string) => {
        const ext = path.extname(filePath).toLowerCase()
        if (!['.csv', '.ofx'].includes(ext)) return

        console.log(`[Watcher] New ${type} file detected:`, filePath)

        try {
          const { HistoricalImportService } = require('../../electron/services/historical-import.service')
          const importSvc = HistoricalImportService.getInstance(database)
          const result = await importSvc.importCSV(filePath, (progress: any) => {
            mainWindow?.webContents.send('import:progress', progress)
          })

          // Move processed file
          const processedDir = path.join(path.dirname(filePath), 'processed')
          fs.mkdirSync(processedDir, { recursive: true })
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
          const processedPath = path.join(processedDir, `${timestamp}_${path.basename(filePath)}`)
          fs.renameSync(filePath, processedPath)

          console.log(`[Watcher] ${type} import complete:`, result)
          mainWindow?.webContents.send('import:watched-folder-complete', {
            type,
            file: path.basename(filePath),
            ...result,
          })
        } catch (err) {
          console.error(`[Watcher] ${type} import failed:`, err)
        }
      })
    }

    console.log('[Main] File watchers started for USAA and Apple Card folders.')
  } catch (err) {
    console.warn('[Main] Could not start file watchers (chokidar not available):', err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App-level IPC handlers (setup wizard + general utilities)
// ─────────────────────────────────────────────────────────────────────────────
function registerAppIpcHandlers(): void {

  // ── Setup wizard: folder selection ─────────────────────────────────────────
  ipcMain.handle('app:select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Sync Folder (inside Dropbox, OneDrive, or any folder)',
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:get-sync-folder', () => syncFolderPath)

  ipcMain.handle('app:set-sync-folder', async (_event, folder: string) => {
    syncFolderPath = folder
    saveSyncFolderPath(folder)
    return { success: true }
  })

  ipcMain.handle('app:init-database', async (_event, folder: string) => {
    const dbPath = path.join(folder, 'db', 'mcquire.db')
    const isNew = !fs.existsSync(dbPath)

    // If switching sync folders, bootstrap everything
    if (folder !== syncFolderPath || !db) {
      syncFolderPath = folder
      saveSyncFolderPath(folder)
      await bootstrapServices(folder)
    }

    return { isNew, success: true }
  })

  // ── General DB read/write helpers (used by renderer across all screens) ────

  ipcMain.handle('db:get-setting', (_event, key: string) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return { success: true, data: row?.value ?? null }
  })

  ipcMain.handle('db:set-setting', (_event, key: string, value: string) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
    return { success: true }
  })

  ipcMain.handle('db:get-review-count', () => {
    if (!db) return { success: true, data: 0 }
    const row = db
      .prepare("SELECT COUNT(*) as n FROM transactions WHERE review_status IN ('pending_review', 'flagged')")
      .get() as { n: number }
    return { success: true, data: row.n }
  })

  ipcMain.handle('db:get-bucket-totals', () => {
    if (!db) return { success: true, data: {} }
    const rows = db
      .prepare(
        `SELECT bucket, SUM(ABS(amount)) as total, COUNT(*) as count
         FROM transactions
         WHERE bucket != 'Exclude' AND bucket IS NOT NULL
         GROUP BY bucket`
      )
      .all() as Array<{ bucket: string; total: number; count: number }>
    const result: Record<string, { total: number; count: number }> = {}
    for (const r of rows) result[r.bucket] = { total: r.total, count: r.count }
    return { success: true, data: result }
  })

  // ── Transaction read/write (Review Queue + Transactions screen) ────────────

  ipcMain.handle('transactions:get-pending', () => {
    if (!db) return { success: true, data: [] }
    const rows = db
      .prepare(
        `SELECT t.*, a.institution, a.account_name, a.account_mask
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         WHERE t.review_status IN ('pending_review', 'flagged')
           AND t.is_split_child = 0
         ORDER BY t.transaction_date DESC
         LIMIT 200`
      )
      .all()
    return { success: true, data: rows }
  })

  ipcMain.handle('transactions:classify', (_event, id: string, update: Record<string, any>) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    const allowed = ['bucket', 'p10_category', 'llc_category', 'description_notes', 'review_status', 'flag_reason', 'period_label']
    const fields = Object.keys(update).filter((k) => allowed.includes(k))
    if (fields.length === 0) return { success: false, error: 'No valid fields to update' }
    const set = fields.map((f) => `${f} = ?`).join(', ')
    db.prepare(`UPDATE transactions SET ${set}, updated_at = datetime('now') WHERE id = ?`)
      .run(...fields.map((f) => update[f]), id)
    return { success: true }
  })

  ipcMain.handle('transactions:run-rules-all', () => {
    if (!db) return { success: false, error: 'DB not initialized' }
    const result = reclassifyPendingAfterRuleChange(db)
    return { success: true, ...result }
  })

  ipcMain.handle('transactions:get-all', (_event, filters: Record<string, any> = {}) => {
    if (!db) return { success: true, data: [] }
    let sql = `
      SELECT t.*, a.institution, a.account_name, a.account_mask
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.bucket != 'Exclude' OR t.bucket IS NULL`
    const params: any[] = []
    if (filters.bucket) { sql += ' AND t.bucket = ?'; params.push(filters.bucket) }
    if (filters.startDate) { sql += ' AND t.transaction_date >= ?'; params.push(filters.startDate) }
    if (filters.endDate) { sql += ' AND t.transaction_date <= ?'; params.push(filters.endDate) }
    if (filters.search) { sql += ' AND t.merchant_name LIKE ?'; params.push(`%${filters.search}%`) }
    const limitVal = typeof filters.limit === 'number' ? filters.limit : 2000
    sql += ` ORDER BY t.transaction_date DESC LIMIT ${limitVal}`
    const rows = db.prepare(sql).all(...params)
    return { success: true, data: rows }
  })

  ipcMain.handle('transactions:split', (_event, parentId: string, fragments: Array<{ bucket: string; amount: number; category: string; notes?: string }>) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    const { v4: uuidv4 } = require('uuid')
    const tx = db.transaction(() => {
      db!.prepare("UPDATE transactions SET is_split_child = 0, review_status = 'manually_classified', updated_at = datetime('now') WHERE id = ?").run(parentId)
      for (const frag of fragments) {
        db!.prepare(
          `INSERT INTO transactions
            (id, account_id, transaction_date, description_raw, merchant_name, amount,
             bucket, p10_category, llc_category, description_notes, review_status,
             split_parent_id, is_split_child, created_at, updated_at)
           SELECT ?, account_id, transaction_date, description_raw, merchant_name, ?,
             ?, ?, ?, ?, 'manually_classified', ?, 1, datetime('now'), datetime('now')
           FROM transactions WHERE id = ?`
        ).run(uuidv4(), frag.amount, frag.bucket, frag.bucket === 'Peak 10' ? frag.category : null, frag.bucket === 'Moonsmoke LLC' ? frag.category : null, frag.notes || null, parentId, parentId)
      }
    })
    tx()
    return { success: true }
  })

  // ── Rule CRUD (Rule Editor) ────────────────────────────────────────────────

  ipcMain.handle('rules:get-all', () => {
    if (!db) return { success: true, data: [] }
    const rows = db.prepare('SELECT * FROM rules ORDER BY priority_order ASC').all()
    return { success: true, data: rows }
  })

  ipcMain.handle('rules:save', (_event, rule: Record<string, any>) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    try {
      const { v4: uuidv4 } = require('uuid')
      const id = rule.id || uuidv4()
      db.prepare(`
        INSERT INTO rules
          (id, rule_name, section, match_type, match_value, account_mask_filter,
           amount_min, amount_max, day_of_week_filter, date_from_filter, date_to_filter,
           bucket, p10_category, llc_category, description_notes, flag_reason, action,
           priority_order, is_active, notes, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          rule_name=excluded.rule_name, section=excluded.section, match_type=excluded.match_type,
          match_value=excluded.match_value, account_mask_filter=excluded.account_mask_filter,
          amount_min=excluded.amount_min, amount_max=excluded.amount_max,
          day_of_week_filter=excluded.day_of_week_filter, date_from_filter=excluded.date_from_filter,
          date_to_filter=excluded.date_to_filter, bucket=excluded.bucket,
          p10_category=excluded.p10_category, llc_category=excluded.llc_category,
          description_notes=excluded.description_notes, flag_reason=excluded.flag_reason,
          action=excluded.action, priority_order=excluded.priority_order,
          is_active=excluded.is_active, notes=excluded.notes, updated_at=datetime('now')
      `).run(
        id, rule.rule_name, rule.section, rule.match_type, rule.match_value,
        rule.account_mask_filter ?? null, rule.amount_min ?? null, rule.amount_max ?? null,
        rule.day_of_week_filter ?? null, rule.date_from_filter ?? null, rule.date_to_filter ?? null,
        rule.bucket, rule.p10_category ?? null, rule.llc_category ?? null,
        rule.description_notes ?? null, rule.flag_reason ?? null, rule.action,
        rule.priority_order, rule.is_active ?? 1, rule.notes ?? null
      )
      // Immediately apply the new/updated rule to all pending_review transactions
      const { resolved } = reclassifyPendingAfterRuleChange(db)
      console.log(`[rules:save] rule saved (${id}), reclassify resolved ${resolved} pending txs`)
      return { success: true, data: id }
    } catch (err: any) {
      console.error('[rules:save] failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('rules:delete', (_event, id: string) => {
    if (!db) return { success: false }
    db.prepare("UPDATE rules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
    return { success: true }
  })

  // ── Personal trip exclusion dates ──────────────────────────────────────────

  ipcMain.handle('trips:get-all', () => {
    if (!db) return { success: true, data: [] }
    return { success: true, data: db.prepare('SELECT * FROM personal_trip_dates ORDER BY start_date').all() }
  })

  ipcMain.handle('trips:save', (_event, trip: { id?: string; trip_name: string; start_date: string; end_date: string }) => {
    if (!db) return { success: false }
    const { v4: uuidv4 } = require('uuid')
    const id = trip.id || uuidv4()
    db.prepare(
      'INSERT INTO personal_trip_dates (id, trip_name, start_date, end_date) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET trip_name=excluded.trip_name, start_date=excluded.start_date, end_date=excluded.end_date'
    ).run(id, trip.trip_name, trip.start_date, trip.end_date)
    return { success: true, data: id }
  })

  ipcMain.handle('trips:delete', (_event, id: string) => {
    if (!db) return { success: false }
    db.prepare('DELETE FROM personal_trip_dates WHERE id = ?').run(id)
    return { success: true }
  })

  // ── Shell: open file in Explorer ───────────────────────────────────────────

  ipcMain.handle('shell:open-path', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  // ── Settings helpers (used by Settings screens) ────────────────────────────

  ipcMain.handle('settings:getAll', () => {
    if (!db) return { success: true, data: {} }
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    return { success: true, data: Object.fromEntries(rows.map(r => [r.key, r.value])) }
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    if (!db) return { success: false, error: 'DB not initialized' }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    return { success: true }
  })

  // ── Email / SMTP (Settings → Notifications screen + Setup Wizard) ──────────

  ipcMain.handle('settings:getSmtp', () => {
    const { loadSmtpConfig } = require('../../electron/services/email-service')
    const cfg = loadSmtpConfig()
    if (!cfg) return { success: true, data: null }
    return { success: true, data: { ...cfg, password: '••••••••' } }
  })

  ipcMain.handle('settings:saveSmtp', (_event, config: any) => {
    const { storeSmtpConfig } = require('../../electron/services/email-service')
    // Build canonical SmtpConfig from whatever the UI sends
    const smtpType: string = config.type ?? 'gmail'
    const host = config.host ?? (smtpType === 'gmail' ? 'smtp.gmail.com' : smtpType === 'outlook' ? 'smtp.office365.com' : 'smtp.gmail.com')
    const port = config.port ?? (smtpType === 'gmail' ? 465 : 587)
    const secure = config.secure ?? (smtpType === 'gmail')
    storeSmtpConfig({ host, port, secure, user: config.email ?? config.user ?? '', password: config.password ?? '' })
    const emailAddr = config.email ?? config.user ?? ''
    if (emailAddr && db) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('notification_email', emailAddr)
    }
    return { success: true }
  })

  ipcMain.handle('settings:testEmail', async (_event, toEmail?: string) => {
    const { sendTestEmail } = require('../../electron/services/email-service')
    const emailAddr = toEmail ?? (db?.prepare("SELECT value FROM settings WHERE key = 'notification_email'").get() as any)?.value
    if (!emailAddr) return { success: false, error: 'No email address configured' }
    return await sendTestEmail(emailAddr)
  })

  // Legacy channels used by the setup wizard email step
  ipcMain.handle('email:save-smtp', (_event, config: any) => {
    const { storeSmtpConfig } = require('../../electron/services/email-service')
    const smtpType: string = config.type ?? 'gmail'
    const host = config.host ?? (smtpType === 'gmail' ? 'smtp.gmail.com' : smtpType === 'outlook' ? 'smtp.office365.com' : 'smtp.gmail.com')
    const port = config.port ?? (smtpType === 'gmail' ? 465 : 587)
    const secure = config.secure ?? (smtpType === 'gmail')
    storeSmtpConfig({ host, port, secure, user: config.email ?? config.user ?? '', password: config.password ?? '' })
    const emailAddr = config.email ?? config.user ?? ''
    if (emailAddr && db) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('notification_email', emailAddr)
    }
    return { success: true }
  })

  ipcMain.handle('email:send-test', async () => {
    const { sendTestEmail } = require('../../electron/services/email-service')
    const row = db?.prepare("SELECT value FROM settings WHERE key = 'notification_email'").get() as { value: string } | undefined
    if (!row?.value) return { success: false, error: 'No email configured. Save SMTP settings first.' }
    return await sendTestEmail(row.value)
  })
}
