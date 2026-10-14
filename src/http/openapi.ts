/**
 * OpenAPI 3.1 description of the worker API, served at GET /openapi.json and
 * rendered by Scalar at /docs. Kept hand-written (no decorators/generators) so
 * it stays small and dependency-free.
 */
const jobStatus = ['queued', 'sending', 'sent', 'failed', 'held']

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Courant WhatsApp Worker API',
    version: '1.0.0',
    description:
      'A standalone WhatsApp transport built on whatsapp-web.js. Pairs one real ' +
      'number (QR), sends outbound messages with human-like pacing through a durable ' +
      'queue, and forwards inbound messages + delivery status to a signed webhook. ' +
      'No vendor/BSP, no per-message cost.\n\n' +
      '⚠️ Unofficial and against WhatsApp’s Terms of Service — use for low-volume, ' +
      'opt-in / human-assisted messaging only.',
    license: { name: 'MIT' },
  },
  servers: [{ url: 'https://wa.yaasiin.dev', description: 'Production' }],
  security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
  tags: [
    { name: 'System', description: 'Liveness and metrics.' },
    { name: 'Session', description: 'Pairing and the WhatsApp connection.' },
    { name: 'Numbers', description: 'Check reachability on WhatsApp.' },
    { name: 'Messages', description: 'Queue messages and read their status.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness',
        description: 'Open, no auth. `ready` is true once a number is paired.',
        security: [],
        responses: {
          200: {
            description: 'Service is up.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
    '/api/v1/session': {
      get: {
        tags: ['Session'],
        summary: 'Session status + QR',
        description: 'While `status` is `scanning`, `qr` is a data-URL to scan from WhatsApp → Linked devices.',
        responses: {
          200: {
            description: 'Current session.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionState' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/session/logout': {
      post: {
        tags: ['Session'],
        summary: 'Unlink the number',
        description: 'The next pairing needs a fresh QR scan.',
        responses: { 200: { $ref: '#/components/responses/Ok' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/v1/session/restart': {
      post: {
        tags: ['Session'],
        summary: 'Restart the client',
        responses: { 200: { $ref: '#/components/responses/Ok' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/v1/numbers/check': {
      post: {
        tags: ['Numbers'],
        summary: 'Is a number on WhatsApp?',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phone'],
                properties: { phone: { type: 'string', example: '+22890000000' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Lookup result.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    phone: { type: 'string', example: '+22890000000' },
                    exists: { type: 'boolean' },
                    waId: { type: 'string', example: '22890000000@c.us' },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/messages': {
      post: {
        tags: ['Messages'],
        summary: 'Queue a message',
        description:
          'Returns immediately with a job id (the worker paces the actual send). Poll ' +
          '`GET /api/v1/messages/{id}` or rely on the `message.status` webhook. Provide ' +
          'either `text` (alias `message`) or a `media` object.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SendRequest' },
              examples: {
                text: { summary: 'Text', value: { to: '+22890000000', text: 'Hello 👋', idempotencyKey: 'camp7-contact42' } },
                media: { summary: 'Media by URL', value: { to: '+22890000000', media: { url: 'https://example.com/flyer.jpg', caption: 'Our offer' } } },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Queued.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: { type: 'string', example: 'msg_9f3a1c...' }, status: { type: 'string', enum: jobStatus } },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api/v1/messages/{id}': {
      get: {
        tags: ['Messages'],
        summary: 'Job status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'The job.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JobView' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api/v1/metrics': {
      get: {
        tags: ['System'],
        summary: 'Queue + send metrics',
        responses: {
          200: {
            description: 'Counters.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Metrics' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },
  webhooks: {
    'message.inbound': {
      post: {
        summary: 'Inbound message',
        description: 'POSTed to `COURANT_WEBHOOK_URL`, signed `X-Signature: sha256=<hmac>` and `X-Token`.',
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
      Health: { type: 'object', properties: { ok: { type: 'boolean' }, ready: { type: 'boolean' } } },
      SessionState: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['disconnected', 'scanning', 'connected'] },
          phone: { type: 'string', description: 'Paired number (digits), when connected.' },
          pushName: { type: 'string' },
          qr: { type: 'string', description: 'data-URL QR, present while scanning.' },
          uptimeSeconds: { type: 'integer' },
        },
      },
      MediaPayload: {
        type: 'object',
        description: 'One of url or base64 is required.',
        properties: {
          url: { type: 'string' },
          base64: { type: 'string' },
          mimetype: { type: 'string' },
          filename: { type: 'string' },
          caption: { type: 'string' },
        },
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
          from: { type: 'string', example: '22890000000@c.us' },
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
