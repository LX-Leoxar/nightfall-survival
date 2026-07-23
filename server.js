const express = require('express');
const http = require('http');
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
const MAX_MONSTERS_NIGHT = 25;
const MAX_STRUCTURES = 400;

const PLAYER_RADIUS = 14;
const PLAYER_SPEED_PER_SEC = 80; // deve combaciare con la velocità usata dal client (player.js)

const SOLID_RADIUS = { tree: 24, rock: 20, wall: 26, campfire: 18 };

const SPIKES_RADIUS = 22, SPIKES_DAMAGE = 10, SPIKES_TICK_MS = 700;
const CAMPFIRE_HEAL_RADIUS = 150, CAMPFIRE_HEAL_AMOUNT = 2, CAMPFIRE_HEAL_TICK_MS = 1000;
const MONSTER_WALL_DAMAGE = 10, MONSTER_WALL_RANGE = 36, MONSTER_WALL_COOLDOWN = 900;
const FIRE_ZONE_RADIUS = 90, FIRE_ZONE_DAMAGE = 6, FIRE_ZONE_TICK_MS = 500, FIRE_ZONE_DURATION = 5000;

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
  bandage:  { fiber: 5, cost_desc: "5 fibra" },
  molotov:  { wood: 2, stone: 1, fiber: 2, cost_desc: "2 legno, 1 pietra, 2 fibra" },
};

// Strutture piazzabili nel mondo (menu Costruzione - tasto Q).
// wall/spikes/campfire costano risorse grezze al momento del piazzamento (NON vengono craftate
// prima in inventario, per evitare che il costo venga pagato due volte). torch invece va prima
// craftata (sopra) e poi piazzata da qui, consumando 1 torcia dall'inventario.
const BUILDABLE = {
  wall:     { wood: 8, stone: 2, cost_desc: "8 legno, 2 pietra" },
  spikes:   { wood: 6, stone: 6, cost_desc: "6 legno, 6 pietra" },
  campfire: { wood: 10, stone: 5, cost_desc: "10 legno, 5 pietra" },
  torch:    { fromInventory: true, cost_desc: "1 torcia dall'inventario" },
};

const EQUIP_ORDER = ['hand', 'spear', 'axe', 'pickaxe', 'knife', 'bow', 'torch', 'molotov'];

// ---------------- STATE ----------------
let players = {};      // id -> player
let resources = {};    // id -> resource (albero/roccia/fibra)
let structures = {};   // id -> struttura piazzata
let monsters = [];      // sempre sincronizzati per intero (dati "caldi")
let projectiles = [];
let fireZones = [];
let dayTimer = 0;
let isNight = false;
let nextResId = 1;
let nextMonId = 1;
let nextProjId = 1;
let nextStructId = 1;
let nextFireId = 1;
let lastMonsterSpawn = 0;
let lastResourceRespawn = 0;

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ---------------- RISORSE (eventi, non più broadcast ogni tick) ----------------
function addResource(type, amount) {
  const id = nextResId++;
  const r = { id, type, x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount };
  resources[id] = r;
  io.emit('resourceAdded', r);
  return r;
}

function spawnResources() {
  resources = {};
  for (let i = 0; i < 60; i++) { const id = nextResId++; resources[id] = { id, type: 'tree', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 5 }; }
  for (let i = 0; i < 40; i++) { const id = nextResId++; resources[id] = { id, type: 'rock', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 5 }; }
  for (let i = 0; i < 30; i++) { const id = nextResId++; resources[id] = { id, type: 'fiber', x: rand(50, WORLD_SIZE - 50), y: rand(50, WORLD_SIZE - 50), amount: 3 }; }
}
spawnResources();

function newPlayer(id, name) {
  return {
    id, name: name || 'Sopravvissuto',
    x: rand(200, 400), y: rand(200, 400), angle: 0,
    hp: 100, maxHp: 100,
    inventory: { wood: 5, stone: 2, fiber: 2, arrow: 0 },
    equipped: 'hand',
    hasArmor: false,
    alive: true,
    lastAttack: 0,
    lastMoveMsgAt: Date.now(),
    lastWarmthHeal: 0,
    hue: Math.floor(rand(0, 360)), // colore stabile per il modello 3D del giocatore
  };
}

// Sottoinsieme "pubblico" di un player: quello che serve agli ALTRI client per renderizzarlo.
// L'inventario resta privato e viaggia solo verso il proprietario (vedi sendInventory).
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, y: p.y, angle: p.angle,
    hp: p.hp, maxHp: p.maxHp, alive: p.alive,
    equipped: p.equipped, hasArmor: p.hasArmor, hue: p.hue,
  };
}

