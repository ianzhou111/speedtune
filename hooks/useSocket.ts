'use client'
import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket'] })
    socketRef.current = socket
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    return () => { socket.disconnect() }
  }, [])

  return { socket: socketRef.current, connected, socketRef }
}
