/**
 * Document-processing API client.
 *
 * Backend endpoints from backend/app/routers/documents.py + tasks.py:
 *   POST /api/v1/documents/{id}/parse  →  { task_id, status }
 *   GET  /api/v1/tasks/{task_id}        →  { task_id, state, result?, error? }
 */
import api from './api'

export type CeleryState = 'PENDING' | 'STARTED' | 'RETRY' | 'FAILURE' | 'SUCCESS'

export interface TriggerParseResponse {
  task_id: string
  status: 'queued' | 'already_parsing'
}

export interface TaskStatus {
  task_id: string
  state: CeleryState
  result?: {
    document_id?: number
    chunk_count?: number
    chars?: number
    status?: string
  }
  error?: string
}

export async function triggerParse(documentId: number): Promise<TriggerParseResponse> {
  const { data } = await api.post<TriggerParseResponse>(
    `/api/v1/documents/${documentId}/parse`,
  )
  return data
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
  const { data } = await api.get<TaskStatus>(`/api/v1/tasks/${taskId}`)
  return data
}
