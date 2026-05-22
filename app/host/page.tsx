'use client'
import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { useRouter } from 'next/navigation'
import type { PublicSessionState, Player } from '@/types'

interface AnswerHint { animeName: string; songName: string; songArtist: string }
interface BuzzData { player: { socketId: string; name: string; color: string } }

export default function HostPage() {
  const router = useRouter()
  const socketRef = useRef<Socket | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<PublicSessionState | null>(null)
  const [answer, setAnswer] = useState<AnswerHint | null>(null)
  const [buzz, setBuzz] = useState<BuzzData | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  // Verify auth and get token from cookie (we read JWT from cookie via a small API ping)
  useEffect(() => {
    fetch('/api/auth/me').then(async r => {
      if (r.status === 401) { router.push('/admin/login'); return }
      const data = await r.json()
      setToken(data.token)
      setAuthChecked(true)
    })
  }, [router])

  useEffect(() => {
    if (!authChecked || !token) return
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => socket.emit('host:join', { token }))

    socket.on('session:state', (state: PublicSessionState | null) => setSessionState(state))

    socket.on('lobby:player_joined', ({ player }: { player: Pick<Player, 'socketId' | 'name' | 'color' | 'score'> }) => {
      setSessionState(prev => {
        if (!prev) return prev
        if (prev.players.find(p => p.socketId === player.socketId)) return prev
        return { ...prev, players: [...prev.players, player] }
      })
    })

    socket.on('lobby:player_left', ({ playerId }: { playerId: string }) => {
      setSessionState(prev => prev ? { ...prev, players: prev.players.filter(p => p.socketId !== playerId) } : prev)
    })

    socket.on('game:started', () => setSessionState(prev => prev ? { ...prev, status: 'active' } : prev))

    socket.on('round:answer_hint', (data: AnswerHint) => { setAnswer(data) })

    socket.on('round:buzz', (data: BuzzData) => setBuzz(data))

    socket.on('round:song_start', () => { setBuzz(null) })

    socket.on('round:card_complete', () => {
      setBuzz(null)
      setAnswer(null)
      setSessionState(prev => prev ? { ...prev, currentRound: undefined } : prev)
    })

    socket.on('scores:update', ({ scores }: { scores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setSessionState(prev => prev ? { ...prev, players: scores } : prev)
    })

    socket.on('game:ended', ({ finalScores }: { finalScores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setSessionState(prev => prev ? { ...prev, status: 'ended', players: finalScores } : prev)
    })

    return () => { socket.disconnect() }
  }, [authChecked, token])

  const emit = (event: string, data?: unknown) => socketRef.current?.emit(event, data)

  if (!authChecked) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Checking auth…</div>
  if (!sessionState) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">No active session. <a href="/admin/games" className="ml-2 text-blue-400 underline">Start a game</a></div>

  const round = sessionState.currentRound
  const scores = [...sessionState.players].sort((a, b) => b.score - a.score)

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-950 px-6 py-3 flex items-center justify-between border-b border-gray-800">
        <h1 className="font-bold text-lg">Host Panel</h1>
        <div className="flex gap-3">
          <a href="/display" target="_blank" className="text-sm text-blue-400 hover:text-blue-300">Open Display Screen ↗</a>
          {sessionState.status === 'active' && (
            <button onClick={() => { if (confirm('End the game?')) emit('host:end_game') }}
              className="text-sm text-red-400 hover:text-red-300">End Game</button>
          )}
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: controls */}
        <div className="flex-1 p-6 overflow-y-auto">

          {/* Lobby */}
          {sessionState.status === 'lobby' && (
            <div>
              <h2 className="text-xl font-bold mb-4">Lobby ({sessionState.players.length} players)</h2>
              <div className="space-y-2 mb-6">
                {sessionState.players.map(p => (
                  <div key={p.socketId} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2">
                    <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                    <span className="flex-1">{p.name}</span>
                    <button onClick={() => emit('host:kick_player', { playerId: p.socketId })}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/30">Kick</button>
                  </div>
                ))}
                {!sessionState.players.length && <p className="text-gray-500">No players yet…</p>}
              </div>
              <button onClick={() => emit('host:start_game')}
                disabled={sessionState.players.length === 0}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl py-3 font-bold text-lg">
                Start Game
              </button>
            </div>
          )}

          {/* Active game */}
          {sessionState.status === 'active' && (
            <div className="space-y-6">
              {/* Answer reveal box */}
              {answer && (
                <div className="bg-blue-900/40 border border-blue-500/30 rounded-2xl p-4">
                  <p className="text-xs text-blue-400 uppercase tracking-wider mb-2">Current Answer</p>
                  <p className="text-gray-300 text-sm">{answer.songArtist}</p>
                  <p className="text-white font-bold text-xl">{answer.songName}</p>
                  <p className="text-blue-300">{answer.animeName}</p>
                </div>
              )}

              {/* Buzz notification + judge buttons */}
              {buzz && (
                <div className="bg-gray-800 rounded-2xl p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-4 h-4 rounded-full" style={{ background: buzz.player.color }} />
                    <span className="font-bold text-lg">{buzz.player.name} buzzed in!</span>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => { setBuzz(null); emit('host:judge', { correct: true }) }}
                      className="flex-1 bg-green-600 hover:bg-green-500 rounded-xl py-3 font-bold text-lg">
                      ✓ Correct
                    </button>
                    <button onClick={() => { setBuzz(null); emit('host:judge', { correct: false }) }}
                      className="flex-1 bg-red-700 hover:bg-red-600 rounded-xl py-3 font-bold text-lg">
                      ✗ Wrong
                    </button>
                  </div>
                </div>
              )}

              {/* Round info */}
              {round && (
                <div className="bg-gray-800 rounded-2xl p-4">
                  <p className="text-gray-400 text-sm">{round.cardLabel} · {'⭐'.repeat(round.stars)} · Song {round.songIndex + 1}/{round.totalSongs}</p>
                  <p className="text-gray-500 text-xs mt-1 capitalize">Phase: {round.phase}</p>
                  <button onClick={() => emit('host:skip')}
                    className="mt-3 w-full bg-gray-700 hover:bg-gray-600 rounded-xl py-2 text-sm">
                    Skip / Reveal
                  </button>
                </div>
              )}

              {/* Board */}
              {!round && (
                <div>
                  <p className="text-gray-400 text-sm mb-3">Pick a card to play</p>
                  <div className="grid grid-cols-2 gap-2">
                    {sessionState.cards.map(c => {
                      const done = c.playedCount >= c.totalSongs
                      return (
                        <button key={c._id} disabled={done}
                          onClick={() => emit('host:open_card', { cardId: c._id })}
                          className={`rounded-xl p-3 text-left transition-all ${done ? 'bg-gray-800 opacity-40 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'}`}>
                          <div className={`font-semibold ${done ? 'line-through text-gray-500' : 'text-white'}`}>{c.label}</div>
                          <div className="text-yellow-400 text-xs">{'⭐'.repeat(c.stars)}</div>
                          <div className="text-gray-400 text-xs">{c.totalSongs - c.playedCount}/{c.totalSongs} left</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Kick players during game */}
              <details className="bg-gray-800 rounded-2xl">
                <summary className="px-4 py-3 cursor-pointer text-sm text-gray-400 hover:text-white">Manage Players</summary>
                <div className="px-4 pb-4 space-y-2">
                  {sessionState.players.map(p => (
                    <div key={p.socketId} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                      <span className="flex-1 text-sm">{p.name}</span>
                      <button onClick={() => emit('host:kick_player', { playerId: p.socketId })}
                        className="text-xs text-red-400 hover:text-red-300">Kick</button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {sessionState.status === 'ended' && (
            <div className="text-center">
              <p className="text-2xl font-bold mb-4">Game Over</p>
              <a href="/admin/games" className="text-blue-400 hover:text-blue-300 underline">Start a new game</a>
            </div>
          )}
        </div>

        {/* Right: scoreboard */}
        <div className="w-56 bg-gray-950 border-l border-gray-800 p-4 overflow-y-auto">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Scores</p>
          <div className="space-y-2">
            {scores.map((p, i) => (
              <div key={p.socketId} className="flex items-center gap-2">
                <span className="text-gray-500 text-xs w-4">#{i + 1}</span>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="text-sm flex-1 truncate">{p.name}</span>
                <span className="text-yellow-400 font-bold text-sm">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
