const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ---------------- CONFIG ----------------
const WORLD_SIZE = 2000;
const DAY_LENGTH = 210000; // 3.5 minuti giorno
const NIGHT_LENGTH = 60000; // 1 minuto notte
const TICK_RATE = 50; // ms (20Hz)
const MONSTER_SPAWN_INTERVAL = 4000;
const MAX_MONSTERS_NIGHT_BASE = 12;
const MAX_MONSTERS_NIGHT_CAP = 40;
const NIGHT_DIFFICULTY_MONSTERS_PER_NIGHT = 1.1;
const NIGHT_DIFFICULTY_STAT_STEP = 0.06;
const NIGHT_DIFFICULTY_STAT_CAP = 1.6;
const BOSS_NIGHT_INTERVAL = 5;
const MAX_STRUCTURES = 400;

const PLAYER_RADIUS = 14;
const PLAYER_SPEED_PER_SEC = 80;

const SOLID_RADIUS = { tree: 24, rock: 20, wall: 26, campfire: 18 };

const SPIKES_RADIUS = 22, SPIKES_DAMAGE = 10, SPIKES_TICK_MS = 700;
const PIT_RADIUS = 46, PIT_SLOW_MUL = 0.35;
const CAMPFIRE_HEAL_RADIUS = 150, CAMPFIRE_HEAL_AMOUNT = 2, CAMPFIRE_HEAL_TICK_MS = 1000;
const MONSTER_WALL_RANGE = 36, MONSTER_WALL_COOLDOWN = 900;
const FIRE_ZONE_RADIUS = 90, FIRE_ZONE_DAMAGE = 6, FIRE_ZONE_TICK_MS = 500, FIRE_ZONE_DURATION = 5000;

const HUNGER_MAX = 100, THIRST_MAX = 100;
const HUNGER_DECAY_PER_MS = 100 / (6 * 60 * 1000);  // si svuota in ~6 minuti
const THIRST_DECAY_PER_MS = 100 / (5 * 60 * 1000);  // si svuota in ~5 minuti
const STARVE_DAMAGE = 1, STARVE_TICK_MS = 2000;
const BERRY_SUSTENANCE = 30;

const BASE_INVENTORY_CAP = 60;       // somma di legno+pietra+fibra+bacche
const BACKPACK_INVENTORY_CAP = 110;
const CAPPED_RESOURCES = ['wood', 'stone', 'fiber', 'berry'];

const RECONNECT_GRACE_MS = 90000;
const SAVE_INTERVAL_MS = 30000;
const LEADERBOARD_MAX = 20;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const ROOM_IDLE_TTL_MS = 6 * 60 * 60 * 1000; // stanze inattive da oltre 6h vengono scartate al salvataggio

const WEATHER_TYPES = ['clear', 'rain', 'fog'];
const WEATHER_MIN_MS = 45000, WEATHER_MAX_MS = 120000;

const MONSTER_TYPES = {
  normal: { hp: 30, speedMin: 0.8, speedMax: 1.4, damage: 12, damageArmored: 6, wallDamage: 10, rangedMul: 1, scale: 1 },
  fast:   { hp: 15, speedMin: 1.7, speedMax: 2.3, damage: 8,  damageArmored: 4, wallDamage: 6,  rangedMul: 1, scale: 0.75 },
  tank:   { hp: 75, speedMin: 0.45, speedMax: 0.7, damage: 20, damageArmored: 12, wallDamage: 18, rangedMul: 0.55, scale: 1.35 },
  boss:   { hp: 280, speedMin: 0.5, speedMax: 0.75, damage: 30, damageArmored: 18, wallDamage: 32, rangedMul: 0.6, scale: 2.2 },
};

