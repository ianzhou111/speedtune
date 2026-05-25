import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as signalR from '@microsoft/signalr'
import { getToken } from '../lib/api'
import { gamesApi, sessionsApi, isAuthenticated } from '../lib/api'
import type {
  SessionState, Player, CardSummary, Game,
  RoundSongStartPayload, RoundAnswerRevealPayload,
  RoundAnswerHintPayload, ScoresUpdatePayload, GameEndedPayload,
} from '../lib/types'
import { PLAYER_COLORS } from '../lib/types'

interface AnswerHint { AnimeName: string; SongName: string; SongArtist: string }

export default function HostPage() {
  const navigate = useNavigate()
  const connRef = useRef<signalR.HubConnection | null>(null)

  // Auth
  useEffect(() => {
    if (!isAuthenticated()) navigate('/login')
  }, [navigate])

  // Session setup
  const [games, setGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState('')
  const [creatingSession, setCreatingSession] = useState(false)
  const [sessionError, setSessionError] = useState('')

  // Game state
  const [status, setStatus] = useState<'no-session' | 'lobby' | 'active' | 'ended'>('no-session')
  const [players, setPlayers] = useState<Player[]>([])
  const [cards, setCards] = useState<CardSummary[]>([])
  const [currentCardId, setCurrentCardId] = useState<string | null>(null)
  const [songIndex, setSongIndex] = useState(0)
  const [totalSongs, setTotalSongs] = useState(0)
  const [roundPhase, setRoundPhase] = useState<'idle' | 'guess' | 'buzzed' | 'reveal'>('idle')
  const [buzzedPlayer, setBuzzedPlayer] = useState<Player | null>(null)
  const [answerHint, setAnswerHint] = useState<AnswerHint | null>(null)
  const [reveal, setReveal] = useState<RoundAnswerRevealPayload | null>(null)
  const [audioPaused, setAudioPaused] = useState(false)
  const [editingScore, setEditingScore] = useState<{ playerId: string; value: string } | null>(null)

  function commitScore(playerId: string, raw: string) {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) invoke('HostSetScore', playerId, n)
    setEditingScore(null)
  }

  useEffect(() => {
    gamesApi.list()
      .then(data => setGames(Array.isArray(data) ? data : []))
      .catch(err => console.error('[HostPage] games load failed:', err))

    // Dedicated authenticated connection — not shared with player/display pages.
    const conn = new signalR.HubConnectionBuilder()
      .withUrl('/hub', { accessTokenFactory: () => getToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    connRef.current = conn

    conn.on('SessionState', (state: SessionState | null) => {
      if (!state) return
      setPlayers(state.Players ?? [])
      setCards(state.Cards ?? [])
      if (state.Status === 'active') {
        setStatus('active')
        if (state.CurrentRound) {
          const cr = state.CurrentRound
          setCurrentCardId(cr.CardId)
          setSongIndex(cr.SongIndex)
          setTotalSongs(cr.TotalSongs)
          setRoundPhase(cr.Phase as 'idle' | 'guess' | 'buzzed' | 'reveal')
          setBuzzedPlayer(cr.BuzzedPlayer ? state.Players.find(p => p.SocketId === cr.BuzzedPlayer!.SocketId) ?? null : null)
        }
      } else if (state.Status === 'lobby') {
        setStatus('lobby')
      } else if (state.Status === 'ended') {
        setStatus('ended')
      }
    })

    conn.on('LobbyPlayerJoined', ({ Player: p }: { Player: Player }) =>
      setPlayers(prev => [...prev.filter(x => x.SocketId !== p.SocketId), p]))
    conn.on('LobbyPlayerLeft', ({ PlayerId }: { PlayerId: string }) =>
      setPlayers(prev => prev.filter(p => p.SocketId !== PlayerId)))
    conn.on('GameStarted', () => { setStatus('active'); setRoundPhase('idle') })
    conn.on('RoundSongStart', (p: RoundSongStartPayload) => {
      setCurrentCardId(p.CardId); setSongIndex(p.SongIndex); setTotalSongs(p.TotalSongs)
      setRoundPhase('guess'); setBuzzedPlayer(null); setReveal(null); setAudioPaused(false)
    })
    conn.on('RoundAnswerHint', (hint: RoundAnswerHintPayload) => setAnswerHint(hint))
    conn.on('RoundBuzz', ({ Player: p }: { Player: Player }) => { setBuzzedPlayer(p); setRoundPhase('buzzed') })
    conn.on('RoundAnswerReveal', (p: RoundAnswerRevealPayload) => { setReveal(p); setRoundPhase('reveal'); setAnswerHint(null) })
    conn.on('RoundCardComplete', () => {
      setCurrentCardId(null); setRoundPhase('idle'); setAnswerHint(null); setReveal(null); setBuzzedPlayer(null)
      conn.invoke('HostJoin').catch(() => {})
    })
    conn.on('ScoresUpdate', ({ Scores }: ScoresUpdatePayload) => setPlayers(Scores))
    conn.on('CardsUpdate', ({ Cards }: { Cards: CardSummary[] }) => setCards(Cards ?? []))
    conn.on('GameEnded', (p: GameEndedPayload) => { setPlayers(p.FinalScores); setStatus('ended') })

    // Start and join host group
    conn.start()
      .then(() => conn.invoke('HostJoin').catch(() => {}))
      .catch(err => console.error('[HostPage] SignalR start failed:', err))

    return () => {
      conn.stop()
      connRef.current = null
    }
  }, [])

  // ── Session creation ────────────────────────────────────────────────────

  async function createSession() {
    if (!selectedGameId) return
    setCreatingSession(true)
    setSessionError('')
    try {
      await sessionsApi.create(selectedGameId)
      setStatus('lobby')
      setPlayers([])
      setCards([])
      connRef.current?.invoke('HostJoin').catch(() => {})
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreatingSession(false)
    }
  }

  // ── Hub actions ─────────────────────────────────────────────────────────

  const invoke = (method: string, ...args: unknown[]) =>
    connRef.current?.invoke(method, ...args).catch(console.error)

  const currentCard = cards.find(c => c.Id === currentCardId)

  // ── No session ──────────────────────────────────────────────────────────
  if (status === 'no-session') {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 400 }}>
          <h2 style={{ marginBottom: 4 }}>Host Panel</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: 20 }}>
            Create a new game session to get started.
          </p>
          <div style={{ marginBottom: 16 }}>
            <label>Select game</label>
            <select value={selectedGameId} onChange={e => setSelectedGameId(e.target.value)}>
              <option value="">— choose a game —</option>
              {games.map(g => <option key={g.Id} value={g.Id}>{g.Name}</option>)}
            </select>
            {games.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>
                No games yet. <Link to="/admin">Create one in Admin →</Link>
              </p>
            )}
          </div>
          <button
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={!selectedGameId || creatingSession}
            onClick={createSession}
          >
            {creatingSession ? 'Creating…' : 'Create Session →'}
          </button>
          {sessionError && (
            <p style={{ color: 'var(--red)', fontSize: '0.875rem', marginTop: 10 }}>{sessionError}</p>
          )}
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <Link to="/admin">Manage games</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Ended ───────────────────────────────────────────────────────────────
  if (status === 'ended') {
    const sorted = [...players].sort((a, b) => b.Score - a.Score)
    return (
      <div className="page" style={{ alignItems: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 24 }}>Game Over — Final Scores</h1>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {sorted.map((p, i) => (
            <div key={p.SocketId} className="card" style={{ display: 'flex', gap: 12, marginBottom: 8, borderColor: PLAYER_COLORS[p.Color] }}>
              <span style={{ width: 32 }}>{i + 1}.</span>
              <span style={{ flex: 1, color: PLAYER_COLORS[p.Color], fontWeight: 600 }}>{p.Name}</span>
              <span style={{ fontWeight: 700 }}>{p.Score}</span>
            </div>
          ))}
        </div>
        <button className="btn-secondary" style={{ marginTop: 24 }} onClick={() => setStatus('no-session')}>
          New Session
        </button>
      </div>
    )
  }

  // ── Lobby / Active ───────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>SpeedTune Host</span>
          <span style={{
            fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: 20,
            background: status === 'lobby' ? 'var(--surface2)' : 'var(--accent)',
            color: status === 'lobby' ? 'var(--text-muted)' : '#fff',
            border: '1px solid var(--border)',
          }}>
            {status === 'lobby' ? 'LOBBY' : 'LIVE'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin" style={{ fontSize: '0.85rem' }}>Admin</Link>
          {status === 'lobby' && (
            <button
              style={{ background: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
              onClick={() => { if (confirm('End this session and go back to setup?')) invoke('HostEndGame') }}
            >
              End Session
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left sidebar: players */}
        <div style={{
          width: 220, flexShrink: 0, padding: 16,
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 8,
          overflowY: 'auto',
        }}>
          <div style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Players ({players.length})
          </div>

          {players.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
              No players yet
            </div>
          )}

          {players.map(p => (
            <div
              key={p.SocketId}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 8, background: 'var(--surface)',
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: PLAYER_COLORS[p.Color], flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 500 }}>{p.Name}</span>
              {editingScore?.playerId === p.SocketId ? (
                <input
                  type="number"
                  value={editingScore.value}
                  onChange={e => setEditingScore({ playerId: p.SocketId, value: e.target.value })}
                  onBlur={() => commitScore(p.SocketId, editingScore.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitScore(p.SocketId, editingScore.value)
                    if (e.key === 'Escape') setEditingScore(null)
                  }}
                  autoFocus
                  style={{ width: 64, padding: '2px 6px', fontSize: '0.85rem', textAlign: 'right' }}
                />
              ) : (
                <span
                  onClick={() => setEditingScore({ playerId: p.SocketId, value: String(p.Score) })}
                  title="Click to edit score"
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', borderBottom: '1px dashed var(--border)', paddingBottom: 1 }}
                >{p.Score}</span>
              )}
              {status === 'lobby' && (
                <button
                  style={{ background: 'none', color: 'var(--red)', padding: '2px 4px', fontSize: '0.8rem' }}
                  onClick={() => invoke('HostKickPlayer', p.SocketId)}
                  title="Kick"
                >✕</button>
              )}
            </div>
          ))}

          {status === 'lobby' && (
            <button
              className="btn-success"
              style={{ marginTop: 'auto', width: '100%' }}
              disabled={players.length === 0}
              onClick={() => invoke('HostStartGame')}
            >
              ▶ Start Game
            </button>
          )}

          {status === 'active' && (
            <button
              className="btn-danger"
              style={{ marginTop: 'auto', width: '100%' }}
              onClick={() => { if (confirm('End the game?')) invoke('HostEndGame') }}
            >
              End Game
            </button>
          )}
        </div>

        {/* Main area */}
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

          {/* Answer hint (host only, during guess/buzzed phase) */}
          {answerHint && (roundPhase === 'guess' || roundPhase === 'buzzed') && (
            <div style={{
              background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px',
              borderLeft: '4px solid var(--accent)',
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Answer (host only)</div>
              <div style={{ fontWeight: 800, fontSize: '1.3rem', color: 'var(--accent-light)', marginBottom: 3 }}>{answerHint.AnimeName}</div>
              <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--text)' }}>{answerHint.SongName}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{answerHint.SongArtist}</div>
            </div>
          )}

          {/* Round control */}
          {currentCard && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{currentCard.Label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Song {songIndex + 1} / {totalSongs} · {'★'.repeat(currentCard.Stars)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(roundPhase === 'guess' || roundPhase === 'reveal') && (
                    <button
                      className="btn-secondary"
                      style={{ padding: '6px 14px' }}
                      onClick={() => {
                        if (audioPaused) {
                          invoke('HostResumeAudio')
                          setAudioPaused(false)
                        } else {
                          invoke('HostPauseAudio')
                          setAudioPaused(true)
                        }
                      }}
                    >
                      {audioPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                  )}
                  {roundPhase === 'guess' && (
                    <button className="btn-secondary" style={{ padding: '6px 14px' }} onClick={() => invoke('HostSkip')}>
                      Skip
                    </button>
                  )}
                </div>
              </div>

              {/* Buzzed state */}
              {roundPhase === 'buzzed' && buzzedPlayer && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: PLAYER_COLORS[buzzedPlayer.Color], marginBottom: 10 }}>
                    🎤 {buzzedPlayer.Name} buzzed!
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn-success" onClick={() => invoke('HostJudge', true)}>✓ Correct</button>
                    <button className="btn-danger" onClick={() => invoke('HostJudge', false)}>✗ Wrong</button>
                  </div>
                </div>
              )}

              {/* Reveal state */}
              {roundPhase === 'reveal' && reveal && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ padding: '12px 14px', background: 'var(--surface2)', borderRadius: 8, marginBottom: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--accent-light)', marginBottom: 2 }}>{reveal.AnimeName}</div>
                    <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--text)' }}>{reveal.SongName}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{reveal.SongArtist}</div>
                    {reveal.PointsAwarded > 0 && (
                      <div style={{ color: 'var(--green)', marginTop: 6, fontWeight: 600 }}>
                        +{reveal.PointsAwarded} → {players.find(p => p.SocketId === reveal.WinnerId)?.Name}
                      </div>
                    )}
                  </div>
                  <button className="btn-primary" style={{ width: '100%' }} onClick={() => invoke('HostNextSong')}>
                    ▶ Next Song
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Card grid */}
          {status === 'active' && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 10, color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase' }}>
                Board — click to open a card
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 8,
              }}>
                {cards.map(c => {
                  const complete = c.PlayedCount >= c.TotalSongs
                  const active = c.Id === currentCardId
                  return (
                    <button
                      key={c.Id}
                      disabled={complete || active || roundPhase !== 'idle'}
                      onClick={() => invoke('HostOpenCard', c.Id)}
                      style={{
                        background: active ? 'var(--accent)' : complete ? 'var(--surface2)' : 'var(--surface)',
                        border: `2px solid ${active ? 'var(--accent-light)' : 'var(--border)'}`,
                        borderRadius: 10, padding: '10px 6px',
                        color: 'var(--text)', textAlign: 'center',
                        opacity: complete ? 0.35 : 1,
                        cursor: complete || active || roundPhase !== 'idle' ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.Label}</div>
                      <div style={{ color: 'var(--yellow)', fontSize: '0.8rem' }}>{'★'.repeat(c.Stars)}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: 2 }}>
                        {c.PlayedCount}/{c.TotalSongs}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {status === 'lobby' && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              flex: 1, gap: 12, color: 'var(--text-muted)',
            }}>
              <div style={{ fontSize: '2rem' }}>⏳</div>
              <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text)' }}>Waiting for players</div>
              <div style={{ fontSize: '0.9rem' }}>
                Players join at <strong style={{ color: 'var(--accent-light)' }}>{window.location.origin}</strong>
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                Start the game once everyone has joined.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
