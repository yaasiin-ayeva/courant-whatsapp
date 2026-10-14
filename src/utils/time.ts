export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/** Uniform integer in [min, max]. */
export const randInt = (min: number, max: number): number =>
  min >= max ? min : min + Math.floor(Math.random() * (max - min + 1))

/**
 * A value in [min, max] biased toward the middle (approx. Gaussian via the
 * mean of two uniforms) — more human than a flat random for delays.
 */
export function humanDelay(min: number, max: number): number {
  if (min >= max) return min
  const u = (Math.random() + Math.random()) / 2
  return Math.round(min + u * (max - min))
}

/** Hour of day (0–23) in a given IANA timezone. */
export function hourInTz(tz: string, at: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(at)
    const h = parseInt(s, 10)
    return Number.isFinite(h) ? h % 24 : at.getUTCHours()
  } catch {
    return at.getUTCHours()
  }
}

/** YYYY-MM-DD in a given IANA timezone — the key for the daily cap. */
export function dayKeyInTz(tz: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}
