'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { App, Button, Input, Select, Tag, Progress, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import {
  BoldOutlined, ItalicOutlined, CodeOutlined, OrderedListOutlined,
  UnorderedListOutlined, LinkOutlined, PaperClipOutlined, EyeOutlined,
  EditOutlined, SaveOutlined, SendOutlined, ArrowLeftOutlined,
  PictureOutlined, DeleteOutlined,
} from '@ant-design/icons'
import api from '@/lib/api'

// ── Minimal markdown → HTML renderer ─────────────────────────────────────────

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // fenced code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="bg-slate-900 text-green-300 rounded-xl p-4 text-xs overflow-x-auto my-3"><code>${code.trim()}</code></pre>`)
    // headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-800 mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="text-lg font-bold text-slate-800 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="text-xl font-bold text-slate-800 mt-6 mb-2">$1</h1>')
    // bold / italic / inline code
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code class="bg-slate-100 text-pink-600 px-1 rounded text-xs">$1</code>')
    // links
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-primary underline">$1</a>')
    // blockquote
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-slate-200 pl-3 text-slate-500 italic my-2">$1</blockquote>')
    // unordered list
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc text-slate-600">$1</li>')
    // ordered list
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-600">$1</li>')
    // horizontal rule
    .replace(/^---$/gm, '<hr class="border-slate-200 my-4">')
    // paragraphs
    .replace(/\n\n/g, '</p><p class="text-sm text-slate-700 leading-relaxed mb-2">')
    .replace(/\n/g, '<br>')
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Attachment {
  id: string
  name: string
  size: number
  progress: number  // 0-100
  done: boolean
}

