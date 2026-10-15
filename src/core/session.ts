/**
 * One WhatsApp session: a whatsapp-web.js client for a single number, plus its
 * own durable outbound queue. Owns the lifecycle (QR pairing, reconnects), the
 * humanised send primitives, number validation, and forwarding inbound messages
 * to Courant (tagged with this session's id). The SessionManager owns a set of
 * these — one per paired number.
 *
 * Lifecycle rules, each one a failure seen or foreseen with many numbers:
 * - One launch path. A disconnect, a failed launch and a manual restart all go
 *   through `launch()`, guarded by a single timer and a `launching` flag, so a
 *   session can never start two browsers.
 * - Every launch waits for a slot (launchGate): numbers start a few at a time.
 * - Before a relaunch the old browser is closed, and killed if it does not exit;
 *   Chromium's profile lock is removed only when no live browser holds it.
 * - Reconnects back off exponentially with jitter. After WA_MAX_RECONNECTS
 *   failures in a row the session is marked in error (and retried slowly).
 * - Logged out or banned: the browser is stopped (no RAM burnt for nothing),
 *   queued messages wait, Courant is told. A restart brings a new QR.
 * - A connected session is probed: a browser killed by the kernel sends no
 *   event, the probe notices.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import pkg from 'whatsapp-web.js'
import type { Client as WAClient, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode'
import { buildClientConfig } from '../config/client'
import { env } from '../config/env'
import { logger } from './logger'
import { emit } from './outbox'
import { invalidRecipient, notConnected, notOnWhatsApp } from './errors'
import { Queue, Sender } from './queue'
import { jitter, withLaunchSlot } from './launchGate'
import { claimSession, clearStaleChromiumLock, refreshClaim, releaseClaim } from './profileLock'
import { humanDelay, sleep } from '../utils/time'
import { toChatId, toDigits } from '../utils/phone'
import type { MediaPayload, SessionState, SessionStatus, SessionSummary } from '../types'

const { Client, MessageMedia } = pkg

/**
 * clientId / data-dir safe form of a session id. An id that is already safe
 * (Courant's project ids) is kept as is; any other gets a hash suffix, so two
 * ids that differ only by punctuation never share a profile.
 */
export const safeId = (id: string): string => {
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'default'
  return clean === id ? clean : `${clean.slice(0, 55)}-${createHash('sha1').update(id).digest('hex').slice(0, 8)}`
}

