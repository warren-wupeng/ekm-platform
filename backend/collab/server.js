const { Server } = require('@hocuspocus/server')
const { Redis } = require('@hocuspocus/extension-redis')
const { Logger } = require('@hocuspocus/extension-logger')
const Y = require('yjs')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const EKM_BACKEND_URL = process.env.EKM_BACKEND_URL || 'https://ekm-backend.fly.dev'
const EKM_BACKEND_INTERNAL_URL = process.env.EKM_BACKEND_INTERNAL_URL || 'http://ekm-backend.internal:8000'
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY
if (!INTERNAL_SERVICE_KEY) {
  console.error('FATAL: INTERNAL_SERVICE_KEY not set')
  process.exit(1)
}
const PORT = parseInt(process.env.PORT || '1234')

function parseItemId(documentName) {
  const rawId = documentName.replace('doc:', '')
  const itemId = parseInt(rawId, 10)
  if (!Number.isInteger(itemId) || itemId <= 0) {
    throw new Error('Invalid document name')
  }
  return itemId
}

// Parse redis URL into host/port for the extension
const redisUrl = new URL(REDIS_URL)
const redisHost = redisUrl.hostname
const redisPort = parseInt(redisUrl.port || '6379')
const redisDb = parseInt(redisUrl.pathname.replace('/', '') || '0')

// EKM auth + persistence extension.
// IMPORTANT: onAuthenticate MUST be on an extension object inside the
// `extensions` array — Hocuspocus's `requiresAuthentication` getter only
// checks extensions, not top-level hooks.  A top-level onAuthenticate
// would silently be ignored for the "requires auth?" check, allowing
// unauthenticated WebSocket connections (see P0 security bug).
const ekmExtension = {
  async onAuthenticate(data) {
    const token = data.token
    if (!token) {
      throw new Error('No token provided')
    }

    try {
      // Verify JWT and get user info
      const authResp = await fetch(`${EKM_BACKEND_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!authResp.ok) {
        throw new Error(`Auth failed: ${authResp.status}`)
      }
      const user = await authResp.json()

      // Check room-level access
      const itemId = parseItemId(data.documentName)
      const accessResp = await fetch(
        `${EKM_BACKEND_INTERNAL_URL}/api/v1/internal/items/${itemId}/access?user_id=${user.id}`,
        { headers: { 'X-Service-Key': INTERNAL_SERVICE_KEY } }
      )
      if (!accessResp.ok) {
        throw new Error(`Access check failed: ${accessResp.status}`)
      }
      const access = await accessResp.json()
      if (!access.allowed) {
        throw new Error('Access denied')
      }

      return { user }
    } catch (err) {
      throw new Error(`Authentication error: ${err.message}`)
    }
  },

  async onStoreDocument({ documentName, document }) {
    const itemId = parseItemId(documentName)

    try {
      const update = Y.encodeStateAsUpdate(document)
      const updateBase64 = Buffer.from(update).toString('base64')

      const resp = await fetch(
        `${EKM_BACKEND_INTERNAL_URL}/api/v1/internal/items/${itemId}/content`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Key': INTERNAL_SERVICE_KEY,
          },
          body: JSON.stringify({ yjs_state: updateBase64 }),
        }
      )
      if (!resp.ok) {
        console.error(`[onStoreDocument] PUT failed for item ${itemId}: ${resp.status}`)
      }
    } catch (err) {
      console.error(`[onStoreDocument] Error for item ${itemId}:`, err.message)
    }
  },
}

const server = Server.configure({
  port: PORT,

  extensions: [
    new Logger(),
    new Redis({
      host: redisHost,
      port: redisPort,
      options: {
        db: redisDb,
      },
    }),
    ekmExtension,
  ],
})

server.listen()
console.log(`Hocuspocus server listening on port ${PORT}`)
