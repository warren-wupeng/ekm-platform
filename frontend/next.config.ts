import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',

  // Allow backend API URL to be injected at runtime
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000',
  },

  experimental: {
    // Tree-shake icon sub-packages at build time — cuts antd/icons bundle by ~60%
    optimizePackageImports: ['@ant-design/icons', 'antd'],
  },

  // Image optimization — lazy loading and modern formats by default in Next.js
  images: {
    formats: ['image/avif', 'image/webp'],
  },
}

// Run `ANALYZE=true npm run build` to generate bundle analysis reports
// Requires: npm install -D @next/bundle-analyzer
// const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: process.env.ANALYZE === 'true' })
// export default withBundleAnalyzer(nextConfig)

export default nextConfig
