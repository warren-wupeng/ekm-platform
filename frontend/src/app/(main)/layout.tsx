'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { useUIStore } from '@/store/ui'
import Sidebar, { COLLAPSED_W, EXPANDED_W } from '@/components/layout/Sidebar'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  const { sidebarExpanded } = useUIStore()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated) return null

  const ml = sidebarExpanded ? EXPANDED_W : COLLAPSED_W

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main
        className="flex-1 min-h-screen transition-[margin-left] duration-200"
        style={{ marginLeft: ml }}
      >
        {children}
      </main>
    </div>
  )
}
