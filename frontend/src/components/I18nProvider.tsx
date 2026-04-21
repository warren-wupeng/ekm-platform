'use client'
/**
 * Initialises i18next on the client side.
 *
 * Uses a mounted-gate to prevent SSR/hydration mismatches:
 * - Server renders children with the default 'en' language (no localStorage)
 * - Client renders children only after mount, allowing LanguageDetector to
 *   read localStorage and switch language without triggering a React mismatch.
 */
import '@/i18n'
import { ReactNode, useEffect, useState } from 'react'

export default function I18nProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // On first server render and before client hydration completes,
  // render children with default language ('en') — no translation applied.
  // Once mounted, i18next reads localStorage and switches language if needed.
  if (!mounted) return <>{children}</>

  return <>{children}</>
}
