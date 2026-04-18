'use client'
import { Tag, Space } from 'antd'
import {
  FileTextOutlined, MessageOutlined, PaperClipOutlined, BookOutlined,
  EyeOutlined, ClockCircleOutlined, UserOutlined,
} from '@ant-design/icons'
import type { SearchResult, ResultType } from '@/types/search'
import { TYPE_COLORS } from '@/lib/theme'

const TYPE_META: Record<ResultType, { icon: React.ReactNode; label: string }> = {
  document: { icon: <FileTextOutlined />, label: '文档' },
  post:     { icon: <MessageOutlined />,  label: '帖子' },
  file:     { icon: <PaperClipOutlined />, label: '文件' },
  wiki:     { icon: <BookOutlined />,     label: 'Wiki' },
}

interface Props {
  result: SearchResult
  query: string
}

export default function ResultCard({ result }: Props) {
  const meta  = TYPE_META[result.type]
  const color = TYPE_COLORS[result.type]

  return (
    <div
      className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
      onClick={() => window.open(result.url, '_blank')}
    >
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <span
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm mt-0.5"
          style={{ background: color + '18', color }}
        >
          {meta.icon}
        </span>

        <div className="flex-1 min-w-0">
          {/* Type badge + department */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{ background: color + '18', color }}
            >
              {meta.label}
            </span>
            <span className="text-slate-400 text-xs">{result.department}</span>
          </div>

          {/* Title */}
          <h3 className="text-slate-800 font-medium text-sm leading-snug group-hover:text-primary transition-colors line-clamp-1 mb-1.5">
            {result.title}
          </h3>

          {/* Snippet with keyword highlight */}
          <p
            className="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-2"
            dangerouslySetInnerHTML={{ __html: result.highlightedSnippet ?? result.snippet }}
          />

          {/* Tags + meta */}
          <div className="flex items-center justify-between">
            <Space size={6}>
              {result.tags.slice(0, 3).map((tag) => (
                <Tag key={tag} className="text-xs m-0">{tag}</Tag>
              ))}
            </Space>
            <Space size={10} className="text-slate-400 text-xs flex-shrink-0">
              <span><UserOutlined className="mr-0.5" />{result.author}</span>
              <span><EyeOutlined className="mr-0.5" />{result.viewCount}</span>
              <span><ClockCircleOutlined className="mr-0.5" />{result.updatedAt}</span>
            </Space>
          </div>
        </div>
      </div>
    </div>
  )
}
