'use client'
/**
 * Syncs Ant Design's ConfigProvider locale with the active i18next language.
 * Switches between enUS and zhCN as the user changes language.
 */
import { ReactNode } from 'react'
import { ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { useTranslation } from 'react-i18next'
import { antdTheme } from '@/lib/theme'

export default function AntdLocaleProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith('zh') ? zhCN : enUS

  return (
    <ConfigProvider theme={antdTheme} locale={locale}>
      {children}
    </ConfigProvider>
  )
}
