import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',

  // /api/v1/* is handled by src/app/api/v1/[...path]/route.ts (runtime proxy).
  // BACKEND_URL env var is read there at request time, not baked in at build.

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
