'use client'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOutlined,
  TeamOutlined,
  SearchOutlined,
  UserOutlined,
  ApartmentOutlined,
  HomeOutlined,
  LogoutOutlined,
  BranchesOutlined,
  InboxOutlined,
  EditOutlined,
  NodeIndexOutlined,
  CodeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { Tooltip, Avatar } from 'antd'
import { useAuth } from '@/hooks/useAuth'
import { useUIStore } from '@/store/ui'
import clsx from 'clsx'

const NAV_ITEMS = [
  { key: '/dashboard',        icon: <HomeOutlined />,       label: '首页' },
  { key: '/search',           icon: <SearchOutlined />,     label: '搜索' },
  { key: '/knowledge',        icon: <BookOutlined />,       label: '知识库' },
  { key: '/community',        icon: <TeamOutlined />,       label: '社区' },
  { key: '/knowledge-graph',  icon: <BranchesOutlined />,   label: '知识图谱' },
  { key: '/archive',          icon: <InboxOutlined />,      label: '归档管理' },
  { key: '/ontology',         icon: <NodeIndexOutlined />,  label: 'Ontology' },
  { key: '/editor',           icon: <EditOutlined />,       label: 'AI 写作' },
  { key: '/developer',        icon: <CodeOutlined />,       label: 'Developer' },
]

const COLLAPSED_W = 64
const EXPANDED_W  = 200

export { COLLAPSED_W, EXPANDED_W }

export default function Sidebar() {
  const pathname  = usePathname()
  const router    = useRouter()
  const { user, logout }                                 = useAuth()
  const { sidebarExpanded, toggleSidebar, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore()
  const expanded = sidebarExpanded

  function isActive(key: string) {
    return pathname === key || pathname.startsWith(key + '/')
  }

  function navigate(key: string) {
    router.push(key)
    setMobileSidebarOpen(false)
  }

  const w = expanded ? EXPANDED_W : COLLAPSED_W

  return (
    <aside
      className={[
        'fixed left-0 top-0 h-screen flex flex-col py-4 z-50 transition-[width,transform] duration-200',
        // Mobile: hidden by default, slide in when open; Desktop: always visible
        'md:translate-x-0',
        mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      ].join(' ')}
      style={{
        width: w,
        background: 'var(--ekm-sidebar-bg)',
        borderRight: '1px solid #1e293b',
        overflow: 'hidden',
      }}
    >
      {/* Logo row */}
      <div className={clsx('flex items-center mb-6', expanded ? 'px-4' : 'justify-center')}>
        <Tooltip title={expanded ? undefined : '返回首页'} placement="right">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer"
            style={{ background: 'var(--ekm-primary)' }}
            onClick={() => navigate('/dashboard')}
          >
            <ApartmentOutlined className="text-white text-base" />
          </div>
        </Tooltip>
        {expanded && (
          <span className="ml-3 text-white font-semibold text-base tracking-tight whitespace-nowrap">
            EKM
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1 px-2">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.key)
          const btn = (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              className={clsx(
                'flex items-center gap-3 w-full rounded-xl text-base transition-all',
                expanded ? 'px-3 py-2' : 'justify-center w-10 h-10 mx-auto',
                active
                  ? 'bg-primary text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              )}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {expanded && (
                <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
              )}
            </button>
          )
          return expanded ? btn : (
            <Tooltip key={item.key} title={item.label} placement="right">
              {btn}
            </Tooltip>
          )
        })}
      </nav>

      {/* Toggle button */}
      <div className={clsx('flex mb-2', expanded ? 'justify-end px-3' : 'justify-center')}>
        <Tooltip title={expanded ? '收起' : '展开'} placement="right">
          <button
            onClick={toggleSidebar}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 transition-all text-sm"
          >
            {expanded ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
          </button>
        </Tooltip>
      </div>

      {/* Bottom: profile + logout */}
      <div className={clsx('flex flex-col gap-2 px-2', expanded ? '' : 'items-center')}>
        {expanded ? (
          <button
            onClick={() => router.push('/profile')}
            className="flex items-center gap-3 w-full rounded-xl px-3 py-2 hover:bg-slate-700 transition-all"
          >
            {user?.avatar ? (
              <Avatar size={24} src={user.avatar} />
            ) : (
              <UserOutlined className="text-slate-400 text-base flex-shrink-0" />
            )}
            <span className="text-slate-300 text-sm truncate whitespace-nowrap">
              {user?.displayName ?? '我'}
            </span>
          </button>
        ) : (
          <Tooltip title={user?.displayName ?? '我'} placement="right">
            <button
              onClick={() => router.push('/profile')}
              className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-slate-700 transition-all"
            >
              {user?.avatar ? (
                <Avatar size={28} src={user.avatar} />
              ) : (
                <UserOutlined className="text-slate-400 text-base" />
              )}
            </button>
          </Tooltip>
        )}

        {expanded ? (
          <button
            onClick={logout}
            className="flex items-center gap-3 w-full rounded-xl px-3 py-2 text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-all"
          >
            <LogoutOutlined className="text-base flex-shrink-0" />
            <span className="text-sm whitespace-nowrap">退出登录</span>
          </button>
        ) : (
          <Tooltip title="退出登录" placement="right">
            <button
              onClick={logout}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-all"
            >
              <LogoutOutlined className="text-base" />
            </button>
          </Tooltip>
        )}
      </div>
    </aside>
  )
}