// Oggetti craftabili nell'inventario (menu Crafting - tasto C)
const CRAFTABLE = {
  torch:    { wood: 3, cost_desc: "3 legno" },
  spear:    { wood: 5, stone: 2, cost_desc: "5 legno, 2 pietra" },
  axe:      { wood: 4, stone: 3, cost_desc: "4 legno, 3 pietra" },
  pickaxe:  { wood: 4, stone: 4, cost_desc: "4 legno, 4 pietra" },
  bow:      { wood: 6, stone: 1, fiber: 3, cost_desc: "6 legno, 1 pietra, 3 fibra" },
  arrow:    { wood: 1, stone: 1, cost_desc: "1 legno, 1 pietra (x1 freccia)" },
  knife:    { wood: 2, stone: 3, cost_desc: "2 legno, 3 pietra" },
  armor:    { wood: 2, stone: 6, fiber: 4, cost_desc: "2 legno, 6 pietra, 4 fibra" },
  helmet:   { stone: 5, fiber: 2, cost_desc: "5 pietra, 2 fibra" },
  shield:   { wood: 6, stone: 4, cost_desc: "6 legno, 4 pietra" },
  backpack: { wood: 10, fiber: 8, cost_desc: "10 legno, 8 fibra" },
  bandage:  { fiber: 5, cost_desc: "5 fibra" },
  molotov:  { wood: 2, stone: 1, fiber: 2, cost_desc: "2 legno, 1 pietra, 2 fibra" },
};

// Strutture piazzabili nel mondo (menu Costruzione - tasto Q): costano risorse grezze al
// momento del piazzamento, tranne torch che consuma 1 unità già craftata in inventario.
const BUILDABLE = {
  wall:     { wood: 8, stone: 2, cost_desc: "8 legno, 2 pietra" },
  spikes:   { wood: 6, stone: 6, cost_desc: "6 legno, 6 pietra" },
  pit:      { wood: 3, stone: 3, cost_desc: "3 legno, 3 pietra" },
  campfire: { wood: 10, stone: 5, cost_desc: "10 legno, 5 pietra" },
  torch:    { fromInventory: true, cost_desc: "1 torcia dall'inventario" },
};

const EQUIP_ORDER = ['hand', 'spear', 'axe', 'pickaxe', 'knife', 'bow', 'torch', 'molotov'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function sanitizeText(s, maxLen) { return String(s || '').replace(/[^\w àèéìòùÀÈÉÌÒÙ' -]/g, '').trim().slice(0, maxLen); }

// ---------------- PERSISTENZA SU FILE ----------------
// NB: su Render il piano gratuito ha filesystem effimero (si perde ad ogni riavvio/redeploy).
// Questo salvataggio funziona sempre in locale e su un piano con disco persistente montato su
// DATA_DIR; sul free tier serve solo a non perdere lo stato durante la vita della singola istanza.
let leaderboard = [];

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignorato */ }
}

function loadLeaderboard() {
  try {
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) leaderboard = parsed;
  } catch (e) { leaderboard = []; }
}

function saveLeaderboard() {
  ensureDataDir();
  try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboard)); } catch (e) { console.error('salvataggio classifica fallito:', e.message); }
}

function recordRun(name, nights, kills) {
  leaderboard.push({ name, nights, kills, date: new Date().toISOString() });
  leaderboard.sort((a, b) => (b.nights - a.nights) || (b.kills - a.kills));
  leaderboard = leaderboard.slice(0, LEADERBOARD_MAX);
}

function roomToSaveData(room) {
  return {
    id: room.id,
    resources: Object.values(room.resources),
    structures: Object.values(room.structures),
    dayTimer: room.dayTimer, isNight: room.isNight, nightCount: room.nightCount,
    weather: room.weather,
    nextResId: room.nextResId, nextStructId: room.nextStructId,
    lastActivity: room.lastActivity,
  };
}

function saveRooms() {
  ensureDataDir();
  const now = Date.now();
  const data = [];
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_IDLE_TTL_MS) continue; // stanze abbandonate da ore: non salvarle
    data.push(roomToSaveData(room));
  }
  try { fs.writeFileSync(ROOMS_FILE, JSON.stringify(data)); } catch (e) { console.error('salvataggio stanze fallito:', e.message); }
}

