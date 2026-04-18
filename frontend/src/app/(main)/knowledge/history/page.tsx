'use client'
import { useState } from 'react'
import { Button, Tag, Tooltip, Popconfirm, message, Badge } from 'antd'
import {
  ClockCircleOutlined, RollbackOutlined, StarOutlined,
  StarFilled, ArrowLeftOutlined, SwapOutlined,
} from '@ant-design/icons'
import { useRouter } from 'next/navigation'

interface VersionRecord {
  id: string
  version: string
  savedAt: string
  savedBy: string
  summary: string
  starred: boolean
  content: string
}

const MOCK_VERSIONS: VersionRecord[] = [
  {
    id: 'v5', version: 'v5 (当前)', savedAt: '2026-04-17 14:30', savedBy: 'Kira',
    summary: '新增第 3 节 AI 架构对比',
    starred: false,
    content: `# 技术架构设计文档

## 1. 概述

本文档描述 EKM 平台的核心技术架构设计，涵盖前端、后端、AI 层和数据层。

## 2. 技术栈选型

- **前端**：Next.js 16 + React 19 + Ant Design 6
- **后端**：FastAPI + PostgreSQL + Redis
- **AI 层**：LLM serving via vLLM，RAG pipeline，Agent orchestration
- **数据层**：Delta Lake + Unity Catalog

## 3. AI 架构对比

| 方案 | 延迟 | 成本 | 可扩展性 |
|------|------|------|---------|
| 自建 vLLM | 低 | 高 | 好 |
| OpenAI API | 中 | 中 | 极好 |
| Bedrock | 中 | 中 | 好 |

选定方案：混合策略，开发用 API，生产关键路径自建。`,
  },
  {
    id: 'v4', version: 'v4', savedAt: '2026-04-16 10:15', savedBy: 'Warren Wu',
    summary: '修改数据层描述，补充 Delta Lake 说明',
    starred: true,
    content: `# 技术架构设计文档

## 1. 概述

本文档描述 EKM 平台的核心技术架构设计，涵盖前端、后端和数据层。

## 2. 技术栈选型

- **前端**：Next.js 16 + React 19 + Ant Design 6
- **后端**：FastAPI + PostgreSQL + Redis
- **AI 层**：LLM serving via vLLM，RAG pipeline
- **数据层**：Delta Lake + Unity Catalog`,
  },
  {
    id: 'v3', version: 'v3', savedAt: '2026-04-14 16:45', savedBy: 'Kira',
    summary: '初版后端架构章节完成',
    starred: false,
    content: `# 技术架构设计文档

## 1. 概述

本文档描述 EKM 平台的核心技术架构设计，涵盖前端和后端。

## 2. 技术栈选型

- **前端**：Next.js 16 + React 19 + Ant Design 6
- **后端**：FastAPI + PostgreSQL + Redis`,
  },
  {
    id: 'v2', version: 'v2', savedAt: '2026-04-12 09:00', savedBy: 'Kira',
    summary: '添加前端技术栈章节',
    starred: false,
    content: `# 技术架构设计文档

## 1. 概述

本文档描述 EKM 平台的核心技术架构设计。

## 2. 技术栈选型

- **前端**：Next.js 16 + React 19 + Ant Design 6`,
  },
  {
    id: 'v1', version: 'v1', savedAt: '2026-04-10 11:30', savedBy: 'Kira',
    summary: '初始版本',
    starred: true,
    content: `# 技术架构设计文档

## 1. 概述

本文档描述 EKM 平台的核心技术架构设计。`,
  },
]

// Compute line-level diff between two texts
function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  type DiffLine = { type: 'added' | 'removed' | 'unchanged'; text: string }
  const result: { left: DiffLine; right: DiffLine }[] = []

  // Simple LCS-based diff (greedy for display purposes)
  let oi = 0
  let ni = 0
  while (oi < oldLines.length || ni < newLines.length) {
    const ol = oldLines[oi]
    const nl = newLines[ni]
    if (oi >= oldLines.length) {
      result.push({ left: { type: 'unchanged', text: '' }, right: { type: 'added', text: nl } })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ left: { type: 'removed', text: ol }, right: { type: 'unchanged', text: '' } })
      oi++
    } else if (ol === nl) {
      result.push({ left: { type: 'unchanged', text: ol }, right: { type: 'unchanged', text: nl } })
      oi++; ni++
    } else {
      // Check if next new line matches current old (insertion) or vice versa
      const nextNewMatchesOld = newLines[ni + 1] === ol
      const nextOldMatchesNew = oldLines[oi + 1] === nl
      if (nextNewMatchesOld && !nextOldMatchesNew) {
        result.push({ left: { type: 'unchanged', text: '' }, right: { type: 'added', text: nl } })
        ni++
      } else if (nextOldMatchesNew && !nextNewMatchesOld) {
        result.push({ left: { type: 'removed', text: ol }, right: { type: 'unchanged', text: '' } })
        oi++
      } else {
        result.push({ left: { type: 'removed', text: ol }, right: { type: 'added', text: nl } })
        oi++; ni++
      }
    }
  }
  return result
}

const LINE_STYLE: Record<string, string> = {
  added:     'bg-green-50 border-l-2 border-green-400',
  removed:   'bg-red-50 border-l-2 border-red-400',
  unchanged: '',
}
const LINE_TEXT_STYLE: Record<string, string> = {
  added:   'text-green-700',
  removed: 'text-red-600',
  unchanged: 'text-slate-700',
}

