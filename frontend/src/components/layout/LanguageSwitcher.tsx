'use client'
import { useTranslation } from 'react-i18next'
import { Dropdown, Button } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'

const LANGS = [
  { key: 'en', label: 'English' },
  { key: 'zh', label: '中文' },
]

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()

  const current = LANGS.find(l => l.key === i18n.language) ?? LANGS[0]

  const items: MenuProps['items'] = LANGS.map(l => ({
    key: l.key,
    label: l.label,
  }))

  function handleChange({ key }: { key: string }) {
    i18n.changeLanguage(key)
    localStorage.setItem('ekm_language', key)
  }

  return (
    <Dropdown menu={{ items, onClick: handleChange, selectedKeys: [current.key] }} trigger={['click']}>
      <Button
        type="text"
        size="small"
        icon={<GlobalOutlined />}
        className="text-slate-500 hover:text-slate-700 flex items-center gap-1"
      >
        {current.label}
      </Button>
    </Dropdown>
  )
}
