/**
 * Two Chromium processes on one WhatsApp profile corrupt it (the number has to
 * be paired again). Two guards:
 *
 * - An instance lock per session: a worker process claims a session's profile
 *   and refreshes the claim; another worker sharing the volume will not start
 *   that session while the claim is fresh.
 * - Chromium's own SingletonLock is removed only when it is really stale: the
 *   process it names is gone, or is a leftover of ours that we kill first. A
 *   lock held by a live browser this session still uses is left alone.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { env } from '../config/env'
import { logger } from './logger'

/** A claim not refreshed for this long belongs to a dead worker. */
const CLAIM_TTL_MS = 45_000
const CHROMIUM_LOCKS = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']

const profileDir = (cid: string) => path.join(env.sessionDir, `session-${cid}`)
const claimFile = (cid: string) => path.join(profileDir(cid), '.courant-worker.lock')

interface Claim {
  instance: string
  host: string
  pid: number
  at: number
}

function readClaim(cid: string): Claim | null {
  try {
    return JSON.parse(fs.readFileSync(claimFile(cid), 'utf8')) as Claim
  } catch {
    return null
  }
}

const isOurs = (c: Claim) => c.instance === env.instanceId && c.host === os.hostname() && c.pid === process.pid

/**
 * Claims the session's profile for this process. False when another live
 * worker holds it: the session must not start here.
 */
export function claimSession(cid: string): boolean {
  const current = readClaim(cid)
  if (current && !isOurs(current) && Date.now() - current.at < CLAIM_TTL_MS) {
    logger.error('session profile claimed by another worker', { session: cid, holder: current.instance, host: current.host })
    return false
  }
  return refreshClaim(cid)
}

/** Keeps the claim fresh; called on a timer while the session lives. */
export function refreshClaim(cid: string): boolean {
  try {
    fs.mkdirSync(profileDir(cid), { recursive: true })
    const claim: Claim = { instance: env.instanceId, host: os.hostname(), pid: process.pid, at: Date.now() }
    const tmp = `${claimFile(cid)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(claim))
    fs.renameSync(tmp, claimFile(cid))
    return true
  } catch (err) {
    logger.error('session claim write failed', { session: cid, error: (err as Error)?.message })
    return false
  }
}

export function releaseClaim(cid: string): void {
  const current = readClaim(cid)
  if (current && isOurs(current)) fs.rmSync(claimFile(cid), { force: true })
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists, it just is not ours to signal.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Removes Chromium's lock files when no live browser holds them. `keepPid` is
 * the browser this session is using right now: never killed. Returns false when
 * a live browser still holds the profile (the launch must wait).
 */
export function clearStaleChromiumLock(cid: string, keepPid?: number): boolean {
  const dir = profileDir(cid)
  let target = ''
  try {
    target = fs.readlinkSync(path.join(dir, 'SingletonLock'))
  } catch {
    // No lock (or not a symlink): only the stray companions can be left.
    for (const f of CHROMIUM_LOCKS) fs.rmSync(path.join(dir, f), { force: true })
    return true
  }
  // Chromium writes "<hostname>-<pid>".
  const dash = target.lastIndexOf('-')
  const host = target.slice(0, dash)
  const pid = Number(target.slice(dash + 1))
  // Another host: a previous container (our claim says nobody else runs it now).
  if (host === os.hostname() && Number.isInteger(pid) && pid > 0 && alive(pid)) {
    if (pid === keepPid) return false
    // A leftover of ours (a browser that outlived its client): stop it first.
    try {
      process.kill(pid, 'SIGKILL')
      logger.warn('killed a leftover Chromium holding the profile', { session: cid, pid })
    } catch (err) {
      logger.error('could not stop the Chromium holding the profile', { session: cid, pid, error: (err as Error)?.message })
      return false
    }
  }
  for (const f of CHROMIUM_LOCKS) fs.rmSync(path.join(dir, f), { force: true })
  return true
}
