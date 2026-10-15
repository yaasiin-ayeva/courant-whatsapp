/**
 * Webhook delivery that survives restarts: every event is written to the
 * outbox first, then delivered by a single loop — in order per destination,
 * with backoff, for up to WA_OUTBOX_MAX_AGE_MS. A Courant redeploy, a proxy 502
 * or a worker restart delays events; it no longer loses them (a STOP included).
 *
 * Each session may name its own destination (Courant passes its webhook URL
 * when it creates the session), so one worker can serve several Courant
 * environments; COURANT_WEBHOOK_URL is the fallback.
 *
 * Bodies are signed with HMAC-SHA256 (X-Signature: sha256=<hex>) and carry an
 * eventId, so the receiver can drop a duplicate (delivery is at-least-once).
 */
import { env } from '../config/env'
import { logger } from './logger'
import { all, get, run } from './db'
import { sign } from '../utils/hmac'
import type { WebhookEvent } from '../types'

const TICK_MS = 2_000
const MAX_BACKOFF_MS = 10 * 60_000
const PER_TICK_PER_URL = 50
const DELIVERED_KEEP_MS = 24 * 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let draining = false
let stopped = false

/** Where a session's events go: its own URL, else the worker-wide one. */
export function destinationFor(sessionId: string): string {
  const row = get<{ webhook_url: string | null }>('SELECT webhook_url FROM sessions WHERE id = ?', sessionId)
  return row?.webhook_url || env.webhookUrl
}

/** Queues an event for delivery. Never throws into the caller. */
export function emit(event: WebhookEvent): void {
  try {
    const url = destinationFor(event.sessionId)
    if (!url) {
      logger.debug('webhook skipped (no destination)', { type: event.type, session: event.sessionId })
      return
    }
    const now = Date.now()
    run('INSERT INTO outbox (session_id, url, type, body, created_at, next_at) VALUES (?, ?, ?, ?, ?, ?)', event.sessionId, url, event.type, JSON.stringify(event), now, now)
    kick()
  } catch (err) {
    logger.error('outbox write failed', { type: event.type, error: (err as Error)?.message })
  }
}

interface Row {
  id: number
  url: string
  type: string
  body: string
  created_at: number
  attempts: number
  next_at: number
}

async function deliver(row: Row): Promise<string | null> {
  const body = JSON.stringify({ ...JSON.parse(row.body), eventId: `${env.instanceId}:${row.id}`, sentAt: new Date().toISOString() })
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.webhookToken) {
    headers['X-Token'] = env.webhookToken
    headers['X-Signature'] = `sha256=${sign(body, env.webhookToken)}`
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(row.url, { method: 'POST', headers, body, signal: ctrl.signal })
    return res.ok ? null : `HTTP ${res.status}`
  } catch (err) {
    return (err as Error)?.message || 'network error'
  } finally {
    clearTimeout(t)
  }
}

/** One pass: for each destination, deliver its due events oldest first; stop at the first failure. */
async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const now = Date.now()
    const urls = all<{ url: string }>('SELECT DISTINCT url FROM outbox WHERE delivered_at IS NULL AND dead = 0')
    for (const { url } of urls) {
      for (let n = 0; n < PER_TICK_PER_URL && !stopped; n++) {
        const row = get<Row>('SELECT id, url, type, body, created_at, attempts, next_at FROM outbox WHERE url = ? AND delivered_at IS NULL AND dead = 0 ORDER BY id LIMIT 1', url)
        // Order is kept per destination: a later event waits behind one being retried.
        if (!row || row.next_at > Date.now()) break
        const error = await deliver(row)
        if (!error) {
          run('UPDATE outbox SET delivered_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?', Date.now(), row.id)
          continue
        }
        const attempts = row.attempts + 1
        if (Date.now() - row.created_at > env.outboxMaxAgeMs) {
          run('UPDATE outbox SET dead = 1, attempts = ?, last_error = ? WHERE id = ?', attempts, error, row.id)
          logger.error('webhook given up', { id: row.id, type: row.type, url, attempts, error })
          continue
        }
        const backoff = Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** Math.min(attempts, 12))
        run('UPDATE outbox SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?', attempts, Date.now() + backoff, error, row.id)
        if (attempts === 1 || attempts % 10 === 0) logger.warn('webhook delivery failed, will retry', { id: row.id, type: row.type, attempts, error, retryInMs: backoff })
        break
      }
    }
    run('DELETE FROM outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?', now - DELIVERED_KEEP_MS)
    run('DELETE FROM outbox WHERE dead = 1 AND created_at < ?', now - 7 * DELIVERED_KEEP_MS)
  } catch (err) {
    logger.error('outbox pass failed', { error: (err as Error)?.message })
  } finally {
    draining = false
  }
}

function kick(): void {
  if (!stopped) void drain()
}

export function startOutbox(): void {
  stopped = false
  timer = setInterval(kick, TICK_MS)
  timer.unref()
  kick()
}

/** Stops new passes; lets the current one finish (bounded by its 10 s requests). */
export async function stopOutbox(waitMs = 12_000): Promise<void> {
  stopped = true
  if (timer) clearInterval(timer)
  const until = Date.now() + waitMs
  while (draining && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
}

export function outboxMetrics() {
  const pending = get<{ n: number; oldest: number | null }>('SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM outbox WHERE delivered_at IS NULL AND dead = 0')
  const dead = get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE dead = 1')
  return { pending: pending?.n ?? 0, oldestPendingMs: pending?.oldest ? Date.now() - pending.oldest : 0, dead: dead?.n ?? 0 }
}
