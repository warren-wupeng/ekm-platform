import { redirect } from 'next/navigation'
// /dashboard -> /(main)/knowledge as default landing
export default function DashboardPage() {
  redirect('/knowledge')
}
