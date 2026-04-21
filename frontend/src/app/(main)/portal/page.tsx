'use client'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Breadcrumb, Tag, Tabs, Input, Empty, Tooltip, Spin } from 'antd'
import {
  FireOutlined, SearchOutlined, BookOutlined,
  FileTextOutlined, DownloadOutlined, EyeOutlined,
  AppstoreOutlined, UnorderedListOutlined, RightOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import { useRouter } from 'next/navigation'
import { useKnowledgeList } from '@/lib/useKnowledgeList'
import { useCategories, type ApiCategory } from '@/lib/useCategories'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CategoryNode {
  key: string
  label: string
  count: number
  children?: CategoryNode[]
}

const MEDAL: Record<number, string> = { 0: 'text-yellow-500', 1: 'text-slate-400', 2: 'text-orange-600' }

function apiToNode(cat: ApiCategory): CategoryNode {
  return {
    key: String(cat.id),
    label: cat.name,
    count: cat.item_count,
    children: cat.children?.length ? cat.children.map(apiToNode) : undefined,
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PortalPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [search, setSearch]                     = useState('')
  const [sortBy, setSortBy]                     = useState<'downloads'>('downloads')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys]         = useState<Set<string>>(new Set())
  const [breadcrumb, setBreadcrumb]             = useState<{ key: string; label: string }[]>([])
  const [viewMode, setViewMode]                 = useState<'list' | 'grid'>('list')

  const { items, isLoading: docsLoading } = useKnowledgeList()
  const { categories: categoryTree, isLoading: catsLoading } = useCategories(false)

  const categoryNodes: CategoryNode[] = useMemo(
    () => categoryTree.map(apiToNode),
    [categoryTree],
  )

  // Build flat key→node map for quick lookup
  const nodeMap = useMemo(() => {
    const map: Record<string, CategoryNode> = {}
    function traverse(nodes: CategoryNode[], parent?: CategoryNode) {
      for (const n of nodes) {
        map[n.key] = n
        if (n.children) traverse(n.children, n)
      }
    }
    traverse(categoryNodes)
    return map
  }, [categoryNodes])

  const filteredDocs = useMemo(() => {
    const q = search.toLowerCase()
    return items
      .filter((d) =>
        (!q || d.name.toLowerCase().includes(q) || (d.tags ?? []).some((tag) => tag.includes(q))) &&
        (!selectedCategory || true) // category filtering requires backend support
      )
      .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
  }, [items, search, selectedCategory])

  function selectCategory(node: CategoryNode, parent?: CategoryNode) {
    setSelectedCategory(node.key)
    setBreadcrumb(
      parent
        ? [{ key: parent.key, label: parent.label }, { key: node.key, label: node.label }]
        : [{ key: node.key, label: node.label }],
    )
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOutlined className="text-slate-500 text-lg" />
            <h1 className="text-lg font-semibold text-slate-800">{t('portal.page_title')}</h1>
          </div>
          <Input
            size="small" placeholder={t('portal.search_placeholder')}
            prefix={<SearchOutlined className="text-slate-300 text-xs" />}
            value={search}
            onChange={(e) => setSearch(e.target.value.toLowerCase())}
            allowClear
            style={{ width: 200 }}
          />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 flex gap-5">
        {/* Left: Category tree */}
        <aside className="hidden md:block w-52 flex-shrink-0">
          <div className="bg-white rounded-2xl border border-slate-100 p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-2 mb-2">
              {t('portal.category_tree')}
            </p>
            {catsLoading ? (
              <div className="py-4 flex justify-center"><Spin size="small" /></div>
            ) : categoryNodes.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">{t('portal.no_categories')}</p>
            ) : categoryNodes.map((cat) => (
              <div key={cat.key}>
                <button
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-xl text-sm transition-colors ${
                    selectedCategory === cat.key ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => { selectCategory(cat); toggleExpand(cat.key) }}
                >
                  <span className="font-medium truncate">{cat.label}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[10px] ${selectedCategory === cat.key ? 'text-white/70' : 'text-slate-400'}`}>
                      {cat.count}
                    </span>
                    <RightOutlined className={`text-[10px] transition-transform ${expandedKeys.has(cat.key) ? 'rotate-90' : ''} ${selectedCategory === cat.key ? 'text-white/70' : 'text-slate-300'}`} />
                  </div>
                </button>
                {expandedKeys.has(cat.key) && cat.children?.map((child) => (
                  <button
                    key={child.key}
                    className={`w-full flex items-center justify-between px-2 py-1.5 ml-3 rounded-xl text-xs transition-colors ${
                      selectedCategory === child.key ? 'bg-primary/10 text-primary font-medium' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                    onClick={() => selectCategory(child, cat)}
                  >
                    <span className="truncate">{child.label}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{child.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Right: Content */}
        <main className="flex-1 min-w-0 space-y-4">
          {/* Breadcrumb + controls */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Breadcrumb
              items={[
                { title: t('portal.breadcrumb_all'), onClick: () => { setSelectedCategory(null); setBreadcrumb([]) } },
                ...breadcrumb.map((b) => ({ title: b.label })),
              ]}
              className="text-xs"
            />
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                <Tooltip title={t('common.list_view')}>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 text-xs transition-colors ${viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <UnorderedListOutlined />
                  </button>
                </Tooltip>
                <Tooltip title={t('common.grid_view')}>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-1.5 text-xs transition-colors ${viewMode === 'grid' ? 'bg-primary text-white' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <AppstoreOutlined />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          <Tabs
            size="small"
            items={[
              {
                key: 'hot',
                label: <span><FireOutlined className="mr-1 text-orange-500" />{t('portal.hot_top10')}</span>,
                children: docsLoading ? (
                  <div className="py-16 flex justify-center"><Spin /></div>
                ) : filteredDocs.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('portal.no_matching_docs')} className="py-10" />
                ) : (
                  <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-2'}>
                    {filteredDocs.slice(0, 10).map((doc, idx) =>
                      viewMode === 'list' ? (
                        <div
                          key={doc.id}
                          className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors cursor-pointer"
                          onClick={() => router.push(`/knowledge?doc=${doc.id}`)}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${idx < 3 ? 'bg-orange-50' : 'bg-slate-50'}`}>
                            {idx < 3
                              ? <TrophyOutlined className={`text-sm ${MEDAL[idx]}`} />
                              : <span className="text-xs font-bold text-slate-400">{idx + 1}</span>
                            }
                          </div>
                          <FileTextOutlined className="text-primary text-sm flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{doc.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {(doc.tags ?? []).slice(0, 3).map((tag) => (
                                <Tag key={tag} className="text-[10px] m-0 px-1">{tag}</Tag>
                              ))}
                            </div>
                          </div>
                          <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1"><DownloadOutlined />{doc.downloads ?? 0}</span>
                            {idx < 3 && <FireOutlined className="text-orange-400" />}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={doc.id}
                          className="bg-white rounded-2xl border border-slate-100 p-4 hover:border-primary/30 transition-colors cursor-pointer"
                          onClick={() => router.push(`/knowledge?doc=${doc.id}`)}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {idx < 3
                              ? <TrophyOutlined className={`text-sm ${MEDAL[idx]}`} />
                              : <span className="text-xs font-bold text-slate-400 w-4">#{idx + 1}</span>
                            }
                          </div>
                          <p className="text-sm font-medium text-slate-700 line-clamp-2 mb-3">{doc.name}</p>
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="flex items-center gap-1"><EyeOutlined />{doc.downloads ?? 0}</span>
                            {idx < 3 && <FireOutlined className="text-orange-400" />}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ),
              },
            ]}
          />
        </main>
      </div>
    </div>
  )
}
