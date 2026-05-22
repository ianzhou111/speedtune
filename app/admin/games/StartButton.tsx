'use client'
import { useRouter } from 'next/navigation'

export default function StartButton({ gameId }: { gameId: string }) {
  const router = useRouter()

  const handleStart = async () => {
    const r = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
    })
    if (r.ok) router.push('/host')
  }

  return (
    <button onClick={handleStart}
      className="text-sm text-green-400 hover:text-green-300 px-3 py-1 rounded-lg hover:bg-green-900/30 transition-colors">
      ▶ Start
    </button>
  )
}
