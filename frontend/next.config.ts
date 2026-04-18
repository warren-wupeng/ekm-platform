import type { NextConfig } from 'next'

// BACKEND_URL is a server-side runtime env — not exposed to the browser.
// Set it in fly.toml or docker-compose as BACKEND_URL=https://ekm-backend.fly.dev
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

const nextConfig: NextConfig = {
  output: 'standalone',

  // Proxy /api/v1/* to the backend at runtime (server-side rewrite).
  // This avoids baking the backend URL into the client bundle and works
  // correctly even when BACKEND_URL changes between environments.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${BACKEND_URL}/api/v1/:path*`,
      },
    ]
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
