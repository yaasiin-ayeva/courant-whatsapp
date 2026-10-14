/** Sends the "request an API key" form to the operator over SMTP. */
import nodemailer, { Transporter } from 'nodemailer'
import { env, mailConfigured } from '../config/env'
import { logger } from './logger'

export interface KeyRequest {
  name: string
  email: string
  company?: string
  volume?: string
  useCase?: string
}

let transporter: Transporter | null = null
function getTransport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  }
  return transporter
}

const esc = (s: string): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export async function sendKeyRequest(req: KeyRequest): Promise<void> {
  if (!mailConfigured()) throw new Error('mail is not configured')
  const rows = [
    ['Name', req.name],
    ['Email', req.email],
    ['Company', req.company || '—'],
    ['Expected volume', req.volume || '—'],
    ['Use case', req.useCase || '—'],
  ]
    .map(([k, v]) => `<tr><td style="padding:6px 12px;font-weight:600;color:#374151;white-space:nowrap">${esc(k)}</td><td style="padding:6px 12px;color:#111827">${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
    .join('')

  await getTransport().sendMail({
    from: env.smtp.from || env.smtp.user,
    to: env.contactEmail,
    replyTo: req.email,
    subject: `WhatsApp API key request — ${req.name}${req.company ? ` (${req.company})` : ''}`,
    text: `New API key request\n\nName: ${req.name}\nEmail: ${req.email}\nCompany: ${req.company || '-'}\nVolume: ${req.volume || '-'}\nUse case: ${req.useCase || '-'}`,
    html: `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:#128c7e;padding:18px 22px;color:#fff;font-size:1.05rem;font-weight:700">🔑 New API key request</div>
      <table style="width:100%;border-collapse:collapse;background:#f9fafb"><tbody>${rows}</tbody></table>
      <div style="padding:14px 22px;font-size:.78rem;color:#9ca3af">Courant WhatsApp Worker · ${new Date().toUTCString()}</div>
    </div>`,
  })
  logger.info('key request emailed', { to: env.contactEmail, from: req.email })
}
