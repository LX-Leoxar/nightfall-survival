// net.js — socket.io, stato condiviso lato client, interpolazione delle entità remote,
// gestione stanze e riconnessione automatica tramite token salvato in localStorage.

const INTERP_DELAY = 100; // ms: quanto "indietro nel tempo" renderizziamo mostri/altri giocatori
const SNAPSHOT_BUFFER_MS = 1000;
const STORAGE_KEY = 'nightfall_session_v1';

export const socket = io(); // "io" è globale, caricato da /socket.io/socket.io.js prima di questo bundle

export const netState = {
  connected: false,
  joined: false,
  myId: null,
  token: null,
  roomId: null,
  worldSize: 2000,
  craftRecipes: {},
  buildRecipes: {},
  equipOrder: ['hand'],
  resources: new Map(),
  structures: new Map(),
  snapshots: [],
  latest: null,
  myInventory: { wood: 5, stone: 2, fiber: 2, arrow: 0 },
  myInventoryCap: 60,
  myHp: 100, myMaxHp: 100, myAlive: true,
  myHasArmor: false, myHasHelmet: false, myHasShield: false, myHasBackpack: false,
  myEquipped: 'hand',
  myHunger: 100, myThirst: 100, myKills: 0,
  selfServerPos: null,
  spawnPos: null,
  leaderboard: [],
  // callback opzionali, assegnati da altri moduli (audio/ui/entities) per reagire agli eventi
  // senza che net.js debba importarli (evita dipendenze circolari)
  onHitConfirm: null,
  onDamaged: null,
  onNightChange: null,
  onResourceAdded: null,
  onResourceRemoved: null,
  onResourceUpdate: null,
  onStructureAdded: null,
  onStructureRemoved: null,
  onInit: null,
  onLeaderboard: null,
};

let pendingName = null, pendingRoomId = null;

export function getStoredSession() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.name && s.roomId) return s;
  } catch (e) { /* niente sessione salvata */ }
  return null;
}
function saveSession() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: pendingName, roomId: pendingRoomId, token: netState.token })); } catch (e) { /* storage non disponibile */ }
}
export function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignorato */ }
}

export function connect(name, roomId) {
  pendingName = name;
  pendingRoomId = (roomId || 'pubblica').toLowerCase();
  const stored = getStoredSession();
  const token = (stored && stored.roomId === pendingRoomId && stored.name === name) ? stored.token : null;
  socket.emit('join', { name, roomId: pendingRoomId, token });
}

socket.on('connect', () => {
  netState.connected = true;
  // se il socket si è riconnesso dopo una caduta di rete e avevamo già una sessione attiva,
  // rientriamo in automatico usando lo stesso token, senza richiedere alcuna azione all'utente
  if (netState.joined && pendingName) {
    socket.emit('join', { name: pendingName, roomId: pendingRoomId, token: netState.token });
  }
});
socket.on('disconnect', () => { netState.connected = false; });

socket.on('init', (data) => {
  netState.myId = data.id;
  netState.token = data.token;
  netState.roomId = data.roomId;
  netState.worldSize = data.worldSize;
  netState.craftRecipes = data.craftRecipes;
  netState.buildRecipes = data.buildRecipes;
  netState.equipOrder = data.equipOrder || netState.equipOrder;
  netState.myInventory = data.inventory;
  netState.myInventoryCap = data.inventoryCap || 60;
  netState.resources.clear();
  for (const r of data.resources) netState.resources.set(r.id, r);
  netState.structures.clear();
  for (const s of data.structures) netState.structures.set(s.id, s);
  netState.selfServerPos = { x: data.x, y: data.y };
  netState.spawnPos = { x: data.x, y: data.y };
  netState.joined = true;
  saveSession();
  netState.onInit?.(data);
});

socket.on('inventory', (inv) => { netState.myInventory = inv; });
socket.on('vitals', (v) => { netState.myHunger = v.hunger; netState.myThirst = v.thirst; netState.myKills = v.kills; });
socket.on('hitConfirm', () => { netState.onHitConfirm?.(); });
socket.on('leaderboard', (list) => { netState.leaderboard = list; netState.onLeaderboard?.(list); });

socket.on('resourceAdded', (r) => { netState.resources.set(r.id, r); netState.onResourceAdded?.(r); });
socket.on('resourceUpdate', (u) => {
  const r = netState.resources.get(u.id);
  if (r) r.amount = u.amount;
  netState.onResourceUpdate?.(u);
});
socket.on('resourceRemoved', (id) => { netState.resources.delete(id); netState.onResourceRemoved?.(id); });

