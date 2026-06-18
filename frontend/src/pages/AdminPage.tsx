import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { gamesApi, storageModeApi, isAuthenticated } from '../lib/api'
import type { Game } from '../lib/types'
import type { StorageModeStatus } from '../lib/api'

export default function AdminPage() {
  const navigate = useNavigate()
  const [games, setGames] = useState<Game[]>([])
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [storageMode, setStorageMode] = useState<StorageModeStatus | null>(null)
  const [switchingMode, setSwitchingMode] = useState(false)
  const [localIds, setLocalIds] = useState<Set<string>>(new Set())
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/login'); return }
    gamesApi.list().then(setGames).finally(() => setLoading(false))
    storageModeApi.get().then(mode => {
      setStorageMode(mode)
      // Pre-fetch local IDs so we can show which cloud games are already saved locally
      if (mode.MongoAvailable)
        storageModeApi.getLocalIds().then(ids => setLocalIds(new Set(ids))).catch(() => {})
    }).catch(() => {})
  }, [navigate])

  async function downloadGame(gameId: string) {
    setDownloadingId(gameId)
    try {
      await storageModeApi.downloadToLocal(gameId)
      setLocalIds(prev => new Set([...prev, gameId]))
    } finally {
      setDownloadingId(null)
    }
  }

  async function toggleStorageMode() {
    if (!storageMode) return
    const next = storageMode.Mode === 'local' ? 'mongo' : 'local'
    setSwitchingMode(true)
    try {
      await storageModeApi.set(next)
      setStorageMode(s => s ? { ...s, Mode: next } : s)
      // Reload game list from the new backend
      setLoading(true)
      gamesApi.list().then(setGames).finally(() => setLoading(false))
    } finally {
      setSwitchingMode(false)
    }
  }

  async function createGame(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const game = await gamesApi.create(newName.trim())
      navigate(`/admin/games/${game.Id}`)
    } finally {
      setCreating(false)
    }
  }

  async function duplicateGame(id: string) {
    setCopyingId(id)
    try {
      const copy = await gamesApi.duplicate(id)
      setGames(g => [copy, ...g])
      navigate(`/admin/games/${copy.Id}`)
    } finally {
      setCopyingId(null)
    }
  }

  async function deleteGame(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    await gamesApi.delete(id)
    setGames(g => g.filter(x => x.Id !== id))
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.75rem', color: 'var(--text)' }}>Games</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>

          {/* Storage mode toggle — only shown when both backends are available */}
          {storageMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Storage</span>
              {storageMode.MongoAvailable ? (
                <button
                  onClick={toggleStorageMode}
                  disabled={switchingMode}
                  title={storageMode.Mode === 'local' ? 'Switch to MongoDB' : 'Switch to local JSON files'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                    fontSize: '0.8rem', fontWeight: 600,
                    color: storageMode.Mode === 'mongo' ? 'var(--accent-light)' : 'var(--green)',
                  }}
                >
                  {switchingMode ? '…' : storageMode.Mode === 'local' ? '💾 Local' : '☁️ Cloud'}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>↕</span>
                </button>
              ) : (
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--green)' }}>💾 Local</span>
              )}
            </div>
          )}

          <Link to="/host">
            <button className="btn-secondary">Host Panel</button>
          </Link>
        </div>
      </div>

      {/* Create game form */}
      <form onSubmit={createGame} style={{ display: 'flex', gap: 10, marginBottom: 28 }}>
        <input
          placeholder="New game name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn-primary" disabled={creating || !newName.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {games.map(game => (
          <div
            key={game.Id}
            className="card"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{game.Name}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {game.Cards.length} cards · {game.Cards.reduce((n, c) => n + c.Songs.length, 0)} songs
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Download to local — only in Cloud mode */}
              {storageMode?.Mode === 'mongo' && (
                localIds.has(game.Id) ? (
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600,
                    color: 'var(--green)', padding: '6px 10px',
                    border: '1px solid var(--green)', borderRadius: 6,
                  }}>
                    ✓ Saved locally
                  </span>
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 14px' }}
                    disabled={downloadingId === game.Id}
                    onClick={() => downloadGame(game.Id)}
                    title="Save a copy to local storage for offline use"
                  >
                    {downloadingId === game.Id ? 'Saving…' : '⬇ Save local'}
                  </button>
                )
              )}
              <Link to={`/admin/games/${game.Id}`}>
                <button className="btn-secondary" style={{ padding: '6px 14px' }}>Edit</button>
              </Link>
              <button
                className="btn-secondary"
                style={{ padding: '6px 14px' }}
                disabled={copyingId === game.Id}
                onClick={() => duplicateGame(game.Id)}
                title="Duplicate this game"
              >
                {copyingId === game.Id ? 'Copying…' : '⧉ Copy'}
              </button>
              <button
                className="btn-danger"
                style={{ padding: '6px 14px' }}
                onClick={() => deleteGame(game.Id, game.Name)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {!loading && games.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
            No games yet. Create one above.
          </p>
        )}
      </div>
    </div>
  )
}
