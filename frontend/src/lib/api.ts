import type { Game, GameSettings, Card, SongEntry } from './types'

// ── Auth ───────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'speedtune_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

// ── Base fetch ─────────────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...init, headers })

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const body = await res.text()
    throw new Error(body || res.statusText)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Auth API ───────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ Username: username, Password: password }),
  })
  setToken(data.token)
  return data.token
}

export async function register(username: string, password: string, registrationCode: string): Promise<string> {
  const data = await request<{ token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ Username: username, Password: password, RegistrationCode: registrationCode }),
  })
  setToken(data.token)
  return data.token
}

// ── Games API ──────────────────────────────────────────────────────────────

export const gamesApi = {
  list: () => request<Game[]>('/api/games'),
  get: (id: string) => request<Game>(`/api/games/${id}`),
  create: (name: string, settings?: Partial<GameSettings>) =>
    request<Game>('/api/games', {
      method: 'POST',
      body: JSON.stringify({ name, settings }),
    }),
  update: (id: string, patch: { name?: string; settings?: GameSettings; cards?: Card[] }) =>
    request<Game>(`/api/games/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  delete: (id: string) =>
    request<void>(`/api/games/${id}`, { method: 'DELETE' }),
}

// ── Sessions API ───────────────────────────────────────────────────────────

export interface CreateSessionResult {
  Id: string
  RoomCode: string
  HostToken: string
}

export const sessionsApi = {
  getActive: () => request<object | null>('/api/sessions/active'),
  /** No auth required — returns { Id, RoomCode, HostToken } for the new session. */
  create: (gameId: string) =>
    request<CreateSessionResult>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ GameId: gameId }),
    }),
}

// ── Anisong search API ─────────────────────────────────────────────────────

export interface AnisongSearchParams {
  anime?: string
  song?: string
  artist?: string
  opening?: boolean
  ending?: boolean
  insert?: boolean
}

export async function searchAnisong(params: AnisongSearchParams): Promise<SongEntry[]> {
  return request<SongEntry[]>('/api/anisong/search', {
    method: 'POST',
    body: JSON.stringify({
      Anime: params.anime ?? '',
      Song: params.song ?? '',
      Artist: params.artist ?? '',
      Opening: params.opening ?? true,
      Ending: params.ending ?? true,
      Insert: params.insert ?? true,
    }),
  })
}
