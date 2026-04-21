'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Breadcrumb, Tag, Tabs, Input, Empty, Tooltip } from 'antd'
import {
  FireOutlined, SearchOutlined, BookOutlined,
  FileTextOutlined, DownloadOutlined, EyeOutlined,
  AppstoreOutlined, UnorderedListOutlined, RightOutlined,
  TrophyOutlined,
} from '@ant-design/icons'

// ── Mock data ─────────────────────────────────────────────────────────────────

interface DocEntry {
  id: string
  name: string
  department: string
  tags: string[]
  views: number
  downloads: number
  likes: number
  date: string
}

const TOP_DOCS: DocEntry[] = [
  { id: 't1', name: 'EKM 使用指南 2026 版',           department: '产品', tags: ['指南', '新人'], views: 312, downloads: 88, likes: 31, date: '2026-04-10' },
  { id: 't2', name: '技术架构设计 v5.docx',             department: '技术', tags: ['架构', '技术'], views: 278, downloads: 54, likes: 24, date: '2026-04-16' },
  { id: 't3', name: 'RAG Pipeline 优化实验记录',        department: '技术', tags: ['RAG', 'AI'],    views: 241, downloads: 42, likes: 31, date: '2026-04-15' },
  { id: 't4', name: '产品路线图 Q2 2026',               department: '产品', tags: ['路线图'],       views: 198, downloads: 37, likes: 19, date: '2026-04-12' },
  { id: 't5', name: '前端组件库设计规范',               department: '技术', tags: ['前端', '规范'], views: 175, downloads: 31, likes: 15, date: '2026-04-08' },
  { id: 't6', name: '市场推广策略 2026 H1',             department: '市场', tags: ['市场', '策略'], views: 162, downloads: 28, likes: 14, date: '2026-04-11' },
  { id: 't7', name: '新员工入职手册',                   department: 'HR',   tags: ['HR', '入职'],   views: 154, downloads: 72, likes: 18, date: '2026-03-20' },
  { id: 't8', name: 'API 设计规范 v2.md',              department: '技术', tags: ['API', '规范'],  views: 148, downloads: 31, likes: 12, date: '2026-03-28' },
  { id: 't9', name: '年度财务报告 2025',                department: '财务', tags: ['财务'],         views: 137, downloads: 24, likes: 9,  date: '2026-02-15' },
  { id: 't10', name: 'EKM 知识图谱产品说明',            department: '产品', tags: ['图谱', 'KG'],  views: 125, downloads: 19, likes: 13, date: '2026-04-17' },
]

interface CategoryNode {
  key: string
  label: string
  count: number
  children?: CategoryNode[]
}

const CATEGORY_TREE: CategoryNode[] = [
  {
    key: 'tech', label: '技术', count: 84,
    children: [
      { key: 'tech-arch',     label: '架构设计',   count: 22 },
      { key: 'tech-backend',  label: '后端开发',   count: 19 },
      { key: 'tech-frontend', label: '前端开发',   count: 17 },
      { key: 'tech-ai',       label: 'AI / ML',   count: 26 },
    ],
  },
  {
    key: 'product', label: '产品', count: 63,
    children: [
      { key: 'product-prd',    label: 'PRD / 需求', count: 24 },
      { key: 'product-design', label: '设计稿',     count: 18 },
      { key: 'product-roadmap',label: '路线图',     count: 21 },
    ],
  },
  {
    key: 'ops', label: '运营 & 市场', count: 45,
    children: [
      { key: 'ops-market',  label: '市场活动', count: 21 },
      { key: 'ops-content', label: '内容运营', count: 24 },
    ],
  },
  {
    key: 'hr', label: 'HR & 行政', count: 31,
    children: [
      { key: 'hr-onboard', label: '入职材料', count: 12 },
      { key: 'hr-policy',  label: '制度规范', count: 19 },
    ],
  },
  {
    key: 'finance', label: '财务 & 法务', count: 24,
    children: [
      { key: 'finance-report',  label: '财务报告', count: 14 },
      { key: 'finance-legal',   label: '法律文件', count: 10 },
    ],
  },
]

const DEPT_COLOR: Record<string, string> = {
  技术: 'blue', 产品: 'purple', 市场: 'orange', HR: 'cyan', 财务: 'gold', 运营: 'green',
}

