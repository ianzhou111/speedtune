export interface SongEntry {
  annId: number
  songName: string
  songArtist: string
  animeName: string
  animeVintage: string
  songType: string
  videoUrl: string // HQ preferred, MQ fallback
}

export interface Card {
  _id: string
  label: string
  stars: 1 | 2 | 3 | 4 | 5
  songs: SongEntry[]
}

export interface GameSettings {
  clipDuration: number
  wrongAnswerDeduction: number
  starPointMap: Record<1 | 2 | 3 | 4 | 5, number>
}

export interface Game {
  _id: string
  name: string
  settings: GameSettings
  cards: Card[]
  createdAt: string
  updatedAt: string
}

export interface Player {
  socketId: string
  name: string
  color: string
  score: number
  bannedUntil?: string
}

export interface PlayedSong {
  cardId: string
  songIndex: number
}

export type GamePhase = 'guess' | 'reveal' | 'between_songs'
export type SessionStatus = 'lobby' | 'active' | 'ended'

export interface CurrentRound {
  cardId: string
  songIndex: number
  phase: GamePhase
  buzzedPlayerId?: string
  exhaustedBuzzers: string[]
}

export interface Session {
  _id: string
  gameId: string
  status: SessionStatus
  players: Player[]
  playedSongs: PlayedSong[]
  currentRound?: CurrentRound
  createdAt: string
  updatedAt: string
}

// Subset of session state sent to clients
export interface PublicSessionState {
  sessionId: string
  status: SessionStatus
  players: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[]
  cards: {
    _id: string
    label: string
    stars: 1 | 2 | 3 | 4 | 5
    totalSongs: number
    playedCount: number
  }[]
  currentRound?: {
    cardId: string
    cardLabel: string
    stars: 1 | 2 | 3 | 4 | 5
    songIndex: number
    totalSongs: number
    phase: GamePhase
    buzzedPlayer?: Pick<Player, 'socketId' | 'name' | 'color'>
    exhaustedBuzzers: string[]
  }
}

// Socket event payloads — client → server
export interface PlayerJoinPayload {
  name: string
  color: string
}

export interface HostJudgePayload {
  correct: boolean
}

export interface HostOpenCardPayload {
  cardId: string
}

export interface HostKickPlayerPayload {
  playerId: string
}

// Socket event payloads — server → client
export interface LobbyPlayerJoinedPayload {
  player: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>
}

export interface LobbyPlayerLeftPayload {
  playerId: string
}

export interface RoundSongStartPayload {
  cardId: string
  cardLabel: string
  stars: 1 | 2 | 3 | 4 | 5
  songIndex: number
  totalSongs: number
  videoUrl: string // only sent to display room
}

export interface RoundBuzzPayload {
  player: Pick<Player, 'socketId' | 'name' | 'color'>
}

export interface RoundAnswerRevealPayload {
  animeName: string
  songName: string
  songArtist: string
  pointsAwarded: number
  winnerId?: string
  videoUrl: string
}

export interface RoundNextSongPayload {
  songIndex: number
}

export interface ScoresUpdatePayload {
  scores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[]
}

export interface GameEndedPayload {
  finalScores: Pick<Player, 'socketId' | 'name' | 'color' | 'score'>[]
}

export const PLAYER_COLORS = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#a855f7' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'White', hex: '#f1f5f9' },
  { name: 'Black', hex: '#1e293b' },
] as const

export const DEFAULT_STAR_POINT_MAP: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 100,
  2: 200,
  3: 300,
  4: 400,
  5: 500,
}

export const DEFAULT_SETTINGS: GameSettings = {
  clipDuration: 60,
  wrongAnswerDeduction: 0,
  starPointMap: DEFAULT_STAR_POINT_MAP,
}
