import { Component, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import PlayerPage from './pages/PlayerPage'
import DisplayPage from './pages/DisplayPage'
import HostPage from './pages/HostPage'
import AdminPage from './pages/AdminPage'
import VideoTestPage from './pages/VideoTestPage'
import AdminGameEditor from './pages/AdminGameEditor'
import LoginPage from './pages/LoginPage'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 40, fontFamily: 'monospace', color: '#ef4444', background: '#0f0f13', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 16 }}>Render error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{err.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.6, marginTop: 12, fontSize: '0.8rem' }}>{err.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 24, padding: '8px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '1rem' }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<PlayerPage />} />
          <Route path="/display" element={<DisplayPage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/games/:id" element={<AdminGameEditor />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/test" element={<VideoTestPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
