'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Button, Input, Select, Table, Tag, Tabs, Statistic, Card,
  Space, Tooltip, Popconfirm, Badge, Switch,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  CodeOutlined, KeyOutlined, SendOutlined, PlusOutlined,
  DeleteOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  BarChartOutlined, ReloadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'

// ─── Types ───────────────────────────────────────────────────────────────────
interface ApiKey {
  id: string
  name: string
  key: string
  created: string
  lastUsed: string
  callCount: number
  active: boolean
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

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_KEYS: ApiKey[] = [
  { id: 'k1', name: '开发测试', key: 'ekm_dev_4x8mK9pQrL2nT7vZ', created: '2026-04-01', lastUsed: '2026-04-18', callCount: 1243, active: true },
  { id: 'k2', name: '生产环境', key: 'ekm_prod_9aRmW3cDeFgH1jKL', created: '2026-03-15', lastUsed: '2026-04-17', callCount: 8720, active: true },
  { id: 'k3', name: '旧版（已停用）', key: 'ekm_old_Xb5YzQpNuVsT2wMo', created: '2026-01-10', lastUsed: '2026-03-01', callCount: 340, active: false },
]

const MOCK_LOGS: RequestLog[] = [
  { id: 'l1', method: 'POST', endpoint: '/api/v1/search', status: 200, latencyMs: 143, timestamp: '2026-04-18 14:32:10', requestBody: '{"query":"知识管理","limit":10}', responseBody: '{"results":[...],"total":34}' },
  { id: 'l2', method: 'POST', endpoint: '/api/v1/kg/query', status: 200, latencyMs: 287, timestamp: '2026-04-18 14:30:55', requestBody: '{"entity":"Kira Chen","depth":2}', responseBody: '{"nodes":[...],"edges":[...]}' },
  { id: 'l3', method: 'GET',  endpoint: '/api/v1/documents/k1', status: 200, latencyMs: 56, timestamp: '2026-04-18 14:28:01', requestBody: '', responseBody: '{"id":"k1","name":"EKM产品需求文档v2.pdf",...}' },
  { id: 'l4', method: 'POST', endpoint: '/api/v1/ai/summarize', status: 200, latencyMs: 1840, timestamp: '2026-04-18 14:25:33', requestBody: '{"docId":"k1"}', responseBody: '{"summary":"EKM 平台核心需求包含..."}' },
  { id: 'l5', method: 'POST', endpoint: '/api/v1/search', status: 429, latencyMs: 12, timestamp: '2026-04-18 14:20:00', requestBody: '{"query":"test"}', responseBody: '{"error":"Rate limit exceeded"}' },
  { id: 'l6', method: 'POST', endpoint: '/api/v1/kg/extract', status: 500, latencyMs: 3200, timestamp: '2026-04-18 14:15:44', requestBody: '{"docId":"k7"}', responseBody: '{"error":"Internal server error"}' },
]

const ENDPOINTS: EndpointDef[] = [
  { method: 'POST', path: '/api/v1/search',       description: '全文搜索',          defaultBody: '{\n  "query": "知识管理",\n  "limit": 10,\n  "filters": {}\n}' },
  { method: 'POST', path: '/api/v1/kg/query',      description: 'KG 图查询',         defaultBody: '{\n  "entity": "EKM Platform",\n  "depth": 2\n}' },
  { method: 'POST', path: '/api/v1/kg/extract',    description: 'KG 实体抽取',       defaultBody: '{\n  "docId": "k1"\n}' },
  { method: 'POST', path: '/api/v1/ai/summarize',  description: 'AI 文档摘要',       defaultBody: '{\n  "docId": "k1"\n}' },
  { method: 'POST', path: '/api/v1/ai/recommend',  description: '相关内容推荐',      defaultBody: '{\n  "docId": "k1",\n  "limit": 5\n}' },
  { method: 'GET',  path: '/api/v1/documents/{id}','description': '获取文档详情',   defaultBody: '' },
  { method: 'GET',  path: '/api/v1/health',        description: 'API 健康检查',     defaultBody: '' },
]

const STATUS_COLOR: Record<number, string> = { 200: 'success', 201: 'success', 400: 'warning', 401: 'warning', 429: 'warning', 500: 'error', 503: 'error' }
function statusColor(code: number) { return STATUS_COLOR[code] ?? 'default' }

// ─── Component ────────────────────────────────────────────────────────────────
export default function DeveloperPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [apiKeys, setApiKeys]   = useState<ApiKey[]>(MOCK_KEYS)
  const [logs, setLogs]         = useState<RequestLog[]>(MOCK_LOGS)
  const [activeTab, setActiveTab] = useState('console')

  // Console state
  const [selectedEp, setSelectedEp]     = useState<EndpointDef>(ENDPOINTS[0])
  const [requestBody, setRequestBody]   = useState(ENDPOINTS[0].defaultBody)
  const [selectedKeyId, setSelectedKeyId] = useState(MOCK_KEYS[0].id)
  const [sending, setSending]           = useState(false)
  const [response, setResponse]         = useState('')
  const [responseStatus, setResponseStatus] = useState<number | null>(null)
  const [responseMs, setResponseMs]     = useState<number | null>(null)