function sendInventory(id) {
  const p = players[id];
  if (p) io.to(id).emit('inventory', p.inventory);
}

function getSolids() {
  const solids = [];
  for (const id in resources) {
    const r = resources[id];
    if (r.type === 'tree' || r.type === 'rock') solids.push({ x: r.x, y: r.y, radius: SOLID_RADIUS[r.type] });
  }
  for (const id in structures) {
    const s = structures[id];
    if (s.type === 'wall' || s.type === 'campfire') solids.push({ x: s.x, y: s.y, radius: SOLID_RADIUS[s.type] });
  }
  return solids;
}

function collides(x, y, solids, selfRadius) {
  for (const s of solids) {
    if (Math.hypot(x - s.x, y - s.y) < selfRadius + s.radius) return true;
  }
  return false;
}

function spawnFireZone(x, y) {
  fireZones.push({ id: nextFireId++, x, y, radius: FIRE_ZONE_RADIUS, expiresAt: Date.now() + FIRE_ZONE_DURATION, lastTick: 0 });
}

function spawnMonster() {
  const alivePlayers = Object.values(players).filter(p => p.alive);
  if (alivePlayers.length === 0) return;
  const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
  const angle = rand(0, Math.PI * 2);
  const spawnDist = 400;
  monsters.push({
    id: nextMonId++,
    x: target.x + Math.cos(angle) * spawnDist,
    y: target.y + Math.sin(angle) * spawnDist,
    hp: 30,
    speed: rand(0.8, 1.4),
    targetId: target.id,
  });
}

function gameTick() {
  const now = Date.now();
  dayTimer += TICK_RATE;
  const cycleLen = isNight ? NIGHT_LENGTH : DAY_LENGTH;
  if (dayTimer >= cycleLen) {
    dayTimer = 0;
    isNight = !isNight;
    if (!isNight) monsters = []; // fine notte, mostri spariscono
  }

  if (isNight && now - lastMonsterSpawn > MONSTER_SPAWN_INTERVAL && monsters.length < MAX_MONSTERS_NIGHT) {
    spawnMonster();
    lastMonsterSpawn = now;
  }

  // ---- mostri: muovono verso il target, oppure attaccano il muro che li blocca ----
  for (const m of monsters) {
    const target = players[m.targetId];
    if (!target || !target.alive) {
      const alive = Object.values(players).filter(p => p.alive);
      if (alive.length === 0) continue;
      m.targetId = alive[Math.floor(Math.random() * alive.length)].id;
      continue;
    }
    let blockingWall = null;
    for (const id in structures) {
      const s = structures[id];
      if (s.type !== 'wall') continue;
      if (dist(s, m) < MONSTER_WALL_RANGE && dist(s, target) < dist(m, target)) { blockingWall = s; break; }
    }
    if (blockingWall) {
      if (now - (m.lastWallHit || 0) > MONSTER_WALL_COOLDOWN) {
        blockingWall.hp -= MONSTER_WALL_DAMAGE;
        m.lastWallHit = now;
        if (blockingWall.hp <= 0) {
          delete structures[blockingWall.id];
          io.emit('structureRemoved', blockingWall.id);
        } else {
          io.emit('structureUpdate', { id: blockingWall.id, hp: blockingWall.hp });
        }
      }
    } else {
      const d = dist(m, target);
      if (d > 25) {
        m.x += (target.x - m.x) / d * m.speed * (TICK_RATE / 50);
        m.y += (target.y - m.y) / d * m.speed * (TICK_RATE / 50);
      } else if (now - (m.lastHit || 0) > 900) {
        target.hp -= target.hasArmor ? 6 : 12;
        m.lastHit = now;
        if (target.hp <= 0) { target.hp = 0; target.alive = false; }
      }
    }
  }

  // ---- trappole a spuntoni: danno periodico ai mostri vicini ----
  for (const m of monsters) {
    if (now - (m.lastSpikeHit || 0) < SPIKES_TICK_MS) continue;
    for (const id in structures) {
      const s = structures[id];
      if (s.type === 'spikes' && dist(s, m) < SPIKES_RADIUS) {
        m.hp -= SPIKES_DAMAGE;
        m.lastSpikeHit = now;
        break;
      }
    }
  }

  // ---- falò: cura passiva ai giocatori nelle vicinanze ----
  for (const pid in players) {
    const p = players[pid];
    if (!p.alive || p.hp >= p.maxHp) continue;
    if (now - (p.lastWarmthHeal || 0) < CAMPFIRE_HEAL_TICK_MS) continue;
    for (const id in structures) {
      const s = structures[id];
      if (s.type === 'campfire' && dist(s, p) < CAMPFIRE_HEAL_RADIUS) {
        p.hp = Math.min(p.maxHp, p.hp + CAMPFIRE_HEAL_AMOUNT);
        p.lastWarmthHeal = now;
        break;
      }
    }
  }

  // ---- proiettili: movimento + collisione; una molotov lascia una zona di fuoco ----
  projectiles = projectiles.filter(pr => {
    pr.x += Math.cos(pr.angle) * pr.speed;
    pr.y += Math.sin(pr.angle) * pr.speed;
    pr.life -= TICK_RATE;
    for (const m of monsters) {
      if (dist(pr, m) < 25) {
        m.hp -= pr.damage;
        if (pr.type === 'molotov') spawnFireZone(pr.x, pr.y);
        return false;
      }
    }
    if (pr.life <= 0) {
      if (pr.type === 'molotov') spawnFireZone(pr.x, pr.y);
      return false;
    }
    return true;
  });

  // ---- zone di fuoco: danno periodico nell'area finché non scadono ----
  fireZones = fireZones.filter(fz => {
    if (now - fz.lastTick > FIRE_ZONE_TICK_MS) {
      fz.lastTick = now;
      for (const m of monsters) {
        if (dist(fz, m) < fz.radius) m.hp -= FIRE_ZONE_DAMAGE;
      }
    }
    return now < fz.expiresAt;
  });

  // un solo filtro finale sui mostri, dopo che tutte le fonti di danno del tick sono state applicate
  monsters = monsters.filter(m => m.hp > 0);

  // ---- rigenera risorse esaurite nel tempo (evento, non più nel broadcast periodico) ----
  if (now - lastResourceRespawn > 8000) {
    lastResourceRespawn = now;
    const counts = { tree: 0, rock: 0, fiber: 0 };
    for (const id in resources) counts[resources[id].type]++;
    if (counts.tree < 60) addResource('tree', 5);
    if (counts.rock < 40) addResource('rock', 5);
    if (counts.fiber < 30) addResource('fiber', 3);
  }

  const publicPlayers = {};
  for (const id in players) publicPlayers[id] = publicPlayer(players[id]);

  io.emit('state', {
    players: publicPlayers, monsters, projectiles, fireZones,
    isNight, dayTimer, cycleLen,
  });
}

