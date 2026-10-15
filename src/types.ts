/**
 * - scanning: waiting for the QR to be scanned
 * - connected: paired and online
 * - disconnected: offline, reconnecting on its own
 * - logged_out: the number was unlinked or banned; nothing runs until it is paired again (restart)
 * - error: kept failing to start; retried slowly, needs a look
 * - locked: another worker process holds this number's profile
 */
export type SessionStatus = 'disconnected' | 'scanning' | 'connected' | 'logged_out' | 'error' | 'locked'

export interface SessionState {
  /** The session id (one per paired number; Courant uses the project id). */
  id: string
  status: SessionStatus
  /** The paired number (digits), once connected. */
  phone?: string
  pushName?: string
  /** data-URL QR to scan, present while status is 'scanning'. */
  qr?: string
  uptimeSeconds: number
  /** Why the session last went down (WhatsApp's reason, or the launch error). */
  lastError?: string
  reconnects?: number
  /** Why the queue is not sending right now. */
  holding?: 'disconnected' | 'window' | 'cap' | null
}

/** A session in a list (no QR). */
export interface SessionSummary {
  id: string
  status: SessionStatus
  phone?: string
  pushName?: string
  uptimeSeconds: number
  lastError?: string
  reconnects?: number
}

export type JobStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'held'

export type MessageKind = 'text' | 'media'

export interface MediaPayload {
  /** One of url or base64 must be set. */
  url?: string
  base64?: string
  mimetype?: string
  filename?: string
  caption?: string
}

export interface SendRequest {
  to: string
  kind: MessageKind
  text?: string
  media?: MediaPayload
  /** Caller-supplied key for idempotent retries. */
  idempotencyKey?: string
}

export interface Job extends SendRequest {
  id: string
  status: JobStatus
  attempts: number
  /** E.164 recipient after normalisation. */
  toE164: string
  waId?: string
  error?: string
  createdAt: number
  updatedAt: number
}

/** What a client sees for a job (no internal fields). */
export interface JobView {
  id: string
  status: JobStatus
  to: string
  waId?: string
  error?: string
  attempts: number
  createdAt: string
  updatedAt: string
}

export type WebhookEvent =
  | {
      type: 'message.inbound'
      sessionId: string
      from: string
      /** The sender's number in E.164, resolved from a @lid when needed; '' when unknown. */
      fromPhone: string
      to: string
      body: string
      messageId: string
      timestamp: number
      hasMedia: boolean
      messageType: string
    }
  | {
      /** The session changed state: connected, logged out (unlinked or banned), in error… */
      type: 'session.status'
      sessionId: string
      status: SessionStatus
      phone?: string
      reason?: string
    }
  | {
      type: 'message.status'
      sessionId: string
      jobId: string
      status: Extract<JobStatus, 'sent' | 'failed'>
      to: string
      waId?: string
      error?: string
    }
