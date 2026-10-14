# Courant WhatsApp Worker

A **standalone, TypeScript** WhatsApp transport — no vendor, no BSP, no per-message cost. It drives
one real WhatsApp number through WhatsApp Web (headless Chromium) via
[`whatsapp-web.js`](https://wwebjs.dev) and exposes a small, clean **HTTP API**. Courant consumes it
over HTTP — a base URL + an API key — exactly like the Google-Maps lead scraper.

This is its **own repo** (`courant-whatsapp`) and its own deployable service. One worker = one number.

> ⚠️ **Unofficial & against WhatsApp's ToS.** Cold/bulk messaging gets numbers **banned**. Use it for
> **low-volume, opt-in / human-assisted** conversations. Compliance (consent, opt-out) is enforced in
> Courant; ban-risk mitigation (pacing, typing simulation, caps, warm-up) is enforced here.

## What's inside

```
src/
  config/   env (typed + validated), client (hardened Chromium + LocalAuth)
  core/     session (lifecycle, QR, auto-reconnect, humanised send),
            queue (durable, paced, retries), webhook (HMAC + retry), logger, errors
  http/     server, auth (API key + rate limit), routes
  utils/    phone (E.164), time (jitter/window), hmac
  index.ts  bootstrap + graceful shutdown
```

**Highlights**
- **Async API** (`POST /api/v1/messages` → `202 {id}`, poll `GET /api/v1/messages/:id`) + signed webhook.
- **Durable queue** on disk — a restart never drops a message; idempotent by `idempotencyKey`.
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

Then **pair the number once**: `GET /api/v1/session`, open the returned `qr` data-URL, scan it from
**WhatsApp → Linked devices**. The session is persisted in `SESSION_DIR`.

### Docker
```bash
docker build -t courant-whatsapp .
docker run -d --name courant-whatsapp -p 127.0.0.1:8088:8088 --env-file .env \
  -v courant_wa_session:/app/.wwebjs_auth -v courant_wa_data:/app/data courant-whatsapp
```

## How Courant uses it

Courant's engine submits sends to `POST /api/v1/messages` as the **WhatsApp transport** for a
WhatsApp campaign (one worker per number). It consumes this service through
`config.whatsapp` (`WA_WORKER_URL` / `WA_WORKER_API_KEY` / `WA_WEBHOOK_TOKEN`) and
`outreach-be/src/services/whatsappSender.service.ts`. Replies and opt-out arrive on Courant's inbound
webhook. Wiring into the send engine is P1 step 2.
