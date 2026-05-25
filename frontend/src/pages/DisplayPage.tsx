import { useEffect, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import { startConnection } from '../lib/signalr'
import type {
  SessionState, Player, CardSummary,
  RoundSongStartPayload, RoundAnswerRevealPayload, ScoresUpdatePayload, GameEndedPayload,
} from '../lib/types'
import { PLAYER_COLORS } from '../lib/types'

interface RevealInfo {
  AnimeName: string; SongName: string; SongArtist: string
  PointsAwarded: number; WinnerId: string | null; VideoUrl: string
}

export default function DisplayPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const connRef = useRef<signalR.HubConnection | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startPercentRef = useRef(0)

  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [status, setStatus] = useState<'lobby' | 'active' | 'ended'>('lobby')
  const [players, setPlayers] = useState<Player[]>([])
  const [cards, setCards] = useState<CardSummary[]>([])
  const [currentCardId, setCurrentCardId] = useState<string | null>(null)
  const [songIndex, setSongIndex] = useState(0)
  const [totalSongs, setTotalSongs] = useState(0)
  const [clipDuration, setClipDuration] = useState(60)
  const [startPercent, setStartPercent] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [roundPhase, setRoundPhase] = useState<'idle' | 'guess' | 'buzzed' | 'reveal'>('idle')
  const [buzzedPlayer, setBuzzedPlayer] = useState<{ SocketId: string; Name: string; Color: string } | null>(null)
  const [reveal, setReveal] = useState<RevealInfo | null>(null)
  const [videoVisible, setVideoVisible] = useState(false)
  const [finalScores, setFinalScores] = useState<Player[]>([])
  const [volume, setVolume] = useState(0.5)
  const [vidTime, setVidTime] = useState(0)
  const [vidDuration, setVidDuration] = useState(0)
  const [vidPlaying, setVidPlaying] = useState(false)

  function applyVolume(v: number) {
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
  }

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

  function unlockAudio() {
    setAudioUnlocked(true)
  }

  useEffect(() => {
    let active = true
    startConnection().then(conn => {
      if (!active) return
      connRef.current = conn

      conn.on('SessionState', (state: SessionState) => {
        setStatus(state.Status as 'lobby' | 'active' | 'ended')
        setPlayers(state.Players ?? [])
        setCards(state.Cards ?? [])
        if (state.CurrentRound) {
          const cr = state.CurrentRound
          setCurrentCardId(cr.CardId)
          setSongIndex(cr.SongIndex)
          setTotalSongs(cr.TotalSongs)
          setRoundPhase(cr.Phase as 'idle' | 'guess' | 'buzzed' | 'reveal')
          setBuzzedPlayer(cr.BuzzedPlayer)
        }
      })

      conn.on('LobbyPlayerJoined', ({ Player: p }: { Player: Player }) => {
        setPlayers(prev => [...prev.filter(x => x.SocketId !== p.SocketId), p])
      })
      conn.on('LobbyPlayerLeft', ({ PlayerId }: { PlayerId: string }) => {
        setPlayers(prev => prev.filter(p => p.SocketId !== PlayerId))
      })
      conn.on('GameStarted', () => { setStatus('active'); setRoundPhase('idle') })

      conn.on('RoundSongStart', (p: RoundSongStartPayload) => {
        setCurrentCardId(p.CardId)
        setSongIndex(p.SongIndex)
        setTotalSongs(p.TotalSongs)
        setClipDuration(p.ClipDuration)
        setStartPercent(p.StartPercent ?? 0)
        startPercentRef.current = p.StartPercent ?? 0
        setRoundPhase('guess')
        setBuzzedPlayer(null)
        setReveal(null)
        setVideoVisible(false)
        startTimer(p.ClipDuration)

        const vid = videoRef.current
        if (vid && p.VideoUrl) {
          vid.src = p.VideoUrl
          vid.volume = volume
          vid.muted = true
          // Seek to start position once metadata is ready, then play
          vid.addEventListener('loadedmetadata', () => {
            if (p.StartPercent > 0 && isFinite(vid.duration)) {
              vid.currentTime = (p.StartPercent / 100) * vid.duration
            }
            vid.play()
              .then(() => { vid.muted = false })
              .catch(() => {})
          }, { once: true })
          vid.load()
        }
      })

      conn.on('RoundBuzz', ({ Player: pl }: { Player: { SocketId: string; Name: string; Color: string } }) => {
        setBuzzedPlayer(pl)
        setRoundPhase('buzzed')
        clearTimer()
      })

      conn.on('RoundAudioPause', () => { videoRef.current?.pause() })
      conn.on('RoundAudioPlay',  () => { videoRef.current?.play().catch(() => {}) })

      conn.on('RoundAudioResume', () => {
        setBuzzedPlayer(null)
        setRoundPhase('guess')
        const vid = videoRef.current
        if (vid) {
          vid.muted = true
          vid.play().then(() => { vid.muted = false }).catch(() => {})
        }
        // Don't restart timer — player already guessed wrong
      })

      conn.on('RoundAnswerReveal', (p: RoundAnswerRevealPayload) => {
        setReveal(p)
        setRoundPhase('reveal')
        setVideoVisible(true)
        clearTimer()

        const vid = videoRef.current
        if (vid) {
          vid.volume = volume
          vid.muted = true
          if (p.VideoUrl && vid.src !== p.VideoUrl) {
            // Different src — need to load and seek
            vid.src = p.VideoUrl
            vid.addEventListener('loadedmetadata', () => {
              const pct = startPercentRef.current
              if (pct > 0 && isFinite(vid.duration)) {
                vid.currentTime = (pct / 100) * vid.duration
              }
              vid.play().then(() => { vid.muted = false }).catch(() => {})
            }, { once: true })
            vid.load()
          } else {
            // Same src already loaded — seek back to start position and resume
            const pct = startPercentRef.current
            if (pct > 0 && isFinite(vid.duration)) {
              vid.currentTime = (pct / 100) * vid.duration
            }
            vid.play().then(() => { vid.muted = false }).catch(() => {})
          }
        }
      })

      conn.on('RoundCardComplete', () => {
        setCurrentCardId(null)
        setRoundPhase('idle')
        setReveal(null)
        setBuzzedPlayer(null)
        setVideoVisible(false)
        clearTimer()
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = '' }
        conn.invoke('DisplayJoin').catch(() => {})
      })

      conn.on('ScoresUpdate', ({ Scores }: ScoresUpdatePayload) => setPlayers(Scores ?? []))
      conn.on('CardsUpdate', ({ Cards }: { Cards: CardSummary[] }) => setCards(Cards ?? []))

      conn.on('GameEnded', ({ FinalScores }: GameEndedPayload) => {
        setFinalScores(FinalScores ?? [])
        setStatus('ended')
        setVideoVisible(false)
        clearTimer()
        if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = '' }
      })

      conn.invoke('DisplayJoin').catch(() => {})
    })

    return () => {
      active = false
      clearTimer()
      const EVENTS = ['SessionState','LobbyPlayerJoined','LobbyPlayerLeft','GameStarted',
        'RoundSongStart','RoundBuzz','RoundAudioPause','RoundAudioPlay','RoundAudioResume','RoundAnswerReveal',
        'RoundCardComplete','ScoresUpdate','CardsUpdate','GameEnded']
      EVENTS.forEach(e => connRef.current?.off(e))
    }
  }, [])

  const sorted = [...players].sort((a, b) => b.Score - a.Score)

  function fmtTime(s: number) {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }
  const currentCard = cards.find(c => c.Id === currentCardId)

  // timer color: green → yellow → red
  const timerPct = clipDuration > 0 ? timeLeft / clipDuration : 0
  const timerColor = timerPct > 0.5 ? 'var(--green)' : timerPct > 0.25 ? 'var(--yellow)' : 'var(--red)'

  // ── AUDIO UNLOCK overlay ─────────────────────────────────────────────────
  if (!audioUnlocked) {
    return (
      <div
        onClick={unlockAudio}
        style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg)', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <video ref={videoRef} style={{ display: 'none' }} />
        <div style={{ fontSize: '4rem', marginBottom: 16 }}>🔊</div>
        <h1 style={{ fontSize: '2.5rem', marginBottom: 12 }}>SpeedTune</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem' }}>
          Click anywhere to enable audio
        </p>
      </div>
    )
  }

  // ── ENDED screen ─────────────────────────────────────────────────────────
  if (status === 'ended') {
    const fs = [...finalScores].sort((a, b) => b.Score - a.Score)
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <video ref={videoRef} style={{ display: 'none' }} />
        <h1 style={{ fontSize: '3rem', marginBottom: 32 }}>🏆 Game Over!</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 400 }}>
          {fs.map((p, i) => (
            <div key={p.SocketId} style={{ display: 'flex', alignItems: 'center', gap: 16, background: 'var(--surface)', borderRadius: 12, padding: '14px 20px', borderLeft: `6px solid ${PLAYER_COLORS[p.Color]}` }}>
              <span style={{ fontSize: '1.75rem', width: 40 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</span>
              <span style={{ flex: 1, fontWeight: 700, fontSize: '1.25rem', color: PLAYER_COLORS[p.Color] }}>{p.Name}</span>
              <span style={{ fontWeight: 800, fontSize: '1.5rem' }}>{p.Score}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── LOBBY screen ──────────────────────────────────────────────────────────
  if (status === 'lobby') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <video ref={videoRef} style={{ display: 'none' }} />
        <h1 style={{ fontSize: '3rem', marginBottom: 8 }}>SpeedTune</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 40, fontSize: '1.2rem' }}>Waiting for players…</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center', maxWidth: 700 }}>
          {players.map(p => (
            <div key={p.SocketId} style={{ padding: '10px 20px', borderRadius: 12, fontWeight: 700, fontSize: '1.1rem', background: PLAYER_COLORS[p.Color] + '22', border: `2px solid ${PLAYER_COLORS[p.Color]}`, color: PLAYER_COLORS[p.Color] }}>
              {p.Name}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── ACTIVE screen ─────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg)' }}>
      {/* Left: score board + volume */}
      <div style={{ width: 220, flexShrink: 0, padding: '20px 12px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Scores</div>
        {sorted.map((p, i) => (
          <div key={p.SocketId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: i === 0 ? PLAYER_COLORS[p.Color] + '22' : 'var(--surface)', borderLeft: `4px solid ${PLAYER_COLORS[p.Color]}` }}>
            <span style={{ flex: 1, fontWeight: 600, fontSize: '0.95rem', color: PLAYER_COLORS[p.Color] }}>{p.Name}</span>
            <span style={{ fontWeight: 700 }}>{p.Score}</span>
          </div>
        ))}

        {/* Volume control */}
        <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: '1rem' }}>{volume === 0 ? '🔇' : volume < 0.4 ? '🔉' : '🔊'}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Volume</span>
            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={volume}
            onChange={e => applyVolume(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* Center: main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24, gap: 16 }}>

        {/* Video + custom controls (hidden during guess, shown during reveal) */}
        <div style={{ width: '100%', maxWidth: 720, visibility: videoVisible ? 'visible' : 'hidden' }}>
          <video
            ref={videoRef}
            style={{ width: '100%', borderRadius: '12px 12px 0 0', background: '#000', display: 'block' }}
            playsInline
            onTimeUpdate={e => setVidTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => setVidDuration(e.currentTarget.duration)}
            onPlay={() => setVidPlaying(true)}
            onPause={() => setVidPlaying(false)}
          />
          {/* Controls bar */}
          <div style={{
            background: '#111', borderRadius: '0 0 12px 12px',
            padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {/* Progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {fmtTime(vidTime)}
              </span>
              <input
                type="range"
                min={0}
                max={vidDuration || 1}
                step={0.5}
                value={vidTime}
                onChange={e => {
                  const t = parseFloat(e.target.value)
                  if (videoRef.current) videoRef.current.currentTime = t
                  setVidTime(t)
                }}
                style={{ flex: 1, accentColor: 'var(--accent)', height: 4 }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {fmtTime(vidDuration)}
              </span>
            </div>
            {/* Play/pause + volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause() }}
                style={{ background: 'none', color: '#fff', fontSize: '1.1rem', padding: '2px 6px', border: '1px solid #333', borderRadius: 6, flexShrink: 0 }}
              >
                {vidPlaying ? '⏸' : '▶'}
              </button>
              <span style={{ fontSize: '0.75rem' }}>{volume === 0 ? '🔇' : volume < 0.4 ? '🔉' : '🔊'}</span>
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={volume}
                onChange={e => applyVolume(parseFloat(e.target.value))}
                style={{ width: 80, accentColor: 'var(--accent)' }}
              />
            </div>
          </div>
        </div>

        {/* Timer bar — shown during guess/buzzed */}
        {(roundPhase === 'guess' || roundPhase === 'buzzed') && timeLeft > 0 && (
          <div style={{ width: '100%', maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Time</span>
              <span style={{ fontWeight: 700, color: timerColor, fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums' }}>{timeLeft}s</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: 'var(--surface2)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: timerColor, width: `${timerPct * 100}%`, transition: 'width 0.9s linear, background 0.5s' }} />
            </div>
          </div>
        )}

        {/* Round overlay */}
        {roundPhase !== 'idle' && currentCard && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              {currentCard.Label} — {currentCard.Stars}★ — Song {songIndex + 1} / {totalSongs}
            </div>

            {roundPhase === 'buzzed' && buzzedPlayer && (
              <div style={{ fontSize: '2rem', fontWeight: 800, color: PLAYER_COLORS[buzzedPlayer.Color], marginTop: 8 }}>
                🎤 {buzzedPlayer.Name}!
              </div>
            )}

            {roundPhase === 'reveal' && reveal && (
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 800 }}>{reveal.SongName}</div>
                <div style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>{reveal.SongArtist}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{reveal.AnimeName}</div>
                {reveal.PointsAwarded > 0 && reveal.WinnerId && (
                  <div style={{ color: 'var(--green)', fontWeight: 700, marginTop: 8, fontSize: '1.1rem' }}>
                    +{reveal.PointsAwarded} → {players.find(p => p.SocketId === reveal.WinnerId)?.Name}
                  </div>
                )}
              </div>
            )}

            {roundPhase === 'guess' && (
              <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', marginTop: 4 }}>🎵 Listening…</div>
            )}
          </div>
        )}

        {/* Card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10, width: '100%', maxWidth: 720 }}>
          {cards.map(c => {
            const complete = c.PlayedCount >= c.TotalSongs
            const active = c.Id === currentCardId
            return (
              <div key={c.Id} style={{ background: active ? 'var(--accent)' : complete ? '#111' : 'var(--surface)', border: `2px solid ${active ? 'var(--accent-light)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 8px', textAlign: 'center', opacity: complete ? 0.35 : 1, transition: 'all 0.2s' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>{c.Label}</div>
                <div style={{ color: 'var(--yellow)', fontSize: '0.85rem' }}>{'★'.repeat(c.Stars)}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 2 }}>{c.PlayedCount}/{c.TotalSongs}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
