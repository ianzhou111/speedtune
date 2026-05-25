import { useRef, useState } from 'react'

const SAMPLE_URLS = [
  { label: 'AMQ CDN (WebM)', url: 'https://naedist.animemusicquiz.com/t67ba8.webm' },
  { label: 'W3Schools MP4', url: 'https://www.w3schools.com/html/mov_bbb.mp4' },
  { label: 'MDN WebM', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm' },
]

export default function VideoTestPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [url, setUrl] = useState('https://naedist.animemusicquiz.com/t67ba8.webm')
  const [log, setLog] = useState<string[]>([])
  const [unlocked, setUnlocked] = useState(false)

  function addLog(msg: string) {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev])
  }

  function unlockAudio() {
    try {
      const ctx = new AudioContext()
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
      ctx.resume()
      addLog('AudioContext created and resumed ✓')
    } catch (e) {
      addLog(`AudioContext failed: ${e}`)
    }

    const vid = videoRef.current
    if (vid) {
      vid.muted = false
      vid.play().catch(() => {})
      vid.pause()
      addLog('Video primed via click handler ✓')
    }

    setUnlocked(true)
  }

  function playVideo() {
    const vid = videoRef.current
    if (!vid) { addLog('ERROR: video ref is null'); return }

    vid.src = url
    vid.muted = false
    addLog(`Setting src: ${url}`)
    vid.load()

    vid.play()
      .then(() => addLog('play() resolved — audio should be audible'))
      .catch(err => {
        addLog(`play() rejected: ${err.message}`)
        addLog('Retrying muted…')
        vid.muted = true
        vid.play()
          .then(() => addLog('muted play() resolved — no audio (autoplay blocked)'))
          .catch(e2 => addLog(`muted play() also failed: ${e2.message}`))
      })
  }

  function stopVideo() {
    const vid = videoRef.current
    if (!vid) return
    vid.pause()
    vid.src = ''
    addLog('Stopped')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#f0f0f0', padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>🎬 Video Playback Test</h1>
      <p style={{ color: '#888', marginBottom: 24, fontSize: '0.9rem' }}>
        Tests whether the browser can autoplay audio after an AudioContext unlock gesture.
      </p>

      {/* Step 1: Unlock */}
      <div style={{ marginBottom: 24, padding: 20, background: '#1a1a2e', borderRadius: 12, border: unlocked ? '1px solid #22c55e' : '1px solid #7c3aed' }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: unlocked ? '#22c55e' : '#a78bfa' }}>
          Step 1 — {unlocked ? '✓ Audio unlocked' : 'Click to unlock audio'}
        </div>
        <button
          onClick={unlockAudio}
          disabled={unlocked}
          style={{ padding: '10px 24px', background: unlocked ? '#374151' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: unlocked ? 'default' : 'pointer', fontSize: '1rem' }}
        >
          {unlocked ? 'Unlocked ✓' : '🔊 Unlock Audio'}
        </button>
      </div>

      {/* Step 2: URL + play */}
      <div style={{ marginBottom: 24, padding: 20, background: '#1a1a2e', borderRadius: 12, border: '1px solid #374151' }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Step 2 — Choose a video URL and play</div>

        <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SAMPLE_URLS.map(s => (
            <button
              key={s.url}
              onClick={() => setUrl(s.url)}
              style={{ padding: '6px 14px', background: url === s.url ? '#374151' : '#111', color: '#f0f0f0', border: `1px solid ${url === s.url ? '#7c3aed' : '#374151'}`, borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste any direct .mp4 / .webm URL"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', background: '#111', border: '1px solid #374151', borderRadius: 8, color: '#f0f0f0', fontSize: '0.9rem', marginBottom: 12 }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={playVideo}
            style={{ padding: '10px 28px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem', fontWeight: 700 }}
          >
            ▶ Play
          </button>
          <button
            onClick={stopVideo}
            style={{ padding: '10px 20px', background: '#374151', color: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem' }}
          >
            ■ Stop
          </button>
        </div>
      </div>

      {/* Video element */}
      <div style={{ marginBottom: 24 }}>
        <video
          ref={videoRef}
          style={{ width: '100%', maxWidth: 720, borderRadius: 12, background: '#000', display: 'block' }}
          controls
          onPlay={() => addLog('onPlay event fired')}
          onPause={() => addLog('onPause event fired')}
          onError={e => addLog(`onError: ${(e.target as HTMLVideoElement).error?.message ?? 'unknown'}`)}
          onCanPlay={() => addLog('onCanPlay — browser can start playback')}
        />
      </div>

      {/* Log */}
      <div style={{ background: '#0a0a0a', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: '0.8rem' }}>
        <div style={{ color: '#888', marginBottom: 8 }}>Console log</div>
        {log.length === 0 && <div style={{ color: '#555' }}>No events yet…</div>}
        {log.map((l, i) => (
          <div key={i} style={{ color: l.includes('ERROR') || l.includes('failed') ? '#ef4444' : l.includes('✓') ? '#22c55e' : '#f0f0f0', marginBottom: 2 }}>{l}</div>
        ))}
      </div>
    </div>
  )
}
