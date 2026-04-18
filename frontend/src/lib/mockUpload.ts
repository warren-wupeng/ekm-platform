import type { FileType, KnowledgeItem } from '@/types/upload'

export function getFileType(file: File): FileType {
  const mime = file.type
  const name = file.name.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (
    mime.includes('pdf') || mime.includes('word') || mime.includes('document') ||
    mime.includes('spreadsheet') || mime.includes('presentation') ||
    name.endsWith('.pdf') || name.endsWith('.doc') || name.endsWith('.docx') ||
    name.endsWith('.xls') || name.endsWith('.xlsx') || name.endsWith('.ppt') ||
    name.endsWith('.pptx') || name.endsWith('.txt') || name.endsWith('.md')
  ) return 'document'
  if (
    mime.includes('zip') || mime.includes('tar') || mime.includes('rar') ||
    name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz') || name.endsWith('.rar')
  ) return 'archive'
  return 'other'
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/**
 * Simulate upload with progress callbacks.
 * Resolves with mock URL on success, rejects on error.
 */
export function mockUploadFile(
  file: File,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 1% chance of failure for realism
    const willFail = Math.random() < 0.01

    let pct = 0
    const totalMs = 800 + Math.random() * 1200  // 0.8s – 2s
    const tickMs = 80
    const ticks = totalMs / tickMs

    const interval = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(interval)
        reject(new Error('上传已取消'))
        return
      }
      pct = Math.min(pct + (100 / ticks) + Math.random() * 3, 99)
      onProgress(Math.floor(pct))
    }, tickMs)

    setTimeout(() => {
      clearInterval(interval)
      if (willFail) {
        reject(new Error('服务器繁忙，请重试'))
      } else {
        onProgress(100)
        resolve(`/mock/files/${Date.now()}-${file.name}`)
      }
    }, totalMs)
  })
}

export const MOCK_KNOWLEDGE_LIST: KnowledgeItem[] = [
  {
    id: 'k1', name: 'EKM产品需求文档v2.pdf', fileType: 'document',
    size: 2_340_000, uploadedAt: '2026-04-17', uploadedBy: 'Warren Wu',
    tags: ['产品', 'PRD'], downloads: 42,
  },
  {
    id: 'k2', name: '技术架构设计.docx', fileType: 'document',
    size: 890_000, uploadedAt: '2026-04-16', uploadedBy: 'Kira',
    tags: ['技术', '架构'], downloads: 18,
  },
  {
    id: 'k3', name: '系统截图合集.zip', fileType: 'archive',
    size: 15_400_000, uploadedAt: '2026-04-15', uploadedBy: 'Warren Wu',
    tags: ['设计'], downloads: 7,
  },
  {
    id: 'k4', name: '竞品分析报告.xlsx', fileType: 'document',
    size: 1_200_000, uploadedAt: '2026-04-14', uploadedBy: 'Warren Wu',
    tags: ['调研', '竞品'], downloads: 23,
  },
  {
    id: 'k5', name: 'Logo设计素材.png', fileType: 'image',
    size: 430_000, uploadedAt: '2026-04-13', uploadedBy: 'Luca',
    tags: ['设计', 'VI'], downloads: 11,
  },
]
