'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { App, Button, Tag, Tooltip, Popconfirm, Spin, Empty } from 'antd'
import {
  ClockCircleOutlined, RollbackOutlined, StarOutlined,
  StarFilled, ArrowLeftOutlined, SwapOutlined,
} from '@ant-design/icons'
import { useRouter, useSearchParams } from 'next/navigation'
import api from '@/lib/api'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ApiVersion {
  id: number
  version_number: number
  knowledge_item_id: number
  name: string
  change_summary: string | null
  created_by_id: number | null
  created_at: string | null
}

// ── Diff ───────────────────────────────────────────────────────────────────────

function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  type DiffLine = { type: 'added' | 'removed' | 'unchanged'; text: string }
  const result: { left: DiffLine; right: DiffLine }[] = []
  let oi = 0, ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    const ol = oldLines[oi], nl = newLines[ni]
    if (oi >= oldLines.length) {
      result.push({ left: { type: 'unchanged', text: '' }, right: { type: 'added', text: nl } }); ni++
    } else if (ni >= newLines.length) {
      result.push({ left: { type: 'removed', text: ol }, right: { type: 'unchanged', text: '' } }); oi++
    } else if (ol === nl) {
      result.push({ left: { type: 'unchanged', text: ol }, right: { type: 'unchanged', text: nl } }); oi++; ni++
    } else {
      const nextNewMatchesOld = newLines[ni + 1] === ol
      const nextOldMatchesNew = oldLines[oi + 1] === nl
      if (nextNewMatchesOld && !nextOldMatchesNew) {
        result.push({ left: { type: 'unchanged', text: '' }, right: { type: 'added', text: nl } }); ni++
      } else if (nextOldMatchesNew && !nextNewMatchesOld) {
        result.push({ left: { type: 'removed', text: ol }, right: { type: 'unchanged', text: '' } }); oi++
      } else {
        result.push({ left: { type: 'removed', text: ol }, right: { type: 'added', text: nl } }); oi++; ni++
      }
    }
  }
  return result
}

