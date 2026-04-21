import useSWR, { mutate as globalMutate } from 'swr'
import api from '@/lib/api'

export interface ApiNotification {
  id: number
  type: string
  title: string | null
  payload: Record<string, unknown>
  read: boolean
  created_at: string | null
}

async function fetchNotifications(): Promise<ApiNotification[]> {
  const res = await api.get('/api/v1/notifications', { params: { page_size: 50 } })
  return res.data.notifications
}

export function useNotifications() {
  const { data, isLoading, mutate } = useSWR<ApiNotification[]>(
    'notifications/list',
    fetchNotifications,
    { dedupingInterval: 30_000, revalidateOnFocus: true },
  )

  async function markRead(id: number) {
    await api.put(`/api/v1/notifications/${id}/read`)
    mutate((prev) => prev?.map((n) => n.id === id ? { ...n, read: true } : n), { revalidate: false })
  }

  async function markAllRead() {
    await api.put('/api/v1/notifications/read-all')
    mutate((prev) => prev?.map((n) => ({ ...n, read: true })), { revalidate: false })
  }

  const items = data ?? []
  const unreadCount = items.filter((n) => !n.read).length

  return { items, isLoading, unreadCount, markRead, markAllRead, mutate }
}
