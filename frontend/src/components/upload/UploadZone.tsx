'use client'
import { useRef, useState, useCallback } from 'react'
import { Button, Progress, Tag, Tooltip } from 'antd'
import {
  InboxOutlined, CloseOutlined, ReloadOutlined,
  CheckCircleFilled, ExclamationCircleFilled, LoadingOutlined,
  FileTextOutlined, FileImageOutlined, FileZipOutlined,
  SoundOutlined, VideoCameraOutlined, FileOutlined,
} from '@ant-design/icons'
import clsx from 'clsx'
import { nanoid } from 'nanoid'
import type { UploadFile, FileType } from '@/types/upload'
import { getFileType, formatFileSize, mockUploadFile } from '@/lib/mockUpload'

interface Props {
  onUploaded?: (files: UploadFile[]) => void
}

const TYPE_ICON: Record<FileType, React.ReactNode> = {
  document: <FileTextOutlined />,
  image:    <FileImageOutlined />,
  archive:  <FileZipOutlined />,
  audio:    <SoundOutlined />,
  video:    <VideoCameraOutlined />,
  other:    <FileOutlined />,
}

const TYPE_COLOR: Record<FileType, string> = {
  document: 'blue',
  image:    'cyan',
  archive:  'orange',
  audio:    'purple',
  video:    'magenta',
  other:    'default',
}

export default function UploadZone({ onUploaded }: Props) {
  const [files, setFiles]   = useState<UploadFile[]>([])
  const [dragOver, setDrag] = useState(false)
  const inputRef            = useRef<HTMLInputElement>(null)
  const abortsRef           = useRef<Map<string, AbortController>>(new Map())

  function updateFile(uid: string, patch: Partial<UploadFile>) {
    setFiles((prev) => prev.map((f) => f.uid === uid ? { ...f, ...patch } : f))
  }

  const startUpload = useCallback(async (file: File) => {
    const uid: string = nanoid()
    const fileType = getFileType(file)
    const entry: UploadFile = {
      uid, name: file.name, size: file.size, type: file.type,
      fileType, status: 'uploading', progress: 0,
    }
    setFiles((prev) => [...prev, entry])

    const ctrl = new AbortController()
    abortsRef.current.set(uid, ctrl)

    try {
      const url = await mockUploadFile(
        file,
        (pct) => updateFile(uid, { progress: pct }),
        ctrl.signal
      )
      updateFile(uid, { status: 'success', progress: 100, url })
      onUploaded?.([{ ...entry, status: 'success', progress: 100, url }])
    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败'
      updateFile(uid, { status: 'error', error: msg })
    } finally {
      abortsRef.current.delete(uid)
    }
  }, [onUploaded])

  function addFiles(fileList: FileList | null) {
    if (!fileList) return
    Array.from(fileList).forEach(startUpload)
  }

  function removeFile(uid: string) {
    abortsRef.current.get(uid)?.abort()
    abortsRef.current.delete(uid)
    setFiles((prev) => prev.filter((f) => f.uid !== uid))
  }

  function retryFile(uid: string) {
    const f = files.find((x) => x.uid === uid)
    if (!f) return
    // Create a mock File to retry (in real app would keep original)
    const blob = new Blob([''], { type: f.type })
    const file = new File([blob], f.name, { type: f.type })
    updateFile(uid, { status: 'uploading', progress: 0, error: undefined })
    const ctrl = new AbortController()
    abortsRef.current.set(uid, ctrl)
    mockUploadFile(file, (pct) => updateFile(uid, { progress: pct }), ctrl.signal)
      .then((url) => updateFile(uid, { status: 'success', progress: 100, url }))
      .catch((err) => updateFile(uid, { status: 'error', error: err.message }))
      .finally(() => abortsRef.current.delete(uid))
  }

  function clearAll() {
    abortsRef.current.forEach((ctrl) => ctrl.abort())
    abortsRef.current.clear()
    setFiles([])
  }

  const doneCount = files.filter((f) => f.status === 'success').length
  const errorCount = files.filter((f) => f.status === 'error').length
  const uploadingCount = files.filter((f) => f.status === 'uploading').length

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        className={clsx(
          'relative border-2 border-dashed rounded-2xl flex flex-col items-center justify-center',
          'cursor-pointer transition-all duration-200 py-10',
          dragOver
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-slate-200 bg-white hover:border-primary/50 hover:bg-primary/3'
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        <InboxOutlined
          className={clsx(
            'text-5xl mb-3 transition-colors',
            dragOver ? 'text-primary' : 'text-slate-300'
          )}
        />
        <p className="text-slate-600 font-medium text-sm">
          拖拽文件到此处，或<span className="text-primary">点击上传</span>
        </p>
        <p className="text-slate-400 text-xs mt-1">
          支持 PDF、Word、Excel、图片、压缩包等，单文件最大 100MB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{files.length} 个文件</span>
              {doneCount > 0 && (
                <Tag color="success" className="m-0 text-xs">{doneCount} 成功</Tag>
              )}
              {uploadingCount > 0 && (
                <Tag color="processing" className="m-0 text-xs">{uploadingCount} 上传中</Tag>
              )}
              {errorCount > 0 && (
                <Tag color="error" className="m-0 text-xs">{errorCount} 失败</Tag>
              )}
            </div>
            <Button size="small" type="text" onClick={clearAll} className="text-slate-400 text-xs">
              清空列表
            </Button>
          </div>

          {/* File rows */}
          <ul className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {files.map((f) => (
              <li key={f.uid} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 group">
                {/* Icon */}
                <span className={clsx(
                  'w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0',
                  f.status === 'error' ? 'bg-red-50 text-red-400' : 'bg-primary/10 text-primary'
                )}>
                  {TYPE_ICON[f.fileType]}
                </span>

                {/* Name + progress */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700 truncate max-w-[240px]">{f.name}</span>
                    <Tag color={TYPE_COLOR[f.fileType]} className="m-0 text-xs shrink-0">
                      {f.fileType}
                    </Tag>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">{formatFileSize(f.size)}</span>
                    {f.status === 'uploading' && (
                      <Progress
                        percent={f.progress}
                        size="small"
                        showInfo={false}
                        strokeColor="var(--ekm-primary)"
                        className="flex-1 !mb-0"
                        style={{ lineHeight: 1 }}
                      />
                    )}
                    {f.status === 'error' && (
                      <span className="text-xs text-red-500">{f.error}</span>
                    )}
                  </div>
                </div>

                {/* Status icon + actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {f.status === 'uploading' && (
                    <LoadingOutlined className="text-primary text-base" />
                  )}
                  {f.status === 'success' && (
                    <CheckCircleFilled className="text-green-500 text-base" />
                  )}
                  {f.status === 'error' && (
                    <>
                      <ExclamationCircleFilled className="text-red-400 text-base" />
                      <Tooltip title="重试">
                        <button
                          onClick={() => retryFile(f.uid)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-primary"
                        >
                          <ReloadOutlined className="text-xs" />
                        </button>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip title={f.status === 'uploading' ? '取消' : '移除'}>
                    <button
                      onClick={() => removeFile(f.uid)}
                      className="w-6 h-6 flex items-center justify-center text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <CloseOutlined className="text-xs" />
                    </button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
