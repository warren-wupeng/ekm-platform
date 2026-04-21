'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  App, Input, Select, Space, Segmented, Empty, Spin, Tag, Tooltip,
  AutoComplete, Skeleton,
} from 'antd'
import {
  SearchOutlined, FilterOutlined, SortAscendingOutlined,
  FileTextOutlined, MessageOutlined, PaperClipOutlined,
  BookOutlined, CloseOutlined, FireOutlined,
} from '@ant-design/icons'
import { searchItems, suggestQuery } from '@/lib/searchApi'
import ResultCard from '@/components/search/ResultCard'
import type { SearchFilters, SortBy, SearchResult } from '@/types/search'

const DEFAULT_FILTERS: SearchFilters = {
  type: 'all',
  dateRange: 'all',
  department: '',
  tags: [],
}

export default function SearchPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()

  const SORT_OPTIONS = [
    { label: t('search.sort_relevance'), value: 'relevance' },
    { label: t('search.sort_date'), value: 'date' },
    { label: t('search.sort_popularity'), value: 'popularity' },
  ]

  const TYPE_OPTIONS = [
    { label: t('search.type_all'), value: 'all' },
    { label: <span><FileTextOutlined className="mr-1" />{t('search.type_document')}</span>, value: 'document' },
    { label: <span><BookOutlined className="mr-1" />{t('search.type_wiki')}</span>, value: 'wiki' },
    { label: <span><MessageOutlined className="mr-1" />{t('search.type_post')}</span>, value: 'post' },
    { label: <span><PaperClipOutlined className="mr-1" />{t('search.type_file')}</span>, value: 'file' },
  ]
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
      const res = await searchItems({ q, filters: f, sort: s })
      setResults(res.results)
      setTotal(res.total)
    } catch (e) {
      // Degrade gracefully: show empty results + toast the cause.
      setResults([])
      setTotal(0)
      const detail =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ?? (e as Error)?.message ?? t('search.search_failed')
      message.error(`${t('search.search_failed')}：${detail}`)
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
      const s = await suggestQuery(val)
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
              placeholder={t('search.placeholder')}
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
            <Tooltip title={t('search.date_range')}>
              <Select
                value={filters.dateRange}
                onChange={(val) => setFilter('dateRange', val)}
                style={{ width: 130 }}
                size="small"
                options={[
                  { label: t('search.date_all'), value: 'all' },
                  { label: t('search.date_7d'), value: '7d' },
                  { label: t('search.date_30d'), value: '30d' },
                  { label: t('search.date_90d'), value: '90d' },
                  { label: t('search.date_1y'), value: '1y' },
                ]}
                prefix={<FilterOutlined />}
              />
            </Tooltip>

            {/* Sort */}
            <Tooltip title={t('search.sort_label')}>
              <Select
                value={sortBy}
                onChange={(val) => setSortBy(val as SortBy)}
                style={{ width: 110 }}
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
                {t('search.active_filters', { count: activeFilterCount })}
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
            <p className="text-slate-400 text-sm">{t('search.empty_hint')}</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {['知识管理', '产品规划', '数据治理', '开发规范'].map((kw) => (
                <Tag
                  key={kw}
                  icon={<FireOutlined />}
                  color="default"
                  className="cursor-pointer border border-slate-200 hover:border-primary hover:text-primary transition-all text-xs py-1 px-3 rounded-full select-none"
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
          <Space direction="vertical" className="w-full" size={10}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-slate-200 px-5 py-4"
              >
                <Skeleton
                  active
                  title={{ width: '40%' }}
                  paragraph={{ rows: 2, width: ['100%', '80%'] }}
                />
              </div>
            ))}
          </Space>
        )}

        {!loading && hasSearched && (
          <>
            {/* Result stats */}
            {results.length > 0 && (
              <p className="text-slate-400 text-xs mb-3">
                {t('search.results_count', { total })}
                {query && (
                  <span>，{t('search.results_keyword', { query })}</span>
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
                    <p className="text-slate-500 text-sm">{t('search.no_results')}</p>
                    <p className="text-slate-400 text-xs mt-1">
                      {t('search.no_results_hint')}
                      <span
                        className="text-primary cursor-pointer ml-1"
                        onClick={() => setFilters(DEFAULT_FILTERS)}
                      >
                        {t('search.clear_filters')}
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
