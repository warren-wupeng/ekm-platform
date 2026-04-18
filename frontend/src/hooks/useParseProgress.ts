/**
 * useParseProgress
 *
 * Subscribes to a Celery task's progression via GET /tasks/{id}, polling
 * every 5s until SUCCESS or FAILURE. Calls back with normalized state
 * transitions that the UI (UploadZone row) can render.
 *
 * One hook instance per component, one Map<taskId, intervalId> inside —
 * multiple files upload in parallel without stepping on each other.
 *
 * We stop polling when:
 *   - the task reaches a terminal state (SUCCESS / FAILURE)
 *   - the caller cancels via the returned stop() fn
 *   - the component unmounts (cleanup on effect teardown)
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  getTaskStatus,
  type CeleryState,
  type TaskStatus,
} from '@/lib/documentsApi'
import type { ParseState } from '@/types/upload'

const POLL_INTERVAL_MS = 5_000

function mapState(state: CeleryState): ParseState {
  switch (state) {
    case 'PENDING':
      return 'pending'
    case 'STARTED':
    case 'RETRY':
      return 'parsing'
    case 'SUCCESS':
      return 'parsed'
    case 'FAILURE':
      return 'parse_failed'
    default:
      return 'parsing'
  }
}

export interface ParseProgressHandlers {
  onUpdate: (taskId: string, state: ParseState, detail?: TaskStatus) => void
  onDone?: (taskId: string, state: ParseState, detail: TaskStatus) => void
}

export function useParseProgress({ onUpdate, onDone }: ParseProgressHandlers) {
  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  const stop = useCallback((taskId: string) => {
    const t = timers.current.get(taskId)
    if (t) {
      clearInterval(t)
      timers.current.delete(taskId)
    }
  }, [])

  const poll = useCallback(
    async (taskId: string) => {
      try {
        const status = await getTaskStatus(taskId)
        const parseState = mapState(status.state)
        onUpdate(taskId, parseState, status)
        if (parseState === 'parsed' || parseState === 'parse_failed') {
          stop(taskId)
          onDone?.(taskId, parseState, status)
        }
      } catch (e) {
        // Transient errors (network hiccup, backend restart) — keep polling.
        // Only bail if the UI cancels explicitly.
        console.warn('task poll failed', e)
      }
    },
    [onUpdate, onDone, stop],
  )

  const start = useCallback(
    (taskId: string) => {
      if (timers.current.has(taskId)) return  // already polling
      // Kick off immediately so the UI reflects state within one tick,
      // then settle into the regular cadence.
      void poll(taskId)
      const id = setInterval(() => void poll(taskId), POLL_INTERVAL_MS)
      timers.current.set(taskId, id)
    },
    [poll],
  )

  // Clean up any outstanding timers on unmount.
  useEffect(() => {
    const timersMap = timers.current
    return () => {
      timersMap.forEach((t) => clearInterval(t))
      timersMap.clear()
    }
  }, [])

  return { start, stop }
}
