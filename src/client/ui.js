// ui.js — HUD, menu di crafting/costruzione, minimappa, classifica, schermate di ingresso/morte,
// controlli touch per mobile.
import {
  netState, connect, sendRespawn, sendCraft, sendEquip, sendPlaceStructure, sendEat,
  requestLeaderboard, getStoredSession,
} from './net.js';
import { requestLock, releaseLock, nearestResourceInRange, tryGather, me, isTouchDevice, fireMelee, fireRanged } from './player.js';
import { initAudio, resumeAudio, sfxCraft, sfxGather } from './audio.js';

const LABELS = {
  torch: '🔦 Torcia', wall: '🧱 Muro', spear: '🔱 Lancia', axe: '🪓 Ascia', pickaxe: '⛏️ Piccone',
  bow: '🏹 Arco', arrow: '➶ Freccia', knife: '🔪 Coltello', campfire: '🔥 Falò', armor: '🛡️ Armatura',
  helmet: '⛑️ Elmo', shield: '🛡️ Scudo', backpack: '🎒 Zaino', pit: '🕳️ Fossa',
  bandage: '🩹 Benda', spikes: '⚠️ Trappola', molotov: '🧨 Molotov',
};
const ITEM_NAMES = {
  wood: 'Legno', stone: 'Pietra', fiber: 'Fibra', arrow: 'Frecce', torch: 'Torce', spear: 'Lance',
  axe: 'Asce', pickaxe: 'Picconi', bow: 'Archi', knife: 'Coltelli', molotov: 'Molotov', berry: 'Bacche',
};
const EQUIPPABLE = new Set(['torch', 'spear', 'axe', 'pickaxe', 'bow', 'knife', 'molotov']);
const WEATHER_LABELS = { clear: '☀️ Sereno', rain: '🌧️ Pioggia', fog: '🌫️ Nebbia fitta' };

function craftLabel(key) { return LABELS[key] || key; }
function itemName(key) { return ITEM_NAMES[key] || key; }

const els = {};
let craftOpen = false, buildOpen = false, leaderboardOpen = false;

function cacheEls() {
  els.joinScreen = document.getElementById('joinScreen');
  els.nameInput = document.getElementById('nameInput');
  els.roomInput = document.getElementById('roomInput');
  els.joinBtn = document.getElementById('joinBtn');
  els.deathScreen = document.getElementById('deathScreen');
  els.deathStats = document.getElementById('deathStats');
  els.respawnBtn = document.getElementById('respawnBtn');
  els.hpFill = document.getElementById('hpFill');
  els.hungerFill = document.getElementById('hungerFill');
  els.thirstFill = document.getElementById('thirstFill');
  els.dayNight = document.getElementById('dayNight');
  els.dayProgressFill = document.getElementById('dayProgressFill');
  els.nightCount = document.getElementById('nightCount');
  els.weatherLabel = document.getElementById('weatherLabel');
  els.invList = document.getElementById('invList');
  els.equippedName = document.getElementById('equippedName');
  els.craftMenu = document.getElementById('craftMenu');
  els.craftList = document.getElementById('craftList');
  els.buildMenu = document.getElementById('buildMenu');
  els.buildList = document.getElementById('buildList');
  els.gatherPrompt = document.getElementById('gatherPrompt');
  els.eatPrompt = document.getElementById('eatPrompt');
  els.hitFlash = document.getElementById('hitFlash');
  els.lowHpVignette = document.getElementById('lowHpVignette');
  els.connStatus = document.getElementById('connStatus');
  els.minimap = document.getElementById('minimapCanvas');
  els.minimapCtx = els.minimap.getContext('2d');
  els.leaderboardPanel = document.getElementById('leaderboardPanel');
  els.leaderboardList = document.getElementById('leaderboardList');
  els.touchControls = document.getElementById('touchControls');
  els.touchGatherBtn = document.getElementById('touchGatherBtn');
  els.touchMeleeBtn = document.getElementById('touchMeleeBtn');
  els.touchRangedBtn = document.getElementById('touchRangedBtn');
  els.touchEatBtn = document.getElementById('touchEatBtn');
  els.touchCraftBtn = document.getElementById('touchCraftBtn');
  els.touchBuildBtn = document.getElementById('touchBuildBtn');
  els.touchLeaderboardBtn = document.getElementById('touchLeaderboardBtn');
}

