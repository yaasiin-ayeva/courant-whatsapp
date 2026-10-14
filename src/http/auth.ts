import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'

const keyOf = (req: Request): string =>
  (req.get('X-API-Key') || (req.get('Authorization') || '').replace(/^Bearer\s+/i, '')).trim()

/** API-key gate. When no keys are configured the API is open (dev only). */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (env.apiKeys.size === 0 || env.apiKeys.has(keyOf(req))) return next()
  res.status(401).json({ error: 'invalid api key' })
}

// ── tiny fixed-window rate limiter (per key or IP) ─────────────────────────────
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 120
const hits = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const id = keyOf(req) || req.ip || 'anon'
  const now = Date.now()
  const slot = hits.get(id)
  if (!slot || slot.resetAt < now) {
    hits.set(id, { count: 1, resetAt: now + WINDOW_MS })
    return next()
  }
  if (slot.count >= MAX_PER_WINDOW) {
    res.status(429).json({ error: 'rate limit exceeded', retryAfterMs: slot.resetAt - now })
    return
  }
  slot.count += 1
  next()
}