export default function VersionHistoryPage() {
  const router = useRouter()
  const [versions, setVersions] = useState<VersionRecord[]>(MOCK_VERSIONS)
  const [selectedLeft, setSelectedLeft]   = useState<VersionRecord>(MOCK_VERSIONS[1])
  const [selectedRight, setSelectedRight] = useState<VersionRecord>(MOCK_VERSIONS[0])
  const [compareMode, setCompareMode]     = useState(true)

  const diff = compareMode ? computeDiff(selectedLeft.content, selectedRight.content) : []

  const addedCount   = diff.filter((d) => d.right.type === 'added').length
  const removedCount = diff.filter((d) => d.left.type === 'removed').length

  function toggleStar(id: string) {
    setVersions((prev) => prev.map((v) => v.id === id ? { ...v, starred: !v.starred } : v))
  }

  function handleRollback(ver: VersionRecord) {
    message.success(`已回滚到 ${ver.version}，当前版本已保存为新历史记录`)
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
          <h1 className="text-base font-semibold text-slate-800">版本历史</h1>
          <p className="text-xs text-slate-400">技术架构设计.docx</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="small"
            icon={<SwapOutlined />}
            type={compareMode ? 'primary' : 'default'}
            ghost={compareMode}
            onClick={() => setCompareMode((v) => !v)}
          >
            对比视图
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: version timeline */}
        <div
          className="flex-shrink-0 bg-white border-r border-slate-100 overflow-y-auto py-3"
          style={{ width: 260 }}
        >
          <p className="text-xs text-slate-400 px-4 mb-2 font-medium uppercase tracking-wide">版本时间线</p>
          {versions.map((ver) => {
            const isLeft  = selectedLeft.id  === ver.id
            const isRight = selectedRight.id === ver.id
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
                onClick={() => setSelectedRight(ver)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Tag
                      color={isRight ? 'purple' : isLeft ? 'default' : 'default'}
                      className="text-xs m-0 px-1.5"
                    >
                      {ver.version}
                    </Tag>
                    {ver.starred && <StarFilled className="text-yellow-400 text-xs" />}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip title={ver.starred ? '取消星标' : '标记重要版本'}>
                      <button
                        className="text-slate-300 hover:text-yellow-400 transition-colors"
                        onClick={(e) => { e.stopPropagation(); toggleStar(ver.id) }}
                      >
                        {ver.starred ? <StarFilled className="text-xs" /> : <StarOutlined className="text-xs" />}
                      </button>
                    </Tooltip>
                    {ver.id !== versions[0].id && (
                      <Tooltip title="设为对比基准">
                        <button
                          className={`text-xs px-1 rounded transition-colors ${
                            isLeft ? 'text-slate-600 bg-slate-200' : 'text-slate-300 hover:text-slate-500'
                          }`}
                          onClick={(e) => { e.stopPropagation(); setSelectedLeft(ver) }}
                        >
                          基
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-tight mb-1">{ver.summary}</p>
                <p className="text-xs text-slate-400">
                  <ClockCircleOutlined className="mr-1" />
                  {ver.savedAt} · {ver.savedBy}
                </p>
                {ver.id !== versions[0].id && (
                  <div className="mt-1.5">
                    <Popconfirm
                      title="确认回滚"
                      description={`回滚到 ${ver.version}？当前内容将保存为新历史版本。`}
                      onConfirm={() => handleRollback(ver)}
                      okText="回滚"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small" type="text"
                        icon={<RollbackOutlined />}
                        className="text-slate-400 hover:text-primary text-xs h-6 px-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        回滚
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
          {compareMode ? (
            <>
              {/* Diff stats bar */}
              <div className="sticky top-0 bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-4 z-10">
                <span className="text-xs text-slate-500">
                  对比：
                  <Tag className="mx-1 text-xs">{selectedLeft.version}</Tag>
                  →
                  <Tag color="purple" className="mx-1 text-xs">{selectedRight.version}</Tag>
                </span>
                <span className="text-xs text-green-600 font-medium">+{addedCount} 行</span>
                <span className="text-xs text-red-500 font-medium">-{removedCount} 行</span>
              </div>

              {/* Side-by-side diff */}
              <div className="flex font-mono text-xs">
                {/* Left (old) */}
                <div className="flex-1 border-r border-slate-100 min-w-0">
                  <div className="bg-slate-50 px-4 py-1.5 text-xs text-slate-500 font-sans border-b border-slate-100 sticky top-10">
                    {selectedLeft.version} · {selectedLeft.savedAt}
                  </div>
                  {diff.map((d, i) => (
                    <div
                      key={i}
                      className={`flex items-start px-4 py-0.5 min-h-[22px] ${LINE_STYLE[d.left.type]}`}
                    >
                      <span className="select-none text-slate-300 w-6 text-right mr-3 flex-shrink-0 text-[10px] pt-0.5">
                        {d.left.type !== 'unchanged' || d.left.text ? i + 1 : ''}
                      </span>
                      <span className={`whitespace-pre-wrap break-all ${LINE_TEXT_STYLE[d.left.type]}`}>
                        {d.left.text}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Right (new) */}
                <div className="flex-1 min-w-0">
                  <div className="bg-slate-50 px-4 py-1.5 text-xs text-slate-500 font-sans border-b border-slate-100 sticky top-10">
                    {selectedRight.version} · {selectedRight.savedAt}
                  </div>
                  {diff.map((d, i) => (
                    <div
                      key={i}
                      className={`flex items-start px-4 py-0.5 min-h-[22px] ${LINE_STYLE[d.right.type]}`}
                    >
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
                {selectedRight.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
