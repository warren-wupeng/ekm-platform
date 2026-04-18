'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Input, Select, Space, Segmented, Empty, Spin, Tag, Tooltip,
  AutoComplete,
} from 'antd'
import {
  SearchOutlined, FilterOutlined, SortAscendingOutlined,
  FileTextOutlined, MessageOutlined, PaperClipOutlined,
  BookOutlined, CloseOutlined,
} from '@ant-design/icons'
import { mockSearch, mockSuggest } from '@/lib/mockSearch'
import ResultCard from '@/components/search/ResultCard'
import type { SearchFilters, SortBy, SearchResult } from '@/types/search'

const SORT_OPTIONS = [
  { label: '相关度', value: 'relevance' },
  { label: '最新', value: 'date' },
  { label: '最热', value: 'popularity' },
]

const TYPE_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: <span><FileTextOutlined className="mr-1" />文档</span>, value: 'document' },
  { label: <span><BookOutlined className="mr-1" />Wiki</span>, value: 'wiki' },
  { label: <span><MessageOutlined className="mr-1" />帖子</span>, value: 'post' },
  { label: <span><PaperClipOutlined className="mr-1" />文件</span>, value: 'file' },
]

const DEFAULT_FILTERS: SearchFilters = {
  type: 'all',
  dateRange: 'all',
  department: '',
  tags: [],
}

export default function SearchPage() {
  const [query, setQuery]         = useState('')
  const [inputVal, setInputVal]   = useState('')
  const [filters, setFilters]     = useState<SearchFilters>(DEFAULT_FILTERS)
  const [sortBy, setSortBy]       = useState<SortBy>('relevance')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [suggestions, setSuggestions] = useState<{ value: string }[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string, f: SearchFilters, s: SortBy) => {
    if (!q.trim()) return
    setLoading(true)
    setHasSearched(true)
    try {
      const res = await mockSearch(q, f, s)
      setResults(res.results)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-search when filters/sort change
  useEffect(() => {
    if (hasSearched && query) {
      doSearch(query, filters, sortBy)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy])

  function handleSearch(val: string) {
    const q = val.trim()
    setQuery(q)
    if (q) doSearch(q, filters, sortBy)
  }

  function handleInputChange(val: string) {
    setInputVal(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const s = await mockSuggest(val)
      setSuggestions(s.map((v) => ({ value: v })))
    }, 200)
  }

  function clearSearch() {
    setInputVal('')
    setQuery('')
    setResults([])
    setHasSearched(false)
    setSuggestions([])
  }

  function setFilter<K extends keyof SearchFilters>(key: K, val: SearchFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: val }))
  }

  const activeFilterCount = [
    filters.type !== 'all',
    filters.dateRange !== 'all',
    !!filters.department,
    filters.tags.length > 0,
  ].filter(Boolean).length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top search bar */}
      <div
        className="sticky top-0 z-20 border-b border-slate-200"
        style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)' }}
      >
        <div className="max-w-4xl mx-auto px-6 py-4">
          <AutoComplete
            value={inputVal}
            options={suggestions}
            onSelect={handleSearch}
            onChange={handleInputChange}
            style={{ width: '100%' }}
          >
            <Input
              size="large"
              placeholder="搜索知识库、文档、帖子…"
              prefix={<SearchOutlined className="text-slate-400 text-base" />}
              suffix={
                inputVal ? (
                  <CloseOutlined
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    onClick={clearSearch}
                  />
                ) : null
              }
              onPressEnter={(e) => handleSearch((e.target as HTMLInputElement).value)}
              className="rounded-xl shadow-sm"
              style={{ fontSize: 15 }}
            />
          </AutoComplete>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-5">
        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {/* Type segmented */}
          <Segmented
            options={TYPE_OPTIONS}
            value={filters.type}
            onChange={(val) => setFilter('type', val as SearchFilters['type'])}
            className="bg-white border border-slate-200 rounded-lg"
          />

          <div className="flex items-center gap-2 ml-auto">
            {/* Date range */}
            <Tooltip title="时间范围">
              <Select
                value={filters.dateRange}
                onChange={(val) => setFilter('dateRange', val)}
                style={{ width: 100 }}
                size="small"
                options={[
                  { label: '不限时间', value: 'all' },
                  { label: '近 7 天', value: '7d' },
                  { label: '近 30 天', value: '30d' },
                  { label: '近 90 天', value: '90d' },
                  { label: '近 1 年', value: '1y' },
                ]}
                prefix={<FilterOutlined />}
              />
            </Tooltip>

            {/* Sort */}
            <Tooltip title="排序方式">
              <Select
                value={sortBy}
                onChange={(val) => setSortBy(val as SortBy)}
                style={{ width: 90 }}
                size="small"
                options={SORT_OPTIONS}
                prefix={<SortAscendingOutlined />}
              />
            </Tooltip>

            {/* Active filter badges */}
            {activeFilterCount > 0 && (
              <Tag
                color="geekblue"
                closable
                onClose={() => setFilters(DEFAULT_FILTERS)}
                className="text-xs"
              >
                {activeFilterCount} 个筛选
              </Tag>
            )}
          </div>
        </div>

        {/* Results */}
        {!hasSearched && (
          <div className="text-center py-20">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: 'var(--ekm-primary-light)' }}
            >
              <SearchOutlined className="text-primary text-2xl" />
            </div>
            <p className="text-slate-400 text-sm">输入关键词搜索知识库、文档、社区帖子</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {['知识管理', '产品规划', '数据治理', '开发规范'].map((kw) => (
                <Tag
                  key={kw}
                  className="cursor-pointer hover:bg-primary/10 transition-colors text-xs py-1 px-2"
                  onClick={() => {
                    setInputVal(kw)
                    handleSearch(kw)
                  }}
                >
                  {kw}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Spin size="large" tip="搜索中…" />
          </div>
        )}

        {!loading && hasSearched && (
          <>
            {/* Result stats */}
            {results.length > 0 && (
              <p className="text-slate-400 text-xs mb-3">
                找到 <span className="text-slate-700 font-medium">{total}</span> 条结果
                {query && (
                  <span>，关键词：<span className="text-primary font-medium">"{query}"</span></span>
                )}
              </p>
            )}

            {/* Result list */}
            {results.length > 0 ? (
              <Space direction="vertical" className="w-full" size={8}>
                {results.map((r) => (
                  <ResultCard key={r.id} result={r} query={query} />
                ))}
              </Space>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div className="text-center">
                    <p className="text-slate-500 text-sm">没有找到相关结果</p>
                    <p className="text-slate-400 text-xs mt-1">
                      试试换个关键词，或者
                      <span
                        className="text-primary cursor-pointer ml-1"
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                      >
                        清除筛选条件
                      </span>
                    </p>
                  </div>
                }
                className="py-16"
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
