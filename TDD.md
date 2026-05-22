# SpeedTune — Technical Design Document

> Status: DRAFT v0.1

---

## 1. Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | **Next.js 14 (App Router)** | Full-stack: React frontend + API routes in one repo. Easy Railway deploy. |
| Real-time | **Socket.io** | Battle-tested WebSocket library; handles reconnection, rooms, fallbacks automatically. |
| Database | **MongoDB** via **Mongoose** | Flexible schema for game config; Atlas free tier sufficient. |
| Auth | **JWT** in httpOnly cookie | Stateless; no extra session store needed. |
| Styling | **Tailwind CSS** | Fast UI iteration; good mobile defaults. |
| Language | **TypeScript** throughout | Type safety across shared event/model types. |
| Deployment | **Railway** (app) + **MongoDB Atlas** (db) | Persistent uptime, native WebSocket support. |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Railway                          │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  Next.js App │    │     Custom HTTP Server       │  │
│  │  (React UI)  │◄──►│  (server.js wraps Next.js)   │  │
│  └──────────────┘    │  + Socket.io attached        │  │
│                      └──────────────┬───────────────┘  │
│                                     │                   │
│                      ┌──────────────▼───────────────┐  │
│                      │         MongoDB Atlas         │  │
│                      │  admins / games / sessions    │  │
│                      └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

Clients:
  Display Screen  ──── WS ────► Socket.io room "display"
  Host Panel      ──── WS ────► Socket.io room "host"
  Player Device   ──── WS ────► Socket.io room "players"
```

### Why a custom server?
Next.js's built-in dev/prod server cannot attach a Socket.io instance (no raw HTTP server access). A thin `server.js` creates a Node `http.Server`, attaches Socket.io, then passes requests to Next.js. This is the standard production pattern.

### Playback authority
- **Server** is the state machine — it holds the canonical game state and emits commands to all clients.
- **Display Screen browser** owns the `<video>` element and executes play/pause commands received via Socket.io.
- Player devices and Host Panel never touch the video — they only send buzzer events and receive state updates.
- This keeps audio/video sync simple: one element, one browser tab, controlled by server events.

---

## 3. Project Structure

```
speedtune/
├── server.js                  # Custom HTTP server + Socket.io init
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── .env.local                 # MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD_HASH
│
├── lib/
│   ├── db.ts                  # Mongoose connection singleton
│   ├── auth.ts                # JWT sign/verify helpers
│   ├── socket.ts              # Socket.io server instance (singleton export)
│   └── gameEngine.ts          # Server-side game state machine
│
├── models/
│   ├── Admin.ts               # Mongoose schema
│   ├── Game.ts                # Mongoose schema
│   └── Session.ts             # Mongoose schema
│
├── types/
│   └── index.ts               # Shared TS types: SongEntry, Card, Player, GameState, SocketEvents
│
├── app/
│   ├── layout.tsx
│   ├── page.tsx               # Player join / lobby ("/")
│   ├── display/
│   │   └── page.tsx           # Display Screen ("/display")
│   ├── host/
│   │   └── page.tsx           # Host Control Panel ("/host") — auth guarded
│   └── admin/
│       ├── login/
│       │   └── page.tsx       # Admin login ("/admin/login")
│       ├── games/
│       │   ├── page.tsx       # Game list
│       │   ├── new/
│       │   │   └── page.tsx   # Create game
│       │   └── [id]/
│       │       └── page.tsx   # Edit game
│       └── layout.tsx         # Auth guard for all /admin/* routes
│
└── app/api/
    ├── auth/
    │   ├── login/route.ts     # POST — validate credentials, set JWT cookie
    │   └── logout/route.ts    # POST — clear cookie
    ├── games/
    │   ├── route.ts           # GET list, POST create
    │   └── [id]/route.ts      # GET, PUT, DELETE
    ├── sessions/
    │   ├── route.ts           # POST — create/start a session from a game
    │   └── [id]/route.ts      # GET current session state
    └── anisong/
        └── search/route.ts    # POST — proxy to anisongdb.com (avoids CORS)
