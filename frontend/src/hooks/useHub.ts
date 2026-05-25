import { useEffect, useRef, useState } from 'react'
import * as signalR from '@microsoft/signalr'
import { startConnection, stopConnection } from '../lib/signalr'

type Handler = (...args: unknown[]) => void

interface EventMap {
  [event: string]: Handler
}

/**
 * Connects to the SignalR hub and registers event handlers.
 * `onReady` is called once the connection is established so the caller can
 * send the initial join message (PlayerJoin, HostJoin, DisplayJoin).
 */
export function useHub(events: EventMap, onReady?: (conn: signalR.HubConnection) => void) {
  const [connected, setConnected] = useState(false)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let mounted = true

    startConnection().then((conn) => {
      if (!mounted) return

      // Register all event handlers
      for (const [event, handler] of Object.entries(events)) {
        conn.on(event, handler)
      }

      setConnected(true)
      onReadyRef.current?.(conn)
    })

    return () => {
      mounted = false
      // Don't stop the connection — it's shared. Just clean up handlers.
      const conn = (window as unknown as { __signalrConn?: signalR.HubConnection }).__signalrConn
      if (conn) {
        for (const event of Object.keys(events)) {
          conn.off(event)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return connected
}

/**
 * Simple hook that gives you the raw connection once connected.
 */
export function useConnection() {
  const [conn, setConn] = useState<signalR.HubConnection | null>(null)

  useEffect(() => {
    startConnection().then(setConn)
    return () => {
      stopConnection()
    }
  }, [])

  return conn
}
