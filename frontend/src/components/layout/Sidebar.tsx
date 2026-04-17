'use client'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOutlined,
  TeamOutlined,
  SearchOutlined,
  UserOutlined,
  ThunderboltOutlined,
  LogoutOutlined,
  BranchesOutlined,
} from '@ant-design/icons'
import { Tooltip, Avatar } from 'antd'
import { useAuth } from '@/hooks/useAuth'
import clsx from 'clsx'

const NAV_ITEMS = [
  { key: '/dashboard',        icon: <ThunderboltOutlined />, label: '首页' },
  { key: '/search',           icon: <SearchOutlined />,      label: '搜索' },
  { key: '/knowledge',        icon: <BookOutlined />,        label: '知识库' },
  { key: '/community',        icon: <TeamOutlined />,        label: '社区' },
  { key: '/knowledge-graph',  icon: <BranchesOutlined />,    label: '知识图谱' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  function isActive(key: string) {
    return pathname === key || pathname.startsWith(key + '/')
  }

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col items-center py-4 z-50"
      style={{ width: 64, background: '#0f172a', borderRight: '1px solid #1e293b' }}
    >
      {/* Logo */}
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center mb-6 cursor-pointer"
        style={{ background: '#2563eb' }}
        onClick={() => router.push('/dashboard')}
      >
        <ThunderboltOutlined className="text-white text-base" />
      </div>

      {/* Nav */}
      <nav className="flex flex-col items-center gap-1 flex-1">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.key} title={item.label} placement="right">
            <button
              onClick={() => router.push(item.key)}
              className={clsx(
                'w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all',
                isActive(item.key)
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              )}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </nav>

      {/* Bottom: profile + logout */}
      <div className="flex flex-col items-center gap-2">
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
        <Tooltip title="退出登录" placement="right">
          <button
            onClick={logout}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-all"
          >
            <LogoutOutlined className="text-base" />
          </button>
        </Tooltip>
      </div>
    </aside>
  )
}
