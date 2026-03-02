import fs from 'fs'
import path from 'path'
import { getDb, setSetting } from '../db/index'

export function runBackup(syncFolder: string): void {
  try {
    const backupDir = path.join(syncFolder, 'backups')
    fs.mkdirSync(backupDir, { recursive: true })

    const today = new Date().toISOString().substring(0, 10)
    const backupPath = path.join(backupDir, `mcquire_${today}.db`)

    if (fs.existsSync(backupPath)) return // Already backed up today

    // Use SQLite backup API
    const db = getDb()
    ;(db as any).backup(backupPath).then(() => {
      console.log(`[Backup] Created: ${backupPath}`)
      setSetting('last_backup_date', today)

      // Prune old backups (keep last 30)
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('mcquire_') && f.endsWith('.db'))
        .sort()
      if (files.length > 30) {
        const toDelete = files.slice(0, files.length - 30)
        toDelete.forEach(f => fs.unlinkSync(path.join(backupDir, f)))
        console.log(`[Backup] Pruned ${toDelete.length} old backup(s)`)
      }
    }).catch((err: Error) => {
      console.error('[Backup] Failed:', err.message)
    })
  } catch (err) {
    console.error('[Backup] Error:', err)
  }
}
