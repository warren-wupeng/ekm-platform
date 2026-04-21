'use client'
import { useState } from 'react'
import { App, Avatar, Tag, Button, Tabs, Form, Input, Select, Badge, Drawer } from 'antd'
import {
  EditOutlined, FileTextOutlined, TeamOutlined,
  CheckOutlined, LikeOutlined, StarOutlined,
  BellOutlined, ClockCircleOutlined, InfoCircleOutlined,
  CheckCircleOutlined, WarningOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'
import { useTranslation } from 'react-i18next'

const MOCK_DOCS = [
  { id: 'd1', name: '技术架构设计.docx', date: '2026-04-16', downloads: 18, tags: ['技术', '架构'] },
  { id: 'd2', name: 'EKM 系统调研报告.pdf', date: '2026-04-10', downloads: 7, tags: ['调研'] },
  { id: 'd3', name: 'API 设计规范 v2.md', date: '2026-03-28', downloads: 31, tags: ['API', '规范'] },
]

const MOCK_POSTS = [
  { id: 'p1', title: 'RAG 召回率优化实践：从 67% 到 91%', date: '2026-04-15', likes: 31 },
  { id: 'p2', title: 'EKM 知识图谱功能上线！', date: '2026-04-17', likes: 24 },
]

const MOCK_FAVORITES = [
  { id: 'f1', name: '新员工入职手册 2026', type: 'document', date: '2026-04-16' },
  { id: 'f2', name: 'EKM 使用指南', type: 'document', date: '2026-04-14' },
  { id: 'f3', title: '关于知识库分类体系的讨论', type: 'post', date: '2026-04-13' },
  { id: 'f4', name: 'Q2 产品路线图.pptx', type: 'document', date: '2026-04-11' },
]

interface Notification {
  id: string
  type: 'like' | 'share' | 'system' | 'mention'
  text: string
  detail: string
  time: string
  read: boolean
}

const MOCK_NOTIFICATIONS: Notification[] = [
  { id: 'n1', type: 'like',    text: 'Warren Wu 点赞了你的帖子',              detail: 'RAG 召回率优化实践：从 67% 到 91%', time: '10 分钟前', read: false },
  { id: 'n2', type: 'share',   text: 'Luca Rossi 分享了一份文档给你',         detail: '市场推广策略 2026 H1',             time: '1 小时前',  read: false },
  { id: 'n3', type: 'mention', text: 'Mira Tang 在帖子中提到了你',            detail: '产品周报 #12 中 @Kira',           time: '昨天',      read: false },
  { id: 'n4', type: 'system',  text: '知识库月度报告已生成',                  detail: '2026 年 3 月知识库统计报告可下载', time: '2 天前',    read: true },
  { id: 'n5', type: 'like',    text: 'Luca Rossi 点赞了你的帖子',             detail: 'EKM 知识图谱功能上线！',          time: '3 天前',    read: true },
  { id: 'n6', type: 'system',  text: '你上传的「技术架构设计.docx」被下载 10 次', detail: '本月下载量突破 10 次里程碑',  time: '4 天前',    read: true },
]

const NOTIF_ICON: Record<string, React.ReactNode> = {
  like:    <LikeOutlined className="text-blue-500" />,
  share:   <StarOutlined className="text-yellow-500" />,
  system:  <InfoCircleOutlined className="text-slate-400" />,
  mention: <TeamOutlined className="text-purple-500" />,
}

export default function ProfilePage() {
  const { message } = App.useApp()
  const { user } = useAuth()
  const { t } = useTranslation()
  const [editing, setEditing]               = useState(false)
  const [msgOpen, setMsgOpen]               = useState(false)
  const [notifications, setNotifications]   = useState<Notification[]>(MOCK_NOTIFICATIONS)
  const [form] = Form.useForm()

  const displayName = user?.displayName ?? 'Kira Chen'
  const email       = user?.email ?? 'kira@ekm.ai'
  const unread      = notifications.filter((n) => !n.read).length

  function handleSave(values: { displayName: string; department: string; bio: string }) {
    message.success(t('profile.profile_saved'))
    setEditing(false)
  }

  function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
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
                <span className="text-xs text-slate-400">{t('profile.joined_at')} 2026-01-10</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Message center bell */}
              <Badge count={unread} size="small">
                <Button
                  size="small" icon={<BellOutlined />}
                  onClick={() => setMsgOpen(true)}
                >
                  {t('profile.messages')}
                </Button>
              </Badge>
              <Button
                size="small" icon={<EditOutlined />}
                onClick={() => {
                  form.setFieldsValue({ displayName, department: '技术', bio: '分布式系统 & AI infra 工程师，前 Databricks。' })
                  setEditing(true)
                }}
              >
                {t('profile.edit_profile')}
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            {[
              { title: t('profile.stat_docs'), value: MOCK_DOCS.length },
              { title: t('profile.stat_posts'), value: MOCK_POSTS.length },
              { title: t('profile.stat_likes'),   value: MOCK_POSTS.reduce((s, p) => s + p.likes, 0) },
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
              label: <span><FileTextOutlined className="mr-1" />{t('profile.tab_docs')}</span>,
              children: (
                <div className="space-y-2">
                  {MOCK_DOCS.map((d) => (
                    <div key={d.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      <FileTextOutlined className="text-primary text-base flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{d.date} · {t('profile.download_count', { count: d.downloads })}</p>
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
              label: <span><TeamOutlined className="mr-1" />{t('profile.tab_posts')}</span>,
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
            {
              key: 'favorites',
              label: <span><StarOutlined className="mr-1" />{t('profile.tab_favorites')}</span>,
              children: (
                <div className="space-y-2">
                  {MOCK_FAVORITES.map((f) => (
                    <div key={f.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      {f.type === 'document'
                        ? <FileTextOutlined className="text-primary text-base flex-shrink-0" />
                        : <TeamOutlined className="text-purple-500 text-base flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{(f as any).name ?? (f as any).title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {f.type === 'document' ? t('profile.fav_document') : t('profile.fav_post')} · {t('profile.fav_date')} {f.date}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Message center drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between pr-4">
            <span>{t('profile.msg_center')}</span>
            {unread > 0 && (
              <button className="text-xs text-primary font-normal" onClick={markAllRead}>
                {t('profile.mark_all_read')}
              </button>
            )}
          </div>
        }
        open={msgOpen}
        onClose={() => setMsgOpen(false)}
        width={360}
        styles={{ body: { padding: 0 } }}
      >
        <div>
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`px-4 py-3 border-b border-slate-50 flex items-start gap-3 cursor-pointer hover:bg-slate-50/60 transition-colors ${!n.read ? 'bg-blue-50/30' : ''}`}
              onClick={() => setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}
            >
              <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                {NOTIF_ICON[n.type]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 font-medium leading-snug">{n.text}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">{n.detail}</p>
                <p className="text-[10px] text-slate-300 mt-0.5 flex items-center gap-1">
                  <ClockCircleOutlined />{n.time}
                </p>
              </div>
              {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
            </div>
          ))}
          {notifications.every((n) => n.read) && (
            <div className="text-center py-12 text-slate-400 flex flex-col items-center gap-2">
              <CheckCircleOutlined className="text-2xl text-green-400" />
              <p className="text-sm">{t('common.no_new_messages')}</p>
            </div>
          )}
        </div>
      </Drawer>

      {/* Edit profile modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">{t('profile.edit_title')}</h2>
            <Form form={form} layout="vertical" onFinish={handleSave}>
              <Form.Item name="displayName" label={t('profile.label_name')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="department" label={t('profile.label_department')}>
                <Select options={[
                  { label: t('profile.dept_tech'), value: '技术' },
                  { label: t('profile.dept_product'), value: '产品' },
                  { label: t('profile.dept_marketing'), value: '市场' },
                  { label: t('profile.dept_pm'), value: '项目' },
                ]} />
              </Form.Item>
              <Form.Item name="bio" label={t('profile.label_bio')}>
                <Input.TextArea rows={3} maxLength={100} showCount />
              </Form.Item>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
                <Button type="primary" htmlType="submit" icon={<CheckOutlined />}>{t('common.save')}</Button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  )
}
