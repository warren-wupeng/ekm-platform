'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { App, Button, Drawer, Input, Tag, Tooltip } from 'antd'
import {
  SendOutlined, ClearOutlined, RobotOutlined, UserOutlined,
  FileTextOutlined, LinkOutlined, LoadingOutlined,
} from '@ant-design/icons'
import clsx from 'clsx'
import { nanoid } from 'nanoid'
import { streamChat, type ChatSource } from '@/lib/chatApi'
import { useTranslation } from 'react-i18next'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  /** Names of tools currently being called (cleared on first delta). */
  activeTools?: string[]
  /** Set while the assistant is still streaming tokens into this bubble. */
  streaming?: boolean
  error?: string
}

const SOURCE_PANEL_W = 320

export default function AssistantPage() {
  const { message: antdMessage } = App.useApp()
  const { t } = useTranslation()
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false)
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
        if (evt.type === 'tool_call') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId
              ? { ...m, activeTools: [...(m.activeTools ?? []), evt.tool] }
              : m,
          ))
        } else if (evt.type === 'sources') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, sources: evt.sources } : m,
          ))
        } else if (evt.type === 'delta') {
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + evt.delta, activeTools: [] }
              : m,
          ))
        } else if (evt.type === 'error') {
          antdMessage.error(evt.message || t('assistant.error_message'))
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId
              ? { ...m, streaming: false, error: evt.message, content: m.content || t('assistant.error_message') }
              : m,
          ))
          break
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
            ? { ...m, streaming: false, content: m.content || t('assistant.cancelled') }
            : m,
        ))
      } else {
        const msg = err instanceof Error ? err.message : t('assistant.error_message')
        antdMessage.error(msg)
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, error: msg, content: m.content || t('assistant.error_message') }
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
    <div className="h-full flex bg-slate-50">
      {/* Left: conversation */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0"
              style={{ background: 'var(--ekm-primary)' }}
            >
              <RobotOutlined />
            </div>
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-semibold text-slate-800 leading-tight">{t('assistant.page_title')}</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
                {t('assistant.empty_tip')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile: sources toggle button */}
            <Tooltip title={t('assistant.sources_title')}>
              <Button
                icon={<LinkOutlined />}
                onClick={() => setMobileSourcesOpen(true)}
                size="small"
                aria-label={t('assistant.sources_title')}
                className="md:hidden"
                {...(latestSources.length > 0 ? { type: 'primary' } : {})}
              >
                {latestSources.length > 0 ? latestSources.length : undefined}
              </Button>
            </Tooltip>
            <Tooltip title={t('assistant.clear_button')}>
              <Button
                icon={<ClearOutlined />}
                onClick={handleClear}
                disabled={messages.length === 0}
                size="small"
                aria-label={t('assistant.clear_button')}
              >
                <span className="hidden sm:inline">{t('assistant.clear_button')}</span>
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4 md:py-6 space-y-5"
        >
          {messages.length === 0 ? (
            <EmptyHint onPick={(q) => setInput(q)} />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>

        {/* Composer */}
        <div className="bg-white border-t border-slate-100 px-4 md:px-6 py-3 md:py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('assistant.input_placeholder')}
              autoSize={{ minRows: 1, maxRows: 6 }}
              // #90: onPressEnter fires before IME composition end in
              // some browsers, swallowing the candidate-select Enter of
              // Chinese input methods. Using onKeyDown + isComposing
              // guard lets IME users confirm candidates without sending.
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter'
                  && !e.shiftKey
                  && !e.nativeEvent.isComposing
                ) {
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
              aria-label={t('assistant.send_button')}
            >
              <span className="hidden sm:inline">{t('assistant.send_button')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Right: sources panel — hidden on mobile, shown as drawer */}
      <aside
        className="hidden md:flex md:flex-col border-l border-slate-100 bg-white overflow-y-auto"
        style={{ width: SOURCE_PANEL_W, flex: `0 0 ${SOURCE_PANEL_W}px` }}
      >
        <SourcesPanel
          latestSources={latestSources}
          onSourceClick={handleSourceClick}
        />
      </aside>

      {/* Mobile: sources drawer */}
      <Drawer
        open={mobileSourcesOpen}
        onClose={() => setMobileSourcesOpen(false)}
        placement="bottom"
        styles={{ body: { padding: 0 }, wrapper: { height: '70%' } }}
        title={
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <LinkOutlined className="text-slate-400" />
            {t('assistant.sources_title')}
          </span>
        }
        rootClassName="md:hidden"
      >
        <SourcesPanel
          latestSources={latestSources}
          onSourceClick={(src) => { handleSourceClick(src); setMobileSourcesOpen(false) }}
          hideHeader
        />
      </Drawer>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function MessageBubble({ message }: { message: Message }) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'

  const toolLabel = (tool: string) => {
    const key = `assistant.tool_call_${tool}` as const
    const translated = t(key)
    // If no specific key, fall back to the generic label.
    return translated === key ? t('assistant.tool_call_default') : translated
  }

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
          {/* Tool call progress indicators */}
          {!message.content && message.activeTools && message.activeTools.length > 0 && (
            <div className="flex flex-col gap-1 mb-1">
              {[...new Set(message.activeTools)].map((tool) => (
                <div key={tool} className="flex items-center gap-1.5 text-xs text-slate-400">
                  <LoadingOutlined className="text-primary" spin />
                  <span>{toolLabel(tool)}</span>
                </div>
              ))}
            </div>
          )}
          {message.content}
          {message.streaming && !message.activeTools?.length && <TypingDots />}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-1.5 text-xs text-slate-400">
            {t('assistant.cited_count', { count: message.sources.length })}
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
  const { t } = useTranslation()
  const EXAMPLES = [
    t('assistant.example_1'),
    t('assistant.example_2'),
    t('assistant.example_3'),
  ]
  return (
    <div className="max-w-2xl mx-auto text-center pt-10 md:pt-16 px-4">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl mx-auto mb-4"
        style={{ background: 'var(--ekm-primary)' }}
      >
        <RobotOutlined />
      </div>
      <h2 className="text-lg font-semibold text-slate-700">{t('assistant.greeting')}</h2>
      <p className="text-sm text-slate-400 mt-1 mb-6">
        {t('assistant.greeting_subtitle')}
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

/* -------------------------------------------------------------------------- */

function SourcesPanel({
  latestSources,
  onSourceClick,
  hideHeader,
}: {
  latestSources: ChatSource[]
  onSourceClick: (src: ChatSource) => void
  hideHeader?: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      {!hideHeader && (
        <div className="px-4 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <LinkOutlined className="text-slate-400" />
            {t('assistant.sources_title')}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {latestSources.length > 0
              ? t('assistant.sources_count', { count: latestSources.length })
              : t('assistant.sources_empty_hint')}
          </p>
        </div>
      )}
      <div className="p-3 space-y-2">
        {latestSources.length === 0 ? (
          <div className="text-center text-slate-300 text-xs py-10">
            {t('assistant.no_sources')}
          </div>
        ) : (
          latestSources.map((src, i) => (
            <button
              key={`${src.document_id}-${src.chunk_index}-${i}`}
              onClick={() => onSourceClick(src)}
              className="w-full text-left p-3 rounded-xl border border-slate-100 hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <FileTextOutlined className="text-slate-400" />
                  <span className="font-medium text-slate-700 truncate max-w-[180px]">
                    {src.filename ?? t('assistant.doc_fallback', { id: src.document_id })}
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
                {t('assistant.relevance', { score: (src.score * 100).toFixed(0) })}
              </div>
            </button>
          ))
        )}
      </div>
    </>
  )
}
