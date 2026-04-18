export type UploadStatus = 'pending' | 'uploading' | 'success' | 'error'

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
