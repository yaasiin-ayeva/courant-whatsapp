/**
 * Prometheus text exposition for the worker: which number is down and since
 * when, what is waiting, whether webhooks are getting through, and whether the
 * process itself is healthy (event-loop lag, memory). Scrape GET /metrics with
 * the API key as a bearer token.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { manager } from './manager'
import { outboxMetrics } from './outbox'
import { launchesInProgress, launchesWaiting } from './launchGate'
import type { SessionStatus } from '../types'

const STATUSES: SessionStatus[] = ['connected', 'scanning', 'disconnected', 'logged_out', 'error', 'locked']

const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

export function prometheus(): string {
  const out: string[] = []
  const metric = (name: string, help: string, type: 'gauge' | 'counter', rows: [Record<string, string>, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`)
    for (const [labels, value] of rows) {
      const l = Object.entries(labels).map(([k, v]) => `${k}="${esc(v)}"`).join(',')
      out.push(`${name}${l ? `{${l}}` : ''} ${Number.isFinite(value) ? value : 0}`)
    }
  }

  const sessions = manager.list()
  metric('wa_sessions', 'Sessions by status.', 'gauge', STATUSES.map((s) => [{ status: s }, sessions.filter((x) => x.status === s).length]))
  metric('wa_session_up', '1 when the session is connected.', 'gauge', sessions.map((s) => [{ session: s.id }, s.status === 'connected' ? 1 : 0]))
  metric('wa_session_reconnects_total', 'Reconnects since the worker started.', 'counter', sessions.map((s) => [{ session: s.id }, s.reconnects ?? 0]))

  const queues = sessions.map((s) => ({ id: s.id, m: manager.get(s.id)!.queue.metrics() }))
  metric('wa_queue_jobs', 'Jobs by status.', 'gauge', queues.flatMap(({ id, m }) => Object.entries(m.byStatus).map(([status, n]) => [{ session: id, status }, n] as [Record<string, string>, number])))
  metric('wa_queue_oldest_queued_seconds', 'Age of the oldest message still waiting.', 'gauge', queues.map(({ id, m }) => [{ session: id }, Math.round(m.oldestQueuedAgeMs / 1000)]))
  metric('wa_queue_sent_today', 'Messages sent today.', 'gauge', queues.map(({ id, m }) => [{ session: id }, m.sentToday]))
  metric('wa_queue_holding', '1 while the queue holds (disconnected, outside the window, daily cap).', 'gauge', queues.map(({ id, m }) => [{ session: id, reason: m.holding ?? 'none' }, m.holding ? 1 : 0]))

  const ob = outboxMetrics()
  metric('wa_webhook_outbox_pending', 'Webhook events not delivered yet.', 'gauge', [[{}, ob.pending]])
  metric('wa_webhook_outbox_oldest_pending_seconds', 'Age of the oldest undelivered webhook event.', 'gauge', [[{}, Math.round(ob.oldestPendingMs / 1000)]])
  metric('wa_webhook_outbox_dead', 'Webhook events given up after the maximum age.', 'gauge', [[{}, ob.dead]])

  metric('wa_launches_in_progress', 'Browsers starting right now.', 'gauge', [[{}, launchesInProgress()]])
  metric('wa_launches_waiting', 'Sessions waiting for a launch slot.', 'gauge', [[{}, launchesWaiting()]])

  metric('wa_eventloop_lag_seconds', 'Event-loop delay, p99 since the previous scrape.', 'gauge', [[{}, loop.percentile(99) / 1e9]])
  loop.reset()
  const mem = process.memoryUsage()
  metric('wa_process_resident_memory_bytes', 'Resident memory of the Node process (browsers not included).', 'gauge', [[{}, mem.rss]])
  return `${out.join('\n')}\n`
}
