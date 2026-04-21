import useSWR from 'swr'
import api from '@/lib/api'
import type { KnowledgeItem } from '@/types/upload'

async function fetchKnowledgeList(): Promise<KnowledgeItem[]> {
  const res = await api.get('/api/v1/knowledge/items', {
    params: { page_size: 100 },
  })
  return res.data.items
}

export function useKnowledgeList() {
  const { data, isLoading, mutate } = useSWR<KnowledgeItem[]>(
    'knowledge/list',
    fetchKnowledgeList,
    {
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
    }
  )

  function removeItem(id: string) {
    mutate((prev) => prev?.filter((i) => String(i.id) !== id), { revalidate: false })
  }

  /** Called after a new upload + parse finishes so the freshly indexed
   * file appears in the list without requiring a manual refresh. */
  function refresh() {
    void mutate()
  }

  return { items: data ?? [], isLoading, removeItem, refresh }
}
