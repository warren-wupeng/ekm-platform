'use client'
import { useState, useMemo } from 'react'
import { Avatar, Tag, Button, Input, Spin, Empty } from 'antd'
import {
  LikeOutlined, LikeFilled, MessageOutlined, FireOutlined,
  PlusOutlined, SearchOutlined, ClockCircleOutlined, TeamOutlined,
  TagOutlined,
} from '@ant-design/icons'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { usePosts } from '@/lib/usePosts'

type SortKey = 'latest' | 'hot' | 'comments'

function getInitials(name: string) { return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) }
const DEPT_COLOR: Record<string, string> = { 技术: 'blue', 产品: 'purple', 项目: 'cyan', 市场: 'orange', '': 'default' }

export default function CommunityPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { posts, isLoading, likePost, unlikePost } = usePosts(100)

  const [search, setSearch]         = useState('')
  const [sort, setSort]             = useState<SortKey>('latest')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(5)

  // Derive unique tags from real posts
  const allTags = useMemo(
    () => Array.from(new Set(posts.flatMap((p) => {
      // Try to extract hashtags from the body
      const matches = p.body.match(/#[\w\u4e00-\u9fff]+/g) ?? []
      return matches.map((m) => m.slice(1))
    }))).slice(0, 12),
    [posts],
  )

  async function toggleLike(id: number, likedByMe: boolean) {
    if (likedByMe) {
      await unlikePost(id)
    } else {
      await likePost(id)
    }
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
      (!q || p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)) &&
      (activeTags.size === 0 || [...activeTags].some((tag) => p.body.includes(tag) || p.title.includes(tag)))
    )
    if (sort === 'hot')      return [...base].sort((a, b) => b.like_count - a.like_count)
    if (sort === 'comments') return [...base].sort((a, b) => b.reply_count - a.reply_count)
    return [...base].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
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
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <TagOutlined className="text-slate-400 text-xs" />
              {allTags.slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  onClick={() => { toggleTag(tag); setVisibleCount(5) }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                    activeTags.has(tag)
                      ? 'bg-primary border-primary text-white'
                      : 'border-slate-200 text-slate-500 hover:border-primary hover:text-primary'
                  }`}
                >
                  {tag}
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
          )}
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 space-y-3">
        {isLoading ? (
          <div className="py-16 flex justify-center"><Spin /></div>
        ) : sorted.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('community.no_posts')} className="py-16" />
        ) : visible.map((post) => {
          const expanded = expandedId === post.id
          return (
            <article key={post.id} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              {/* Author row */}
              <div className="flex items-start gap-3 mb-3">
                <Avatar size={36} style={{ background: 'var(--ekm-primary)', fontSize: 13 }}>
                  {getInitials(post.author_name || 'U')}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 leading-tight">{post.author_name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-slate-400">
                      <ClockCircleOutlined className="mr-0.5" />{post.created_at?.slice(0, 10)}
                    </span>
                  </div>
                </div>
              </div>

              <h2 className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{post.title}</h2>

              <p className={`text-xs text-slate-500 leading-relaxed mb-3 ${expanded ? '' : 'line-clamp-3'}`}>
                {post.body}
              </p>
              {post.body.length > 120 && (
                <button className="text-xs text-primary mb-3 hover:opacity-70" onClick={() => setExpandedId(expanded ? null : post.id)}>
                  {expanded ? t('community.collapse') : t('community.expand')}
                </button>
              )}

              <div className="flex items-center gap-4 pt-3 border-t border-slate-50">
                <button
                  className={`flex items-center gap-1.5 text-xs transition-colors ${post.liked_by_me ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}
                  onClick={() => toggleLike(post.id, post.liked_by_me)}
                >
                  {post.liked_by_me ? <LikeFilled /> : <LikeOutlined />}
                  <span>{post.like_count}</span>
                </button>
                <button className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary transition-colors">
                  <MessageOutlined />
                  <span>{post.reply_count}</span>
                </button>
                {post.like_count >= 15 && (
                  <span className="flex items-center gap-1 text-[10px] text-orange-500 ml-auto">
                    <FireOutlined />{t('community.hot_label')}
                  </span>
                )}
              </div>
            </article>
          )
        })}

        {/* Load more */}
        {hasMore && !isLoading && (
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
