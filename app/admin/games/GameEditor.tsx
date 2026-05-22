'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SongEntry } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'

interface CardData {
  _id?: string
  label: string
  stars: 1 | 2 | 3 | 4 | 5
  songs: SongEntry[]
}

interface GameData {
  _id?: string
  name: string
  settings: typeof DEFAULT_SETTINGS
  cards: CardData[]
}

interface Props {
  initialGame?: GameData
}

const STARS = [1, 2, 3, 4, 5] as const

export default function GameEditor({ initialGame }: Props) {
  const router = useRouter()
  const [game, setGame] = useState<GameData>(initialGame ?? {
    name: '',
    settings: DEFAULT_SETTINGS,
    cards: [],
  })
  const [saving, setSaving] = useState(false)
  const [activeCardIdx, setActiveCardIdx] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [searchField, setSearchField] = useState<'anime_search_filter' | 'song_name_search_filter' | 'artist_search_filter'>('anime_search_filter')
  const [searchResults, setSearchResults] = useState<SongEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const addCard = () => {
    setGame(g => ({ ...g, cards: [...g.cards, { label: 'New Card', stars: 1, songs: [] }] }))
    setActiveCardIdx(game.cards.length)
  }

  const removeCard = (idx: number) => {
    setGame(g => ({ ...g, cards: g.cards.filter((_, i) => i !== idx) }))
    setActiveCardIdx(null)
  }

  const updateCard = (idx: number, updates: Partial<CardData>) => {
    setGame(g => ({
      ...g,
      cards: g.cards.map((c, i) => i === idx ? { ...c, ...updates } : c),
    }))
  }

  const removeSong = (cardIdx: number, songIdx: number) => {
    setGame(g => ({
      ...g,
      cards: g.cards.map((c, i) => i === cardIdx
        ? { ...c, songs: c.songs.filter((_, si) => si !== songIdx) }
        : c
      ),
    }))
  }

  const addSong = (song: SongEntry) => {
    if (activeCardIdx === null) return
    setGame(g => ({
      ...g,
      cards: g.cards.map((c, i) => i === activeCardIdx
        ? { ...c, songs: [...c.songs, song] }
        : c
      ),
    }))
  }

  const doSearch = useCallback(async () => {
    if (!search.trim()) return
    setSearching(true)
    setSearchResults([])
    try {
      const body = {
        [searchField]: { search: search.trim(), partial_match: true },
        ignore_duplicate: true,
        opening_filter: true,
        ending_filter: true,
        insert_filter: true,
      }
      const r = await fetch('/api/anisong/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data: SongEntry[] = await r.json()
      setSearchResults(data.slice(0, 30))
    } finally {
      setSearching(false)
    }
  }, [search, searchField])

  const handleSave = async () => {
    setSaving(true)
    try {
      const method = game._id ? 'PUT' : 'POST'
      const url = game._id ? `/api/games/${game._id}` : '/api/games'
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(game),
      })
      if (r.ok) router.push('/admin/games')
    } finally {
      setSaving(false)
    }
  }

  const activeCard = activeCardIdx !== null ? game.cards[activeCardIdx] : null

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <input
            className="bg-gray-800 rounded-xl px-4 py-2 text-white text-2xl font-bold placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
            placeholder="Game name…"
            value={game.name}
            onChange={e => setGame(g => ({ ...g, name: e.target.value }))}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={() => router.push('/admin/games')} className="text-gray-400 hover:text-white px-4 py-2 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving || !game.name.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed px-6 py-2 rounded-xl font-semibold transition-colors">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Settings strip */}
      <div className="bg-gray-800 rounded-2xl p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Clip duration (s)</label>
          <input type="number" min={10} max={300}
            className="bg-gray-700 rounded-lg px-3 py-1.5 w-24 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={game.settings.clipDuration}
            onChange={e => setGame(g => ({ ...g, settings: { ...g.settings, clipDuration: Number(e.target.value) } }))} />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Wrong answer deduction</label>
          <input type="number" min={0}
            className="bg-gray-700 rounded-lg px-3 py-1.5 w-24 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={game.settings.wrongAnswerDeduction}
            onChange={e => setGame(g => ({ ...g, settings: { ...g.settings, wrongAnswerDeduction: Number(e.target.value) } }))} />
        </div>
        <div className="flex gap-3">
          {STARS.map(s => (
            <div key={s}>
              <label className="block text-xs text-gray-400 mb-1">{'⭐'.repeat(s)}</label>
              <input type="number" min={0}
                className="bg-gray-700 rounded-lg px-3 py-1.5 w-20 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={game.settings.starPointMap[s]}
                onChange={e => setGame(g => ({
                  ...g,
                  settings: { ...g.settings, starPointMap: { ...g.settings.starPointMap, [s]: Number(e.target.value) } },
                }))} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Card list */}
        <div className="w-56 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-400">{game.cards.length} cards</p>
            <button onClick={addCard} className="text-sm text-blue-400 hover:text-blue-300">+ Add</button>
          </div>
          <div className="space-y-1">
            {game.cards.map((c, i) => (
              <button key={i} onClick={() => setActiveCardIdx(i)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors ${activeCardIdx === i ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                <div className="font-medium truncate">{c.label || 'Unnamed'}</div>
                <div className="text-xs opacity-70">{'⭐'.repeat(c.stars)} · {c.songs.length} song{c.songs.length !== 1 ? 's' : ''}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Card editor */}
        <div className="flex-1 min-w-0">
          {activeCard === null ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-600">
              <p className="text-lg">Select a card to edit</p>
              <button onClick={addCard} className="mt-3 text-blue-400 hover:text-blue-300">+ Add your first card</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-2xl p-4 space-y-3">
                <div className="flex gap-3 items-start">
                  <input className="flex-1 bg-gray-700 rounded-xl px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Card label"
                    value={activeCard.label}
                    onChange={e => updateCard(activeCardIdx!, { label: e.target.value })} />
                  <div className="flex gap-1">
                    {STARS.map(s => (
                      <button key={s} onClick={() => updateCard(activeCardIdx!, { stars: s })}
                        className={`w-9 h-9 rounded-lg text-lg transition-all ${activeCard.stars === s ? 'bg-yellow-500 scale-110' : 'bg-gray-700 hover:bg-gray-600 opacity-60'}`}>
                        ⭐
                      </button>
                    ))}
                  </div>
                  <button onClick={() => removeCard(activeCardIdx!)} className="text-red-400 hover:text-red-300 px-2 py-2">🗑</button>
                </div>

                {/* Songs in card */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Songs ({activeCard.songs.length})</p>
                  {activeCard.songs.length === 0 && <p className="text-gray-600 text-sm">No songs yet. Search below to add.</p>}
                  <div className="space-y-1.5">
                    {activeCard.songs.map((s, si) => (
                      <div key={si} className="flex items-center gap-3 bg-gray-700 rounded-xl px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate">{s.songName}</div>
                          <div className="text-gray-400 text-xs truncate">{s.songArtist} · {s.animeName}</div>
                        </div>
                        <button onClick={() => setPreviewUrl(s.videoUrl)} className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">▶</button>
                        <button onClick={() => removeSong(activeCardIdx!, si)} className="text-xs text-red-400 hover:text-red-300 flex-shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Search */}
              <div className="bg-gray-800 rounded-2xl p-4">
                <p className="text-sm text-gray-400 mb-3">Add songs</p>
                <div className="flex gap-2 mb-3">
                  <select value={searchField} onChange={e => setSearchField(e.target.value as typeof searchField)}
                    className="bg-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    <option value="anime_search_filter">Anime</option>
                    <option value="song_name_search_filter">Song</option>
                    <option value="artist_search_filter">Artist</option>
                  </select>
                  <input
                    className="flex-1 bg-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Search…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && doSearch()} />
                  <button onClick={doSearch} disabled={searching}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                    {searching ? '…' : 'Search'}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="max-h-72 overflow-y-auto space-y-1">
                    {searchResults.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 bg-gray-700 hover:bg-gray-600 rounded-xl px-3 py-2 text-sm transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate">{s.songName}</div>
                          <div className="text-gray-400 text-xs truncate">{s.songArtist} · {s.animeName} {s.animeVintage ? `(${s.animeVintage})` : ''} · {s.songType}</div>
                        </div>
                        <button onClick={() => setPreviewUrl(s.videoUrl)} className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">▶</button>
                        <button onClick={() => addSong(s)}
                          className="text-xs text-green-400 hover:text-green-300 flex-shrink-0 font-semibold">+ Add</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Video preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <video src={previewUrl} controls autoPlay className="w-full rounded-2xl" />
            <button onClick={() => setPreviewUrl(null)}
              className="absolute -top-4 -right-4 bg-gray-800 hover:bg-gray-700 rounded-full w-8 h-8 flex items-center justify-center text-white">✕</button>
          </div>
        </div>
      )}
    </div>
  )
}
