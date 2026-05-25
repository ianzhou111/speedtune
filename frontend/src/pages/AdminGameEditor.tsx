import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { gamesApi, searchAnisong, isAuthenticated } from '../lib/api'
import type { Game, Card, SongEntry } from '../lib/types'

const STARS = [1, 2, 3, 4, 5]

// ── Dual-range slider ────────────────────────────────────────────────────────

function DualRangeSlider({
  min, max, onChange,
}: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  const fillLeft = `${min}%`
  const fillWidth = `${max - min}%`

  function handleMin(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.min(+e.target.value, max)
    onChange(v, max)
  }
  function handleMax(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Math.max(+e.target.value, min)
    onChange(min, v)
  }

  return (
    <div>
      <div className="dual-range-wrap">
        <div className="dual-range-track" />
        <div className="dual-range-fill" style={{ left: fillLeft, width: fillWidth }} />
        <input type="range" min={0} max={100} value={min} onChange={handleMin} />
        <input type="range" min={0} max={100} value={max} onChange={handleMax} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
        <span>{min}%</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>start range</span>
        <span>{max}%</span>
      </div>
    </div>
  )
}

function Stars({ n, onClick }: { n: number; onClick?: (s: number) => void }) {
  return (
    <span>
      {STARS.map(s => (
        <span
          key={s}
          className="star"
          style={{ cursor: onClick ? 'pointer' : 'default', opacity: s <= n ? 1 : 0.2, fontSize: '1.1rem' }}
          onClick={() => onClick?.(s)}
        >★</span>
      ))}
    </span>
  )
}

