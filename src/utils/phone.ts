/** E.164 normalisation + WhatsApp chat-id helpers. */

const E164 = /^\+[1-9]\d{6,14}$/

export function toE164(raw: string | undefined | null): string {
  if (!raw) return ''
  let s = String(raw).trim().replace(/[\s().-]/g, '')
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+')) s = `+${s}`
  return E164.test(s) ? s : ''
}

export const isE164 = (s: string): boolean => E164.test(s)

/** "+22890000000" -> "22890000000@c.us". Accepts digits or E.164. */
export function toChatId(to: string): string | null {
  const digits = String(to).replace(/[^\d]/g, '')
  return digits ? `${digits}@c.us` : null
}

/** Bare digits for getNumberId. */
export const toDigits = (to: string): string => String(to).replace(/[^\d]/g, '')
