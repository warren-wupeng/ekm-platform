'use client'
import { useState } from 'react'
import { Avatar, Tag, Button, Input, Space, Modal, Form, Select, message } from 'antd'
import {
  LikeOutlined, LikeFilled, MessageOutlined, FireOutlined,
  PlusOutlined, SearchOutlined, ClockCircleOutlined, TeamOutlined,
} from '@ant-design/icons'

interface Post {
  id: string
  title: string
  content: string
  author: string
  avatar: string
  department: string
  tags: string[]
  likes: number
  comments: number
  likedByMe: boolean
  publishedAt: string
}

const MOCK_POSTS: Post[] = [
  { id: 'p1', title: 'EKM 知识图谱功能上线，实体识别准确率 94%！', content: '经过两个月的开发，知识图谱模块终于完成了 Beta 版本。基于 Neo4j + LLM 的实体抽取 pipeline，对内部文档的实体识别准确率达到 94%，关系抽取准确率 89%。欢迎大家试用并反馈！', author: 'Kira Chen', avatar: '', department: '技术', tags: ['知识图谱', 'Neo4j', 'LLM'], likes: 24, comments: 8, likedByMe: false, publishedAt: '2026-04-17' },
  { id: 'p2', title: '关于「知识库分类体系」的讨论——欢迎大家参与设计', content: '我们目前有 200+ 文档，但分类比较混乱。想邀请大家讨论一个更合理的分类体系。初步想法是：按业务域（产品/技术/运营/法务）+文档类型（PRD/设计/方案/会议纪要）双维度分类。有其他想法吗？', author: 'Warren Wu', avatar: '', department: '产品', tags: ['知识管理', '分类体系', '讨论'], likes: 15, comments: 12, likedByMe: true, publishedAt: '2026-04-16' },
  { id: 'p3', title: 'RAG 召回率优化实践：从 67% 到 91%', content: '分享一下最近 RAG 优化的心得。主要改进点：1) chunk size 从 512 改为 256+overlap；2) 加入 BM25 混合召回；3) reranker 模型过滤。三项合计把 recall@5 从 67% 提升到 91%。', author: 'Kira Chen', avatar: '', department: '技术', tags: ['RAG', 'LLM', '技术分享'], likes: 31, comments: 5, likedByMe: false, publishedAt: '2026-04-15' },
  { id: 'p4', title: '产品周报 #12：本周 EKM 核心功能完成度 78%', content: '本周主要进展：✅ 知识图谱 Beta 上线，✅ 版本历史 Diff 功能完成，🔄 移动端适配进行中，❌ AI 写作助手测试 bug 待修复。下周重点：移动端适配收尾 + 端到端测试。', author: 'Mira Tang', avatar: '', department: '项目', tags: ['周报', '进度'], likes: 9, comments: 3, likedByMe: false, publishedAt: '2026-04-14' },
  { id: 'p5', title: '新人指南：如何高效使用 EKM 平台？', content: '作为 EKM 的第一批用户，整理了一份使用指南。核心技巧：1) 搜索时多用 Tag 筛选；2) 知识图谱可以帮你发现隐性关联；3) AI 摘要功能适合快速浏览长文档；4) 上传文件记得打好 Tag。', author: 'Luca Rossi', avatar: '', department: '市场', tags: ['使用指南', '新人'], likes: 18, comments: 7, likedByMe: false, publishedAt: '2026-04-12' },
]

function getInitials(name: string) { return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) }
const DEPT_COLOR: Record<string, string> = { 技术: 'blue', 产品: 'purple', 项目: 'cyan', 市场: 'orange', '': 'default' }