export default function AdminGameEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [game, setGame] = useState<Game | null>(null)
  const [saving, setSaving] = useState(false)

  // Song search state
  const [searchAnime, setSearchAnime] = useState('')
  const [searchSong, setSearchSong] = useState('')
  const [searchArtist, setSearchArtist] = useState('')
  const [searchResults, setSearchResults] = useState<SongEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [targetCardId, setTargetCardId] = useState<string | null>(null)
  const [filterOpening, setFilterOpening] = useState(true)
  const [filterEnding, setFilterEnding] = useState(true)
  const [filterInsert, setFilterInsert] = useState(true)

  // Collapsed cards
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set())

  function toggleCollapse(cardId: string) {
    setCollapsedCards(prev => {
      const next = new Set(prev)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  // Preview player state
  const [previewSong, setPreviewSong] = useState<SongEntry | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) { navigate('/login'); return }
    if (!id) return
    gamesApi.get(id).then(setGame)
  }, [id, navigate])

  // ── Save entire game ────────────────────────────────────────────────────

  async function save(updated: Game) {
    setSaving(true)
    try {
      const result = await gamesApi.update(updated.Id, {
        name: updated.Name,
        settings: updated.Settings,
        cards: updated.Cards,
      })
      setGame(result)
    } finally {
      setSaving(false)
    }
  }

  // ── Card operations ─────────────────────────────────────────────────────

  function addCard() {
    if (!game) return
    const base = 'New Card'
    const existing = new Set(game.Cards.map(c => c.Label))
    let label = base
    let n = 1
    while (existing.has(label)) { label = `${base} ${n++}` }
    const newCard: Card = { Id: crypto.randomUUID(), Label: label, Stars: 1, Songs: [] }
    const updated = { ...game, Cards: [newCard, ...game.Cards] }
    setGame(updated)
  }

  function removeCard(cardId: string) {
    if (!game) return
    const updated = { ...game, Cards: game.Cards.filter(c => c.Id !== cardId) }
    setGame(updated)
  }

  function updateCard(cardId: string, patch: Partial<Card>) {
    if (!game) return
    const updated = {
      ...game,
      Cards: game.Cards.map(c => c.Id === cardId ? { ...c, ...patch } : c),
    }
    setGame(updated)
  }

  function removeSong(cardId: string, songIdx: number) {
    if (!game) return
    const updated = {
      ...game,
      Cards: game.Cards.map(c =>
        c.Id === cardId
          ? { ...c, Songs: c.Songs.filter((_, i) => i !== songIdx) }
          : c
      ),
    }
    setGame(updated)
  }

  function updateSong(cardId: string, songIdx: number, patch: Partial<SongEntry>) {
    if (!game) return
    const updated = {
      ...game,
      Cards: game.Cards.map(c =>
        c.Id === cardId
          ? { ...c, Songs: c.Songs.map((s, i) => i === songIdx ? { ...s, ...patch } : s) }
          : c
      ),
    }
    setGame(updated)
  }

  function addSongToCard(cardId: string, song: SongEntry) {
    if (!game) return
    // Auto-calculate start range: min=0, max=latest point where full clip still fits
    const clipDuration = game.Settings.ClipDuration
    const startMax = song.SongLength > clipDuration
      ? Math.max(0, Math.floor((1 - clipDuration / song.SongLength) * 100))
      : 0
    const songWithDefaults: SongEntry = { ...song, StartMin: 0, StartMax: startMax }
    const updated = {
      ...game,
      Cards: game.Cards.map(c =>
        c.Id === cardId ? { ...c, Songs: [...c.Songs, songWithDefaults] } : c
      ),
    }
    setGame(updated)
    // Keep search results and target card so the user can add more songs
  }

  // ── AnisongDB search ────────────────────────────────────────────────────

  async function doSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchAnime && !searchSong && !searchArtist) return
    setSearching(true)
    setSearchError('')
    try {
      const results = await searchAnisong({
        anime: searchAnime,
        song: searchSong,
        artist: searchArtist,
        opening: filterOpening,
        ending: filterEnding,
        insert: filterInsert,
      })
      const typeOrder = (t: string) => t.startsWith('Opening') ? 0 : t.startsWith('Ending') ? 1 : 2
      const sorted = [...results].sort((a, b) => {
        const type = typeOrder(a.SongType) - typeOrder(b.SongType)
        if (type !== 0) return type
        const anime = a.AnimeName.localeCompare(b.AnimeName)
        return anime !== 0 ? anime : a.SongName.localeCompare(b.SongName)
      })
      setSearchResults(sorted)
      if (!targetCardId && game.Cards.length > 0) setTargetCardId(game.Cards[0].Id)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  if (!game) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>Loading…</div>

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to="/admin"><button className="btn-secondary" style={{ padding: '6px 14px' }}>← Back</button></Link>
        <input
          value={game.Name}
          onChange={e => setGame({ ...game, Name: e.target.value })}
          style={{ flex: 1, fontSize: '1.25rem', fontWeight: 600 }}
        />
        <button
          className="btn-primary"
          onClick={() => save(game)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Settings */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 16, color: 'var(--text)' }}>Settings</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label>Clip duration (seconds)</label>
            <input
              type="number"
              value={game.Settings.ClipDuration}
              onChange={e => setGame({ ...game, Settings: { ...game.Settings, ClipDuration: +e.target.value } })}
            />
          </div>
          <div>
            <label>Wrong answer deduction</label>
            <input
              type="number"
              value={game.Settings.WrongAnswerDeduction}
              onChange={e => setGame({ ...game, Settings: { ...game.Settings, WrongAnswerDeduction: +e.target.value } })}
            />
          </div>
          {STARS.map(s => (
            <div key={s}>
              <label>{s}★ point value</label>
              <input
                type="number"
                value={game.Settings.StarPointMap[s] ?? s * 100}
                onChange={e => setGame({
                  ...game,
                  Settings: { ...game.Settings, StarPointMap: { ...game.Settings.StarPointMap, [s]: +e.target.value } }
                })}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Song search panel */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, color: 'var(--text)' }}>Search Songs (AnisongDB)</h3>
        <form onSubmit={doSearch} style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            placeholder="Anime title…"
            value={searchAnime}
            onChange={e => setSearchAnime(e.target.value)}
            style={{ flex: '1 1 180px' }}
          />
          <input
            placeholder="Song name…"
            value={searchSong}
            onChange={e => setSearchSong(e.target.value)}
            style={{ flex: '1 1 180px' }}
          />
          <input
            placeholder="Artist…"
            value={searchArtist}
            onChange={e => setSearchArtist(e.target.value)}
            style={{ flex: '1 1 180px' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, padding: '0 4px' }}>
            {([['OP', filterOpening, setFilterOpening], ['ED', filterEnding, setFilterEnding], ['IN', filterInsert, setFilterInsert]] as const).map(([label, val, set]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: val ? 'var(--text)' : 'var(--text-muted)', textTransform: 'none', letterSpacing: 0, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={val}
                  onChange={e => set(e.target.checked)}
                  style={{ width: 'auto', padding: 0, accentColor: 'var(--accent)' }}
                />
                {label}
              </label>
            ))}
          </div>
          <button type="submit" className="btn-primary" disabled={searching}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {/* Target card selector */}
        {searchResults.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label>Add to card:</label>
            <select value={targetCardId ?? ''} onChange={e => setTargetCardId(e.target.value)}>
              <option value="">— select card —</option>
              {game.Cards.map(c => (
                <option key={c.Id} value={c.Id}>{c.Label} ({c.Stars}★)</option>
              ))}
            </select>
          </div>
        )}

        {searchError && <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: 8 }}>{searchError}</p>}

        {searchResults.length > 0 && (
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {searchResults.map((song, i) => {
              const targetCard = game.Cards.find(c => c.Id === targetCardId)
              const alreadyAdded = targetCard?.Songs.some(s => s.AnnId === song.AnnId && s.SongName === song.SongName)
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: alreadyAdded ? 'var(--surface)' : 'var(--surface2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    opacity: alreadyAdded ? 0.5 : 1,
                  }}
                >
                  <button
                    style={{
                      background: previewSong?.VideoUrl === song.VideoUrl ? 'var(--accent)' : 'var(--surface)',
                      color: previewSong?.VideoUrl === song.VideoUrl ? '#fff' : 'var(--text-muted)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      padding: '4px 8px', flexShrink: 0, fontSize: '0.9rem',
                    }}
                    onClick={() => setPreviewSong(song)}
                    title="Preview"
                  >▶</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {song.SongName} — {song.SongArtist}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {song.AnimeName} · {song.SongType} · {song.AnimeVintage}
                    </div>
                  </div>
                  <button
                    className={alreadyAdded ? 'btn-secondary' : 'btn-primary'}
                    style={{ padding: '4px 12px', marginLeft: 8, flexShrink: 0 }}
                    disabled={!targetCardId || alreadyAdded}
                    onClick={() => targetCardId && addSongToCard(targetCardId, song)}
                  >
                    {alreadyAdded ? '✓' : 'Add'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)' }}>Cards ({game.Cards.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => setCollapsedCards(
              collapsedCards.size === game.Cards.length
                ? new Set()
                : new Set(game.Cards.map(c => c.Id))
            )}
          >
            {collapsedCards.size === game.Cards.length ? '▶ Expand All' : '▼ Collapse All'}
          </button>
          <button className="btn-secondary" onClick={addCard}>+ Add Card</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {game.Cards.map(card => (
          <div key={card.Id} className="card">
            {/* Card header */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: collapsedCards.has(card.Id) ? 0 : 12 }}>
              <button
                style={{ background: 'none', color: 'var(--text-muted)', padding: '2px 4px', fontSize: '0.8rem', flexShrink: 0, transition: 'transform 0.15s' }}
                onClick={() => toggleCollapse(card.Id)}
                title={collapsedCards.has(card.Id) ? 'Expand' : 'Collapse'}
              >
                {collapsedCards.has(card.Id) ? '▶' : '▼'}
              </button>
              <input
                value={card.Label}
                onChange={e => updateCard(card.Id, { Label: e.target.value })}
                style={{ flex: 1 }}
              />
              <Stars n={card.Stars} onClick={s => updateCard(card.Id, { Stars: s })} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                {card.Songs.length} song{card.Songs.length !== 1 ? 's' : ''}
              </span>
              <button
                className="btn-danger"
                style={{ padding: '6px 12px' }}
                onClick={() => removeCard(card.Id)}
              >
                ✕
              </button>
            </div>

            {/* Songs — hidden when collapsed */}
            {!collapsedCards.has(card.Id) && card.Songs.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No songs yet. Search above and add to this card.</p>
            )}
            <div style={{ display: collapsedCards.has(card.Id) ? 'none' : 'flex', flexDirection: 'column', gap: 6 }}>
              {card.Songs.map((song, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'var(--surface2)',
                    borderRadius: 8,
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <button
                      style={{
                        background: previewSong?.VideoUrl === song.VideoUrl ? 'var(--accent)' : 'var(--surface)',
                        color: previewSong?.VideoUrl === song.VideoUrl ? '#fff' : 'var(--text-muted)',
                        border: '1px solid var(--border)', borderRadius: 6,
                        padding: '2px 7px', flexShrink: 0, fontSize: '0.85rem',
                      }}
                      onClick={() => setPreviewSong(song)}
                      title="Preview"
                    >▶</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{song.SongName} — {song.SongArtist}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{song.AnimeName} · {song.SongType}</div>
                    </div>
                    <button
                      style={{ background: 'none', color: 'var(--text-muted)', padding: '2px 6px', flexShrink: 0 }}
                      onClick={() => removeSong(card.Id, idx)}
                    >✕</button>
                  </div>
                  <DualRangeSlider
                    min={song.StartMin ?? 0}
                    max={song.StartMax ?? 0}
                    onChange={(mn, mx) => updateSong(card.Id, idx, { StartMin: mn, StartMax: mx })}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {game.Cards.length === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          No cards yet. Click "Add Card" to start.
        </p>
      )}

      {/* Mini preview player — fixed bottom-right */}
      {previewSong && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '14px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          width: 300, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent-light)', marginBottom: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {previewSong.AnimeName}
              </div>
              <div style={{ fontWeight: 500, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {previewSong.SongName}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {previewSong.SongArtist} · {previewSong.SongType}
              </div>
            </div>
            <button
              style={{ background: 'none', color: 'var(--text-muted)', padding: '2px 4px', flexShrink: 0, fontSize: '1rem' }}
              onClick={() => setPreviewSong(null)}
              title="Close"
            >✕</button>
          </div>
          {/* Native audio controls for seek/volume */}
          <audio
            src={previewSong.VideoUrl}
            controls
            autoPlay
            style={{ width: '100%', height: 32, accentColor: 'var(--accent)' }}
          />
        </div>
      )}
    </div>
  )
}
