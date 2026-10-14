import crypto from 'node:crypto'

/** Hex HMAC-SHA256 of `body` with `secret` — the webhook signature. */
export function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

export const randomId = (prefix = ''): string => `${prefix}${crypto.randomBytes(12).toString('hex')}`
