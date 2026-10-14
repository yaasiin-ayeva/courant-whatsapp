import express from 'express'
import type { Application } from 'express'
import { apiKeyAuth, rateLimit } from './auth'
import { v1 } from './routes'
import { session } from '../core/session'
import { logger } from '../core/logger'

export function buildApp(): Application {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '8mb' })) // room for base64 media

  app.use((req, _res, next) => {
    logger.debug('request', { method: req.method, path: req.path })
    next()
  })

  // Liveness — open, no auth, cheap. Reports readiness too.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, ready: session.isReady() })
  })

  app.use('/api/v1', rateLimit, apiKeyAuth, v1)

  app.use((_req, res) => res.status(404).json({ error: 'not found' }))

  return app
}
