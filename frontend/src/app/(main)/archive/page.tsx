'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  Table, Tag, Button, Modal, Form, Input, Space,
  Tabs, Badge, Tooltip, message, Popconfirm, Timeline,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  InboxOutlined, RollbackOutlined, CheckOutlined,
  CloseOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  StarOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '@/lib/api'

// ── Types aligned to backend responses ─────────────────────────────

interface ArchivedItem {
  id: number
  name: string
  file_type: string
  archived_at: string | null
  uploader_name: string | null
  uploader_id: number
  category_id: number | null
  description: string | null
}

interface RestoreRequest {
  id: number
  knowledge_item_id: number
  knowledge_item_name: string | null
  submitted_by_id: number
  submitted_by_name: string | null
  submitted_at: string | null
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by_id: number | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_note: string | null
}

// ── Display configs ────────────────────────────────────────────────

const FILE_TYPE_LABEL: Record<string, string> = {
  document: '文档',
  image: '图片',
  archive: '压缩包',
  audio: '音频',
  video: '视频',
  other: '其他',
}

const APPROVAL_CONFIG: Record<string, { color: string; text: string }> = {
  pending:  { color: 'orange',  text: '待审批' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error',   text: '已拒绝' },
}

// ── Component ──────────────────────────────────────────────────────

export default function ArchivePage() {
  const [items, setItems] = useState<ArchivedItem[]>([])
  const [itemsTotal, setItemsTotal] = useState(0)
  const [itemsPage, setItemsPage] = useState(1)
  const [itemsLoading, setItemsLoading] = useState(false)

  const [requests, setRequests] = useState<RestoreRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)

  const [restoreModal, setRestoreModal] = useState<ArchivedItem | null>(null)
  const [detailItem, setDetailItem] = useState<ArchivedItem | null>(null)
  const [reviewModal, setReviewModal] = useState<RestoreRequest | null>(null)
  const [activeTab, setActiveTab] = useState('archive')

  const [form] = Form.useForm()
  const [reviewForm] = Form.useForm()

  // ── Data fetching ──────────────────────────────────────────────

  const fetchItems = useCallback(async (page = 1) => {
    setItemsLoading(true)
    try {
      const { data } = await api.get('/api/v1/archive/items', {
        params: { page, page_size: 20 },
      })
      setItems(data.items)
      setItemsTotal(data.total)
      setItemsPage(data.page)
    } catch {
      message.error('加载归档列表失败')
    } finally {
      setItemsLoading(false)
    }
  }, [])

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true)
    try {
      const { data } = await api.get('/api/v1/archive/restore-requests')
      setRequests(data)
    } catch {
      message.error('加载恢复申请失败')
    } finally {
      setRequestsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchItems() }, [fetchItems])
  useEffect(() => { void fetchRequests() }, [fetchRequests])

  // ── Handlers ───────────────────────────────────────────────────

  async function handleRestoreRequest(values: { reason: string }) {
    if (!restoreModal) return
    try {
      await api.post('/api/v1/archive/restore-requests', {
        knowledge_item_id: restoreModal.id,
        reason: values.reason,
      })
      message.success('恢复申请已提交，等待 KM Ops 审批')
      setRestoreModal(null)
      form.resetFields()
      void fetchItems()
      void fetchRequests()
    } catch {
      message.error('提交恢复申请失败')
    }
  }

  async function handleApproval(id: number, approved: boolean, comment?: string) {
    const action = approved ? 'approve' : 'reject'
    try {
      await api.post(`/api/v1/archive/restore-requests/${id}/${action}`, {
        note: comment ?? null,
      })
      message.success(approved ? '已批准恢复申请' : '已拒绝恢复申请')
      setReviewModal(null)
      reviewForm.resetFields()
      void fetchItems()
      void fetchRequests()
    } catch {
      message.error('操作失败')
    }
  }

  // ── Derived ────────────────────────────────────────────────────

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  // Find the latest restore request for an archived item.
  function findRequest(itemId: number): RestoreRequest | undefined {
    return requests.find((r) => r.knowledge_item_id === itemId)
  }

  // ── Columns ────────────────────────────────────────────────────

  const archiveColumns: ColumnsType<ArchivedItem> = [
    {
      title: '文件名',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <span className="text-slate-700 text-sm font-medium">{name}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'file_type',
      key: 'file_type',
      width: 90,
      render: (t: string) => <Tag className="text-xs">{FILE_TYPE_LABEL[t] ?? t}</Tag>,
    },
    {
      title: '归档时间',
      dataIndex: 'archived_at',
      key: 'archived_at',
      width: 120,
      render: (v: string | null) => (
        <span className="text-slate-400 text-xs">
          {v ? dayjs(v).format('YYYY-MM-DD') : '-'}
        </span>
      ),
    },
    {
      title: '上传者',
      dataIndex: 'uploader_name',
      key: 'uploader_name',
      width: 100,
      render: (v: string | null) => (
        <span className="text-slate-400 text-xs">{v ?? '-'}</span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, record) => {
        const req = findRequest(record.id)
        if (req && req.status === 'pending') {
          return <Tag color="orange" className="text-xs">待恢复审批</Tag>
        }
        return <Tag color="default" className="text-xs">已归档</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, record) => {
        const req = findRequest(record.id)
        const hasPending = req && req.status === 'pending'
        return (
          <Space size={4}>
            <Tooltip title="查看详情">
              <Button
                type="text" size="small"
                icon={<ClockCircleOutlined />}
                className="text-slate-400 hover:text-primary"
                onClick={() => setDetailItem(record)}
              />
            </Tooltip>
            {hasPending ? (
              <Tag color="orange" className="text-xs">审批中</Tag>
            ) : (
              <Tooltip title="申请恢复">
                <Button
                  type="text" size="small"
                  icon={<RollbackOutlined />}
                  className="text-slate-400 hover:text-primary"
                  onClick={() => setRestoreModal(record)}
                />
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  const requestColumns: ColumnsType<RestoreRequest> = [
    {
      title: '文件名',
      dataIndex: 'knowledge_item_name',
      key: 'knowledge_item_name',
      render: (v: string | null) => (
        <span className="text-slate-700 text-sm">{v ?? '-'}</span>
      ),
    },
    {
      title: '申请人',
      dataIndex: 'submitted_by_name',
      key: 'submitted_by_name',
      width: 90,
      render: (v: string | null) => (
        <span className="text-slate-500 text-xs">{v ?? '-'}</span>
      ),
    },
    {
      title: '申请时间',
      dataIndex: 'submitted_at',
      key: 'submitted_at',
      width: 110,
      render: (v: string | null) => (
        <span className="text-slate-400 text-xs">
          {v ? dayjs(v).format('YYYY-MM-DD') : '-'}
        </span>
      ),
    },
    {
      title: '申请原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string | null) => (
        <span className="text-slate-500 text-xs">{v ?? '-'}</span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => {
        const cfg = APPROVAL_CONFIG[s] ?? { color: 'default', text: s }
        return <Badge status={cfg.color as 'default'} text={<span className="text-xs">{cfg.text}</span>} />
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      align: 'center',
      render: (_, record) => (
        record.status === 'pending' ? (
          <Space size={4}>
            <Popconfirm
              title="确认批准"
              description="批准后文件将从归档状态恢复"
              onConfirm={() => handleApproval(record.id, true)}
              okText="批准"
              cancelText="取消"
              okButtonProps={{ type: 'primary' }}
            >
              <Button
                size="small" type="primary" ghost
                icon={<CheckOutlined />}
                className="text-xs"
              >
                批准
              </Button>
            </Popconfirm>
            <Button
              size="small" danger ghost
              icon={<CloseOutlined />}
              className="text-xs"
              onClick={() => setReviewModal(record)}
            >
              拒绝
            </Button>
          </Space>
        ) : (
          <span className="text-slate-400 text-xs">
            {record.reviewed_by_name ?? '-'} · {record.reviewed_at ? dayjs(record.reviewed_at).format('YYYY-MM-DD') : '-'}
          </span>
        )
      ),
    },
  ]

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <InboxOutlined className="text-slate-500 text-lg" />
            <h1 className="text-lg font-semibold text-slate-800">归档管理</h1>
          </div>
          <p className="text-xs text-slate-400">管理已归档内容，处理恢复申请</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-5">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'archive',
              label: (
                <span>
                  <InboxOutlined className="mr-1" />归档列表
                </span>
              ),
              children: (
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <Table
                    dataSource={items}
                    columns={archiveColumns}
                    rowKey="id"
                    size="small"
                    loading={itemsLoading}
                    pagination={{
                      current: itemsPage,
                      total: itemsTotal,
                      pageSize: 20,
                      showTotal: (t) => `共 ${t} 条`,
                      onChange: (p) => void fetchItems(p),
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'approval',
              label: (
                <span>
                  <ExclamationCircleOutlined className="mr-1" />
                  恢复审批
                  {pendingCount > 0 && (
                    <Badge count={pendingCount} size="small" className="ml-2" />
                  )}
                </span>
              ),
              children: (
                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <Table
                    dataSource={requests}
                    columns={requestColumns}
                    rowKey="id"
                    size="small"
                    loading={requestsLoading}
                    pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Restore request modal */}
      <Modal
        title={
          <span className="flex items-center gap-2">
            <RollbackOutlined className="text-primary" />
            申请恢复文件
          </span>
        }
        open={!!restoreModal}
        onCancel={() => { setRestoreModal(null); form.resetFields() }}
        footer={null}
      >
        {restoreModal && (
          <>
            <div className="mb-4 p-3 bg-slate-50 rounded-lg">
              <p className="text-sm font-medium text-slate-700">{restoreModal.name}</p>
              <p className="text-xs text-slate-400 mt-1">
                归档于 {restoreModal.archived_at ? dayjs(restoreModal.archived_at).format('YYYY-MM-DD') : '-'}
              </p>
            </div>
            <Form form={form} layout="vertical" onFinish={handleRestoreRequest}>
              <Form.Item
                name="reason"
                label="申请恢复原因"
                rules={[{ required: true, message: '请填写恢复原因' }]}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="请说明为什么需要恢复此文件..."
                  maxLength={200}
                  showCount
                />
              </Form.Item>
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setRestoreModal(null); form.resetFields() }}>
                  取消
                </Button>
                <Button type="primary" htmlType="submit">
                  提交申请
                </Button>
              </div>
            </Form>
          </>
        )}
      </Modal>

      {/* Rejection reason modal */}
      <Modal
        title="拒绝恢复申请"
        open={!!reviewModal}
        onCancel={() => { setReviewModal(null); reviewForm.resetFields() }}
        footer={null}
      >
        {reviewModal && (
          <Form
            form={reviewForm}
            layout="vertical"
            onFinish={(vals) => handleApproval(reviewModal.id, false, vals.comment)}
          >
            <div className="mb-4 p-3 bg-slate-50 rounded-lg">
              <p className="text-sm font-medium text-slate-700">{reviewModal.knowledge_item_name}</p>
              <p className="text-xs text-slate-400 mt-1">
                {reviewModal.submitted_by_name} 申请于{' '}
                {reviewModal.submitted_at ? dayjs(reviewModal.submitted_at).format('YYYY-MM-DD') : '-'}
              </p>
              <p className="text-xs text-slate-500 mt-1">原因：{reviewModal.reason}</p>
            </div>
            <Form.Item name="comment" label="拒绝说明（可选）">
              <Input.TextArea rows={2} placeholder="说明拒绝原因..." maxLength={100} showCount />
            </Form.Item>
            <div className="flex justify-end gap-2">
              <Button onClick={() => { setReviewModal(null); reviewForm.resetFields() }}>
                取消
              </Button>
              <Button danger htmlType="submit">
                确认拒绝
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      {/* Detail modal */}
      <Modal
        title="归档详情"
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={<Button onClick={() => setDetailItem(null)}>关闭</Button>}
      >
        {detailItem && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm font-semibold text-slate-800">{detailItem.name}</p>
              <p className="text-xs text-slate-400 mt-1">
                类型：{FILE_TYPE_LABEL[detailItem.file_type] ?? detailItem.file_type}
              </p>
            </div>
            <Timeline
              items={[
                {
                  dot: <StarOutlined className="text-primary" />,
                  children: (
                    <div>
                      <p className="text-sm font-medium text-slate-700">文件归档</p>
                      <p className="text-xs text-slate-400">
                        {detailItem.archived_at ? dayjs(detailItem.archived_at).format('YYYY-MM-DD') : '-'}{' '}
                        · {detailItem.uploader_name ?? '-'}
                      </p>
                    </div>
                  ),
                },
...(findRequest(detailItem.id) ? [{
                  dot: <RollbackOutlined className="text-orange-500" />,
                  children: (() => {
                    const req = findRequest(detailItem.id)!
                    return (
                      <div>
                        <p className="text-sm font-medium text-slate-700">恢复申请</p>
                        <p className="text-xs text-slate-400">
                          {req.submitted_at ? dayjs(req.submitted_at).format('YYYY-MM-DD') : '-'}{' '}
                          · {req.submitted_by_name ?? '-'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">原因：{req.reason}</p>
                        <Tag
                          color={APPROVAL_CONFIG[req.status]?.color ?? 'default'}
                          className="text-xs mt-1"
                        >
                          {APPROVAL_CONFIG[req.status]?.text ?? req.status}
                        </Tag>
                      </div>
                    )
                  })(),
                }] : []),
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
