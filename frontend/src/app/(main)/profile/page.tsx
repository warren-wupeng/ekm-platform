'use client'
import { useState } from 'react'
import { Avatar, Tag, Button, Tabs, Statistic, Form, Input, Select, message } from 'antd'
import {
  EditOutlined, FileTextOutlined, TeamOutlined,
  CheckOutlined, LikeOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'

const MOCK_DOCS = [
  { id: 'd1', name: '技术架构设计.docx', date: '2026-04-16', downloads: 18, tags: ['技术', '架构'] },
  { id: 'd2', name: 'EKM 系统调研报告.pdf', date: '2026-04-10', downloads: 7, tags: ['调研'] },
  { id: 'd3', name: 'API 设计规范 v2.md', date: '2026-03-28', downloads: 31, tags: ['API', '规范'] },
]

const MOCK_POSTS = [
  { id: 'p1', title: 'RAG 召回率优化实践：从 67% 到 91%', date: '2026-04-15', likes: 31 },
  { id: 'p2', title: 'EKM 知识图谱功能上线！', date: '2026-04-17', likes: 24 },
]

export default function ProfilePage() {
  const { user } = useAuth()
  const [editing, setEditing] = useState(false)
  const [form] = Form.useForm()

  const displayName = user?.displayName ?? 'Kira Chen'
  const email       = user?.email ?? 'kira@ekm.ai'

  function handleSave(values: { displayName: string; department: string; bio: string }) {
    message.success('个人信息已保存')
    setEditing(false)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Profile hero */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <Avatar
              size={72}
              style={{ background: 'var(--ekm-primary)', fontSize: 24, flexShrink: 0 }}
            >
              {displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-slate-800">{displayName}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{email}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Tag color="blue" className="text-xs">技术</Tag>
                <Tag color="purple" className="text-xs">CTO</Tag>
                <span className="text-xs text-slate-400">加入于 2026-01-10</span>
              </div>
            </div>
            <Button
              size="small" icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue({ displayName, department: '技术', bio: '分布式系统 & AI infra 工程师，前 Databricks。' })
                setEditing(true)
              }}
              className="flex-shrink-0"
            >
              编辑资料
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            {[
              { title: '上传文档', value: MOCK_DOCS.length },
              { title: '社区帖子', value: MOCK_POSTS.length },
              { title: '获赞数',   value: MOCK_POSTS.reduce((s, p) => s + p.likes, 0) },
            ].map((s) => (
              <div key={s.title} className="text-center">
                <p className="text-xl font-bold text-slate-800">{s.value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content tabs */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
        <Tabs
          items={[
            {
              key: 'docs',
              label: <span><FileTextOutlined className="mr-1" />我的文档</span>,
              children: (
                <div className="space-y-2">
                  {MOCK_DOCS.map((d) => (
                    <div key={d.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      <FileTextOutlined className="text-primary text-base flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{d.date} · 下载 {d.downloads} 次</p>
                      </div>
                      <div className="hidden sm:flex gap-1 flex-shrink-0">
                        {d.tags.map((t) => (
                          <Tag key={t} className="text-[10px] m-0">{t}</Tag>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              key: 'posts',
              label: <span><TeamOutlined className="mr-1" />我的帖子</span>,
              children: (
                <div className="space-y-2">
                  {MOCK_POSTS.map((p) => (
                    <div key={p.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 leading-snug">{p.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{p.date}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                        <LikeOutlined />{p.likes}
                      </span>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Edit profile modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">编辑个人资料</h2>
            <Form form={form} layout="vertical" onFinish={handleSave}>
              <Form.Item name="displayName" label="姓名" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="department" label="部门">
                <Select options={[
                  { label: '技术', value: '技术' },
                  { label: '产品', value: '产品' },
                  { label: '市场', value: '市场' },
                  { label: '项目', value: '项目' },
                ]} />
              </Form.Item>
              <Form.Item name="bio" label="个人简介">
                <Input.TextArea rows={3} maxLength={100} showCount />
              </Form.Item>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>取消</Button>
                <Button type="primary" htmlType="submit" icon={<CheckOutlined />}>保存</Button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  )
}
