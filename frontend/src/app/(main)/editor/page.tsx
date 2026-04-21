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
import api from '@/lib/api'
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
  id: string | number
  title: string
  excerpt: string
  relevance?: number
}

const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234'

// ── SSE stream helper ──────────────────────────────────────────────────────────

async function* readSSE(
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  token: string,
): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok || !res.body) return
  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      let event = 'message'
      let data  = ''
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      yield { event, data }
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const router = useRouter()
  const searchParams = useSearchParams()

  const { user, token } = useAuth()
  const userName = user?.username ?? 'anonymous'

  const docId   = searchParams.get('id') ?? 'draft'
  const roomName = `doc:${docId}`
  const isRealDoc = /^\d+$/.test(docId)

  const ACTION_PROMPTS: Record<AIAction, string> = {
    summarize: t('editor.prompt_summarize'),
    continue:  t('editor.prompt_continue'),
    rewrite:   t('editor.prompt_rewrite'),
    recommend: t('editor.prompt_recommend'),
  }

  const [messages, setMessages]   = useState<AIMessage[]>([
    { id: 'welcome', role: 'assistant', content: t('editor.welcome_message') },
  ])
  const [inputVal, setInputVal]   = useState('')
  const [loading, setLoading]     = useState(false)
  const [showRefs, setShowRefs]   = useState(false)
  const [refs, setRefs]           = useState<KnowledgeRef[]>([])
  const [copiedId, setCopiedId]   = useState<string | null>(null)
  const [onlineUsers, setOnlineUsers] = useState<CollabUser[]>([])
  const [connStatus, setConnStatus]   = useState<ConnectionStatus>('connecting')
  const [saving, setSaving]       = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const handleSave = useCallback(async () => {
    if (!isRealDoc) { message.success(t('editor.save_success')); return }
    setSaving(true)
    try {
      await api.post(`/api/v1/knowledge/${docId}/versions`, { change_summary: 'Manual save' })
      message.success(t('editor.save_success'))
    } catch {
      message.error(t('editor.save_failed'))
    } finally {
      setSaving(false)
    }
  }, [docId, isRealDoc, message, t])

  // Append assistant message token-by-token while streaming
  function startAssistantMsg(id: string) {
    setMessages((prev) => [...prev, { id, role: 'assistant', content: '' }])
  }
  function appendAssistantToken(id: string, delta: string) {
    setMessages((prev) =>
      prev.map((m) => m.id === id ? { ...m, content: m.content + delta } : m),
    )
  }

  async function callChatSSE(query: string, assistantId: string) {
    if (!token) return
    for await (const { event, data } of readSSE('/api/v1/chat/stream', 'POST', { query }, token)) {
      if (event === 'delta') appendAssistantToken(assistantId, data)
      if (event === 'done') break
      if (event === 'error') { appendAssistantToken(assistantId, `\n[${t('common.error_generic')}]`); break }
    }
  }

  async function callSummarizeSSE(itemId: string, assistantId: string) {
    if (!token) return
    for await (const { event, data } of readSSE(`/api/v1/knowledge/${itemId}/summarize`, 'POST', { length: 'medium' }, token)) {
      if (event === 'delta') appendAssistantToken(assistantId, data)
      if (event === 'done') break
      if (event === 'error') { appendAssistantToken(assistantId, `\n[${t('common.error_generic')}]`); break }
    }
  }

  async function handleAction(action: AIAction) {
    if (action === 'recommend') {
      setLoading(true)
      try {
        const query = isRealDoc ? docId : 'knowledge management'
        const res = await api.get('/api/v1/search', { params: { q: query, types: 'documents', limit: 5 } })
        const results: KnowledgeRef[] = (res.data?.results?.documents?.items ?? []).map((item: any) => ({
          id: item.id,
          title: item.name ?? item.title ?? `Doc #${item.id}`,
          excerpt: item.description ?? (item.matched_chunks?.[0]?.content ?? ''),
          relevance: item.score,
        }))
        setRefs(results)
        setShowRefs(true)
        setMessages((prev) => [
          ...prev,
          { id: `${Date.now()}u`, role: 'user', content: t('editor.recommend_user_msg') },
          { id: `${Date.now()}a`, role: 'assistant', content: t('editor.recommend_assistant_msg'), action },
        ])
      } catch {
        message.error(t('common.error_generic'))
      } finally {
        setLoading(false)
      }
      return
    }

    const userMsg    = ACTION_PROMPTS[action]
    const assistId   = `${Date.now()}a`
    setMessages((prev) => [...prev, { id: `${Date.now()}u`, role: 'user', content: userMsg }])
    startAssistantMsg(assistId)
    setLoading(true)
    try {
      if (action === 'summarize' && isRealDoc) {
        await callSummarizeSSE(docId, assistId)
      } else {
        const query =
          action === 'summarize' ? `请总结以下内容: ${userMsg}` :
          action === 'continue'  ? `请继续扩展: ${userMsg}` :
                                   `请改写以下内容: ${userMsg}`
        await callChatSSE(query, assistId)
      }
    } catch {
      appendAssistantToken(assistId, t('common.error_generic'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSend() {
    if (!inputVal.trim()) return
    const q       = inputVal.trim()
    const assistId = `${Date.now()}a`
    setInputVal('')
    setMessages((prev) => [...prev, { id: `${Date.now()}u`, role: 'user', content: q }])
    startAssistantMsg(assistId)
    setLoading(true)
    try {
      await callChatSSE(q, assistId)
    } catch {
      appendAssistantToken(assistId, t('common.error_generic'))
    } finally {
      setLoading(false)
    }
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

        <div className="ml-4">
          <OnlineUsers users={onlineUsers} />
        </div>

        <div className="ml-auto flex items-center gap-2">
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
        {/* Editor area */}
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
                { action: 'continue'  as AIAction, icon: <ThunderboltOutlined />, label: t('editor.action_continue') },
                { action: 'rewrite'   as AIAction, icon: <EditOutlined />, label: t('editor.action_rewrite') },
                { action: 'recommend' as AIAction, icon: <SearchOutlined />, label: t('editor.action_recommend') },
              ].map(({ action, icon, label }) => (
                <Button
                  key={action}
                  size="small"
                  icon={icon}
                  className="text-xs text-slate-600 border-slate-200 hover:border-primary hover:text-primary"
                  onClick={() => handleAction(action)}
                  disabled={loading}
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
                <div className={`max-w-[85%] group`}>
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
              {refs.length === 0 ? (
                <p className="text-xs text-slate-400">{t('common.no_results')}</p>
              ) : refs.map((ref) => (
                <div key={ref.id} className="mb-2 p-2 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-medium text-slate-700 leading-tight">{ref.title}</p>
                    {ref.relevance != null && (
                      <Tag color="geekblue" className="text-[10px] m-0 flex-shrink-0">
                        {Math.round(ref.relevance * 100)}%
                      </Tag>
                    )}
                  </div>
                  {ref.excerpt && (
                    <p className="text-[10px] text-slate-400 mt-1 leading-tight line-clamp-2">{ref.excerpt}</p>
                  )}
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