function loadRoomsFromDisk() {
  try {
    const raw = fs.readFileSync(ROOMS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const saved of parsed) {
      const room = new GameRoom(saved.id);
      room.resources = {};
      for (const r of saved.resources || []) room.resources[r.id] = r;
      room.structures = {};
      for (const s of saved.structures || []) room.structures[s.id] = s;
      room.dayTimer = saved.dayTimer || 0;
      room.isNight = !!saved.isNight;
      room.nightCount = saved.nightCount || 0;
      room.weather = saved.weather || 'clear';
      room.nextResId = saved.nextResId || 1;
      room.nextStructId = saved.nextStructId || 1;
      room.lastActivity = saved.lastActivity || Date.now();
      rooms.set(room.id, room);
    }
    if (parsed.length) console.log(`Ripristinate ${parsed.length} stanze da ${ROOMS_FILE}`);
  } catch (e) { /* nessun salvataggio precedente, si parte da zero */ }
}

// ---------------- STANZE DI GIOCO ----------------
class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = {};       // token -> player
    this.socketToToken = {}; // socket.id attuale -> token
    this.resources = {};
    this.structures = {};
    this.monsters = [];
    this.projectiles = [];
    this.fireZones = [];
    this.dayTimer = 0;
    this.isNight = false;
    this.nightCount = 0;
    this.bossSpawnedThisNight = false;
    this.weather = 'clear';
    this.weatherChangeAt = Date.now() + rand(WEATHER_MIN_MS, WEATHER_MAX_MS);
    this.nextResId = 1; this.nextMonId = 1; this.nextProjId = 1; this.nextStructId = 1; this.nextFireId = 1;
    this.lastMonsterSpawn = 0;
    this.lastResourceRespawn = 0;
    this.lastActivity = Date.now();
    spawnResources(this);
  }
}

const rooms = new Map();
function getOrCreateRoom(id) {
  let room = rooms.get(id);
  if (!room) { room = new GameRoom(id); rooms.set(id, room); }
  return room;
}

// ---------------- RISORSE ----------------
function addResource(room, type, amount) {
  const id = room.nextResId++;
  const r = { id, type, x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount };
  room.resources[id] = r;
  io.to(room.id).emit('resourceAdded', r);
  return r;
}

function spawnResources(room) {
  room.resources = {};
  for (let i = 0; i < 60; i++) { const id = room.nextResId++; room.resources[id] = { id, type: 'tree', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 5 }; }
  for (let i = 0; i < 40; i++) { const id = room.nextResId++; room.resources[id] = { id, type: 'rock', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 5 }; }
  for (let i = 0; i < 30; i++) { const id = room.nextResId++; room.resources[id] = { id, type: 'fiber', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 3 }; }
  for (let i = 0; i < 22; i++) { const id = room.nextResId++; room.resources[id] = { id, type: 'bush', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 3 }; }
}

function newPlayer(token, name) {
  return {
    token, name: name || 'Sopravvissuto',
    x: rand(200, 400), y: rand(200, 400), angle: 0,
    hp: 100, maxHp: 100,
    hunger: HUNGER_MAX, thirst: THIRST_MAX,
    inventory: { wood: 5, stone: 2, fiber: 2, arrow: 0 },
    equipped: 'hand',
    hasArmor: false, hasHelmet: false, hasShield: false, hasBackpack: false,
    alive: true, kills: 0,
    lastAttack: 0,
    lastMoveMsgAt: Date.now(),
    lastWarmthHeal: 0, lastStarveTick: 0,
    disconnectedAt: null,
    hue: Math.floor(rand(0, 360)),
  };
}

function publicPlayer(p) {
  return {
    id: p.token, name: p.name, x: p.x, y: p.y, angle: p.angle,
    hp: p.hp, maxHp: p.maxHp, alive: p.alive,
    equipped: p.equipped, hasArmor: p.hasArmor, hasHelmet: p.hasHelmet, hasShield: p.hasShield, hasBackpack: p.hasBackpack,
    hue: p.hue,
  };
}

