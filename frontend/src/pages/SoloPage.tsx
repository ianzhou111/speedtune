import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

interface Settings {
  source: 'mal' | 'anilist'
  username: string
  clipDuration: number
  startPosition: 'beginning' | 'random'
  songCount: number
  wantOp: boolean
  wantEd: boolean
  wantInsert: boolean
  listFilter: 'completed' | 'both'
}

interface QueueItem {
  animeName: string
  songName: string
  songArtist: string
  songType: string
  videoUrl: string
  startPercent: number
  result?: 'correct' | 'incorrect'
}

interface SongEntry {
  animeName: string
  songName: string
  songArtist: string
  songType: string
  videoUrl: string
  songLength: number
}

type Phase = 'settings' | 'loading' | 'game' | 'results'
type GamePhase = 'playing' | 'reveal'

const DEFAULTS: Settings = {
  source: 'mal',
  username: '',
  clipDuration: 30,
  startPosition: 'random',
  songCount: 25,
  wantOp: true,
  wantEd: true,
  wantInsert: false,
  listFilter: 'both',
}

function loadSettings(): Settings {
  try {
    const s = localStorage.getItem('solo_settings')
    if (s) return { ...DEFAULTS, ...JSON.parse(s) }
  } catch { /* ignore */ }
  return DEFAULTS
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SoloPage() {
  const [phase, setPhase] = useState<Phase>('settings')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Rendering state for game
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [gamePhase, setGamePhase] = useState<GamePhase>('playing')
  const [clipProgress, setClipProgress] = useState(0) // 0–1

  // Refs for imperative game logic (safe to use inside closures)
  const videoRef        = useRef<HTMLVideoElement>(null)
  const queueRef        = useRef<QueueItem[]>([])
  const currentIdxRef   = useRef(0)
  const gamePhasRef     = useRef<GamePhase>('playing')
  const clipTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clipDurationRef = useRef(settings.clipDuration)
  const clipStartRef    = useRef(0)

  // Persist settings + keep duration ref in sync
  useEffect(() => {
    clipDurationRef.current = settings.clipDuration
    localStorage.setItem('solo_settings', JSON.stringify(settings))
  }, [settings])

  function set<K extends keyof Settings>(key: K, val: Settings[K]) {
    setSettings(s => ({ ...s, [key]: val }))
  }

  // ── MediaSession ────────────────────────────────────────────────────────

  function updateMediaSession(gp: GamePhase, idx: number, total: number, animeName = '?') {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.metadata = new MediaMetadata({
      title:  `Song ${idx + 1} / ${total}`,
      artist: 'SpeedTune Solo',
      album:  gp === 'reveal' ? animeName : '—',
    })
    if (gp === 'playing') {
      ms.setActionHandler('nexttrack',   () => skipToReveal())
      ms.setActionHandler('previoustrack', null)
    } else {
      ms.setActionHandler('nexttrack',     () => doRecord('correct'))
      ms.setActionHandler('previoustrack', () => doRecord('incorrect'))
    }
  }

  function clearMediaSession() {
    if (!navigator.mediaSession) return
    navigator.mediaSession.setActionHandler('nexttrack',     null)
    navigator.mediaSession.setActionHandler('previoustrack', null)
  }

  // ── Game logic ──────────────────────────────────────────────────────────

  function startSong(item: QueueItem, idx: number, total: number) {
    const vid = videoRef.current
    if (!vid) return

    if (clipTimerRef.current)    clearTimeout(clipTimerRef.current)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)

    gamePhasRef.current = 'playing'
    setGamePhase('playing')
    setClipProgress(0)
    updateMediaSession('playing', idx, total)

    const dur = clipDurationRef.current
    clipStartRef.current = Date.now()

    progressTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - clipStartRef.current) / 1000
      setClipProgress(Math.min(elapsed / dur, 1))
    }, 100)

    vid.volume = 1
    vid.muted  = false
    vid.src    = item.videoUrl
    vid.addEventListener('loadedmetadata', () => {
      if (item.startPercent > 0 && isFinite(vid.duration)) {
        vid.currentTime = (item.startPercent / 100) * vid.duration
      }
      vid.play().catch(() => {/* autoplay blocked — user will tap play */})
    }, { once: true })
    vid.load()

    clipTimerRef.current = setTimeout(() => {
      doReveal(item, idx, total)
    }, dur * 1000)
  }

  function doReveal(item: QueueItem, idx: number, total: number) {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null }
    setClipProgress(1)

    // Fade audio out over 400 ms
    const vid = videoRef.current
    if (vid) {
      let step = 0
      const fade = setInterval(() => {
        step++
        if (videoRef.current) videoRef.current.volume = Math.max(0, 1 - step / 8)
        if (step >= 8) {
          clearInterval(fade)
          if (videoRef.current) { videoRef.current.pause(); videoRef.current.volume = 1 }
        }
      }, 50)
    }

    // TTS fires after the fade
    setTimeout(() => speak(item.animeName), 500)

    gamePhasRef.current = 'reveal'
    setGamePhase('reveal')
    updateMediaSession('reveal', idx, total, item.animeName)
  }

  function skipToReveal() {
    if (gamePhasRef.current !== 'playing') return
    if (clipTimerRef.current) clearTimeout(clipTimerRef.current)
    const item = queueRef.current[currentIdxRef.current]
    if (item) doReveal(item, currentIdxRef.current, queueRef.current.length)
  }

  function doRecord(result: 'correct' | 'incorrect') {
    if (gamePhasRef.current !== 'reveal') return

    const idx = currentIdxRef.current
    const q   = [...queueRef.current]
    q[idx]    = { ...q[idx], result }
    queueRef.current = q
    setQueue([...q])

    const next = idx + 1
    if (next >= q.length) {
      clearMediaSession()
      setPhase('results')
      return
    }

    currentIdxRef.current = next
    setCurrentIdx(next)
    startSong(q[next], next, q.length)
  }

  function speak(text: string) {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.85
    window.speechSynthesis.speak(u)
  }

  // ── Queue building ──────────────────────────────────────────────────────

  async function buildQueue() {
    setError(null)
    setPhase('loading')

    // Clean up any ongoing game
    if (clipTimerRef.current)    clearTimeout(clipTimerRef.current)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    window.speechSynthesis?.cancel()

    try {
      // 1. Fetch anime list
      setLoadingMsg('Fetching your anime list…')
      const listRes = await fetch(
        `/api/solo/${settings.source}/${encodeURIComponent(settings.username.trim())}?filter=${settings.listFilter}`
      )
      if (!listRes.ok) {
        const body = await listRes.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message ?? `Failed to fetch anime list (${listRes.status})`)
      }
      const animeList: string[] = await listRes.json()

      if (animeList.length === 0)
        throw new Error('No anime found in your list. Check the username or try a different filter.')

      // 2. Shuffle and take 3× needed (handles coverage gaps)
      const needed   = settings.songCount
      const shuffled = [...animeList].sort(() => Math.random() - 0.5)
      const batch    = shuffled.slice(0, Math.min(needed * 3, shuffled.length))

      // 3. Batch-fetch songs
      setLoadingMsg(`Searching songs for ${batch.length} anime…`)
      const songsRes = await fetch('/api/solo/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animeTitles: batch,
          openings: settings.wantOp,
          endings:  settings.wantEd,
          inserts:  settings.wantInsert,
        }),
      })
      if (!songsRes.ok) throw new Error('Failed to search songs')

      const songsMap: Record<string, SongEntry[]> = await songsRes.json()

      // 4. Build queue: 1 random song per anime, no duplicates
      const built: QueueItem[] = []
      for (const songs of Object.values(songsMap)) {
        if (built.length >= needed) break
        if (songs.length === 0) continue

        const song = songs[Math.floor(Math.random() * songs.length)]
        const clipDur = clipDurationRef.current

        // Random start: pick anywhere in the first 70% of the available window
        const availableSec = Math.max(0, song.songLength - clipDur)
        const maxStartPct  = song.songLength > 0
          ? Math.floor((availableSec / song.songLength) * 100 * 0.7)
          : 0

        built.push({
          animeName:    song.animeName,
          songName:     song.songName,
          songArtist:   song.songArtist,
          songType:     song.songType,
          videoUrl:     song.videoUrl,
          startPercent: settings.startPosition === 'random' && maxStartPct > 0
            ? Math.floor(Math.random() * maxStartPct)
            : 0,
        })
      }

      if (built.length === 0)
        throw new Error('No songs found. Try enabling Openings, Endings, or Inserts.')

      const final = built.slice(0, needed).sort(() => Math.random() - 0.5)

      const foundFor = Object.keys(songsMap).length
      setLoadingMsg(`Found ${final.length} songs from ${foundFor} anime. Starting…`)
      await new Promise(r => setTimeout(r, 900))

      // 5. Set state and start
      queueRef.current    = final
      currentIdxRef.current = 0
      setQueue(final)
      setCurrentIdx(0)
      setPhase('game')

      // Video element mounts after setPhase → small delay before starting
      setTimeout(() => startSong(final[0], 0, final.length), 200)

    } catch (err) {
      setError((err as Error).message)
      setPhase('settings')
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const currentItem  = queue[currentIdx]
  const correctCount = queue.filter(i => i.result === 'correct').length

  // ── Settings screen ──────────────────────────────────────────────────────

  if (phase === 'settings') {
    const canStart = settings.username.trim().length > 0
      && (settings.wantOp || settings.wantEd || settings.wantInsert)

    return (
      <div className="page" style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: 4 }}>🎵 SpeedTune Solo</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Anime music quiz — hands-free, CarPlay-ready
          </p>
        </div>

        {error && (
          <div style={{
            background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8,
            padding: '10px 14px', marginBottom: 16, color: '#ef4444', fontSize: '0.875rem',
          }}>
            {error}
          </div>
        )}

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Source */}
          <SettingRow label="Anime list source">
            <ToggleGroup
              options={[{ value: 'mal', label: 'MyAnimeList' }, { value: 'anilist', label: 'AniList' }]}
              value={settings.source}
              onChange={v => set('source', v as 'mal' | 'anilist')}
            />
          </SettingRow>

          {/* Username */}
          <SettingRow label={settings.source === 'mal' ? 'MAL username' : 'AniList username'}>
            <input
              value={settings.username}
              onChange={e => set('username', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canStart && buildQueue()}
              placeholder="username"
              style={{ width: '100%' }}
              autoComplete="off"
              autoCapitalize="off"
            />
          </SettingRow>

          {/* List filter */}
          <SettingRow label="Include lists">
            <ToggleGroup
              options={[
                { value: 'both',      label: 'Completed + Watching' },
                { value: 'completed', label: 'Completed only' },
              ]}
              value={settings.listFilter}
              onChange={v => set('listFilter', v as 'completed' | 'both')}
            />
          </SettingRow>

          {/* Song types */}
          <SettingRow label="Song types">
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { key: 'wantOp'     as const, label: 'Openings' },
                { key: 'wantEd'     as const, label: 'Endings'  },
                { key: 'wantInsert' as const, label: 'Inserts'  },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => set(key, !settings[key])}
                  className={settings[key] ? 'btn-primary' : 'btn-secondary'}
                  style={{ flex: 1, padding: '8px', fontSize: '0.85rem' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </SettingRow>

          {/* Clip duration + song count */}
          <div style={{ display: 'flex', gap: 12 }}>
            <SettingRow label="Clip length (sec)" style={{ flex: 1 }}>
              <input
                type="number" min={1} max={60}
                value={settings.clipDuration}
                onChange={e => set('clipDuration', Math.min(60, Math.max(1, parseInt(e.target.value) || 30)))}
                style={{ width: '100%' }}
              />
            </SettingRow>
            <SettingRow label="Songs per session" style={{ flex: 1 }}>
              <input
                type="number" min={1} max={200}
                value={settings.songCount}
                onChange={e => set('songCount', Math.max(1, parseInt(e.target.value) || 25))}
                style={{ width: '100%' }}
              />
            </SettingRow>
          </div>

          {/* Start position */}
          <SettingRow label="Clip start position">
            <ToggleGroup
              options={[
                { value: 'random',    label: 'Random' },
                { value: 'beginning', label: 'Beginning' },
              ]}
              value={settings.startPosition}
              onChange={v => set('startPosition', v as 'beginning' | 'random')}
            />
          </SettingRow>

          <button
            className="btn-primary"
            style={{ padding: '12px', fontSize: '1rem', marginTop: 4 }}
            disabled={!canStart}
            onClick={buildQueue}
          >
            Build Queue & Start →
          </button>
        </div>
      </div>
    )
  }

  // ── Loading screen ───────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: 'var(--bg)',
      }}>
        <div style={{ fontSize: '3rem', animation: 'spin 1s linear infinite' }}>🎵</div>
        <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text)' }}>{loadingMsg}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>This may take a few seconds…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── Game screen ──────────────────────────────────────────────────────────

  if (phase === 'game') {
    return (
      <div style={{
        maxWidth: 500, margin: '0 auto', padding: '28px 16px',
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Hidden audio player */}
        <video ref={videoRef} style={{ display: 'none' }} playsInline />

        {/* Top bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 32, color: 'var(--text-muted)', fontSize: '0.875rem',
        }}>
          <span>
            Song{' '}
            <strong style={{ color: 'var(--text)', fontSize: '1rem' }}>{currentIdx + 1}</strong>
            {' '}/ {queue.length}
          </span>
          <span>✓ {correctCount} correct</span>
        </div>

        {/* ── Playing phase ── */}
        {gamePhase === 'playing' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 36,
          }}>
            {/* Giant note */}
            <div style={{ fontSize: '6rem', lineHeight: 1, userSelect: 'none' }}>🎵</div>

            {/* Progress bar */}
            <div style={{ width: '100%' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6,
              }}>
                <span>Playing clip…</span>
                <span>
                  {Math.round(clipProgress * settings.clipDuration)}s
                  {' '}/ {settings.clipDuration}s
                </span>
              </div>
              <div style={{
                height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', background: 'var(--accent)', borderRadius: 4,
                  width: `${clipProgress * 100}%`, transition: 'width 0.1s linear',
                }} />
              </div>
            </div>

            {/* Skip button */}
            <button
              className="btn-secondary"
              style={{ padding: '10px 28px', fontSize: '0.9rem' }}
              onClick={skipToReveal}
            >
              Skip → Reveal answer
            </button>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Steering wheel: <strong>Next</strong> to skip
            </div>
          </div>
        )}

        {/* ── Reveal phase ── */}
        {gamePhase === 'reveal' && currentItem && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 28,
          }}>
            {/* Answer */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '2rem', fontWeight: 800, lineHeight: 1.25,
                color: 'var(--text)', marginBottom: 10,
              }}>
                {currentItem.animeName}
              </div>
              <div style={{
                display: 'inline-block', background: 'var(--surface2)',
                borderRadius: 20, padding: '3px 12px',
                fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8,
              }}>
                {currentItem.songType}
              </div>
              <div style={{ fontSize: '1rem', color: 'var(--text)', fontWeight: 600 }}>
                {currentItem.songName}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {currentItem.songArtist}
              </div>
            </div>

            {/* Correct / Incorrect */}
            <div style={{ display: 'flex', gap: 14, width: '100%' }}>
              <button
                onClick={() => doRecord('correct')}
                style={{
                  flex: 1, padding: '22px 8px', fontSize: '1.4rem', fontWeight: 700,
                  background: '#22c55e18', border: '2px solid #22c55e',
                  borderRadius: 14, color: '#22c55e', cursor: 'pointer',
                }}
              >
                ✓ Got it
              </button>
              <button
                onClick={() => doRecord('incorrect')}
                style={{
                  flex: 1, padding: '22px 8px', fontSize: '1.4rem', fontWeight: 700,
                  background: '#ef444418', border: '2px solid #ef4444',
                  borderRadius: 14, color: '#ef4444', cursor: 'pointer',
                }}
              >
                ✗ Missed
              </button>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              Steering wheel: <strong>Next</strong> = Got it · <strong>Prev</strong> = Missed
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Results screen ───────────────────────────────────────────────────────

  const total   = queue.length
  const correct = queue.filter(i => i.result === 'correct').length
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0
  const medal   = pct >= 80 ? '🏆' : pct >= 60 ? '🎯' : pct >= 40 ? '📚' : '😅'

  return (
    <div className="page" style={{ maxWidth: 600, margin: '0 auto' }}>
      {/* Score summary */}
      <div style={{ textAlign: 'center', marginBottom: 32, paddingTop: 8 }}>
        <div style={{ fontSize: '3.5rem', marginBottom: 8 }}>{medal}</div>
        <div style={{ fontSize: '2.75rem', fontWeight: 800, lineHeight: 1 }}>
          {correct} / {total}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginTop: 6 }}>
          {pct}% correct
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <button
          className="btn-primary"
          style={{ flex: 1, padding: '10px' }}
          onClick={buildQueue}
        >
          Play Again (new queue)
        </button>
        <button
          className="btn-secondary"
          style={{ flex: 1, padding: '10px' }}
          onClick={() => setPhase('settings')}
        >
          Change Settings
        </button>
      </div>

      {/* Song list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {queue.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 8, background: 'var(--surface)',
              borderLeft: `4px solid ${item.result === 'correct' ? '#22c55e' : '#ef4444'}`,
            }}
          >
            <span style={{
              fontWeight: 700, fontSize: '1.1rem', flexShrink: 0,
              color: item.result === 'correct' ? '#22c55e' : '#ef4444',
            }}>
              {item.result === 'correct' ? '✓' : '✗'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.animeName}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.songType} · {item.songName} — {item.songArtist}
              </div>
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              #{i + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Small shared UI helpers ────────────────────────────────────────────────

function SettingRow({
  label, children, style,
}: {
  label: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={style}>
      <div style={{
        fontSize: '0.75rem', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function ToggleGroup({
  options, value, onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={value === o.value ? 'btn-primary' : 'btn-secondary'}
          style={{ flex: 1, padding: '8px', fontSize: '0.85rem' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