export default function CommunityPage() {
  const [posts, setPosts] = useState<Post[]>(MOCK_POSTS)
  const [search, setSearch] = useState('')
  const [newPostModal, setNewPostModal] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form] = Form.useForm()

  function toggleLike(id: string) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, likedByMe: !p.likedByMe, likes: p.likedByMe ? p.likes - 1 : p.likes + 1 } : p
      )
    )
  }

  function handleNewPost(values: { title: string; content: string; tags: string[] }) {
    const post: Post = {
      id: `p${Date.now()}`, title: values.title, content: values.content,
      author: 'Warren Wu', avatar: '', department: '产品',
      tags: values.tags ?? [],
      likes: 0, comments: 0, likedByMe: false,
      publishedAt: new Date().toISOString().slice(0, 10),
    }
    setPosts((prev) => [post, ...prev])
    setNewPostModal(false)
    form.resetFields()
    message.success('帖子已发布')
  }

  const filtered = posts.filter((p) =>
    !search || p.title.toLowerCase().includes(search) || p.content.toLowerCase().includes(search) || p.tags.some((t) => t.includes(search))
  )

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <TeamOutlined className="text-slate-500 text-lg" />
            <h1 className="text-lg font-semibold text-slate-800">社区</h1>
          </div>
          <div className="flex items-center gap-2">
            <Input
              size="small" placeholder="搜索帖子…"
              prefix={<SearchOutlined className="text-slate-300 text-xs" />}
              value={search}
              onChange={(e) => setSearch(e.target.value.toLowerCase())}
              allowClear
              className="hidden sm:block"
              style={{ width: 180 }}
            />
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setNewPostModal(true)}>
              <span className="hidden sm:inline">发帖</span>
            </Button>
          </div>
        </div>
        {/* Mobile search */}
        <div className="max-w-3xl mx-auto mt-2 sm:hidden">
          <Input
            size="small" placeholder="搜索帖子…"
            prefix={<SearchOutlined className="text-slate-300 text-xs" />}
            value={search}
            onChange={(e) => setSearch(e.target.value.toLowerCase())}
            allowClear
          />
        </div>
      </div>

      {/* Feed */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-3">
        {filtered.map((post) => {
          const expanded = expandedId === post.id
          return (
            <article key={post.id} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
              {/* Author row */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <Avatar size={36} style={{ background: 'var(--ekm-primary)', fontSize: 13 }}>
                    {getInitials(post.author)}
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-slate-700 leading-tight">{post.author}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Tag color={DEPT_COLOR[post.department]} className="text-[10px] m-0 px-1">{post.department}</Tag>
                      <span className="text-[10px] text-slate-400">
                        <ClockCircleOutlined className="mr-0.5" />{post.publishedAt}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{post.title}</h2>

              {/* Content */}
              <p className={`text-xs text-slate-500 leading-relaxed mb-3 ${expanded ? '' : 'line-clamp-3'}`}>
                {post.content}
              </p>
              {post.content.length > 120 && (
                <button className="text-xs text-primary mb-3" onClick={() => setExpandedId(expanded ? null : post.id)}>
                  {expanded ? '收起' : '查看全文'}
                </button>
              )}

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {post.tags.map((t) => (
                  <Tag key={t} className="text-[10px] m-0 px-1.5 py-0.5 cursor-pointer hover:border-primary hover:text-primary transition-colors">
                    {t}
                  </Tag>
                ))}
              </div>

              {/* Actions */}
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
                    <FireOutlined />热门
                  </span>
                )}
              </div>
            </article>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">没有相关帖子</div>
        )}
      </div>

      {/* New post modal */}
      <Modal title="发布帖子" open={newPostModal} onCancel={() => { setNewPostModal(false); form.resetFields() }} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleNewPost} className="mt-4">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="一句话概括你想分享的内容" maxLength={80} showCount />
          </Form.Item>
          <Form.Item name="content" label="正文" rules={[{ required: true }]}>
            <Input.TextArea rows={5} placeholder="详细描述…" maxLength={1000} showCount />
          </Form.Item>
          <Form.Item name="tags" label="标签（可多选）">
            <Select mode="tags" placeholder="输入标签后按 Enter" tokenSeparators={[',']} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => { setNewPostModal(false); form.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">发布</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
