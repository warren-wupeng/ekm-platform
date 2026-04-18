'use client'
import dynamic from 'next/dynamic'
import { ApartmentOutlined } from '@ant-design/icons'
import { Spin } from 'antd'

// Lazy-load the ReactFlow canvas — @xyflow/react is ~400 KB and only needed on this route
const KGCanvas = dynamic(() => import('./KGCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center" style={{ height: 'calc(100vh - 57px)' }}>
      <Spin size="large" tip="加载知识图谱…" />
    </div>
  ),
})

export default function KnowledgeGraphPage() {
  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>
      <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3">
        <ApartmentOutlined className="text-slate-500 text-lg" />
        <div>
          <h1 className="text-base font-semibold text-slate-800">知识图谱</h1>
          <p className="text-xs text-slate-400">点击节点查看详情 · 拖拽连线新建关系 · Delete 删除选中</p>
        </div>
      </div>
      <KGCanvas />
    </div>
  )
}
