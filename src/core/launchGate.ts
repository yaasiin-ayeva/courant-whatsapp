/**
 * Starting a session launches Chromium and loads WhatsApp Web: about one CPU
 * core and half a gigabyte for 10–25 s. Twenty numbers starting together (a
 * restart, a network drop) starve each other, time out, retry together, and
 * never come up. Every launch takes a slot here; at most N run at once.
 */
import { env } from '../config/env'

let active = 0
const waiting: (() => void)[] = []

export const launchesInProgress = () => active
export const launchesWaiting = () => waiting.length

/**
 * Runs `fn` once a slot is free. The slot is released when `fn` settles, or
 * after the launch timeout if it never does (a hung Puppeteer must not hold
 * the gate for every other number).
 */
export async function withLaunchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= env.maxConcurrentLaunches) await new Promise<void>((resolve) => waiting.push(resolve))
  active++
  let released = false
  const release = () => {
    if (released) return
    released = true
    active--
    waiting.shift()?.()
  }
  const timer = setTimeout(release, env.launchTimeoutMs)
  timer.unref()
  try {
    return await fn()
  } finally {
    clearTimeout(timer)
    release()
  }
}

/** A delay of `base`, spread ±50% so sessions that failed together retry apart. */
export function jitter(base: number): number {
  return Math.round(base * (0.5 + Math.random()))
}
