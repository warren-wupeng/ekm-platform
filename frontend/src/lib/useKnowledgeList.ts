import useSWR from 'swr'
import { MOCK_KNOWLEDGE_LIST } from '@/lib/mockUpload'
import type { KnowledgeItem } from '@/types/upload'

// Simulates an API call; replace with real fetch(url) in production
async function fetchKnowledgeList(): Promise<KnowledgeItem[]> {
  return MOCK_KNOWLEDGE_LIST
}

export function useKnowledgeList() {
  const { data, isLoading, mutate } = useSWR<KnowledgeItem[]>(
    'knowledge/list',
    fetchKnowledgeList,
    {
      // Cache for 60 s; revalidate on focus only if data is stale
      dedupingInterval: 60_000,
      revalidateOnFocus: false,
    }
  )

  function removeItem(id: string) {
    mutate((prev) => prev?.filter((i) => i.id !== id), { revalidate: false })
  }

  return { items: data ?? [], isLoading, removeItem }
}
