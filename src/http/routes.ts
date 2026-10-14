import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { manager } from '../core/manager'
import type { Session } from '../core/session'
import { logger } from '../core/logger'
import { toE164 } from '../utils/phone'
import type { MediaPayload, SendRequest } from '../types'

export const v1 = Router()

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      logger.error('route error', { path: req.path, error: (err as Error)?.message })
      if (!res.headersSent) res.status(500).json({ error: (err as Error)?.message ?? 'internal error' })
    })
  }

const validId = (id: string): boolean => !!id && id.length <= 64 && /^[\w.@:-]+$/.test(id)

/** Resolve :id → a live session, or respond 400/404. Attaches it to res.locals. */
function withSession(req: Request, res: Response, next: NextFunction): void {
  const id = String(req.params.id ?? '')
  if (!validId(id)) {
    res.status(400).json({ error: 'invalid session id' })
    return
  }
  const s = manager.get(id)
  if (!s) {
    res.status(404).json({ error: 'unknown session' })
    return
  }
  res.locals.session = s
  next()
}
const sess = (res: Response): Session => res.locals.session as Session

// ── sessions ──────────────────────────────────────────────────────────────────
v1.get('/sessions', (_req, res) => {
  res.json({ sessions: manager.list() })
})

// Create (or get) a session and start pairing. Returns its state (with QR).
v1.post(
  '/sessions',
  asyncH(async (req, res) => {
    const id = String(req.body?.id ?? '')
    if (!validId(id)) {
      res.status(400).json({ error: 'invalid or missing session id' })
      return
    }
    const s = manager.create(id)
    res.status(201).json(await s.getState())
  })
)

v1.get('/sessions/:id', withSession, asyncH(async (_req, res) => {
  res.json(await sess(res).getState())
}))

v1.delete('/sessions/:id', withSession, asyncH(async (req, res) => {
  await manager.remove(String(req.params.id))
  res.json({ ok: true })
}))

v1.post('/sessions/:id/logout', withSession, asyncH(async (_req, res) => {
  await sess(res).logout()
  res.json({ ok: true })
}))

v1.post('/sessions/:id/restart', withSession, asyncH(async (_req, res) => {
  await sess(res).restart()
  res.json({ ok: true })
}))

// ── numbers ──────────────────────────────────────────────────────────────────
v1.post(
  '/sessions/:id/numbers/check',
  withSession,
  asyncH(async (req, res) => {
    const phone = String(req.body?.phone ?? '')
    if (!phone) {
      res.status(400).json({ error: 'phone is required' })
      return
    }
    res.json({ phone, ...(await sess(res).checkNumber(phone)) })
  })
)

// ── messages ──────────────────────────────────────────────────────────────────
v1.post('/sessions/:id/messages', withSession, (req: Request, res: Response) => {
  const body = req.body ?? {}
  const to = String(body.to ?? '')
  if (!to) {
    res.status(400).json({ error: 'to is required' })
    return
  }
  if (!toE164(to)) {
    res.status(400).json({ error: `to is not a valid E.164 number: ${to}` })
    return
  }
  const text: string | undefined = body.text ?? body.message
  const media: MediaPayload | undefined = body.media
  let payload: SendRequest
  if (media && (media.url || media.base64)) {
    payload = { to, kind: 'media', media, idempotencyKey: body.idempotencyKey }
  } else if (typeof text === 'string' && text.length > 0) {
    payload = { to, kind: 'text', text, idempotencyKey: body.idempotencyKey }
  } else {
    res.status(400).json({ error: 'provide a non-empty `text`, or a `media` with url/base64' })
    return
  }
  const job = sess(res).queue.enqueue(payload)
  res.status(202).json({ id: job.id, status: job.status })
})

v1.get('/sessions/:id/messages/:jobId', withSession, (req: Request, res: Response) => {
  const view = sess(res).queue.view(String(req.params.jobId))
  if (!view) {
    res.status(404).json({ error: 'unknown job id' })
    return
  }
  res.json(view)
})

v1.get('/sessions/:id/metrics', withSession, (_req: Request, res: Response) => {
  res.json(sess(res).queue.metrics())
})

// ── aggregate ─────────────────────────────────────────────────────────────────
v1.get('/metrics', (_req: Request, res: Response) => {
  const sessions = manager.list()
  res.json({
    sessions: sessions.length,
    connected: sessions.filter((s) => s.status === 'connected').length,
  })
})
