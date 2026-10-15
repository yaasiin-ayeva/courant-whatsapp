import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testEnv, until } from './env'

testEnv()

let outbox: typeof import('../src/core/outbox')
let db: typeof import('../src/core/db')

/** A Courant stand-in: answers with whatever `status` says, records what it gets. */
const received: { body: Record<string, unknown>; signature: string }[] = []
let status = 200
let server: http.Server
let url = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (status === 200) received.push({ body: JSON.parse(raw), signature: String(req.headers['x-signature'] ?? '') })
      res.statusCode = status
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/whatsapp`
  db = await import('../src/core/db')
  outbox = await import('../src/core/outbox')
  db.run('INSERT INTO sessions (id, webhook_url, created_at) VALUES (?, ?, ?)', 'proj1', url, Date.now())
})

afterAll(async () => {
  await outbox.stopOutbox()
  server.close()
})

const status_ = (jobId: string) => ({ type: 'message.status' as const, sessionId: 'proj1', jobId, status: 'sent' as const, to: '+22890000001' })

describe('webhook outbox', () => {
  it('delivers to the session’s own URL, signed, with an event id', async () => {
    outbox.emit(status_('j1'))
    await until(() => received.length === 1)
    const { body, signature } = received[0]
    expect(body).toMatchObject({ type: 'message.status', jobId: 'j1' })
    expect(body.eventId).toBeTruthy()
    const raw = JSON.stringify(body)
    expect(signature).toBe(`sha256=${crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex')}`)
  })

  it('keeps events while the receiver is down, then delivers them in order', async () => {
    received.length = 0
    status = 503
    for (const j of ['a', 'b', 'c']) outbox.emit(status_(j))
    await until(() => (db.get<{ n: number }>('SELECT MAX(attempts) AS n FROM outbox WHERE delivered_at IS NULL')?.n ?? 0) >= 1)
    expect(received).toHaveLength(0)
    expect(outbox.outboxMetrics().pending).toBe(3)
    // The receiver is back: due them now rather than waiting for the backoff.
    status = 200
    db.run('UPDATE outbox SET next_at = 0 WHERE delivered_at IS NULL')
    outbox.startOutbox()
    await until(() => received.length === 3, 8_000)
    expect(received.map((r) => r.body.jobId)).toEqual(['a', 'b', 'c'])
    expect(outbox.outboxMetrics().pending).toBe(0)
  })

  it('skips events for a session with no destination', () => {
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')!.n
    outbox.emit({ ...status_('x'), sessionId: 'unknown-session' })
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')!.n).toBe(before)
  })
})
