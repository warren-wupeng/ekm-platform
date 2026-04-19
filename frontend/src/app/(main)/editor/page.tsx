'use client'
import { useState, useRef } from 'react'
import {
  Button, Input, Tag, Divider, Spin, Tooltip, message,
} from 'antd'
import {
  RobotOutlined, ThunderboltOutlined, EditOutlined,
  FileTextOutlined, SearchOutlined, SendOutlined,
  CopyOutlined, CheckOutlined, ArrowLeftOutlined,
  BulbOutlined, ReloadOutlined,
} from '@ant-design/icons'
import { useRouter } from 'next/navigation'

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

const ACTION_PROMPTS: Record<AIAction, string> = {
  summarize:   '一键生成摘要',
  continue:    'AI 续写',
  rewrite:     'AI 改写选中内容',
  recommend:   '相关内容推荐',
}

const INITIAL_DOC = `# AI 技术选型调研报告

## 背景

EKM 平台需要接入 LLM 能力，支持文档摘要、智能搜索和 AI 写作辅助。本文调研当前主流的 LLM 接入方案，给出选型建议。

## 方案对比

### 方案一：OpenAI API

优点：接入简单，模型能力强，维护成本低
缺点：数据出境风险，成本随用量线性增长，存在 API 可用性依赖

### 方案二：自建 vLLM

优点：数据不出境，延迟可控，成本边际递减
缺点：初期硬件投入高，需要专职 MLOps 维护

## 建议

`

function simulateAI(action: AIAction, context: string): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      switch (action) {
        case 'summarize':
          resolve(`**摘要**\n\n本文对比了 EKM 平台接入 LLM 的两种主要方案：OpenAI API 与自建 vLLM。OpenAI API 接入便捷但有数据出境风险；自建 vLLM 数据安全可控但初期成本高。建议采用混合策略，开发和非敏感场景用 API，生产关键路径自建。`)
          break
        case 'continue':
          resolve(`采用混合策略：**开发环境和非敏感数据场景使用 OpenAI API**，快速迭代；**生产环境的文档索引和内部搜索场景部署 Qwen-14B via vLLM**，确保数据不出境。

预计第一阶段（0-3 个月）以 API 为主，月均成本约 $2,000；第二阶段（3-6 个月）完成 vLLM 部署，边际成本降低 60%。`)
          break
        case 'rewrite':
          resolve(`经过改写：\n\n在综合考量数据安全、成本控制和技术复杂度后，**推荐采用分阶段混合策略**。初期（Q2 2026）优先接入 OpenAI API 以快速验证产品价值；中期（Q3 2026）完成核心场景的 vLLM 迁移，将数据主权和成本控制落地。此策略可将首年总体成本控制在预算范围内，同时不影响产品上线节奏。`)
          break
        case 'recommend':
          resolve('')
          break
      }
    }, 1200)
  })
}

export default function EditorPage() {
  const router = useRouter()
  const [doc, setDoc]           = useState(INITIAL_DOC)
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！我是 EKM AI 助手。选中文档中的内容，或使用下方快捷操作，我可以帮你生成摘要、续写内容、改写表达，以及从知识库中推荐相关资料。',
    },
  ])
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading]   = useState(false)
  const [showRefs, setShowRefs] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function getSelection() {
    const ta = textareaRef.current
    if (!ta) return ''
    return ta.value.substring(ta.selectionStart, ta.selectionEnd)
  }

  async function handleAction(action: AIAction) {
    const sel = getSelection()
    if ((action === 'rewrite') && !sel) {
      message.info('请先选中要改写的文字')
      return
    }
    if (action === 'recommend') {
      setShowRefs(true)
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 'u', role: 'user', content: '推荐相关知识库内容' },
        { id: Date.now() + 'a', role: 'assistant', content: '已找到 3 篇相关内容，展示在参考资料面板中。', action },
      ])
      return
    }
    const userMsg = sel
      ? `${ACTION_PROMPTS[action]}：\n\n> ${sel.substring(0, 100)}${sel.length > 100 ? '…' : ''}`
      : ACTION_PROMPTS[action]

    setMessages((prev) => [...prev, { id: Date.now() + 'u', role: 'user', content: userMsg }])
    setLoading(true)
    const result = await simulateAI(action, sel || doc)
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
      {
        id: Date.now() + 'a',
        role: 'assistant',
        content: `关于「${q}」：根据知识库内容，建议参考 *RAG 架构最佳实践* 和 *LLM Serving 选型对比* 两篇文档。如需我直接生成内容，请描述具体需求。`,
      },
    ])
  }

  function insertContent(content: string) {
    const ta = textareaRef.current
    if (ta) {
      const pos = ta.selectionEnd
      const newDoc = doc.substring(0, pos) + '\n\n' + content + '\n' + doc.substring(pos)
      setDoc(newDoc)
      message.success('内容已插入到光标位置')
    }
  }

  function copyContent(id: string, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3">
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => router.back()} className="text-slate-500" />
        <div>
          <h1 className="text-base font-semibold text-slate-800">AI 辅助写作</h1>
          <p className="text-xs text-slate-400">AI 技术选型调研报告.md</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="small" type="primary" icon={<CheckOutlined />}>
            保存
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <textarea
            ref={textareaRef}
            value={doc}
            onChange={(e) => setDoc(e.target.value)}
            className="flex-1 resize-none p-6 font-mono text-sm text-slate-700 bg-white focus:outline-none leading-relaxed"
            style={{ fontFamily: "'JetBrains Mono', monospace, 'SF Mono'" }}
            placeholder="开始编写…"
          />
        </div>

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
            <span className="text-sm font-medium text-slate-700">AI 助手</span>
          </div>

          {/* Quick actions */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs text-slate-400 mb-2">快捷操作</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { action: 'summarize' as AIAction, icon: <FileTextOutlined />, label: '生成摘要' },
                { action: 'continue'  as AIAction, icon: <ThunderboltOutlined />, label: 'AI 续写' },
                { action: 'rewrite'   as AIAction, icon: <EditOutlined />, label: '改写选中' },
                { action: 'recommend' as AIAction, icon: <SearchOutlined />, label: '相关推荐' },
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
                      <Tooltip title="复制">
                        <button
                          className="text-slate-400 hover:text-slate-600 text-[10px]"
                          onClick={() => copyContent(msg.id, msg.content)}
                        >
                          {copiedId === msg.id ? <CheckOutlined /> : <CopyOutlined />}
                        </button>
                      </Tooltip>
                      <Tooltip title="插入到文档">
                        <button
                          className="text-slate-400 hover:text-primary text-[10px]"
                          onClick={() => insertContent(msg.content)}
                        >
                          <BulbOutlined /> 插入
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
                <p className="text-xs text-slate-500 font-medium">相关知识库内容</p>
                <button className="text-slate-300 hover:text-slate-500 text-xs" onClick={() => setShowRefs(false)}>×</button>
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
                placeholder="向 AI 提问…"
                autoSize={{ minRows: 1, maxRows: 4 }}
                className="text-xs flex-1"
                // #90: switched off onPressEnter because it fires before
                // IME composition end on some browsers (Chinese input
                // methods confirm candidates with Enter). Using onKeyDown
                // + nativeEvent.isComposing skips the confirm Enter and
                // only sends on a "real" Enter press.
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
              />
              <Button
                type="primary" size="small"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!inputVal.trim() || loading}
                className="flex-shrink-0"
              />
            </div>
            <p className="text-[10px] text-slate-300 mt-1">Enter 发送 · Shift+Enter 换行</p>
          </div>
        </div>
      </div>
    </div>
  )
}
