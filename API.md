# Courant WhatsApp Worker — HTTP API

A standalone WhatsApp transport built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).
It drives one real WhatsApp account through WhatsApp Web (a headless Chromium), so there is
**no vendor / BSP and no per-message cost**. Courant consumes it over HTTP exactly like it
consumes the Google-Maps lead scraper: a base URL + an API key, with an **async submit→poll**
model and a signed webhook for results.

> ⚠️ Unofficial and against WhatsApp's Terms of Service. Use for **low-volume, opt-in /
> human-assisted** messaging only, pace it like a human, and treat the number as disposable.
> One worker instance = one number.

## Authentication

Every endpoint except `GET /health` requires an API key, as either header:

```
X-API-Key: wa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Authorization: Bearer wa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys live in `WA_API_KEYS` (comma-separated — one per integration, revocable on its own).
Generate one: `openssl rand -hex 32 | sed 's/^/wa_/'`. A bad key → `401 {"error":"invalid api key"}`.
The API is also rate-limited (120 req/min per key). Base URL in examples: `https://wa.example.com`.

## Session

### `GET /health` — liveness (no auth)
```json
{ "ok": true, "ready": true }
```

### `GET /api/v1/session` — pairing status + QR
```json
{ "status": "scanning", "qr": "data:image/png;base64,iVBORw0KGgo...", "uptimeSeconds": 42 }
```
`status` is `disconnected` | `scanning` | `connected`. While `scanning`, open `qr` and scan it from
**WhatsApp → Linked devices**. Once `connected`, it reports `phone` and `pushName`. The session is
persisted (`SESSION_DIR`), so you pair only once.

### `POST /api/v1/session/logout` — unlink the number
### `POST /api/v1/session/restart` — recreate the client (re-pair if needed)

## Numbers

### `POST /api/v1/numbers/check` — is a number on WhatsApp?
```bash
curl -X POST .../api/v1/numbers/check -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"phone":"+22890000000"}'
```
```json
{ "phone": "+22890000000", "exists": true, "waId": "22890000000@c.us" }
```

## Messages (async)

### `POST /api/v1/messages` — queue a message → `202`
```bash
# text
curl -X POST .../api/v1/messages -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ "to": "+22890000000", "text": "Hello 👋", "idempotencyKey": "camp7-contact42" }'
# media (url or base64)
curl -X POST .../api/v1/messages -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ "to": "+22890000000", "media": { "url": "https://.../flyer.jpg", "caption": "Our offer" } }'
```

| Field            | Type   | Notes                                                             |
|------------------|--------|-------------------------------------------------------------------|
| `to`             | string | E.164 (`+` and digits). Required.                                 |
| `text`           | string | Text body (alias: `message`).                                     |
| `media`          | object | `{ url } ` or `{ base64, mimetype, filename }`, optional `caption`.|
| `idempotencyKey` | string | Optional. A duplicate returns the **same** job instead of resending.|

Response (the message is now queued; the worker paces the actual send):
```json
{ "id": "msg_9f3a...", "status": "queued" }
```

### `GET /api/v1/messages/:id` — job status
```json
{ "id": "msg_9f3a...", "status": "sent", "to": "+22890000000",
  "waId": "true_22890000000@c.us_3EB0...", "attempts": 1,
  "createdAt": "2026-10-14T10:00:00.000Z", "updatedAt": "2026-10-14T10:00:12.000Z" }
```
`status`: `queued` → `sending` → `sent` | `failed` (or `held` while waiting on the daily cap /
quiet-hours window). Terminal jobs stay queryable for `WA_JOB_TTL_MS`.

### `GET /api/v1/metrics`
```json
{ "queued": 3, "sentToday": 58, "dailyCap": 200, "total": 61, "byStatus": { "sent": 58, "queued": 3 } }
```

## Pacing & anti-ban

Every send is spaced and humanised so the number looks like a person, not a blaster:
a length-scaled, jittered **"typing…"** before each message; a randomised delay between sends
(`SEND_MIN_MS`..`SEND_MAX_MS`); a **daily cap** with an optional **warm-up ramp**; an optional
**quiet-hours window**; and a **per-recipient minimum gap**. Numbers are validated with
`getNumberId` before sending (`WA_VALIDATE_NUMBERS`). The queue is **durable** (survives restarts)
and retries transient failures up to `WA_MAX_ATTEMPTS`.

## Inbound + status webhook (worker → Courant)

When `COURANT_WEBHOOK_URL` is set, the worker POSTs events there. Each body is signed:
`X-Signature: sha256=<hex HMAC-SHA256 of the raw body with WA_WEBHOOK_TOKEN>` (and `X-Token` with
the raw secret). Return quickly and handle duplicates.

```jsonc
// inbound message
{ "type": "message.inbound", "from": "22890000000@c.us", "to": "22899999999@c.us",
  "body": "STOP", "messageId": "false_...", "timestamp": 1760000000,
  "hasMedia": false, "messageType": "chat", "sentAt": "..." }

// delivery status for a queued job
{ "type": "message.status", "jobId": "msg_9f3a...", "status": "sent",
  "to": "+22890000000", "waId": "true_...", "sentAt": "..." }
```

## Deploy

```bash
docker build -t courant-whatsapp .
docker run -d --name courant-whatsapp -p 127.0.0.1:8088:8088 --env-file .env \
  -v courant_wa_session:/app/.wwebjs_auth -v courant_wa_data:/app/data courant-whatsapp
# then GET /api/v1/session, scan the qr, done.
```
Put nginx + TLS in front and bind the app to localhost. See `.env.example` for all settings.
