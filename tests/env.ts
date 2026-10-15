import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Points the worker at a fresh temporary data folder with no pacing. Must run
 * before any module of src/ is imported: the config is read at import time.
 */
export function testEnv(overrides: Record<string, string> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-worker-'))
  const dataDir = path.join(root, 'data')
  const sessionDir = path.join(root, 'auth')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(sessionDir, { recursive: true })
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATA_DIR: dataDir,
    SESSION_DIR: sessionDir,
    SEND_MIN_MS: '0',
    SEND_MAX_MS: '0',
    PER_RECIPIENT_MIN_MS: '0',
    WA_RETRY_BASE_MS: '10',
    WA_MAX_ATTEMPTS: '3',
    COURANT_WEBHOOK_URL: '',
    WA_WEBHOOK_TOKEN: 'test-secret',
    ...overrides,
  })
  return { root, dataDir, sessionDir }
}

export const until = async (check: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}
