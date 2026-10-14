import type { Request, Response } from 'express'
import { mailConfigured } from '../config/env'
import { sendKeyRequest } from '../core/mailer'
import { logger } from '../core/logger'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const clip = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)

/** Public: the landing form posts an API-key request here; it is emailed to the operator. */
export async function requestKey(req: Request, res: Response): Promise<void> {
  const b = req.body ?? {}
  // Honeypot: real users leave this hidden field empty.
  if (clip(b.website, 100)) {
    res.json({ ok: true })
    return
  }
  const name = clip(b.name, 120)
  const email = clip(b.email, 160)
  if (!name || !EMAIL.test(email)) {
    res.status(400).json({ error: 'A name and a valid email are required.' })
    return
  }
  if (!mailConfigured()) {
    logger.warn('key request received but mail is not configured', { email })
    res.status(503).json({ error: 'Requests are temporarily unavailable. Please email us directly.' })
    return
  }
  try {
    await sendKeyRequest({ name, email, company: clip(b.company, 120), volume: clip(b.volume, 40), useCase: clip(b.useCase, 1000) })
    res.json({ ok: true })
  } catch (err) {
    logger.error('key request send failed', { error: (err as Error)?.message })
    res.status(502).json({ error: 'Could not send your request. Please try again or email us.' })
  }
}
