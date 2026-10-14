/**
 * Owns the set of sessions (one per number). Keeps a small registry on disk so
 * every paired number is recreated on restart, and resumes its queue. Courant
 * addresses sessions by id (it uses the project id).
 */
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../config/env'
import { logger } from './logger'
import { Session, safeId } from './session'
import type { SessionSummary } from '../types'

class SessionManager {
  private sessions = new Map<string, Session>()
  private readonly registryFile = path.join(env.dataDir, 'sessions.json')

  /** Recreate persisted sessions on boot. */
  initAll(): void {
    for (const id of this.readRegistry()) this.spawn(id)
    logger.info('sessions restored', { count: this.sessions.size })
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

  /** Get, or create and start pairing. Idempotent. */
  create(id: string): Session {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const s = this.spawn(id)
    this.writeRegistry()
    logger.info('session created', { session: id })
    return s
  }

  private spawn(id: string): Session {
    const s = new Session(id)
    this.sessions.set(id, s)
    s.init()
    return s
  }

  /** Unlink the number and delete its data. */
  async remove(id: string): Promise<boolean> {
    const s = this.sessions.get(id)
    if (!s) return false
    try {
      await s.logout()
    } catch {
      /* ignore */
    }
    await s.shutdown()
    this.sessions.delete(id)
    this.writeRegistry()
    // Best-effort cleanup of the persisted session + queue.
    const cid = safeId(id)
    for (const dir of [path.join(env.sessionDir, `session-${cid}`), path.join(env.dataDir, cid)]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    logger.info('session removed', { session: id })
    return true
  }

  async shutdownAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.shutdown()))
  }

  // ── registry ────────────────────────────────────────────────────────────────
  private readRegistry(): string[] {
    try {
      const ids = JSON.parse(fs.readFileSync(this.registryFile, 'utf8')) as unknown
      return Array.isArray(ids) ? (ids.filter((x) => typeof x === 'string') as string[]) : []
    } catch {
      return []
    }
  }

  private writeRegistry(): void {
    try {
      fs.mkdirSync(env.dataDir, { recursive: true })
      const tmp = `${this.registryFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify([...this.sessions.keys()]))
      fs.renameSync(tmp, this.registryFile)
    } catch (err) {
      logger.error('registry save failed', { error: (err as Error)?.message })
    }
  }
}

export const manager = new SessionManager()
