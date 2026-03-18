import nodemailer from 'nodemailer'
import { safeStorage } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getSetting } from '../db/index'

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
}

export function storeSmtpConfig(config: SmtpConfig): void {
  const encrypted = safeStorage.encryptString(JSON.stringify(config))
  fs.writeFileSync(path.join(app.getPath('userData'), 'smtp.enc'), encrypted)
}

export function loadSmtpConfig(): SmtpConfig | null {
  try {
    const p = path.join(app.getPath('userData'), 'smtp.enc')
    if (!fs.existsSync(p)) return null
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(p)))
  } catch { return null }
}

async function getTransporter(): Promise<nodemailer.Transporter | null> {
  const cfg = loadSmtpConfig()
  if (!cfg) return null
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password }
  })
}

export async function sendNotification(
  type: 'review_pending' | 'sync_error' | 'reauth_required' | 'file_processed' | 'report_ready' | 'flag_aging',
  data: Record<string, unknown>
): Promise<void> {
  const toEmail = getSetting('notification_email')
  if (!toEmail) return

  const threshold = parseInt(getSetting('review_email_threshold') || '1', 10)
  const transport = await getTransporter()
  if (!transport) return

  let subject = ''
  let html = ''

  switch (type) {
    case 'review_pending': {
      const count = data.count as number
      if (count < threshold) return
      subject = `[${count}] transaction${count > 1 ? 's' : ''} need your review — McQuire Tracker`
      const txList = (data.transactions as Array<{ date: string; merchant: string; amount: number; account: string }>)
        .map(t => `<tr><td>${t.date}</td><td>${t.merchant}</td><td style="text-align:right">$${Math.abs(t.amount).toFixed(2)}</td><td>${t.account}</td></tr>`)
        .join('')
      html = `
        <h2 style="color:#1F3864">McQuire Tracker — Review Required</h2>
        <p>${count} transaction${count > 1 ? 's' : ''} need your classification:</p>
        <table border="1" cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px">
          <thead style="background:#1F3864;color:white"><tr><th>Date</th><th>Merchant</th><th>Amount</th><th>Account</th></tr></thead>
          <tbody>${txList}</tbody>
        </table>
        <p style="margin-top:16px"><strong>Open the McQuire Tracker app</strong> to review and classify these transactions.</p>`
      break
    }

    case 'sync_error': {
      subject = `Sync error — ${data.institution} — McQuire Tracker`
      html = `<h2 style="color:#C00000">Sync Error</h2>
        <p><strong>Institution:</strong> ${data.institution}</p>
        <p><strong>Error:</strong> ${data.error}</p>
        <p>Open the McQuire Tracker app → Settings → Account Management to resolve.</p>`
      break
    }

    case 'reauth_required': {
      subject = `Action required: Re-authenticate ${data.institution} — McQuire Tracker`
      html = `<h2 style="color:#ED7D31">Re-authentication Required</h2>
        <p>Your ${data.institution} connection needs to be refreshed.</p>
        <ol>
          <li>Open McQuire Tracker</li>
          <li>Go to Settings → Account Management</li>
          <li>Click <strong>Re-authenticate</strong> next to ${data.institution}</li>
        </ol>`
      break
    }

    case 'file_processed': {
      subject = `[${data.count}] new transactions imported from ${data.source} — McQuire Tracker`
      html = `<h2 style="color:#1F3864">File Imported</h2>
        <p>${data.count} transactions were imported from <strong>${data.source}</strong>.</p>
        <ul>
          <li>Auto-classified: ${data.classified}</li>
          <li>Pending your review: ${data.queued}</li>
        </ul>
        <p>Open McQuire Tracker to review pending items.</p>`
      break
    }

    case 'report_ready': {
      subject = `Peak 10 expense report is ready to submit — McQuire Tracker`
      html = `<h2 style="color:#375623">Expense Report Ready</h2>
        <p><strong>Period:</strong> ${data.period}</p>
        <p><strong>Total:</strong> $${(data.total as number).toFixed(2)}</p>
        <p><strong>Line items:</strong> ${data.count}</p>
        <p>All blocking issues have been resolved. Open McQuire Tracker → Reports to export the submission file.</p>`
      break
    }

    case 'flag_aging': {
      subject = `[${data.count}] flagged transactions need attention — McQuire Tracker`
      html = `<h2 style="color:#C00000">Aging Flagged Items</h2>
        <p>${data.count} transaction${(data.count as number) > 1 ? 's' : ''} have been flagged for more than 7 days.</p>
        <p>Open McQuire Tracker → Review Queue to resolve them.</p>`
      break
    }
  }

  try {
    await transport.sendMail({
      from: `"McQuire Tracker" <${(loadSmtpConfig())?.user}>`,
      to: toEmail, subject, html
    })
    console.log(`[Email] Sent: ${subject}`)
  } catch (err) {
    console.error('[Email] Failed to send:', err)
  }
}

export async function sendTestEmail(toEmail: string): Promise<{ success: boolean; error?: string }> {
  const transport = await getTransporter()
  if (!transport) return { success: false, error: 'SMTP not configured' }
  try {
    await transport.sendMail({
      from: `"McQuire Tracker" <${(loadSmtpConfig())?.user}>`,
      to: toEmail,
      subject: 'McQuire Tracker — Test Email',
      html: '<h2>Test email from McQuire Tracker</h2><p>Your email notification settings are working correctly.</p>'
    })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
