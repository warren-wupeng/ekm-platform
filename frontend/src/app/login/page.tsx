'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Form, Input, Divider, message } from 'antd'
import { UserOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/store/auth'
import { mockLogin } from '@/lib/mock'

export default function LoginPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [form] = Form.useForm()

  async function handleLogin(values: { username: string; password: string }) {
    setLoading(true)
    try {
      const res = await mockLogin(values.username, values.password)
      setAuth(res.user, res.access_token, res.refresh_token)
      message.success('登录成功')
      router.replace('/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请重试'
      message.error(msg)
    } finally {
      setLoading(false)
    }
  }

  function handleSSO() {
    setSsoLoading(true)
    // TODO: redirect to Keycloak SSO endpoint
    message.info('SSO 集成开发中，请使用账号密码登录')
    setSsoLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-md px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <ThunderboltOutlined className="text-white text-2xl" />
          </div>
          <h1 className="text-white text-2xl font-semibold tracking-tight">EKM</h1>
          <p className="text-slate-400 text-sm mt-1">企业知识管理平台</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-slate-800 text-lg font-medium mb-6">登录</h2>

          <Form form={form} onFinish={handleLogin} layout="vertical" size="large">
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined className="text-slate-400" />}
                placeholder="用户名 / 邮箱"
                autoComplete="username"
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
              />
            </Form.Item>

            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                className="w-full h-11 text-base font-medium"
                style={{ background: '#2563eb' }}
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
            className="w-full h-11 text-slate-600 border-slate-200"
            icon={<ThunderboltOutlined />}
          >
            企业 SSO 登录（ADFS）
          </Button>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          © 2026 EKM · 企业知识管理平台
        </p>
      </div>
    </div>
  )
}