function inventoryCap(p) { return p.hasBackpack ? BACKPACK_INVENTORY_CAP : BASE_INVENTORY_CAP; }
function inventoryLoad(p) { return CAPPED_RESOURCES.reduce((sum, k) => sum + (p.inventory[k] || 0), 0); }
function addCappedResource(p, key, amount) {
  const room = inventoryCap(p) - inventoryLoad(p);
  const add = Math.max(0, Math.min(amount, room));
  p.inventory[key] = (p.inventory[key] || 0) + add;
  return add;
}

function damageReduction(p) {
  let r = 0;
  if (p.hasArmor) r += 6;
  if (p.hasHelmet) r += 3;
  if (p.hasShield) r += 5;
  return r;
}

function currentSocketId(room, token) {
  for (const sid in room.socketToToken) if (room.socketToToken[sid] === token) return sid;
  return null;
}
function sendToPlayer(room, token, event, payload) {
  const sid = currentSocketId(room, token);
  if (sid) io.to(sid).emit(event, payload);
}
function sendInventory(room, token) {
  const p = room.players[token];
  if (p) sendToPlayer(room, token, 'inventory', p.inventory);
}

function getSolids(room) {
  const solids = [];
  for (const id in room.resources) {
    const r = room.resources[id];
    if (r.type === 'tree' || r.type === 'rock') solids.push({ x: r.x, y: r.y, radius: SOLID_RADIUS[r.type] });
  }
  for (const id in room.structures) {
    const s = room.structures[id];
    if (s.type === 'wall' || s.type === 'campfire') solids.push({ x: s.x, y: s.y, radius: SOLID_RADIUS[s.type] });
  }
  return solids;
}
function collides(x, y, solids, selfRadius) {
  for (const s of solids) if (Math.hypot(x - s.x, y - s.y) < selfRadius + s.radius) return true;
  return false;
}

function spawnFireZone(room, x, y) {
  room.fireZones.push({ id: room.nextFireId++, x, y, radius: FIRE_ZONE_RADIUS, expiresAt: Date.now() + FIRE_ZONE_DURATION, lastTick: 0 });
}

function pickMonsterType(room) {
  const r = Math.random();
  if (room.nightCount >= 3 && r < 0.16) return 'fast';
  if (room.nightCount >= 4 && r < 0.32) return 'tank';
  return 'normal';
}

function statMultiplier(room) {
  return 1 + Math.min(NIGHT_DIFFICULTY_STAT_CAP - 1, room.nightCount * NIGHT_DIFFICULTY_STAT_STEP);
}

function spawnMonster(room, forcedType) {
  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.disconnectedAt);
  if (alivePlayers.length === 0) return;
  const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  const angle = rand(0, Math.PI * 2);
  const spawnDist = 400;
  const type = forcedType || pickMonsterType(room);
  const stats = MONSTER_TYPES[type];
  const mul = statMultiplier(room);
  room.monsters.push({
    id: room.nextMonId++,
    type,
    x: target.x + Math.cos(angle) * spawnDist,
    y: target.y + Math.sin(angle) * spawnDist,
    hp: Math.round(stats.hp * (type === 'boss' ? 1 : mul)),
    maxHp: Math.round(stats.hp * (type === 'boss' ? 1 : mul)),
    speed: rand(stats.speedMin, stats.speedMax),
    targetId: target.token,
    lastAttackerToken: null,
  });
}

function updateWeather(room, now) {
  if (now >= room.weatherChangeAt) {
    const options = WEATHER_TYPES.filter(w => w !== room.weather);
    room.weather = options[Math.floor(Math.random() * options.length)];
    room.weatherChangeAt = now + rand(WEATHER_MIN_MS, WEATHER_MAX_MS);
  }
}

