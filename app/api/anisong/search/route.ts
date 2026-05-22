import { NextRequest } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import type { SongEntry } from '@/types'

interface AnisongSearchResult {
  annId?: number
  songName?: string
  songArtist?: string
  animeName?: string
  animeVintage?: string
  songType?: string
  HQ?: string | null
  MQ?: string | null
  audio?: string | null
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  let results: AnisongSearchResult[] = []

  try {
    const resp = await fetch('https://anisongdb.com/api/search_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      return Response.json({ error: 'AnisongDB request failed' }, { status: 502 })
    }

    results = await resp.json()
  } catch {
    return Response.json({ error: 'Failed to reach AnisongDB' }, { status: 502 })
  }

  // Map to our SongEntry type, keeping only songs that have a video URL
  const songs: SongEntry[] = results
    .map((r) => ({
      annId: r.annId ?? 0,
      songName: r.songName ?? '',
      songArtist: r.songArtist ?? '',
      animeName: r.animeName ?? '',
      animeVintage: r.animeVintage ?? '',
      songType: r.songType ?? '',
      videoUrl: r.HQ || r.MQ || '',
    }))
    .filter((s) => s.videoUrl !== '')

  return Response.json(songs)
}
