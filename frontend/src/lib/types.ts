// ── Domain models ──────────────────────────────────────────────────────────

export interface Player {
  SocketId: string
  Name: string
  Color: string
  Score: number
}

export interface CardSummary {
  Id: string
  Label: string
  Stars: number
  TotalSongs: number
  PlayedCount: number
}

export interface BuzzedPlayer {
  SocketId: string
  Name: string
  Color: string
}

export interface CurrentRound {
  CardId: string
  CardLabel: string
  Stars: number
  SongIndex: number
  TotalSongs: number
  Phase: 'guess' | 'buzzed' | 'reveal'
  BuzzedPlayer: BuzzedPlayer | null
  ExhaustedBuzzers: string[]
}

export interface SessionState {
  SessionId: string
  Status: 'lobby' | 'active' | 'ended'
  Players: Player[]
  Cards: CardSummary[]
  CurrentRound: CurrentRound | null
}

// ── SignalR event payloads ─────────────────────────────────────────────────

export interface RoundSongStartPayload {
  CardId: string
  CardLabel: string
  Stars: number
  SongIndex: number
  TotalSongs: number
  VideoUrl: string
  ClipDuration: number
  StartPercent: number  // 0–100, random point within song's StartMin–StartMax range
}

export interface RoundBuzzPayload {
  Player: BuzzedPlayer
}

export interface RoundAnswerRevealPayload {
  AnimeName: string
  SongName: string
  SongArtist: string
  PointsAwarded: number
  WinnerId: string | null
  VideoUrl: string
}

export interface RoundAnswerHintPayload {
  AnimeName: string
  SongName: string
  SongArtist: string
}

export interface ScoresUpdatePayload {
  Scores: Player[]
}

export interface GameEndedPayload {
  FinalScores: Player[]
}

export interface ErrorPayload {
  Message: string
  RetryAfter?: number
}

// ── REST API models ────────────────────────────────────────────────────────

export interface SongEntry {
  AnnId: number
  SongName: string
  SongArtist: string
  AnimeName: string
  AnimeVintage: string
  SongType: string
  VideoUrl: string
  StartMin: number   // 0–100 %
  StartMax: number   // 0–100 %
}

export interface Card {
  Id: string
  Label: string
  Stars: number
  Songs: SongEntry[]
}

export interface GameSettings {
  ClipDuration: number
  WrongAnswerDeduction: number
  StarPointMap: Record<number, number>
}

export interface Game {
  Id: string
  Name: string
  Settings: GameSettings
  Cards: Card[]
  CreatedAt: string
  UpdatedAt: string
}

// ── Player colors ──────────────────────────────────────────────────────────

export const PLAYER_COLORS: Record<string, string> = {
  red:    '#ef4444',
  blue:   '#3b82f6',
  green:  '#22c55e',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
  pink:   '#ec4899',
  cyan:   '#06b6d4',
  lime:   '#84cc16',
  amber:  '#f59e0b',
}
