/**
 * Durable, human-paced outbound queue — one per session, stored in SQLite.
 *
 * Jobs are drained one at a time with: a daily cap + optional warm-up ramp, an
 * optional quiet-hours window, a per-recipient minimum gap, a randomised human
 * delay between sends, and bounded retries. Each terminal job stays queryable
 * (and idempotent by idempotencyKey) for WA_JOB_TTL_MS. This is the only thing
 * that calls a session's send primitives, so pacing is enforced in exactly one
 * place per number.
 *
 * A job caught mid-send by a crash is re-checked against the chat before it
 * goes again, so a restart does not message the same person twice.
 */
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'
import { logger } from './logger'
import { emit } from './outbox'
import { all, get, run, tx } from './db'
import { SendError } from './errors'
import { toE164 } from '../utils/phone'
import { dayKeyInTz, hourInTz, humanDelay } from '../utils/time'
import { randomId } from '../utils/hmac'
import type { Job, JobStatus, JobView, MediaPayload, SendRequest } from '../types'

/** What the queue needs from its session to deliver a job. */
export interface Sender {
  isReady(): boolean
  sendText(to: string, text: string): Promise<{ waId: string }>
  sendMedia(to: string, media: MediaPayload): Promise<{ waId: string }>
  /** Was this exact text sent to `to` since `sinceMs`? Used after a crash, before sending again. */
  alreadySent(to: string, text: string, sinceMs: number): Promise<boolean>
}

/** Why the queue is not sending right now, for metrics and the status API. */
export type Hold = 'disconnected' | 'window' | 'cap' | null

interface JobRow {
  id: string
  session_id: string
  status: JobStatus
  kind: 'text' | 'media'
  to_raw: string
  to_e164: string
  text: string | null
  media: string | null
  media_path: string | null
  idempotency_key: string | null
  attempts: number
  wa_id: string | null
  error: string | null
  verify: number
  created_at: number
  updated_at: number
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  to: r.to_raw,
  toE164: r.to_e164,
  kind: r.kind,
  text: r.text ?? undefined,
  media: r.media ? (JSON.parse(r.media) as MediaPayload) : undefined,
  idempotencyKey: r.idempotency_key ?? undefined,
  status: r.status,
  attempts: r.attempts,
  waId: r.wa_id ?? undefined,
  error: r.error ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toView = (j: Job): JobView => ({
  id: j.id,
  status: j.status,
  to: j.toE164 || j.to,
  waId: j.waId,
  error: j.error,
  attempts: j.attempts,
  createdAt: new Date(j.createdAt).toISOString(),
  updatedAt: new Date(j.updatedAt).toISOString()
})

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`)
  const b = Date.parse(`${toKey}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

/** Terminal jobs past their TTL and stale per-recipient gaps, for every session. */
export function pruneAll(): void {
  const cutoff = Date.now() - env.jobTtlMs
  for (const r of all<{ media_path: string }>("SELECT media_path FROM jobs WHERE status IN ('sent','failed') AND updated_at < ? AND media_path IS NOT NULL", cutoff))
    fs.rmSync(r.media_path, { force: true })
  run("DELETE FROM jobs WHERE status IN ('sent','failed') AND updated_at < ?", cutoff)
  run('DELETE FROM recipient_last WHERE at < ?', Date.now() - Math.max(env.perRecipientMinMs, 24 * 60 * 60 * 1000))
}

export class Queue {
  private draining = false
  private stopped = false
  private hold: Hold = null
  private inFlight: Promise<void> | null = null
  /** Wakes a waiting drain loop early (stop, or a newly queued job). */
  private wake: (() => void) | null = null

  constructor(
    private readonly sessionId: string,
    private readonly mediaDir: string,
    private readonly sender: Sender
  ) {
    // A job left mid-send by a crash is checked against the chat before it goes again.
    const r = run("UPDATE jobs SET status = 'queued', verify = 1 WHERE session_id = ? AND status = 'sending'", sessionId)
    const pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE session_id = ? AND status = 'queued'", sessionId)?.n ?? 0
    logger.info('queue loaded', { session: sessionId, queued: pending, resumedMidSend: Number(r.changes) })
  }

  // ── public API ─────────────────────────────────────────────────────────────
  /** The job that sent a WhatsApp message (for its delivery receipts); null once pruned. */
  jobIdForWaId(waId: string): string | null {
    if (!waId) return null
    return get<{ id: string }>('SELECT id FROM jobs WHERE session_id = ? AND wa_id = ?', this.sessionId, waId)?.id ?? null
  }

