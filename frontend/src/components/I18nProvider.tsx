'use client'
/**
 * Initialises i18next on the client side and restores the saved language.
 *
 * Hydration-safe flow:
 *   1. i18n/index.ts inits with lng='en' (no detector, no localStorage read)
 *   2. SSR and first client render both produce EN markup — no mismatch
 *   3. useEffect runs after hydration, reads localStorage, calls changeLanguage
 *   4. React re-renders with the saved language
 */
import i18n from '@/i18n'
import { ReactNode, useEffect } from 'react'

const STORAGE_KEY = 'ekm_language'
const SUPPORTED = ['en', 'zh']

export default function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && SUPPORTED.includes(saved) && saved !== i18n.language) {
      void i18n.changeLanguage(saved)
    }
  }, [])

  return <>{children}</>
}