export function initUI(onJoin) {
  cacheEls();

  const doJoin = (name, roomId) => {
    initAudio(); resumeAudio();
    connect(name, roomId);
    els.joinScreen.style.display = 'none';
    requestLock();
    onJoin?.(name);
  };

  els.joinBtn.onclick = () => {
    const name = els.nameInput.value.trim() || 'Sopravvissuto';
    const roomId = els.roomInput.value.trim() || 'pubblica';
    doJoin(name, roomId);
  };
  els.respawnBtn.onclick = () => {
    sendRespawn();
    els.deathScreen.style.display = 'none';
    requestLock();
  };
  els.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.joinBtn.click(); });
  els.roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.joinBtn.click(); });

  // riconnessione automatica: se il browser ricorda una sessione precedente, si rientra subito
  // senza passare dalla schermata iniziale
  const stored = getStoredSession();
  if (stored) {
    els.nameInput.value = stored.name;
    els.roomInput.value = stored.roomId;
    doJoin(stored.name, stored.roomId);
  }

  if (isTouchDevice) {
    els.touchControls.style.display = 'block';
    document.getElementById('helpText').style.display = 'none';
    els.touchGatherBtn.addEventListener('touchstart', e => { e.preventDefault(); doGather(); }, { passive: false });
    els.touchMeleeBtn.addEventListener('touchstart', e => { e.preventDefault(); fireMelee(); }, { passive: false });
    els.touchRangedBtn.addEventListener('touchstart', e => { e.preventDefault(); fireRanged(); }, { passive: false });
    els.touchEatBtn.addEventListener('touchstart', e => { e.preventDefault(); sendEat(); }, { passive: false });
    els.touchCraftBtn.addEventListener('touchstart', e => { e.preventDefault(); toggleCraftMenu(); }, { passive: false });
    els.touchBuildBtn.addEventListener('touchstart', e => { e.preventDefault(); toggleBuildMenu(); }, { passive: false });
    els.touchLeaderboardBtn.addEventListener('touchstart', e => { e.preventDefault(); toggleLeaderboard(); }, { passive: false });
  }
}

function doGather() { if (tryGather()) sfxGather(); }

export function buildCraftMenu(recipes) {
  els.craftList.innerHTML = '';
  for (const key in recipes) {
    const r = recipes[key];
    const row = document.createElement('div');
    row.className = 'menuItem';
    row.innerHTML = `<div><strong>${craftLabel(key)}</strong><span class="desc">${r.cost_desc}</span></div>`;
    const craftBtn = document.createElement('button');
    craftBtn.textContent = 'Crea';
    craftBtn.onclick = () => { sendCraft(key); sfxCraft(); };
    row.appendChild(craftBtn);
    if (EQUIPPABLE.has(key)) {
      const equipBtn = document.createElement('button');
      equipBtn.textContent = 'Equip.';
      equipBtn.className = 'secondary';
      equipBtn.onclick = () => sendEquip(key);
      row.appendChild(equipBtn);
    }
    els.craftList.appendChild(row);
  }
}

