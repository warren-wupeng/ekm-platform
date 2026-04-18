/**
 * Real upload API — POST /api/v1/files/upload (multipart single-file).
 *
 * Backend response (from backend/app/schemas/files.py):
 *   { id, name, size, mime_type, stored_path, url, ... }
 *
 * Returns a normalized shape the UploadZone can use. `onProgress` mirrors
 * XHR's upload progress event — axios's onUploadProgress gives us the
 * bytes-loaded / bytes-total pair needed for a percent bar.
 */
import axios from 'axios'
import { API_BASE_URL } from './api'
import { useAuthStore } from '@/store/auth'

export interface UploadedFile {
  id: number
  name: string
  size: number
  mime_type?: string
  url?: string
}

export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)

  // Read token directly (not via default api instance) because we need
  // to override Content-Type for multipart — clearer to build the request
  // from scratch than mutate the shared instance's headers.
  const token = useAuthStore.getState().token

  const { data } = await axios.post<UploadedFile>(
    `${API_BASE_URL}/api/v1/files/upload`,
    form,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Let the browser set the multipart boundary automatically by
        // leaving Content-Type undefined.
      },
      signal,
      onUploadProgress: (evt) => {
        if (!onProgress || !evt.total) return
        onProgress(Math.round((evt.loaded / evt.total) * 100))
      },
    },
  )
  return data
}