const MEDAL: Record<number, string> = { 0: 'text-yellow-500', 1: 'text-slate-400', 2: 'text-orange-600' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortalPage() {
  const { t } = useTranslation()
  const [search, setSearch]                   = useState('')
  const [sortBy, setSortBy]                   = useState<'views' | 'downloads' | 'likes'>('views')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys]       = useState<Set<string>>(new Set(['tech', 'product']))
  const [breadcrumb, setBreadcrumb]           = useState<{ key: string; label: string }[]>([])
  const [viewMode, setViewMode]               = useState<'list' | 'grid'>('list')

  const filteredDocs = TOP_DOCS
    .filter((d) => !search || d.name.toLowerCase().includes(search) || d.tags.some((t) => t.includes(search)) || d.department.includes(search))
    .sort((a, b) => b[sortBy] - a[sortBy])

  function selectCategory(node: CategoryNode, parent?: CategoryNode) {
    setSelectedCategory(node.key)
    setBreadcrumb(parent ? [{ key: parent.key, label: parent.label }, { key: node.key, label: node.label }] : [{ key: node.key, label: node.label }])
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
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-2 mb-2">{t('portal.category_tree')}</p>
            {CATEGORY_TREE.map((cat) => (
              <div key={cat.key}>
                <button
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-xl text-sm transition-colors ${
                    selectedCategory === cat.key ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => { selectCategory(cat); toggleExpand(cat.key) }}
                >
                  <span className="font-medium truncate">{cat.label}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`text-[10px] ${selectedCategory === cat.key ? 'text-white/70' : 'text-slate-400'}`}>{cat.count}</span>
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
              <span className="text-xs text-slate-400">{t('search.sort_label')}：</span>
              {(['views', 'downloads', 'likes'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`text-xs px-2 py-1 rounded-lg transition-colors ${sortBy === s ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                >
                  {s === 'views' ? t('portal.sort_views') : s === 'downloads' ? t('portal.sort_downloads') : t('portal.sort_likes')}
                </button>
              ))}
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

          {/* Hot list tab */}
          <Tabs
            size="small"
            items={[
              {
                key: 'hot',
                label: <span><FireOutlined className="mr-1 text-orange-500" />{t('portal.hot_top10')}</span>,
                children: (
                  <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-2'}>
                    {filteredDocs.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('portal.no_matching_docs')} className="py-10" />
                    ) : filteredDocs.map((doc, idx) => (
                      viewMode === 'list' ? (
                        <div key={doc.id} className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors cursor-pointer">
                          {/* Rank badge */}
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
                              <Tag color={DEPT_COLOR[doc.department] ?? 'default'} className="text-[10px] m-0 px-1">{doc.department}</Tag>
                              {doc.tags.slice(0, 2).map((t) => (
                                <Tag key={t} className="text-[10px] m-0 px-1">{t}</Tag>
                              ))}
                            </div>
                          </div>

                          <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-[10px] text-slate-400">
                            <span className="flex items-center gap-1"><EyeOutlined />{doc.views}</span>
                            <span className="flex items-center gap-1"><DownloadOutlined />{doc.downloads}</span>
                            {idx < 3 && <FireOutlined className="text-orange-400" />}
                          </div>
                        </div>
                      ) : (
                        <div key={doc.id} className="bg-white rounded-2xl border border-slate-100 p-4 hover:border-primary/30 transition-colors cursor-pointer">
                          <div className="flex items-center gap-2 mb-2">
                            {idx < 3
                              ? <TrophyOutlined className={`text-sm ${MEDAL[idx]}`} />
                              : <span className="text-xs font-bold text-slate-400 w-4">#{idx + 1}</span>
                            }
                            <Tag color={DEPT_COLOR[doc.department] ?? 'default'} className="text-[10px] m-0 px-1">{doc.department}</Tag>
                          </div>
                          <p className="text-sm font-medium text-slate-700 line-clamp-2 mb-3">{doc.name}</p>
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="flex items-center gap-1"><EyeOutlined />{doc.views}</span>
                            <span className="flex items-center gap-1"><DownloadOutlined />{doc.downloads}</span>
                            {idx < 3 && <FireOutlined className="text-orange-400" />}
                          </div>
                        </div>
                      )
                    ))}
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
