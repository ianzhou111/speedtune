import { useEffect, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import { startConnection } from '../lib/signalr'
import type {
  SessionState, Player, CardSummary,
  RoundSongStartPayload, RoundBuzzPayload,
  RoundAnswerRevealPayload, ScoresUpdatePayload, GameEndedPayload, ErrorPayload, PickerUpdatePayload,
} from '../lib/types'
import { PLAYER_COLORS } from '../lib/types'

type Phase = 'join' | 'reconnecting' | 'lobby' | 'active' | 'ended'

interface RevealInfo {
  AnimeName: string
  SongName: string
  SongArtist: string
  PointsAwarded: number
  WinnerId: string | null
}

/** Get `?room=` from the URL (uppercase, trimmed). */
function getRoomFromUrl(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase().trim() ?? ''
}

export default function PlayerPage() {
  const connRef  = useRef<signalR.HubConnection | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Join form
  const [name,  setName]  = useState(() => localStorage.getItem('st_name')  || '')
  const [color, setColor] = useState(() => localStorage.getItem('st_color') || 'blue')
  const [roomCode, setRoomCode] = useState(() => {
    const fromUrl = getRoomFromUrl()
    return fromUrl || localStorage.getItem('st_room') || ''
  })

  // Game state
  const [phase, setPhase] = useState<Phase>(() => {
    const hasName = !!localStorage.getItem('st_name')
    const hasRoom = !!(getRoomFromUrl() || localStorage.getItem('st_room'))
    return hasName && hasRoom ? 'reconnecting' : 'join'
  })
  const [players, setPlayers]         = useState<Player[]>([])
  const [cards, setCards]             = useState<CardSummary[]>([])
  const [currentCard, setCurrentCard] = useState<CardSummary | null>(null)
  const [songIndex, setSongIndex]     = useState(0)
  const [totalSongs, setTotalSongs]   = useState(0)
  const [buzzedPlayer, setBuzzedPlayer] = useState<{ SocketId: string; Name: string; Color: string } | null>(null)
  const [revealInfo, setRevealInfo]   = useState<RevealInfo | null>(null)
  const [finalScores, setFinalScores] = useState<Player[]>([])
  const [roundPhase, setRoundPhase]   = useState<'idle' | 'guess' | 'buzzed' | 'reveal'>('idle')
  const [timeLeft, setTimeLeft]       = useState(0)
  const [clipDuration, setClipDuration] = useState(60)
  const [error, setError]             = useState('')
  const [timedOut, setTimedOut]       = useState(false)
  const [currentPickerId, setCurrentPickerId] = useState<string | null>(null)
  const [pickOrder, setPickOrder]     = useState<string[]>([])
  const mySocketId = useRef('')
  const canBuzzRef = useRef(false)

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setTimeLeft(0)
  }

  function startTimer(duration: number) {
    clearTimer()
    setTimeLeft(duration)
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearTimer(); return 0 }
        return t - 1
      })
    }, 1000)
  }

  // Keyboard buzz — Space or Enter triggers buzz when eligible
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.code !== 'Enter') return
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return
      e.preventDefault()
      if (canBuzzRef.current) connRef.current?.invoke('PlayerBuzz')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Taken colors from other players
  const takenColors = players.filter(p => p.SocketId !== mySocketId.current).map(p => p.Color)

  useEffect(() => {
    let active = true
    startConnection().then(conn => {
      if (!active) return
      connRef.current = conn
      mySocketId.current = conn.connectionId ?? ''

      conn.on('SessionState', (state: SessionState) => {
        setPlayers(state.Players)
        setCards(state.Cards)
        setCurrentPickerId(state.CurrentPickerId ?? null)
        setPickOrder(state.PickOrder ?? [])
        if (state.Status === 'active') {
          setPhase('active')
          if (state.CurrentRound) {
            const cr = state.CurrentRound
            setCurrentCard(state.Cards.find(c => c.Id === cr.CardId) ?? null)
            setSongIndex(cr.SongIndex)
            setTotalSongs(cr.TotalSongs)
            setBuzzedPlayer(cr.BuzzedPlayer)
            setRoundPhase(cr.Phase as 'idle' | 'guess' | 'buzzed' | 'reveal')
          } else {
            setRoundPhase('idle')
          }
        } else if (state.Status === 'lobby') {
          setPhase('lobby')
        }
      })

      conn.on('LobbyPlayerJoined', ({ Player: p }: { Player: Player }) => {
        setPlayers(prev => {
          const without = prev.filter(x => x.SocketId !== p.SocketId)
          return [...without, p]
        })
      })

      conn.on('LobbyPlayerLeft', ({ PlayerId }: { PlayerId: string }) => {
        setPlayers(prev => prev.filter(p => p.SocketId !== PlayerId))
      })

      conn.on('LobbyPlayerKicked', () => {
        setPhase('join')
        setError('You were kicked. Please wait before re-joining.')
      })

      conn.on('GameStarted', () => {
        setPhase('active')
        setRoundPhase('idle')
      })

      conn.on('RoundSongStart', (p: RoundSongStartPayload) => {
        setCurrentCard({ Id: p.CardId, Label: p.CardLabel, Stars: p.Stars, TotalSongs: p.TotalSongs, PlayedCount: 0 })
        setSongIndex(p.SongIndex)
        setTotalSongs(p.TotalSongs)
        setClipDuration(p.ClipDuration)
        setBuzzedPlayer(null)
        setRevealInfo(null)
        setTimedOut(false)
        setRoundPhase('guess')
        startTimer(p.ClipDuration)
      })

      conn.on('RoundTimedOut', () => setTimedOut(true))

      conn.on('RoundBuzz', ({ Player: p }: RoundBuzzPayload) => {
        setBuzzedPlayer(p)
        setRoundPhase('buzzed')
        clearTimer()
      })

      conn.on('RoundAudioResume', () => {
        setBuzzedPlayer(null)
        setRoundPhase('guess')
        // Don't restart timer — player already guessed wrong
      })

      conn.on('RoundAnswerReveal', (p: RoundAnswerRevealPayload) => {
        setRevealInfo({
          AnimeName: p.AnimeName,
          SongName: p.SongName,
          SongArtist: p.SongArtist,
          PointsAwarded: p.PointsAwarded,
          WinnerId: p.WinnerId,
        })
        setRoundPhase('reveal')
        clearTimer()
      })

      conn.on('RoundCardComplete', () => {
        setCurrentCard(null)
        setRoundPhase('idle')
        setRevealInfo(null)
        setBuzzedPlayer(null)
        clearTimer()
      })

      conn.on('ScoresUpdate', ({ Scores }: ScoresUpdatePayload) => {
        setPlayers(Scores)
      })

      conn.on('GameEnded', ({ FinalScores }: GameEndedPayload) => {
        setFinalScores(FinalScores)
        setPhase('ended')
      })

      conn.on('PickerUpdate', (p: PickerUpdatePayload) => {
        setCurrentPickerId(p.CurrentPickerId)
        setPickOrder(p.PickOrder)
      })

      conn.on('Error', ({ Message, RetryAfter }: ErrorPayload) => {
        setPhase('join')
        if (Message === 'banned') {
          setError(`You are temporarily banned. Try again in ${Math.ceil((RetryAfter ?? 30000) / 1000)}s.`)
        } else if (Message === 'Game already in progress') {
          setError("The game has already started. You can't join right now.")
        } else if (Message === 'Room not found') {
          setError('Room not found. Check your room code and try again.')
          localStorage.removeItem('st_room')
        } else {
          setError(Message)
        }
      })

      // Auto-rejoin if credentials are saved (browser refresh recovery)
      const savedName  = localStorage.getItem('st_name')
      const savedColor = localStorage.getItem('st_color') ?? 'blue'
      const savedRoom  = getRoomFromUrl() || localStorage.getItem('st_room') ?? ''
      if (savedName && savedRoom) {
        conn.invoke('PlayerJoin', savedName, savedColor, savedRoom).catch(() => setPhase('join'))
      }
    })

    return () => {
      active = false
      clearTimer()
      const EVENTS = ['SessionState','LobbyPlayerJoined','LobbyPlayerLeft','LobbyPlayerKicked',
        'GameStarted','RoundSongStart','RoundBuzz','RoundAudioPause','RoundAudioResume',
        'RoundAnswerReveal','RoundCardComplete','ScoresUpdate','GameEnded','Error','PickerUpdate','RoundTimedOut']
      EVENTS.forEach(e => connRef.current?.off(e))
    }
  }, [])

  // ── Join ────────────────────────────────────────────────────────────────

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !roomCode.trim() || !connRef.current) return
    setError('')
    localStorage.setItem('st_name',  name)
    localStorage.setItem('st_color', color)
    localStorage.setItem('st_room',  roomCode.toUpperCase())
    connRef.current.invoke('PlayerJoin', name.trim(), color, roomCode.toUpperCase())
    setPhase('lobby')
  }

  // ── Buzz ────────────────────────────────────────────────────────────────

  function buzz() {
    connRef.current?.invoke('PlayerBuzz')
  }

  const myId    = mySocketId.current
  const canBuzz = roundPhase === 'guess' && !timedOut
  canBuzzRef.current = canBuzz

  // timer color: green → yellow → red
  const timerPct   = clipDuration > 0 ? timeLeft / clipDuration : 0
  const timerColor = timerPct > 0.5 ? 'var(--green)' : timerPct > 0.25 ? 'var(--yellow)' : 'var(--red)'

  // ── Render ──────────────────────────────────────────────────────────────

  if (phase === 'reconnecting') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>⏳</div>
        <p style={{ color: 'var(--text-muted)' }}>Reconnecting as <strong style={{ color: 'var(--text)' }}>{name}</strong>…</p>
        <button className="btn-secondary" style={{ fontSize: '0.85rem', padding: '6px 14px' }} onClick={() => {
          localStorage.removeItem('st_name'); localStorage.removeItem('st_color'); localStorage.removeItem('st_room')
          setPhase('join')
        }}>
          Join as someone else
        </button>
      </div>
    )
  }

  if (phase === 'join') {
    const urlRoom = getRoomFromUrl()
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 360 }}>
          <h2 style={{ textAlign: 'center', marginBottom: 24 }}>Join Game</h2>
          {error && <p style={{ color: 'var(--red)', marginBottom: 12, fontSize: '0.875rem' }}>{error}</p>}
          <form onSubmit={handleJoin}>
            {/* Room code field — pre-filled from URL but editable */}
            <div style={{ marginBottom: 16 }}>
              <label>Room code</label>
              <input
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                maxLength={6}
                required
                style={{ fontFamily: 'monospace', letterSpacing: 3, textTransform: 'uppercase' }}
                readOnly={!!urlRoom}
                autoFocus={!urlRoom}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Your name</label>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus={!!urlRoom} maxLength={20} required />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label>Pick a color</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {Object.entries(PLAYER_COLORS).map(([key, hex]) => {
                  const taken = takenColors.includes(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => !taken && setColor(key)}
                      disabled={taken}
                      style={{
                        width: 36, height: 36, borderRadius: '50%', padding: 0,
                        background: hex,
                        border: color === key ? '3px solid white' : '3px solid transparent',
                        outline: color === key ? `2px solid ${hex}` : 'none',
                        opacity: taken ? 0.3 : 1,
                      }}
                    />
                  )
                })}
              </div>
            </div>
            <button type="submit" className="btn-primary" style={{ width: '100%' }}>
              Join →
            </button>
          </form>
        </div>
      </div>
    )
  }

  function handleLogout() {
    connRef.current?.invoke('PlayerLeave').catch(() => {})
    localStorage.removeItem('st_name')
    localStorage.removeItem('st_color')
    localStorage.removeItem('st_room')
    setPhase('join')
  }

  if (phase === 'lobby') {
    return (
      <div className="page" style={{ alignItems: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 8 }}>Lobby</h1>
        {roomCode && (
          <div style={{ fontSize: '1.1rem', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 4, color: 'var(--accent-light)', marginBottom: 8 }}>
            Room: {roomCode}
          </div>
        )}
        <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Waiting for host to start the game…</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          {players.map(p => (
            <div
              key={p.SocketId}
              style={{
                background: PLAYER_COLORS[p.Color] + '22',
                border: `2px solid ${PLAYER_COLORS[p.Color]}`,
                borderRadius: 12, padding: '10px 18px',
                color: PLAYER_COLORS[p.Color], fontWeight: 600,
              }}
            >
              {p.Name}
            </div>
          ))}
        </div>
        <button
          className="btn-secondary"
          style={{ marginTop: 40, fontSize: '0.85rem', padding: '6px 16px', color: 'var(--text-muted)' }}
          onClick={handleLogout}
        >
          ↩ Change name / room
        </button>
      </div>
    )
  }

  if (phase === 'ended') {
    const sorted = [...finalScores].sort((a, b) => b.Score - a.Score)
    return (
      <div className="page" style={{ alignItems: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 8 }}>Game Over!</h1>
        <div style={{ width: '100%', maxWidth: 400, marginTop: 24 }}>
          {sorted.map((p, i) => (
            <div
              key={p.SocketId}
              className="card"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
                borderColor: PLAYER_COLORS[p.Color],
              }}
            >
              <span style={{ fontSize: '1.5rem', width: 32, textAlign: 'center' }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: PLAYER_COLORS[p.Color] }}>{p.Name}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{p.Score}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Active game
  return (
    <div className="page" style={{ alignItems: 'center' }}>
      {/* Score strip */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 20 }}>
        {players.map(p => (
          <div
            key={p.SocketId}
            style={{
              padding: '4px 12px', borderRadius: 20,
              background: PLAYER_COLORS[p.Color] + (p.SocketId === myId ? 'ff' : '33'),
              color: p.SocketId === myId ? '#fff' : PLAYER_COLORS[p.Color],
              fontWeight: 600, fontSize: '0.875rem',
            }}
          >
            {p.Name}: {p.Score}
          </div>
        ))}
      </div>

      {/* Round info */}
      {currentCard && (
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            {currentCard.Label} — Song {songIndex + 1}/{totalSongs}
          </div>
          {buzzedPlayer && roundPhase === 'buzzed' && (
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: PLAYER_COLORS[buzzedPlayer.Color] }}>
              🎤 {buzzedPlayer.Name} buzzed!
            </div>
          )}
          {revealInfo && roundPhase === 'reveal' && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {revealInfo.SongName}
              </div>
              <div style={{ color: 'var(--text-muted)' }}>{revealInfo.SongArtist}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{revealInfo.AnimeName}</div>
              {revealInfo.PointsAwarded > 0 && revealInfo.WinnerId && (
                <div style={{ color: 'var(--green)', fontWeight: 600, marginTop: 4 }}>
                  +{revealInfo.PointsAwarded}{revealInfo.WinnerId === currentPickerId ? ' 🌟×2' : ''} pts → {players.find(p => p.SocketId === revealInfo.WinnerId)?.Name}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Picker strip */}
      {pickOrder.length > 0 && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 4 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Picking order</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {pickOrder.map((id, i) => {
              const p = players.find(x => x.SocketId === id)
              if (!p) return null
              const isCurrent = id === currentPickerId
              const isMe = id === myId
              return (
                <div key={id} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 20, fontSize: '0.78rem',
                  background: isCurrent ? PLAYER_COLORS[p.Color] : PLAYER_COLORS[p.Color] + '22',
                  border: `2px solid ${PLAYER_COLORS[p.Color]}`,
                  color: isCurrent ? '#fff' : PLAYER_COLORS[p.Color],
                  fontWeight: isCurrent ? 700 : 400,
                  opacity: isCurrent ? 1 : 0.5,
                }}>
                  <span style={{ opacity: 0.7, fontSize: '0.65rem' }}>{i + 1}.</span>
                  {p.Name}{isMe ? ' (you)' : ''}
                  {isCurrent && <span>🎯</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Current card only */}
      {currentCard && (
        <div style={{
          background: 'var(--accent)', border: '2px solid var(--accent-light)',
          borderRadius: 12, padding: '12px 24px', textAlign: 'center', marginBottom: 24,
        }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{currentCard.Label}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--accent-light)' }}>{'★'.repeat(currentCard.Stars)}</div>
        </div>
      )}

      {/* Timer bar — shown during guess/buzzed */}
      {(roundPhase === 'guess' || roundPhase === 'buzzed') && timeLeft > 0 && (
        <div style={{ width: '100%', maxWidth: 360, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Time</span>
            <span style={{ fontWeight: 700, color: timerColor, fontVariantNumeric: 'tabular-nums' }}>{timeLeft}s</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 4, background: timerColor, width: `${timerPct * 100}%`, transition: 'width 0.9s linear, background 0.5s' }} />
          </div>
        </div>
      )}

      {/* Buzz button */}
      <button
        className={canBuzz ? 'btn-primary' : 'btn-secondary'}
        style={{
          width: '100%', maxWidth: 360, padding: '18px',
          fontSize: '1.25rem', fontWeight: 700, letterSpacing: 1,
          borderRadius: 16,
        }}
        disabled={!canBuzz}
        onClick={buzz}
      >
        {roundPhase === 'idle' ? 'Waiting…'
          : timedOut ? "⏰ Time's up"
          : roundPhase === 'guess' ? '🔔 BUZZ'
          : roundPhase === 'buzzed' ? 'Buzzed!'
          : '…'}
      </button>
      {canBuzz && (
        <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          or press <kbd style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>Space</kbd> / <kbd style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>Enter</kbd>
        </div>
      )}
    </div>
  )
}
