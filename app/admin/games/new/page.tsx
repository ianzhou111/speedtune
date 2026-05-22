import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import GameEditor from '../GameEditor'

export default async function NewGamePage() {
  const user = await getAuthUser()
  if (!user) redirect('/admin/login')
  return <GameEditor />
}
