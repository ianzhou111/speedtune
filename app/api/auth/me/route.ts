import { getAuthUser, signToken, COOKIE_NAME } from '@/lib/auth'

export async function GET() {
  const user = await getAuthUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // Re-issue a fresh token for the socket handshake
  const token = signToken(user)
  const headers = new Headers()
  headers.set('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
  return new Response(JSON.stringify({ token, username: user.username }), { status: 200, headers })
}
