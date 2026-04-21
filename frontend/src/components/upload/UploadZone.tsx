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
import { getFileType, formatFileSize } from '@/lib/mockUpload'
import { uploadFile } from '@/lib/uploadApi'
import { triggerParse } from '@/lib/documentsApi'
import { useParseProgress } from '@/hooks/useParseProgress'
import { useTranslation } from 'react-i18next'

interface Props {
  onUploaded?: (files: UploadFile[]) => void
  /** Fires after a file has been uploaded AND its parse task has reached a
   * terminal state (parsed / parse_failed). Parent can use this to mutate
   * the SWR cache on the knowledge list so the new row shows up. */
  onParseSettled?: (file: UploadFile) => void
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

export default function UploadZone({ onUploaded, onParseSettled }: Props) {
  const { t } = useTranslation()
  const [files, setFiles]   = useState<UploadFile[]>([])
  const [dragOver, setDrag] = useState(false)
  const inputRef            = useRef<HTMLInputElement>(null)
  const abortsRef           = useRef<Map<string, AbortController>>(new Map())
  // task_id → uid mapping so task-poll updates find the right row.
  const taskToUidRef        = useRef<Map<string, string>>(new Map())
  // Snapshot of the last known file state keyed by uid — lets the parse
  // onDone callback resolve the UploadFile without racing setState.
  const filesByUidRef       = useRef<Map<string, UploadFile>>(new Map())

  function updateFile(uid: string, patch: Partial<UploadFile>) {
    setFiles((prev) => {
      const next = prev.map((f) => f.uid === uid ? { ...f, ...patch } : f)
      const updated = next.find((f) => f.uid === uid)
      if (updated) filesByUidRef.current.set(uid, updated)
      return next
    })
  }

  const parseProgress = useParseProgress({
    onUpdate: (taskId, parseState) => {
      const uid = taskToUidRef.current.get(taskId)
      if (!uid) return
      updateFile(uid, { parseState })
    },
    onDone: (taskId, parseState, detail) => {
      const uid = taskToUidRef.current.get(taskId)
      if (!uid) return
      taskToUidRef.current.delete(taskId)
      const patch: Partial<UploadFile> = { parseState }
      if (parseState === 'parse_failed') {
        patch.parseError = detail.error ?? t('upload.parse_failed')
      }
      updateFile(uid, patch)
      const final = { ...filesByUidRef.current.get(uid)!, ...patch }
      onParseSettled?.(final)
    },
  })

  const beginParse = useCallback(
    async (uid: string, documentId: number) => {
      updateFile(uid, { parseState: 'pending' })
      try {
        const { task_id } = await triggerParse(documentId)
        taskToUidRef.current.set(task_id, uid)
        updateFile(uid, { parseTaskId: task_id, parseState: 'pending' })
        parseProgress.start(task_id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('upload.trigger_parse_failed')
        updateFile(uid, { parseState: 'parse_failed', parseError: msg })
      }
    },
    [parseProgress, t],
  )

  const startUpload = useCallback(async (file: File) => {
    const uid: string = nanoid()
    const fileType = getFileType(file)
    const entry: UploadFile = {
      uid, name: file.name, size: file.size, type: file.type,
      fileType, status: 'uploading', progress: 0,
      parseState: 'idle',
    }
    setFiles((prev) => [...prev, entry])
    filesByUidRef.current.set(uid, entry)

    const ctrl = new AbortController()
    abortsRef.current.set(uid, ctrl)

    try {
      const uploaded = await uploadFile(
        file,
        (pct) => updateFile(uid, { progress: pct }),
        ctrl.signal,
      )
      updateFile(uid, {
        status: 'success',
        progress: 100,
        url: uploaded.url,
        documentId: uploaded.id,
      })
      onUploaded?.([{
        ...entry, status: 'success', progress: 100,
        url: uploaded.url, documentId: uploaded.id,
      }])
      // Auto-fire the parse pipeline. Fire-and-forget — progress is
      // tracked via useParseProgress.
      void beginParse(uid, uploaded.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('upload.upload_failed')
      updateFile(uid, { status: 'error', error: msg })
    } finally {
      abortsRef.current.delete(uid)
    }
  }, [onUploaded, beginParse, t])

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
    // If upload itself failed we can't retry — the original File reference
    // is gone. User must re-drag the file. When parse failed, however, we
    // have documentId in hand and can just re-kick the pipeline.
    if (f.parseState === 'parse_failed' && f.documentId !== undefined) {
      void beginParse(uid, f.documentId)
    }
  }

  function clearAll() {
    abortsRef.current.forEach((ctrl) => ctrl.abort())
    abortsRef.current.clear()
    setFiles([])
  }

  const doneCount = files.filter((f) => f.parseState === 'parsed').length
  const errorCount = files.filter(
    (f) => f.status === 'error' || f.parseState === 'parse_failed',
  ).length
  const uploadingCount = files.filter(
    (f) =>
      f.status === 'uploading' ||
      f.parseState === 'pending' ||
      f.parseState === 'parsing',
  ).length

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
          {t('upload.drop_hint')}
        </p>
        <p className="text-slate-400 text-xs mt-1">
          {t('upload.file_types_hint')}
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
              <span className="font-medium text-slate-700">{t('upload.file_count', { count: files.length })}</span>
              {doneCount > 0 && (
                <Tag color="success" className="m-0 text-xs">{t('upload.success_count', { count: doneCount })}</Tag>
              )}
              {uploadingCount > 0 && (
                <Tag color="processing" className="m-0 text-xs">{t('upload.uploading_count', { count: uploadingCount })}</Tag>
              )}
              {errorCount > 0 && (
                <Tag color="error" className="m-0 text-xs">{t('upload.error_count', { count: errorCount })}</Tag>
              )}
            </div>
            <Button size="small" type="text" onClick={clearAll} className="text-slate-400 text-xs">
              {t('upload.clear_list')}
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
                    {/* Parse stage — only render when upload succeeded so
                       we don't confuse upload vs parse states visually. */}
                    {f.status === 'success' && f.parseState === 'pending' && (
                      <span className="text-xs text-slate-400">{t('upload.status_uploaded_pending')}</span>
                    )}
                    {f.status === 'success' && f.parseState === 'parsing' && (
                      <Progress
                        percent={100}
                        size="small"
                        showInfo={false}
                        status="active"
                        strokeColor="var(--ekm-primary)"
                        className="flex-1 !mb-0"
                        style={{ lineHeight: 1 }}
                      />
                    )}
                    {f.status === 'success' && f.parseState === 'parsed' && (
                      <span className="text-xs text-green-600">{t('upload.status_parsed')}</span>
                    )}
                    {f.status === 'success' && f.parseState === 'parse_failed' && (
                      <span className="text-xs text-red-500">
                        {f.parseError
                          ? t('upload.parse_failed_detail', { error: f.parseError })
                          : t('upload.parse_failed')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status icon + actions. Upload-stage states take priority;
                    once upload is done we reflect parse-stage state. */}
                <div className="flex items-center gap-1 shrink-0">
                  {f.status === 'uploading' && (
                    <LoadingOutlined className="text-primary text-base" />
                  )}
                  {f.status === 'success' &&
                    (f.parseState === 'pending' || f.parseState === 'parsing') && (
                      <LoadingOutlined className="text-primary text-base" />
                    )}
                  {f.status === 'success' && f.parseState === 'parsed' && (
                    <CheckCircleFilled className="text-green-500 text-base" />
                  )}
                  {f.status === 'success' && f.parseState === 'idle' && (
                    // Uploaded but parse not yet triggered — usually a brief flash
                    <CheckCircleFilled className="text-green-500 text-base" />
                  )}
                  {f.status === 'success' && f.parseState === 'parse_failed' && (
                    <>
                      <ExclamationCircleFilled className="text-red-400 text-base" />
                      <Tooltip title={t('upload.reparse')}>
                        <button
                          onClick={() => retryFile(f.uid)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-primary"
                        >
                          <ReloadOutlined className="text-xs" />
                        </button>
                      </Tooltip>
                    </>
                  )}
                  {f.status === 'error' && (
                    <>
                      <ExclamationCircleFilled className="text-red-400 text-base" />
                      <Tooltip title={t('upload.reparse')}>
                        <button
                          onClick={() => retryFile(f.uid)}
                          className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-primary"
                        >
                          <ReloadOutlined className="text-xs" />
                        </button>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip title={f.status === 'uploading' ? t('upload.cancel') : t('upload.remove')}>
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
