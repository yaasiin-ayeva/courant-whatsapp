/**
 * Courant WhatsApp worker — bootstrap.
 *
 * A standalone whatsapp-web.js service with an HTTP API, consumed by Courant like
 * the Google-Maps scraper (base URL + API key). See /docs for the API reference.
 *
 * ⚠️ Unofficial and against WhatsApp's ToS. Low-volume, opt-in / human-assisted
 * use only; pace it like a human; treat the number as disposable.
 */
import { env, validateEnv } from './config/env'
import { logger } from './core/logger'
import { closeDb, getDb } from './core/db'
import { manager } from './core/manager'
import { startOutbox, stopOutbox } from './core/outbox'
import { buildApp } from './http/server'

/** Shutdown must finish before Docker's stop grace period (60 s in compose). */
const SHUTDOWN_DEADLINE_MS = 45_000

function main(): void {
  validateEnv()
  logger.info('starting courant-whatsapp worker', {
    port: env.port,
    instance: env.instanceId,
    validateNumbers: env.validateNumbers,
    apiKeys: env.apiKeys.size,
    webhook: Boolean(env.webhookUrl),
    maxConcurrentLaunches: env.maxConcurrentLaunches
  })

  // The database first (it imports the JSON state of older versions once).
  getDb()
  startOutbox()
  // Recreate every paired number's session and resume its queue.
  manager.initAll()

  const app = buildApp()
  const server = app.listen(env.port, () => logger.info(`listening on :${env.port}`))

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info('shutting down', { signal })
    // Whatever happens below, exit before Docker kills the process mid-write.
    setTimeout(() => {
      logger.error('shutdown took too long, exiting')
      process.exit(1)
    }, SHUTDOWN_DEADLINE_MS).unref()
    server.close()
    // Each queue finishes the message in flight, then the browsers close.
    await manager.shutdownAll()
    await stopOutbox()
    closeDb()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason: String(reason) }))
}

main()
