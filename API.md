# Courant WhatsApp Worker — HTTP API

A standalone WhatsApp transport built on [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).
It drives one real WhatsApp account through WhatsApp Web (a headless Chromium), so there is
**no vendor / BSP and no per-message cost**. Courant consumes it over HTTP exactly like it
consumes the Google-Maps lead scraper: a base URL + an API key.

> ⚠️ Unofficial and against WhatsApp's Terms of Service. Use for **low-volume, opt-in /
> human-assisted** messaging only, pace it like a human, and treat the number as disposable.
> One worker instance = one number.

## Authentication

Every endpoint except `GET /health` requires an API key, sent as either header:

```
X-API-Key: wa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Authorization: Bearer wa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are configured in the worker's `WA_API_KEYS` env (comma-separated — one per integration so
you can revoke a single one). Generate a key:

```bash
openssl rand -hex 32 | sed 's/^/wa_/'
```

A request with a missing or unknown key gets `401 { "error": "invalid api key" }`.
If `WA_API_KEYS` is empty the API is **open** — only acceptable for a strictly private/local dev
instance; always set a key in production.

Base URL in these examples: `https://wa.example.com` (put nginx + TLS in front of the worker).

## Endpoints

### `GET /health` — liveness (no auth)

```json
{ "ok": true, "ready": false }
```

`ready` is `true` once a number is paired and the WhatsApp Web session is live.

### `GET /api/v1/status` — pairing status + QR

```bash
curl https://wa.example.com/api/v1/status -H "X-API-Key: $KEY"
```

```json
{ "ready": false, "qr": "data:image/png;base64,iVBORw0KGgo..." }
```

When `ready` is `false` and a `qr` data-URL is present, open it in a browser (or render the
`<img>`) and scan it from **WhatsApp → Linked devices** on the phone that owns the number. After
pairing, `qr` becomes `null` and `ready` turns `true`. The session is persisted on disk
(`SESSION_DIR`), so you scan only once.

### `POST /api/v1/send` — queue an outbound message

```bash
curl -X POST https://wa.example.com/api/v1/send \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{ "to": "+22890000000", "message": "Hello 👋" }'
```

| Field     | Type   | Notes                                                        |
|-----------|--------|--------------------------------------------------------------|
| `to`      | string | Recipient in E.164 (`+` and digits). Non-digits are stripped.|
| `message` | string | Plain text (WhatsApp formatting markers allowed).            |

Response once the message leaves the queue:

```json
{ "queued": true, "id": "true_22890000000@c.us_3EB0..." }
```

Sends are serialized through an internal queue with a **randomized human-like delay**
(`SEND_MIN_MS`..`SEND_MAX_MS`, default 8–25 s) between messages to lower ban risk. The HTTP call
resolves when *this* message is actually sent, so a caller enqueuing many messages will see each
request take as long as its turn in the queue — fire them concurrently, or send with a client
timeout that tolerates the pacing. Errors: `400` (missing `to`/`message`), `502`
(`{ "error": "not connected (scan the QR at /status)" }` or a send failure).

## Inbound messages (webhook → Courant)

When `COURANT_WEBHOOK_URL` is set, every inbound WhatsApp message is POSTed there with header
`X-Token: <WA_WEBHOOK_TOKEN>` (Courant verifies it):

```json
{
  "from": "22890000000@c.us",
  "to": "22899999999@c.us",
  "body": "STOP",
  "id": "false_22890000000@c.us_3EB0...",
  "timestamp": 1760000000
}
```

Courant handles replies and opt-out (`STOP`, `STOP`-like) on its side.

## Configuration (`.env`)

| Var                  | Default            | Purpose                                              |
|----------------------|--------------------|------------------------------------------------------|
| `PORT`               | `8088`             | Listen port (bind localhost; TLS via nginx).         |
| `WA_API_KEYS`        | —                  | Comma-separated client API keys (`wa_…`).            |
| `WA_WEBHOOK_TOKEN`   | —                  | Token the worker signs inbound webhooks with.        |
| `COURANT_WEBHOOK_URL`| —                  | Where inbound messages are POSTed (empty = log only).|
| `SESSION_DIR`        | `./.wwebjs_auth`   | Persisted WhatsApp Web session (mount a volume).      |
| `SEND_MIN_MS`        | `8000`             | Min delay between sends.                              |
| `SEND_MAX_MS`        | `25000`            | Max delay between sends.                              |

## Deploy

```bash
docker build -t courant-whatsapp .
docker run -d --name courant-whatsapp -p 127.0.0.1:8088:8088 \
  --env-file .env -v courant_wa_session:/app/.wwebjs_auth courant-whatsapp
# then: curl .../api/v1/status, open the qr, scan from the phone, done.
```
