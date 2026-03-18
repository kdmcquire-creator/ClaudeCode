# McQuire Financial Tracker — Claude Context

## What This App Is

Desktop Electron app for **Kyle McQuire's** personal financial tracking across three entities:

- **Peak 10 Energy Management** — W2 employment; expenses reimbursed quarterly via `.xlsx` report
- **Moonsmoke LLC** — S-Corp business; Schedule C expenses, payroll via Patriot Software
- **Personal** — All remaining personal spend

**Stack:** Windows x64 · Electron 28 · React 18 · TypeScript · SQLite (better-sqlite3) · Plaid API · Vite

**Source repo layout:**
- `mcquire-tracker-app/` — the working build directory ← **always edit here**
- `mcquire-tracker-source/` — mirror copy; always sync both when making changes

---

## Key Conventions

### Always Do
- After any code change, copy changed files to `mcquire-tracker-source/` to keep both in sync
- Run `npx tsc --noEmit` (inside `mcquire-tracker-app/`) before committing — must be 0 errors
- Window.api types live in `src/renderer/App.tsx` — update this whenever preload changes
- All DB changes must be additive: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`
- Never rename or drop columns without an explicit migration + Kyle's sign-off

### Never Do
- Push to any branch other than `claude/review-mcquire-handoff-FM8z6`
- Destructive schema changes (drop table, rename column)
- Touch `manually_classified` transactions — that status means Kyle made the decision

### Build & Run
```bash
cd mcquire-tracker-app
npm install
npm run build           # Produces Windows installer (.exe) in dist/
npm run build:unpackaged  # Faster — no installer, just the unpacked app
npx tsc --noEmit        # Type check only
npm run dev             # Hot-reload dev mode
```

---

## Architecture

### Data Lives Outside the App
The SQLite database (`mcquire.db`) lives in Kyle's sync folder (Dropbox or OneDrive), configured at first run. The app binary is completely replaceable without losing data. Folder structure:

```
[sync folder]/
├── db/mcquire.db           ← All data
├── exports/                ← Generated .xlsx reports
├── imports/usaa/           ← Drop USAA CSV here (auto-imported by file watcher)
├── imports/apple_card/     ← Drop Apple Card CSV here
├── backups/                ← Nightly SQLite backups (last 30 days)
└── .lock                   ← Session lock (prevents multi-instance DB corruption)
```

### IPC Pattern
Everything renderer-to-main goes through the contextBridge:
- `window.api.*` — primary API surface
- `window.electronAPI.*` — setup wizard only (folder selection, DB init)
- `window.electron.ipcRenderer` — raw event listeners (progress events, lock conflict, etc.)

**Adding a new feature always requires 4 touches:**
1. `electron/services/` — the actual logic
2. `src/main/index.ts` — `ipcMain.handle('channel:name', ...)` wires it up
3. `src/preload/index.ts` — exposes it on `window.api`
4. `src/renderer/App.tsx` — adds it to the `Window` interface type declaration

---

## Database Schema

### `transactions`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| account_id | TEXT FK | → accounts |
| plaid_transaction_id | TEXT UNIQUE | null for CSV imports |
| source_row_hash | TEXT UNIQUE | SHA256 of CSV row, for dedup |
| transaction_date | TEXT | YYYY-MM-DD |
| posting_date | TEXT | YYYY-MM-DD |
| description_raw | TEXT | Original merchant string |
| merchant_name | TEXT | Normalized by engine |
| amount | REAL | Positive = expense, negative = income/refund |
| category_source | TEXT | Plaid category (used by conditional rules) |
| bucket | TEXT | 'Peak 10' \| 'Moonsmoke LLC' \| 'Personal' \| 'Exclude' |
| p10_category | TEXT | Peak 10 expense category |
| llc_category | TEXT | Moonsmoke LLC expense category |
| description_notes | TEXT | Human-readable notes from rule |
| rule_id | TEXT FK | Which rule classified it |
| review_status | TEXT | See statuses below |
| flag_reason | TEXT | Why it was flagged |
| split_parent_id | TEXT | If this is a split child |
| is_split_child | INTEGER | 0/1 |
| period_label | TEXT | e.g. "Q4 2025" — set during expense report |
| expense_report_id | TEXT | Which report included this TX |

**review_status values:**
- `pending_review` — no rule matched (or rule said ask_kyle) — needs Kyle's input
- `auto_classified` — rule matched cleanly — no action needed
- `manually_classified` — Kyle classified it by hand — **never overwrite**
- `flagged` — rule matched but has flag_reason — needs Kyle to confirm

### `rules`
| Column | Notes |
|---|---|
| id | e.g. 'llc-001', 'p10-024' |
| section | 'exclusion' \| 'llc_always' \| 'p10_always' \| 'p10_conditional' \| 'personal_override' \| 'special' \| 'ask_kyle' |
| match_type | 'exact' \| 'contains' \| 'starts_with' \| 'regex' |
| match_value | String to match against normalized merchant name. Special values: 'conditional_restaurant', 'conditional_houston_restaurant' |
| account_mask_filter | e.g. '5829' (Kyle's card) — only match that account |
| amount_min / amount_max | Optional range filter |
| day_of_week_filter | Comma-sep: '1,2,3,4' = Mon–Thu |
| date_from_filter / date_to_filter | Optional date range |
| bucket | Classification result |
| p10_category / llc_category | Sub-category result |
| action | 'classify' \| 'exclude' \| 'ask_kyle' \| 'split_flag' |
| flag_reason | If present → TX flagged even if classified |
| priority_order | Lower = higher priority; evaluated in ascending order |
| is_active | 0 = soft-deleted |

### Other Tables
- `accounts` — Plaid or manual accounts (institution, mask, entity, bucket default)
- `plaid_items` — One per bank connection (access token stored encrypted separately)
- `vendors` — Merchant normalization cache (raw_name → canonical_name)
- `personal_trip_dates` — Kyle's personal travel dates (used to suppress P10 conditional restaurant rules)
- `investments` — Holdings snapshots + investment transactions from Plaid
- `expense_reports` — Generated report metadata
- `sync_log` — Import/sync history
- `settings` — Key-value store
- `migrations` — One-time migration tracking

---

## Classification Engine (`electron/services/classification-engine.ts`)

### Core Functions

**`normalizeMerchant(raw)`** — lowercases, strips TST*/SQ*/PY* prefixes, removes trailing location identifiers (#1, card numbers), strips special chars. Example: `"TST* BARI HOUSTON #1"` → `"bari houston"`

**`ruleMatches(rule, tx)`** — evaluates all rule conditions in order:
1. match_value (or special conditional logic)
2. account_mask_filter
3. amount range
4. day_of_week_filter
5. date range
Special: `conditional_restaurant` checks Plaid `category_source` for "restaurant"/"dining". Also checks `personal_trip_dates` — if Kyle is traveling personally, P10 conditional restaurant rules are suppressed.

**`classifyTransaction(tx, rules, db)`** — iterates rules by priority_order, first match wins:
- `action='exclude'` → bucket='Exclude', auto_classified
- `action='classify'` + no flag_reason → auto_classified
- `action='classify'` + flag_reason → flagged
- `action='ask_kyle'` or `'split_flag'` → pending_review
- No match + amount ≤ $25 → Personal, auto_classified
- No match + amount > $25 → pending_review

**`reclassifyPendingAfterRuleChange(db)`** — only touches `review_status = 'pending_review'`. Safe to run anytime. Returns `{ resolved: number }`. Wired to `transactions:run-rules-all` IPC + "⚡ Run Rules" button on Dashboard.

### Rule Priority Ranges
| Range | Section | Purpose |
|---|---|---|
| 100–199 | exclusion | Credit card payments, bank transfers → Exclude |
| 200–299 | llc_always | Gexa, Bilt, Lifetime Fitness, TrueCoach, Patriot → Moonsmoke LLC |
| 300–399 | p10_always | Park House, Houston Club, Adobe, Bloomberg, AT&T → Peak 10 |
| 400–499 | p10_conditional | Mon–Thu restaurants ≥$95, Houston venues ≥$45 → Peak 10 |
| 500–599 | personal_override | Westlake Market, Briar Club pre-2026, Google Fiber → Personal |
| 700–799 | special | Southwest, Hotel ZaZa, Payrix → split_flag |
| 800–899 | ask_kyle | DoorDash, Uber, Sway, Sammies → ask_kyle |
| 9000 | default | Fallback: Personal if ≤$25, else pending_review |

---

## Screens

| Screen | Key | Purpose |
|---|---|---|
| Dashboard | "dashboard" | Bucket totals, recent TXs, Sync/Run Rules/Import CSV buttons |
| Review Queue | "review" | Classify pending/flagged TXs; split tool; attendee field for P10 meals |
| Transactions | "transactions" | Full history with filters (bucket, date, search) |
| Reports | "reports" | Generate 6 report types as .xlsx |
| Investments | "investments" | Plaid holdings + transactions (informational only) |
| Settings | "settings" | Tabbed: Account Mgmt, Sync Settings, Schedule, Rule Editor, Notifications |

---

## IPC Channel Reference

### Transactions
- `transactions:get-pending` — pending_review + flagged (limit 200)
- `transactions:classify` — update bucket/category/status on single TX
- `transactions:get-all` — full history, optional filters {bucket, startDate, endDate, search}
- `transactions:split` — split TX into children, mark parent manually_classified
- `transactions:run-rules-all` — reclassify all pending_review TXs

### Rules
- `rules:get-all` — sorted by priority_order
- `rules:save` — upsert; auto-triggers reclassifyPendingAfterRuleChange
- `rules:delete` — soft-delete (is_active = 0)

### Reports / Statements
- `reports:generate-expense-report` — Peak 10 .xlsx
- `reports:check-expense-report-readiness` — validates before generation
- `statements:pandl` / `statements:balanceSheet` / `statements:cashflow` / `statements:fullTracker` / `statements:personalSummary`

### Plaid
- `plaid:createLinkToken` / `plaid:exchangePublicToken` / `plaid:syncAll` / `plaid:syncOne`
- `accounts:list` / `accounts:create` / `accounts:update`
- `syncLog:getRecent`

### Investments
- `investments:syncHoldings` / `investments:syncTransactions`
- `investments:getPortfolioSummary` / `investments:getHoldings` / `investments:getTransactions`

### Import
- `import:selectFile` / `import:preview` / `import:run`

### Other
- `db:get-setting` / `db:set-setting` / `settings:getAll` / `settings:set`
- `db:get-review-count` / `db:get-bucket-totals`
- `trips:get-all` / `trips:save` / `trips:delete`
- `shell:open-path`
- `settings:getSmtp` / `settings:saveSmtp` / `settings:testEmail`

---

## Key Service Files

| File | Purpose |
|---|---|
| `src/main/index.ts` | DB schema, all IPC handler registration, DB initialization |
| `src/preload/index.ts` | contextBridge — everything renderer can call |
| `src/renderer/App.tsx` | Routing + `Window` interface type declarations |
| `electron/services/classification-engine.ts` | Rule matching, normalization, classify + reclassify |
| `electron/services/plaid.service.ts` | Plaid API client (token exchange, /transactions/sync) |
| `electron/services/plaid-ipc.ts` | Plaid IPC handlers |
| `electron/services/historical-import.service.ts` | CSV import (Monarch/USAA/Apple Card), watched folders |
| `electron/services/financial-statements.service.ts` | All .xlsx report generation |
| `electron/services/app-lifecycle.service.ts` | Lock file, nightly backup, tray icon |
| `electron/services/sync-scheduler.service.ts` | Auto-sync cron + staleness check |
| `src/renderer/screens/ReviewQueue.tsx` | Manual classification UI |
| `src/shared/types.ts` | Shared TypeScript types (Bucket, ReviewStatus, Rule, Transaction, etc.) |

---

## Credentials & Security

- Plaid Client ID + Secret → Windows Credential Manager via `safeStorage`
- Plaid access tokens → encrypted files in `userData/creds/`
- SMTP password → Windows Credential Manager (key: `mcquire-tracker-smtp`)
- Never log or expose raw credential values

---

## Git

- Branch: `claude/review-mcquire-handoff-FM8z6`
- Always push with: `git push -u origin claude/review-mcquire-handoff-FM8z6`
- Commit message format: imperative subject line, body explaining why not what
- Session URL footer on all commits
