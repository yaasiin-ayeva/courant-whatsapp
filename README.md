# Courant WhatsApp worker (whatsapp-web.js)

A **standalone** WhatsApp transport — no vendor, no BSP, no per-message cost. It
drives a real WhatsApp number through WhatsApp Web (headless Chromium) via
[`whatsapp-web.js`](https://wwebjs.dev). One worker process = one number.

> ⚠️ **Unofficial & against WhatsApp's ToS.** Cold/bulk messaging gets numbers
> **banned**. Use it for **low-volume, opt-in or human-assisted** conversations,
> pace it like a human (the worker already spaces sends `SEND_MIN_MS..SEND_MAX_MS`),
> and treat the number as disposable. Compliance (consent, opt-out) is enforced in
> Courant, not here.

This is its **own repo** (`courant-whatsapp`) and its own deployable service.
Courant consumes it over HTTP — a base URL + an API key — exactly like the
Google-Maps lead scraper. Full HTTP reference: [API.md](./API.md).

## Run (host with Chromium, or the Docker image)

```bash
cp .env.example .env   # set WA_API_KEYS, WA_WEBHOOK_TOKEN, COURANT_WEBHOOK_URL
npm install
npm start
```

Generate an API key: `openssl rand -hex 32 | sed 's/^/wa_/'`.

Then **pair the number once**: open `GET /api/v1/status`, scan the returned QR
(`qr` is a PNG data-URL) with WhatsApp on the phone (Linked devices). The session
is persisted in `SESSION_DIR`, so you scan only once (the phone can be offline
afterwards thanks to multi-device).

### Docker
```bash
docker build -t courant-wa-worker .
docker run -d --name wa --env-file .env -p 127.0.0.1:8088:8088 \
  -v wa_session:/app/.wwebjs_auth courant-wa-worker
```

## API (bind to localhost, put TLS in front — see [API.md](./API.md))
Authenticate with `X-API-Key: <key>` or `Authorization: Bearer <key>`.
- `GET /health` → `{ ok, ready }` (no auth)
- `GET /api/v1/status` → `{ ready, qr }` — scan `qr` to pair.
- `POST /api/v1/send` `{ to, message }` — `to` is E.164 or digits; queued and paced.

Inbound messages are POSTed to `COURANT_WEBHOOK_URL` (with `X-Token: WA_WEBHOOK_TOKEN`)
— Courant verifies the token and handles replies / opt-out there.

## How Courant uses it
Courant's engine calls this worker's `/api/v1/send` as the **WhatsApp transport** for a
WhatsApp campaign (one worker per sending number). Scale = more worker instances,
each its own number + session. This is wired on the Courant side in P1 step 2.
