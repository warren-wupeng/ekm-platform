/**
 * EKM Design Tokens — Single Source of Truth
 *
 * To rebrand (e.g. switch to Lenovo Red):
 *   1. Change PRIMARY below
 *   2. Run `npm run build` — done.
 *
 * Tailwind: use bg-primary / text-primary / border-primary
 * Inline styles: use var(--ekm-primary) CSS variable
 * Ant Design: ConfigProvider reads antdTheme.token.colorPrimary
 */

export const PRIMARY = '#2563eb'          // ← only line that needs to change for rebrand

// Sidebar stays dark regardless of brand color
export const SIDEBAR_BG    = '#0f172a'
export const SIDEBAR_HOVER = '#1e293b'

// Semantic type colors (not tied to brand)
export const TYPE_COLORS = {
  document: PRIMARY,
  post:     '#059669',   // green
  file:     '#d97706',   // amber
  wiki:     '#7c3aed',   // purple
} as const

// Ant Design ConfigProvider theme
export const antdTheme = {
  token: {
    colorPrimary:       PRIMARY,
    colorLink:          PRIMARY,
    borderRadius:       8,
    borderRadiusLG:     12,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
  },
}
