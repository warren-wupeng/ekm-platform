import type { Metadata } from 'next'
import './globals.css'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider } from 'antd'
import { antdTheme } from '@/lib/theme'
import I18nProvider from '@/components/I18nProvider'

export const metadata: Metadata = {
  title: 'EKM · Enterprise Knowledge Management',
  description: 'Enterprise Knowledge Management Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <AntdRegistry>
            <ConfigProvider theme={antdTheme}>
              {children}
            </ConfigProvider>
          </AntdRegistry>
        </I18nProvider>
      </body>
    </html>
  )
}
