/** A send failure that carries whether retrying could help. */
export class SendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(message)
    this.name = 'SendError'
  }
}

export const notConnected = () => new SendError('not connected (scan the QR at /api/v1/session)', 'NOT_CONNECTED', true)
export const notOnWhatsApp = (to: string) => new SendError(`recipient is not on WhatsApp: ${to}`, 'NOT_ON_WHATSAPP', false)
export const invalidRecipient = (to: string) => new SendError(`invalid recipient: ${to}`, 'INVALID_RECIPIENT', false)
