'use client'
import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import type { PublicSessionState, Player } from '@/types'

interface RevealData {
  animeName: string; songName: string; songArtist: string
  pointsAwarded: number; winnerId?: string; videoUrl: string
}

interface BuzzData { player: { socketId: string; name: string; color: string } }

interface SongStartData {
  cardId: string; cardLabel: string; stars: number
  songIndex: number; totalSongs: number; videoUrl: string
}

export default function DisplayPage() {
  const socketRef = useRef<Socket | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [sessionState, setSessionState] = useState<PublicSessionState | null>(null)
  const [buzz, setBuzz] = useState<BuzzData | null>(null)
  const [reveal, setReveal] = useState<RevealData | null>(null)
  const [currentSong, setCurrentSong] = useState<SongStartData | null>(null)
  const [finalScores, setFinalScores] = useState<Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] | null>(null)
  const [view, setView] = useState<'lobby' | 'game' | 'end'>('lobby')

  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => socket.emit('display:join'))

    socket.on('session:state', (state: PublicSessionState | null) => {
      if (!state) return
      setSessionState(state)
      if (state.status === 'active') setView('game')
      else if (state.status === 'ended') setView('end')
      else setView('lobby')
    })

    socket.on('game:started', () => setView('game'))

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

    socket.on('round:song_start', (data: SongStartData) => {
      setBuzz(null)
      setReveal(null)
      setCurrentSong(data)
      if (videoRef.current && data.videoUrl) {
        videoRef.current.src = data.videoUrl
        videoRef.current.style.visibility = 'hidden'
        videoRef.current.load()
        videoRef.current.play().catch(() => {})
      }
      setSessionState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          currentRound: {
            cardId: data.cardId,
            cardLabel: data.cardLabel,
            stars: data.stars as 1|2|3|4|5,
            songIndex: data.songIndex,
            totalSongs: data.totalSongs,
            phase: 'guess',
            exhaustedBuzzers: [],
          },
        }
      })
    })

    socket.on('round:buzz', (data: BuzzData) => {
      setBuzz(data)
      setReveal(null)
    })

    socket.on('round:audio_pause', () => {
      videoRef.current?.pause()
    })

    socket.on('round:audio_resume', () => {
      videoRef.current?.play().catch(() => {})
    })

    socket.on('round:answer_reveal', (data: RevealData) => {
      setBuzz(null)
      setReveal(data)
      if (videoRef.current) {
        videoRef.current.style.visibility = 'visible'
        videoRef.current.play().catch(() => {})
      }
    })

    socket.on('round:card_complete', () => {
      setBuzz(null)
      setReveal(null)
      setCurrentSong(null)
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
        videoRef.current.style.visibility = 'hidden'
      }
      setSessionState(prev => prev ? { ...prev, currentRound: undefined } : prev)
    })

    socket.on('scores:update', ({ scores }: { scores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setSessionState(prev => prev ? { ...prev, players: scores } : prev)
    })

    socket.on('game:ended', ({ finalScores: fs }: { finalScores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setFinalScores(fs)
      setView('end')
    })

    return () => { socket.disconnect() }
  }, [])

  if (view === 'end') {
    const sorted = [...(finalScores ?? [])].sort((a, b) => b.score - a.score)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 px-8">
        <h1 className="text-6xl font-bold mb-12 text-white">Final Results</h1>
        <div className="flex gap-8 items-end">
          {sorted.slice(0, 3).map((p, i) => {
            const heights = ['h-48', 'h-36', 'h-28']
            const medals = ['🥇', '🥈', '🥉']
            const order = [1, 0, 2]
            const sp = sorted[order[i]]
            if (!sp) return null
            return (
              <div key={sp.socketId} className="flex flex-col items-center gap-2">
                <span className="text-4xl">{medals[order[i]]}</span>
                <div className="w-4 h-4 rounded-full mx-auto" style={{ background: sp.color }} />
                <div className="font-bold text-xl text-white">{sp.name}</div>
                <div className="font-bold text-2xl text-yellow-400">{sp.score}</div>
                <div className={`${heights[order[i]]} w-28 rounded-t-xl flex items-center justify-center text-4xl font-black text-white/20`} style={{ background: sp.color + '66' }}>
                  #{order[i] + 1}
                </div>
              </div>
            )
          })}
        </div>
        {sorted.length > 3 && (
          <div className="mt-8 space-y-2 w-full max-w-md">
            {sorted.slice(3).map((p, i) => (
              <div key={p.socketId} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2">
                <span className="text-gray-400 w-6">#{i + 4}</span>
                <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                <span className="flex-1 text-white">{p.name}</span>
                <span className="font-bold text-yellow-400">{p.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (view === 'lobby') {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-bold text-white mb-2">SpeedTune</h1>
          <p className="text-gray-400 mb-8 text-xl">Anime Music Quiz · Waiting for players…</p>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h2 className="text-gray-500 uppercase tracking-wider text-sm mb-3">Players</h2>
              <div className="space-y-2">
                {sessionState?.players.map(p => (
                  <div key={p.socketId} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
                    <div className="w-4 h-4 rounded-full" style={{ background: p.color }} />
                    <span className="text-white font-semibold text-lg">{p.name}</span>
                  </div>
                ))}
                {!sessionState?.players.length && <p className="text-gray-600">No players yet…</p>}
              </div>
            </div>
            <div>
              <h2 className="text-gray-500 uppercase tracking-wider text-sm mb-3">Board</h2>
              <div className="grid grid-cols-2 gap-2">
                {sessionState?.cards.map(c => (
                  <div key={c._id} className="bg-gray-800 rounded-xl px-3 py-2">
                    <div className="font-medium text-white truncate">{c.label}</div>
                    <div className="text-yellow-400 text-xs">{'⭐'.repeat(c.stars)} · {c.totalSongs} songs</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Active game view
  const round = sessionState?.currentRound
  const scores = [...(sessionState?.players ?? [])].sort((a, b) => b.score - a.score)

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Video (hidden during guess phase) */}
      <video
        ref={videoRef}
        className="fixed inset-0 w-full h-full object-cover z-0 transition-opacity duration-500"
        style={{ visibility: 'hidden', opacity: reveal ? 1 : 0 }}
        playsInline
        muted={false}
      />

      {/* Overlay */}
      <div className="relative z-10 flex flex-col min-h-screen" style={{ background: reveal ? 'rgba(0,0,0,0.6)' : undefined }}>
        {/* Board (shown when no round active) */}
        {!round && !reveal && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="grid grid-cols-4 gap-4 w-full max-w-5xl">
              {sessionState?.cards.map(c => {
                const done = c.playedCount >= c.totalSongs
                return (
                  <div key={c._id} className={`rounded-2xl p-4 text-center transition-all ${done ? 'bg-gray-800 opacity-40' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    <div className={`font-bold text-lg ${done ? 'line-through text-gray-500' : 'text-white'}`}>{c.label}</div>
                    <div className="text-yellow-400 text-sm mt-1">{'⭐'.repeat(c.stars)}</div>
                    {!done && <div className="text-gray-400 text-xs mt-1">{c.totalSongs - c.playedCount} left</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Active round: guess phase */}
        {round && !reveal && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6">
            <div className="text-center">
              <h2 className="text-5xl font-bold text-white">{round.cardLabel}</h2>
              <div className="text-yellow-400 text-2xl mt-2">{'⭐'.repeat(round.stars)}</div>
              <div className="text-gray-400 mt-2">Song {round.songIndex + 1} of {round.totalSongs}</div>
            </div>
            {buzz && (
              <div className="px-8 py-4 rounded-2xl text-3xl font-bold animate-bounce" style={{ background: buzz.player.color, color: 'white' }}>
                {buzz.player.name} BUZZED!
              </div>
            )}
            {!buzz && (
              <div className="text-gray-500 text-xl animate-pulse">♪ Music playing…</div>
            )}
          </div>
        )}

        {/* Reveal phase */}
        {reveal && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
            <div className="bg-black/70 rounded-3xl px-12 py-8 backdrop-blur-sm">
              <p className="text-gray-300 text-xl mb-1">{reveal.songArtist}</p>
              <h2 className="text-5xl font-bold text-white mb-2">{reveal.songName}</h2>
              <p className="text-blue-400 text-2xl">{reveal.animeName}</p>
              {reveal.pointsAwarded > 0 && (
                <div className="mt-4">
                  <span className="inline-block bg-yellow-400 text-black font-black text-3xl px-6 py-2 rounded-full">
                    +{reveal.pointsAwarded} pts
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scoreboard footer */}
        <div className="flex gap-3 justify-center p-4 bg-gray-900/80 backdrop-blur-sm">
          {scores.map((p, i) => (
            <div key={p.socketId} className="flex items-center gap-2 px-4 py-2 rounded-full bg-gray-800">
              <span className="text-gray-400 text-sm">#{i + 1}</span>
              <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
              <span className="font-semibold text-white">{p.name}</span>
              <span className="font-bold text-yellow-400">{p.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
