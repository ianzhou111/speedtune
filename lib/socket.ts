import { Server as SocketIOServer } from 'socket.io'

declare global {
  // eslint-disable-next-line no-var
  var _io: SocketIOServer | null
}

export function getIO(): SocketIOServer {
  if (!global._io) throw new Error('Socket.io not initialized')
  return global._io
}

export function setIO(io: SocketIOServer) {
  global._io = io
}
