import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('ekm_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('ekm_token')
      localStorage.removeItem('ekm_refresh_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
