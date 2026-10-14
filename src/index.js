/**
 * Courant WhatsApp worker — a standalone transport built on whatsapp-web.js.
 *
 * It drives a real WhatsApp account through WhatsApp Web (a headless Chromium),
 * so there is no vendor/BSP and no per-message cost. It is UNOFFICIAL and against
 * WhatsApp's terms: use it for low-volume, opt-in / human-assisted messaging, pace
 * it like a human, and treat the number as disposable. Cold blasting gets numbers
 * banned.
 *
 * Run on a host with Chromium available (see Dockerfile). One worker = one number.
 *
 * HTTP API (authenticate with X-API-Key or "Authorization: Bearer <key>"):
 *   GET  /health                         -> { ok, ready }            (open)
 *   GET  /api/v1/status                  -> { ready, qr }  (qr is a data-URL to scan)
 *   POST /api/v1/send  { to, message }   -> queues a message
 *
 * Inbound messages are POSTed to COURANT_WEBHOOK_URL (with X-Token: WA_WEBHOOK_TOKEN)
 * when set — Courant verifies that token and handles replies / opt-out.
 */
import express from 'express'
import qrcode from 'qrcode'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg

const PORT = Number(process.env.PORT || 8088)
const API_KEYS = new Set((process.env.WA_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean))
const WEBHOOK_TOKEN = process.env.WA_WEBHOOK_TOKEN || ''
const WEBHOOK = process.env.COURANT_WEBHOOK_URL || ''
const SESSION_DIR = process.env.SESSION_DIR || './.wwebjs_auth'
const SEND_MIN = Number(process.env.SEND_MIN_MS || 8000)
const SEND_MAX = Number(process.env.SEND_MAX_MS || 25000)

let ready = false
let lastQr = null // raw QR string; served as a data-URL

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
})

client.on('qr', (qr) => { lastQr = qr; ready = false; console.log('[wa] QR updated — scan it at GET /status') })
client.on('ready', () => { ready = true; lastQr = null; console.log('[wa] ready') })
client.on('authenticated', () => console.log('[wa] authenticated'))
client.on('auth_failure', (m) => console.error('[wa] auth failure:', m))
client.on('disconnected', (r) => { ready = false; console.warn('[wa] disconnected:', r) })

client.on('message', async (msg) => {
  // Inbound message → forward to Courant (reply/opt-out handling lives there).
  const payload = { from: msg.from, to: msg.to, body: msg.body, id: msg.id?._serialized, timestamp: msg.timestamp }
  console.log('[wa] inbound from', msg.from)
  if (WEBHOOK) {
    try {
      await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': WEBHOOK_TOKEN }, body: JSON.stringify(payload) })
    } catch (e) { console.error('[wa] webhook failed:', e?.message) }
  }
})

client.initialize()

// ── Outbound queue with human-like pacing (ban-risk mitigation) ──────────────
const queue = []
let draining = false
const rand = (a, b) => a + Math.floor(Math.random() * Math.max(0, b - a))
const toChatId = (to) => {
  const digits = String(to).replace(/[^\d]/g, '')
  return digits ? `${digits}@c.us` : null
}
async function drain() {
  if (draining) return
  draining = true
  while (queue.length) {
    const job = queue.shift()
    try {
      if (!ready) throw new Error('not connected (scan the QR at /status)')
      const chatId = toChatId(job.to)
      if (!chatId) throw new Error('invalid recipient')
      const sent = await client.sendMessage(chatId, job.message)
      job.resolve({ id: sent.id?._serialized })
    } catch (e) {
      job.reject(e)
    }
    if (queue.length) await new Promise((r) => setTimeout(r, rand(SEND_MIN, SEND_MAX)))
  }
  draining = false
}

// ── HTTP API (internal) ──────────────────────────────────────────────────────
const app = express()
app.use(express.json({ limit: '256kb' }))
const keyOf = (req) => req.get('X-API-Key') || (req.get('Authorization') || '').replace(/^Bearer /i, '')
const auth = (req, res, next) => (API_KEYS.size === 0 || API_KEYS.has(keyOf(req)) ? next() : res.status(401).json({ error: 'invalid api key' }))

app.get('/health', (_req, res) => res.json({ ok: true, ready }))

const v1 = express.Router()
v1.use(auth)
v1.get('/status', async (_req, res) => {
  res.json({ ready, qr: lastQr ? await qrcode.toDataURL(lastQr) : null })
})
v1.post('/send', (req, res) => {
  const { to, message } = req.body || {}
  if (!to || !message) return res.status(400).json({ error: 'to and message are required' })
  new Promise((resolve, reject) => {
    queue.push({ to, message, resolve, reject })
    drain()
  }).then((r) => res.json({ queued: true, ...r })).catch((e) => res.status(502).json({ error: e?.message || 'send failed' }))
})
app.use('/api/v1', v1)

app.listen(PORT, () => console.log(`[wa] worker on :${PORT} (session ${SESSION_DIR})`))
