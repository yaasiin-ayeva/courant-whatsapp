import { beforeAll, describe, expect, it } from 'vitest'
import { testEnv, until } from './env'

testEnv()

type Db = typeof import('../src/core/db')
type QueueModule = typeof import('../src/core/queue')
type Errors = typeof import('../src/core/errors')
let db: Db
let Q: QueueModule
let errors: Errors

beforeAll(async () => {
  db = await import('../src/core/db')
  Q = await import('../src/core/queue')
  errors = await import('../src/core/errors')
})

/** A sender that records what it sends; `fail` decides per call whether to throw. */
function fakeSender(opts: { fail?: (n: number) => Error | null; ready?: () => boolean; inChat?: string[] } = {}) {
  const sent: { to: string; text: string }[] = []
  let calls = 0
  return {
    sent,
    get calls() {
      return calls
    },
    isReady: () => (opts.ready ? opts.ready() : true),
    async sendText(to: string, text: string) {
      calls++
      const err = opts.fail?.(calls)
      if (err) throw err
      sent.push({ to, text })
      return { waId: `wa_${calls}` }
    },
    async sendMedia() {
      return { waId: 'media' }
    },
    async alreadySent(_to: string, text: string) {
      return (opts.inChat ?? []).includes(text)
    }
  }
}

let n = 0
const newSession = () => {
  const id = `s${++n}`
  db.run('INSERT INTO sessions (id, webhook_url, created_at) VALUES (?, ?, ?)', id, 'http://courant.test/hooks', Date.now())
  return id
}
const outboxTypes = (id: string) => db.all<{ body: string }>('SELECT body FROM outbox WHERE session_id = ? ORDER BY id', id).map((r) => JSON.parse(r.body))

describe('queue', () => {
  it('sends in order, counts once, and is idempotent by key', async () => {
    const id = newSession()
    const s = fakeSender()
    const q = new Q.Queue(id, '/tmp/unused', s)
    const a = q.enqueue({ to: '+22890000001', kind: 'text', text: 'one', idempotencyKey: 'k1' })
    const again = q.enqueue({ to: '+22890000001', kind: 'text', text: 'one', idempotencyKey: 'k1' })
    q.enqueue({ to: '+22890000002', kind: 'text', text: 'two' })
    expect(again.id).toBe(a.id)
    await until(() => s.sent.length === 2)
    await until(() => q.get(a.id)?.status === 'sent')
    expect(s.sent.map((m) => m.text)).toEqual(['one', 'two'])
    expect(q.metrics().sentToday).toBe(2)
    await until(() => outboxTypes(id).length === 2)
    expect(outboxTypes(id).map((e) => [e.type, e.status])).toEqual([
      ['message.status', 'sent'],
      ['message.status', 'sent']
    ])
    await q.stop()
  })

  it('retries a temporary failure, then gives up and reports it once', async () => {
    const id = newSession()
    const s = fakeSender({ fail: () => new Error('network blip') })
    const q = new Q.Queue(id, '/tmp/unused', s)
    const job = q.enqueue({ to: '+22890000003', kind: 'text', text: 'hello' })
    await until(() => q.get(job.id)?.status === 'failed')
    expect(s.calls).toBe(3)
    expect(q.get(job.id)?.attempts).toBe(3)
    const events = outboxTypes(id)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'message.status', status: 'failed', error: 'network blip' })
    await q.stop()
  })

  it('does not retry a permanent failure', async () => {
    const id = newSession()
    const s = fakeSender({ fail: () => errors.notOnWhatsApp('+22890000004') })
    const q = new Q.Queue(id, '/tmp/unused', s)
    const job = q.enqueue({ to: '+22890000004', kind: 'text', text: 'hi' })
    await until(() => q.get(job.id)?.status === 'failed')
    expect(s.calls).toBe(1)
    await q.stop()
  })

  it('after a crash mid-send, does not send again what is already in the chat', async () => {
    const id = newSession()
    const now = Date.now()
    // As a crash leaves them: marked sending, never marked sent.
    for (const [jobId, text] of [['msg_a', 'already delivered'], ['msg_b', 'never left']])
      db.run(
        "INSERT INTO jobs (id, session_id, status, kind, to_raw, to_e164, text, attempts, created_at, updated_at) VALUES (?, ?, 'sending', 'text', ?, ?, ?, 1, ?, ?)",
        jobId, id, '+22890000005', '+22890000005', text, now, now
      )
    const s = fakeSender({ inChat: ['already delivered'] })
    const q = new Q.Queue(id, '/tmp/unused', s)
    q.kick()
    await until(() => q.get('msg_a')?.status === 'sent' && q.get('msg_b')?.status === 'sent')
    expect(s.sent.map((m) => m.text)).toEqual(['never left'])
    await q.stop()
  })

  it('holds while the number is disconnected, and resumes on kick', async () => {
    const id = newSession()
    let ready = false
    const s = fakeSender({ ready: () => ready })
    const q = new Q.Queue(id, '/tmp/unused', s)
    const job = q.enqueue({ to: '+22890000006', kind: 'text', text: 'waiting' })
    await until(() => q.metrics().holding === 'disconnected')
    expect(q.get(job.id)?.status).toBe('queued')
    ready = true
    q.kick()
    await until(() => q.get(job.id)?.status === 'sent')
    await q.stop()
  })

  it('prunes terminal jobs past their time to live', async () => {
    const id = newSession()
    const old = Date.now() - 3 * 24 * 60 * 60 * 1000
    db.run(
      "INSERT INTO jobs (id, session_id, status, kind, to_raw, to_e164, text, attempts, created_at, updated_at) VALUES ('msg_old', ?, 'sent', 'text', 'x', 'x', 't', 1, ?, ?)",
      id, old, old
    )
    Q.pruneAll()
    expect(db.get('SELECT id FROM jobs WHERE id = ?', 'msg_old')).toBeUndefined()
  })
})
