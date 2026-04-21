'use client'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Table, Tag, Tabs, Empty, Tooltip, Space, Popconfirm, Spin, Alert } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useTranslation } from 'react-i18next'
import {
  UploadOutlined, SearchOutlined, DownloadOutlined,
  DeleteOutlined, EyeOutlined, TagOutlined, FireOutlined,
  FilePdfOutlined, FileWordOutlined, FileExcelOutlined, FilePptOutlined,
  FileZipOutlined, FileImageOutlined, FileTextOutlined, FileOutlined,
  SoundOutlined, VideoCameraOutlined, HistoryOutlined,
} from '@ant-design/icons'
import UploadZone from '@/components/upload/UploadZone'
import { formatFileSize } from '@/lib/mockUpload'
import { useKnowledgeList } from '@/lib/useKnowledgeList'
import type { KnowledgeItem } from '@/types/upload'
import type { FileType } from '@/types/upload'

function getFileIcon(name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#dc2626' }} />
    case 'doc': case 'docx':
      return <FileWordOutlined style={{ color: '#2563eb' }} />
    case 'xls': case 'xlsx':
      return <FileExcelOutlined style={{ color: '#16a34a' }} />
    case 'ppt': case 'pptx':
      return <FilePptOutlined style={{ color: '#ea580c' }} />
    case 'zip': case 'rar': case 'tar': case 'gz': case '7z':
      return <FileZipOutlined style={{ color: '#ca8a04' }} />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg':
      return <FileImageOutlined style={{ color: '#7c3aed' }} />
    case 'mp3': case 'wav': case 'aac': case 'flac':
      return <SoundOutlined className="text-purple-500" />
    case 'mp4': case 'mov': case 'avi': case 'mkv':
      return <VideoCameraOutlined className="text-pink-500" />
    case 'txt': case 'md':
      return <FileTextOutlined className="text-slate-500" />
    default:
      return <FileOutlined className="text-slate-400" />
  }
}

// TYPE_LABEL is built dynamically via t() inside the component

const TYPE_COLOR: Record<FileType, string> = {
  document: 'blue', image: 'cyan', archive: 'orange',
  audio: 'purple', video: 'magenta', other: 'default',
}

