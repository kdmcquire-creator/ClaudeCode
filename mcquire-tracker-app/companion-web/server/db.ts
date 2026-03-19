import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dbPath = process.env.MCQUIRE_DB_PATH
  if (!dbPath) {
    throw new Error('MCQUIRE_DB_PATH environment variable not set. Point it to your mcquire.db file.')
  }

  const resolved = path.resolve(dbPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Database not found at: ${resolved}`)
  }

  db = new Database(resolved, { readonly: false })
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  console.log(`[db] Connected to ${resolved}`)
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
