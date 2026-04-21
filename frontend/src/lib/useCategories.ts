import useSWR from 'swr'
import api from '@/lib/api'

export interface ApiCategory {
  id: number
  name: string
  slug: string
  parent_id: number | null
  description: string | null
  sort_order: number
  item_count: number
  children: ApiCategory[]
}

async function fetchCategories(): Promise<ApiCategory[]> {
  const res = await api.get('/api/v1/categories')
  return res.data.categories
}

async function fetchCategoriesFlat(): Promise<ApiCategory[]> {
  const res = await api.get('/api/v1/categories', { params: { flat: true } })
  return res.data.categories
}

export function useCategories(flat = false) {
  const key = flat ? 'categories/flat' : 'categories/tree'
  const { data, isLoading, mutate } = useSWR<ApiCategory[]>(
    key,
    flat ? fetchCategoriesFlat : fetchCategories,
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  )

  return { categories: data ?? [], isLoading, mutate }
}
