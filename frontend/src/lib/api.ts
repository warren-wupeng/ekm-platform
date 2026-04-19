import axios from 'axios'
import { useAuthStore } from '@/store/auth'

// Use relative base URL so /api/v1/* requests go through Next.js rewrites,
// which proxy to the backend via BACKEND_URL env var (server-side, not baked in bundle).
export const API_BASE_URL = ''

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token from Zustand persisted store. Reading getState() is safe
// both during and after hydration — pre-hydration the token is null and
// the interceptor just omits the header (unauthenticated endpoints still work).
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto redirect to login on 401 — but NOT for auth endpoints themselves,
// so that login/refresh failures surface as proper errors in the UI.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url: string = err.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh')
    if (err.response?.status === 401 && !isAuthEndpoint && typeof window !== 'undefined') {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