  enqueue(req: SendRequest): Job {
    if (req.idempotencyKey) {
      const existing = get<JobRow>('SELECT * FROM jobs WHERE session_id = ? AND idempotency_key = ?', this.sessionId, req.idempotencyKey)
      if (existing) return toJob(existing)
    }
    const now = Date.now()
    const id = randomId('msg_')
    let mediaJson: string | null = null
    let mediaPath: string | null = null
    if (req.media) {
      // The base64 goes to a file: rows stay small however large the attachment.
      const { base64, ...meta } = req.media
      mediaJson = JSON.stringify(meta)
      if (base64) {
        mediaPath = path.join(this.mediaDir, id)
        fs.mkdirSync(this.mediaDir, { recursive: true })
        fs.writeFileSync(mediaPath, base64)
      }
    }
    run(
      `INSERT INTO jobs (id, session_id, status, kind, to_raw, to_e164, text, media, media_path, idempotency_key, attempts, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, this.sessionId, req.kind, req.to, toE164(req.to) || req.to, req.text ?? null, mediaJson, mediaPath, req.idempotencyKey ?? null, now, now
    )
    this.kick()
    return this.get(id)!
  }

  get(id: string): Job | undefined {
    const r = get<JobRow>('SELECT * FROM jobs WHERE id = ? AND session_id = ?', id, this.sessionId)
    return r ? toJob(r) : undefined
  }

  view(id: string): JobView | undefined {
    const j = this.get(id)
    return j ? toView(j) : undefined
  }

  metrics() {
    const byStatus: Record<string, number> = {}
    for (const r of all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM jobs WHERE session_id = ? GROUP BY status', this.sessionId)) byStatus[r.status] = r.n
    const oldest = get<{ at: number | null }>("SELECT MIN(created_at) AS at FROM jobs WHERE session_id = ? AND status = 'queued'", this.sessionId)?.at
    return {
      queued: byStatus.queued ?? 0,
      sentToday: this.sentToday(),
      dailyCap: Number.isFinite(this.effectiveCap()) ? this.effectiveCap() : null,
      total: Object.values(byStatus).reduce((s, n) => s + n, 0),
      byStatus,
      holding: this.hold,
      oldestQueuedAgeMs: oldest ? Date.now() - oldest : 0
    }
  }

  kick(): void {
    this.wake?.()
    void this.drain()
  }

  /** Stops the loop after the job in flight (if any) and waits for it. */
  async stop(): Promise<void> {
    this.stopped = true
    this.wake?.()
    await this.inFlight
  }

  // ── pacing policy ──────────────────────────────────────────────────────────
  private sentToday(): number {
    return get<{ count: number }>('SELECT count FROM sent_per_day WHERE session_id = ? AND day = ?', this.sessionId, dayKeyInTz(env.tz))?.count ?? 0
  }

  private effectiveCap(): number {
    let cap = env.dailyCap > 0 ? env.dailyCap : Number.POSITIVE_INFINITY
    if (env.warmupEnabled) {
      const first = get<{ first_day: string | null }>('SELECT first_day FROM sessions WHERE id = ?', this.sessionId)?.first_day
      const dayIndex = Math.max(0, daysBetween(first ?? dayKeyInTz(env.tz), dayKeyInTz(env.tz)))
      cap = Math.min(cap, Math.round(env.warmupStart * Math.pow(env.warmupGrowth, dayIndex)))
    }
    return cap
  }

  private inWindow(): boolean {
    const h = hourInTz(env.tz)
    return h >= env.windowStartHour && h < env.windowEndHour
  }

  private recipientWaitMs(to: string): number {
    const last = get<{ at: number }>('SELECT at FROM recipient_last WHERE session_id = ? AND to_e164 = ?', this.sessionId, to)?.at
    return last ? Math.max(0, env.perRecipientMinMs - (Date.now() - last)) : 0
  }

  private nextQueued(): JobRow | undefined {
    return get<JobRow>("SELECT * FROM jobs WHERE session_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1", this.sessionId)
  }

  /** Sleeps, unless stopped (or woken for `wakeable` waits). */
  private wait(ms: number, wakeable = false): Promise<void> {
    if (this.stopped) return Promise.resolve()
    return new Promise((resolve) => {
      const t = setTimeout(done, ms)
      function done() {
        clearTimeout(t)
        resolve()
      }
      // Pacing delays are not cut short by new work; only by a stop.
      this.wake = wakeable ? done : () => (this.stopped ? done() : undefined)
    })
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return
    this.draining = true
    try {
      while (!this.stopped) {
        const row = this.nextQueued()
        if (!row) break
        if (!this.sender.isReady()) {
          this.hold = 'disconnected'
          await this.wait(15_000, true)
          continue
        }
        if (!this.inWindow()) {
          this.hold = 'window'
          await this.wait(60_000)
          continue
        }
        if (this.sentToday() >= this.effectiveCap()) {
          this.hold = 'cap'
          await this.wait(5 * 60_000)
          continue
        }
        this.hold = null
        const gap = this.recipientWaitMs(row.to_e164)
        if (gap > 0) await this.wait(Math.min(gap, env.perRecipientMinMs))
        if (this.stopped) break
        this.inFlight = this.process(row)
        await this.inFlight
        this.inFlight = null
        if (this.nextQueued()) await this.wait(humanDelay(env.sendMinMs, env.sendMaxMs))
      }
    } finally {
      this.hold = null
      this.draining = false
    }
  }

  private loadMedia(row: JobRow): MediaPayload | undefined {
    if (!row.media) return undefined
    const meta = JSON.parse(row.media) as MediaPayload
    return row.media_path ? { ...meta, base64: fs.readFileSync(row.media_path, 'utf8') } : meta
  }

  private markSent(row: JobRow, waId: string): void {
    const now = Date.now()
    const day = dayKeyInTz(env.tz)
    tx(() => {
      run("UPDATE jobs SET status = 'sent', wa_id = ?, error = NULL, verify = 0, updated_at = ? WHERE id = ?", waId, now, row.id)
      run('INSERT INTO sent_per_day (session_id, day, count) VALUES (?, ?, 1) ON CONFLICT (session_id, day) DO UPDATE SET count = count + 1', this.sessionId, day)
      run('UPDATE sessions SET first_day = ? WHERE id = ? AND first_day IS NULL', day, this.sessionId)
      run('INSERT INTO recipient_last (session_id, to_e164, at) VALUES (?, ?, ?) ON CONFLICT (session_id, to_e164) DO UPDATE SET at = excluded.at', this.sessionId, row.to_e164, now)
    })
    if (row.media_path) fs.rmSync(row.media_path, { force: true })
    logger.info('sent', { session: this.sessionId, id: row.id, to: row.to_e164, waId })
    emit({ type: 'message.status', sessionId: this.sessionId, jobId: row.id, status: 'sent', to: row.to_e164, waId })
  }

  private async process(row: JobRow): Promise<void> {
    const attempts = row.attempts + 1
    run("UPDATE jobs SET status = 'sending', attempts = ?, updated_at = ? WHERE id = ?", attempts, Date.now(), row.id)
    try {
      // Left mid-send by a crash: if it is already in the chat, do not send it again.
      if (row.verify && row.kind === 'text' && row.text && (await this.sender.alreadySent(row.to_e164, row.text, row.updated_at - 60_000))) {
        logger.info('found in the chat after a restart, not sent again', { session: this.sessionId, id: row.id })
        this.markSent(row, '')
        return
      }
      const result = row.kind === 'media' ? await this.sender.sendMedia(row.to_e164, this.loadMedia(row)!) : await this.sender.sendText(row.to_e164, row.text ?? '')
      this.markSent(row, result.waId)
    } catch (err) {
      const e = err as SendError
      const retryable = e instanceof SendError ? e.retryable : true
      const now = Date.now()
      if (retryable && attempts < env.maxAttempts) {
        run("UPDATE jobs SET status = 'queued', error = ?, updated_at = ? WHERE id = ?", e.message, now, row.id)
        logger.warn('send failed, will retry', { session: this.sessionId, id: row.id, attempt: attempts, error: e.message })
        await this.wait(attempts * env.retryBaseMs)
      } else {
        run("UPDATE jobs SET status = 'failed', error = ?, verify = 0, updated_at = ? WHERE id = ?", e.message, now, row.id)
        if (row.media_path) fs.rmSync(row.media_path, { force: true })
        logger.error('send failed, giving up', { session: this.sessionId, id: row.id, error: e.message })
        emit({ type: 'message.status', sessionId: this.sessionId, jobId: row.id, status: 'failed', to: row.to_e164, error: e.message })
      }
    }
  }
}
