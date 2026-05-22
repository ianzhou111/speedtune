import { getAuthUser } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Login page itself is under /admin but doesn't need the auth check
  const user = await getAuthUser()
  // We do the redirect check in individual pages that need it;
  // layout just provides the shell
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {user && (
        <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div className="flex gap-6">
            <a href="/admin/games" className="text-gray-300 hover:text-white transition-colors font-medium">Games</a>
            <a href="/host" className="text-gray-300 hover:text-white transition-colors">Host Panel</a>
            <a href="/display" target="_blank" className="text-gray-300 hover:text-white transition-colors">Display ↗</a>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="text-sm text-gray-500 hover:text-white transition-colors">Log out</button>
          </form>
        </nav>
      )}
      {children}
    </div>
  )
}
