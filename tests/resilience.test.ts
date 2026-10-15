import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { testEnv } from './env'

const dirs = testEnv({ WA_MAX_CONCURRENT_LAUNCHES: '2', WA_LAUNCH_TIMEOUT_MS: '300' })

// Legacy JSON state, as the previous version left it — imported on first open.
fs.writeFileSync(path.join(dirs.dataDir, 'sessions.json'), JSON.stringify(['legacy1']))
fs.mkdirSync(path.join(dirs.dataDir, 'legacy1'), { recursive: true })
fs.writeFileSync(
  path.join(dirs.dataDir, 'legacy1', 'queue.json'),
  JSON.stringify({
    jobs: [
      { id: 'msg_q', status: 'queued', kind: 'text', to: '+22890000001', toE164: '+22890000001', text: 'waiting', attempts: 0, createdAt: 1, updatedAt: 1 },
      { id: 'msg_s', status: 'sending', kind: 'text', to: '+22890000002', toE164: '+22890000002', text: 'mid-send', attempts: 1, createdAt: 2, updatedAt: 2 },
      { id: 'msg_m', status: 'queued', kind: 'media', to: '+22890000003', toE164: '+22890000003', media: { base64: 'QUJD', mimetype: 'image/png' }, attempts: 0, createdAt: 3, updatedAt: 3 }
    ],
    sentByDay: { '2026-10-14': 7 },
    firstDay: '2026-10-01',
    lastSentToRecipient: { '+22890000009': 5 }
  })
)

let db: typeof import('../src/core/db')
let gate: typeof import('../src/core/launchGate')
let lock: typeof import('../src/core/profileLock')

beforeAll(async () => {
  db = await import('../src/core/db')
  gate = await import('../src/core/launchGate')
  lock = await import('../src/core/profileLock')
})

describe('legacy JSON import', () => {
  it('moves sessions, jobs, counters and media into the database, once', () => {
    db.getDb()
    expect(db.all<{ id: string }>('SELECT id FROM sessions').map((r) => r.id)).toEqual(['legacy1'])
    expect(db.get<{ first_day: string }>("SELECT first_day FROM sessions WHERE id = 'legacy1'")?.first_day).toBe('2026-10-01')
    const jobs = db.all<{ id: string; status: string; verify: number; media_path: string | null }>('SELECT id, status, verify, media_path FROM jobs ORDER BY created_at')
    expect(jobs.map((j) => [j.id, j.status, j.verify])).toEqual([
      ['msg_q', 'queued', 0],
      ['msg_s', 'queued', 1], // caught mid-send: checked against the chat before going again
      ['msg_m', 'queued', 0]
    ])
    expect(fs.readFileSync(jobs[2].media_path!, 'utf8')).toBe('QUJD')
    expect(db.get<{ count: number }>("SELECT count FROM sent_per_day WHERE day = '2026-10-14'")?.count).toBe(7)
    expect(fs.existsSync(path.join(dirs.dataDir, 'sessions.json'))).toBe(false)
    expect(fs.existsSync(path.join(dirs.dataDir, 'sessions.json.migrated'))).toBe(true)
    expect(fs.existsSync(path.join(dirs.dataDir, 'legacy1', 'queue.json.migrated'))).toBe(true)
  })
})

describe('launch gate', () => {
  it('never runs more launches at once than allowed', async () => {
    let running = 0
    let peak = 0
    const launch = () =>
      gate.withLaunchSlot(async () => {
        running++
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 30))
        running--
      })
    await Promise.all(Array.from({ length: 7 }, launch))
    expect(peak).toBe(2)
  })

  it('frees the slots of launches that hang', async () => {
    // Both slots taken by launches that never settle…
    void gate.withLaunchSlot(() => new Promise<void>(() => {}))
    void gate.withLaunchSlot(() => new Promise<void>(() => {}))
    const started = Date.now()
    // …the next one still runs once their 300 ms timeout frees a slot.
    await expect(gate.withLaunchSlot(async () => 'ran')).resolves.toBe('ran')
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
  })

  it('spreads retries apart', () => {
    const delays = Array.from({ length: 50 }, () => gate.jitter(1000))
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(500)
    expect(Math.max(...delays)).toBeLessThanOrEqual(1500)
    expect(new Set(delays).size).toBeGreaterThan(10)
  })
})

describe('profile locks', () => {
  const profile = (cid: string) => path.join(dirs.sessionDir, `session-${cid}`)

  it('refuses a profile another live worker claims, takes over a stale claim', () => {
    fs.mkdirSync(profile('p1'), { recursive: true })
    const claim = (at: number) =>
      fs.writeFileSync(path.join(profile('p1'), '.courant-worker.lock'), JSON.stringify({ instance: 'other', host: 'elsewhere', pid: 1, at }))
    claim(Date.now())
    expect(lock.claimSession('p1')).toBe(false)
    claim(Date.now() - 5 * 60_000)
    expect(lock.claimSession('p1')).toBe(true)
    lock.releaseClaim('p1')
    expect(fs.existsSync(path.join(profile('p1'), '.courant-worker.lock'))).toBe(false)
  })

  it('removes a Chromium lock left by a dead process, keeps the one of the live browser', async () => {
    fs.mkdirSync(profile('p2'), { recursive: true })
    const lockFile = path.join(profile('p2'), 'SingletonLock')
    // A process that has exited: its pid is free.
    const dead = spawn(process.execPath, ['-e', '0'])
    await new Promise((r) => dead.on('exit', r))
    fs.symlinkSync(`${os.hostname()}-${dead.pid}`, lockFile)
    fs.writeFileSync(path.join(profile('p2'), 'SingletonCookie'), '')
    expect(lock.clearStaleChromiumLock('p2')).toBe(true)
    expect(fs.existsSync(path.join(profile('p2'), 'SingletonCookie'))).toBe(false)
    expect(() => fs.readlinkSync(lockFile)).toThrow()

    // The browser this session uses right now: never touched.
    fs.symlinkSync(`${os.hostname()}-${process.pid}`, lockFile)
    expect(lock.clearStaleChromiumLock('p2', process.pid)).toBe(false)
    expect(fs.readlinkSync(lockFile)).toBe(`${os.hostname()}-${process.pid}`)
  })

  it('removes a lock written by another host (a previous container)', () => {
    fs.mkdirSync(profile('p3'), { recursive: true })
    fs.symlinkSync('some-old-container-1234', path.join(profile('p3'), 'SingletonLock'))
    expect(lock.clearStaleChromiumLock('p3')).toBe(true)
  })
})