const DRAFT_KEY = 'ekm_post_draft'

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewPostPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [title, setTitle]             = useState('')
  const [content, setContent]         = useState('')
  const [tags, setTags]               = useState<string[]>([])
  const [preview, setPreview]         = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [draftSaved, setDraftSaved]   = useState(false)
  const [publishing, setPublishing]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY)
      if (saved) {
        const { title: t, content: c, tags: tg } = JSON.parse(saved)
        if (t) setTitle(t)
        if (c) setContent(c)
        if (tg) setTags(tg)
      }
    } catch {}
  }, [])

  // Auto-save draft every 3 seconds when content changes
  useEffect(() => {
    if (!title && !content) return
    const id = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, tags }))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    }, 3000)
    return () => clearTimeout(id)
  }, [title, content, tags])

  // ── Toolbar helpers ───────────────────────────────────────────────────────

  const wrap = useCallback((before: string, after: string = before) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value } = ta
    const selected = value.slice(s, e) || 'text'
    const next = value.slice(0, s) + before + selected + after + value.slice(e)
    setContent(next)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(s + before.length, s + before.length + selected.length)
    }, 0)
  }, [])

  const insertLine = useCallback((prefix: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const { selectionStart: s, value } = ta
    const lineStart = value.lastIndexOf('\n', s - 1) + 1
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
    setContent(next)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + prefix.length, s + prefix.length) }, 0)
  }, [])

  const TOOLBAR = [
    { icon: <BoldOutlined />,           tip: t('community.new.toolbar_bold'),    action: () => wrap('**') },
    { icon: <ItalicOutlined />,         tip: t('community.new.toolbar_italic'),  action: () => wrap('*') },
    { icon: <CodeOutlined />,           tip: t('community.new.toolbar_code'),    action: () => wrap('`') },
    { icon: <OrderedListOutlined />,    tip: t('community.new.toolbar_ol'),      action: () => insertLine('1. ') },
    { icon: <UnorderedListOutlined />,  tip: t('community.new.toolbar_ul'),      action: () => insertLine('- ') },
    { icon: <LinkOutlined />,           tip: t('community.new.toolbar_link'),    action: () => wrap('[', '](url)') },
    { icon: <PictureOutlined />,        tip: t('community.new.toolbar_image'),   action: () => wrap('![alt](', ')') },
  ]

  // ── Attachment upload (mock) ──────────────────────────────────────────────

  function handleFileSelect(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach((file) => {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const att: Attachment = { id, name: file.name, size: file.size, progress: 0, done: false }
      setAttachments((prev) => [...prev, att])

      // Simulate upload progress
      let p = 0
      const iv = setInterval(() => {
        p += Math.random() * 25
        if (p >= 100) {
          clearInterval(iv)
          setAttachments((prev) => prev.map((a) => a.id === id ? { ...a, progress: 100, done: true } : a))
        } else {
          setAttachments((prev) => prev.map((a) => a.id === id ? { ...a, progress: Math.min(p, 99) } : a))
        }
      }, 200)
    })
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  async function handlePublish() {
    if (!title.trim()) { message.warning(t('community.new.title_required')); return }
    if (!content.trim()) { message.warning(t('community.new.content_required')); return }
    setPublishing(true)
    try {
      await api.post('/api/v1/posts', { title: title.trim(), body: content.trim() })
      localStorage.removeItem(DRAFT_KEY)
      message.success(t('community.new.published'))
      router.push('/community')
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setPublishing(false)
    }
  }

  const wordCount = content.length
  const canPublish = title.trim() && content.trim() && !publishing

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Button
            type="text" size="small" icon={<ArrowLeftOutlined />}
            onClick={() => router.push('/community')}
            className="text-slate-500"
          >
            {t('community.new.back')}
          </Button>
          <span className="text-sm font-semibold text-slate-800">{t('community.new.page_title')}</span>
          {draftSaved && <span className="text-xs text-green-500">{t('community.new.draft_saved')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small" icon={<SaveOutlined />}
            onClick={() => {
              localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, content, tags }))
              message.success(t('community.new.draft_saved'))
            }}
          >
            {t('community.new.save_draft')}
          </Button>
          <Button
            type="primary" size="small" icon={<SendOutlined />}
            disabled={!canPublish}
            loading={publishing}
            onClick={handlePublish}
          >
            {t('community.new.publish')}
          </Button>
        </div>
      </div>

      <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Title */}
        <Input
          placeholder={t('community.new.title_placeholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          showCount
          className="text-base font-medium"
          style={{ fontSize: 16 }}
        />

        {/* Tags */}
        <Select
          mode="tags"
          placeholder={t('community.new.tags_placeholder')}
          value={tags}
          onChange={setTags}
          tokenSeparators={[',']}
          style={{ width: '100%' }}
          size="small"
        />

        {/* Editor area */}
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-3 py-2 border-b border-slate-100 flex-wrap">
            {TOOLBAR.map((t, i) => (
              <Tooltip key={i} title={t.tip} placement="bottom">
                <button
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm"
                  onMouseDown={(e) => { e.preventDefault(); t.action() }}
                >
                  {t.icon}
                </button>
              </Tooltip>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] text-slate-400">{t('community.new.word_count', { count: wordCount })}</span>
              <Tooltip title={preview ? t('community.new.edit_btn') : t('community.new.preview_btn')}>
                <button
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ml-2 ${preview ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  onClick={() => setPreview((v) => !v)}
                >
                  {preview ? <EditOutlined /> : <EyeOutlined />}
                  {preview ? t('community.new.edit_btn') : t('community.new.preview_btn')}
                </button>
              </Tooltip>
            </div>
          </div>

          {/* Editor / Preview */}
          {preview ? (
            <div
              className="min-h-64 px-5 py-4 prose prose-sm max-w-none text-sm text-slate-700 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: `<p class="text-sm text-slate-700 leading-relaxed mb-2">${renderMarkdown(content || t('community.new.no_content'))}</p>` }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('community.new.md_placeholder')}
              className="w-full min-h-64 px-5 py-4 text-sm text-slate-700 font-mono leading-relaxed resize-none outline-none placeholder:text-slate-300 placeholder:font-sans"
              maxLength={10000}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'b') { e.preventDefault(); wrap('**') }
                if (e.ctrlKey && e.key === 'i') { e.preventDefault(); wrap('*') }
              }}
            />
          )}
        </div>

        {/* Attachments */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-700">{t('community.new.attachments')}</span>
            <Button
              size="small" icon={<PaperClipOutlined />}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('community.new.add_attachment')}
            </Button>
            <input
              ref={fileInputRef} type="file" multiple hidden
              onChange={(e) => handleFileSelect(e.target.files)}
            />
          </div>

          {attachments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">
              {t('community.new.drop_hint')}
            </p>
          ) : (
            <div className="space-y-2">
              {attachments.map((att) => (
                <div key={att.id} className="flex items-center gap-3">
                  <PaperClipOutlined className="text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-700 truncate">{att.name}</p>
                      <span className="text-[10px] text-slate-400 ml-2 flex-shrink-0">
                        {(att.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    {!att.done && (
                      <Progress percent={Math.floor(att.progress)} size="small" showInfo={false} className="mt-1" />
                    )}
                    {att.done && <p className="text-[10px] text-green-500 mt-0.5">{t('community.new.upload_complete')}</p>}
                  </div>
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="text-slate-300 hover:text-red-400 transition-colors"
                  >
                    <DeleteOutlined className="text-xs" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
