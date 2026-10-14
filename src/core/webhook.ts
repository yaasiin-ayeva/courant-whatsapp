/**
 * Delivers events to Courant over HTTP. Each POST is signed with HMAC-SHA256
 * (header X-Signature: sha256=<hex>) so Courant can verify it; X-Token carries
 * the raw secret for a simpler check. Fire-and-forget with a few retries —
 * never throws into the caller.
 */
import { env } from '../config/env'
import { logger } from './logger'
import { sign } from '../utils/hmac'
import { sleep } from '../utils/time'
import type { WebhookEvent } from '../types'

const MAX_TRIES = 4

export async function emit(event: WebhookEvent): Promise<void> {
  if (!env.webhookUrl) {
    logger.debug('webhook skipped (no COURANT_WEBHOOK_URL)', { type: event.type })
    return
  }
  const body = JSON.stringify({ ...event, sentAt: new Date().toISOString() })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.webhookToken) {
    headers['X-Token'] = env.webhookToken
    headers['X-Signature'] = `sha256=${sign(body, env.webhookToken)}`
  }

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 10_000)
      const res = await fetch(env.webhookUrl, { method: 'POST', headers, body, signal: ctrl.signal }).finally(() =>
        clearTimeout(t)
      )
      if (res.ok) return
      logger.warn('webhook non-2xx', { type: event.type, status: res.status, attempt })
    } catch (err) {
      logger.warn('webhook error', { type: event.type, attempt, error: (err as Error)?.message })
    }
    if (attempt < MAX_TRIES) await sleep(attempt * 2_000)
  }
  logger.error('webhook gave up', { type: event.type })
}
