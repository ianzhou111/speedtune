import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import Game from '@/models/Game'
import { getAuthUser } from '@/lib/auth'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const games = await Game.find({}, { name: 1, createdAt: 1, updatedAt: 1, 'cards': { $slice: 0 } }).lean()
  // Return card count instead of full card data for the list view
  const gamesWithCount = await Game.aggregate([
    { $project: { name: 1, createdAt: 1, updatedAt: 1, cardCount: { $size: '$cards' } } },
  ])
  return Response.json(gamesWithCount)
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  await connectDB()
  const game = await Game.create(body)
  return Response.json(game, { status: 201 })
}