/** WhatsApp's reasons that mean the number is unlinked or blocked, not just offline. */
const LOGGED_OUT = new Set(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'TOS_BLOCK', 'SMB_TOS_BLOCK'])

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export class Session implements Sender {
  readonly id: string
  readonly queue: Queue
  private readonly cid: string
  private client: WAClient | null = null
  /** Bumped on every launch: events from an older client are ignored. */
  private generation = 0
  private status: SessionStatus = 'disconnected'
  private lastQr: string | null = null
  private lastError: string | undefined
  private startedAt = Date.now()
  /** Failed launches / disconnects in a row (reset when ready). */
  private failures = 0
  private reconnects = 0
  private launching = false
  private destroyed = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private probeTimer: NodeJS.Timeout | null = null
  private claimTimer: NodeJS.Timeout | null = null
  private probeFailures = 0

  constructor(id: string) {
    this.id = id
    this.cid = safeId(id)
    this.queue = new Queue(id, path.join(env.dataDir, this.cid, 'media'), this)
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /** Claims the profile, then launches. Called once by the manager. */
  start(): void {
    if (!claimSession(this.cid)) {
      this.setStatus('locked', 'another worker process runs this number')
      // Take it over once the other worker's claim expires.
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.destroyed) this.start()
      }, 60_000)
      return
    }
    this.claimTimer = setInterval(() => refreshClaim(this.cid), 15_000)
    this.claimTimer.unref()
    void this.launch()
  }

  /** The only way a browser is started. */
  private async launch(): Promise<void> {
    if (this.destroyed || this.launching) return
    this.launching = true
    this.clearReconnectTimer()
    const generation = ++this.generation
    try {
      await withLaunchSlot(async () => {
        if (this.destroyed || generation !== this.generation) return
        await this.teardownClient()
        // A newer launch (a restart) took over during the teardown: it owns the profile now.
        if (this.destroyed || generation !== this.generation) return
        if (!clearStaleChromiumLock(this.cid)) throw new Error('the profile is still held by a running browser')
        const client = new Client(buildClientConfig(this.cid))
        this.client = client
        this.wire(client, generation)
        await withTimeout(client.initialize(), env.launchTimeoutMs, 'launch')
      })
    } catch (err) {
      if (generation === this.generation && !this.destroyed) {
        this.lastError = (err as Error)?.message
        logger.error('launch failed', { session: this.id, error: this.lastError, failures: this.failures + 1 })
        this.launching = false
        this.scheduleReconnect()
        return
      }
    }
    this.launching = false
  }

  private wire(client: WAClient, generation: number): void {
    const current = () => generation === this.generation && !this.destroyed
    client.on('qr', (qr: string) => {
      if (!current()) return
      this.lastQr = qr
      this.setStatus('scanning')
    })
    client.on('authenticated', () => current() && logger.info('authenticated', { session: this.id }))
    client.on('ready', () => {
      if (!current()) return
      this.lastQr = null
      this.failures = 0
      this.lastError = undefined
      this.setStatus('connected')
      logger.info('ready', { session: this.id, phone: client.info?.wid?.user, pushName: client.info?.pushname })
      // A browser killed by the kernel: whatsapp-web.js does not report it.
      client.pupBrowser?.on('disconnected', () => current() && this.wentDown('the browser exited'))
      this.startProbe()
      this.queue.kick()
    })
    client.on('auth_failure', (m: string) => current() && this.loggedOut(`authentication failed: ${m}`))
    client.on('disconnected', (reason: string) => {
      if (!current()) return
      if (LOGGED_OUT.has(String(reason))) this.loggedOut(String(reason))
      else this.wentDown(String(reason))
    })
    client.on('message', (msg: Message) => current() && void this.onInbound(msg))
  }

  /** Offline but still paired: reconnect. */
  private wentDown(reason: string): void {
    if (this.status === 'logged_out' || this.destroyed) return
    this.stopProbe()
    this.lastQr = null
    this.lastError = reason
    this.setStatus('disconnected', reason)
    logger.warn('disconnected', { session: this.id, reason })
    this.scheduleReconnect()
  }

  /** Unlinked or banned: stop the browser, keep the queue, wait for a re-pairing. */
  private loggedOut(reason: string): void {
    this.stopProbe()
    this.clearReconnectTimer()
    this.lastQr = null
    this.lastError = reason
    this.setStatus('logged_out', reason)
    logger.error('logged out — pair the number again (restart)', { session: this.id, reason })
    this.generation++ // late events of this client are ignored
    void this.teardownClient()
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.status === 'logged_out' || this.reconnectTimer || this.launching) return
    this.failures++
    this.reconnects++
    let delay: number
    if (this.failures > env.maxReconnects) {
      if (this.status !== 'error') logger.error('kept failing to start — marked in error, retrying slowly', { session: this.id, failures: this.failures })
      this.setStatus('error', this.lastError)
      delay = env.reconnectMaxMs
    } else {
      delay = Math.min(env.reconnectMaxMs, env.reconnectBaseMs * 2 ** (this.failures - 1))
    }
    delay = jitter(delay)
    logger.info('reconnecting', { session: this.id, inMs: delay, failures: this.failures })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.launch()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  /** Closes the client and makes sure its browser is gone (killed if it does not exit). */
  private async teardownClient(): Promise<void> {
    const client = this.client
    if (!client) return
    this.client = null
    const pid = client.pupBrowser?.process()?.pid
    try {
      await withTimeout(client.destroy(), 10_000, 'browser close')
    } catch (err) {
      logger.warn('browser did not close cleanly', { session: this.id, error: (err as Error)?.message })
    }
    client.removeAllListeners()
    if (pid) {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGKILL')
        logger.warn('killed a browser that outlived its client', { session: this.id, pid })
      } catch {
        /* already gone — the normal case */
      }
    }
  }

  private startProbe(): void {
    this.stopProbe()
    this.probeFailures = 0
    this.probeTimer = setInterval(() => void this.probe(), env.healthProbeMs)
    this.probeTimer.unref()
  }

  private stopProbe(): void {
    if (this.probeTimer) clearInterval(this.probeTimer)
    this.probeTimer = null
  }

  /** Two failed probes in a row (no answer, or not CONNECTED) count as a disconnect. */
  private async probe(): Promise<void> {
    if (this.status !== 'connected' || !this.client) return
    try {
      const state = await withTimeout(this.client.getState(), 20_000, 'health probe')
      this.probeFailures = String(state) === 'CONNECTED' ? 0 : this.probeFailures + 1
    } catch {
      this.probeFailures++
    }
    if (this.probeFailures >= 2) this.wentDown('health probe failed')
  }

  private setStatus(status: SessionStatus, reason?: string): void {
    if (this.status === status) return
    this.status = status
    emit({
      type: 'session.status',
      sessionId: this.id,
      status,
      ...(status === 'connected' && this.client?.info?.wid?.user ? { phone: this.client.info.wid.user } : {}),
      ...(reason ? { reason } : {})
    })
  }

  // ── inbound ────────────────────────────────────────────────────────────────

  /**
   * The sender's number in E.164, '' when it cannot be known (a group, a
   * channel). WhatsApp now often names a person by a @lid, which holds no phone
   * number; the client can map it back to one.
   */
  private async phoneOf(jid: string): Promise<string> {
    const [user, server] = String(jid).split('@')
    if (server === 'c.us') return user ? `+${user}` : ''
    if (server !== 'lid' || !this.client) return ''
    try {
      const [r] = await this.client.getContactLidAndPhone([jid])
      const pn = r?.pn?.split('@')[0]
      return pn ? `+${pn}` : ''
    } catch (err) {
      logger.debug('lid to phone lookup failed', { session: this.id, error: (err as Error)?.message })
      return ''
    }
  }

  private async onInbound(msg: Message): Promise<void> {
    try {
      if (msg.fromMe || msg.isStatus) return
      emit({
        type: 'message.inbound',
        sessionId: this.id,
        from: msg.from,
        fromPhone: await this.phoneOf(msg.from),
        to: msg.to,
        body: msg.body ?? '',
        messageId: msg.id?._serialized ?? '',
        timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
        hasMedia: Boolean(msg.hasMedia),
        messageType: String(msg.type ?? 'unknown')
      })
    } catch (err) {
      logger.error('inbound handling failed', { session: this.id, error: (err as Error)?.message })
    }
  }

  // ── state ──────────────────────────────────────────────────────────────────

  isReady(): boolean {
    return this.status === 'connected' && !!this.client
  }

  summary(): SessionSummary {
    const s: SessionSummary = { id: this.id, status: this.status, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000), reconnects: this.reconnects }
    if (this.lastError) s.lastError = this.lastError
    if (this.status === 'connected') {
      s.phone = this.client?.info?.wid?.user
      s.pushName = this.client?.info?.pushname
    }
    return s
  }

  async getState(): Promise<SessionState> {
    const base: SessionState = { ...this.summary(), holding: this.queue.metrics().holding }
    if (this.status === 'scanning' && this.lastQr) base.qr = await qrcode.toDataURL(this.lastQr)
    return base
  }

  // ── sending ────────────────────────────────────────────────────────────────

  private connected(): WAClient {
    if (!this.isReady() || !this.client) throw notConnected()
    return this.client
  }

  async checkNumber(to: string): Promise<{ exists: boolean; waId?: string }> {
    const client = this.connected()
    const digits = toDigits(to)
    if (!digits) throw invalidRecipient(to)
    const id = await client.getNumberId(digits)
    return id ? { exists: true, waId: id._serialized } : { exists: false }
  }

  private async resolveChatId(client: WAClient, to: string): Promise<string> {
    const digits = toDigits(to)
    if (!digits) throw invalidRecipient(to)
    const chatId = toChatId(to)
    if (!chatId) throw invalidRecipient(to)
    if (env.validateNumbers) {
      // Confirm the number is on WhatsApp — but do NOT send to the id this returns.
      // getNumberId now yields a @lid (WhatsApp's new LID identity); sending to a
      // @lid chat id is broken in whatsapp-web.js (sendMessage resolves undefined →
      // "Cannot read properties of undefined (reading 'id')"). The classic phone JID
      // (@c.us) still routes correctly, so we validate here but send to @c.us below.
      const id = await client.getNumberId(digits)
      if (!id) throw notOnWhatsApp(to)
    }
    return chatId
  }

  private async simulateTyping(client: WAClient, chatId: string, textLength: number): Promise<void> {
    try {
      await client.sendPresenceAvailable()
      const chat = await client.getChatById(chatId)
      await chat.sendStateTyping()
      const typingMs = Math.min(env.typingMaxMs, Math.max(env.typingMinMs, Math.round(textLength * env.typingPerCharMs + humanDelay(0, 800))))
      await sleep(typingMs)
      await chat.clearState()
    } catch (err) {
      logger.debug('typing simulation skipped', { session: this.id, error: (err as Error)?.message })
    }
  }

  async sendText(to: string, text: string): Promise<{ waId: string }> {
    const client = this.connected()
    const chatId = await this.resolveChatId(client, to)
    await this.simulateTyping(client, chatId, text.length)
    const sent = await client.sendMessage(chatId, text)
    // sendMessage can resolve undefined even on a delivered message when the Store
    // serialization is out of sync; never crash on the return value.
    return { waId: sent?.id?._serialized ?? '' }
  }

  async sendMedia(to: string, media: MediaPayload): Promise<{ waId: string }> {
    const client = this.connected()
    const chatId = await this.resolveChatId(client, to)
    const attachment = media.url
      ? await MessageMedia.fromUrl(media.url, { unsafeMime: true })
      : new MessageMedia(media.mimetype ?? 'application/octet-stream', media.base64 ?? '', media.filename)
    const caption = media.caption ?? ''
    await this.simulateTyping(client, chatId, caption.length)
    const sent = await client.sendMessage(chatId, attachment, caption ? { caption } : {})
    return { waId: sent?.id?._serialized ?? '' }
  }

  /** After a crash mid-send: is this exact text already in the chat since `sinceMs`? */
  async alreadySent(to: string, text: string, sinceMs: number): Promise<boolean> {
    const client = this.connected()
    const chatId = toChatId(to)
    if (!chatId) return false
    try {
      const chat = await client.getChatById(chatId)
      const recent = await chat.fetchMessages({ limit: 20, fromMe: true })
      return recent.some((m) => m.body === text && m.timestamp * 1000 >= sinceMs)
    } catch (err) {
      // Not knowable (no chat yet, a WhatsApp Web change): send it.
      logger.debug('could not check the chat before resending', { session: this.id, error: (err as Error)?.message })
      return false
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────

  /** Unlink the number on WhatsApp's side; the next pairing needs a fresh QR. */
  async logout(): Promise<void> {
    const client = this.client
    if (client) {
      try {
        await withTimeout(client.logout(), 15_000, 'logout')
      } catch (err) {
        logger.warn('logout did not complete', { session: this.id, error: (err as Error)?.message })
      }
    }
    this.loggedOut('logged out via the API')
  }

  /** Relaunch now, from any state (a logged-out number gets a new QR). */
  async restart(): Promise<void> {
    if (this.status === 'locked') return
    this.failures = 0
    this.lastError = undefined
    this.clearReconnectTimer()
    this.stopProbe()
    this.setStatus('disconnected', 'restart requested')
    this.launching = false
    void this.launch()
  }

  /** Stops everything: the queue (after the message in flight), the browser, the claim. */
  async shutdown(): Promise<void> {
    this.destroyed = true
    this.generation++
    this.clearReconnectTimer()
    this.stopProbe()
    if (this.claimTimer) clearInterval(this.claimTimer)
    await this.queue.stop()
    await this.teardownClient()
    releaseClaim(this.cid)
  }
}
