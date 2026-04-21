'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import {
  App, Button, Input, Select, Table, Tag, Tabs, Statistic, Card,
  Space, Tooltip, Popconfirm, Badge, Alert,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CodeOutlined, KeyOutlined, SendOutlined, PlusOutlined,
  DeleteOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'
import api from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiToken {
  id: number
  name: string
  token_prefix: string
  scopes: string[]
  is_active: boolean
  created_at: string | null
}

interface RequestLog {
  id: string
  method: string
  endpoint: string
  status: number
  latencyMs: number
  timestamp: string
  requestBody: string
  responseBody: string
}

interface EndpointDef {
  method: string
  path: string
  description: string
  defaultBody: string
}

const ENDPOINTS: EndpointDef[] = [
  { method: 'GET',  path: '/api/v1/search',            description: '全文搜索',      defaultBody: '' },
  { method: 'GET',  path: '/api/v1/knowledge',         description: '知识库列表',    defaultBody: '' },
  { method: 'GET',  path: '/api/v1/categories',        description: '分类树',        defaultBody: '' },
  { method: 'POST', path: '/api/v1/chat/stream',       description: 'RAG 对话',     defaultBody: '{\n  "query": "知识管理",\n  "top_k": 5\n}' },
  { method: 'GET',  path: '/api/v1/health',            description: 'API 健康检查',  defaultBody: '' },
]

