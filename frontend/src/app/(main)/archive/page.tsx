'use client'
import { useState } from 'react'
import {
  Table, Tag, Button, Modal, Form, Input, Select, Space,
  Tabs, Badge, Tooltip, message, Popconfirm, Timeline,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  InboxOutlined, RollbackOutlined, CheckOutlined,
  CloseOutlined, ClockCircleOutlined, ExclamationCircleOutlined,
  StarOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

type ArchiveStatus = 'active' | 'archived' | 'pending_restore'
type ApprovalStatus = 'pending' | 'approved' | 'rejected'

interface ArchivedItem {
  id: string
  name: string
  type: string
  archivedAt: string
  archivedBy: string
  reason: string
  status: ArchiveStatus
  restoreRequest?: {
    requestedBy: string
    requestedAt: string
    reason: string
    approvalStatus: ApprovalStatus
    reviewedBy?: string
    reviewedAt?: string
    comment?: string
  }
}

interface ApprovalRequest {
  id: string
  docName: string
  requestedBy: string
  requestedAt: string
  reason: string
  status: ApprovalStatus
  reviewedBy?: string
  reviewedAt?: string
}

const MOCK_ARCHIVED: ArchivedItem[] = [
  {
    id: 'a1', name: '旧版产品路线图 2024.pdf', type: '文档',
    archivedAt: '2026-03-10', archivedBy: 'Warren Wu', reason: '版本已过期，由 v2 替代',
    status: 'active',
  },
  {
    id: 'a2', name: '竞品分析 Q3 2025.xlsx', type: '文档',
    archivedAt: '2026-03-15', archivedBy: 'Kira', reason: '季度报告已归档',
    status: 'pending_restore',
    restoreRequest: {
      requestedBy: 'Luca',
      requestedAt: '2026-04-17',
      reason: '需要查看历史数据对比',
      approvalStatus: 'pending',
    },
  },
  {
    id: 'a3', name: '技术方案 v1（废弃）.docx', type: '文档',
    archivedAt: '2026-02-20', archivedBy: 'Kira', reason: '方案已废弃，由新版本替代',
    status: 'active',
  },
  {
    id: 'a4', name: '2024 年度总结.pptx', type: '演示文稿',
    archivedAt: '2026-01-15', archivedBy: 'Warren Wu', reason: '年度归档',
    status: 'active',
  },
]

const MOCK_APPROVALS: ApprovalRequest[] = [
  {
    id: 'r1', docName: '竞品分析 Q3 2025.xlsx',
    requestedBy: 'Luca', requestedAt: '2026-04-17',
    reason: '需要查看历史数据对比', status: 'pending',
  },
  {
    id: 'r2', docName: '旧版 API 文档 v0.9.md',
    requestedBy: 'Raven', requestedAt: '2026-04-10',
    reason: '需要参考旧版接口定义', status: 'approved',
    reviewedBy: 'Warren Wu', reviewedAt: '2026-04-11',
  },
  {
    id: 'r3', docName: '试用期培训材料（2023）.pdf',
    requestedBy: 'Mira', requestedAt: '2026-04-05',
    reason: '更新培训材料时需参考', status: 'rejected',
    reviewedBy: 'Warren Wu', reviewedAt: '2026-04-06',
  },
]

const STATUS_CONFIG: Record<ArchiveStatus, { color: string; text: string }> = {
  active:          { color: 'default', text: '已归档' },
  archived:        { color: 'default', text: '已归档' },
  pending_restore: { color: 'orange',  text: '待恢复审批' },
}

const APPROVAL_CONFIG: Record<ApprovalStatus, { color: string; text: string }> = {
  pending:  { color: 'orange',  text: '待审批' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error',   text: '已拒绝' },
}

export default function ArchivePage() {
  const [items, setItems]       = useState<ArchivedItem[]>(MOCK_ARCHIVED)
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(MOCK_APPROVALS)
  const [restoreModal, setRestoreModal] = useState<ArchivedItem | null>(null)
  const [detailModal, setDetailModal]   = useState<ArchivedItem | null>(null)
  const [reviewModal, setReviewModal]   = useState<ApprovalRequest | null>(null)
  const [activeTab, setActiveTab] = useState('archive')
  const [form] = Form.useForm()
  const [reviewForm] = Form.useForm()

  function handleRestoreRequest(values: { reason: string }) {
    if (!restoreModal) return
    setItems((prev) =>
      prev.map((i) =>
        i.id === restoreModal.id
          ? {
              ...i,
              status: 'pending_restore' as ArchiveStatus,
              restoreRequest: {
                requestedBy: '我',
                requestedAt: dayjs().format('YYYY-MM-DD'),
                reason: values.reason,
                approvalStatus: 'pending',
              },
            }
          : i
      )
    )
    setApprovals((prev) => [
      {
        id: `r${Date.now()}`,
        docName: restoreModal.name,
        requestedBy: '我',
        requestedAt: dayjs().format('YYYY-MM-DD'),
        reason: values.reason,
        status: 'pending',
      },
      ...prev,
    ])
    message.success('恢复申请已提交，等待 KM Ops 审批')
    setRestoreModal(null)
    form.resetFields()
  }

  function handleApproval(id: string, approved: boolean, comment?: string) {
    setApprovals((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              status: approved ? 'approved' : 'rejected',
              reviewedBy: 'Warren Wu',
              reviewedAt: dayjs().format('YYYY-MM-DD'),
              ...(comment ? { comment } : {}),
            }
          : r
      )
    )
    if (approved) {
      // Find and restore the item
      setItems((prev) =>
        prev.map((i) => {
          const req = approvals.find((r) => r.id === id)
          if (req && i.name === req.docName) {
            return { ...i, status: 'active' as ArchiveStatus }
          }
          return i
        })
      )
      message.success('已批准恢复申请')
    } else {
      message.info('已拒绝恢复申请')
    }
    setReviewModal(null)
    reviewForm.resetFields()
  }

  const pendingCount = approvals.filter((r) => r.status === 'pending').length

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
      dataIndex: 'type',
      key: 'type',
      width: 90,
      render: (t: string) => <Tag className="text-xs">{t}</Tag>,
    },
    {
      title: '归档时间',
      dataIndex: 'archivedAt',
      key: 'archivedAt',
      width: 110,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
      sorter: (a, b) => a.archivedAt.localeCompare(b.archivedAt),
      defaultSortOrder: 'descend',
    },
    {
      title: '归档人',
      dataIndex: 'archivedBy',
      key: 'archivedBy',
      width: 100,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_, record) => {
        const cfg = STATUS_CONFIG[record.status]
        return <Tag color={cfg.color} className="text-xs">{cfg.text}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button
              type="text" size="small"
              icon={<ClockCircleOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => setDetailModal(record)}
            />
          </Tooltip>
          {record.status === 'active' && (
            <Tooltip title="申请恢复">
              <Button
                type="text" size="small"
                icon={<RollbackOutlined />}
                className="text-slate-400 hover:text-primary"
                onClick={() => setRestoreModal(record)}
              />
            </Tooltip>
          )}
          {record.status === 'pending_restore' && (
            <Tag color="orange" className="text-xs">审批中</Tag>
          )}
        </Space>
      ),
    },
  ]

  const approvalColumns: ColumnsType<ApprovalRequest> = [
    {
      title: '文件名',
      dataIndex: 'docName',
      key: 'docName',
      render: (v: string) => <span className="text-slate-700 text-sm">{v}</span>,
    },
    {
      title: '申请人',
      dataIndex: 'requestedBy',
      key: 'requestedBy',
      width: 90,
      render: (v: string) => <span className="text-slate-500 text-xs">{v}</span>,
    },
    {
      title: '申请时间',
      dataIndex: 'requestedAt',
      key: 'requestedAt',
      width: 110,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: '申请原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string) => <span className="text-slate-500 text-xs">{v}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: ApprovalStatus) => {
        const cfg = APPROVAL_CONFIG[s]
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
            {record.reviewedBy} · {record.reviewedAt}
          </span>
        )
      ),
    },
  ]

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
                    pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
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
                    dataSource={approvals}
                    columns={approvalColumns}
                    rowKey="id"
                    size="small"
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
                归档于 {restoreModal.archivedAt} · 原因：{restoreModal.reason}
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
                  placeholder="请说明为什么需要恢复此文件…"
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
              <p className="text-sm font-medium text-slate-700">{reviewModal.docName}</p>
              <p className="text-xs text-slate-400 mt-1">
                {reviewModal.requestedBy} 申请于 {reviewModal.requestedAt}
              </p>
              <p className="text-xs text-slate-500 mt-1">原因：{reviewModal.reason}</p>
            </div>
            <Form.Item name="comment" label="拒绝说明（可选）">
              <Input.TextArea rows={2} placeholder="说明拒绝原因…" maxLength={100} showCount />
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
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>关闭</Button>}
      >
        {detailModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm font-semibold text-slate-800">{detailModal.name}</p>
              <p className="text-xs text-slate-400 mt-1">类型：{detailModal.type}</p>
            </div>
            <Timeline
              items={[
                {
                  dot: <StarOutlined className="text-primary" />,
                  children: (
                    <div>
                      <p className="text-sm font-medium text-slate-700">文件归档</p>
                      <p className="text-xs text-slate-400">
                        {detailModal.archivedAt} · {detailModal.archivedBy}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">原因：{detailModal.reason}</p>
                    </div>
                  ),
                },
                ...(detailModal.restoreRequest
                  ? [
                      {
                        dot: <RollbackOutlined className="text-orange-500" />,
                        children: (
                          <div>
                            <p className="text-sm font-medium text-slate-700">恢复申请</p>
                            <p className="text-xs text-slate-400">
                              {detailModal.restoreRequest.requestedAt} ·{' '}
                              {detailModal.restoreRequest.requestedBy}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              原因：{detailModal.restoreRequest.reason}
                            </p>
                            <Tag
                              color={APPROVAL_CONFIG[detailModal.restoreRequest.approvalStatus].color}
                              className="text-xs mt-1"
                            >
                              {APPROVAL_CONFIG[detailModal.restoreRequest.approvalStatus].text}
                            </Tag>
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