function gameTick(room) {
  const now = Date.now();
  room.dayTimer += TICK_RATE;
  const cycleLen = room.isNight ? NIGHT_LENGTH : DAY_LENGTH;
  if (room.dayTimer >= cycleLen) {
    room.dayTimer = 0;
    room.isNight = !room.isNight;
    if (!room.isNight) { room.monsters = []; room.nightCount++; }
    else { room.bossSpawnedThisNight = false; }
  }

  updateWeather(room, now);

  const maxMonsters = Math.min(MAX_MONSTERS_NIGHT_CAP, Math.round(MAX_MONSTERS_NIGHT_BASE + room.nightCount * NIGHT_DIFFICULTY_MONSTERS_PER_NIGHT));
  if (room.isNight && room.nightCount > 0 && room.nightCount % BOSS_NIGHT_INTERVAL === 0 && !room.bossSpawnedThisNight && room.dayTimer > 1500) {
    spawnMonster(room, 'boss');
    room.bossSpawnedThisNight = true;
  }
  if (room.isNight && now - room.lastMonsterSpawn > MONSTER_SPAWN_INTERVAL && room.monsters.length < maxMonsters) {
    spawnMonster(room);
    room.lastMonsterSpawn = now;
  }

  for (const m of room.monsters) {
    const stats = MONSTER_TYPES[m.type] || MONSTER_TYPES.normal;
    const target = room.players[m.targetId];
    if (!target || !target.alive || target.disconnectedAt) {
      const alive = Object.values(room.players).filter(p => p.alive && !p.disconnectedAt);
      if (alive.length === 0) continue;
      m.targetId = alive[Math.floor(Math.random() * alive.length)].token;
      continue;
    }
    let blockingWall = null;
    for (const id in room.structures) {
      const s = room.structures[id];
      if (s.type !== 'wall') continue;
      if (dist(s, m) < MONSTER_WALL_RANGE && dist(s, target) < dist(m, target)) { blockingWall = s; break; }
    }
    if (blockingWall) {
      if (now - (m.lastWallHit || 0) > MONSTER_WALL_COOLDOWN) {
        blockingWall.hp -= stats.wallDamage;
        m.lastWallHit = now;
        if (blockingWall.hp <= 0) { delete room.structures[blockingWall.id]; io.to(room.id).emit('structureRemoved', blockingWall.id); }
        else io.to(room.id).emit('structureUpdate', { id: blockingWall.id, hp: blockingWall.hp });
      }
    } else {
      const d = dist(m, target);
      let speedMul = 1;
      for (const id in room.structures) {
        const s = room.structures[id];
        if (s.type === 'pit' && dist(s, m) < PIT_RADIUS) { speedMul = PIT_SLOW_MUL; break; }
      }
      if (d > 25) {
        m.x += (target.x - m.x) / d * m.speed * speedMul * (TICK_RATE / 50);
        m.y += (target.y - m.y) / d * m.speed * speedMul * (TICK_RATE / 50);
      } else if (now - (m.lastHit || 0) > 900) {
        const dmg = target.hasArmor || target.hasShield ? stats.damageArmored : stats.damage;
        target.hp = Math.max(0, target.hp - Math.max(2, dmg - damageReduction(target) * 0.4));
        m.lastHit = now;
        if (target.hp <= 0) { target.hp = 0; target.alive = false; }
      }
    }
  }

  for (const m of room.monsters) {
    if (now - (m.lastSpikeHit || 0) < SPIKES_TICK_MS) continue;
    for (const id in room.structures) {
      const s = room.structures[id];
      if (s.type === 'spikes' && dist(s, m) < SPIKES_RADIUS) { m.hp -= SPIKES_DAMAGE; m.lastSpikeHit = now; break; }
    }
  }

  for (const token in room.players) {
    const p = room.players[token];
    if (!p.alive || p.disconnectedAt || p.hp >= p.maxHp) continue;
    if (now - (p.lastWarmthHeal || 0) < CAMPFIRE_HEAL_TICK_MS) continue;
    for (const id in room.structures) {
      const s = room.structures[id];
      if (s.type === 'campfire' && dist(s, p) < CAMPFIRE_HEAL_RADIUS) { p.hp = Math.min(p.maxHp, p.hp + CAMPFIRE_HEAL_AMOUNT); p.lastWarmthHeal = now; break; }
    }
  }

  for (const token in room.players) {
    const p = room.players[token];
    if (!p.alive || p.disconnectedAt) continue;
    p.hunger = Math.max(0, p.hunger - HUNGER_DECAY_PER_MS * TICK_RATE);
    p.thirst = Math.max(0, p.thirst - THIRST_DECAY_PER_MS * TICK_RATE);
    if ((p.hunger <= 0 || p.thirst <= 0) && now - (p.lastStarveTick || 0) > STARVE_TICK_MS) {
      p.hp = Math.max(0, p.hp - STARVE_DAMAGE);
      p.lastStarveTick = now;
      if (p.hp <= 0) { p.hp = 0; p.alive = false; }
    }
  }

  room.projectiles = room.projectiles.filter(pr => {
    pr.x += Math.cos(pr.angle) * pr.speed;
    pr.y += Math.sin(pr.angle) * pr.speed;
    pr.life -= TICK_RATE;
    for (const m of room.monsters) {
      if (dist(pr, m) < 25) {
        const stats = MONSTER_TYPES[m.type] || MONSTER_TYPES.normal;
        m.hp -= pr.damage * (stats.rangedMul !== undefined ? stats.rangedMul : 1);
        m.lastAttackerToken = pr.owner;
        if (pr.type === 'molotov') spawnFireZone(room, pr.x, pr.y);
        return false;
      }
    }
    if (pr.life <= 0) { if (pr.type === 'molotov') spawnFireZone(room, pr.x, pr.y); return false; }
    return true;
  });

  room.fireZones = room.fireZones.filter(fz => {
    if (now - fz.lastTick > FIRE_ZONE_TICK_MS) {
      fz.lastTick = now;
      for (const m of room.monsters) if (dist(fz, m) < fz.radius) m.hp -= FIRE_ZONE_DAMAGE;
    }
    return now < fz.expiresAt;
  });

  const dead = room.monsters.filter(m => m.hp <= 0);
  for (const m of dead) { if (m.lastAttackerToken && room.players[m.lastAttackerToken]) room.players[m.lastAttackerToken].kills++; }
  room.monsters = room.monsters.filter(m => m.hp > 0);

  if (now - room.lastResourceRespawn > 8000) {
    room.lastResourceRespawn = now;
    const counts = { tree: 0, rock: 0, fiber: 0, bush: 0 };
    for (const id in room.resources) counts[room.resources[id].type] = (counts[room.resources[id].type] || 0) + 1;
    if (counts.tree < 60) addResource(room, 'tree', 5);
    if (counts.rock < 40) addResource(room, 'rock', 5);
    if (counts.fiber < 30) addResource(room, 'fiber', 3);
    if (counts.bush < 22) addResource(room, 'bush', 3);
  }

  for (const token in room.players) {
    const p = room.players[token];
    if (p.disconnectedAt && now - p.disconnectedAt > RECONNECT_GRACE_MS) delete room.players[token];
  }

  const publicPlayers = {};
  let anyConnected = false;
  for (const token in room.players) {
    const p = room.players[token];
    if (p.disconnectedAt) continue;
    publicPlayers[token] = publicPlayer(p);
    anyConnected = true;
  }
  if (anyConnected) room.lastActivity = now;

  io.to(room.id).emit('state', {
    players: publicPlayers, monsters: room.monsters, projectiles: room.projectiles, fireZones: room.fireZones,
    isNight: room.isNight, dayTimer: room.dayTimer, cycleLen, nightCount: room.nightCount, weather: room.weather,
  });

  for (const token in room.players) {
    const p = room.players[token];
    if (p.disconnectedAt) continue;
    sendToPlayer(room, token, 'vitals', { hunger: p.hunger, thirst: p.thirst, kills: p.kills });
  }
}

