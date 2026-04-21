'use client'
import { useState } from 'react'
import { Avatar, Badge, Button, Spin, Tooltip } from 'antd'
import {
  SearchOutlined, UploadOutlined, EditOutlined,
  FileTextOutlined, TeamOutlined, ClockCircleOutlined,
  BellOutlined, FireOutlined, StarOutlined, ArrowRightOutlined,
  ThunderboltOutlined, BookOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useKnowledgeList } from '@/lib/useKnowledgeList'
import { useNotifications } from '@/lib/useNotifications'

const DEPT_COLOR: Record<string, string> = { 技术: 'text-blue-600', 产品: 'text-purple-600', HR: 'text-cyan-600', 市场: 'text-orange-600' }

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { t } = useTranslation()
  const [notifOpen, setNotifOpen] = useState(false)

  const { items, isLoading: docsLoading } = useKnowledgeList()
  const { items: notifications, unreadCount, markAllRead } = useNotifications()

  const displayName = user?.displayName ?? user?.username ?? ''
  const hour = new Date().getHours()
  const greeting = hour < 12
    ? t('dashboard.greeting_morning')
    : hour < 18
      ? t('dashboard.greeting_afternoon')
      : t('dashboard.greeting_evening')

  const QUICK_ACTIONS = [
    { label: t('dashboard.quick_search'),    icon: <SearchOutlined />,        href: '/search',          color: 'text-blue-500',   bg: 'bg-blue-50' },
    { label: t('dashboard.quick_upload'),    icon: <UploadOutlined />,         href: '/knowledge',       color: 'text-green-500',  bg: 'bg-green-50' },
    { label: t('dashboard.quick_editor'),    icon: <EditOutlined />,           href: '/editor',          color: 'text-purple-500', bg: 'bg-purple-50' },
    { label: t('dashboard.quick_community'), icon: <TeamOutlined />,           href: '/community',       color: 'text-orange-500', bg: 'bg-orange-50' },
    { label: t('dashboard.quick_portal'),    icon: <BookOutlined />,           href: '/portal',          color: 'text-cyan-500',   bg: 'bg-cyan-50' },
    { label: t('dashboard.quick_graph'),     icon: <ThunderboltOutlined />,    href: '/knowledge-graph', color: 'text-pink-500',   bg: 'bg-pink-50' },
  ]

  // Recent: sort by upload date desc, take 5
  const recentDocs = [...items]
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .slice(0, 5)

  // Recommended: sort by downloads desc, take 4
  const recommendedDocs = [...items]
    .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
    .slice(0, 4)

  const myDocs  = items.filter((d) => d.uploadedBy === user?.username)
  const totalDownloads = items.reduce((s, d) => s + (d.downloads ?? 0), 0)

  const STATS = [
    { label: t('dashboard.stat_uploads'),       value: myDocs.length,     unit: t('dashboard.unit_docs'),  color: 'text-blue-600',   icon: <UploadOutlined /> },
    { label: t('dashboard.stat_total'),         value: items.length,      unit: t('dashboard.unit_items'), color: 'text-green-600',  icon: <BookOutlined /> },
    { label: t('dashboard.stat_interactions'),  value: totalDownloads,    unit: t('dashboard.unit_times'), color: 'text-orange-600', icon: <TeamOutlined /> },
    { label: t('dashboard.stat_likes'),         value: unreadCount,       unit: '',                         color: 'text-pink-600',   icon: <FireOutlined /> },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero header */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar
              size={48}
              style={{ background: 'var(--ekm-primary)', fontSize: 18, flexShrink: 0 }}
            >
              {displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
            </Avatar>
            <div>
              <h1 className="text-lg font-bold text-slate-800">
                {greeting}, {displayName.split(' ')[0]}
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">{t('dashboard.subtitle')}</p>
            </div>
          </div>

          {/* Notification bell */}
          <div className="relative">
            <Tooltip title={t('dashboard.notifications')} placement="bottom">
              <button
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                onClick={() => setNotifOpen((v) => !v)}
              >
                <Badge count={unreadCount} size="small">
                  <BellOutlined className="text-slate-500 text-base" />
                </Badge>
              </button>
            </Tooltip>

            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl border border-slate-100 shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">{t('dashboard.notifications')}</span>
                  {unreadCount > 0 && (
                    <button className="text-xs text-primary" onClick={markAllRead}>{t('dashboard.mark_all_read')}</button>
                  )}
                </div>
                <div>
                  {notifications.slice(0, 5).map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 flex items-start gap-3 border-b border-slate-50 last:border-0 ${!n.read ? 'bg-blue-50/40' : ''}`}
                    >
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 leading-snug">{n.title ?? n.type}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{n.created_at?.slice(0, 10)}</p>
                      </div>
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">{t('common.no_new_messages')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Quick actions */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.href}
              onClick={() => router.push(a.href)}
              className="flex flex-col items-center gap-2 bg-white rounded-2xl border border-slate-100 p-3 hover:border-primary hover:shadow-sm transition-all"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${a.bg} ${a.color}`}>
                {a.icon}
              </div>
              <span className="text-xs text-slate-600 font-medium">{a.label}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Recent docs */}
          <div className="bg-white rounded-2xl border border-slate-100">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClockCircleOutlined className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{t('dashboard.section_recent')}</span>
              </div>
              <button
                className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
                onClick={() => router.push('/knowledge')}
              >
                {t('dashboard.view_all')} <ArrowRightOutlined />
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {docsLoading ? (
                <div className="py-6 flex justify-center"><Spin size="small" /></div>
              ) : recentDocs.map((d) => (
                <div
                  key={d.id}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer transition-colors"
                  onClick={() => router.push(`/knowledge?doc=${d.id}`)}
                >
                  <FileTextOutlined className="text-primary text-sm flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{d.name}</p>
                    <p className="text-[10px] text-slate-400">{d.uploadedAt?.slice(0, 10)} · {d.downloads ?? 0} {t('dashboard.views')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended */}
          <div className="bg-white rounded-2xl border border-slate-100">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StarOutlined className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">{t('dashboard.section_recommended')}</span>
              </div>
              <button
                className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
                onClick={() => router.push('/portal')}
              >
                {t('dashboard.more')} <ArrowRightOutlined />
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {docsLoading ? (
                <div className="py-6 flex justify-center"><Spin size="small" /></div>
              ) : recommendedDocs.map((r) => (
                <div
                  key={r.id}
                  className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer transition-colors"
                  onClick={() => router.push(`/knowledge?doc=${r.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-700 truncate">{r.name}</p>
                      {(r.downloads ?? 0) > 10 && <FireOutlined className="text-orange-400 text-xs flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {r.uploadedBy && (
                        <span className={`text-[10px] font-medium ${DEPT_COLOR[r.uploadedBy] ?? 'text-slate-400'}`}>{r.uploadedBy}</span>
                      )}
                      <span className="text-[10px] text-slate-400">{r.downloads ?? 0} {t('dashboard.likes')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATS.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-100 p-4">
              <div className={`text-xl mb-1 ${s.color}`}>{s.icon}</div>
              <p className="text-xl font-bold text-slate-800">{s.value}<span className="text-sm font-normal text-slate-400 ml-0.5">{s.unit}</span></p>
              <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
