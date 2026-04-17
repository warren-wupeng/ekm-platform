import type { SearchResult, SearchFilters, SortBy } from '@/types/search'

const MOCK_DATA: SearchResult[] = [
  {
    id: '1', type: 'document',
    title: '2026年Q1产品战略规划文档',
    snippet: '本文档详细阐述了产品在2026年第一季度的核心战略方向，包括知识管理平台的建设路径、用户增长目标以及技术栈选型原则。',
    url: '/knowledge/1', author: '张伟', department: '产品部',
    tags: ['战略', '产品规划', 'Q1'], createdAt: '2026-01-15', updatedAt: '2026-03-20',
    viewCount: 1248, score: 0.95,
  },
  {
    id: '2', type: 'wiki',
    title: 'EKM 知识图谱构建指南',
    snippet: '知识图谱（Knowledge Graph）是一种以图结构存储知识的方式，通过实体和关系将分散的企业知识连接成网络，提升知识的可发现性和关联性。',
    url: '/knowledge/2', author: 'Kira Chen', department: '技术部',
    tags: ['知识图谱', 'KG', '技术文档'], createdAt: '2026-02-08', updatedAt: '2026-04-10',
    viewCount: 892, score: 0.88,
  },
  {
    id: '3', type: 'post',
    title: '关于知识管理系统选型的思考',
    snippet: '在调研了市面上主流的知识管理工具后，我认为自研系统在灵活性和与现有工作流集成方面具有明显优势，特别是结合大语言模型的AI搜索能力。',
    url: '/community/3', author: '李明', department: '运营部',
    tags: ['知识管理', '选型', '思考'], createdAt: '2026-03-22', updatedAt: '2026-03-22',
    viewCount: 456, score: 0.82,
  },
  {
    id: '4', type: 'document',
    title: '企业数据治理规范 v2.0',
    snippet: '本规范明确了企业数据的分类标准、访问权限体系、数据生命周期管理以及合规要求，适用于所有业务系统的数据管理工作。',
    url: '/knowledge/4', author: '王芳', department: '法务合规部',
    tags: ['数据治理', '合规', '规范'], createdAt: '2025-11-30', updatedAt: '2026-01-05',
    viewCount: 2103, score: 0.79,
  },
  {
    id: '5', type: 'file',
    title: '产品原型设计稿_v3.fig',
    snippet: 'Figma 设计文件，包含EKM平台全部页面的UI设计，涵盖知识库、社区、搜索、个人中心等核心模块的交互原型。',
    url: '/knowledge/5', author: '设计团队', department: '设计部',
    tags: ['设计稿', 'Figma', 'UI'], createdAt: '2026-04-01', updatedAt: '2026-04-15',
    viewCount: 334, score: 0.74,
  },
  {
    id: '6', type: 'wiki',
    title: 'FastAPI + Python 后端开发规范',
    snippet: '后端开发团队统一遵循的代码规范，包括项目结构、API设计原则、数据库操作规范、异常处理以及单元测试要求。',
    url: '/knowledge/6', author: 'Raven Li', department: '技术部',
    tags: ['后端', 'FastAPI', '规范'], createdAt: '2026-04-17', updatedAt: '2026-04-17',
    viewCount: 128, score: 0.71,
  },
]

function highlight(text: string, query: string): string {
  if (!query.trim()) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'gi')
  return text.replace(re, '<mark style="background:#fef08a;padding:0 1px;border-radius:2px">$1</mark>')
}

export async function mockSearch(
  query: string,
  filters: SearchFilters,
  sortBy: SortBy
): Promise<{ results: SearchResult[]; total: number }> {
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 300))

  let results = MOCK_DATA.filter((item) => {
    if (filters.type !== 'all' && item.type !== filters.type) return false
    if (filters.department && item.department !== filters.department) return false
    if (query) {
      const q = query.toLowerCase()
      if (
        !item.title.toLowerCase().includes(q) &&
        !item.snippet.toLowerCase().includes(q) &&
        !item.tags.some((t) => t.toLowerCase().includes(q))
      ) return false
    }
    return true
  })

  if (sortBy === 'date') {
    results = results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } else if (sortBy === 'popularity') {
    results = results.sort((a, b) => b.viewCount - a.viewCount)
  } else {
    results = results.sort((a, b) => b.score - a.score)
  }

  // Apply highlight
  results = results.map((r) => ({
    ...r,
    highlightedSnippet: highlight(r.snippet, query),
  }))

  return { results, total: results.length }
}

export async function mockSuggest(query: string): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 150))
  if (!query) return []
  const pool = ['知识管理', '知识图谱', '产品规划', '数据治理', '开发规范', 'FastAPI', 'EKM', '合规', '战略']
  return pool.filter((s) => s.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
}
