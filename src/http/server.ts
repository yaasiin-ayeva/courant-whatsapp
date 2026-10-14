import express from 'express'
import type { Application } from 'express'
import { apiKeyAuth, rateLimit } from './auth'
import { v1 } from './routes'
import { requestKey } from './keyRequest'
import { openApiDocument } from './openapi'
import { docsHtml, landingHtml } from './pages'
import { manager } from '../core/manager'
import { logger } from '../core/logger'

export function buildApp(): Application {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '8mb' })) // room for base64 media

  app.use((req, _res, next) => {
    logger.debug('request', { method: req.method, path: req.path })
    next()
  })

  // Liveness — open, no auth, cheap. Reports how many sessions are connected.
  app.get('/health', (_req, res) => {
    const sessions = manager.list()
    res.json({
      ok: true,
      sessions: sessions.length,
      connected: sessions.filter((s) => s.status === 'connected').length,
      ready: sessions.some((s) => s.status === 'connected'),
    })
  })

  // Public landing + interactive API docs (Scalar) + the OpenAPI spec.
  app.get('/', (_req, res) => res.type('html').send(landingHtml))
  app.get('/docs', (_req, res) => res.type('html').send(docsHtml))
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument))

  // Public (no API key): the landing form requests a key → emailed to the operator.
  app.post('/api/v1/request-key', rateLimit, (req, res) => {
    requestKey(req, res).catch(() => {
      if (!res.headersSent) res.status(500).json({ error: 'internal error' })
    })
  })

  app.use('/api/v1', rateLimit, apiKeyAuth, v1)

  app.use((_req, res) => res.status(404).json({ error: 'not found' }))

  return app
}
