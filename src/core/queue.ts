/**
 * Durable, human-paced outbound queue — one instance per session.
 *
 * Jobs are persisted to disk so a restart never drops a message, and are drained
 * one at a time with: a daily cap + optional warm-up ramp, an optional quiet-hours
 * window, a per-recipient minimum gap, a randomised human delay between sends, and
 * bounded retries. Each terminal job stays queryable (and idempotent by
 * idempotencyKey) for WA_JOB_TTL_MS. This is the only thing that calls a session's
 * send primitives, so pacing is enforced in exactly one place per number.
 */
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'
import { logger } from './logger'
import { emit } from './webhook'
import { SendError } from './errors'
import { toE164 } from '../utils/phone'
import { dayKeyInTz, hourInTz, humanDelay, sleep } from '../utils/time'
import { randomId } from '../utils/hmac'
import type { Job, JobView, MediaPayload, SendRequest } from '../types'

/** What the queue needs from its session to deliver a job. */
export interface Sender {
  isReady(): boolean
  sendText(to: string, text: string): Promise<{ waId: string }>
  sendMedia(to: string, media: MediaPayload): Promise<{ waId: string }>
}

interface Persisted {
  jobs: Job[]
  sentByDay: Record<string, number>
  firstDay: string | null
  lastSentToRecipient: Record<string, number>
}

const toView = (j: Job): JobView => ({
  id: j.id,
  status: j.status,
  to: j.toE164 || j.to,
  waId: j.waId,
  error: j.error,
  attempts: j.attempts,
  createdAt: new Date(j.createdAt).toISOString(),
  updatedAt: new Date(j.updatedAt).toISOString(),
})

const isTerminal = (s: string): boolean => s === 'sent' || s === 'failed'

function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`)
  const b = Date.parse(`${toKey}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

export class Queue {
  private jobs: Job[] = []
  private sentByDay: Record<string, number> = {}
  private firstDay: string | null = null
  private lastSentToRecipient: Record<string, number> = {}
  private draining = false

  constructor(
    private readonly sessionId: string,
    private readonly file: string,
    private readonly sender: Sender
  ) {
    this.load()
  }

