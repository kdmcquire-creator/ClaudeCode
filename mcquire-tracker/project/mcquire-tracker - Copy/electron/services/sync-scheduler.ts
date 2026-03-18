import cron from 'node-cron'
import { getSetting } from '../db/index'
import { getDb } from '../db/index'

let scheduledTask: cron.ScheduledTask | null = null

export function startScheduler(onSync: () => Promise<void>): void {
  stopScheduler()

  const enabled = getSetting('auto_sync_enabled') === '1'
  if (!enabled) return

  const cronExpr = getSetting('auto_sync_cron') || '0 2 * * *'

  try {
    scheduledTask = cron.schedule(cronExpr, async () => {
      console.log('[Scheduler] Running scheduled sync...')
      try { await onSync() }
      catch (err) { console.error('[Scheduler] Sync error:', err) }
    })
    console.log(`[Scheduler] Started with cron: ${cronExpr}`)
  } catch (err) {
    console.error('[Scheduler] Invalid cron expression:', cronExpr, err)
  }
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.destroy()
    scheduledTask = null
  }
}

export function shouldSyncOnLaunch(): boolean {
  const db = getDb()
  const row = db.prepare("SELECT MAX(completed_at) as last FROM sync_log WHERE status='success'").get() as { last: string | null }
  if (!row?.last) return true
  const lastSync = new Date(row.last)
  const hoursAgo = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60)
  return hoursAgo > 12
}
