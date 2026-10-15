import express from 'express'
import type { Application } from 'express'
import { apiKeyAuth, rateLimit } from './auth'
import { v1 } from './routes'
import { requestKey } from './keyRequest'
import { openApiDocument } from './openapi'
import { docsHtml, landingHtml } from './pages'
import { ogImageBase64 } from './ogImage'
import { manager } from '../core/manager'
import { outboxMetrics } from '../core/outbox'
import { prometheus } from '../core/metrics'
import { logger } from '../core/logger'

export function buildApp(): Application {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '8mb' })) // room for base64 media

  app.use((req, _res, next) => {
    logger.debug('request', { method: req.method, path: req.path })
    next()
  })

  // Liveness — open, no auth, cheap. ?strict=1 answers 503 when no registered
  // number is connected (for a readiness probe or an uptime alert).
  app.get('/health', (req, res) => {
    const sessions = manager.list()
    const byStatus: Record<string, number> = {}
    for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1
    const ready = sessions.length === 0 || sessions.some((s) => s.status === 'connected')
    const ob = outboxMetrics()
    res.status(req.query.strict && !ready ? 503 : 200).json({
      ok: true,
      sessions: sessions.length,
      connected: byStatus.connected ?? 0,
      byStatus,
      ready,
      webhookBacklog: ob.pending,
    })
  })

  // Prometheus metrics (API key as a bearer token).
  app.get('/metrics', apiKeyAuth, (_req, res) => {
    res.type('text/plain; version=0.0.4').send(prometheus())
  })

  // Public landing + interactive API docs (Scalar) + the OpenAPI spec.
  app.get('/', (_req, res) => res.type('html').send(landingHtml))
  app.get('/docs', (_req, res) => res.type('html').send(docsHtml))
  app.get('/openapi.json', (_req, res) => res.json(openApiDocument))

  // SEO assets.
  app.get('/og.jpg', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400').type('image/jpeg').send(Buffer.from(ogImageBase64, 'base64'))
  })
  app.get('/robots.txt', (_req, res) =>
    res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://wa.yaasiin.dev/sitemap.xml\n')
  )
  app.get('/sitemap.xml', (_req, res) =>
    res
      .type('application/xml')
      .send(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          '  <url><loc>https://wa.yaasiin.dev/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n' +
          '  <url><loc>https://wa.yaasiin.dev/docs</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n' +
          '</urlset>\n'
      )
  )

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
