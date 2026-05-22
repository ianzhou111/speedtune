import { COOKIE_NAME } from '@/lib/auth'

export async function POST() {
  const headers = new Headers()
  headers.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}
