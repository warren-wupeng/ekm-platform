const { Server } = require('@hocuspocus/server')
const { Redis } = require('@hocuspocus/extension-redis')
const { Logger } = require('@hocuspocus/extension-logger')
const { TiptapTransformer } = require('@hocuspocus/transformer')
const { generateHTML } = require('@tiptap/html')
const StarterKit = require('@tiptap/starter-kit').default

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const EKM_BACKEND_URL = process.env.EKM_BACKEND_URL || 'https://ekm-backend.fly.dev'
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || ''
const PORT = parseInt(process.env.PORT || '1234')

// Parse redis URL into host/port for the extension
const redisUrl = new URL(REDIS_URL)
const redisHost = redisUrl.hostname
const redisPort = parseInt(redisUrl.port || '6379')
const redisDb = parseInt(redisUrl.pathname.replace('/', '') || '0')

const server = Server.configure({
  port: PORT,

  extensions: [
    new Logger(),
    new Redis({
      host: redisHost,
      port: redisPort,
      options: { db: redisDb },
    }),
  ],

  // P1-2: Reject empty token, validate JWT against ekm-backend
  async onAuthenticate(data) {
    const token = data.token
    if (!token) {
      throw new Error('Unauthorized: no token')
    }

    let user
    try {
      const resp = await fetch(`${EKM_BACKEND_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) {
        throw new Error(`Auth failed: ${resp.status}`)
      }
      user = await resp.json()
    } catch (err) {
      throw new Error(`Unauthorized: ${err.message}`)
    }

    // Check room-level access: documentName = 'doc:{item_id}'
    const match = data.documentName.match(/^doc:(\d+)$/)
    if (match) {
      const itemId = match[1]
      try {
        const resp = await fetch(`${EKM_BACKEND_URL}/api/v1/knowledge/items/${itemId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) {
          throw new Error(`Access denied to document ${itemId}`)
        }
      } catch (err) {
        throw new Error(`Unauthorized: ${err.message}`)
      }
    }

    return { user }
  },

  // P1-3: Persist Y.Doc to ekm-backend via internal service endpoint
  async onStoreDocument(data) {
    const { documentName, document } = data

    const match = documentName.match(/^doc:(\d+)$/)
    if (!match) {
      console.warn(`[onStoreDocument] Unknown documentName format: ${documentName}, skipping`)
      return
    }
    const itemId = match[1]

    try {
      // Convert Y.Doc → Tiptap JSON → HTML
      const json = TiptapTransformer.fromYdoc(document, 'default')
      const html = generateHTML(json, [StarterKit])

      const resp = await fetch(`${EKM_BACKEND_URL}/api/v1/internal/items/${itemId}/content`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': INTERNAL_SERVICE_KEY,
        },
        body: JSON.stringify({ content: html }),
      })

      if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`Backend responded ${resp.status}: ${text}`)
      }

      console.log(`[onStoreDocument] Persisted doc:${itemId}`)
    } catch (err) {
      console.error(`[onStoreDocument] Failed to persist ${documentName}: ${err.message}`)
      // Don't rethrow — Hocuspocus will retry on next change
    }
  },
})

server.listen()
console.log(`Hocuspocus server listening on port ${PORT}`)
