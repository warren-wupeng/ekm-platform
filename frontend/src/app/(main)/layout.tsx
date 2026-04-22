'use client'
import { useEffect, useState } from 'react'
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
  // Lazy initializer avoids a layout-shift on mobile by reading the viewport width
  // synchronously on the first client render (safe because this is a 'use client' component).
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768,
  )

  useEffect(() => {
    // Only act after persist middleware has finished rehydrating from localStorage.
    // Otherwise a hard refresh kicks the user to /login before state is restored.
    if (_hasHydrated && !isAuthenticated) {
      router.replace('/login')
    }
  }, [_hasHydrated, isAuthenticated, router])

  useEffect(() => {
    // matchMedia fires only when crossing the breakpoint, avoiding resize-storm re-renders.
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

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

      <div className="flex-1 flex flex-col overflow-hidden">
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

        {/* Content — single main element; sidebar offset applied on desktop only */}
        <main
          className="flex-1 min-h-0 overflow-auto md:transition-[margin-left] md:duration-200"
          style={{ marginLeft: isMobile ? 0 : ml }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