  // ── persistence ────────────────────────────────────────────────────────────
  private load(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Persisted>
      this.jobs = Array.isArray(data.jobs) ? data.jobs : []
      this.sentByDay = data.sentByDay ?? {}
      this.firstDay = data.firstDay ?? null
      this.lastSentToRecipient = data.lastSentToRecipient ?? {}
      for (const j of this.jobs) if (j.status === 'sending' || j.status === 'held') j.status = 'queued'
      logger.info('queue loaded', { session: this.sessionId, jobs: this.jobs.length })
    } catch {
      logger.info('queue starting empty', { session: this.sessionId })
    }
  }

  private save(): void {
    const data: Persisted = { jobs: this.jobs, sentByDay: this.sentByDay, firstDay: this.firstDay, lastSentToRecipient: this.lastSentToRecipient }
    const tmp = `${this.file}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(data))
      fs.renameSync(tmp, this.file)
    } catch (err) {
      logger.error('queue save failed', { session: this.sessionId, error: (err as Error)?.message })
    }
  }

  private prune(): void {
    const cutoff = Date.now() - env.jobTtlMs
    this.jobs = this.jobs.filter((j) => !isTerminal(j.status) || j.updatedAt >= cutoff)
    for (const [k, t] of Object.entries(this.lastSentToRecipient)) if (t < Date.now() - 24 * 60 * 60 * 1000) delete this.lastSentToRecipient[k]
  }

  // ── public API ─────────────────────────────────────────────────────────────
  enqueue(req: SendRequest): Job {
    if (req.idempotencyKey) {
      const existing = this.jobs.find((j) => j.idempotencyKey === req.idempotencyKey)
      if (existing) return existing
    }
    const now = Date.now()
    const job: Job = { ...req, id: randomId('msg_'), toE164: toE164(req.to) || req.to, status: 'queued', attempts: 0, createdAt: now, updatedAt: now }
    this.jobs.push(job)
    this.save()
    void this.drain()
    return job
  }

  get(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  view(id: string): JobView | undefined {
    const j = this.get(id)
    return j ? toView(j) : undefined
  }

  metrics() {
    const today = dayKeyInTz(env.tz)
    const byStatus: Record<string, number> = {}
    for (const j of this.jobs) byStatus[j.status] = (byStatus[j.status] ?? 0) + 1
    return {
      queued: this.jobs.filter((j) => j.status === 'queued' || j.status === 'held').length,
      sentToday: this.sentByDay[today] ?? 0,
      dailyCap: this.effectiveCap(),
      total: this.jobs.length,
      byStatus,
    }
  }

  kick(): void {
    void this.drain()
  }

  // ── pacing policy ──────────────────────────────────────────────────────────
  private effectiveCap(): number {
    let cap = env.dailyCap > 0 ? env.dailyCap : Number.POSITIVE_INFINITY
    if (env.warmupEnabled) {
      const start = this.firstDay ?? dayKeyInTz(env.tz)
      const dayIndex = Math.max(0, daysBetween(start, dayKeyInTz(env.tz)))
      cap = Math.min(cap, Math.round(env.warmupStart * Math.pow(env.warmupGrowth, dayIndex)))
    }
    return cap
  }

  private capReached(): boolean {
    return (this.sentByDay[dayKeyInTz(env.tz)] ?? 0) >= this.effectiveCap()
  }

  private inWindow(): boolean {
    const h = hourInTz(env.tz)
    return h >= env.windowStartHour && h < env.windowEndHour
  }

  private recipientWaitMs(toE164Key: string): number {
    const last = this.lastSentToRecipient[toE164Key]
    return last ? Math.max(0, env.perRecipientMinMs - (Date.now() - last)) : 0
  }

  private nextQueued(): Job | undefined {
    return this.jobs.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0]
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const job = this.nextQueued()
        if (!job) break
        if (!this.sender.isReady()) {
          await sleep(15_000)
          continue
        }
        if (!this.inWindow()) {
          job.status = 'held'
          this.save()
          await sleep(60_000)
          job.status = 'queued'
          continue
        }
        if (this.capReached()) {
          job.status = 'held'
          this.save()
          await sleep(5 * 60_000)
          job.status = 'queued'
          continue
        }
        const wait = this.recipientWaitMs(job.toE164)
        if (wait > 0) await sleep(Math.min(wait, env.perRecipientMinMs))
        await this.process(job)
        if (this.nextQueued()) await sleep(humanDelay(env.sendMinMs, env.sendMaxMs))
      }
      this.prune()
      this.save()
    } finally {
      this.draining = false
    }
  }

  private async process(job: Job): Promise<void> {
    job.status = 'sending'
    job.attempts += 1
    job.updatedAt = Date.now()
    this.save()
    try {
      const result = job.kind === 'media' && job.media ? await this.sender.sendMedia(job.toE164, job.media) : await this.sender.sendText(job.toE164, job.text ?? '')
      job.status = 'sent'
      job.waId = result.waId
      job.updatedAt = Date.now()
      const day = dayKeyInTz(env.tz)
      this.sentByDay[day] = (this.sentByDay[day] ?? 0) + 1
      if (!this.firstDay) this.firstDay = day
      this.lastSentToRecipient[job.toE164] = Date.now()
      this.save()
      logger.info('sent', { session: this.sessionId, id: job.id, to: job.toE164, waId: job.waId })
      void emit({ type: 'message.status', sessionId: this.sessionId, jobId: job.id, status: 'sent', to: job.toE164, waId: job.waId })
    } catch (err) {
      const e = err as SendError
      const retryable = e instanceof SendError ? e.retryable : true
      if (retryable && job.attempts < env.maxAttempts) {
        job.status = 'queued'
        job.error = e.message
        job.updatedAt = Date.now()
        this.save()
        logger.warn('send failed, will retry', { session: this.sessionId, id: job.id, attempt: job.attempts, error: e.message })
        await sleep(job.attempts * 5_000)
      } else {
        job.status = 'failed'
        job.error = e.message
        job.updatedAt = Date.now()
        this.save()
        logger.error('send failed, giving up', { session: this.sessionId, id: job.id, error: e.message })
        void emit({ type: 'message.status', sessionId: this.sessionId, jobId: job.id, status: 'failed', to: job.toE164, error: e.message })
      }
    }
  }
}
