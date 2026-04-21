'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Button, Input, Tag, Spin, Tooltip, Badge,
} from 'antd'
import {
  RobotOutlined, ThunderboltOutlined, EditOutlined,
  FileTextOutlined, SearchOutlined, SendOutlined,
  CopyOutlined, CheckOutlined, ArrowLeftOutlined,
  WifiOutlined, DisconnectOutlined,
} from '@ant-design/icons'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useAuth } from '@/hooks/useAuth'
import OnlineUsers from '@/components/editor/OnlineUsers'
import type { CollabUser, ConnectionStatus } from '@/components/editor/CollabEditor'

const CollabEditor = dynamic(
  () => import('@/components/editor/CollabEditor'),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center"><Spin /></div> },
)

type AIAction = 'summarize' | 'continue' | 'rewrite' | 'recommend'

interface AIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: AIAction
}

interface KnowledgeRef {
  id: string
  title: string
  excerpt: string
  relevance: number
}

const MOCK_REFS: KnowledgeRef[] = [
  { id: 'r1', title: 'RAG 架构最佳实践', excerpt: '在 RAG pipeline 中，chunk size 和 overlap 的选择直接影响召回率…', relevance: 0.94 },
  { id: 'r2', title: 'LLM Serving 选型对比', excerpt: 'vLLM 相比 TGI 在 A100 上的 throughput 高出 2.3x，适合高并发场景…', relevance: 0.87 },
  { id: 'r3', title: 'EKM 技术架构设计', excerpt: 'AI 层采用混合策略：开发环境使用 API，生产关键路径自建 vLLM…', relevance: 0.81 },
]

const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234'

function simulateAI(action: AIAction, _context: string): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      switch (action) {
        case 'summarize':
          resolve('**摘要**\n\n本文对比了 EKM 平台接入 LLM 的两种主要方案：OpenAI API 与自建 vLLM。OpenAI API 接入便捷但有数据出境风险；自建 vLLM 数据安全可控但初期成本高。建议采用混合策略，开发和非敏感场景用 API，生产关键路径自建。')
          break
        case 'continue':
          resolve('采用混合策略：**开发环境和非敏感数据场景使用 OpenAI API**，快速迭代；**生产环境的文档索引和内部搜索场景部署 Qwen-14B via vLLM**，确保数据不出境。\n\n预计第一阶段（0-3 个月）以 API 为主，月均成本约 $2,000；第二阶段（3-6 个月）完成 vLLM 部署，边际成本降低 60%。')
          break
        case 'rewrite':
          resolve('经过改写：\n\n在综合考量数据安全、成本控制和技术复杂度后，**推荐采用分阶段混合策略**。初期（Q2 2026）优先接入 OpenAI API 以快速验证产品价值；中期（Q3 2026）完成核心场景的 vLLM 迁移，将数据主权和成本控制落地。此策略可将首年总体成本控制在预算范围内，同时不影响产品上线节奏。')
          break
        case 'recommend':
          resolve('')
          break
      }
    }, 1200)
  })
}

