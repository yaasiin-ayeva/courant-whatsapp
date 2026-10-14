/**
 * Courant WhatsApp worker — bootstrap.
 *
 * A standalone whatsapp-web.js service with an HTTP API, consumed by Courant like
 * the Google-Maps scraper (base URL + API key). See API.md for the full reference.
 *
 * ⚠️ Unofficial and against WhatsApp's ToS. Low-volume, opt-in / human-assisted
 * use only; pace it like a human; treat the number as disposable.
 */
import { env, validateEnv } from './config/env'
import { logger } from './core/logger'
import { session } from './core/session'
import { queue } from './core/queue'
import { buildApp } from './http/server'

function main(): void {
  validateEnv()
  logger.info('starting courant-whatsapp worker', {
    port: env.port,
    validateNumbers: env.validateNumbers,
    apiKeys: env.apiKeys.size,
    webhook: Boolean(env.webhookUrl),
  })

  session.init()
  queue.kick()

  const app = buildApp()
  const server = app.listen(env.port, () => logger.info(`listening on :${env.port}`))

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal })
    server.close()
    await session.shutdown()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason: String(reason) }))
}

main()
