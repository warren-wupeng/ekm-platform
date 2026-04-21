'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Divider, message } from 'antd'
import {
  UserOutlined, LockOutlined, ApartmentOutlined,
  ReadOutlined, TeamOutlined, BranchesOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/auth'
import LanguageSwitcher from '@/components/layout/LanguageSwitcher'
import type { User } from '@/types/auth'
import api from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const { setAuth } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [form] = Form.useForm()

  const FEATURES = [
    {
      icon: <ReadOutlined className="text-xl" />,
      title: t('login.feature_knowledge'),
      desc: t('login.feature_knowledge_desc'),
    },
    {
      icon: <BranchesOutlined className="text-xl" />,
      title: t('login.feature_graph'),
      desc: t('login.feature_graph_desc'),
    },
    {
      icon: <TeamOutlined className="text-xl" />,
      title: t('login.feature_community'),
      desc: t('login.feature_community_desc'),
    },
  ]

  async function handleLogin(values: { username: string; password: string }) {
    setLoading(true)
    try {
      const loginRes = await api.post('/api/v1/auth/login', values)
      const { access_token, refresh_token } = loginRes.data
      const meRes = await api.get('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      const raw = meRes.data
      const user: User = {
        id: String(raw.id),
        username: raw.username,
        email: raw.email,
        displayName: raw.display_name,
        avatar: raw.avatar_url ?? undefined,
        department: raw.department ?? undefined,
        roles: [raw.role],
      }
      setAuth(user, access_token, refresh_token)
      message.success(t('common.success'))
      router.replace('/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: { message?: string } | string } } }
      const detail = axiosErr?.response?.data?.detail
      const msg = (typeof detail === 'object' ? detail?.message : detail) ?? t('common.error')
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleSSO() {
    setSsoLoading(true)
    message.info(t('login.sso_button'))
    setSsoLoading(false)
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left: brand panel ── */}
      <div
        className="hidden md:flex md:w-1/2 flex-col justify-between px-12 py-12 relative overflow-hidden"
        style={{ background: 'var(--ekm-sidebar-bg, #0f172a)' }}
      >
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px),' +
              'linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        {/* Accent glow */}
        <div
          className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--ekm-primary, #7c3aed), transparent 70%)' }}
        />

        {/* Logo + tagline */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-10">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--ekm-primary, #7c3aed)' }}
            >
              <ApartmentOutlined className="text-white text-lg" />
            </div>
            <span className="text-white text-xl font-semibold tracking-tight">EKM</span>
          </div>

          <h1 className="text-white text-3xl font-bold leading-snug mb-3">
            {t('login.title')}
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
            {t('login.subtitle')}
          </p>
        </div>

        {/* Feature highlights */}
        <div className="relative z-10 space-y-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-4">
              <div
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(124,58,237,0.18)', color: 'var(--ekm-primary, #a78bfa)' }}
              >
                {f.icon}
              </div>
              <div>
                <p className="text-white text-sm font-medium">{f.title}</p>
                <p className="text-slate-400 text-xs mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="relative z-10 text-slate-600 text-xs">© 2026 EKM</p>
      </div>

      {/* ── Right: form panel ── */}
      <div className="flex-1 flex items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo (only < md) */}
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--ekm-primary, #7c3aed)' }}
            >
              <ApartmentOutlined className="text-white text-sm" />
            </div>
            <span className="text-slate-800 text-lg font-semibold flex-1">EKM</span>
            <LanguageSwitcher />
          </div>

          {/* Desktop language switcher */}
          <div className="hidden md:flex justify-end mb-4">
            <LanguageSwitcher />
          </div>

          <h2 className="text-slate-800 text-2xl font-semibold mb-1">{t('login.title')}</h2>
          <p className="text-slate-400 text-sm mb-8">{t('login.subtitle')}</p>

          <Form form={form} onFinish={handleLogin} layout="vertical" size="large">
            <Form.Item
              name="username"
              rules={[{ required: true, message: t('login.username_placeholder') }]}
            >
              <Input
                prefix={<UserOutlined className="text-slate-400" />}
                placeholder={t('login.username_placeholder')}
                autoComplete="username"
                className="rounded-lg"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: t('login.password_placeholder') }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-slate-400" />}
                placeholder={t('login.password_placeholder')}
                autoComplete="current-password"
                className="rounded-lg"
              />
            </Form.Item>

            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                className="w-full h-11 text-base font-medium rounded-lg"
              >
                {loading ? t('login.logging_in') : t('login.login_button')}
              </Button>
            </Form.Item>
          </Form>

          <Divider className="text-slate-400 text-xs" />

          <Button
            onClick={handleSSO}
            loading={ssoLoading}
            size="large"
            className="w-full h-11 text-slate-600 border-slate-200 rounded-lg"
            icon={<ApartmentOutlined />}
          >
            {t('login.sso_button')}
          </Button>

          <p className="text-center text-slate-400 text-xs mt-8 md:hidden">
            © 2026 EKM
          </p>
        </div>
      </div>
    </div>
  )
}
