import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import Admin from '@/models/Admin'
import { signToken, COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const { username, password } = await request.json()

  if (!username || !password) {
    return Response.json({ error: 'Missing credentials' }, { status: 400 })
  }

  await connectDB()
  const admin = await Admin.findOne({ username })
  if (!admin) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = signToken({ username, role: 'admin' })

  const response = Response.json({ ok: true })
  const headers = new Headers(response.headers)
  headers.set(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
  )
  return new Response(response.body, { status: 200, headers })
}