export function buildBuildMenu(recipes) {
  els.buildList.innerHTML = '';
  for (const key in recipes) {
    const r = recipes[key];
    const row = document.createElement('div');
    row.className = 'menuItem';
    row.innerHTML = `<div><strong>${craftLabel(key)}</strong><span class="desc">${r.cost_desc}</span></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Piazza';
    btn.onclick = () => sendPlaceStructure(key);
    row.appendChild(btn);
    els.buildList.appendChild(row);
  }
}

export function toggleCraftMenu() {
  if (buildOpen) { buildOpen = false; els.buildMenu.style.display = 'none'; }
  if (leaderboardOpen) { leaderboardOpen = false; els.leaderboardPanel.style.display = 'none'; }
  craftOpen = !craftOpen;
  els.craftMenu.style.display = craftOpen ? 'block' : 'none';
  if (craftOpen) releaseLock(); else requestLock();
}
export function toggleBuildMenu() {
  if (craftOpen) { craftOpen = false; els.craftMenu.style.display = 'none'; }
  if (leaderboardOpen) { leaderboardOpen = false; els.leaderboardPanel.style.display = 'none'; }
  buildOpen = !buildOpen;
  els.buildMenu.style.display = buildOpen ? 'block' : 'none';
  if (buildOpen) releaseLock(); else requestLock();
}
export function toggleLeaderboard() {
  if (craftOpen) { craftOpen = false; els.craftMenu.style.display = 'none'; }
  if (buildOpen) { buildOpen = false; els.buildMenu.style.display = 'none'; }
  leaderboardOpen = !leaderboardOpen;
  els.leaderboardPanel.style.display = leaderboardOpen ? 'block' : 'none';
  if (leaderboardOpen) { requestLeaderboard(); releaseLock(); } else requestLock();
}
export function renderLeaderboard(list) {
  els.leaderboardList.innerHTML = '';
  if (!list || list.length === 0) {
    els.leaderboardList.innerHTML = '<div class="lbEmpty">Nessuna partita registrata ancora in questa stanza.</div>';
    return;
  }
  list.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lbRow';
    row.innerHTML = `<span class="lbRank">#${i + 1}</span><span class="lbName">${escapeHtml(entry.name)}</span><span class="lbStat">🌙 ${entry.nights}</span><span class="lbStat">💀 ${entry.kills}</span>`;
    els.leaderboardList.appendChild(row);
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function anyMenuOpen() { return craftOpen || buildOpen || leaderboardOpen; }
export function closeMenus() {
  craftOpen = false; buildOpen = false; leaderboardOpen = false;
  els.craftMenu.style.display = 'none';
  els.buildMenu.style.display = 'none';
  els.leaderboardPanel.style.display = 'none';
}

export function flashHit() {
  els.hitFlash.style.transition = 'none';
  els.hitFlash.style.opacity = '0.38';
  requestAnimationFrame(() => {
    els.hitFlash.style.transition = 'opacity 0.4s ease-out';
    els.hitFlash.style.opacity = '0';
  });
}

export function updateHUD() {
  const hp = netState.myHp, maxHp = netState.myMaxHp || 100;
  els.hpFill.style.width = Math.max(0, (hp / maxHp) * 100) + '%';
  els.hungerFill.style.width = Math.max(0, netState.myHunger) + '%';
  els.thirstFill.style.width = Math.max(0, netState.myThirst) + '%';
  els.equippedName.textContent = craftLabel(netState.myEquipped).replace(/^\S+\s/, '') || netState.myEquipped || 'mani';

  els.invList.innerHTML = '';
  for (const k in netState.myInventory) {
    const v = netState.myInventory[k];
    if (v > 0) {
      const row = document.createElement('div');
      row.textContent = `${itemName(k)}: ${v}`;
      els.invList.appendChild(row);
    }
  }
  const loadRow = document.createElement('div');
  loadRow.style.color = 'var(--ember-bright)';
  loadRow.textContent = `Bottino: ${['wood', 'stone', 'fiber', 'berry'].reduce((s, k) => s + (netState.myInventory[k] || 0), 0)}/${netState.myInventoryCap}`;
  els.invList.appendChild(loadRow);

  const s = netState.latest;
  if (s) {
    els.dayNight.textContent = s.isNight ? '🌙 Notte — i mostri sono fuori!' : '☀️ Giorno';
    els.dayNight.style.color = s.isNight ? '#ff8f7a' : '#f0ead9';
    const frac = Math.min(1, s.dayTimer / Math.max(1, s.cycleLen));
    els.dayProgressFill.style.width = (frac * 100) + '%';
    els.dayProgressFill.style.background = s.isNight ? 'linear-gradient(90deg,#3a4a70,#7fa2c4)' : 'linear-gradient(90deg,#e8763a,#ffcf7a)';
    els.nightCount.textContent = `Notte ${s.nightCount ?? 0} · 💀 ${netState.myKills}`;
    els.weatherLabel.textContent = WEATHER_LABELS[s.weather] || '';
  }

  const alive = netState.myAlive;
  els.deathScreen.style.display = alive ? 'none' : 'flex';
  if (!alive) {
    els.deathStats.textContent = `Notti sopravvissute: ${s ? (s.nightCount ?? 0) : 0} · Mostri uccisi: ${netState.myKills}`;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  const lowHp = alive && maxHp > 0 && hp / maxHp < 0.3;
  els.lowHpVignette.style.opacity = lowHp ? String(0.6 * (1 - (hp / maxHp) / 0.3)) : '0';

  els.gatherPrompt.style.display = (alive && !isTouchDevice && nearestResourceInRange()) ? 'block' : 'none';
  els.eatPrompt.style.display = (alive && !isTouchDevice && netState.myHunger < 40 && (netState.myInventory.berry || 0) > 0) ? 'block' : 'none';

  els.connStatus.style.display = (netState.joined && !netState.connected) ? 'block' : 'none';
}

export function isLowHp() {
  const hp = netState.myHp, maxHp = netState.myMaxHp || 100;
  return netState.myAlive && maxHp > 0 && hp / maxHp < 0.28;
}

const MINIMAP_RADIUS = 480;
export function updateMinimap() {
  const ctx = els.minimapCtx;
  const size = els.minimap.width;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,9,13,0.55)'; ctx.fill();
  ctx.clip();

  const scale = (size / 2) / MINIMAP_RADIUS;
  const proj = (wx, wy) => [size / 2 + (wx - me.x) * scale, size / 2 + (wy - me.y) * scale];

  for (const r of netState.resources.values()) {
    const [x, y] = proj(r.x, r.y);
    ctx.fillStyle = r.type === 'tree' ? '#3a7d3f' : r.type === 'rock' ? '#9aa0a6' : r.type === 'bush' ? '#a3264f' : '#c9b458';
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of netState.structures.values()) {
    const [x, y] = proj(s.x, s.y);
    ctx.fillStyle = s.type === 'campfire' ? '#ff8a3a' : s.type === 'torch' ? '#ffb15a' : s.type === 'pit' ? '#1a1512' : '#8d6e63';
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  const view = netState.latest;
  if (view) {
    for (const id in view.players) {
      if (id === netState.myId) continue;
      const p = view.players[id];
      if (!p.alive) continue;
      const [x, y] = proj(p.x, p.y);
      ctx.fillStyle = '#7fa2c4';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const m of view.monsters) {
      const [x, y] = proj(m.x, m.y);
      ctx.fillStyle = m.type === 'boss' ? '#ffffff' : m.type === 'tank' ? '#9a6cff' : m.type === 'fast' ? '#ffd83a' : '#ff2b2b';
      ctx.beginPath(); ctx.arc(x, y, m.type === 'boss' ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(me.angle);
  ctx.fillStyle = '#e8763a';
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(232,118,58,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); ctx.stroke();
}
