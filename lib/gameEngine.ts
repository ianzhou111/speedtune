import { Server as SocketIOServer, Socket } from 'socket.io'
import { connectDB } from './db'
import { verifySocketToken } from './auth'
import Session from '@/models/Session'
import Game from '@/models/Game'
import type {
  PlayerJoinPayload,
  HostOpenCardPayload,
  HostJudgePayload,
  HostKickPlayerPayload,
  PublicSessionState,
} from '@/types'

async function getActiveSession() {
  await connectDB()
  return Session.findOne({ status: { $in: ['lobby', 'active'] } }).sort({ createdAt: -1 })
}

async function getGame(gameId: string) {
  await connectDB()
  return Game.findById(gameId)
}

function buildPublicState(session: Awaited<ReturnType<typeof getActiveSession>>, game: Awaited<ReturnType<typeof getGame>>): PublicSessionState | null {
  if (!session || !game) return null

  const playedSet = new Set(
    session.playedSongs.map((p: { cardId: { toString(): string }; songIndex: number }) => `${p.cardId.toString()}-${p.songIndex}`)
  )

  const cards = game.cards.map((card: { _id: { toString(): string }; label: string; stars: 1|2|3|4|5; songs: unknown[] }) => {
    const totalSongs = card.songs.length
    let playedCount = 0
    for (let i = 0; i < totalSongs; i++) {
      if (playedSet.has(`${card._id.toString()}-${i}`)) playedCount++
    }
    return {
      _id: card._id.toString(),
      label: card.label,
      stars: card.stars,
      totalSongs,
      playedCount,
    }
  })

  let currentRound: PublicSessionState['currentRound'] = undefined
  if (session.currentRound) {
    const r = session.currentRound
    const card = game.cards.find((c: { _id: { toString(): string } }) => c._id.toString() === r.cardId.toString())
    const buzzedPlayer = r.buzzedPlayerId
      ? session.players.find((p: { socketId: string }) => p.socketId === r.buzzedPlayerId)
      : undefined

    currentRound = {
      cardId: r.cardId.toString(),
      cardLabel: card?.label ?? '',
      stars: (card?.stars ?? 1) as 1 | 2 | 3 | 4 | 5,
      songIndex: r.songIndex,
      totalSongs: card?.songs.length ?? 1,
      phase: r.phase,
      buzzedPlayer: buzzedPlayer
        ? { socketId: buzzedPlayer.socketId, name: buzzedPlayer.name, color: buzzedPlayer.color }
        : undefined,
      exhaustedBuzzers: r.exhaustedBuzzers,
    }
  }

  return {
    sessionId: session._id.toString(),
    status: session.status,
    players: session.players.map((p: { socketId: string; name: string; color: string; score: number }) => ({
      socketId: p.socketId,
      name: p.name,
      color: p.color,
      score: p.score,
    })),
    cards,
    currentRound,
  }
}

