export type ResultType = 'document' | 'post' | 'file' | 'wiki'

export interface SearchResult {
  id: string
  type: ResultType
  title: string
  snippet: string        // raw text, may contain matched keyword
  highlightedSnippet?: string  // HTML with <mark> tags
  url: string
  author: string
  department: string
  tags: string[]
  createdAt: string
  updatedAt: string
  viewCount: number
  score: number          // relevance score 0-1
}

export interface SearchFilters {
  type: ResultType | 'all'
  dateRange: 'all' | '7d' | '30d' | '90d' | '1y'
  department: string
  tags: string[]
}

export type SortBy = 'relevance' | 'date' | 'popularity'

export interface SearchState {
  query: string
  filters: SearchFilters
  sortBy: SortBy
  results: SearchResult[]
  total: number
  isLoading: boolean
  hasSearched: boolean
}
