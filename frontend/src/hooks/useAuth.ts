'use client'
import { useAuthStore } from '@/store/auth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function useAuth() {
  const { user, token, isAuthenticated, setAuth, clearAuth } = useAuthStore()
  const router = useRouter()

  function logout() {
    clearAuth()
    router.push('/login')
  }

  return { user, token, isAuthenticated, setAuth, logout }
}

export function useRequireAuth() {
  const { isAuthenticated } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login')
    }
  }, [isAuthenticated, router])

  return isAuthenticated
}