export default function EditorPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const router = useRouter()
  const searchParams = useSearchParams()

  // P2-2 fix: get user + token from auth store (not hardcoded)
  const { user, token } = useAuth()
  const userName = user?.username ?? 'anonymous'

  const docId = searchParams.get('id') ?? 'draft'
  const roomName = `doc:${docId}`

  const ACTION_PROMPTS: Record<AIAction, string> = {
    summarize: t('editor.prompt_summarize'),
    continue: t('editor.prompt_continue'),
    rewrite: t('editor.prompt_rewrite'),
    recommend: t('editor.prompt_recommend'),
  }

  const [messages, setMessages] = useState<AIMessage[]>([
    { id: 'welcome', role: 'assistant', content: t('editor.welcome_message') },
  ])
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRefs, setShowRefs] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<CollabUser[]>([])
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting')

  // P1-3: Content persistence is handled server-side by Hocuspocus onStoreDocument.
  // Manual Save button kept as a fallback snapshot to REST API.
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // TODO: PUT /api/v1/items/{docId} — fallback save
      await new Promise((r) => setTimeout(r, 500)) // mock
      message.success(t('editor.save_success'))
    } catch {
      message.error(t('editor.save_failed'))
    } finally {
      setSaving(false)
    }
  }, [docId, message, t])

  async function handleAction(action: AIAction) {
    if (action === 'recommend') {
      setShowRefs(true)
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 'u', role: 'user', content: t('editor.recommend_user_msg') },
        { id: Date.now() + 'a', role: 'assistant', content: t('editor.recommend_assistant_msg'), action },
      ])
      return
    }

    const userMsg = ACTION_PROMPTS[action]
    setMessages((prev) => [...prev, { id: Date.now() + 'u', role: 'user', content: userMsg }])
    setLoading(true)
    const result = await simulateAI(action, '')
    setLoading(false)
    setMessages((prev) => [...prev, { id: Date.now() + 'a', role: 'assistant', content: result, action }])
  }

  async function handleSend() {
    if (!inputVal.trim()) return
    const q = inputVal.trim()
    setInputVal('')
    setMessages((prev) => [...prev, { id: Date.now() + 'u', role: 'user', content: q }])
    setLoading(true)
    await new Promise((r) => setTimeout(r, 1000))
    setLoading(false)
    setMessages((prev) => [
      ...prev,
      { id: Date.now() + 'a', role: 'assistant', content: t('editor.chat_reply_template', { q }) },
    ])
  }

  function copyContent(id: string, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const isConnected = connStatus === 'connected'

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3">
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => router.back()} className="text-slate-500" />
        <div>
          <h1 className="text-base font-semibold text-slate-800">{t('editor.page_title')}</h1>
          <p className="text-xs text-slate-400">
            {docId === 'draft' ? t('editor.doc_filename') : `doc:${docId}`}
          </p>
        </div>

        {/* Online users */}
        <div className="ml-4">
          <OnlineUsers users={onlineUsers} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* P2-4 fix: connection status bound to provider.status */}
          <Tooltip title={isConnected ? t('editor.collab_connected') : t('editor.collab_disconnected')}>
            <span className="flex items-center gap-1">
              <Badge status={isConnected ? 'success' : 'error'} />
              {isConnected
                ? <WifiOutlined className="text-green-500 text-xs" />
                : <DisconnectOutlined className="text-red-400 text-xs" />
              }
            </span>
          </Tooltip>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            loading={saving}
            onClick={handleSave}
          >
            {t('editor.save')}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor area — Tiptap with Yjs collaboration */}
        {token ? (
          <CollabEditor
            roomName={roomName}
            userName={userName}
            collabUrl={COLLAB_URL}
            token={token}
            onUsersChange={setOnlineUsers}
            onConnectionChange={setConnStatus}
            placeholder={t('editor.placeholder')}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400">
            <p className="text-sm font-medium">{t('editor.login_required')}</p>
            <p className="text-xs">{t('editor.login_to_edit')}</p>
          </div>
        )}

        {/* AI Sidebar */}
        <div
          className="flex-shrink-0 flex flex-col border-l border-slate-200 bg-white"
          style={{ width: 320 }}
        >
          {/* Sidebar header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--ekm-primary)' }}>
              <RobotOutlined className="text-white text-xs" />
            </div>
            <span className="text-sm font-medium text-slate-700">{t('editor.ai_assistant')}</span>
          </div>

          {/* Quick actions */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs text-slate-400 mb-2">{t('editor.quick_actions')}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { action: 'summarize' as AIAction, icon: <FileTextOutlined />, label: t('editor.action_summarize') },
                { action: 'continue' as AIAction, icon: <ThunderboltOutlined />, label: t('editor.action_continue') },
                { action: 'rewrite' as AIAction, icon: <EditOutlined />, label: t('editor.action_rewrite') },
                { action: 'recommend' as AIAction, icon: <SearchOutlined />, label: t('editor.action_recommend') },
              ].map(({ action, icon, label }) => (
                <Button
                  key={action}
                  size="small"
                  icon={icon}
                  className="text-xs text-slate-600 border-slate-200 hover:border-primary hover:text-primary"
                  onClick={() => handleAction(action)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                {msg.role === 'assistant' && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mr-2 mt-0.5" style={{ background: 'var(--ekm-primary)' }}>
                    <RobotOutlined className="text-white text-[10px]" />
                  </div>
                )}
                <div className={`max-w-[85%] group ${msg.role === 'user' ? '' : ''}`}>
                  <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-tr-sm'
                      : 'bg-slate-100 text-slate-700 rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                  {msg.role === 'assistant' && msg.content && msg.action !== 'recommend' && (
                    <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip title={t('editor.copy')}>
                        <button
                          className="text-slate-400 hover:text-slate-600 text-[10px]"
                          onClick={() => copyContent(msg.id, msg.content)}
                        >
                          {copiedId === msg.id ? <CheckOutlined /> : <CopyOutlined />}
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mr-2" style={{ background: 'var(--ekm-primary)' }}>
                  <RobotOutlined className="text-white text-[10px]" />
                </div>
                <div className="bg-slate-100 rounded-xl rounded-tl-sm px-3 py-2">
                  <Spin size="small" />
                </div>
              </div>
            )}
          </div>

          {/* Knowledge refs panel */}
          {showRefs && (
            <div className="border-t border-slate-100 px-4 py-3 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-500 font-medium">{t('editor.related_knowledge')}</p>
                <button className="text-slate-300 hover:text-slate-500 text-xs" onClick={() => setShowRefs(false)}>x</button>
              </div>
              {MOCK_REFS.map((ref) => (
                <div key={ref.id} className="mb-2 p-2 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-medium text-slate-700 leading-tight">{ref.title}</p>
                    <Tag color="geekblue" className="text-[10px] m-0 flex-shrink-0">
                      {Math.round(ref.relevance * 100)}%
                    </Tag>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 leading-tight line-clamp-2">{ref.excerpt}</p>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-slate-100 px-3 py-3">
            <div className="flex items-end gap-2">
              <Input.TextArea
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder={t('editor.input_placeholder')}
                autoSize={{ minRows: 1, maxRows: 4 }}
                className="text-xs flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
              />
              <Button
                type="primary" size="small"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!inputVal.trim() || loading}
                className="flex-shrink-0"
              />
            </div>
            <p className="text-[10px] text-slate-300 mt-1">{t('editor.send_hint')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
