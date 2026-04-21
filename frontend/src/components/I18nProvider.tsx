'use client'
/**
 * Initialises i18next on the client side.
 * Must be a Client Component because i18next uses browser APIs
 * (localStorage, navigator.language).
 */
import '@/i18n'
import { ReactNode } from 'react'

export default function I18nProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
