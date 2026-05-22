import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { connectDB } from '@/lib/db'
import Game from '@/models/Game'
import Link from 'next/link'
import StartButton from './StartButton'

export default async function GamesPage() {
  const user = await getAuthUser()
  if (!user) redirect('/admin/login')

  await connectDB()
  const games = await Game.aggregate([
    { $project: { name: 1, createdAt: 1, updatedAt: 1, cardCount: { $size: '$cards' } } },
    { $sort: { updatedAt: -1 } },
  ])

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Games</h1>
        <Link href="/admin/games/new"
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl font-semibold transition-colors">
          + New Game
        </Link>
      </div>

      {games.length === 0 && <p className="text-gray-500">No games yet. Create one to get started.</p>}

      <div className="space-y-3">
        {games.map((g: { _id: { toString(): string }; name: string; cardCount: number }) => (
          <div key={g._id.toString()} className="bg-gray-800 rounded-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-white text-lg">{g.name}</div>
              <div className="text-gray-400 text-sm">{g.cardCount} card{g.cardCount !== 1 ? 's' : ''}</div>
            </div>
            <div className="flex gap-3">
              <Link href={`/admin/games/${g._id}`}
                className="text-sm text-blue-400 hover:text-blue-300 px-3 py-1 rounded-lg hover:bg-blue-900/30 transition-colors">
                Edit
              </Link>
              <StartButton gameId={g._id.toString()} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
