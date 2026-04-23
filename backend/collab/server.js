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

const STORE_MAX_RETRIES = 3
const STORE_RETRY_BASE_DELAY_MS = 500
const STORE_REQUEST_TIMEOUT_MS = 5000

async function putDocumentState(itemId, updateBase64) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), STORE_REQUEST_TIMEOUT_MS)

  try {
    const resp = await fetch(
      `${EKM_BACKEND_INTERNAL_URL}/api/v1/internal/items/${itemId}/content`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': INTERNAL_SERVICE_KEY,
        },
        body: JSON.stringify({ yjs_state: updateBase64 }),
        signal: controller.signal,
      }
    )

    if (!resp.ok) {
      await resp.body?.cancel()
      throw new Error(`PUT failed with status ${resp.status}`)
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`PUT timed out after ${STORE_REQUEST_TIMEOUT_MS}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

async function storeWithRetry(itemId, updateBase64, attempt = 0) {
  try {
    await putDocumentState(itemId, updateBase64)
  } catch (err) {
    if (attempt < STORE_MAX_RETRIES) {
      const delay = STORE_RETRY_BASE_DELAY_MS * 2 ** attempt
      console.warn(
        `[onStoreDocument] Attempt ${attempt + 1} failed for item ${itemId}: ${err.message}. Retrying in ${delay}ms...`
      )
      await new Promise((r) => setTimeout(r, delay))
      return storeWithRetry(itemId, updateBase64, attempt + 1)
    }
    console.error(
      `[onStoreDocument] Giving up after ${STORE_MAX_RETRIES} retries for item ${itemId}:`,
      err.message
    )
    throw new Error(
      `Failed to store document for item ${itemId} after ${STORE_MAX_RETRIES + 1} attempts: ${err.message}`
    )
  }
}

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
      // P2-1: don't echo err.message to client — it may contain backend internals
      console.error('[onAuthenticate] Error:', err.message)
      throw new Error('Authentication failed')
    }
  },

  async onStoreDocument({ documentName, document }) {
    const itemId = parseItemId(documentName)
    const update = Y.encodeStateAsUpdate(document)
    const updateBase64 = Buffer.from(update).toString('base64')
    await storeWithRetry(itemId, updateBase64)
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
