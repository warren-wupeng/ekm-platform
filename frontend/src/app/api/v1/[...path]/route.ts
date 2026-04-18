import { NextRequest, NextResponse } from 'next/server'

// BACKEND_URL is read at runtime (not baked in at build time).
// Set it in fly.toml [env] or docker-compose environment.
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

async function proxy(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const backendUrl = `${BACKEND_URL}${url.pathname}${url.search}`

  const headers = new Headers(req.headers)
  // Remove host header so backend doesn't get confused
  headers.delete('host')

  try {
    const res = await fetch(backendUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      // @ts-expect-error -- Node 18+ fetch supports duplex for streaming
      duplex: 'half',
    })

    const responseHeaders = new Headers(res.headers)
    // Remove encoding headers that Next.js will handle
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('transfer-encoding')

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    })
  } catch (err) {
    console.error('[proxy] backend unreachable:', backendUrl, err)
    return NextResponse.json(
      { detail: { code: 'BACKEND_UNAVAILABLE', message: 'Backend service is unavailable' } },
      { status: 503 }
    )
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy

// Required for SSE streaming responses
export const dynamic = 'force-dynamic'
