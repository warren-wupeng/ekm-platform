'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Tag, Tooltip, message as antdMessage } from 'antd'
import {
  SendOutlined, ClearOutlined, RobotOutlined, UserOutlined,
  FileTextOutlined, LinkOutlined,
} from '@ant-design/icons'
import clsx from 'clsx'
import { nanoid } from 'nanoid'
import { streamChat, type ChatSource } from '@/lib/chatApi'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  /** Set while the assistant is still streaming tokens into this bubble. */
  streaming?: boolean
  error?: string
}

const SOURCE_PANEL_W = 320

export default function AssistantPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const abortRef                = useRef<AbortController | null>(null)
  const scrollRef               = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom whenever messages change (including streaming deltas)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  // Cancel any in-flight stream on unmount so the fetch doesn't leak.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // The sources panel shows the latest assistant message's sources — that's
  // what a user would reasonably expect ("where did *this* answer come from").
  const latestSources = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'assistant' && m.sources?.length) return m.sources
    }
    return []
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    const userMsg: Message = { id: nanoid(), role: 'user', content: text }
    const assistantId = nanoid()
    const placeholder: Message = {
      id: assistantId, role: 'assistant', content: '', streaming: true,
    }
    setMessages((prev) => [...prev, userMsg, placeholder])
    setInput('')
    setSending(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      for await (const evt of streamChat({ query: text, signal: ctrl.signal })) {
        if (evt.type === 'sources') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, sources: evt.sources } : m,
          ))
        } else if (evt.type === 'delta') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + evt.delta } : m,
          ))
        } else if (evt.type === 'done') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ))
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        // User cancelled — mark the bubble as stopped without shouting.
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, content: m.content || '（已取消）' }
            : m,
        ))
      } else {
        const msg = err instanceof Error ? err.message : '请求失败'
        antdMessage.error(msg)
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, error: msg, content: m.content || '抱歉，回答生成失败。' }
            : m,
        ))
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }, [input, sending])

  function handleClear() {
    abortRef.current?.abort()
    setMessages([])
  }

  function handleSourceClick(src: ChatSource) {
    // Jump to knowledge lib filtered on this document. No per-chunk anchor
    // yet — the library page will handle the `?doc=` query param in a
    // follow-up; today it just lands users on the list.
    router.push(`/knowledge?doc=${src.document_id}`)
  }

  return (
    <div className="h-[calc(100vh-0px)] flex bg-slate-50">
      {/* Left: conversation */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white"
              style={{ background: 'var(--ekm-primary)' }}
            >
              <RobotOutlined />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">AI 助手</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                基于你的知识库，用自然语言提问
              </p>
            </div>
          </div>
          <Tooltip title="清空对话">
            <Button
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={messages.length === 0}
              size="small"
            >
              清空
            </Button>
          </Tooltip>
        </div>

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-5"
        >
          {messages.length === 0 ? (
            <EmptyHint onPick={(q) => setInput(q)} />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>

        {/* Composer */}
        <div className="bg-white border-t border-slate-100 px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="向 AI 助手提问…（Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 6 }}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              disabled={sending}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sending}
              onClick={() => void handleSend()}
              disabled={!input.trim()}
            >
              发送
            </Button>
          </div>
        </div>
      </div>

      {/* Right: sources panel */}
      <aside
        className="border-l border-slate-100 bg-white overflow-y-auto"
        style={{ width: SOURCE_PANEL_W, flex: `0 0 ${SOURCE_PANEL_W}px` }}
      >
        <div className="px-4 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <LinkOutlined className="text-slate-400" />
            引用来源
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {latestSources.length > 0
              ? `${latestSources.length} 条相关片段`
              : 'AI 回答所参考的知识片段将显示在这里'}
          </p>
        </div>

        <div className="p-3 space-y-2">
          {latestSources.length === 0 ? (
            <div className="text-center text-slate-300 text-xs py-10">
              暂无引用
            </div>
          ) : (
            latestSources.map((src, i) => (
              <button
                key={`${src.document_id}-${src.chunk_index}-${i}`}
                onClick={() => handleSourceClick(src)}
                className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <FileTextOutlined className="text-slate-400" />
                    <span className="font-medium text-slate-700 truncate max-w-[180px]">
                      {src.filename ?? `文档 #${src.document_id}`}
                    </span>
                  </div>
                  <Tag color="blue" className="m-0 text-[10px]">
                    #{src.chunk_index}
                  </Tag>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">
                  {src.content}
                </p>
                <div className="mt-1.5 text-[10px] text-slate-300">
                  相关度 {(src.score * 100).toFixed(0)}%
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={clsx('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white',
        )}
        style={{
          background: isUser ? '#94a3b8' : 'var(--ekm-primary)',
        }}
      >
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>
      <div className={clsx('max-w-2xl', isUser && 'text-right')}>
        <div
          className={clsx(
            'inline-block px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap text-left',
            isUser
              ? 'bg-primary text-white rounded-tr-sm'
              : 'bg-white border border-slate-100 text-slate-700 rounded-tl-sm',
            message.error && 'border-red-200 bg-red-50',
          )}
        >
          {message.content}
          {message.streaming && <TypingDots />}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-1.5 text-xs text-slate-400">
            已引用 {message.sources.length} 条知识片段
          </div>
        )}
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
      <span className="ekm-typing-dot" />
      <span className="ekm-typing-dot" />
      <span className="ekm-typing-dot" />
    </span>
  )
}

function EmptyHint({ onPick }: { onPick: (q: string) => void }) {
  const EXAMPLES = [
    '帮我总结一下最近上传的产品文档',
    '我们公司的报销流程是怎样的？',
    '上周的销售数据同比有什么变化？',
  ]
  return (
    <div className="max-w-2xl mx-auto text-center pt-16">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl mx-auto mb-4"
        style={{ background: 'var(--ekm-primary)' }}
      >
        <RobotOutlined />
      </div>
      <h2 className="text-lg font-semibold text-slate-700">你好，我是 EKM AI 助手</h2>
      <p className="text-sm text-slate-400 mt-1 mb-6">
        我会基于你的企业知识库回答问题，并列出引用来源
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="px-3 py-2 text-xs text-slate-600 bg-white border border-slate-100 rounded-xl hover:border-primary hover:text-primary transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
