# SpeedTune — Product Requirements Document

> Status: FINAL v1.1 — ready for TDD

---

## 1. Overview

SpeedTune is a browser-based anime music quiz game with a Jeopardy-inspired board. A host (admin) builds a set of cards, each grouping multiple songs under one label and point value. Players join on their own devices, see the board in the lobby, then buzz in during gameplay to guess the anime. One instance = one active game at a time.

---

## 2. Core User Roles

| Role | Description |
|------|-------------|
| **Admin / Host** | Authenticated. Builds the game in the Host Tool; runs the live game from the Host Control Panel. |
| **Player** | Joins via shared URL. No auth. Enters name + picks a color. Buzzes in to guess. |

---

## 3. Board Structure

- The board is a **grid of cards** (default ~20, host can add/remove freely).
- Each card has:
  - A **label** (e.g. "Naruto", "Hard OST", "2000s Classics") — set by host.
  - A **difficulty star rating (1–5)** → determines point value.
  - A **list of songs** (1 or more), each sourced from AnisongDB.
- **All songs in a card share the same point value** (the card's star rating).
- Clicking a card starts a **mini-round**: all songs in the card play through in sequence before the board is returned to.
- A card is **fully used** when its mini-round is complete (all songs played). Used cards are greyed out.
- Cards with songs show a **song count badge** (e.g. "5 songs").
- Default star → point mapping (customizable per game):

  | Stars | Default Points |
  |-------|----------------|
  | ⭐ | 100 |
  | ⭐⭐ | 200 |
  | ⭐⭐⭐ | 300 |
  | ⭐⭐⭐⭐ | 400 |
  | ⭐⭐⭐⭐⭐ | 500 |

---

## 4. User Flows

### 4.1 Pre-Game: Host Tool (Admin Only)
1. Admin logs in at `/admin` with username + password.
2. Admin creates/edits a **Game**:
   - Sets game name and global settings (clip max duration, wrong-answer deduction, star→point mapping).
   - Adds cards. For each card:
     - Enters a card label and selects a difficulty (1–5 stars).
     - Searches AnisongDB by **anime title**, **artist name**, or **song name**.
     - Selects one or more songs from results. Songs with no `HQ`/`MQ` video URL are flagged — **cannot be added**.
     - Songs are ordered within the card; host can reorder.
   - Can preview a song's video before adding it.
3. Admin saves game to MongoDB.
4. Admin clicks **Start Game** → player join URL becomes active.

### 4.2 Player Join Flow
1. Player navigates to the game URL on their own device (mobile or desktop).
2. **Lobby screen** shows:
   - Name entry field + color picker (preset palette, each color exclusive to one player).
   - Live list of already-joined players (name + color).
   - Full board (card labels + star ratings + remaining song count visible; no song info revealed).
   - "Waiting for host to start…" status.
3. Host sees player list in the Host Control Panel and can **kick** any player.
   - Kicked player sees a plain "You have been removed" message and cannot rejoin for **30 seconds**.
4. Host clicks **Begin** → game starts for all clients simultaneously.

### 4.3 Live Game Flow
1. Board displayed on Display Screen and all player devices.
2. Host clicks a card → **mini-round begins** for that card (all its songs play in sequence).
3. For each song in the card:
   a. **Guess Phase**:
      - Video preloads silently; **video element hidden** — audio only plays.
      - All player buzzers activate (on-screen button + Enter key).
   b. A player buzzes in:
      - Audio **pauses** immediately (server signals all clients).
      - All buzzers **lock**.
      - **Host Control Panel** shows: who buzzed, anime title, song name, artist name.
      - **Display Screen** shows: who buzzed (name + color) — answer still hidden.
   c. Host judges:
      - **Correct** → award points → trigger **Reveal Phase** for this song.
      - **Incorrect** → lock that player's buzzer for this song only → audio resumes → others may still buzz.
   d. **No correct answer** (all buzzers exhausted or host skips) → **Reveal Phase** with no points.
   e. **Reveal Phase**:
      - Video becomes visible and plays from current position.
      - Anime title, song name, and artist name displayed on all screens.
      - All buzzers reset.
      - **If more songs remain in the card**: automatically advance to the next song (back to step a).
      - **If this was the last song**: mini-round ends → card marked used → **return to board**.
4. Repeat until all cards exhausted or host ends game manually.
5. **End Screen**: podium (1st / 2nd / 3rd highlight) + full ranked score list.

---

## 5. Two Host Views

| View | Route | Access | Purpose |
|------|-------|--------|---------|
| **Display Screen** | `/display` | Public | Projected to all. Board, active card state, video reveal, live scores. Answer never shown during Guess Phase. |
| **Host Control Panel** | `/host` | Admin auth required | Shows answer during Guess Phase, Correct/Incorrect buttons, kick controls, music progress, player management. |

Host opens both simultaneously as separate browser tabs or on separate screens.

---

## 6. Music & Video

### Source — AnisongDB (`anisongdb.com`)
Endpoints used in Host Tool:
- `POST /api/search_request` — search by anime name, song name, or artist.
- `GET /api/artist_autocomplete` — typeahead for artist field.
- `GET /api/song_name_autocomplete` — typeahead for song name field.

Each `SongEntry` result includes:
- `songName`, `songArtist`, anime title, `animeVintage`, `songType` (OP/ED/Insert)
- `HQ` — high-quality video URL (AMQ CDN)
- `MQ` — medium-quality video URL (AMQ CDN)
- Songs where both `HQ` and `MQ` are null → **blocked from being added**, host shown a warning.

### Playback
| Phase | Audio | Video element |
|-------|-------|---------------|
| Preload | Silent | Hidden, loading |
| Guess Phase | Playing | Hidden (CSS) |
| Paused (wrong guess) | Paused | Hidden |
| Reveal Phase | Playing | Visible |

- Prefer `HQ`; fall back to `MQ`.
- Single `<video>` element — audio extracted from the video track, no separate audio request.
- **Clip max duration**: host-configurable per game (default 60s). Clip ends naturally if shorter.
- Video position carries over between wrong guesses (resumes from pause point).

---

## 7. Buzzer Mechanics

- 1 buzz per player per question.
- Triggers: tap on-screen button **or** press Enter key.
- Server-side timestamp tie-breaking for simultaneous buzzes.
- Buzz → all buzzers lock → incorrect unlocks everyone except the guesser → next buzz locks all again.
- All buzzers reset at the start of each new question.

---

## 8. Scoring

- Points per correct answer = card's star rating × star→point mapping.
- Wrong answer deduction: **host-configurable** (default: 0).
- Live scoreboard visible on Display Screen throughout.
- Final podium + ranked list on End Screen.

---

## 9. Player UX

- Display name: text input, max 20 characters.
- Color palette: 10 preset colors, each exclusive to one player per session.
  - Proposed palette: Red, Orange, Yellow, Green, Teal, Blue, Purple, Pink, White, Black.
- Name + color shown on scoreboard and buzz notification banner.

---

## 10. Auth & Admin

- Single admin account. Username + bcrypt-hashed password stored in MongoDB `admins` collection.
- `/admin` login → issues a JWT stored as an httpOnly cookie.
- Auth-required routes: `/host`, `/admin/*`.
- Public routes: `/display`, `/` (player join/lobby).

---

## 11. Data Storage — MongoDB

| Collection | Contents |
|------------|----------|
| `admins` | `{ username, passwordHash }` |
| `games` | `{ name, settings, cards: [{ label, stars, songs: [SongEntry] }] }` |
| `sessions` | `{ gameId, players, scores, usedSongs, currentCard, banList, status }` |

SongEntry data cached inside `games` to avoid re-fetching AnisongDB at runtime.

---

## 12. Deployment

**Railway Hobby (~$5/mo) + MongoDB Atlas Free Tier ($0)**

- Railway: persistent uptime (no spin-down), native WebSocket support, GitHub auto-deploy.
- Render Free avoided — 15-min spin-down causes cold starts mid-game.
- Atlas Free (512MB) sufficient for game/session data.

---

## 13. Out of Scope (v1)

- Persistent leaderboards across sessions
- Native mobile app
- Spectator mode
- Multiple concurrent games per instance
- Daily Double equivalent
- Social login / OAuth
