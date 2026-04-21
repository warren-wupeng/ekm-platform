'use client'
import { useState } from 'react'
import { App, Avatar, Tag, Button, Tabs, Form, Input, Select, Badge, Drawer, Spin, Empty } from 'antd'
import {
  EditOutlined, FileTextOutlined, TeamOutlined,
  CheckOutlined, LikeOutlined, StarOutlined,
  BellOutlined, ClockCircleOutlined, InfoCircleOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/auth'
import { useTranslation } from 'react-i18next'
import { useKnowledgeList } from '@/lib/useKnowledgeList'
import { usePosts } from '@/lib/usePosts'
import { useNotifications } from '@/lib/useNotifications'
import api from '@/lib/api'

const NOTIF_ICON: Record<string, React.ReactNode> = {
  like:    <LikeOutlined className="text-blue-500" />,
  share:   <StarOutlined className="text-yellow-500" />,
  system:  <InfoCircleOutlined className="text-slate-400" />,
  mention: <TeamOutlined className="text-purple-500" />,
  comment: <TeamOutlined className="text-green-500" />,
}

export default function ProfilePage() {
  const { message } = App.useApp()
  const { user, token } = useAuth()
  const setAuth = useAuthStore((s) => s.setAuth)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const { t } = useTranslation()
  const [editing, setEditing]     = useState(false)
  const [msgOpen, setMsgOpen]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [form] = Form.useForm()

  const { items: allDocs, isLoading: docsLoading } = useKnowledgeList()
  const { posts: allPosts, isLoading: postsLoading } = usePosts(100)
  const { items: notifications, unreadCount, markRead, markAllRead, isLoading: notifsLoading } = useNotifications()

  const displayName = user?.displayName ?? user?.username ?? ''
  const email = user?.email ?? ''

  // Filter to current user's uploads/posts
  const myDocs = allDocs.filter((d) => d.uploadedBy === user?.username)
  const myPosts = allPosts.filter((p) => String(p.author_id) === user?.id)
  const totalLikes = myPosts.reduce((s, p) => s + p.like_count, 0)

  async function handleSave(values: { displayName: string; department: string }) {
    setSaving(true)
    try {
      const res = await api.put('/api/v1/auth/me', {
        display_name: values.displayName,
        department: values.department,
      })
      // Update auth store with new display_name
      if (user && token && refreshToken) {
        setAuth({ ...user, displayName: res.data.display_name, department: res.data.department }, token, refreshToken)
      }
      message.success(t('profile.profile_saved'))
      setEditing(false)
    } catch {
      message.error(t('common.error_generic'))
    } finally {
      setSaving(false)
    }
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
                {user?.department && <Tag color="blue" className="text-xs">{user.department}</Tag>}
                {user?.roles?.[0] && <Tag color="purple" className="text-xs">{user.roles[0]}</Tag>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge count={unreadCount} size="small">
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
                  form.setFieldsValue({ displayName, department: user?.department ?? '' })
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
              { title: t('profile.stat_docs'), value: docsLoading ? '…' : myDocs.length },
              { title: t('profile.stat_posts'), value: postsLoading ? '…' : myPosts.length },
              { title: t('profile.stat_likes'), value: postsLoading ? '…' : totalLikes },
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
              children: docsLoading ? (
                <div className="py-10 flex justify-center"><Spin /></div>
              ) : myDocs.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-10" />
              ) : (
                <div className="space-y-2">
                  {myDocs.map((d) => (
                    <div key={d.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      <FileTextOutlined className="text-primary text-base flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{d.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{d.uploadedAt} · {t('profile.download_count', { count: d.downloads ?? 0 })}</p>
                      </div>
                      <div className="hidden sm:flex gap-1 flex-shrink-0">
                        {(d.tags ?? []).slice(0, 3).map((tag) => (
                          <Tag key={tag} className="text-[10px] m-0">{tag}</Tag>
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
              children: postsLoading ? (
                <div className="py-10 flex justify-center"><Spin /></div>
              ) : myPosts.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-10" />
              ) : (
                <div className="space-y-2">
                  {myPosts.map((p) => (
                    <div key={p.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 leading-snug">{p.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{p.created_at?.slice(0, 10)}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                        <LikeOutlined />{p.like_count}
                      </span>
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
            {unreadCount > 0 && (
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
        {notifsLoading ? (
          <div className="py-10 flex justify-center"><Spin /></div>
        ) : (
          <div>
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b border-slate-50 flex items-start gap-3 cursor-pointer hover:bg-slate-50/60 transition-colors ${!n.read ? 'bg-blue-50/30' : ''}`}
                onClick={() => !n.read && markRead(n.id)}
              >
                <div className="w-7 h-7 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  {NOTIF_ICON[n.type] ?? <InfoCircleOutlined className="text-slate-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 font-medium leading-snug">{n.title ?? n.type}</p>
                  <p className="text-[10px] text-slate-300 mt-0.5 flex items-center gap-1">
                    <ClockCircleOutlined />{n.created_at?.slice(0, 10)}
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
        )}
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
              <div className="flex justify-end gap-2">
                <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
                <Button type="primary" htmlType="submit" icon={<CheckOutlined />} loading={saving}>{t('common.save')}</Button>
              </div>
            </Form>
          </div>
        </div>
      )}
    </div>
  )
}
