'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Table, Tag, Tabs, Empty, Tooltip, Space, Popconfirm, Spin } from 'antd'
import type { ColumnsType } from 'antd/es/table'
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

const TYPE_LABEL: Record<FileType, string> = {
  document: '文档', image: '图片', archive: '压缩包',
  audio: '音频', video: '视频', other: '其他',
}

const TYPE_COLOR: Record<FileType, string> = {
  document: 'blue', image: 'cyan', archive: 'orange',
  audio: 'purple', video: 'magenta', other: 'default',
}

export default function KnowledgePage() {
  const router = useRouter()
  const { items, isLoading, removeItem, refresh } = useKnowledgeList()
  const [search, setSearch]     = useState('')
  const [activeTab, setActiveTab] = useState('list')
  const [showUpload, setShowUpload] = useState(false)

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

  const filtered = items.filter((i) =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.tags.some((t) => t.includes(search))
  )

  const columns: ColumnsType<KnowledgeItem> = [
    {
      title: '文件名',
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
      title: '类型',
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
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 90,
      render: (s: number) => <span className="text-slate-500 text-xs">{formatFileSize(s)}</span>,
      sorter: (a, b) => a.size - b.size,
    },
    {
      title: '标签',
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
      title: '上传者',
      dataIndex: 'uploadedBy',
      key: 'uploadedBy',
      width: 100,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
    },
    {
      title: '上传时间',
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      width: 100,
      render: (v: string) => <span className="text-slate-400 text-xs">{v}</span>,
      sorter: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
      defaultSortOrder: 'descend',
    },
    {
      title: '下载',
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
      title: '操作',
      key: 'actions',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="预览">
            <Button
              type="text" size="small"
              icon={<EyeOutlined />}
              className="text-slate-400 hover:text-primary"
            />
          </Tooltip>
          <Tooltip title="下载">
            <Button
              type="text" size="small"
              icon={<DownloadOutlined />}
              className="text-slate-400 hover:text-primary"
            />
          </Tooltip>
          <Tooltip title="版本历史">
            <Button
              type="text" size="small"
              icon={<HistoryOutlined />}
              className="text-slate-400 hover:text-primary"
              onClick={() => router.push(`/knowledge/history?id=${record.id}`)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除"
            description="此操作不可恢复，确认删除该文件？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="删除">
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
            <h1 className="text-lg font-semibold text-slate-800">知识库</h1>
            <p className="text-xs text-slate-400 mt-0.5">{items.length} 个文件 · 按部门共享</p>
          </div>
          <Button
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setShowUpload((v) => !v)}
          >
            上传文件
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-5 space-y-4">
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
              { key: 'list', label: '全部文件' },
              { key: 'doc',  label: '文档' },
              { key: 'img',  label: '图片' },
              { key: 'arc',  label: '压缩包' },
            ]}
            size="small"
          />

          <div className="px-5 pb-3">
            {/* Search bar */}
            <div className="mb-4">
              <Input
                placeholder="搜索文件名或标签…"
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
                description="暂无文件，点击右上角「上传文件」开始"
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