export default function KnowledgePage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()

  const TYPE_LABEL: Record<FileType, string> = {
    document: t('knowledge.type_document'),
    image: t('knowledge.type_image'),
    archive: t('knowledge.type_archive'),
    audio: t('knowledge.type_audio'),
    video: t('knowledge.type_video'),
    other: t('knowledge.type_other'),
  }
  // ?doc=<id> — AI assistant links use this to deep-link to a specific
  // document. We filter the table to just that row so the user lands on
  // the referenced doc without manual searching. Clicking "清除" drops
  // the query param and restores the full list.
  const docFilter = searchParams?.get('doc') ?? null
  const { items, isLoading, removeItem, refresh } = useKnowledgeList()
  const [search, setSearch]     = useState('')
  const [activeTab, setActiveTab] = useState('list')
  const [showUpload, setShowUpload] = useState(false)

  function clearDocFilter() {
    // Preserve any other query params (e.g. future `?category=`).
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete('doc')
    const q = params.toString()
    router.replace(q ? `/knowledge?${q}` : '/knowledge')
  }

  function handleUploaded() {
    // Keep the upload panel open until parse settles — closing it here
    // would hide the in-progress parse rows. Parent triggers refresh via
    // onParseSettled instead.
  }

  function handleParseSettled() {
    // Reload the list so the newly indexed file appears; still keep the
    // panel open so the user can see the completed parse state.
    refresh()
  }

  function handleDelete(id: string) {
    removeItem(id)
  }

  const filtered = items.filter((i) => {
    if (docFilter && String(i.id) !== docFilter) return false
    if (!search) return true
    return i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.tags.some((t) => t.includes(search))
  })

  // If ?doc=<id> resolved to nothing (stale link, deleted item), tell the
  // user explicitly rather than silently showing an empty table.
  const docNotFound = docFilter && !isLoading && filtered.length === 0

  const columns: ColumnsType<KnowledgeItem> = [
    {
      title: t('knowledge.col_name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <div className="flex items-center gap-2">
          <span className="text-base">{getFileIcon(name)}</span>
          <span className="text-slate-700 text-sm font-medium truncate max-w-[260px]">{name}</span>
        </div>
      ),
    },
    {
      title: t('knowledge.col_type'),
      dataIndex: 'fileType',
      key: 'fileType',
      width: 80,
      render: (t: FileType) => (
        <Tag color={TYPE_COLOR[t]} className="text-xs">{TYPE_LABEL[t]}</Tag>
      ),
      filters: Object.entries(TYPE_LABEL).map(([v, t]) => ({ text: t, value: v })),
      onFilter: (v, record) => record.fileType === v,
    },
    {
      title: t('knowledge.col_size'),
      dataIndex: 'size',
      key: 'size',
      width: 90,
      render: (s: number) => <span className="text-slate-500 text-xs">{formatFileSize(s)}</span>,
      sorter: (a, b) => a.size - b.size,
    },
    {
      title: t('common.actions'),
      dataIndex: 'tags',
      key: 'tags',
      width: 160,
      render: (tags: string[]) => (
        <Space size={4} wrap>
          {tags.map((t) => (
            <Tag key={t} icon={<TagOutlined />} color="geekblue" className="text-xs m-0">{t}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('knowledge.col_uploader'),
      dataIndex: 'uploadedBy',
      key: 'uploadedBy',
      width: 100,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: t('knowledge.col_created'),
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      width: 100,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
      sorter: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
      defaultSortOrder: 'descend',
    },
    {
      title: t('common.download'),
      dataIndex: 'downloads',
      key: 'downloads',
      width: 72,
      align: 'center',
      render: (v: number) => (
        <span className="inline-flex items-center gap-1">
          {v >= 20 && <FireOutlined className="text-orange-500 text-xs" />}
          <span className="text-slate-400 text-xs">{v}</span>
        </span>
      ),
      sorter: (a, b) => a.downloads - b.downloads,
    },
    {
      title: t('knowledge.col_actions'),
      key: 'actions',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title={t('common.view')}>
            <Button
              type="text" size="small"
              icon={<EyeOutlined />}
              className="text-slate-400 hover:text-primary"
            />
          </Tooltip>
          <Tooltip title={t('common.download')}>
            <Button
              type="text" size="small"
              icon={<DownloadOutlined />}
              className="text-slate-400 hover:text-primary"
            />
          </Tooltip>
          <Tooltip title={t('common.more')}>
            <Button
              type="text" size="small"
              icon={<HistoryOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => router.push(`/knowledge/history?id=${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title={t('knowledge.delete_confirm')}
            description={t('knowledge.delete_confirm')}
            onConfirm={() => handleDelete(record.id)}
            okText={t('common.delete')}
            cancelText={t('common.cancel')}
            okButtonProps={{ danger: true }}
          >
            <Tooltip title={t('common.delete')}>
              <Button
                type="text" size="small"
                icon={<DeleteOutlined />}
                className="text-slate-400 hover:text-red-500"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{t('knowledge.page_title')}</h1>
            <p className="text-xs text-slate-400 mt-0.5">{items.length} {t('common.total')}</p>
          </div>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setShowUpload((v) => !v)}
          >
            {t('knowledge.upload_button')}
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-5 space-y-4">
        {/* AI-assistant deep-link banner */}
        {docFilter && (
          <Alert
            type={docNotFound ? 'warning' : 'info'}
            showIcon
            message={
              docNotFound
                ? `未找到 ID 为 ${docFilter} 的文件（可能已被删除或无权访问）`
                : `已按 AI 助手引用筛选至文件 #${docFilter}`
            }
            action={
              <Button size="small" type="link" onClick={clearDocFilter}>
                清除筛选
              </Button>
            }
            className="rounded-xl"
          />
        )}

        {/* Upload panel (collapsible) */}
        {showUpload && (
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">上传文件</h2>
              <Button
                type="text" size="small"
                onClick={() => setShowUpload(false)}
                className="text-slate-400 text-xs"
              >
                收起
              </Button>
            </div>
            <UploadZone onUploaded={handleUploaded} onParseSettled={handleParseSettled} />
          </div>
        )}

        {/* List panel */}
        <div className="bg-white rounded-2xl border border-slate-100">
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            className="px-5 pt-3"
            items={[
              { key: 'list', label: t('knowledge.tab_all') },
              { key: 'doc',  label: t('knowledge.type_document') },
              { key: 'img',  label: t('knowledge.type_image') },
              { key: 'arc',  label: t('knowledge.type_archive') },
            ]}
            size="small"
          />

          <div className="px-5 pb-3">
            {/* Search bar */}
            <div className="mb-4">
              <Input
                placeholder={t('knowledge.search_placeholder')}
                prefix={<SearchOutlined className="text-slate-300" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                allowClear
                style={{ width: 280 }}
                size="small"
              />
            </div>

            {/* Table */}
            {isLoading ? (
              <div className="flex justify-center py-16"><Spin /></div>
            ) : filtered.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('knowledge.empty_tip')}
                className="py-10"
              />
            ) : (
              <Table
                dataSource={filtered.filter((item) => {
                  if (activeTab === 'list') return true
                  if (activeTab === 'doc') return item.fileType === 'document'
                  if (activeTab === 'img') return item.fileType === 'image'
                  if (activeTab === 'arc') return item.fileType === 'archive'
                  return true
                })}
                columns={columns}
                rowKey="id"
                size="small"
                // virtual scroll kicks in for lists > 100 rows; pagination handles smaller sets
                virtual
                scroll={{ y: 600 }}
                pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
                className="ekm-knowledge-table"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
