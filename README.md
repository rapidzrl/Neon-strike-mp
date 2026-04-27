# NEON STRIKE — Multiplayer

Online multiplayer for the NEON STRIKE FPS game. Supports **co-op vs zombies**
(up to 8 players) and **PvP deathmatch**.

## Quick start (run locally with friends on your LAN)

You need [Node.js 18+](https://nodejs.org) installed.

```bash
# 1. Install the WebSocket library
npm install

# 2. Start the server
npm start
```

Then open `http://localhost:3000` in your browser. Click **MULTIPLAYER**, pick
a mode, and host a room. Share the 4-character room code with your friends —
they connect to your machine's local IP (e.g. `http://192.168.1.42:3000`) and
enter the code to join.

## How to play online (over the internet)

You'll need to host the server somewhere your friends can reach. Three common
approaches, easiest first:

### Option A: ngrok tunnel (zero hosting, fastest)

Run the server locally, then expose it with [ngrok](https://ngrok.com):

```bash
npm start                    # in one terminal
ngrok http 3000              # in another
```

ngrok prints a public URL like `https://abc123.ngrok.io`. Friends open that
URL in a browser and can host/join rooms. Free tier works fine for friends-only
sessions.

### Option B: Render.com (free tier, always-on)

1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com), create a new **Web Service** from your
   repo.
3. Build command: `npm install`
4. Start command: `node server.js`
5. Render gives you a `https://your-app.onrender.com` URL — share that.

The free tier sleeps after 15 min of inactivity (cold start adds ~30s on first
load). Fine for casual play.

### Option C: Railway / Fly.io / your own VPS

Same idea — any Node.js host works. The server reads the `PORT` environment
variable, which all major platforms set automatically.

## Game modes

### Co-op vs zombies
- All players fight server-controlled zombies together
- Waves get progressively harder (more zombies, more health, more damage)
- When you go down, you respawn after 5 seconds **as long as a teammate is
  alive** — full team wipe ends the run
- Kills are tracked per-player on the scoreboard

### PvP Deathmatch
- Free-for-all — every player vs every other player
- No zombies, no perk machines, no ammo stations (keeps it pure)
- Respawn 3 seconds after death
- Kills are tracked per-player

## Controls

In addition to the regular game controls:

| Key | Action |
|-----|--------|
| `T` | Open chat |
| `Enter` | Send chat message |
| `Esc` | Leave the room (multiplayer) or open menu (single-player) |

## What's synced

| Thing | Authority |
|-------|-----------|
| Player position & aim | Client → relayed to others |
| Player health | Server |
| Zombie positions & AI | Server |
| Zombie damage | Client reports, server validates |
| PvP damage | Client reports, server validates with distance check |
| Wave progression | Server |
| Chat | Server relays |

This is a friend-tier setup — there's no anti-cheat. A determined cheater
could fly through walls or report fake hits. For the intended use case
(playing with people you know) it's fine.

## Project structure

```
.
├── index.html        # The game (single-file, includes all multiplayer code)
├── server.js         # Node.js WebSocket server — handles rooms, sync, AI
├── package.json
└── README.md
```

The server keeps a hardcoded copy of the map data — if you tweak the map in
`index.html`, mirror the change in `server.js` (the `MAP` constant) so
server-side zombie pathing stays in sync.

## Troubleshooting

**"Connection failed"** — Server isn't running, or the URL is wrong. Try
`ws://localhost:3000` explicitly. If hosting remotely, use `wss://` for HTTPS
sites.

**"Connection timed out"** — Firewall is blocking port 3000, or the server
URL is unreachable from the browser. If running locally, your friends need
to use your LAN IP, not `localhost`.

**Mixed content errors when using ngrok with a `wss://` URL** — Make sure the
client is loaded over HTTPS too. ngrok's HTTPS URL automatically upgrades
WebSocket to `wss://`.

**Players see different zombie positions** — Snapshot rate is 10 Hz; some
visual jitter is expected on high-latency connections. Movement is
client-side predicted for the local player (no input lag on your own moves).

**"Room full"** — 8-player cap per room. Spin up another room.
