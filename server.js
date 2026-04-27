// ============================================================================
//  NEON STRIKE — Multiplayer Server
// ----------------------------------------------------------------------------
//  Authoritative-ish WebSocket server. Movement is client-authoritative
//  (clients tell the server where they are); damage/kills/zombies are
//  server-authoritative in co-op mode. PvP is client-reported hits with basic
//  sanity checks. Good enough for friends; not anti-cheat hardened.
// ============================================================================

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ─── HTTP: serve index.html ──────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/index.html';
  const filePath = path.join(__dirname, url);
  // Path traversal guard
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

// ─── ROOM STATE ──────────────────────────────────────────────────────────────
//  rooms: Map<code, Room>
//    Room = { code, mode, players:Map<id, Player>, bots, wave, botsRemaining,
//             hostId, lastBotUpdate, started, scores }
const rooms = new Map();

const MAP_W = 16, MAP_H = 16;
// ─── MAPS ────────────────────────────────────────────────────────────────────
//  Mirrors the client's MAPS registry. Server uses these for bot AI (wall
//  pathing) and bot spawn points. Keep these in sync with the corresponding
//  entries in index.html.
const MAPS = {
  jungle: {
    data: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,1,0,0,1,0,0,1,1,0,0,0,1],
      [1,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,1,1,0,0,1,1,0,0,0,0,1],
      [1,1,0,1,0,1,0,0,0,0,1,0,1,0,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,1,1,0,0,1,1,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,1,1,0,0,1,0,0,1,1,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawnPoints: [
      [13.5,13.5],[2.5,13.5],[13.5,2.5],[8.5,8.5],
      [13.5,5.5], [5.5,2.5], [8.5,5.5], [2.5,5.5],
      [13.5,10.5],[8.5,11.5]
    ],
    playerSpawns: [
      { x: 2.5, y: 2.5 },
      { x: 13.5, y: 2.5 },
      { x: 2.5, y: 13.5 },
      { x: 13.5, y: 13.5 },
      { x: 8.5, y: 8.5 },
      { x: 5.5, y: 11.5 },
    ],
  },
  space: {
    data: [
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,0,0,0,1,1,0,0,0,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,1,0,0,0,0,1,0,0,1,0,0,0,0,1,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,1,0,0,0,0,0,0,1,0,0,0,1],
      [1,1,0,0,0,0,1,0,0,1,0,0,0,0,1,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,1,0,0,0,1,1,0,0,0,1,0,0,1],
      [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
      [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
      [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    ],
    spawnPoints: [
      [13.5,13.5],[2.5,13.5],[13.5,2.5],[7.5,8.5],
      [13.5,5.5], [5.5,2.5], [8.5,5.5], [2.5,5.5],
      [13.5,10.5],[7.5,11.5]
    ],
    playerSpawns: [
      { x: 2.5, y: 2.5 },
      { x: 13.5, y: 2.5 },
      { x: 2.5, y: 13.5 },
      { x: 13.5, y: 13.5 },
      { x: 7.5, y: 7.5 },
      { x: 8.5, y: 8.5 },
    ],
  },
};

// ─── DIFFICULTY ──────────────────────────────────────────────────────────────
//  Multipliers applied to zombie stats for co-op rooms. PvP rooms ignore this.
//  These are intentionally VERY different across tiers so the difficulty is
//  immediately obvious in gameplay. If easy still feels hard, lower numbers.
//  If hard doesn't feel hard, raise numbers.
const DIFFICULTY = {
  // Casual: zombies crawl, barely scratch you
  easy:   { speedMult: 0.40, healthMult: 0.6,  dmgMult: 0.25, attackCdMs: 1500 },
  // Standard challenge
  medium: { speedMult: 0.75, healthMult: 0.9,  dmgMult: 0.7,  attackCdMs: 800  },
  // Brutal: fast, tough, hits like a truck
  hard:   { speedMult: 1.25, healthMult: 1.4,  dmgMult: 1.5,  attackCdMs: 400  },
};

let nextPlayerId = 1;
let nextBotId    = 1;

function genCode() {
  // 4-char alphanumeric (no ambiguous chars)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(s) ? genCode() : s;
}

// isWall now takes the wall grid explicitly. Each room has its own map.
// Most callers have a `room` in scope, so they can pass `room.mapData`.
function isWall(mapData, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= MAP_W || iy >= MAP_H) return true;
  return mapData[iy][ix] === 1;
}

function isOpenSpot(mapData, x, y) { return !isWall(mapData, x, y); }

function findOpenSpawn(roomState, attempt = 0) {
  if (attempt > 30) return { x: 8.5, y: 8.5 };
  const mapData = roomState.mapData;
  const spawns = MAPS[roomState.map].playerSpawns;
  // Pick the spawn farthest from any existing player
  let best = spawns[0], bestDist = -1;
  for (const sp of spawns) {
    if (!isOpenSpot(mapData, sp.x, sp.y)) continue;
    let minDist = 99;
    for (const p of roomState.players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - sp.x, p.y - sp.y);
      if (d < minDist) minDist = d;
    }
    if (minDist > bestDist) { bestDist = minDist; best = sp; }
  }
  return best;
}

