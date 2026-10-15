/**
 * Owns the set of sessions (one per number). The registry lives in the
 * database, so every paired number is recreated on restart and resumes its
 * queue. Courant addresses sessions by id (it uses the project id).
 *
 * On boot every session is started at once, but each launch waits for a slot
 * (launchGate): the numbers come up a few at a time instead of all fighting
 * for CPU and memory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'
import { logger } from './logger'
import { all, get, run, tx } from './db'
import { pruneAll } from './queue'
import { Session, safeId } from './session'
import type { SessionSummary } from '../types'

const PRUNE_EVERY_MS = 10 * 60_000

class SessionManager {
  private sessions = new Map<string, Session>()
  private pruneTimer: NodeJS.Timeout | null = null

  /** Recreate the registered sessions on boot. */
  initAll(): void {
    const ids = all<{ id: string }>('SELECT id FROM sessions ORDER BY created_at').map((r) => r.id)
    for (const id of ids) this.spawn(id)
    logger.info('sessions restored', { count: ids.length, startingAtOnce: env.maxConcurrentLaunches })
    pruneAll()
    this.pruneTimer = setInterval(() => {
      try {
        pruneAll()
      } catch (err) {
        logger.error('prune failed', { error: (err as Error)?.message })
      }
    }, PRUNE_EVERY_MS)
    this.pruneTimer.unref()
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => s.summary())
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  has(id: string): boolean {
    return this.sessions.has(id)
  }

  /**
   * Get, or create and start pairing. Idempotent. `webhookUrl` is where this
   * session's events go (one worker can serve several Courant environments);
   * passing it again updates it.
   */
  create(id: string, webhookUrl?: string): Session {
    if (webhookUrl !== undefined) {
      run(
        'INSERT INTO sessions (id, webhook_url, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET webhook_url = excluded.webhook_url',
        id, webhookUrl || null, Date.now()
      )
    } else {
      run('INSERT OR IGNORE INTO sessions (id, webhook_url, created_at) VALUES (?, NULL, ?)', id, Date.now())
    }
    const existing = this.sessions.get(id)
    if (existing) return existing
    logger.info('session created', { session: id })
    return this.spawn(id)
  }

  webhookUrl(id: string): string | null {
    return get<{ webhook_url: string | null }>('SELECT webhook_url FROM sessions WHERE id = ?', id)?.webhook_url ?? null
  }

  private spawn(id: string): Session {
    const s = new Session(id)
    this.sessions.set(id, s)
    s.start()
    return s
  }

  /** Unlink the number and delete everything it had: profile, queue, counters. */
  async remove(id: string): Promise<boolean> {
    const s = this.sessions.get(id)
    if (!s) return false
    try {
      await s.logout()
    } catch {
      /* unlinking is best effort; the data goes anyway */
    }
    await s.shutdown()
    this.sessions.delete(id)
    tx(() => {
      run('DELETE FROM jobs WHERE session_id = ?', id)
      run('DELETE FROM sent_per_day WHERE session_id = ?', id)
      run('DELETE FROM recipient_last WHERE session_id = ?', id)
      run('DELETE FROM sessions WHERE id = ?', id)
    })
    const cid = safeId(id)
    for (const dir of [path.join(env.sessionDir, `session-${cid}`), path.join(env.dataDir, cid)]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
    logger.info('session removed', { session: id })
    return true
  }

  /** Every session: its queue finishes the message in flight, its browser is closed. */
  async shutdownAll(): Promise<void> {
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    await Promise.allSettled([...this.sessions.values()].map((s) => s.shutdown()))
  }
}

export const manager = new SessionManager()
