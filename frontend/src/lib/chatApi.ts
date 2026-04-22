/**
 * RAG chat SSE client.
 *
 * Backend contract (backend/app/routers/chat.py):
 *   POST /api/v1/chat/stream  { query, top_k? }
 *   → text/event-stream with five event types:
 *       event: tool_call  data: {"tool": "...", "status": "running"}
 *       event: sources    data: [{document_id, chunk_index, content, score}]
 *       event: delta      data: "token chunk"   (may be quoted JSON string)
 *       event: done       data: [DONE]
 *       event: error      data: "human-readable error message"
 *
 * We can't use the browser's EventSource here — it only supports GET and
 * can't attach an Authorization header. So we read the raw ReadableStream
 * ourselves and parse SSE frames by hand. Each yielded event is already
 * decoded; callers get a discriminated union and drive UI state off it.
 */
import { API_BASE_URL } from './api'
import { useAuthStore } from '@/store/auth'

export interface ChatSource {
  document_id: number
  chunk_index: number
  content: string
  score: number
  /** Backend may include filename in a later pass — optional so the UI can
   * fall back to doc-id rendering without breaking. */
  filename?: string
}

export type ChatEvent =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'delta'; delta: string }
  | { type: 'tool_call'; tool: string; status: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface StreamChatParams {
  query: string
  topK?: number
  signal?: AbortSignal
}

/** Parse one SSE frame (already newline-split block) into ChatEvent | null. */
function parseFrame(block: string): ChatEvent | null {
  let event: string | null = null
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      // Preserve internal spaces, drop only the single leading space.
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  if (!event) return null
  const data = dataLines.join('\n')
  switch (event) {
    case 'sources':
      try {
        return { type: 'sources', sources: JSON.parse(data) as ChatSource[] }
      } catch {
        return null
      }
    case 'delta': {
      // Backend json-encodes strings (json.dumps) so a quoted payload is
      // expected; plain strings are also tolerated.
      let delta = data
      if (delta.startsWith('"') && delta.endsWith('"')) {
        try { delta = JSON.parse(delta) as string } catch { /* keep raw */ }
      }
      return { type: 'delta', delta }
    }
    case 'tool_call':
      try {
        const payload = JSON.parse(data) as { tool: string; status: string }
        return { type: 'tool_call', tool: payload.tool, status: payload.status }
      } catch {
        return null
      }
    case 'done':
      return { type: 'done' }
    case 'error':
      return { type: 'error', message: data }
    default:
      return null
  }
}

export async function* streamChat({
  query,
  topK,
  signal,
}: StreamChatParams): AsyncGenerator<ChatEvent, void, void> {
  const token = useAuthStore.getState().token
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, ...(topK ? { top_k: topK } : {}) }),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`chat stream failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE frame boundary is a blank line. Split lazily and leave the
      // partial tail in the buffer for the next read.
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const evt = parseFrame(block)
        if (evt) yield evt
        if (evt?.type === 'done') return
      }
    }
    // Flush any trailing frame (rare — backend closes with blank line).
    if (buffer.trim()) {
      const evt = parseFrame(buffer)
      if (evt) yield evt
    }
  } finally {
    reader.releaseLock()
  }
}
