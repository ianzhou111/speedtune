import { connectDB } from '@/lib/db'
import Session from '@/models/Session'
import Game from '@/models/Game'

export async function GET() {
  await connectDB()
  const session = await Session.findOne({ status: { $in: ['lobby', 'active'] } }).sort({ createdAt: -1 })
  if (!session) return Response.json(null)

  const game = await Game.findById(session.gameId, { name: 1, settings: 1, 'cards.label': 1, 'cards.stars': 1, 'cards._id': 1, 'cards.songs': { $slice: [0, 0] } })

  // Compute played counts per card
  const playedCounts: Record<string, number> = {}
  for (const ps of session.playedSongs) {
    const key = ps.cardId.toString()
    playedCounts[key] = (playedCounts[key] ?? 0) + 1
  }

  const cards = game?.cards.map((c: { _id: { toString(): string }; label: string; stars: number }) => ({
    _id: c._id.toString(),
    label: c.label,
    stars: c.stars,
    playedCount: playedCounts[c._id.toString()] ?? 0,
  })) ?? []

  // We need total songs per card — fetch that separately
  const fullGame = await Game.findById(session.gameId, { 'cards._id': 1, 'cards.songs': 1 })
  const songCounts: Record<string, number> = {}
  for (const c of fullGame?.cards ?? []) {
    songCounts[c._id.toString()] = c.songs.length
  }

  const cardsWithTotal = cards.map((c: { _id: string; label: string; stars: number; playedCount: number }) => ({
    ...c,
    totalSongs: songCounts[c._id] ?? 0,
  }))

  return Response.json({
    sessionId: session._id.toString(),
    status: session.status,
    gameName: game?.name,
    players: session.players.map((p: { socketId: string; name: string; color: string; score: number }) => ({
      socketId: p.socketId,
      name: p.name,
      color: p.color,
      score: p.score,
    })),
    cards: cardsWithTotal,
  })
}