// ─── MESSAGES ────────────────────────────────────────────────────────────────
function send(ws, type, data) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify({ t: type, ...data })); } catch (_) {}
}

function broadcast(room, type, data, exceptId = null) {
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    send(p.ws, type, data);
  }
}

// ─── BOT AI (co-op only, server-side) ────────────────────────────────────────
const MIN_SPAWN_DIST = 5.0;   // tiles from any player

function spawnBots(room, count) {
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.medium;
  const mapData = room.mapData;
  const fallbacks = MAPS[room.map].spawnPoints;
  // Compute the actual stats one zombie will have, for logging
  const sampleHp     = Math.floor((60 + room.wave * 15) * diff.healthMult);
  const sampleSpeed  = Math.min(0.025, (0.010 + room.wave * 0.0009) * diff.speedMult);
  const sampleDmg    = Math.max(1, Math.floor((10 + room.wave * 1.0) * diff.dmgMult));
  const sampleDps    = (sampleDmg / (diff.attackCdMs / 1000)).toFixed(1);
  console.log(`[spawn] room=${room.code} map=${room.map} difficulty=${room.difficulty} wave=${room.wave} count=${count}`);
  console.log(`[spawn] → zombies: hp=${sampleHp} speed=${sampleSpeed.toFixed(4)} dmg=${sampleDmg}/${diff.attackCdMs}ms (≈${sampleDps} DPS)`);
  for (let i = 0; i < count; i++) {
    let x, y, tries = 0;
    let placed = false;
    // First pass: random placement with strong min-distance check
    while (tries < 50) {
      x = Math.floor(Math.random() * (MAP_W - 4)) + 2.5;
      y = Math.floor(Math.random() * (MAP_H - 4)) + 2.5;
      tries++;
      if (!isWall(mapData, x, y) && !tooCloseToPlayers(room, x, y, MIN_SPAWN_DIST)) {
        placed = true; break;
      }
    }
    // Fallback: pick the FARTHEST hand-picked spawn from any player.
    if (!placed) {
      let best = null, bestMin = -1;
      for (const sp of fallbacks) {
        if (isWall(mapData, sp[0], sp[1])) continue;
        let minD = 99;
        for (const p of room.players.values()) {
          if (!p.alive) continue;
          const d = Math.hypot(p.x - sp[0], p.y - sp[1]);
          if (d < minD) minD = d;
        }
        if (minD > bestMin) { bestMin = minD; best = sp; }
      }
      if (best) { x = best[0]; y = best[1]; }
      console.log(`[spawn] fallback used for bot ${i+1}/${count} → (${x.toFixed(1)},${y.toFixed(1)}) minDist=${bestMin.toFixed(1)}`);
    }
    room.bots.push({
      id:      nextBotId++,
      x, y,
      health:  Math.floor((60 + room.wave * 15) * diff.healthMult),
      maxH:    Math.floor((60 + room.wave * 15) * diff.healthMult),
      // Speed: base scales by wave, then difficulty multiplier applies on top.
      // The clamp is generous (0.025 max) so HARD can actually feel HARD.
      speed:   Math.min(0.025, (0.010 + room.wave * 0.0009) * diff.speedMult),
      damage:  Math.max(1, Math.floor((10 + room.wave * 1.0) * diff.dmgMult)),
      alive:   true,
      lastAttack: 0,
      skinIdx: Math.floor(Math.random() * 8),
      sizeJitter: 0.85 + Math.random() * 0.3,
      animOffset: Math.random() * 1000,
    });
  }
  room.botsRemaining = room.bots.filter(b => b.alive).length;
}

function tooCloseToPlayers(room, x, y, minDist) {
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    if (Math.hypot(p.x - x, p.y - y) < minDist) return true;
  }
  return false;
}

