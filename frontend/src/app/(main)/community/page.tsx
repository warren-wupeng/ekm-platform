'use client'
import { useState, useMemo } from 'react'
import { Avatar, Tag, Button, Input } from 'antd'
import {
  LikeOutlined, LikeFilled, MessageOutlined, FireOutlined,
  PlusOutlined, SearchOutlined, ClockCircleOutlined, TeamOutlined,
  TagOutlined,
} from '@ant-design/icons'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

interface Post {
  id: string
  title: string
  content: string
  author: string
  department: string
  tags: string[]
  likes: number
  comments: number
  likedByMe: boolean
  publishedAt: string
}

const MOCK_POSTS: Post[] = [
  { id: 'p1', title: 'EKM 知识图谱功能上线，实体识别准确率 94%！', content: '经过两个月的开发，知识图谱模块终于完成了 Beta 版本。基于 Neo4j + LLM 的实体抽取 pipeline，对内部文档的实体识别准确率达到 94%，关系抽取准确率 89%。欢迎大家试用并反馈！', author: 'Kira Chen', department: '技术', tags: ['知识图谱', 'Neo4j', 'LLM'], likes: 24, comments: 8, likedByMe: false, publishedAt: '2026-04-17' },
  { id: 'p2', title: '关于「知识库分类体系」的讨论——欢迎大家参与设计', content: '我们目前有 200+ 文档，但分类比较混乱。想邀请大家讨论一个更合理的分类体系。初步想法是：按业务域（产品/技术/运营/法务）+文档类型（PRD/设计/方案/会议纪要）双维度分类。有其他想法吗？', author: 'Warren Wu', department: '产品', tags: ['知识管理', '分类体系', '讨论'], likes: 15, comments: 12, likedByMe: true, publishedAt: '2026-04-16' },
  { id: 'p3', title: 'RAG 召回率优化实践：从 67% 到 91%', content: '分享一下最近 RAG 优化的心得。主要改进点：1) chunk size 从 512 改为 256+overlap；2) 加入 BM25 混合召回；3) reranker 模型过滤。三项合计把 recall@5 从 67% 提升到 91%。', author: 'Kira Chen', department: '技术', tags: ['RAG', 'LLM', '技术分享'], likes: 31, comments: 5, likedByMe: false, publishedAt: '2026-04-15' },
  { id: 'p4', title: '产品周报 #12：本周 EKM 核心功能完成度 78%', content: '本周主要进展：✅ 知识图谱 Beta 上线，✅ 版本历史 Diff 功能完成，🔄 移动端适配进行中，❌ AI 写作助手测试 bug 待修复。下周重点：移动端适配收尾 + 端到端测试。', author: 'Mira Tang', department: '项目', tags: ['周报', '进度'], likes: 9, comments: 3, likedByMe: false, publishedAt: '2026-04-14' },
  { id: 'p5', title: '新人指南：如何高效使用 EKM 平台？', content: '作为 EKM 的第一批用户，整理了一份使用指南。核心技巧：1) 搜索时多用 Tag 筛选；2) 知识图谱可以帮你发现隐性关联；3) AI 摘要功能适合快速浏览长文档；4) 上传文件记得打好 Tag。', author: 'Luca Rossi', department: '市场', tags: ['使用指南', '新人'], likes: 18, comments: 7, likedByMe: false, publishedAt: '2026-04-12' },
  { id: 'p6', title: 'Developer API 控制台上线 — 欢迎接入测试', content: '刚完成 Developer 控制台开发，现在可以在 /developer 页面调试所有 EKM API。支持自定义请求体、查看响应详情、管理 API Key。有任何接入问题欢迎在这里讨论。', author: 'Kira Chen', department: '技术', tags: ['API', 'Developer', '工具'], likes: 22, comments: 4, likedByMe: false, publishedAt: '2026-04-18' },
  { id: 'p7', title: 'Q2 市场推广计划初稿 — 征求反馈', content: 'Q2 我们计划聚焦三个方向：1) 技术社区内容营销（掘金/少数派）；2) 企业服务赛道精准触达；3) 用户案例故事征集。重点是把 EKM 的真实使用场景讲出来，而不是功能罗列。', author: 'Luca Rossi', department: '市场', tags: ['市场', 'Q2', '讨论'], likes: 11, comments: 9, likedByMe: false, publishedAt: '2026-04-11' },
]

type SortKey = 'latest' | 'hot' | 'comments'

function getInitials(name: string) { return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) }
const DEPT_COLOR: Record<string, string> = { 技术: 'blue', 产品: 'purple', 项目: 'cyan', 市场: 'orange', '': 'default' }
const DEPT_I18N_KEY: Record<string, string> = { 技术: 'community.dept_tech', 产品: 'community.dept_product', 项目: 'community.dept_project', 市场: 'community.dept_marketing' }

const ALL_TAGS = Array.from(new Set(MOCK_POSTS.flatMap((p) => p.tags)))