const STATUS_COLOR: Record<number, string> = { 200: 'success', 201: 'success', 400: 'warning', 401: 'warning', 429: 'warning', 500: 'error', 503: 'error' }
function statusColor(code: number) { return STATUS_COLOR[code] ?? 'default' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeveloperPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState('console')

  // Agent tokens from API
  const { data, isLoading: keysLoading, mutate: mutateKeys } = useSWR<{ tokens: ApiToken[] }>(
    '/api/v1/agent-tokens',
    (url: string) => api.get(url).then((r) => r.data),
  )
  const apiTokens: ApiToken[] = data?.tokens ?? []

  // Newly-created plaintext token — shown once only
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null)

  // Session-local request logs (cleared on refresh)
  const [logs, setLogs] = useState<RequestLog[]>([])

  // Console state
  const [selectedEp, setSelectedEp]         = useState<EndpointDef>(ENDPOINTS[0])
  const [requestBody, setRequestBody]       = useState(ENDPOINTS[0].defaultBody)
  const [sending, setSending]               = useState(false)
  const [response, setResponse]             = useState('')
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [responseMs, setResponseMs]         = useState<number | null>(null)

  // API key create UI
  const [newKeyName, setNewKeyName]   = useState('')
  const [creating, setCreating]       = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<number>>(new Set())

  function toggleReveal(id: number) {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text)
    message.success(t('developer.key_copied'))
  }

  async function createKey() {
    if (!newKeyName.trim()) { message.warning(t('developer.key_name_required')); return }
    setCreating(true)
    try {
      const res = await api.post('/api/v1/agent-tokens', { name: newKeyName.trim(), scopes: ['knowledge:read'] })
      setNewPlaintext(res.data.token ?? null)
      setNewKeyName('')
      mutateKeys()
      message.success(t('developer.key_created'))
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: number) {
    try {
      await api.delete(`/api/v1/agent-tokens/${id}`)
      mutateKeys()
      message.success(t('developer.key_revoked'))
    } catch {
      message.error(t('common.error_generic'))
    }
  }

  async function sendRequest() {
    setSending(true)
    setResponse('')
    setResponseStatus(null)
    const t0 = Date.now()
    try {
      let res
      if (selectedEp.method === 'GET') {
        res = await api.get(selectedEp.path)
      } else {
        const body = requestBody.trim() ? JSON.parse(requestBody) : undefined
        res = await api.post(selectedEp.path, body)
      }
      const ms     = Date.now() - t0
      const text   = JSON.stringify(res.data, null, 2)
      const status = res.status
      setResponse(text)
      setResponseStatus(status)
      setResponseMs(ms)
      appendLog(selectedEp.method, selectedEp.path, status, ms, requestBody, text)
    } catch (err: any) {
      const ms     = Date.now() - t0
      const status = err?.response?.status ?? 500
      const text   = JSON.stringify(err?.response?.data ?? { error: 'Request failed' }, null, 2)
      setResponse(text)
      setResponseStatus(status)
      setResponseMs(ms)
      appendLog(selectedEp.method, selectedEp.path, status, ms, requestBody, text)
    } finally {
      setSending(false)
    }
  }

  function appendLog(method: string, endpoint: string, status: number, ms: number, reqBody: string, respBody: string) {
    const entry: RequestLog = {
      id: nanoid(6), method, endpoint, status, latencyMs: ms,
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      requestBody: reqBody.trim(), responseBody: respBody,
    }
    setLogs((prev) => [entry, ...prev])
  }

  const totalCalls  = logs.length
  const successRate = Math.round(logs.filter((l) => l.status < 400).length / Math.max(totalCalls, 1) * 100)
  const avgLatency  = Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / Math.max(totalCalls, 1))
  const errorCount  = logs.filter((l) => l.status >= 400).length

  const keyColumns: ColumnsType<ApiToken> = [
    {
      title: t('developer.col_name'), dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{v}</span>
          {!r.is_active && <Tag color="default" className="text-xs">{t('developer.revoked')}</Tag>}
        </span>
      ),
    },
    {
      title: t('developer.col_key'), key: 'key',
      render: (_, r) => {
        const display = revealedIds.has(r.id) ? `${r.token_prefix}••••••••` : `${r.token_prefix.slice(0, 8)}••••`
        return (
          <span className="flex items-center gap-2 font-mono text-xs text-slate-500">
            {display}
            <Tooltip title={revealedIds.has(r.id) ? t('developer.key_hide') : t('developer.key_show')}>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => toggleReveal(r.id)}>
                {revealedIds.has(r.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              </button>
            </Tooltip>
            <Tooltip title={t('common.copy')}>
              <button className="text-slate-400 hover:text-primary" onClick={() => copyText(r.token_prefix)}>
                <CopyOutlined />
              </button>
            </Tooltip>
          </span>
        )
      },
    },
    {
      title: t('developer.col_created'), dataIndex: 'created_at', key: 'created_at', width: 110,
      render: (v: string | null) => <span className="text-xs text-slate-400">{v?.slice(0, 10) ?? '—'}</span>,
    },
    {
      title: 'Scopes', dataIndex: 'scopes', key: 'scopes',
      render: (scopes: string[]) => (
        <span className="flex gap-1 flex-wrap">
          {scopes.map((s) => <Tag key={s} className="text-[10px] m-0">{s}</Tag>)}
        </span>
      ),
    },
    {
      title: t('developer.col_actions'), key: 'actions', width: 100, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          {r.is_active && (
            <Popconfirm
              title={t('developer.revoke_confirm')}
              description={t('developer.revoke_desc')}
              onConfirm={() => revokeKey(r.id)}
              okText={t('common.revoke')}
              cancelText={t('common.cancel')}
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger ghost icon={<DeleteOutlined />} className="text-xs">
                {t('common.revoke')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  const logColumns: ColumnsType<RequestLog> = [
    { title: t('developer.col_time'), dataIndex: 'timestamp', key: 'timestamp', width: 155, render: (v: string) => <span className="text-xs text-slate-400 font-mono">{v}</span> },
    { title: t('developer.col_method'), dataIndex: 'method', key: 'method', width: 60, render: (v: string) => <Tag color={v === 'GET' ? 'blue' : 'green'} className="text-xs m-0">{v}</Tag> },
    { title: t('developer.col_endpoint'), dataIndex: 'endpoint', key: 'endpoint', render: (v: string) => <span className="text-xs font-mono text-slate-600">{v}</span> },
    { title: t('developer.col_status'), dataIndex: 'status', key: 'status', width: 65, render: (v: number) => <Badge status={statusColor(v) as 'success'} text={<span className="text-xs font-mono">{v}</span>} /> },
    { title: t('developer.col_latency'), dataIndex: 'latencyMs', key: 'latencyMs', width: 80, render: (v: number) => <span className={`text-xs font-mono ${v > 1000 ? 'text-orange-500' : 'text-slate-500'}`}>{v}ms</span>, sorter: (a, b) => a.latencyMs - b.latencyMs },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <CodeOutlined className="text-slate-500 text-lg" />
            <h1 className="text-lg font-semibold text-slate-800">{t('developer.page_title')}</h1>
          </div>
          <p className="text-xs text-slate-400">{t('developer.page_subtitle')}</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-5">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            // ── Console ──────────────────────────────────────────────────────
            {
              key: 'console',
              label: <span><SendOutlined className="mr-1" />{t('developer.tab_console')}</span>,
              children: (
                <div className="grid grid-cols-2 gap-5">
                  {/* Left: request builder */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
                    <p className="text-sm font-semibold text-slate-700">{t('developer.build_request')}</p>

                    {/* Endpoint selector */}
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">{t('developer.endpoint')}</label>
                      <Select
                        value={selectedEp.path}
                        onChange={(val) => {
                          const ep = ENDPOINTS.find((e) => e.path === val)!
                          setSelectedEp(ep)
                          setRequestBody(ep.defaultBody)
                        }}
                        style={{ width: '100%' }}
                        options={ENDPOINTS.map((ep) => ({
                          label: (
                            <span className="flex items-center gap-2">
                              <Tag color={ep.method === 'GET' ? 'blue' : 'green'} className="text-xs m-0">{ep.method}</Tag>
                              <span className="font-mono text-xs">{ep.path}</span>
                              <span className="text-slate-400 text-xs">{ep.description}</span>
                            </span>
                          ),
                          value: ep.path,
                        }))}
                      />
                    </div>

                    {/* Request body */}
                    {selectedEp.method !== 'GET' && (
                      <div>
                        <label className="text-xs text-slate-500 mb-1 block">Request Body (JSON)</label>
                        <textarea
                          value={requestBody}
                          onChange={(e) => setRequestBody(e.target.value)}
                          className="w-full font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:border-primary resize-none"
                          rows={8}
                        />
                      </div>
                    )}

                    <Button
                      type="primary" icon={<SendOutlined />}
                      loading={sending} onClick={sendRequest}
                      className="w-full h-10 text-sm font-medium"
                    >
                      {t('developer.send_request')}
                    </Button>
                  </div>

                  {/* Right: response */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">{t('developer.response')}</p>
                      {responseStatus !== null && (
                        <div className="flex items-center gap-3">
                          <Badge
                            status={statusColor(responseStatus) as 'success'}
                            text={<span className="text-xs font-mono">{responseStatus}</span>}
                          />
                          <span className="text-xs text-slate-400 font-mono">{responseMs}ms</span>
                          {responseStatus < 400
                            ? <CheckCircleOutlined className="text-green-500 text-sm" />
                            : <CloseCircleOutlined className="text-red-500 text-sm" />}
                        </div>
                      )}
                    </div>

                    {response ? (
                      <pre className="bg-slate-950 rounded-xl p-4 text-xs font-mono text-green-300 overflow-auto h-72 leading-relaxed">
                        {response}
                      </pre>
                    ) : (
                      <div className="h-72 flex items-center justify-center bg-slate-50 rounded-xl">
                        <p className="text-slate-400 text-sm">{t('developer.response_empty')}</p>
                      </div>
                    )}
                  </div>
                </div>
              ),
            },

            // ── API Keys ─────────────────────────────────────────────────────
            {
              key: 'keys',
              label: <span><KeyOutlined className="mr-1" />{t('developer.tab_keys')}</span>,
              children: (
                <div className="space-y-4">
                  {/* One-time plaintext reveal */}
                  {newPlaintext && (
                    <Alert
                      type="success"
                      showIcon
                      closable
                      onClose={() => setNewPlaintext(null)}
                      message={t('developer.key_created_once')}
                      description={
                        <div className="flex items-center gap-2 mt-1">
                          <code className="font-mono text-xs bg-white px-2 py-1 rounded border border-slate-200 flex-1 break-all">
                            {newPlaintext}
                          </code>
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(newPlaintext)}>
                            {t('common.copy')}
                          </Button>
                        </div>
                      }
                    />
                  )}

                  {/* Create new key */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <p className="text-sm font-semibold text-slate-700 mb-3">{t('developer.create_key_title')}</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder={t('developer.key_name_placeholder')}
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        style={{ maxWidth: 300 }}
                        onPressEnter={createKey}
                      />
                      <Button type="primary" icon={<PlusOutlined />} loading={creating} onClick={createKey}>
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <Table
                      dataSource={apiTokens}
                      columns={keyColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      loading={keysLoading}
                    />
                  </div>
                </div>
              ),
            },

            // ── Logs ─────────────────────────────────────────────────────────
            {
              key: 'logs',
              label: (
                <span>
                  <ClockCircleOutlined className="mr-1" />{t('developer.tab_logs')}
                  <Tag className="ml-1 text-xs">{logs.length}</Tag>
                </span>
              ),
              children: (
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-slate-700">
                      {t('developer.recent_requests', { count: logs.length })}
                    </p>
                    <Button size="small" onClick={() => setLogs([])}>{t('common.reset')}</Button>
                  </div>
                  <Table
                    dataSource={logs}
                    columns={logColumns}
                    rowKey="id"
                    size="small"
                    expandable={{
                      expandedRowRender: (record) => (
                        <div className="grid grid-cols-2 gap-4 py-2">
                          <div>
                            <p className="text-xs text-slate-500 mb-1 font-medium">Request</p>
                            <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-32">{record.requestBody || t('developer.no_body')}</pre>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1 font-medium">Response</p>
                            <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-32">{record.responseBody}</pre>
                          </div>
                        </div>
                      ),
                    }}
                    pagination={{ pageSize: 20, showTotal: (total) => t('developer.pagination_total', { total }) }}
                  />
                </div>
              ),
            },

            // ── Stats ────────────────────────────────────────────────────────
            {
              key: 'stats',
              label: <span><BarChartOutlined className="mr-1" />{t('developer.tab_stats')}</span>,
              children: (
                <div className="space-y-5">
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { title: t('developer.stat_total_calls'), value: totalCalls, suffix: t('dashboard.unit_times'), color: '#7c3aed' },
                      { title: t('developer.stat_success_rate'), value: successRate, suffix: '%',                       color: '#16a34a' },
                      { title: t('developer.stat_avg_latency'), value: avgLatency,  suffix: 'ms',                      color: '#2563eb' },
                      { title: t('developer.stat_errors'),      value: errorCount,  suffix: t('dashboard.unit_times'), color: '#dc2626' },
                    ].map((s) => (
                      <Card key={s.title} className="rounded-2xl border-slate-100">
                        <Statistic
                          title={<span className="text-xs text-slate-500">{s.title}</span>}
                          value={s.value}
                          suffix={<span className="text-xs text-slate-400">{s.suffix}</span>}
                          valueStyle={{ color: s.color, fontSize: 24 }}
                        />
                      </Card>
                    ))}
                  </div>

                  {/* Endpoint breakdown */}
                  <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <p className="text-sm font-semibold text-slate-700 mb-4">{t('developer.endpoint_distribution')}</p>
                    <div className="space-y-2">
                      {ENDPOINTS.map((ep) => {
                        const count = logs.filter((l) => l.endpoint === ep.path).length
                        const pct   = Math.round(count / Math.max(totalCalls, 1) * 100)
                        return (
                          <div key={ep.path} className="flex items-center gap-3">
                            <Tag color={ep.method === 'GET' ? 'blue' : 'green'} className="text-xs m-0 w-10 text-center">{ep.method}</Tag>
                            <span className="font-mono text-xs text-slate-600 w-48 truncate">{ep.path}</span>
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-slate-400 w-16 text-right">{t('developer.calls_count', { count, pct })}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}
