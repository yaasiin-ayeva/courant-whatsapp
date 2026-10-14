# Courant WhatsApp Worker

A **standalone, TypeScript, multi-session** WhatsApp transport — no vendor, no BSP, no per-message
cost. It drives several real WhatsApp numbers through WhatsApp Web (headless Chromium) via
[`whatsapp-web.js`](https://wwebjs.dev) and exposes a small, clean **HTTP API**. Courant consumes it
over HTTP — a base URL + an API key — exactly like the Google-Maps lead scraper.

This is its **own repo** (`courant-whatsapp`) and its own deployable service. One worker holds many
**sessions**, one per number, each addressed by an id (Courant uses the project id). Each session is
its own headless Chromium (~300–500 MB RAM), so size the host for the number of numbers you pair.

> ⚠️ **Unofficial & against WhatsApp's ToS.** Cold/bulk messaging gets numbers **banned**. Use it for
> **low-volume, opt-in / human-assisted** conversations. Compliance (consent, opt-out) is enforced in
> Courant; ban-risk mitigation (pacing, typing simulation, caps, warm-up) is enforced here.

## What's inside

```
src/
  config/   env (typed + validated), client (hardened Chromium + LocalAuth)
  core/     session (one number: lifecycle, QR, auto-reconnect, humanised send + its queue),
            manager (the set of sessions + on-disk registry), queue (durable, paced, retries),
            webhook (HMAC + retry), logger, errors
  http/     server, auth (API key + rate limit), routes (/sessions/:id/…)
  utils/    phone (E.164), time (jitter/window), hmac
  index.ts  bootstrap + graceful shutdown
```

**Highlights**
- **Multi-session** — many numbers in one worker, each a session addressed by id; the set is
  persisted so every number is recreated (and its queue resumed) on restart.
- **Async API** (`POST /api/v1/sessions/:id/messages` → `202 {id}`, poll the job) + signed webhook
  carrying the `sessionId`.
- **Durable per-session queue** on disk — a restart never drops a message; idempotent by `idempotencyKey`.
- **Human pacing / anti-ban** — typing simulation, randomised delays, daily cap + warm-up, quiet-hours
  window, per-recipient gap, number validation. No third-party "anti-ban" packages.
- **Robust session** — auto-reconnect with backoff, QR state machine, `logout`/`restart`.
- **Text & media**, metrics, structured logs.

**Interactive API reference (Scalar):** [https://wa.yaasiin.dev/docs](https://wa.yaasiin.dev/docs) ·
raw spec at [`/openapi.json`](https://wa.yaasiin.dev/openapi.json) (source: `src/http/openapi.ts`).
A landing page is served at [`/`](https://wa.yaasiin.dev/).

## Run

```bash
cp .env.example .env            # set WA_API_KEYS, WA_WEBHOOK_TOKEN, COURANT_WEBHOOK_URL
npm install
npm run build && npm start      # or: npm run dev
```

Generate an API key: `openssl rand -hex 32 | sed 's/^/wa_/'`.

Then **create a session and pair it once**: `POST /api/v1/sessions {"id":"<your-id>"}` returns the
session state with a `qr` data-URL — scan it from **WhatsApp → Linked devices**. Repeat with another
id to add another number. Sessions persist in `SESSION_DIR` (and the registry in `DATA_DIR`).

### Docker
```bash
docker build -t courant-whatsapp .
docker run -d --name courant-whatsapp -p 127.0.0.1:8088:8088 --env-file .env \
  -v courant_wa_session:/app/.wwebjs_auth -v courant_wa_data:/app/data courant-whatsapp
```

## How Courant uses it

Each Courant **project** maps to one session (its `sessionId` is the project id). The project's
WhatsApp settings create/pair that session; a WhatsApp campaign submits sends to
`POST /api/v1/sessions/<projectId>/messages`. Courant consumes this service through
`config.whatsapp` (`WA_WORKER_URL` / `WA_WORKER_API_KEY` / `WA_WEBHOOK_TOKEN`) and
`outreach-be/src/services/whatsappSender.service.ts`; inbound replies and delivery status arrive on
Courant's `/hooks/whatsapp` webhook, routed to the right project by the event's `sessionId`.
