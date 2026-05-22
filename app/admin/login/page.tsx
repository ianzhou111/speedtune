'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    setLoading(false)
    if (r.ok) { router.push('/admin/games') } else {
      const d = await r.json(); setError(d.error ?? 'Login failed')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold text-white mb-6">Admin Login</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        <input className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-xl py-3 font-semibold text-white transition-colors">
          {loading ? 'Logging in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
