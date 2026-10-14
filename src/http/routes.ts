import { Router } from 'express'
import type { Request, Response } from 'express'
import { session } from '../core/session'
import { queue } from '../core/queue'
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

// ── session ────────────────────────────────────────────────────────────────
v1.get(
  '/session',
  asyncH(async (_req, res) => {
    res.json(await session.getState())
  })
)

v1.post(
  '/session/logout',
  asyncH(async (_req, res) => {
    await session.logout()
    res.json({ ok: true })
  })
)

v1.post(
  '/session/restart',
  asyncH(async (_req, res) => {
    await session.restart()
    res.json({ ok: true })
  })
)

// ── numbers ──────────────────────────────────────────────────────────────────
v1.post(
  '/numbers/check',
  asyncH(async (req, res) => {
    const phone = String(req.body?.phone ?? '')
    if (!phone) {
      res.status(400).json({ error: 'phone is required' })
      return
    }
    const r = await session.checkNumber(phone)
    res.json({ phone, ...r })
  })
)

// ── messages ──────────────────────────────────────────────────────────────────
v1.post('/messages', (req: Request, res: Response) => {
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

  // text: accept `text` or the legacy `message`; media when a `media` object is present.
  const text: string | undefined = body.text ?? body.message
  const media: MediaPayload | undefined = body.media
  let req2: SendRequest
  if (media && (media.url || media.base64)) {
    req2 = { to, kind: 'media', media, idempotencyKey: body.idempotencyKey }
  } else if (typeof text === 'string' && text.length > 0) {
    req2 = { to, kind: 'text', text, idempotencyKey: body.idempotencyKey }
  } else {
    res.status(400).json({ error: 'provide a non-empty `text`, or a `media` with url/base64' })
    return
  }

  const job = queue.enqueue(req2)
  res.status(202).json({ id: job.id, status: job.status })
})

v1.get('/messages/:id', (req: Request, res: Response) => {
  const v = queue.view(String(req.params.id))
  if (!v) {
    res.status(404).json({ error: 'unknown job id' })
    return
  }
  res.json(v)
})

// ── metrics ───────────────────────────────────────────────────────────────────
v1.get('/metrics', (_req: Request, res: Response) => {
  res.json(queue.metrics())
})
