'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/store/auth'
import { useUIStore } from '@/store/ui'
import Sidebar, { COLLAPSED_W, EXPANDED_W } from '@/components/layout/Sidebar'
import LanguageSwitcher from '@/components/layout/LanguageSwitcher'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, _hasHydrated } = useAuthStore()
  const { sidebarExpanded, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore()
  const router = useRouter()

  useEffect(() => {
    // Only act after persist middleware has finished rehydrating from localStorage.
    // Otherwise a hard refresh kicks the user to /login before state is restored.
    if (_hasHydrated && !isAuthenticated) {
      router.replace('/login')
    }
  }, [_hasHydrated, isAuthenticated, router])

  // Block render until hydration completes — show a blank page briefly instead of
  // flashing the login page on a valid session refresh.
  if (!_hasHydrated) return null
  if (!isAuthenticated) return null

  const ml = sidebarExpanded ? EXPANDED_W : COLLAPSED_W

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Mobile backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden md:transition-[margin-left] md:duration-200"
        style={{ marginLeft: 0 }}
      >
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <Button
            type="text" size="small"
            icon={<MenuOutlined className="text-slate-500" />}
            onClick={() => setMobileSidebarOpen(true)}
          />
          <span className="text-sm font-semibold text-slate-800 flex-1">EKM</span>
          <LanguageSwitcher />
        </div>

        {/* Content — on desktop shift right, on mobile full-width */}
        <main
          className="flex-1 min-h-0 overflow-auto hidden md:block transition-[margin-left] duration-200"
          style={{ marginLeft: ml }}
        >
          {children}
        </main>
        <main className="flex-1 min-h-0 overflow-auto md:hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