function nearestPlayer(room, bot) {
  let best = null, bestD = 99;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - bot.x, p.y - bot.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? { player: best, dist: bestD } : null;
}

function updateBots(room) {
  if (room.mode !== 'coop') return;
  const diff = DIFFICULTY[room.difficulty] || DIFFICULTY.medium;
  const mapData = room.mapData;
  const now = Date.now();
  for (const bot of room.bots) {
    if (!bot.alive) continue;
    const target = nearestPlayer(room, bot);
    if (!target) continue;
    const { player: p, dist } = target;

    // ── AGGRESSION: bigger reach, faster swings ──
    if (dist < 0.85) {
      if (now - bot.lastAttack > diff.attackCdMs) {
        bot.lastAttack = now;
        p.health = Math.max(0, p.health - bot.damage);
        send(p.ws, 'damage', { amount: bot.damage, fromBot: bot.id });
        broadcast(room, 'playerHealth', { id: p.id, health: p.health });
        if (p.health <= 0) {
          p.alive = false;
          broadcast(room, 'playerDown', { id: p.id });
          setTimeout(() => respawnPlayer(room, p.id), 5000);
        }
      }
    } else {
      const dx = p.x - bot.x, dy = p.y - bot.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = bot.x + (dx / len) * bot.speed;
      const ny = bot.y + (dy / len) * bot.speed;
      const oldX = bot.x, oldY = bot.y;
      if (!isWall(mapData, nx, bot.y)) bot.x = nx;
      if (!isWall(mapData, bot.x, ny)) bot.y = ny;
      // Wall-slide
      if (bot.x === oldX && bot.y === oldY) {
        const perp = Math.atan2(dy, dx) + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
        const sx = bot.x + Math.cos(perp) * bot.speed;
        const sy = bot.y + Math.sin(perp) * bot.speed;
        if (!isWall(mapData, sx, bot.y)) bot.x = sx;
        if (!isWall(mapData, bot.x, sy)) bot.y = sy;
      }
    }
  }
}

function respawnPlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p || !rooms.has(room.code)) return;
  // Co-op wipe rule: only triggers if MULTIPLE players exist and ALL are dead.
  // Solo players always respawn so the run can continue.
  if (room.mode === 'coop' && room.players.size > 1) {
    const anyAlive = Array.from(room.players.values()).some(pp => pp.alive);
    if (!anyAlive) {
      broadcast(room, 'wipe', {});
      return;
    }
  }
  const sp = findOpenSpawn(room);
  p.x = sp.x; p.y = sp.y;
  p.health = 100;
  p.alive = true;
  send(p.ws, 'respawn', { x: p.x, y: p.y, health: p.health });
  broadcast(room, 'playerRespawn', { id: p.id, x: p.x, y: p.y, health: p.health });
  console.log(`[respawn] room=${room.code} player=${p.name} at (${sp.x.toFixed(1)},${sp.y.toFixed(1)})`);
}

function nextWave(room) {
  room.wave++;
  const count = Math.min(5 + room.wave * 2, 30);
  spawnBots(room, count);
  broadcast(room, 'wave', { wave: room.wave, botCount: count });
}

// ─── GAME TICK ───────────────────────────────────────────────────────────────
//  Runs ~10× per second per active room. Sends bot positions and player
//  positions. Movement updates from clients are forwarded immediately on
//  receipt for snappy feel; this tick is for bot motion + reconciliation.
function tick(room) {
  if (!room.started) return;
  updateBots(room);

  // Send compact snapshot
  const snapshot = {
    bots: room.mode === 'coop'
      ? room.bots.filter(b => b.alive).map(b => ({
          id: b.id, x: +b.x.toFixed(3), y: +b.y.toFixed(3),
          h: b.health, mh: b.maxH, s: b.skinIdx,
          sj: b.sizeJitter, ao: b.animOffset,
        }))
      : [],
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, x: +p.x.toFixed(3), y: +p.y.toFixed(3),
      a: +p.angle.toFixed(3), h: p.health, alive: p.alive, kills: p.kills,
      color: p.color,
    })),
    wave: room.wave,
    botsRemaining: room.bots.filter(b => b.alive).length,
  };
  broadcast(room, 'snapshot', snapshot);

  // Wave clear check (co-op)
  if (room.mode === 'coop' && room.bots.length > 0 && room.bots.every(b => !b.alive)) {
    setTimeout(() => {
      if (rooms.has(room.code) && room.bots.every(b => !b.alive)) nextWave(room);
    }, 2000);
  }
}

