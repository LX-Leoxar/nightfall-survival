const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ---------------- CONFIG ----------------
const WORLD_SIZE = 2000;
const DAY_LENGTH = 120000; // 2 minuti giorno
const NIGHT_LENGTH = 90000; // 1.5 minuti notte
const TICK_RATE = 50; // ms
const MONSTER_SPAWN_INTERVAL = 4000;
const MAX_MONSTERS_NIGHT = 25;

const RECIPES = {
  torch:      { wood: 3, stone: 0, cost_desc: "3 legno" },
  wall:       { wood: 8, stone: 2, cost_desc: "8 legno, 2 pietra" },
  spear:      { wood: 5, stone: 2, cost_desc: "5 legno, 2 pietra" },
  axe:        { wood: 4, stone: 3, cost_desc: "4 legno, 3 pietra" },
  pickaxe:    { wood: 4, stone: 4, cost_desc: "4 legno, 4 pietra" },
  bow:        { wood: 6, stone: 1, fiber: 3, cost_desc: "6 legno, 1 pietra, 3 fibra" },
  arrow:      { wood: 1, stone: 1, cost_desc: "1 legno, 1 pietra (x1 freccia)" },
  knife:      { wood: 2, stone: 3, cost_desc: "2 legno, 3 pietra" },
  campfire:   { wood: 10, stone: 5, cost_desc: "10 legno, 5 pietra" },
  armor:      { wood: 2, stone: 6, fiber: 4, cost_desc: "2 legno, 6 pietra, 4 fibra" },
  bandage:    { fiber: 5, cost_desc: "5 fibra" },
  spikes:     { wood: 6, stone: 6, cost_desc: "6 legno, 6 pietra" },
  molotov:    { wood: 2, stone: 1, fiber: 2, cost_desc: "2 legno, 1 pietra, 2 fibra" },
};

// ---------------- STATE ----------------
let players = {}; // id -> player
let resources = []; // trees/rocks/fiber nodes
let structures = []; // placed by players
let monsters = [];
let projectiles = [];
let dayTimer = 0;
let isNight = false;
let nextResId = 1;
let nextMonId = 1;
let nextProjId = 1;
let lastMonsterSpawn = 0;

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function spawnResources() {
  resources = [];
  for (let i = 0; i < 60; i++) {
    resources.push({ id: nextResId++, type: 'tree', x: rand(50, WORLD_SIZE-50), y: rand(50, WORLD_SIZE-50), amount: 5 });
  }
  for (let i = 0; i < 40; i++) {
    resources.push({ id: nextResId++, type: 'rock', x: rand(50, WORLD_SIZE-50), y: rand(50, WORLD_SIZE-50), amount: 5 });
  }
  for (let i = 0; i < 30; i++) {
    resources.push({ id: nextResId++, type: 'fiber', x: rand(50, WORLD_SIZE-50), y: rand(50, WORLD_SIZE-50), amount: 3 });
  }
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
  };
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

  // spawn mostri di notte
  if (isNight && now - lastMonsterSpawn > MONSTER_SPAWN_INTERVAL && monsters.length < MAX_MONSTERS_NIGHT) {
    spawnMonster();
    lastMonsterSpawn = now;
  }

  // muovi mostri verso il player target
  for (const m of monsters) {
    const target = players[m.targetId];
    if (!target || !target.alive) {
      const alive = Object.values(players).filter(p => p.alive);
      if (alive.length === 0) continue;
      m.targetId = alive[Math.floor(Math.random()*alive.length)].id;
      continue;
    }
    // controlla se bloccato da muro
    const blockingWall = structures.find(s => s.type === 'wall' && dist(s, m) < 30 && dist(s, target) < dist(m, target));
    let tx = target.x, ty = target.y;
    if (blockingWall) {
      // aggira leggermente
      tx += rand(-100, 100); ty += rand(-100, 100);
    }
    const d = dist(m, {x: tx, y: ty});
    if (d > 25) {
      m.x += (tx - m.x) / d * m.speed * (TICK_RATE/50);
      m.y += (ty - m.y) / d * m.speed * (TICK_RATE/50);
    } else if (now - (m.lastHit || 0) > 900) {
      target.hp -= target.hasArmor ? 6 : 12;
      m.lastHit = now;
      if (target.hp <= 0) { target.hp = 0; target.alive = false; }
    }
  }

  // muovi proiettili
  projectiles = projectiles.filter(pr => {
    pr.x += Math.cos(pr.angle) * pr.speed;
    pr.y += Math.sin(pr.angle) * pr.speed;
    pr.life -= TICK_RATE;
    if (pr.life <= 0) return false;
    // collisione con mostri
    for (const m of monsters) {
      if (dist(pr, m) < 25) {
        m.hp -= pr.damage;
        return false;
      }
    }
    return true;
  });
  monsters = monsters.filter(m => m.hp > 0);

  io.emit('state', {
    players, resources, structures, monsters, projectiles,
    isNight, dayTimer, cycleLen,
  });
}

