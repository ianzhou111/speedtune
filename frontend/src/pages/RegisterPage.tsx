import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { register } from '../lib/api'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [username, setUsername]           = useState('')
  const [password, setPassword]           = useState('')
  const [confirmPassword, setConfirm]     = useState('')
  const [registrationCode, setRegCode]    = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await register(username.trim(), password, registrationCode.trim())
      navigate('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 380 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 6, color: 'var(--text)' }}>Create Admin Account</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 24 }}>
          You need an invite code to register.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label>Username</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label>Registration code</label>
            <input
              value={registrationCode}
              onChange={e => setRegCode(e.target.value)}
              required
              placeholder="Ask the server admin"
              style={{ fontFamily: 'monospace', letterSpacing: 1 }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--red)', fontSize: '0.875rem', marginBottom: 12 }}>{error}</p>
          )}

          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Creating account…' : 'Register →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-light)' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
