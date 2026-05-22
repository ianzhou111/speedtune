import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import Game from '@/models/Game'
import { getAuthUser } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await connectDB()
  const game = await Game.findById(id)
  if (!game) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(game)
}

export async function PUT(request: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  await connectDB()
  const game = await Game.findByIdAndUpdate(id, body, { new: true, runValidators: true })
  if (!game) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(game)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await connectDB()
  await Game.findByIdAndDelete(id)
  return Response.json({ ok: true })
}
