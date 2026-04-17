import { redirect } from 'next/navigation'

// Root page: redirect to dashboard (auth guard handles login redirect)
export default function RootPage() {
  redirect('/dashboard')
}
