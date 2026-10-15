/**
 * One WhatsApp session: a whatsapp-web.js client for a single number, plus its
 * own durable outbound queue. Owns the lifecycle (QR pairing, auto-reconnect with
 * backoff), the humanised send primitives, number validation, and forwarding
 * inbound messages to Courant (tagged with this session's id). The SessionManager
 * owns a set of these — one per paired number.
 */
import fs from 'node:fs'
import path from 'node:path'
import pkg from 'whatsapp-web.js'
import type { Client as WAClient, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode'
import { buildClientConfig } from '../config/client'
import { env } from '../config/env'
import { logger } from './logger'
import { emit } from './webhook'
import { invalidRecipient, notConnected, notOnWhatsApp } from './errors'
import { Queue, Sender } from './queue'
import { humanDelay, sleep } from '../utils/time'
import { toChatId, toDigits } from '../utils/phone'
import type { MediaPayload, SessionState, SessionStatus, SessionSummary } from '../types'

const { Client, MessageMedia } = pkg

/** clientId / data-dir safe form of a session id. */
export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'default'

export class Session implements Sender {
  readonly id: string
  readonly queue: Queue
  private client: WAClient
  private status: SessionStatus = 'disconnected'
  private lastQr: string | null = null
  private startedAt = Date.now()
  private reconnectDelayMs = 2_000
  private destroyed = false

  constructor(id: string) {
    this.id = id
    const cid = safeId(id)
    this.client = new Client(buildClientConfig(cid))
    this.queue = new Queue(id, path.join(env.dataDir, cid, 'queue.json'), this)
    this.wire()
  }

  private wire(): void {
    this.client.on('qr', (qr: string) => {
      this.lastQr = qr
      this.status = 'scanning'
      logger.info('QR updated', { session: this.id })
    })
    this.client.on('authenticated', () => logger.info('authenticated', { session: this.id }))
    this.client.on('ready', () => {
      this.status = 'connected'
      this.lastQr = null
      this.reconnectDelayMs = 2_000
      logger.info('ready', { session: this.id, phone: this.client.info?.wid?.user, pushName: this.client.info?.pushname })
      this.queue.kick()
    })
    this.client.on('auth_failure', (m: string) => {
      this.status = 'disconnected'
      logger.error('auth failure', { session: this.id, message: m })
    })
    this.client.on('disconnected', (reason: string) => {
      this.status = 'disconnected'
      this.lastQr = null
      logger.warn('disconnected', { session: this.id, reason })
      this.scheduleReconnect()
    })
    this.client.on('message', (msg: Message) => void this.onInbound(msg))
  }

  /**
   * Remove the Chromium singleton lock files from this session's LocalAuth
   * profile. whatsapp-web.js re-launches Chromium against the same userDataDir on
   * every initialize(); if a previous browser did not exit cleanly (crash, SIGKILL,
   * a reconnect that fired before the old process released the profile) the stale
   * SingletonLock/Cookie/Socket make the new launch fail with "profile appears to
   * be in use", which traps the session in an endless reconnect loop. Clearing them
   * before each launch makes init idempotent and self-healing.
   */
  private clearProfileLock(): void {
    try {
      const dir = path.join(env.sessionDir, `session-${safeId(this.id)}`)
      for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        fs.rmSync(path.join(dir, f), { force: true })
      }
    } catch (err) {
      logger.debug('profile lock cleanup skipped', { session: this.id, error: (err as Error)?.message })
    }
  }

  /** Await the old client's Chromium exit, then build a fresh, freshly-wired client.
   *  Sequencing the teardown before relaunch avoids two Chromium processes racing on
   *  the same profile dir. */
  private async recreate(): Promise<void> {
    try {
      await this.client.destroy()
    } catch {
      /* the old browser may already be gone; ignore */
    }
    this.client = new Client(buildClientConfig(safeId(this.id)))
    this.wire()
  }

  init(): void {
    this.clearProfileLock()
    this.client.initialize().catch((err) => {
      logger.error('initialize failed', { session: this.id, error: (err as Error)?.message })
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000)
    logger.info('reconnecting', { session: this.id, inMs: delay })
    setTimeout(() => {
      if (this.destroyed) return
      // Tear down the old browser, clear any stale profile lock, then relaunch with a
      // fresh client — so a browser that failed to exit can't trap the session forever.
      void this.recreate()
        .then(() => {
          if (this.destroyed) return
          this.clearProfileLock()
          return this.client.initialize()
        })
        .catch((err) => {
          logger.error('reconnect failed', { session: this.id, error: (err as Error)?.message })
          this.scheduleReconnect()
        })
    }, delay)
  }

  /**
   * The sender's number in E.164, '' when it cannot be known (a group, a
   * channel). WhatsApp now often names a person by a @lid, which holds no phone
   * number; the client can map it back to one.
   */
  private async phoneOf(jid: string): Promise<string> {
    const [user, server] = String(jid).split('@')
    if (server === 'c.us') return user ? `+${user}` : ''
    if (server !== 'lid') return ''
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
      await emit({
        type: 'message.inbound',
        sessionId: this.id,
        from: msg.from,
        fromPhone: await this.phoneOf(msg.from),
        to: msg.to,
        body: msg.body ?? '',
        messageId: msg.id?._serialized ?? '',
        timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
        hasMedia: Boolean(msg.hasMedia),
        messageType: String(msg.type ?? 'unknown'),
      })
    } catch (err) {
      logger.error('inbound handling failed', { session: this.id, error: (err as Error)?.message })
    }
  }

  isReady(): boolean {
    return this.status === 'connected'
  }

  summary(): SessionSummary {
    const s: SessionSummary = { id: this.id, status: this.status, uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) }
    if (this.status === 'connected') {
      s.phone = this.client.info?.wid?.user
      s.pushName = this.client.info?.pushname
    }
    return s
  }

  async getState(): Promise<SessionState> {
    const base: SessionState = { ...this.summary() }
    if (this.status === 'scanning' && this.lastQr) base.qr = await qrcode.toDataURL(this.lastQr)
    return base
  }

  async checkNumber(to: string): Promise<{ exists: boolean; waId?: string }> {
    if (!this.isReady()) throw notConnected()
    const digits = toDigits(to)
    if (!digits) throw invalidRecipient(to)
    const id = await this.client.getNumberId(digits)
    return id ? { exists: true, waId: id._serialized } : { exists: false }
  }

  private async resolveChatId(to: string): Promise<string> {
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
      const id = await this.client.getNumberId(digits)
      if (!id) throw notOnWhatsApp(to)
    }
    return chatId
  }

  private async simulateTyping(chatId: string, textLength: number): Promise<void> {
    try {
      await this.client.sendPresenceAvailable()
      const chat = await this.client.getChatById(chatId)
      await chat.sendStateTyping()
      const typingMs = Math.min(env.typingMaxMs, Math.max(env.typingMinMs, Math.round(textLength * env.typingPerCharMs + humanDelay(0, 800))))
      await sleep(typingMs)
      await chat.clearState()
    } catch (err) {
      logger.debug('typing simulation skipped', { session: this.id, error: (err as Error)?.message })
    }
  }

  async sendText(to: string, text: string): Promise<{ waId: string }> {
    if (!this.isReady()) throw notConnected()
    const chatId = await this.resolveChatId(to)
    await this.simulateTyping(chatId, text.length)
    const sent = await this.client.sendMessage(chatId, text)
    // sendMessage can resolve undefined even on a delivered message when the Store
    // serialization is out of sync; never crash on the return value.
    return { waId: sent?.id?._serialized ?? '' }
  }

  async sendMedia(to: string, media: MediaPayload): Promise<{ waId: string }> {
    if (!this.isReady()) throw notConnected()
    const chatId = await this.resolveChatId(to)
    const attachment = media.url
      ? await MessageMedia.fromUrl(media.url, { unsafeMime: true })
      : new MessageMedia(media.mimetype ?? 'application/octet-stream', media.base64 ?? '', media.filename)
    const caption = media.caption ?? ''
    await this.simulateTyping(chatId, caption.length)
    const sent = await this.client.sendMessage(chatId, attachment, caption ? { caption } : {})
    return { waId: sent?.id?._serialized ?? '' }
  }

  async logout(): Promise<void> {
    try {
      await this.client.logout()
    } finally {
      this.status = 'disconnected'
      this.lastQr = null
    }
  }

  async restart(): Promise<void> {
    try {
      await this.client.destroy()
    } catch {
      /* ignore */
    }
    this.status = 'disconnected'
    this.lastQr = null
    this.init()
  }

  async shutdown(): Promise<void> {
    this.destroyed = true
    try {
      await this.client.destroy()
    } catch {
      /* ignore */
    }
  }
}