export function initGameEngine(io: SocketIOServer) {
  io.on('connection', async (socket: Socket) => {
    // --- Player join ---
    socket.on('player:join', async ({ name, color }: PlayerJoinPayload) => {
      const session = await getActiveSession()
      if (!session) return socket.emit('error', { message: 'No active game' })

      // Check ban
      const existing = session.players.find((p: { socketId: string; name: string; bannedUntil?: Date }) =>
        p.name === name
      )
      if (existing?.bannedUntil && existing.bannedUntil > new Date()) {
        const retryAfter = existing.bannedUntil.getTime() - Date.now()
        return socket.emit('error', { message: 'banned', retryAfter })
      }

      // Check color taken
      const colorTaken = session.players.some(
        (p: { color: string; socketId: string }) => p.color === color && p.socketId !== socket.id
      )
      if (colorTaken) return socket.emit('error', { message: 'Color already taken' })

      // Upsert player (reconnect support)
      const playerIndex = session.players.findIndex((p: { socketId: string }) => p.socketId === socket.id)
      if (playerIndex >= 0) {
        session.players[playerIndex].name = name
        session.players[playerIndex].color = color
      } else {
        session.players.push({ socketId: socket.id, name, color, score: 0 })
      }
      await session.save()

      socket.join('players')
      const game = await getGame(session.gameId.toString())
      const state = buildPublicState(session, game)
      socket.emit('session:state', state)

      io.to('players').to('host').to('display').emit('lobby:player_joined', {
        player: { socketId: socket.id, name, color, score: 0 },
      })
    })

    // --- Host join ---
    socket.on('host:join', async ({ token }: { token: string }) => {
      const payload = verifySocketToken(token)
      if (!payload) return socket.emit('error', { message: 'Unauthorized' })

      socket.join('host')
      const session = await getActiveSession()
      const game = session ? await getGame(session.gameId.toString()) : null
      socket.emit('session:state', buildPublicState(session, game))
    })

    // --- Display join ---
    socket.on('display:join', async () => {
      socket.join('display')
      const session = await getActiveSession()
      const game = session ? await getGame(session.gameId.toString()) : null
      socket.emit('session:state', buildPublicState(session, game))
    })

    // --- Host: start game ---
    socket.on('host:start_game', async () => {
      const session = await getActiveSession()
      if (!session || session.status !== 'lobby') return

      session.status = 'active'
      await session.save()

      io.to('players').to('host').to('display').emit('game:started')
    })

    // --- Host: open card ---
    socket.on('host:open_card', async ({ cardId }: HostOpenCardPayload) => {
      const session = await getActiveSession()
      if (!session || session.status !== 'active') return

      const game = await getGame(session.gameId.toString())
      const card = game?.cards.find((c: { _id: { toString(): string } }) => c._id.toString() === cardId)
      if (!card) return

      // Find first unplayed song in the card
      const playedInCard = session.playedSongs
        .filter((p: { cardId: { toString(): string } }) => p.cardId.toString() === cardId)
        .map((p: { songIndex: number }) => p.songIndex)

      const songIndex = Array.from({ length: card.songs.length }, (_, i) => i).find(
        (i) => !playedInCard.includes(i)
      )
      if (songIndex === undefined) return // all songs played

      session.currentRound = {
        cardId,
        songIndex,
        phase: 'guess',
        exhaustedBuzzers: [],
      }
      await session.save()

      // Send video URL only to display room
      io.to('display').emit('round:song_start', {
        cardId,
        cardLabel: card.label,
        stars: card.stars,
        songIndex,
        totalSongs: card.songs.length,
        videoUrl: card.songs[songIndex].videoUrl,
      })

      // Send non-video info to others
      io.to('players').to('host').emit('round:song_start', {
        cardId,
        cardLabel: card.label,
        stars: card.stars,
        songIndex,
        totalSongs: card.songs.length,
        videoUrl: '',
      })

      // Send answer only to host
      io.to('host').emit('round:answer_hint', {
        animeName: card.songs[songIndex].animeName,
        songName: card.songs[songIndex].songName,
        songArtist: card.songs[songIndex].songArtist,
      })
    })

    // --- Player: buzz ---
    socket.on('player:buzz', async () => {
      const session = await getActiveSession()
      if (!session || session.status !== 'active' || !session.currentRound) return
      if (session.currentRound.phase !== 'guess') return

      const player = session.players.find((p: { socketId: string }) => p.socketId === socket.id)
      if (!player) return
      if (session.currentRound.exhaustedBuzzers.includes(socket.id)) return

      session.currentRound.phase = 'reveal' // temporarily lock
      session.currentRound.buzzedPlayerId = socket.id
      // Don't add to exhausted yet — wait for judge result
      await session.save()

      io.to('players').to('host').to('display').emit('round:buzz', {
        player: { socketId: socket.id, name: player.name, color: player.color },
      })
      io.to('display').emit('round:audio_pause')
    })

    // --- Host: judge ---
    socket.on('host:judge', async ({ correct }: HostJudgePayload) => {
      const session = await getActiveSession()
      if (!session || !session.currentRound) return

      const game = await getGame(session.gameId.toString())
      const round = session.currentRound
      const card = game?.cards.find((c: { _id: { toString(): string } }) => c._id.toString() === round.cardId.toString())
      if (!card) return

      const song = card.songs[round.songIndex]
      const settings = game.settings
      const pointValue = (settings.starPointMap as Map<string, number>).get(String(card.stars)) ?? card.stars * 100

      if (correct) {
        // Award points
        const playerIndex = session.players.findIndex(
          (p: { socketId: string }) => p.socketId === round.buzzedPlayerId
        )
        if (playerIndex >= 0) {
          session.players[playerIndex].score += pointValue
        }

        await emitRevealAndAdvance(io, session, game, card, song, pointValue, round.buzzedPlayerId)
      } else {
        // Wrong: deduct if configured, lock that player's buzzer, resume audio
        const playerIndex = session.players.findIndex(
          (p: { socketId: string }) => p.socketId === round.buzzedPlayerId
        )
        const deduction = settings.wrongAnswerDeduction ?? 0
        if (playerIndex >= 0 && deduction > 0) {
          session.players[playerIndex].score -= deduction
        }

        round.exhaustedBuzzers.push(round.buzzedPlayerId!)
        round.buzzedPlayerId = undefined
        round.phase = 'guess'

        await session.save()

        io.to('players').to('host').to('display').emit('scores:update', {
          scores: session.players.map((p: { socketId: string; name: string; color: string; score: number }) => ({
            socketId: p.socketId, name: p.name, color: p.color, score: p.score,
          })),
        })
        io.to('display').emit('round:audio_resume')

        // Check if all buzzers exhausted
        const activePlayers = session.players.filter((p: { socketId: string }) => p.socketId)
        const allExhausted = activePlayers.every((p: { socketId: string }) =>
          round.exhaustedBuzzers.includes(p.socketId)
        )
        if (allExhausted) {
          await emitRevealAndAdvance(io, session, game, card, song, 0, undefined)
        }
      }
    })

    // --- Host: skip ---
    socket.on('host:skip', async () => {
      const session = await getActiveSession()
      if (!session || !session.currentRound) return

      const game = await getGame(session.gameId.toString())
      const round = session.currentRound
      const card = game?.cards.find((c: { _id: { toString(): string } }) => c._id.toString() === round.cardId.toString())
      if (!card) return

      const song = card.songs[round.songIndex]
      await emitRevealAndAdvance(io, session, game, card, song, 0, undefined)
    })

    // --- Host: kick player ---
    socket.on('host:kick_player', async ({ playerId }: HostKickPlayerPayload) => {
      const session = await getActiveSession()
      if (!session) return

      const playerIndex = session.players.findIndex((p: { socketId: string }) => p.socketId === playerId)
      if (playerIndex < 0) return

      session.players[playerIndex].bannedUntil = new Date(Date.now() + 30_000)
      await session.save()

      io.to(playerId).emit('lobby:player_kicked')
      io.to('players').to('host').to('display').emit('lobby:player_left', { playerId })

      const targetSocket = io.sockets.sockets.get(playerId)
      targetSocket?.leave('players')
    })

    // --- Host: end game ---
    socket.on('host:end_game', async () => {
      const session = await getActiveSession()
      if (!session) return

      session.status = 'ended'
      session.currentRound = undefined
      await session.save()

      const finalScores = session.players.map((p: { socketId: string; name: string; color: string; score: number }) => ({
        socketId: p.socketId, name: p.name, color: p.color, score: p.score,
      }))
      io.to('players').to('host').to('display').emit('game:ended', { finalScores })
    })

    // --- Disconnect ---
    socket.on('disconnect', async () => {
      const session = await getActiveSession()
      if (!session) return

      const playerIndex = session.players.findIndex((p: { socketId: string }) => p.socketId === socket.id)
      if (playerIndex >= 0 && !session.players[playerIndex].bannedUntil) {
        session.players.splice(playerIndex, 1)
        await session.save()
        io.to('players').to('host').to('display').emit('lobby:player_left', { playerId: socket.id })
      }
    })
  })
}

