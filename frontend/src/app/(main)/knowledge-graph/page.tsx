'use client'
import dynamic from 'next/dynamic'
import { ApartmentOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import i18next from 'i18next'

// Lazy-load the ReactFlow canvas — @xyflow/react is ~400 KB and only needed on this route
const KGCanvas = dynamic(() => import('./KGCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <Spin size="large" tip={i18next.t('kg.loading')} />
    </div>
  ),
})

export default function KnowledgeGraphPage() {
  const { t } = useTranslation()
  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-slate-100 px-4 md:px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <ApartmentOutlined className="text-slate-500 text-lg" />
        <div>
          <h1 className="text-base font-semibold text-slate-800">{t('kg.page_title')}</h1>
          <p className="text-xs text-slate-400 hidden sm:block">{t('kg.usage_hint')}</p>
        </div>
      </div>
      <KGCanvas />
    </div>
  )
}
