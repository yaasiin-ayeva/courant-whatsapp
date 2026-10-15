/**
 * OpenAPI 3.1 description of the worker API, served at GET /openapi.json and
 * rendered by Scalar at /docs. Hand-written (no generators) so it stays small.
 *
 * The worker is multi-session: one session per WhatsApp number, addressed by id
 * (Courant uses the project id). Everything lives under /api/v1/sessions/{id}.
 */
const jobStatus = ['queued', 'sending', 'sent', 'failed', 'held']
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Session id (Courant uses the project id).' }

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Courant WhatsApp Worker API',
    version: '2.0.0',
    description:
      'A standalone, multi-session WhatsApp transport built on whatsapp-web.js. Each ' +
      'session is one real number (paired by QR); send with human-like pacing through a ' +
      'durable per-session queue, and receive inbound messages + delivery status on a ' +
      'signed webhook (tagged with the session id). No vendor/BSP, no per-message cost.\n\n' +
      'Note: unofficial and against WhatsApp’s Terms of Service — low-volume, opt-in / ' +
      'human-assisted messaging only.',
    license: { name: 'MIT' },
  },
  servers: [{ url: 'https://wa.yaasiin.dev', description: 'Production' }],
  security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
  tags: [
    { name: 'System', description: 'Liveness and aggregate metrics.' },
    { name: 'Sessions', description: 'One session per number: create, pair, inspect, remove.' },
    { name: 'Numbers', description: 'Check reachability on WhatsApp.' },
    { name: 'Messages', description: 'Queue messages and read their status.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness',
        description: 'Open, no auth. Reports how many sessions exist and how many are connected.',
        security: [],
        responses: {
          200: { description: 'Service is up.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
        },
      },
    },
    '/api/v1/request-key': {
      post: {
        tags: ['System'],
        summary: 'Request an API key',
        description: 'Public (no auth). The landing-page form posts here; the request is emailed to the operator, who issues a key.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  company: { type: 'string' },
                  volume: { type: 'string' },
                  useCase: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { $ref: '#/components/responses/Ok' },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { description: 'Could not send the request email.' },
          503: { description: 'Email is not configured on the server.' },
        },
      },
    },
    '/api/v1/sessions': {
      get: {
        tags: ['Sessions'],
        summary: 'List sessions',
        responses: {
          200: {
            description: 'Every session (no QR).',
            content: { 'application/json': { schema: { type: 'object', properties: { sessions: { type: 'array', items: { $ref: '#/components/schemas/SessionSummary' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['Sessions'],
        summary: 'Create (or get) a session',
        description: 'Idempotent. Creates the session if new and starts pairing; returns its state (with a QR while scanning).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', example: 'project_64f…' } } } } },
        },
        responses: {
          201: { description: 'Session state.', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionState' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/sessions/{id}': {
      get: {
        tags: ['Sessions'],
        summary: 'Session status + QR',
        parameters: [idParam],
        responses: {
          200: { description: 'Session state.', content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionState' } } } },
          404: { $ref: '#/components/responses/NotFound' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      delete: {
        tags: ['Sessions'],
        summary: 'Remove a session',
        description: 'Unlinks the number and deletes its persisted session + queue.',
        parameters: [idParam],
        responses: { 200: { $ref: '#/components/responses/Ok' }, 404: { $ref: '#/components/responses/NotFound' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/v1/sessions/{id}/logout': {
      post: { tags: ['Sessions'], summary: 'Unlink the number (keep the session)', parameters: [idParam], responses: { 200: { $ref: '#/components/responses/Ok' }, 404: { $ref: '#/components/responses/NotFound' } } },
    },
    '/api/v1/sessions/{id}/restart': {
      post: { tags: ['Sessions'], summary: 'Restart the client', parameters: [idParam], responses: { 200: { $ref: '#/components/responses/Ok' }, 404: { $ref: '#/components/responses/NotFound' } } },
    },
    '/api/v1/sessions/{id}/numbers/check': {
      post: {
        tags: ['Numbers'],
        summary: 'Is a number on WhatsApp?',
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phone'], properties: { phone: { type: 'string', example: '+22890000000' } } } } } },
        responses: {
          200: { description: 'Lookup result.', content: { 'application/json': { schema: { type: 'object', properties: { phone: { type: 'string' }, exists: { type: 'boolean' }, waId: { type: 'string' } } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/sessions/{id}/messages': {
      post: {
        tags: ['Messages'],
        summary: 'Queue a message',
        description: 'Returns a job id immediately (the session paces the send). Poll the job or wait for the `message.status` webhook. Provide `text` (alias `message`) or a `media` object.',
        parameters: [idParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SendRequest' },
              examples: {
                text: { summary: 'Text', value: { to: '+22890000000', text: 'Hello', idempotencyKey: 'camp7-contact42' } },
                media: { summary: 'Media by URL', value: { to: '+22890000000', media: { url: 'https://example.com/flyer.jpg', caption: 'Our offer' } } },
              },
            },
          },
        },
        responses: {
          202: { description: 'Queued.', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', example: 'msg_9f3a…' }, status: { type: 'string', enum: jobStatus } } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/sessions/{id}/messages/{jobId}': {
      get: {
        tags: ['Messages'],
        summary: 'Job status',
        parameters: [idParam, { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'The job.', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobView' } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/sessions/{id}/metrics': {
      get: { tags: ['System'], summary: 'Queue metrics for a session', parameters: [idParam], responses: { 200: { description: 'Counters.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Metrics' } } } }, 404: { $ref: '#/components/responses/NotFound' } } },
    },
    '/api/v1/metrics': {
      get: { tags: ['System'], summary: 'Aggregate across sessions', responses: { 200: { description: 'Totals.', content: { 'application/json': { schema: { type: 'object', properties: { sessions: { type: 'integer' }, connected: { type: 'integer' } } } } } } } },
    },
  },
  webhooks: {
    'message.inbound': {
      post: {
        summary: 'Inbound message',
        description: 'POSTed to `COURANT_WEBHOOK_URL`, signed `X-Signature: sha256=<hmac>` and `X-Token`. Carries the `sessionId`.',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookInbound' } } } },
        responses: { 200: { description: 'Acknowledged.' } },
      },
    },
    'message.status': {
      post: {
        summary: 'Delivery status',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookStatus' } } } },
        responses: { 200: { description: 'Acknowledged.' } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'An API key from WA_API_KEYS, e.g. wa_…' },
      BearerAuth: { type: 'http', scheme: 'bearer', description: 'Same key as Authorization: Bearer <key>.' },
    },
    responses: {
      Ok: { description: 'Success.', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
      Unauthorized: { description: 'Missing or invalid API key.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      BadRequest: { description: 'Invalid input.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      NotFound: { description: 'Not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } } },
      Health: { type: 'object', properties: { ok: { type: 'boolean' }, sessions: { type: 'integer' }, connected: { type: 'integer' }, ready: { type: 'boolean' } } },
      SessionSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['disconnected', 'scanning', 'connected'] },
          phone: { type: 'string' },
          pushName: { type: 'string' },
          uptimeSeconds: { type: 'integer' },
        },
      },
      SessionState: {
        allOf: [
          { $ref: '#/components/schemas/SessionSummary' },
          { type: 'object', properties: { qr: { type: 'string', description: 'data-URL QR, present while scanning.' } } },
        ],
      },
      MediaPayload: {
        type: 'object',
        description: 'One of url or base64 is required.',
        properties: { url: { type: 'string' }, base64: { type: 'string' }, mimetype: { type: 'string' }, filename: { type: 'string' }, caption: { type: 'string' } },
      },
      SendRequest: {
        type: 'object',
        required: ['to'],
        properties: {
          to: { type: 'string', description: 'E.164 recipient.', example: '+22890000000' },
          text: { type: 'string', description: 'Text body (alias: message).' },
          message: { type: 'string', description: 'Alias of text.' },
          media: { $ref: '#/components/schemas/MediaPayload' },
          idempotencyKey: { type: 'string', description: 'A duplicate returns the same job.' },
        },
      },
      JobView: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: jobStatus },
          to: { type: 'string' },
          waId: { type: 'string' },
          error: { type: 'string' },
          attempts: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Metrics: {
        type: 'object',
        properties: {
          queued: { type: 'integer' },
          sentToday: { type: 'integer' },
          dailyCap: { type: ['integer', 'null'], description: 'null = unlimited.' },
          total: { type: 'integer' },
          byStatus: { type: 'object', additionalProperties: { type: 'integer' } },
        },
      },
      WebhookInbound: {
        type: 'object',
        properties: {
          type: { const: 'message.inbound' },
          sessionId: { type: 'string' },
          from: { type: 'string', example: '22890000000@c.us', description: 'The sender’s WhatsApp id — a phone JID (@c.us) or a @lid, which holds no number.' },
          fromPhone: { type: 'string', example: '+22890000000', description: 'The sender’s number in E.164, resolved from a @lid when needed; empty when unknown (groups, channels).' },
          to: { type: 'string' },
          body: { type: 'string' },
          messageId: { type: 'string' },
          timestamp: { type: 'integer' },
          hasMedia: { type: 'boolean' },
          messageType: { type: 'string' },
          sentAt: { type: 'string', format: 'date-time' },
        },
      },
      WebhookStatus: {
        type: 'object',
        properties: {
          type: { const: 'message.status' },
          sessionId: { type: 'string' },
          jobId: { type: 'string' },
          status: { type: 'string', enum: ['sent', 'failed'] },
          to: { type: 'string' },
          waId: { type: 'string' },
          error: { type: 'string' },
          sentAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const
