import type { Metadata } from 'next'
import './globals.css'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import I18nProvider from '@/components/I18nProvider'
import AntdLocaleProvider from '@/components/AntdLocaleProvider'

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
            <AntdLocaleProvider>
              {children}
            </AntdLocaleProvider>
          </AntdRegistry>
        </I18nProvider>
      </body>
    </html>
  )
}
