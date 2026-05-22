const { createServer } = require('http')
const { Server: SocketIOServer } = require('socket.io')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(handle)

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  })

  // Store io on global so API routes and lib can access it
  global._io = io

  // Lazy-require so Next.js TypeScript compilation has already run
  const { initGameEngine } = require('./lib/gameEngine')
  initGameEngine(io)

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
  })
})
