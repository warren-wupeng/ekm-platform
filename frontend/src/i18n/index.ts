import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import zh from './locales/zh.json'

// No LanguageDetector — we read localStorage manually in I18nProvider's
// useEffect to avoid SSR/hydration mismatches.  SSR and first client render
// both use 'en'; after mount we changeLanguage to the saved preference.
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en', 'zh'],
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  interpolation: {
    escapeValue: false, // React already escapes
  },
})

export default i18n
