import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { connectDB } from '@/lib/db'
import Game from '@/models/Game'
import GameEditor from '../GameEditor'

export default async function EditGamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser()
  if (!user) redirect('/admin/login')

  const { id } = await params
  await connectDB()
  const game = await Game.findById(id).lean()
  if (!game) redirect('/admin/games')

  return <GameEditor initialGame={JSON.parse(JSON.stringify(game))} />
}