function tickAllRooms() { for (const room of rooms.values()) gameTick(room); }
setInterval(tickAllRooms, TICK_RATE);

// ---------------- SOCKET HANDLERS ----------------
io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('join', (data) => {
    const name = sanitizeText(data?.name, 16) || 'Sopravvissuto';
    const roomId = sanitizeText(data?.roomId, 20).toLowerCase() || 'pubblica';
    const room = getOrCreateRoom(roomId);
    currentRoomId = roomId;
    socket.join(roomId);

    let token = typeof data?.token === 'string' ? data.token : null;
    let player = token ? room.players[token] : null;

    if (player && player.disconnectedAt) {
      player.disconnectedAt = null;
      player.name = name || player.name;
    } else {
      token = genToken();
      player = newPlayer(token, name);
      room.players[token] = player;
    }
    room.socketToToken[socket.id] = token;
    room.lastActivity = Date.now();

    socket.emit('init', {
      id: token, token, roomId,
      x: player.x, y: player.y,
      craftRecipes: CRAFTABLE, buildRecipes: BUILDABLE, equipOrder: EQUIP_ORDER,
      worldSize: WORLD_SIZE,
      resources: Object.values(room.resources),
      structures: Object.values(room.structures),
      inventory: player.inventory,
      inventoryCap: inventoryCap(player),
      nightCount: room.nightCount,
    });
  });

  socket.on('move', (data) => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p || !p.alive) return;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.angle !== 'number') return;
    const now = Date.now();
    const elapsed = Math.min(500, now - (p.lastMoveMsgAt || now));
    p.lastMoveMsgAt = now;
    const maxDist = PLAYER_SPEED_PER_SEC * (elapsed / 1000) * 1.5 + 6;
    const nx = clamp(data.x, 0, WORLD_SIZE);
    const ny = clamp(data.y, 0, WORLD_SIZE);
    if (dist(p, { x: nx, y: ny }) > maxDist) return;
    const solids = getSolids(room);
    if (!collides(nx, ny, solids, PLAYER_RADIUS)) { p.x = nx; p.y = ny; }
    else if (!collides(nx, p.y, solids, PLAYER_RADIUS)) { p.x = nx; }
    else if (!collides(p.x, ny, solids, PLAYER_RADIUS)) { p.y = ny; }
    p.angle = data.angle;
  });

  socket.on('gather', (resId) => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    const res = room.resources[resId];
    if (!p || !res || !p.alive) return;
    if (dist(p, res) > 80) return;
    res.amount -= 1;
    const key = res.type === 'tree' ? 'wood' : res.type === 'rock' ? 'stone' : res.type === 'fiber' ? 'fiber' : 'berry';
    addCappedResource(p, key, 2);
    if (res.amount <= 0) { delete room.resources[resId]; io.to(room.id).emit('resourceRemoved', resId); }
    else io.to(room.id).emit('resourceUpdate', { id: res.id, amount: res.amount });
    sendInventory(room, token);
  });

  socket.on('eat', () => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p || !p.alive || (p.inventory.berry || 0) < 1) return;
    p.inventory.berry -= 1;
    p.hunger = Math.min(HUNGER_MAX, p.hunger + BERRY_SUSTENANCE);
    p.thirst = Math.min(THIRST_MAX, p.thirst + BERRY_SUSTENANCE);
    sendInventory(room, token);
  });

  socket.on('craft', (itemType) => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    const recipe = CRAFTABLE[itemType];
    if (!p || !recipe || !p.alive) return;
    for (const key in recipe) { if (key === 'cost_desc') continue; if ((p.inventory[key] || 0) < recipe[key]) return; }
    for (const key in recipe) { if (key === 'cost_desc') continue; p.inventory[key] -= recipe[key]; }
    if (itemType === 'arrow') p.inventory.arrow = (p.inventory.arrow || 0) + 1;
    else if (itemType === 'armor') p.hasArmor = true;
    else if (itemType === 'helmet') p.hasHelmet = true;
    else if (itemType === 'shield') p.hasShield = true;
    else if (itemType === 'backpack') p.hasBackpack = true;
    else if (itemType === 'bandage') p.hp = Math.min(p.maxHp, p.hp + 25);
    else p.inventory[itemType] = (p.inventory[itemType] || 0) + 1;
    sendInventory(room, token);
  });

  socket.on('equip', (item) => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p) return;
    if (item === 'hand' || (p.inventory[item] && p.inventory[item] > 0)) p.equipped = item;
  });

  socket.on('placeStructure', (data) => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p || !p.alive) return;
    const type = data?.type;
    const recipe = BUILDABLE[type];
    if (!recipe) return;
    if (Object.keys(room.structures).length >= MAX_STRUCTURES) return;
    if (recipe.fromInventory) {
      if ((p.inventory[type] || 0) < 1) return;
      p.inventory[type] -= 1;
    } else {
      for (const key in recipe) { if (key === 'cost_desc') continue; if ((p.inventory[key] || 0) < recipe[key]) return; }
      for (const key in recipe) { if (key === 'cost_desc') continue; p.inventory[key] -= recipe[key]; }
    }
    const px = clamp(p.x + Math.cos(p.angle) * 60, 0, WORLD_SIZE);
    const py = clamp(p.y + Math.sin(p.angle) * 60, 0, WORLD_SIZE);
    const id = room.nextStructId++;
    const s = { id, type, x: px, y: py, hp: 50, angle: p.angle };
    room.structures[id] = s;
    io.to(room.id).emit('structureAdded', s);
    sendInventory(room, token);
  });

  socket.on('meleeAttack', () => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastAttack < 500) return;
    p.lastAttack = now;
    const dmg = p.equipped === 'spear' ? 25 : p.equipped === 'axe' ? 20 : p.equipped === 'knife' ? 15 : 8;
    const range = p.equipped === 'spear' ? 90 : 55;
    let hit = false;
    for (const m of room.monsters) {
      const dx = m.x - p.x, dy = m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const angleTo = Math.atan2(dy, dx);
      let diff = Math.abs(angleTo - p.angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < 0.9) { m.hp -= dmg; m.lastAttackerToken = token; hit = true; }
    }
    if (hit) sendToPlayer(room, token, 'hitConfirm');
  });

  socket.on('rangedAttack', () => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p || !p.alive) return;
    if (p.equipped === 'bow') {
      if ((p.inventory.arrow || 0) < 1) return;
      p.inventory.arrow -= 1;
      room.projectiles.push({ id: room.nextProjId++, type: 'arrow', x: p.x, y: p.y, angle: p.angle, speed: 12, damage: 20, life: 2000, owner: token });
      sendInventory(room, token);
    } else if (p.equipped === 'molotov') {
      if ((p.inventory.molotov || 0) < 1) return;
      p.inventory.molotov -= 1;
      room.projectiles.push({ id: room.nextProjId++, type: 'molotov', x: p.x, y: p.y, angle: p.angle, speed: 9, damage: 10, life: 900, owner: token });
      sendInventory(room, token);
    }
  });

  socket.on('respawn', () => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id]; const p = token && room.players[token];
    if (!p) return;
    if (!p.alive) recordRun(p.name, room.nightCount, p.kills);
    const fresh = newPlayer(token, p.name);
    room.players[token] = fresh;
    sendToPlayer(room, token, 'inventory', fresh.inventory);
  });

  socket.on('getLeaderboard', () => { socket.emit('leaderboard', leaderboard); });

  socket.on('disconnect', () => {
    const room = rooms.get(currentRoomId); if (!room) return;
    const token = room.socketToToken[socket.id];
    delete room.socketToToken[socket.id];
    if (token && room.players[token]) {
      const p = room.players[token];
      p.disconnectedAt = Date.now();
      if (!p.alive) recordRun(p.name, room.nightCount, p.kills);
    }
  });
});

// ---------------- avvio, salvataggio periodico, arresto ordinato ----------------
loadLeaderboard();
loadRoomsFromDisk();
setInterval(() => { saveRooms(); saveLeaderboard(); }, SAVE_INTERVAL_MS);

function shutdown() {
  console.log('Arresto in corso: salvataggio stato...');
  saveRooms();
  saveLeaderboard();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server avviato sulla porta ' + PORT));