```

---

## 4. Data Models

### 4.1 Admin
```typescript
{
  _id: ObjectId,
  username: string,        // unique
  passwordHash: string     // bcrypt
}
```

### 4.2 Game
```typescript
{
  _id: ObjectId,
  name: string,
  settings: {
    clipDuration: number,        // seconds, default 60
    wrongAnswerDeduction: number,// default 0
    starPointMap: {              // default 1→100 ... 5→500
      1: number, 2: number, 3: number, 4: number, 5: number
    }
  },
  cards: [
    {
      _id: ObjectId,
      label: string,
      stars: 1 | 2 | 3 | 4 | 5,
      songs: [
        {
          annId: number,
          songName: string,
          songArtist: string,
          animeName: string,
          animeVintage: string,
          songType: string,        // "OP" | "ED" | "Insert"
          videoUrl: string,        // HQ preferred, MQ fallback
        }
      ]
    }
  ],
  createdAt: Date,
  updatedAt: Date
}
```

### 4.3 Session
```typescript
{
  _id: ObjectId,
  gameId: ObjectId,
  status: "lobby" | "active" | "ended",
  players: [
    {
      socketId: string,
      name: string,
      color: string,            // hex from palette
      score: number,
      bannedUntil?: Date        // for 30s kick ban
    }
  ],
  // Tracks which songs have been played across all cards
  playedSongs: [
    { cardId: ObjectId, songIndex: number }
  ],
  currentRound?: {
    cardId: ObjectId,
    songIndex: number,          // current song index within the card
    phase: "guess" | "reveal" | "between_songs",
    buzzedPlayerId?: string,    // socketId of buzzer
    exhaustedBuzzers: string[], // socketIds that have already guessed this song
  },
  createdAt: Date,
  updatedAt: Date
}
```

---

## 5. API Routes

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | — | Validates credentials, sets httpOnly JWT cookie |
| POST | `/api/auth/logout` | — | Clears cookie |

### Games (Host Tool)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/games` | Admin | List all games |
| POST | `/api/games` | Admin | Create new game |
| GET | `/api/games/:id` | Admin | Get game by ID |
| PUT | `/api/games/:id` | Admin | Update game |
| DELETE | `/api/games/:id` | Admin | Delete game |

### Sessions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/sessions` | Admin | Start a session from a game ID |
| GET | `/api/sessions/active` | — | Get current active session (players use this on join) |

### AnisongDB Proxy
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/anisong/search` | Admin | Proxies to `anisongdb.com/api/search_request` |

Proxy exists to avoid CORS issues from the browser and to filter out songs with no video URL before returning results to the Host Tool.

---

## 6. Socket.io Events

All events flow through a single Socket.io namespace `/`. Clients join rooms based on their role.

### Rooms
| Room | Members |
|------|---------|
| `display` | Display Screen tab |
| `host` | Host Control Panel tab |
| `players` | All player devices |
| `all` | display + host + players (via broadcast) |

### Client → Server Events

| Event | Payload | Sender | Description |
|-------|---------|--------|-------------|
| `player:join` | `{ name, color }` | Player | Register player in lobby |
| `player:buzz` | `{ sessionId }` | Player | Buzz in during Guess Phase |
| `host:join` | `{ token }` | Host | Register host panel (auth via JWT) |
| `display:join` | — | Display | Register display screen |
| `host:start_game` | — | Host | Transition session from lobby → active |
| `host:open_card` | `{ cardId }` | Host | Begin mini-round for a card |
| `host:judge` | `{ correct: boolean }` | Host | Mark current buzz correct/incorrect |
| `host:skip` | — | Host | Skip current song, trigger reveal |
| `host:kick_player` | `{ playerId }` | Host | Kick and ban player for 30s |
| `host:end_game` | — | Host | Manually end the game |

### Server → Client Events

| Event | Payload | Recipients | Description |
|-------|---------|------------|-------------|
| `session:state` | `SessionState` | Requester | Full state sync on connect/reconnect |
| `lobby:player_joined` | `{ player }` | all | New player entered lobby |
| `lobby:player_left` | `{ playerId }` | all | Player disconnected or kicked |
| `lobby:player_kicked` | — | That player | They were kicked (triggers 30s ban UI) |
| `game:started` | — | all | Lobby → Active transition |
| `round:song_start` | `{ cardLabel, stars, songIndex, totalSongs }` | all | New song begins in mini-round |
| `round:buzz` | `{ player: { name, color } }` | all | A player buzzed in |
| `round:audio_pause` | — | display | Pause the video element |
| `round:audio_resume` | — | display | Resume the video element |
| `round:answer_reveal` | `{ animeName, songName, songArtist, pointsAwarded, winnerId? }` | all | Reveal phase begins |
| `round:next_song` | `{ songIndex }` | all | Advance to next song in card |
| `round:card_complete` | — | all | Mini-round over, return to board |
| `scores:update` | `{ scores: [{ playerId, name, color, score }] }` | all | Score change broadcast |
| `game:ended` | `{ finalScores }` | all | Game over |

---

## 7. Game State Machine

The server-side `gameEngine.ts` manages transitions. Invalid transitions are rejected silently.

```
[lobby]
   │ host:start_game
   ▼