export default function CommunityPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [posts, setPosts]           = useState<Post[]>(MOCK_POSTS)
  const [search, setSearch]         = useState('')
  const [sort, setSort]             = useState<SortKey>('latest')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(5)

  function toggleLike(id: string) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, likedByMe: !p.likedByMe, likes: p.likedByMe ? p.likes - 1 : p.likes + 1 } : p
      )
    )
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  const sorted = useMemo(() => {
    const q = search.toLowerCase()
    const base = posts.filter((p) =>
      (!q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))) &&
      (activeTags.size === 0 || p.tags.some((t) => activeTags.has(t)))
    )
    if (sort === 'hot')      return [...base].sort((a, b) => b.likes - a.likes)
    if (sort === 'comments') return [...base].sort((a, b) => b.comments - a.comments)
    return [...base].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  }, [posts, search, sort, activeTags])

  const visible = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TeamOutlined className="text-slate-500 text-lg" />
              <h1 className="text-lg font-semibold text-slate-800">{t('community.page_title')}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Input
                size="small" placeholder={t('community.search_placeholder')}
                prefix={<SearchOutlined className="text-slate-300 text-xs" />}
                value={search}
                onChange={(e) => { setSearch(e.target.value.toLowerCase()); setVisibleCount(5) }}
                allowClear
                className="hidden sm:block"
                style={{ width: 180 }}
              />
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => router.push('/community/new')}>
                <span className="hidden sm:inline">{t('community.new_post')}</span>
              </Button>
            </div>
          </div>
          {/* Mobile search */}
          <div className="mt-2 sm:hidden">
            <Input
              size="small" placeholder={t('community.search_placeholder')}
              prefix={<SearchOutlined className="text-slate-300 text-xs" />}
              value={search}
              onChange={(e) => { setSearch(e.target.value.toLowerCase()); setVisibleCount(5) }}
              allowClear
            />
          </div>
        </div>
      </div>

      {/* Sort + tag filter bar */}
      <div className="bg-white border-b border-slate-50 px-4 sm:px-6 py-2.5">
        <div className="max-w-3xl mx-auto flex items-center gap-3 flex-wrap">
          {/* Sort tabs */}
          <div className="flex items-center gap-1">
            {([
              { key: 'latest',   label: t('community.sort_latest') },
              { key: 'hot',      label: t('community.sort_hot') },
              { key: 'comments', label: t('community.sort_comments') },
            ] as { key: SortKey; label: string }[]).map((s) => (
              <button
                key={s.key}
                onClick={() => { setSort(s.key); setVisibleCount(5) }}
                className={`text-xs px-3 py-1.5 rounded-xl transition-colors ${sort === s.key ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {s.key === 'hot' && <FireOutlined className="mr-1 text-orange-400" />}
                {s.label}
              </button>
            ))}
          </div>

          {/* Tag filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <TagOutlined className="text-slate-400 text-xs" />
            {ALL_TAGS.slice(0, 8).map((t) => (
              <button
                key={t}
                onClick={() => { toggleTag(t); setVisibleCount(5) }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  activeTags.has(t)
                    ? 'bg-primary border-primary text-white'
                    : 'border-slate-200 text-slate-500 hover:border-primary hover:text-primary'
                }`}
              >
                {t}
              </button>
            ))}
            {activeTags.size > 0 && (
              <button
                className="text-[10px] text-slate-400 hover:text-red-400 transition-colors"
                onClick={() => setActiveTags(new Set())}
              >
                {t('community.clear_tags')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 space-y-3">
        {visible.map((post) => {
          const expanded = expandedId === post.id
          return (
            <article key={post.id} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              {/* Author row */}
              <div className="flex items-start gap-3 mb-3">
                <Avatar size={36} style={{ background: 'var(--ekm-primary)', fontSize: 13 }}>
                  {getInitials(post.author)}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 leading-tight">{post.author}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Tag color={DEPT_COLOR[post.department]} className="text-[10px] m-0 px-1">{DEPT_I18N_KEY[post.department] ? t(DEPT_I18N_KEY[post.department]) : post.department}</Tag>
                    <span className="text-[10px] text-slate-400">
                      <ClockCircleOutlined className="mr-0.5" />{post.publishedAt}
                    </span>
                  </div>
                </div>
              </div>

              <h2 className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{post.title}</h2>

              <p className={`text-xs text-slate-500 leading-relaxed mb-3 ${expanded ? '' : 'line-clamp-3'}`}>
                {post.content}
              </p>
              {post.content.length > 120 && (
                <button className="text-xs text-primary mb-3 hover:opacity-70" onClick={() => setExpandedId(expanded ? null : post.id)}>
                  {expanded ? t('community.collapse') : t('community.expand')}
                </button>
              )}

              <div className="flex flex-wrap gap-1.5 mb-3">
                {post.tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                      activeTags.has(t)
                        ? 'bg-primary border-primary text-white'
                        : 'border-slate-200 text-slate-500 hover:border-primary hover:text-primary'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-4 pt-3 border-t border-slate-50">
                <button
                  className={`flex items-center gap-1.5 text-xs transition-colors ${post.likedByMe ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}
                  onClick={() => toggleLike(post.id)}
                >
                  {post.likedByMe ? <LikeFilled /> : <LikeOutlined />}
                  <span>{post.likes}</span>
                </button>
                <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary transition-colors">
                  <MessageOutlined />
                  <span>{post.comments}</span>
                </button>
                {post.likes >= 15 && (
                  <span className="flex items-center gap-1 text-[10px] text-orange-500 ml-auto">
                    <FireOutlined />{t('community.hot_label')}
                  </span>
                )}
              </div>
            </article>
          )
        })}

        {sorted.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">{t('community.no_posts')}</div>
        )}

        {/* Load more */}
        {hasMore && (
          <div className="text-center pt-2">
            <Button
              onClick={() => setVisibleCount((v) => v + 5)}
              className="text-slate-500"
            >
              {t('community.load_more', { count: sorted.length - visibleCount })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
