/**
 * Mock API responses for frontend development before backend is ready.
 * Replace these with real API calls once backend endpoints are live.
 */

import type { User, LoginResponse } from '@/types/auth'

const MOCK_USER: User = {
  id: 'u_001',
  username: 'warren.wu',
  email: 'warren@company.com',
  displayName: 'Warren Wu',
  avatar: undefined,
  department: '产品部',
  roles: ['admin'],
}

export function mockLogin(username: string, _password: string): Promise<LoginResponse> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (username) {
        resolve({
          access_token: 'mock_token_' + Date.now(),
          refresh_token: 'mock_refresh_' + Date.now(),
          token_type: 'bearer',
          user: MOCK_USER,
        })
      } else {
        reject(new Error('用户名不能为空'))
      }
    }, 800)
  })
}

export function mockSSORedirect(): string {
  // In real app, this returns Keycloak SSO URL
  return '/api/auth/sso/redirect'
}