setInterval(gameTick, TICK_RATE);

// ---------------- SOCKET HANDLERS ----------------
io.on('connection', (socket) => {
  socket.on('join', (name) => {
    const safeName = String(name || 'Sopravvissuto').slice(0, 16);
    const p = newPlayer(socket.id, safeName);
    players[socket.id] = p;
    socket.emit('init', {
      id: socket.id,
      x: p.x, y: p.y,
      craftRecipes: CRAFTABLE,
      buildRecipes: BUILDABLE,
      equipOrder: EQUIP_ORDER,
      worldSize: WORLD_SIZE,
      resources: Object.values(resources),
      structures: Object.values(structures),
      inventory: p.inventory,
    });
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (typeof data?.x !== 'number' || typeof data?.y !== 'number' || typeof data?.angle !== 'number') return;
    const now = Date.now();
    const elapsed = Math.min(500, now - (p.lastMoveMsgAt || now));
    p.lastMoveMsgAt = now;
    const maxDist = PLAYER_SPEED_PER_SEC * (elapsed / 1000) * 1.5 + 6; // margine per jitter di rete/framerate
    const nx = clamp(data.x, 0, WORLD_SIZE);
    const ny = clamp(data.y, 0, WORLD_SIZE);
    if (dist(p, { x: nx, y: ny }) > maxDist) return; // scarta spostamenti implausibili (anti teleport)
    const solids = getSolids();
    if (!collides(nx, ny, solids, PLAYER_RADIUS)) {
      p.x = nx; p.y = ny;
    } else if (!collides(nx, p.y, solids, PLAYER_RADIUS)) {
      p.x = nx;
    } else if (!collides(p.x, ny, solids, PLAYER_RADIUS)) {
      p.y = ny;
    }
    p.angle = data.angle;
  });

  socket.on('gather', (resId) => {
    const p = players[socket.id];
    const res = resources[resId];
    if (!p || !res || !p.alive) return;
    if (dist(p, res) > 80) return;
    res.amount -= 1;
    if (res.type === 'tree') p.inventory.wood += 2;
    if (res.type === 'rock') p.inventory.stone += 2;
    if (res.type === 'fiber') p.inventory.fiber += 2;
    if (res.amount <= 0) {
      delete resources[resId];
      io.emit('resourceRemoved', resId);
    } else {
      io.emit('resourceUpdate', { id: res.id, amount: res.amount });
    }
    sendInventory(socket.id);
  });

  socket.on('craft', (itemType) => {
    const p = players[socket.id];
    const recipe = CRAFTABLE[itemType];
    if (!p || !recipe || !p.alive) return;
    for (const key in recipe) {
      if (key === 'cost_desc') continue;
      if ((p.inventory[key] || 0) < recipe[key]) return;
    }
    for (const key in recipe) {
      if (key === 'cost_desc') continue;
      p.inventory[key] -= recipe[key];
    }
    if (itemType === 'arrow') {
      p.inventory.arrow = (p.inventory.arrow || 0) + 1;
    } else if (itemType === 'armor') {
      p.hasArmor = true;
    } else if (itemType === 'bandage') {
      p.hp = Math.min(p.maxHp, p.hp + 25);
    } else {
      p.inventory[itemType] = (p.inventory[itemType] || 0) + 1;
    }
    sendInventory(socket.id);
  });

  socket.on('equip', (item) => {
    const p = players[socket.id];
    if (!p) return;
    if (item === 'hand' || (p.inventory[item] && p.inventory[item] > 0)) {
      p.equipped = item;
    }
  });

  socket.on('placeStructure', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    const type = data?.type;
    const recipe = BUILDABLE[type];
    if (!recipe) return;
    if (Object.keys(structures).length >= MAX_STRUCTURES) return;
    if (recipe.fromInventory) {
      if ((p.inventory[type] || 0) < 1) return;
      p.inventory[type] -= 1;
    } else {
      for (const key in recipe) {
        if (key === 'cost_desc') continue;
        if ((p.inventory[key] || 0) < recipe[key]) return;
      }
      for (const key in recipe) {
        if (key === 'cost_desc') continue;
        p.inventory[key] -= recipe[key];
      }
    }
    // la posizione la calcola il server dalla propria copia autoritativa di x/y/angle,
    // non da quella (falsificabile) inviata dal client
    const px = clamp(p.x + Math.cos(p.angle) * 60, 0, WORLD_SIZE);
    const py = clamp(p.y + Math.sin(p.angle) * 60, 0, WORLD_SIZE);
    const id = nextStructId++;
    const s = { id, type, x: px, y: py, hp: 50, angle: p.angle };
    structures[id] = s;
    io.emit('structureAdded', s);
    sendInventory(socket.id);
  });

  socket.on('meleeAttack', () => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastAttack < 500) return;
    p.lastAttack = now;
    const dmg = p.equipped === 'spear' ? 25 : p.equipped === 'axe' ? 20 : p.equipped === 'knife' ? 15 : 8;
    const range = p.equipped === 'spear' ? 90 : 55;
    let hit = false;
    for (const m of monsters) {
      const dx = m.x - p.x, dy = m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const angleTo = Math.atan2(dy, dx);
      let diff = Math.abs(angleTo - p.angle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < 0.9) { m.hp -= dmg; hit = true; }
    }
    monsters = monsters.filter(m => m.hp > 0);
    if (hit) io.to(socket.id).emit('hitConfirm');
  });

  socket.on('rangedAttack', () => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (p.equipped === 'bow') {
      if ((p.inventory.arrow || 0) < 1) return;
      p.inventory.arrow -= 1;
      projectiles.push({ id: nextProjId++, type: 'arrow', x: p.x, y: p.y, angle: p.angle, speed: 12, damage: 20, life: 2000, owner: p.id });
      sendInventory(socket.id);
    } else if (p.equipped === 'molotov') {
      if ((p.inventory.molotov || 0) < 1) return;
      p.inventory.molotov -= 1;
      projectiles.push({ id: nextProjId++, type: 'molotov', x: p.x, y: p.y, angle: p.angle, speed: 9, damage: 10, life: 900, owner: p.id });
      sendInventory(socket.id);
    }
  });

  socket.on('respawn', () => {
    const p = players[socket.id];
    if (!p) return;
    const fresh = newPlayer(socket.id, p.name);
    players[socket.id] = fresh;
    socket.emit('inventory', fresh.inventory);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server avviato sulla porta ' + PORT));
