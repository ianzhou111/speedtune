'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { PublicSessionState, Player } from '@/types'
import { PLAYER_COLORS } from '@/types'

type View = 'loading' | 'no_game' | 'join' | 'lobby' | 'game' | 'end'

interface BuzzState {
  player: { socketId: string; name: string; color: string }
}

export default function PlayerPage() {
  const socketRef = useRef<Socket | null>(null)
  const [view, setView] = useState<View>('loading')
  const [name, setName] = useState('')
  const [color, setColor] = useState('')
  const [sessionState, setSessionState] = useState<PublicSessionState | null>(null)
  const [mySocketId, setMySocketId] = useState('')
  const [buzz, setBuzz] = useState<BuzzState | null>(null)
  const [revealData, setRevealData] = useState<{ animeName: string; songName: string; songArtist: string; pointsAwarded: number; winnerId?: string } | null>(null)
  const [finalScores, setFinalScores] = useState<Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] | null>(null)
  const [error, setError] = useState('')
  const [banned, setBanned] = useState(false)
  const [banSeconds, setBanSeconds] = useState(0)
  const hasJoined = useRef(false)

  const takenColors = sessionState?.players
    .filter(p => p.socketId !== mySocketId)
    .map(p => p.color) ?? []

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => {
      setMySocketId(socket.id ?? '')
      if (hasJoined.current) {
        const savedName = sessionStorage.getItem('st_name')
        const savedColor = sessionStorage.getItem('st_color')
        if (savedName && savedColor) {
          socket.emit('player:join', { name: savedName, color: savedColor })
        }
      }
    })

    socket.on('session:state', (state: PublicSessionState | null) => {
      if (!state) { setView('no_game'); return }
      setSessionState(state)
      if (!hasJoined.current) {
        setView('join')
      } else if (state.status === 'lobby') {
        setView('lobby')
      } else if (state.status === 'active') {
        setView('game')
      } else if (state.status === 'ended') {
        setView('end')
      }
    })

    socket.on('error', (e: { message: string; retryAfter?: number }) => {
      if (e.message === 'banned') {
        setBanned(true)
        setBanSeconds(Math.ceil((e.retryAfter ?? 30000) / 1000))
      } else {
        setError(e.message)
      }
    })

    socket.on('lobby:player_joined', ({ player }: { player: Pick<Player, 'socketId' | 'name' | 'color' | 'score'> }) => {
      setSessionState(prev => {
        if (!prev) return prev
        const exists = prev.players.find(p => p.socketId === player.socketId)
        if (exists) return prev
        return { ...prev, players: [...prev.players, player] }
      })
    })

    socket.on('lobby:player_left', ({ playerId }: { playerId: string }) => {
      setSessionState(prev => prev ? { ...prev, players: prev.players.filter(p => p.socketId !== playerId) } : prev)
    })

    socket.on('lobby:player_kicked', () => {
      hasJoined.current = false
      sessionStorage.removeItem('st_name')
      sessionStorage.removeItem('st_color')
      setView('join')
      setError('You were removed by the host.')
      setBanned(true)
      setBanSeconds(30)
    })

    socket.on('game:started', () => { hasJoined.current = true; setView('game') })

    socket.on('round:buzz', (data: BuzzState) => { setBuzz(data); setRevealData(null) })

    socket.on('round:answer_reveal', (data: { animeName: string; songName: string; songArtist: string; pointsAwarded: number; winnerId?: string }) => {
      setBuzz(null)
      setRevealData(data)
    })

    socket.on('round:song_start', () => { setBuzz(null); setRevealData(null) })
    socket.on('round:card_complete', () => { setBuzz(null); setRevealData(null) })

    socket.on('scores:update', ({ scores }: { scores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setSessionState(prev => prev ? { ...prev, players: scores } : prev)
    })

    socket.on('game:ended', ({ finalScores: fs }: { finalScores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[] }) => {
      setFinalScores(fs)
      setView('end')
    })

    fetch('/api/sessions/active').then(r => r.json()).then(data => {
      if (!data) { setView('no_game'); return }
      setSessionState(data)
      setView('join')
    })

    return () => { socket.disconnect() }
  }, [])

  useEffect(() => {
    if (!banned || banSeconds <= 0) return
    const t = setTimeout(() => setBanSeconds(s => { if (s <= 1) { setBanned(false); return 0 } return s - 1 }), 1000)
    return () => clearTimeout(t)
  }, [banned, banSeconds])

  const handleJoin = useCallback(() => {
    if (!name.trim() || !color) return
    hasJoined.current = true
    sessionStorage.setItem('st_name', name.trim())
    sessionStorage.setItem('st_color', color)
    socketRef.current?.emit('player:join', { name: name.trim(), color })
    setView('lobby')
  }, [name, color])

  const handleBuzz = useCallback(() => {
    socketRef.current?.emit('player:buzz')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && view === 'game') handleBuzz() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, handleBuzz])

  const mySocketId2 = mySocketId
  const isBuzzed = buzz !== null
  const isMeBuzzed = buzz?.player.socketId === mySocketId2
  const isExhausted = sessionState?.currentRound?.exhaustedBuzzers.includes(mySocketId2) ?? false
  const canBuzz = (sessionState?.currentRound?.phase === 'guess') && !isExhausted && !isBuzzed

  if (view === 'loading') return <Screen><p className="text-gray-400 animate-pulse">Connecting…</p></Screen>
  if (view === 'no_game') return <Screen><p className="text-gray-400 text-xl">No game is currently running.</p></Screen>

  if (view === 'end') {
    const sorted = [...(finalScores ?? sessionState?.players ?? [])].sort((a, b) => b.score - a.score)
    return (
      <Screen>
        <h1 className="text-4xl font-bold mb-8">Game Over!</h1>
        <div className="space-y-3 w-full max-w-sm">
          {sorted.map((p, i) => (
            <div key={p.socketId} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
              <span className="text-2xl">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
              <div className="w-4 h-4 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 font-semibold">{p.name}</span>
              <span className="font-bold text-yellow-400">{p.score}</span>
            </div>
          ))}
        </div>
      </Screen>
    )
  }

  if (view === 'join') {
    return (
      <Screen>
        <h1 className="text-4xl font-bold mb-2">SpeedTune</h1>
        <p className="text-gray-400 mb-8">Anime Music Quiz</p>
        {error && <p className="text-red-400 mb-4 text-sm">{error}</p>}
        {banned && banSeconds > 0 && <p className="text-orange-400 mb-4">You can rejoin in {banSeconds}s</p>}
        <div className="w-full max-w-xs space-y-4">
          <input
            className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your name"
            maxLength={20}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleJoin()}
          />
          <div className="grid grid-cols-5 gap-2">
            {PLAYER_COLORS.map(c => {
              const taken = takenColors.includes(c.hex)
              return (
                <button key={c.hex} disabled={taken} onClick={() => setColor(c.hex)} title={c.name}
                  className={`w-10 h-10 rounded-full border-2 transition-all ${color === c.hex ? 'border-white scale-110' : 'border-transparent'} ${taken ? 'opacity-30 cursor-not-allowed' : 'hover:scale-105'}`}
                  style={{ background: c.hex }} />
              )
            })}
          </div>
          <button disabled={!name.trim() || !color || (banned && banSeconds > 0)} onClick={handleJoin}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl py-3 font-semibold transition-colors">
            Join Game
          </button>
        </div>
      </Screen>
    )
  }

  if (view === 'lobby') {
    return (
      <Screen>
        <h1 className="text-3xl font-bold mb-1">Lobby</h1>
        <p className="text-gray-400 mb-6 text-sm">Waiting for host to start…</p>
        <div className="w-full max-w-sm space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Players ({sessionState?.players.length ?? 0})</p>
            <div className="space-y-2">
              {sessionState?.players.map(p => (
                <div key={p.socketId} className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-2">
                  <div className="w-3 h-3 rounded-full" style={{ background: p.color }} />
                  <span className={p.socketId === mySocketId2 ? 'font-semibold' : ''}>{p.name}</span>
                  {p.socketId === mySocketId2 && <span className="text-xs text-gray-500">(you)</span>}
                </div>
              ))}
            </div>
          </div>
          {sessionState?.cards && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Board ({sessionState.cards.length} cards)</p>
              <div className="grid grid-cols-2 gap-2">
                {sessionState.cards.map(c => (
                  <div key={c._id} className="bg-gray-800 rounded-xl px-3 py-2 text-sm">
                    <div className="font-medium truncate">{c.label}</div>
                    <div className="text-yellow-400 text-xs">{'⭐'.repeat(c.stars)} · {c.totalSongs} song{c.totalSongs !== 1 ? 's' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Screen>
    )
  }

  // Game view
  const round = sessionState?.currentRound
  return (
    <Screen>
      <div className="w-full flex gap-2 justify-center flex-wrap mb-4">
        {sessionState?.players.map(p => (
          <div key={p.socketId} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm ${p.socketId === mySocketId2 ? 'ring-2 ring-white' : ''}`} style={{ background: p.color + '33' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="font-medium">{p.name}</span>
            <span className="font-bold text-yellow-400">{p.score}</span>
          </div>
        ))}
      </div>

      {round && (
        <div className="text-center mb-4">
          <div className="text-gray-400 text-sm">{round.cardLabel} · {'⭐'.repeat(round.stars)}</div>
          <div className="text-gray-500 text-xs">Song {round.songIndex + 1} of {round.totalSongs}</div>
        </div>
      )}

      {revealData && (
        <div className="bg-gray-800 rounded-2xl p-6 text-center mb-6 w-full max-w-sm">
          <p className="text-gray-400 text-sm mb-1">{revealData.songArtist}</p>
          <p className="text-white font-bold text-xl mb-1">{revealData.songName}</p>
          <p className="text-blue-400 text-sm">{revealData.animeName}</p>
          {revealData.pointsAwarded > 0 && <p className="text-yellow-400 font-bold mt-2">+{revealData.pointsAwarded} pts</p>}
        </div>
      )}

      {buzz && !revealData && (
        <div className="mb-6 text-center">
          <div className="inline-block px-4 py-2 rounded-full font-semibold" style={{ background: buzz.player.color + '33', color: buzz.player.color }}>
            {isMeBuzzed ? 'You buzzed in!' : `${buzz.player.name} buzzed in!`}
          </div>
        </div>
      )}

      {!round && !revealData && (
        <p className="text-gray-500 mb-6">Waiting for host to pick a card…</p>
      )}

      <button
        disabled={!canBuzz}
        onPointerDown={handleBuzz}
        className={`w-48 h-48 rounded-full text-2xl font-bold transition-all select-none ${
          canBuzz ? 'bg-red-600 hover:bg-red-500 active:scale-95 shadow-lg shadow-red-900'
          : 'bg-gray-700 text-gray-500 cursor-not-allowed'
        }`}
      >
        {canBuzz ? 'BUZZ' : isExhausted ? 'Used' : isBuzzed ? 'Wait…' : '—'}
      </button>
      <p className="text-gray-600 text-xs mt-3">or press Enter</p>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 py-8 gap-2">
      {children}
    </main>
  )
}