const LINE_STYLE: Record<string, string> = {
  added: 'bg-green-50 border-l-2 border-green-400',
  removed: 'bg-red-50 border-l-2 border-red-400',
  unchanged: '',
}
const LINE_TEXT_STYLE: Record<string, string> = {
  added: 'text-green-700',
  removed: 'text-red-600',
  unchanged: 'text-slate-700',
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function VersionHistoryPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemId = searchParams.get('id')

  const [starredIds, setStarredIds]     = useState<Set<number>>(new Set())
  // contentCache[versionId] = content_text (loaded on demand)
  const [contentCache, setContentCache] = useState<Record<number, string>>({})
  const [selectedLeft, setSelectedLeft]   = useState<ApiVersion | null>(null)
  const [selectedRight, setSelectedRight] = useState<ApiVersion | null>(null)
  const [compareMode, setCompareMode]     = useState(true)
  const [rollingBack, setRollingBack]     = useState<number | null>(null)

  // Fetch version list
  const { data, isLoading, mutate } = useSWR<{ versions: ApiVersion[]; count: number }>(
    itemId ? `/api/v1/knowledge/${itemId}/versions` : null,
    (url: string) => api.get(url).then((r) => r.data),
  )
  const versions = data?.versions ?? []
  const docName  = versions[0]?.name ?? (itemId ? `Doc #${itemId}` : '—')

  // Auto-select newest two when data arrives
  const initDone = selectedRight !== null
  if (!initDone && versions.length >= 2) {
    setSelectedRight(versions[0])
    setSelectedLeft(versions[1])
  } else if (!initDone && versions.length === 1) {
    setSelectedRight(versions[0])
  }

  // Lazy load content_text for a version
  async function ensureContent(ver: ApiVersion): Promise<string> {
    if (contentCache[ver.id] !== undefined) return contentCache[ver.id]
    const res = await api.get(`/api/v1/knowledge/${itemId}/versions/${ver.id}`)
    const text: string = res.data.content_text ?? ''
    setContentCache((prev) => ({ ...prev, [ver.id]: text }))
    return text
  }

  async function selectAsRight(ver: ApiVersion) {
    setSelectedRight(ver)
    await ensureContent(ver)
  }

  async function selectAsLeft(ver: ApiVersion) {
    setSelectedLeft(ver)
    await ensureContent(ver)
  }

  const leftContent  = selectedLeft  ? (contentCache[selectedLeft.id]  ?? '') : ''
  const rightContent = selectedRight ? (contentCache[selectedRight.id] ?? '') : ''
  const diff         = compareMode && selectedLeft && selectedRight ? computeDiff(leftContent, rightContent) : []
  const addedCount   = diff.filter((d) => d.right.type === 'added').length
  const removedCount = diff.filter((d) => d.left.type === 'removed').length

  function toggleStar(id: number) {
    setStarredIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleRollback(ver: ApiVersion) {
    if (!itemId) return
    setRollingBack(ver.id)
    try {
      await api.post(`/api/v1/knowledge/${itemId}/rollback/${ver.id}`)
      message.success(t('history.rollback_success', { version: `v${ver.version_number}` }))
      mutate()
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setRollingBack(null)
    }
  }

  if (!itemId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Empty description="No document selected" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3">
        <Button
          type="text" size="small"
          icon={<ArrowLeftOutlined />}
          onClick={() => router.back()}
          className="text-slate-500"
        />
        <div>
          <h1 className="text-base font-semibold text-slate-800">{t('history.page_title')}</h1>
          <p className="text-xs text-slate-400">{docName}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="small"
            icon={<SwapOutlined />}
            type={compareMode ? 'primary' : 'default'}
            ghost={compareMode}
            onClick={() => setCompareMode((v) => !v)}
          >
            {t('history.compare_view')}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: version timeline */}
        <div
          className="flex-shrink-0 bg-white border-r border-slate-100 overflow-y-auto py-3"
          style={{ width: 260 }}
        >
          <p className="text-xs text-slate-400 px-4 mb-2 font-medium uppercase tracking-wide">
            {t('history.timeline_title')}
          </p>

          {isLoading ? (
            <div className="py-8 flex justify-center"><Spin size="small" /></div>
          ) : versions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-8" description={t('history.no_versions')} />
          ) : versions.map((ver, idx) => {
            const isRight  = selectedRight?.id === ver.id
            const isLeft   = selectedLeft?.id  === ver.id
            const isCurrent = idx === 0
            const starred  = starredIds.has(ver.id)
            return (
              <div
                key={ver.id}
                className={`mx-2 mb-1 rounded-lg px-3 py-2.5 cursor-pointer transition-all border ${
                  isRight
                    ? 'border-primary bg-primary/5'
                    : isLeft
                    ? 'border-slate-300 bg-slate-50'
                    : 'border-transparent hover:bg-slate-50'
                }`}
                onClick={() => selectAsRight(ver)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Tag
                      color={isRight ? 'purple' : 'default'}
                      className="text-xs m-0 px-1.5"
                    >
                      {isCurrent ? t('history.current_label', { v: ver.version_number }) : `v${ver.version_number}`}
                    </Tag>
                    {starred && <StarFilled className="text-yellow-400 text-xs" />}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip title={starred ? t('history.unstar') : t('history.star')}>
                      <button
                        className="text-slate-300 hover:text-yellow-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); toggleStar(ver.id) }}
                      >
                        {starred ? <StarFilled className="text-xs" /> : <StarOutlined className="text-xs" />}
                      </button>
                    </Tooltip>
                    {!isCurrent && (
                      <Tooltip title={t('history.set_baseline')}>
                        <button
                          className={`text-xs px-1 rounded transition-colors ${
                            isLeft ? 'text-slate-600 bg-slate-200' : 'text-slate-300 hover:text-slate-500'
                          }`}
                          onClick={(e) => { e.stopPropagation(); selectAsLeft(ver) }}
                        >
                          {t('history.baseline_badge')}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {ver.change_summary && (
                  <p className="text-xs text-slate-600 leading-tight mb-1">{ver.change_summary}</p>
                )}
                <p className="text-xs text-slate-400">
                  <ClockCircleOutlined className="mr-1" />
                  {ver.created_at?.slice(0, 16).replace('T', ' ')}
                </p>
                {!isCurrent && (
                  <div className="mt-1.5">
                    <Popconfirm
                      title={t('history.confirm_rollback')}
                      description={t('history.rollback_desc', { version: `v${ver.version_number}` })}
                      onConfirm={() => handleRollback(ver)}
                      okText={t('history.rollback')}
                      cancelText={t('common.cancel')}
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small" type="text"
                        icon={<RollbackOutlined />}
                        loading={rollingBack === ver.id}
                        className="text-slate-400 hover:text-primary text-xs h-6 px-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('history.rollback')}
                      </Button>
                    </Popconfirm>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Right: diff / content view */}
        <div className="flex-1 overflow-auto">
          {!selectedRight ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              {t('history.select_version')}
            </div>
          ) : compareMode && selectedLeft ? (
            <>
              {/* Diff stats bar */}
              <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-4 z-10">
                <span className="text-xs text-slate-500">
                  {t('history.compare_label')}
                  <Tag className="mx-1 text-xs">v{selectedLeft.version_number}</Tag>
                  →
                  <Tag color="purple" className="mx-1 text-xs">v{selectedRight.version_number}</Tag>
                </span>
                <span className="text-xs text-green-600 font-medium">{t('history.added_lines', { count: addedCount })}</span>
                <span className="text-xs text-red-500 font-medium">{t('history.removed_lines', { count: removedCount })}</span>
              </div>

              {/* Side-by-side diff */}
              <div className="flex font-mono text-xs">
                {/* Left */}
                <div className="flex-1 border-r border-slate-100 min-w-0">
                  <div className="bg-slate-50 px-4 py-1.5 text-xs text-slate-500 font-sans border-b border-slate-100 sticky top-10">
                    v{selectedLeft.version_number} · {selectedLeft.created_at?.slice(0, 10)}
                  </div>
                  {diff.map((d, i) => (
                    <div key={i} className={`flex items-start px-4 py-0.5 min-h-[22px] ${LINE_STYLE[d.left.type]}`}>
                      <span className="select-none text-slate-300 w-6 text-right mr-3 flex-shrink-0 text-[10px] pt-0.5">
                        {d.left.type !== 'unchanged' || d.left.text ? i + 1 : ''}
                      </span>
                      <span className={`whitespace-pre-wrap break-all ${LINE_TEXT_STYLE[d.left.type]}`}>
                        {d.left.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Right */}
                <div className="flex-1 min-w-0">
                  <div className="bg-slate-50 px-4 py-1.5 text-xs text-slate-500 font-sans border-b border-slate-100 sticky top-10">
                    v{selectedRight.version_number} · {selectedRight.created_at?.slice(0, 10)}
                  </div>
                  {diff.map((d, i) => (
                    <div key={i} className={`flex items-start px-4 py-0.5 min-h-[22px] ${LINE_STYLE[d.right.type]}`}>
                      <span className="select-none text-slate-300 w-6 text-right mr-3 flex-shrink-0 text-[10px] pt-0.5">
                        {d.right.type !== 'unchanged' || d.right.text ? i + 1 : ''}
                      </span>
                      <span className={`whitespace-pre-wrap break-all ${LINE_TEXT_STYLE[d.right.type]}`}>
                        {d.right.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="p-6 prose prose-slate max-w-3xl">
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 leading-relaxed">
                {rightContent || <span className="text-slate-300">{t('history.no_content')}</span>}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
