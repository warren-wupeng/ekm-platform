'use client'
import { useState } from 'react'
import { Avatar, Badge, Button, Card, Tag, Tooltip } from 'antd'
import {
  SearchOutlined, UploadOutlined, EditOutlined,
  FileTextOutlined, TeamOutlined, ClockCircleOutlined,
  BellOutlined, FireOutlined, StarOutlined, ArrowRightOutlined,
  ThunderboltOutlined, BookOutlined,
} from '@ant-design/icons'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'

// ── Mock data ─────────────────────────────────────────────────────────────────

const RECENT_DOCS = [
  { id: 'd1', name: '技术架构设计 v5.docx',       type: 'document', date: '2026-04-17', views: 42 },
  { id: 'd2', name: 'EKM 系统调研报告.pdf',         type: 'document', date: '2026-04-16', views: 18 },
  { id: 'd3', name: 'API 设计规范 v2.md',           type: 'document', date: '2026-04-15', views: 31 },
  { id: 'd4', name: 'Q1 产品路线图.pptx',           type: 'document', date: '2026-04-14', views: 27 },
  { id: 'd5', name: 'RAG Pipeline 优化实验记录.md', type: 'document', date: '2026-04-13', views: 15 },
]

const RECOMMENDED = [
  { id: 'r1', name: '知识图谱快速入门',       department: '技术', likes: 24, hot: true },
  { id: 'r2', name: '新员工入职必读文档',     department: 'HR',   likes: 18, hot: false },
  { id: 'r3', name: 'EKM 使用指南 2026 版',  department: '产品', likes: 31, hot: true },
  { id: 'r4', name: '前端组件库设计规范',     department: '技术', likes: 12, hot: false },
]

const NOTIFICATIONS = [
  { id: 'n1', text: 'Warren Wu 分享了「产品路线图」给你',  time: '10 分钟前', unread: true },
  { id: 'n2', text: 'Luca Rossi 点赞了你的帖子',          time: '1 小时前',  unread: true },
  { id: 'n3', text: '知识库月度报告已生成',                time: '昨天',      unread: false },
]

const AI_TIPS = [
  '本周「RAG 召回率优化」获得了 31 个赞，建议发布到社区精华',
  '你上传的「技术架构设计.docx」本月被下载 18 次，热度上升 40%',
  '知识图谱中有 3 个孤立节点待连接，点击查看',
]

const QUICK_ACTIONS = [
  { label: '搜索知识',   icon: <SearchOutlined />,  href: '/search',    color: 'text-blue-500',   bg: 'bg-blue-50' },
  { label: '上传文件',   icon: <UploadOutlined />,   href: '/knowledge', color: 'text-green-500',  bg: 'bg-green-50' },
  { label: 'AI 写作',    icon: <EditOutlined />,     href: '/editor',    color: 'text-purple-500', bg: 'bg-purple-50' },
  { label: '社区发帖',   icon: <TeamOutlined />,     href: '/community', color: 'text-orange-500', bg: 'bg-orange-50' },
  { label: '知识门户',   icon: <BookOutlined />,     href: '/portal',    color: 'text-cyan-500',   bg: 'bg-cyan-50' },
  { label: '知识图谱',   icon: <ThunderboltOutlined />, href: '/knowledge-graph', color: 'text-pink-500', bg: 'bg-pink-50' },
]

const DEPT_COLOR: Record<string, string> = { 技术: 'blue', 产品: 'purple', HR: 'cyan', 市场: 'orange' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [notifOpen, setNotifOpen] = useState(false)
  const [tipIdx]   = useState(0)

  const displayName = user?.displayName ?? 'Kira Chen'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const unreadCount = NOTIFICATIONS.filter((n) => n.unread).length

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
                {greeting}，{displayName.split(' ')[0]}
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">今天是个好日子，开始高效工作吧</p>
            </div>
          </div>

          {/* Notification bell */}
          <div className="relative">
            <Tooltip title="通知" placement="bottom">
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
                  <span className="text-sm font-semibold text-slate-700">通知</span>
                  <button className="text-xs text-primary">全部已读</button>
                </div>
                <div>
                  {NOTIFICATIONS.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 flex items-start gap-3 border-b border-slate-50 last:border-0 ${n.unread ? 'bg-blue-50/40' : ''}`}
                    >
                      {n.unread && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-700 leading-snug">{n.text}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{n.time}</p>
                      </div>
                    </div>
                  ))}
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

        {/* AI tip banner */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-start gap-3">
          <ThunderboltOutlined className="text-blue-500 text-base mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-700 leading-relaxed">{AI_TIPS[tipIdx]}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Recent docs */}
          <div className="bg-white rounded-2xl border border-slate-100">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClockCircleOutlined className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">最近访问</span>
              </div>
              <button
                className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
                onClick={() => router.push('/knowledge')}
              >
                查看全部 <ArrowRightOutlined />
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {RECENT_DOCS.map((d) => (
                <div key={d.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer transition-colors">
                  <FileTextOutlined className="text-primary text-sm flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{d.name}</p>
                    <p className="text-[10px] text-slate-400">{d.date} · 查看 {d.views} 次</p>
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
                <span className="text-sm font-semibold text-slate-700">为你推荐</span>
              </div>
              <button
                className="text-xs text-primary hover:opacity-70 transition flex items-center gap-1"
                onClick={() => router.push('/portal')}
              >
                更多 <ArrowRightOutlined />
              </button>
            </div>
            <div className="divide-y divide-slate-50">
              {RECOMMENDED.map((r) => (
                <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-700 truncate">{r.name}</p>
                      {r.hot && <FireOutlined className="text-orange-400 text-xs flex-shrink-0" />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Tag color={DEPT_COLOR[r.department] ?? 'default'} className="text-[10px] m-0 px-1">
                        {r.department}
                      </Tag>
                      <span className="text-[10px] text-slate-400">{r.likes} 点赞</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '本月上传',   value: '12',   unit: '份',  color: 'text-blue-600',   icon: <UploadOutlined /> },
            { label: '知识总量',   value: '247',  unit: '篇',  color: 'text-green-600',  icon: <BookOutlined /> },
            { label: '社区互动',   value: '55',   unit: '次',  color: 'text-orange-600', icon: <TeamOutlined /> },
            { label: '获赞总数',   value: '128',  unit: '',    color: 'text-pink-600',   icon: <FireOutlined /> },
          ].map((s) => (
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
