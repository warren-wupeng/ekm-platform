export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error'

// Parse state for the post-upload Tika pipeline. Distinct from upload
// status because a file can be fully uploaded yet still parsing in the
// background.
export type ParseState =
  | 'idle'          // parse not triggered
  | 'pending'       // queued, worker hasn't picked it up
  | 'parsing'       // worker actively parsing
  | 'parsed'        // success — chunks persisted, downstream fan-out running
  | 'parse_failed'  // terminal failure

export type FileType = 'document' | 'image' | 'video' | 'audio' | 'archive' | 'other'

export interface UploadFile {
  uid: string
  name: string
  size: number
  type: string
  fileType: FileType
  status: UploadStatus
  progress: number   // 0-100
  error?: string
  url?: string        // after success

  // Backend document id returned by POST /files/upload; required before
  // we can trigger /documents/{id}/parse.
  documentId?: number
  parseState?: ParseState
  parseTaskId?: string
  parseError?: string
}

export interface KnowledgeItem {
  id: string
  name: string
  fileType: FileType
  size: number
  uploadedAt: string
  uploadedBy: string
  tags: string[]
  downloads: number
}