setInterval(() => {
  for (const room of rooms.values()) tick(room);
}, 50);   // 20 Hz — smoother bot motion now that they're aggressive

// ─── WEBSOCKET HANDLING ──────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const playerId = nextPlayerId++;
  ws._playerId = playerId;
  ws._roomCode = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }

    switch (msg.t) {
      case 'create': handleCreate(ws, msg); break;
      case 'join':   handleJoin(ws, msg);   break;
      case 'start':  handleStart(ws);       break;
      case 'move':   handleMove(ws, msg);   break;
      case 'shoot':  handleShoot(ws, msg);  break;
      case 'hitBot': handleHitBot(ws, msg); break;
      case 'hitPlayer': handleHitPlayer(ws, msg); break;
      case 'chat':   handleChat(ws, msg);   break;
      case 'leave':  handleLeave(ws);       break;
    }
  });

  ws.on('close', () => handleLeave(ws));
});

function handleCreate(ws, msg) {
  const mode = (msg.mode === 'pvp') ? 'pvp' : 'coop';
  const name = sanitizeName(msg.name);
  const difficulty = (msg.difficulty === 'easy' || msg.difficulty === 'hard')
    ? msg.difficulty : 'medium';
  // Map: jungle (default) or space. Validate against MAPS so a bad value
  // can't crash the server.
  const mapId = (msg.map && MAPS[msg.map]) ? msg.map : 'jungle';
  const code = genCode();
  const room = {
    code, mode, difficulty,
    map: mapId,
    mapData: MAPS[mapId].data,
    players: new Map(),
    bots: [],
    wave: 0,
    botsRemaining: 0,
    hostId: ws._playerId,
    started: false,
  };
  rooms.set(code, room);
  addPlayerToRoom(ws, room, name);
  send(ws, 'roomJoined', {
    code, mode, difficulty, map: mapId,
    isHost: true, you: ws._playerId,
  });
  console.log(`[room created] code=${code} mode=${mode} map=${mapId} difficulty=${difficulty} host=${name}`);
}

function handleJoin(ws, msg) {
  const code = (msg.code || '').toUpperCase().trim();
  const room = rooms.get(code);
  if (!room) { send(ws, 'error', { msg: 'Room not found' }); return; }
  if (room.players.size >= 8) { send(ws, 'error', { msg: 'Room full' }); return; }
  const name = sanitizeName(msg.name);
  addPlayerToRoom(ws, room, name);
  send(ws, 'roomJoined', {
    code, mode: room.mode, difficulty: room.difficulty, map: room.map,
    isHost: false, you: ws._playerId, started: room.started,
  });
  broadcast(room, 'playerJoined', {
    id: ws._playerId, name, color: room.players.get(ws._playerId).color,
  }, ws._playerId);
  send(ws, 'roster', {
    players: Array.from(room.players.values()).map(p => ({
      id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, alive: p.alive, kills: p.kills,
    })),
    started: room.started,
    wave: room.wave,
  });
}

function addPlayerToRoom(ws, room, name) {
  ws._roomCode = room.code;
  const sp = findOpenSpawn(room);
  // Color palette for players (cycles)
  const palette = ['#44ff88','#ff4488','#44aaff','#ffaa44','#aa44ff','#ffff44','#44ffff','#ff8844'];
  const color = palette[(room.players.size) % palette.length];
  const player = {
    id: ws._playerId, name, ws,
    x: sp.x, y: sp.y, angle: 0,
    health: 100, maxHealth: 100,
    alive: true,
    kills: 0,
    deaths: 0,
    color,
  };
  room.players.set(ws._playerId, player);
}

function sanitizeName(n) {
  if (typeof n !== 'string') return 'Player';
  n = n.replace(/[^\w \-]/g, '').trim().slice(0, 16);
  return n || 'Player';
}

function handleStart(ws) {
  const room = rooms.get(ws._roomCode); if (!room) return;
  if (room.hostId !== ws._playerId) return;
  if (room.started) return;
  room.started = true;
  room.wave = 0;
  if (room.mode === 'coop') spawnBots(room, 5);
  // Reset all players health, set spawns
  for (const p of room.players.values()) {
    const sp = findOpenSpawn(room);
    p.x = sp.x; p.y = sp.y;
    p.health = 100; p.alive = true; p.kills = 0;
  }
  if (room.mode === 'coop') room.wave = 1;
  broadcast(room, 'gameStarted', { mode: room.mode, wave: room.wave });
}

