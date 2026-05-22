import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import Session from '@/models/Session'
import Game from '@/models/Game'
import { getAuthUser } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { gameId } = await request.json()
  if (!gameId) return Response.json({ error: 'gameId required' }, { status: 400 })

  await connectDB()
  const game = await Game.findById(gameId)
  if (!game) return Response.json({ error: 'Game not found' }, { status: 404 })

  // End any existing active sessions
  await Session.updateMany({ status: { $in: ['lobby', 'active'] } }, { status: 'ended' })

  const session = await Session.create({ gameId, status: 'lobby', players: [], playedSongs: [] })
  return Response.json(session, { status: 201 })
}