  // API key UI
  const [newKeyName, setNewKeyName] = useState('')
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  function toggleReveal(id: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key)
    message.success(t('developer.key_copied'))
  }

  function createKey() {
    if (!newKeyName.trim()) { message.warning(t('developer.key_name_required')); return }
    const newKey: ApiKey = {
      id: nanoid(6), name: newKeyName.trim(),
      key: `ekm_${nanoid(18)}`, created: dayjs().format('YYYY-MM-DD'),
      lastUsed: '—', callCount: 0, active: true,
    }
    setApiKeys((prev) => [newKey, ...prev])
    setNewKeyName('')
    message.success(t('developer.key_created'))
  }

  function revokeKey(id: string) {
    setApiKeys((prev) => prev.map((k) => k.id === id ? { ...k, active: false } : k))
    message.success(t('developer.key_revoked'))
  }

  async function sendRequest() {
    const key = apiKeys.find((k) => k.id === selectedKeyId)
    if (!key?.active) { message.error(t('developer.key_invalid')); return }
    setSending(true)
    setResponse('')
    setResponseStatus(null)
    const t0 = Date.now()
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 1200))
    const ms = Date.now() - t0

    // Mock response
    const isError = Math.random() < 0.1
    const status  = isError ? 500 : 200
    const mockResp = isError
      ? JSON.stringify({ error: 'Internal server error', requestId: nanoid(8) }, null, 2)
      : JSON.stringify({
          success: true,
          data: selectedEp.path.includes('search')
            ? { results: [{ id: 'k1', title: '技术架构设计.docx', score: 0.92 }], total: 1 }
            : selectedEp.path.includes('kg')
            ? { nodes: [{ id: 'n1', label: 'EKM Platform', type: 'Project' }], edges: [] }
            : { summary: 'EKM 平台是一个企业级知识管理系统…' },
          latencyMs: ms,
          requestId: nanoid(8),
        }, null, 2)

    setResponse(mockResp)
    setResponseStatus(status)
    setResponseMs(ms)

    // Append to log
    const newLog: RequestLog = {
      id: nanoid(6), method: selectedEp.method, endpoint: selectedEp.path,
      status, latencyMs: ms, timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      requestBody: requestBody.trim(), responseBody: mockResp,
    }
    setLogs((prev) => [newLog, ...prev])
    setSending(false)
  }

  // Stats
  const totalCalls  = logs.length
  const successRate = Math.round(logs.filter((l) => l.status < 400).length / Math.max(totalCalls, 1) * 100)
  const avgLatency  = Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / Math.max(totalCalls, 1))
  const errorCount  = logs.filter((l) => l.status >= 400).length

  const keyColumns: ColumnsType<ApiKey> = [
    {
      title: t('developer.col_name'), dataIndex: 'name', key: 'name',
      render: (v: string, r) => (
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{v}</span>
          {!r.active && <Tag color="default" className="text-xs">{t('developer.revoked')}</Tag>}
        </span>
      ),
    },
    {
      title: t('developer.col_key'), key: 'key',
      render: (_, r) => (
        <span className="flex items-center gap-2 font-mono text-xs text-slate-500">
          {revealedKeys.has(r.id) ? r.key : r.key.replace(/(?<=.{12}).+(?=.{4})/, '••••••••')}
          <Tooltip title={revealedKeys.has(r.id) ? t('developer.hide_key') : t('developer.show_key')}>
            <button className="text-slate-400 hover:text-slate-600" onClick={() => toggleReveal(r.id)}>
              {revealedKeys.has(r.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            </button>
          </Tooltip>
          <Tooltip title={t('common.copy')}>
            <button className="text-slate-400 hover:text-primary" onClick={() => copyKey(r.key)}>
              <CopyOutlined />
            </button>
          </Tooltip>
        </span>
      ),
    },
    { title: t('developer.col_created'), dataIndex: 'created', key: 'created', width: 110, render: (v: string) => <span className="text-xs text-slate-400">{v}</span> },
    { title: t('developer.col_last_used'), dataIndex: 'lastUsed', key: 'lastUsed', width: 110, render: (v: string) => <span className="text-xs text-slate-400">{v}</span> },
    { title: t('developer.col_calls'), dataIndex: 'callCount', key: 'callCount', width: 90, align: 'center', render: (v: number) => <span className="text-xs text-slate-600 font-medium">{v.toLocaleString()}</span>, sorter: (a, b) => a.callCount - b.callCount },
    {
      title: t('developer.col_actions'), key: 'actions', width: 100, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          {r.active && (
            <Popconfirm title={t('developer.confirm_revoke_title')} description={t('developer.confirm_revoke_desc')}
              onConfirm={() => revokeKey(r.id)} okText={t('common.revoke')} cancelText={t('common.cancel')} okButtonProps={{ danger: true }}>
              <Button size="small" danger ghost icon={<DeleteOutlined />} className="text-xs">{t('common.revoke')}</Button>
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

                    {/* API Key selector */}
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">API Key</label>
                      <Select
                        value={selectedKeyId}
                        onChange={setSelectedKeyId}
                        style={{ width: '100%' }}
                        options={apiKeys.filter((k) => k.active).map((k) => ({ label: k.name, value: k.id }))}
                      />
                    </div>

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
                      <Button type="primary" icon={<PlusOutlined />} onClick={createKey}>
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 p-5">
                    <Table dataSource={apiKeys} columns={keyColumns} rowKey="id" size="small" pagination={false} />
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
                    <p className="text-sm font-semibold text-slate-700">{t('developer.recent_requests', { count: logs.length })}</p>
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => setLogs(MOCK_LOGS)}>{t('common.reset')}</Button>
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
                      { title: t('developer.stat_success_rate'), value: successRate, suffix: '%', color: '#16a34a' },
                      { title: t('developer.stat_avg_latency'), value: avgLatency,  suffix: 'ms', color: '#2563eb' },
                      { title: t('developer.stat_errors'), value: errorCount,  suffix: t('dashboard.unit_times'), color: '#dc2626' },
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
                      {ENDPOINTS.slice(0, 5).map((ep) => {
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