function handleMove(ws, msg) {
  const room = rooms.get(ws._roomCode); if (!room) return;
  const p = room.players.get(ws._playerId); if (!p || !p.alive) return;
  // Light sanity: clamp into bounds, no teleport > 1 tile per update
  if (typeof msg.x !== 'number' || typeof msg.y !== 'number' || typeof msg.a !== 'number') return;
  const nx = clamp(msg.x, 0.2, MAP_W - 0.2);
  const ny = clamp(msg.y, 0.2, MAP_H - 0.2);
  // Reject obvious teleports (allows fast movement, blocks abuse)
  if (Math.hypot(nx - p.x, ny - p.y) > 1.5) return;
  p.x = nx; p.y = ny; p.angle = msg.a;
}

function handleShoot(ws, msg) {
  const room = rooms.get(ws._roomCode); if (!room) return;
  const p = room.players.get(ws._playerId); if (!p || !p.alive) return;
  // Just relay — clients render muzzle flashes on remote players
  broadcast(room, 'remoteShot', { id: p.id, weapon: msg.weapon || 'pistol' }, p.id);
}

function handleHitBot(ws, msg) {
  const room = rooms.get(ws._roomCode); if (!room || room.mode !== 'coop') return;
  const p = room.players.get(ws._playerId); if (!p || !p.alive) return;
  const bot = room.bots.find(b => b.id === msg.botId);
  if (!bot || !bot.alive) return;
  const dmg = Math.max(1, Math.min(150, msg.dmg | 0));
  bot.health -= dmg;
  broadcast(room, 'botHit', { id: bot.id, h: bot.health, by: p.id });
  if (bot.health <= 0) {
    bot.alive = false;
    p.kills++;
    broadcast(room, 'botDied', { id: bot.id, by: p.id, kills: p.kills });
  }
}

function handleHitPlayer(ws, msg) {
  const room = rooms.get(ws._roomCode); if (!room || room.mode !== 'pvp') return;
  const attacker = room.players.get(ws._playerId);
  const victim = room.players.get(msg.targetId);
  if (!attacker || !victim || !attacker.alive || !victim.alive) return;
  if (attacker.id === victim.id) return;
  // Sanity: must be roughly in line of sight (server doesn't raycast — just distance check)
  const dist = Math.hypot(attacker.x - victim.x, attacker.y - victim.y);
  if (dist > 14) return;
  const dmg = Math.max(1, Math.min(150, msg.dmg | 0));
  victim.health = Math.max(0, victim.health - dmg);
  send(victim.ws, 'damage', { amount: dmg, fromPlayer: attacker.id });
  broadcast(room, 'playerHealth', { id: victim.id, health: victim.health });
  if (victim.health <= 0) {
    victim.alive = false;
    victim.deaths++;
    attacker.kills++;
    broadcast(room, 'playerKilled', {
      victimId: victim.id, killerId: attacker.id, kills: attacker.kills,
    });
    // PvP: respawn after 3s
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      const sp = findOpenSpawn(room);
      victim.x = sp.x; victim.y = sp.y;
      victim.health = 100; victim.alive = true;
      send(victim.ws, 'respawn', { x: victim.x, y: victim.y, health: victim.health });
      broadcast(room, 'playerRespawn', { id: victim.id, x: victim.x, y: victim.y, health: victim.health });
    }, 3000);
  }
}

function handleChat(ws, msg) {
  const room = rooms.get(ws._roomCode); if (!room) return;
  const p = room.players.get(ws._playerId); if (!p) return;
  const text = String(msg.text || '').slice(0, 200);
  if (!text.trim()) return;
  broadcast(room, 'chat', { from: p.name, color: p.color, text });
}

function handleLeave(ws) {
  const code = ws._roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const p = room.players.get(ws._playerId);
  room.players.delete(ws._playerId);
  if (p) broadcast(room, 'playerLeft', { id: p.id, name: p.name });
  if (room.players.size === 0) {
    rooms.delete(code);
  } else if (room.hostId === ws._playerId) {
    // Promote a new host
    const newHost = room.players.values().next().value;
    room.hostId = newHost.id;
    broadcast(room, 'newHost', { id: newHost.id });
  }
  ws._roomCode = null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

server.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  NEON STRIKE Multiplayer Server                            ║`);
  console.log(`║  Listening on port ${String(PORT).padEnd(40)}║`);
  console.log(`║  Open http://localhost:${PORT} to play                       ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
});