[active:board]  ◄──────────────────────────────────────────┐
   │ host:open_card                                         │
   ▼                                                        │
[active:guess_phase]                                        │
   │ player:buzz                                            │
   ▼                                                        │
[active:buzzed]                                             │
   │ host:judge(correct)          host:judge(incorrect)     │
   │                                     │                  │
   ▼                               [active:guess_phase]     │
[active:reveal]                    (buzzer locked for       │
   │                                 that player)           │
   │ all_buzzers_exhausted OR host:skip                     │
   │                                     │                  │
   ▼                                     ▼                  │
[active:reveal] ◄────────────────────────┘                  │
   │                                                        │
   ├── more songs in card ──► [active:guess_phase] (next song)
   │
   └── last song in card ────► [active:board] ─────────────┘
                                                           
   host:end_game from any active state ──► [ended]
```

---

## 8. Frontend Pages

### `/` — Player Join / Lobby
- Fetches active session on load; if none, shows "No game running" screen.
- **Pre-join**: name input + color picker. Colors already taken are greyed out. Submit → `player:join`.
- **Lobby**: shows joined players list + full board (card labels + stars + song count). "Waiting for host…" banner.
- **Active game**: shows Buzz button (large, full-screen on mobile). Disabled when buzzer is locked. Displays current card label and song progress (e.g. "Song 2 of 5"). Live scoreboard sidebar/footer.
- **End screen**: podium + ranked scores.

### `/display` — Display Screen
- No auth required.
- **Lobby**: player list + board preview.
- **Active game**:
  - **Board view**: full card grid. Active card highlighted. Used cards greyed out.
  - **Guess phase**: card label + song progress shown. Hidden `<video>` element playing audio. Buzz notification banner (player name + color) when someone buzzes.
  - **Reveal phase**: `<video>` becomes visible. Overlay: anime title, song name, artist, points awarded.
- **End screen**: podium + scores.
- Responds to all server `round:*` events to control `<video>` element.

### `/host` — Host Control Panel
- Auth guard: redirects to `/admin/login` if no valid JWT cookie.
- **Lobby**: player list with kick buttons. "Start Game" button.
- **Active game**:
  - Board grid: click a card to `host:open_card`.
  - **During guess phase**: shows current song's answer (anime title, song name, artist) — hidden from Display Screen. Music progress bar. "Skip" button.
  - **After buzz**: "Correct ✓" and "Incorrect ✗" buttons. Buzzed player name shown.
  - Live scoreboard.
- **End game**: "End Game" button available at all times during active game.

### `/admin/*` — Host Tool
- Auth guard on layout.
- Game list → create / edit game.
- **Game editor**:
  - Add/remove/reorder cards.
  - Per card: label input, star selector, song list.
  - Song search panel: search by anime title, artist, or song name → calls `/api/anisong/search` → displays results with HQ/MQ status indicator. Songs without video show disabled state + tooltip "No video available".
  - Video preview modal: plays the HQ/MQ video inline before confirming add.
  - Save → PUT `/api/games/:id`.
  - "Start Game" button → POST `/api/sessions` → redirects to `/host`.

### `/admin/login` — Login
- Username + password form → POST `/api/auth/login` → redirect to `/admin/games`.

---

## 9. Key Implementation Notes

### Socket.io with Next.js (custom server)
```js
// server.js
const { createServer } = require('http')
const { Server } = require('socket.io')
const next = require('next')

const app = next({ dev: process.env.NODE_ENV !== 'production' })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(handle)
  const io = new Server(httpServer)
  // attach game engine listeners
  require('./lib/socket').init(io)
  httpServer.listen(process.env.PORT || 3000)
})
```

### Preventing video from leaking during Guess Phase
The `<video>` element on the Display Screen uses `visibility: hidden` (not `display: none` — the latter pauses buffering in some browsers) during the Guess Phase. The video URL is only sent in the `round:song_start` event to the `display` room — player devices never receive it.

### Buzzer timing
`player:buzz` events include a server-side `Date.now()` timestamp at the moment the server receives them. The first timestamp wins. The engine ignores subsequent buzzes until the phase resets.

### Reconnection
On any client reconnect, the server emits `session:state` with the full current state so the client can re-render correctly without missing a beat.

### AnisongDB proxy & video URL selection
```typescript
// app/api/anisong/search/route.ts
const result = await fetch('https://anisongdb.com/api/search_request', { ... })
const songs: SongEntry[] = await result.json()
return songs
  .map(s => ({ ...s, videoUrl: s.HQ || s.MQ || null }))
  .filter(s => s.videoUrl !== null)  // block no-video songs
```

### 30-second kick ban
On `host:kick_player`:
1. Server emits `lobby:player_kicked` to that socket → client shows removal message.
2. Server stores `bannedUntil = Date.now() + 30000` on the player record in the session.
3. On `player:join`, server checks if the socket's IP/socketId is banned and rejects with `{ error: 'banned', retryAfter: <ms> }`.

---

## 10. Environment Variables

```env
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<random 64-char hex>
ADMIN_USERNAME=<your username>
ADMIN_PASSWORD_HASH=<bcrypt hash>   # generated once via setup script
NEXT_PUBLIC_APP_URL=https://your-app.railway.app
```

---

## 11. Deployment

### Railway setup
1. Connect GitHub repo to Railway.
2. Set env vars in Railway dashboard.
3. Railway auto-detects Node.js; override start command to `node server.js`.
4. MongoDB Atlas free cluster → add Railway's outbound IP to Atlas allowlist (or allow `0.0.0.0/0` for simplicity).

### Build / start scripts (`package.json`)
```json
{
  "scripts": {
    "dev": "node server.js",
    "build": "next build",
    "start": "node server.js"
  }
}
```

---

## 12. Open Questions / Risks

- [ ] **AnisongDB rate limiting** — The API is community-run. If it rate-limits the proxy, we may need to cache search results more aggressively or add a delay between requests in the Host Tool.
- [ ] **Video CORS** — AMQ CDN videos are fetched by the Display Screen browser directly. If the CDN blocks cross-origin video playback, we'll need to proxy the video stream through our server (bandwidth cost). Needs testing early.
- [ ] **Mobile buzzer latency** — On poor mobile connections, buzz events may arrive late. The server timestamp approach handles fairness, but perceived latency (player taps, nothing happens for 500ms) may feel broken. May need optimistic UI (local "buzzed!" state before server confirms).
