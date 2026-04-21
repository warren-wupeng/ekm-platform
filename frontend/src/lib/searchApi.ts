/**
 * Search API client — talks to GET /api/v1/search/items.
 *
 * Backend response shape:
 *   { query, count, hits: [{ id, score, source: {...}, highlight: {...} }] }
 *
 * Frontend SearchResult shape is richer than what the backend currently
 * returns (no author/department/viewCount yet). We map conservatively:
 * missing fields become empty strings / 0 so the existing UI keeps rendering.
 */
import api from './api'
import type { SearchFilters, SearchResult, SortBy, ResultType } from '@/types/search'

interface EsHit {
  id: number
  score: number
  source: {
    id: number
    name: string
    description?: string | null
    file_type?: string | null
    mime_type?: string | null
    uploader_id?: number
    category_id?: number | null
    tags?: string[]
    created_at?: string | null
  }
  highlight?: Record<string, string[]>
}

interface EsResponse {
  query: string
  count: number
  hits: EsHit[]
}

const KNOWN_TYPES: ResultType[] = ['document', 'post', 'file', 'wiki']

function asResultType(v?: string | null): ResultType {
  if (v && (KNOWN_TYPES as string[]).includes(v)) return v as ResultType
  return 'document'
}

function firstHighlight(h?: Record<string, string[]>): string | undefined {
  if (!h) return undefined
  // Prefer description highlights (longer context), fall back to title.
  return h.description?.[0] ?? h.name?.[0]
}

function mapHit(hit: EsHit): SearchResult {
  const src = hit.source
  return {
    id: String(src.id),
    type: asResultType(src.file_type),
    title: src.name,
    snippet: src.description ?? '',
    highlightedSnippet: firstHighlight(hit.highlight),
    url: `/knowledge?doc=${src.id}`,
    author: '',                // backend doesn't return this yet
    department: '',             // ditto
    tags: src.tags ?? [],
    createdAt: src.created_at ?? '',
    updatedAt: src.created_at ?? '',
    viewCount: 0,
    score: hit.score,
  }
}

export interface SearchParams {
  q: string
  filters: SearchFilters
  sort: SortBy
  size?: number
}

export async function searchItems(
  params: SearchParams,
): Promise<{ results: SearchResult[]; total: number }> {
  const { q, filters, sort, size = 20 } = params

  // Send only params the backend understands today; unknown ones are harmless
  // and make the call forward-compatible when /search/items gains more filters.
  const query: Record<string, string | number> = { q, size }
  if (filters.type !== 'all') query.file_type = filters.type
  if (sort !== 'relevance') query.sort = sort
  if (filters.dateRange !== 'all') query.date_range = filters.dateRange
  if (filters.department) query.department = filters.department
  if (filters.tags.length > 0) query.tags = filters.tags.join(',')

  const { data } = await api.get<EsResponse>('/api/v1/search/items', { params: query })
  return {
    results: data.hits.map(mapHit),
    total: data.count,
  }
}

// Lightweight suggestion fallback. Backend doesn't expose a suggest endpoint
// yet, so we derive suggestions from the last search locally.
export async function suggestQuery(q: string): Promise<string[]> {
  if (!q.trim()) return []
  // Placeholder: return the query as a single suggestion so the AutoComplete
  // dropdown stays functional. Wire a real /search/suggest when the backend adds it.
  return [q]
}
