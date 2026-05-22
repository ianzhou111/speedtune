import mongoose, { Schema, Document } from 'mongoose'
import type { SessionStatus, GamePhase } from '@/types'

const PlayerSchema = new Schema({
  socketId: String,
  name: { type: String, required: true },
  color: { type: String, required: true },
  score: { type: Number, default: 0 },
  bannedUntil: Date,
}, { _id: false })

const PlayedSongSchema = new Schema({
  cardId: Schema.Types.ObjectId,
  songIndex: Number,
}, { _id: false })

const CurrentRoundSchema = new Schema({
  cardId: Schema.Types.ObjectId,
  songIndex: { type: Number, default: 0 },
  phase: { type: String, enum: ['guess', 'reveal', 'between_songs'], default: 'guess' },
  buzzedPlayerId: String,
  exhaustedBuzzers: [String],
}, { _id: false })

export interface ISession extends Document {
  gameId: mongoose.Types.ObjectId
  status: SessionStatus
  players: mongoose.Types.DocumentArray<{
    socketId: string
    name: string
    color: string
    score: number
    bannedUntil?: Date
  }>
  playedSongs: { cardId: mongoose.Types.ObjectId; songIndex: number }[]
  currentRound?: {
    cardId: mongoose.Types.ObjectId
    songIndex: number
    phase: GamePhase
    buzzedPlayerId?: string
    exhaustedBuzzers: string[]
  }
  createdAt: Date
  updatedAt: Date
}

const SessionSchema = new Schema<ISession>(
  {
    gameId: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
    status: { type: String, enum: ['lobby', 'active', 'ended'], default: 'lobby' },
    players: [PlayerSchema],
    playedSongs: [PlayedSongSchema],
    currentRound: CurrentRoundSchema,
  },
  { timestamps: true }
)

export default mongoose.models.Session || mongoose.model<ISession>('Session', SessionSchema)
