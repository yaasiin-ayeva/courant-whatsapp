/**
 * Typed, validated environment. Fail fast on boot if something required is
 * missing, so the service never limps along half-configured.
 */
import 'dotenv/config'

function str(name: string, fallback = ''): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}
function num(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  return /^(1|true|yes|on)$/i.test(v)
}
function list(name: string): string[] {
  return str(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const env = {
  nodeEnv: str('NODE_ENV', 'production'),
  port: num('PORT', 8088),
  logLevel: str('LOG_LEVEL', 'info'),

  /** API keys clients present (X-API-Key / Bearer). Empty = API is open (dev only). */
  apiKeys: new Set(list('WA_API_KEYS')),

  /** Where inbound messages + delivery status are POSTed. Empty = log only. */
  webhookUrl: str('COURANT_WEBHOOK_URL'),
  /** Shared secret used to sign the webhook body (HMAC-SHA256, header X-Signature). */
  webhookToken: str('WA_WEBHOOK_TOKEN'),

  /** whatsapp-web.js session storage (one subfolder per session id). */
  sessionDir: str('SESSION_DIR', './.wwebjs_auth'),
  /** Durable queue + bookkeeping live here (mount a volume). */
  dataDir: str('DATA_DIR', './data'),
  /** Chromium path; set in the Docker image. */
  chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,

  /** Check the number is on WhatsApp before sending (getNumberId). */
  validateNumbers: bool('WA_VALIDATE_NUMBERS', true),

  /** Human-like pacing between two sends (ms). */
  sendMinMs: num('SEND_MIN_MS', 8_000),
  sendMaxMs: num('SEND_MAX_MS', 25_000),
  /** Typing simulation before a send (ms). */
  typingMinMs: num('TYPING_MIN_MS', 1_200),
  typingMaxMs: num('TYPING_MAX_MS', 6_000),
  typingPerCharMs: num('TYPING_PER_CHAR_MS', 45),

  /** Daily cap (0 = unlimited) and warm-up ramp. */
  dailyCap: num('DAILY_CAP', 0),
  warmupEnabled: bool('WARMUP_ENABLED', false),
  warmupStart: num('WARMUP_START', 40),
  warmupGrowth: num('WARMUP_GROWTH', 1.5),

  /** Optional quiet hours (local to TZ). Sends hold until the window opens. */
  tz: str('TZ', 'UTC'),
  windowStartHour: num('WINDOW_START_HOUR', 0),
  windowEndHour: num('WINDOW_END_HOUR', 24),

  /** Minimum gap between two messages to the same recipient (ms). */
  perRecipientMinMs: num('PER_RECIPIENT_MIN_MS', 60_000),

  /** Retries + how long terminal jobs stay queryable/idempotent. */
  maxAttempts: num('WA_MAX_ATTEMPTS', 3),
  jobTtlMs: num('WA_JOB_TTL_MS', 24 * 60 * 60 * 1000),

  /** Landing page "request an API key" form → emailed here via SMTP. */
  contactEmail: str('CONTACT_EMAIL', 'ayevayaasiin@gmail.com'),
  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('SMTP_FROM'),
  },
}

/** Can the "request a key" form actually send mail? */
export const mailConfigured = (): boolean => !!env.smtp.host && !!env.smtp.user && !!env.contactEmail

export function validateEnv(): void {
  const problems: string[] = []
  if (env.sendMinMs > env.sendMaxMs) problems.push('SEND_MIN_MS must be <= SEND_MAX_MS')
  if (env.typingMinMs > env.typingMaxMs) problems.push('TYPING_MIN_MS must be <= TYPING_MAX_MS')
  if (env.windowStartHour < 0 || env.windowEndHour > 24 || env.windowStartHour >= env.windowEndHour)
    problems.push('WINDOW_START_HOUR/WINDOW_END_HOUR invalid (need 0 <= start < end <= 24)')
  if (env.nodeEnv === 'production' && env.apiKeys.size === 0)
    problems.push('WA_API_KEYS is empty in production — the API would be unauthenticated')
  if (problems.length) throw new Error(`Invalid configuration:\n- ${problems.join('\n- ')}`)
}
