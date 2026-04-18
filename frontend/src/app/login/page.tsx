'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Divider, message } from 'antd'
import {
  UserOutlined, LockOutlined, ApartmentOutlined,
  ReadOutlined, TeamOutlined, BranchesOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '@/store/auth'
import api from '@/lib/api'

const FEATURES = [
  {
    icon: <ReadOutlined className="text-xl" />,
    title: '统一知识库',
    desc: '文档、Wiki、附件集中管理，全员可检索',
  },
  {
    icon: <BranchesOutlined className="text-xl" />,
    title: '知识图谱',
    desc: '可视化概念关系，挖掘隐性知识连接',
  },
  {
    icon: <TeamOutlined className="text-xl" />,
    title: '协作社区',
    desc: '跨部门知识共享，沉淀团队智慧资产',
  },
]

export default function LoginPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [form] = Form.useForm()

  async function handleLogin(values: { username: string; password: string }) {
    setLoading(true)
    try {
      const loginRes = await api.post('/api/v1/auth/login', values)
      const { access_token, refresh_token } = loginRes.data
      const meRes = await api.get('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${access_token}` },
      })
      setAuth(meRes.data, access_token, refresh_token)
      message.success('登录成功')
      router.replace('/dashboard')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      const msg = axiosErr?.response?.data?.detail ?? '登录失败，请检查用户名或密码'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleSSO() {
    setSsoLoading(true)
    message.info('SSO 集成开发中，请使用账号密码登录')
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
            连接知识，<br />驱动创新
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs">
            企业级知识管理平台——让每一条经验沉淀为组织资产，让每一次检索都触达最优答案。
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
        <p className="relative z-10 text-slate-600 text-xs">© 2026 EKM · 企业知识管理平台</p>
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
            <span className="text-slate-800 text-lg font-semibold">EKM</span>
          </div>

          <h2 className="text-slate-800 text-2xl font-semibold mb-1">欢迎回来</h2>
          <p className="text-slate-400 text-sm mb-8">登录以访问企业知识库</p>

          <Form form={form} onFinish={handleLogin} layout="vertical" size="large">
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined className="text-slate-400" />}
                placeholder="用户名 / 邮箱"
                autoComplete="username"
                className="rounded-lg"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-slate-400" />}
                placeholder="密码"
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
                登录
              </Button>
            </Form.Item>
          </Form>

          <Divider className="text-slate-400 text-xs">或</Divider>

          <Button
            onClick={handleSSO}
            loading={ssoLoading}
            size="large"
            className="w-full h-11 text-slate-600 border-slate-200 rounded-lg"
            icon={<ApartmentOutlined />}
          >
            企业 SSO 登录（ADFS）
          </Button>

          <p className="text-center text-slate-400 text-xs mt-8 md:hidden">
            © 2026 EKM · 企业知识管理平台
          </p>
        </div>
      </div>
    </div>
  )
}
