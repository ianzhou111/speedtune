import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SpeedTune',
  description: 'Anime music quiz game',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="bg-gray-950 text-white min-h-full antialiased">{children}</body>
    </html>
  )
}
