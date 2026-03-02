import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { initSchema, seedDefaultSettings, seedPersonalTripDates, seedDefaultActionItems } from './schema'
import { seedRules } from './seed-rules'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.')
  return _db
}

export function initDb(syncFolderPath: string): Database.Database {
  const dbDir = path.join(syncFolderPath, 'db')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'mcquire.db')

  _db = new Database(dbPath)
  initSchema(_db)
  seedRules(_db)
  seedDefaultSettings(_db)
  seedPersonalTripDates(_db)
  seedDefaultActionItems(_db)

  console.log(`[DB] Initialized at ${dbPath}`)
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function getSetting(key: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getAllSettings(): Record<string, string> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}
