export type SessionStatus = 'disconnected' | 'scanning' | 'connected'

export interface SessionState {
  status: SessionStatus
  /** The paired number (digits), once connected. */
  phone?: string
  pushName?: string
  /** data-URL QR to scan, present while status is 'scanning'. */
  qr?: string
  uptimeSeconds: number
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
      from: string
      to: string
      body: string
      messageId: string
      timestamp: number
      hasMedia: boolean
      messageType: string
    }
  | {
      type: 'message.status'
      jobId: string
      status: Extract<JobStatus, 'sent' | 'failed'>
      to: string
      waId?: string
      error?: string
    }