socket.on('structureAdded', (s) => { netState.structures.set(s.id, s); netState.onStructureAdded?.(s); });
socket.on('structureUpdate', (u) => { const s = netState.structures.get(u.id); if (s) s.hp = u.hp; });
socket.on('structureRemoved', (id) => { netState.structures.delete(id); netState.onStructureRemoved?.(id); });

socket.on('state', (s) => {
  const t = performance.now();
  if (netState.latest && netState.latest.isNight !== s.isNight) netState.onNightChange?.(s.isNight);
  netState.latest = s;
  netState.snapshots.push({ t, ...s });
  const cutoff = t - SNAPSHOT_BUFFER_MS;
  while (netState.snapshots.length > 2 && netState.snapshots[0].t < cutoff) netState.snapshots.shift();

  if (netState.myId && s.players[netState.myId]) {
    const me = s.players[netState.myId];
    const oldHp = netState.myHp;
    netState.myHp = me.hp; netState.myMaxHp = me.maxHp;
    netState.myAlive = me.alive; netState.myHasArmor = me.hasArmor;
    netState.myHasHelmet = me.hasHelmet; netState.myHasShield = me.hasShield; netState.myHasBackpack = me.hasBackpack;
    netState.myEquipped = me.equipped;
    netState.selfServerPos = { x: me.x, y: me.y };
    if (me.hp < oldHp) netState.onDamaged?.(me.hp, oldHp);
  }
});

// ---- azioni verso il server ----
export function sendMove(x, y, angle) { if (netState.joined) socket.emit('move', { x, y, angle }); }
export function sendGather(resId) { socket.emit('gather', resId); }
export function sendEat() { socket.emit('eat'); }
export function sendCraft(itemType) { socket.emit('craft', itemType); }
export function sendEquip(item) { socket.emit('equip', item); }
export function sendPlaceStructure(type) { socket.emit('placeStructure', { type }); }
export function sendMelee() { socket.emit('meleeAttack'); }
export function sendRanged() { socket.emit('rangedAttack'); }
export function sendRespawn() { socket.emit('respawn'); }
export function requestLeaderboard() { socket.emit('getLeaderboard'); }

// ---- interpolazione: dato un istante di rendering, calcola una vista interpolata delle entità dinamiche ----
export function getInterpolatedView() {
  const snaps = netState.snapshots;
  if (snaps.length === 0) return null;
  const renderTime = performance.now() - INTERP_DELAY;
  const last = snaps[snaps.length - 1];

  if (snaps.length === 1 || renderTime <= snaps[0].t) return viewFromSingle(snaps[0]);
  if (renderTime >= last.t) return viewFromSingle(last);

  let a = snaps[0], b = last;
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i].t <= renderTime && snaps[i + 1].t >= renderTime) { a = snaps[i]; b = snaps[i + 1]; break; }
  }
  const span = b.t - a.t;
  const f = span > 0 ? (renderTime - a.t) / span : 1;
  return {
    players: lerpEntityMap(a.players, b.players, f),
    monsters: lerpEntityList(a.monsters, b.monsters, f),
    projectiles: lerpEntityList(a.projectiles, b.projectiles, f),
    fireZones: b.fireZones,
    isNight: b.isNight, dayTimer: b.dayTimer, cycleLen: b.cycleLen,
    nightCount: b.nightCount, weather: b.weather,
  };
}

function viewFromSingle(s) {
  return { players: s.players, monsters: s.monsters, projectiles: s.projectiles, fireZones: s.fireZones, isNight: s.isNight, dayTimer: s.dayTimer, cycleLen: s.cycleLen, nightCount: s.nightCount, weather: s.weather };
}

function lerp(x, y, f) { return x + (y - x) * f; }
function lerpAngle(a, b, f) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * f;
}

function lerpEntityMap(mapA, mapB, f) {
  const out = {};
  for (const id in mapB) {
    const eb = mapB[id], ea = mapA[id];
    out[id] = ea ? { ...eb, x: lerp(ea.x, eb.x, f), y: lerp(ea.y, eb.y, f), angle: lerpAngle(ea.angle, eb.angle, f) } : eb;
  }
  return out;
}

function lerpEntityList(listA, listB, f) {
  const byIdA = new Map(listA.map(e => [e.id, e]));
  return listB.map(eb => {
    const ea = byIdA.get(eb.id);
    return ea ? { ...eb, x: lerp(ea.x, eb.x, f), y: lerp(ea.y, eb.y, f) } : eb;
  });
}