async function emitRevealAndAdvance(
  io: SocketIOServer,
  session: Awaited<ReturnType<typeof getActiveSession>>,
  game: Awaited<ReturnType<typeof getGame>>,
  card: { _id: { toString(): string }; label: string; stars: number; songs: { animeName: string; songName: string; songArtist: string; videoUrl: string }[] },
  song: { animeName: string; songName: string; songArtist: string; videoUrl: string },
  pointsAwarded: number,
  winnerId: string | undefined
) {
  if (!session || !session.currentRound) return

  const round = session.currentRound
  round.phase = 'reveal'

  // Mark song as played
  session.playedSongs.push({ cardId: round.cardId, songIndex: round.songIndex })
  await session.save()

  io.to('players').to('host').to('display').emit('round:answer_reveal', {
    animeName: song.animeName,
    songName: song.songName,
    songArtist: song.songArtist,
    pointsAwarded,
    winnerId,
    videoUrl: song.videoUrl,
  })

  io.to('players').to('host').to('display').emit('scores:update', {
    scores: session.players.map((p: { socketId: string; name: string; color: string; score: number }) => ({
      socketId: p.socketId, name: p.name, color: p.color, score: p.score,
    })),
  })

  // Find next unplayed song in the card
  const playedInCard = session.playedSongs
    .filter((p: { cardId: { toString(): string } }) => p.cardId.toString() === round.cardId.toString())
    .map((p: { songIndex: number }) => p.songIndex)

  const nextSongIndex = Array.from({ length: card.songs.length }, (_, i) => i).find(
    (i) => !playedInCard.includes(i)
  )

  if (nextSongIndex !== undefined) {
    // Advance to next song after a short delay (let reveal play)
    setTimeout(async () => {
      const freshSession = await getActiveSession()
      if (!freshSession || freshSession.status !== 'active') return

      freshSession.currentRound = {
        cardId: round.cardId.toString(),
        songIndex: nextSongIndex,
        phase: 'guess',
        exhaustedBuzzers: [],
      }
      await freshSession.save()

      io.to('display').emit('round:song_start', {
        cardId: round.cardId.toString(),
        cardLabel: card.label,
        stars: card.stars,
        songIndex: nextSongIndex,
        totalSongs: card.songs.length,
        videoUrl: card.songs[nextSongIndex].videoUrl,
      })
      io.to('players').to('host').emit('round:song_start', {
        cardId: round.cardId.toString(),
        cardLabel: card.label,
        stars: card.stars,
        songIndex: nextSongIndex,
        totalSongs: card.songs.length,
        videoUrl: '',
      })
      io.to('host').emit('round:answer_hint', {
        animeName: card.songs[nextSongIndex].animeName,
        songName: card.songs[nextSongIndex].songName,
        songArtist: card.songs[nextSongIndex].songArtist,
      })
    }, 8000) // 8s reveal window before next song auto-starts
  } else {
    // All songs in card played — return to board
    setTimeout(async () => {
      const freshSession = await getActiveSession()
      if (!freshSession) return
      freshSession.currentRound = undefined
      await freshSession.save()
      io.to('players').to('host').to('display').emit('round:card_complete')
    }, 8000)
  }
}
