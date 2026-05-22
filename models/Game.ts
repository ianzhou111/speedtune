import mongoose, { Schema, Document } from 'mongoose'
import type { GameSettings, SongEntry } from '@/types'

const SongEntrySchema = new Schema<SongEntry>({
  annId: Number,
  songName: { type: String, required: true },
  songArtist: { type: String, required: true },
  animeName: { type: String, required: true },
  animeVintage: String,
  songType: String,
  videoUrl: { type: String, required: true },
}, { _id: false })

const CardSchema = new Schema({
  label: { type: String, required: true },
  stars: { type: Number, min: 1, max: 5, required: true },
  songs: [SongEntrySchema],
})

const GameSettingsSchema = new Schema<GameSettings>({
  clipDuration: { type: Number, default: 60 },
  wrongAnswerDeduction: { type: Number, default: 0 },
  starPointMap: {
    type: Map,
    of: Number,
    default: { 1: 100, 2: 200, 3: 300, 4: 400, 5: 500 },
  },
}, { _id: false })

export interface IGame extends Document {
  name: string
  settings: GameSettings
  cards: mongoose.Types.DocumentArray<mongoose.Document & { label: string; stars: number; songs: SongEntry[] }>
  createdAt: Date
  updatedAt: Date
}

const GameSchema = new Schema<IGame>(
  {
    name: { type: String, required: true },
    settings: { type: GameSettingsSchema, default: () => ({}) },
    cards: [CardSchema],
  },
  { timestamps: true }
)

export default mongoose.models.Game || mongoose.model<IGame>('Game', GameSchema)
