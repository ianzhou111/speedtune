import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

const JWT_SECRET = process.env.JWT_SECRET!
const COOKIE_NAME = 'speedtune_auth'

export interface AdminTokenPayload {
  username: string
  role: 'admin'
}

export function signToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
}

export function verifyToken(token: string): AdminTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AdminTokenPayload
  } catch {
    return null
  }
}

export async function getAuthUser(): Promise<AdminTokenPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export function verifySocketToken(token: string): AdminTokenPayload | null {
  return verifyToken(token)
}

export { COOKIE_NAME }