setInterval(gameTick, TICK_RATE);

// ---------------- SOCKET HANDLERS ----------------
io.on('connection', (socket) => {
  socket.on('join', (name) => {
    players[socket.id] = newPlayer(socket.id, name);
    socket.emit('init', { id: socket.id, recipes: RECIPES, worldSize: WORLD_SIZE });
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    p.x = Math.max(0, Math.min(WORLD_SIZE, data.x));
    p.y = Math.max(0, Math.min(WORLD_SIZE, data.y));
    p.angle = data.angle;
  });

  socket.on('gather', (resId) => {
    const p = players[socket.id];
    const res = resources.find(r => r.id === resId);
    if (!p || !res || !p.alive) return;
    if (dist(p, res) > 60) return;
    res.amount -= 1;
    if (res.type === 'tree') p.inventory.wood += 2;
    if (res.type === 'rock') p.inventory.stone += 2;
    if (res.type === 'fiber') p.inventory.fiber += 2;
    if (res.amount <= 0) resources = resources.filter(r => r.id !== resId);
  });

  socket.on('craft', (itemType) => {
    const p = players[socket.id];
    const recipe = RECIPES[itemType];
    if (!p || !recipe) return;
    for (const key in recipe) {
      if (key === 'cost_desc') continue;
      if ((p.inventory[key] || 0) < recipe[key]) return; // risorse insufficienti
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
    const cost = data.type === 'wall' ? 8 : data.type === 'campfire' ? { wood: 10, stone: 5 } : null;
    if (data.type === 'wall') {
      if (p.inventory.wood < 8 || p.inventory.stone < 2) return;
      p.inventory.wood -= 8; p.inventory.stone -= 2;
    } else if (data.type === 'spikes') {
      if (p.inventory.wood < 6 || p.inventory.stone < 6) return;
      p.inventory.wood -= 6; p.inventory.stone -= 6;
    } else if (data.type === 'campfire') {
      if (p.inventory.wood < 10 || p.inventory.stone < 5) return;
      p.inventory.wood -= 10; p.inventory.stone -= 5;
    } else if (data.type === 'torch') {
      if (p.inventory.torch < 1) return;
      p.inventory.torch -= 1;
    }
    structures.push({ id: Date.now()+Math.random(), type: data.type, x: data.x, y: data.y, hp: 50 });
  });

  socket.on('meleeAttack', () => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    const now = Date.now();
    if (now - p.lastAttack < 500) return;
    p.lastAttack = now;
    const dmg = p.equipped === 'spear' ? 25 : p.equipped === 'axe' ? 20 : p.equipped === 'knife' ? 15 : 8;
    const range = p.equipped === 'spear' ? 90 : 55;
    for (const m of monsters) {
      const dx = m.x - p.x, dy = m.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > range) continue;
      const angleTo = Math.atan2(dy, dx);
      let diff = Math.abs(angleTo - p.angle);
      if (diff > Math.PI) diff = 2*Math.PI - diff;
      if (diff < 0.9) { m.hp -= dmg; }
    }
  });

  socket.on('rangedAttack', () => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (p.equipped !== 'bow' || (p.inventory.arrow || 0) < 1) return;
    p.inventory.arrow -= 1;
    projectiles.push({
      id: nextProjId++, x: p.x, y: p.y, angle: p.angle, speed: 12, damage: 20, life: 2000, owner: p.id,
    });
  });

  socket.on('respawn', () => {
    const p = players[socket.id];
    if (!p) return;
    const fresh = newPlayer(socket.id, p.name);
    players[socket.id] = fresh;
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server avviato sulla porta ' + PORT));
