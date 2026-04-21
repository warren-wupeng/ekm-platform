const { Server } = require('@hocuspocus/server')
const { Redis } = require('@hocuspocus/extension-redis')
const { Logger } = require('@hocuspocus/extension-logger')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const EKM_BACKEND_URL = process.env.EKM_BACKEND_URL || 'https://ekm-backend.fly.dev'
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
      options: {
        db: redisDb,
      },
    }),
  ],

  async onAuthenticate(data) {
    const token = data.token
    if (!token) {
      throw new Error('No token provided')
    }

    try {
      const resp = await fetch(`${EKM_BACKEND_URL}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) {
        throw new Error(`Auth failed: ${resp.status}`)
      }
      const user = await resp.json()
      return { user }
    } catch (err) {
      throw new Error(`Authentication error: ${err.message}`)
    }
  },
})

server.listen()
console.log(`Hocuspocus server listening on port ${PORT}`)
