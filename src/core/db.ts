/**
 * The worker's state in one SQLite file (Node's built-in `node:sqlite`, no
 * native module): the session registry, every session's job queue, its pacing
 * counters, and the webhook outbox.
 *
 * Why not a JSON file per session any more: rewriting a whole queue file on
 * every transition blocked the single event loop all sessions share (worse with
 * media in the jobs), and a crash or a full disk could leave memory and disk
 * apart. SQLite in WAL mode writes one row in microseconds, atomically.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { env } from '../config/env'
import { logger } from './logger'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  webhook_url TEXT,
  first_day   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  status          TEXT NOT NULL,
  kind            TEXT NOT NULL,
  to_raw          TEXT NOT NULL,
  to_e164         TEXT NOT NULL,
  text            TEXT,
  media           TEXT,
  media_path      TEXT,
  idempotency_key TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  wa_id           TEXT,
  error           TEXT,
  verify          INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_next ON jobs (session_id, status, created_at);
CREATE INDEX IF NOT EXISTS jobs_terminal ON jobs (status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs (session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS sent_per_day (
  session_id TEXT NOT NULL,
  day        TEXT NOT NULL,
  count      INTEGER NOT NULL,
  PRIMARY KEY (session_id, day)
);
CREATE TABLE IF NOT EXISTS recipient_last (
  session_id TEXT NOT NULL,
  to_e164    TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (session_id, to_e164)
);
CREATE TABLE IF NOT EXISTS outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  url          TEXT NOT NULL,
  type         TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_at      INTEGER NOT NULL,
  delivered_at INTEGER,
  dead         INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (delivered_at, dead, url, id);
`

let db: DatabaseSync | null = null

/** The database, opened (and migrated) on first use. */
export function getDb(): DatabaseSync {
  if (db) return db
  fs.mkdirSync(env.dataDir, { recursive: true })
  const file = path.join(env.dataDir, 'worker.db')
  db = new DatabaseSync(file)
  // WAL: readers never block the writer; NORMAL is durable across a process
  // crash (a power cut can lose the last instant, never corrupt the file).
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  migrateJsonState(db)
  logger.info('database ready', { file })
  return db
}

/** Runs `fn` in one transaction: all of it lands, or none. */
export function tx<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    d.exec('COMMIT')
    return out
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}

export const run = (sql: string, ...params: SQLInputValue[]) => getDb().prepare(sql).run(...params)
export const get = <T>(sql: string, ...params: SQLInputValue[]) => getDb().prepare(sql).get(...params) as T | undefined
export const all = <T>(sql: string, ...params: SQLInputValue[]) => getDb().prepare(sql).all(...params) as T[]

/** Close on shutdown, so the WAL is checkpointed into the main file. */
export function closeDb(): void {
  if (!db) return
  try {
    db.close()
  } catch {
    /* already closed */
  }
  db = null
}

// ── one-time import of the JSON files earlier versions kept ─────────────────────

interface LegacyJob {
  id: string
  status: string
  kind: string
  to: string
  toE164: string
  text?: string
  media?: { url?: string; base64?: string; mimetype?: string; filename?: string; caption?: string }
  idempotencyKey?: string
  attempts: number
  waId?: string
  error?: string
  createdAt: number
  updatedAt: number
}
interface LegacyQueue {
  jobs?: LegacyJob[]
  sentByDay?: Record<string, number>
  firstDay?: string | null
  lastSentToRecipient?: Record<string, number>
}

const safeDir = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'default'

/**
 * Imports sessions.json and every session's queue.json, then renames them
 * *.migrated so the import runs once. A message accepted before the upgrade is
 * neither lost nor sent twice.
 */
function migrateJsonState(d: DatabaseSync): void {
  const registry = path.join(env.dataDir, 'sessions.json')
  if (!fs.existsSync(registry)) return
  let ids: string[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(registry, 'utf8')) as unknown
    ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch (err) {
    logger.error('legacy registry unreadable, skipped', { error: (err as Error)?.message })
  }
  const now = Date.now()
  let jobs = 0
  d.exec('BEGIN IMMEDIATE')
  try {
    for (const id of ids) {
      const queueFile = path.join(env.dataDir, safeDir(id), 'queue.json')
      let q: LegacyQueue = {}
      try {
        q = JSON.parse(fs.readFileSync(queueFile, 'utf8')) as LegacyQueue
      } catch {
        /* no queue yet */
      }
      d.prepare('INSERT OR IGNORE INTO sessions (id, webhook_url, first_day, created_at) VALUES (?, NULL, ?, ?)').run(id, q.firstDay ?? null, now)
      for (const j of q.jobs ?? []) {
        let mediaPath: string | null = null
        let media: string | null = null
        if (j.media) {
          const { base64, ...meta } = j.media
          media = JSON.stringify(meta)
          if (base64) {
            mediaPath = path.join(env.dataDir, safeDir(id), 'media', j.id)
            fs.mkdirSync(path.dirname(mediaPath), { recursive: true })
            fs.writeFileSync(mediaPath, base64)
          }
        }
        // A job caught mid-send is re-checked against the chat before going again.
        const inFlight = j.status === 'sending'
        d.prepare(
          `INSERT OR IGNORE INTO jobs (id, session_id, status, kind, to_raw, to_e164, text, media, media_path, idempotency_key, attempts, wa_id, error, verify, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          j.id, id, j.status === 'sent' || j.status === 'failed' ? j.status : 'queued', j.kind, j.to, j.toE164,
          j.text ?? null, media, mediaPath, j.idempotencyKey ?? null, j.attempts ?? 0, j.waId ?? null, j.error ?? null,
          inFlight ? 1 : 0, j.createdAt ?? now, j.updatedAt ?? now
        )
        jobs++
      }
      for (const [day, count] of Object.entries(q.sentByDay ?? {}))
        d.prepare('INSERT OR REPLACE INTO sent_per_day (session_id, day, count) VALUES (?, ?, ?)').run(id, day, count)
      for (const [to, at] of Object.entries(q.lastSentToRecipient ?? {}))
        d.prepare('INSERT OR REPLACE INTO recipient_last (session_id, to_e164, at) VALUES (?, ?, ?)').run(id, to, at)
    }
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    // Leave the JSON files in place: the next start retries the import.
    logger.error('legacy state import failed', { error: (err as Error)?.message })
    return
  }
  for (const id of ids) {
    const queueFile = path.join(env.dataDir, safeDir(id), 'queue.json')
    if (fs.existsSync(queueFile)) fs.renameSync(queueFile, `${queueFile}.migrated`)
  }
  fs.renameSync(registry, `${registry}.migrated`)
  logger.info('imported legacy JSON state', { sessions: ids.length, jobs })
}
