/**
 * The WhatsApp session: a singleton wrapping one whatsapp-web.js client.
 * Owns the lifecycle (QR pairing, auto-reconnect with backoff), exposes the
 * humanised low-level send primitives, validates numbers, and forwards inbound
 * messages to Courant. It knows nothing about the queue or pacing — that lives
 * one layer up, so this stays a thin, testable transport.
 */
import pkg from 'whatsapp-web.js'
import type { Client as WAClient, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode'
import { buildClientConfig } from '../config/client'
import { env } from '../config/env'
import { logger } from './logger'
import { emit } from './webhook'
import { invalidRecipient, notConnected, notOnWhatsApp } from './errors'
import { humanDelay, sleep } from '../utils/time'
import { toChatId, toDigits } from '../utils/phone'
import type { MediaPayload, SessionState, SessionStatus } from '../types'

const { Client, MessageMedia } = pkg

class WhatsAppSession {
  private client: WAClient
  private status: SessionStatus = 'disconnected'
  private lastQr: string | null = null
  private startedAt = Date.now()
  private reconnectDelayMs = 2_000
  private destroyed = false

  constructor() {
    this.client = new Client(buildClientConfig())
    this.wire()
  }

  private wire(): void {
    this.client.on('qr', (qr: string) => {
      this.lastQr = qr
      this.status = 'scanning'
      logger.info('QR updated — scan it at GET /api/v1/session')
    })
    this.client.on('authenticated', () => logger.info('authenticated'))
    this.client.on('ready', () => {
      this.status = 'connected'
      this.lastQr = null
      this.reconnectDelayMs = 2_000
      const info = this.client.info
      logger.info('ready', { phone: info?.wid?.user, pushName: info?.pushname })
    })
    this.client.on('auth_failure', (m: string) => {
      this.status = 'disconnected'
      logger.error('auth failure', { message: m })
    })
    this.client.on('disconnected', (reason: string) => {
      this.status = 'disconnected'
      this.lastQr = null
      logger.warn('disconnected', { reason })
      this.scheduleReconnect()
    })
    this.client.on('message', (msg: Message) => void this.onInbound(msg))
  }

  init(): void {
    this.client.initialize().catch((err) => {
      logger.error('initialize failed', { error: (err as Error)?.message })
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    const delay = this.reconnectDelayMs
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 60_000) // cap at 1 min
    logger.info('reconnecting', { inMs: delay })
    setTimeout(() => {
      if (this.destroyed) return
      this.client.initialize().catch((err) => {
        logger.error('reconnect initialize failed', { error: (err as Error)?.message })
        this.scheduleReconnect()
      })
    }, delay)
  }

  private async onInbound(msg: Message): Promise<void> {
    try {
      if (msg.fromMe || msg.isStatus) return
      await emit({
        type: 'message.inbound',
        from: msg.from,
        to: msg.to,
        body: msg.body ?? '',
        messageId: msg.id?._serialized ?? '',
        timestamp: msg.timestamp ?? Math.floor(Date.now() / 1000),
        hasMedia: Boolean(msg.hasMedia),
        messageType: String(msg.type ?? 'unknown'),
      })
    } catch (err) {
      logger.error('inbound handling failed', { error: (err as Error)?.message })
    }
  }

  isReady(): boolean {
    return this.status === 'connected'
  }

  async getState(): Promise<SessionState> {
    const base: SessionState = {
      status: this.status,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    }
    if (this.status === 'connected') {
      base.phone = this.client.info?.wid?.user
      base.pushName = this.client.info?.pushname
    } else if (this.status === 'scanning' && this.lastQr) {
      base.qr = await qrcode.toDataURL(this.lastQr)
    }
    return base
  }

  /** Is this number reachable on WhatsApp? */
  async checkNumber(to: string): Promise<{ exists: boolean; waId?: string }> {
    if (!this.isReady()) throw notConnected()
    const digits = toDigits(to)
    if (!digits) throw invalidRecipient(to)
    const id = await this.client.getNumberId(digits)
    return id ? { exists: true, waId: id._serialized } : { exists: false }
  }

  /** Resolve the chat id, validating the number first when configured. */
  private async resolveChatId(to: string): Promise<string> {
    const digits = toDigits(to)
    if (!digits) throw invalidRecipient(to)
    if (env.validateNumbers) {
      const id = await this.client.getNumberId(digits)
      if (!id) throw notOnWhatsApp(to)
      return id._serialized
    }
    const chatId = toChatId(to)
    if (!chatId) throw invalidRecipient(to)
    return chatId
  }

  /** Show presence + a length-scaled, jittered "typing…" before sending. */
  private async simulateTyping(chatId: string, textLength: number): Promise<void> {
    try {
      await this.client.sendPresenceAvailable()
      const chat = await this.client.getChatById(chatId)
      await chat.sendStateTyping()
      const typingMs = Math.min(
        env.typingMaxMs,
        Math.max(env.typingMinMs, Math.round(textLength * env.typingPerCharMs + humanDelay(0, 800)))
      )
      await sleep(typingMs)
      await chat.clearState()
    } catch (err) {
      // Typing is best-effort; never block the actual send on it.
      logger.debug('typing simulation skipped', { error: (err as Error)?.message })
    }
  }

  async sendText(to: string, text: string): Promise<{ waId: string }> {
    if (!this.isReady()) throw notConnected()
    const chatId = await this.resolveChatId(to)
    await this.simulateTyping(chatId, text.length)
    const sent = await this.client.sendMessage(chatId, text)
    return { waId: sent.id?._serialized ?? '' }
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
    return { waId: sent.id?._serialized ?? '' }
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

export const session = new WhatsAppSession()
