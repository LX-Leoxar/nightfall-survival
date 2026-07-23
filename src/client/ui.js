// ui.js — HUD, menu di crafting/costruzione, minimappa, schermate di ingresso/morte.
import { netState, connect, sendRespawn, sendCraft, sendEquip, sendPlaceStructure } from './net.js';
import { requestLock, releaseLock, nearestResourceInRange, me } from './player.js';
import { initAudio, resumeAudio, sfxCraft } from './audio.js';

const LABELS = {
  torch: '🔦 Torcia', wall: '🧱 Muro', spear: '🔱 Lancia', axe: '🪓 Ascia', pickaxe: '⛏️ Piccone',
  bow: '🏹 Arco', arrow: '➶ Freccia', knife: '🔪 Coltello', campfire: '🔥 Falò', armor: '🛡️ Armatura',
  bandage: '🩹 Benda', spikes: '⚠️ Trappola', molotov: '🧨 Molotov',
};
const ITEM_NAMES = {
  wood: 'Legno', stone: 'Pietra', fiber: 'Fibra', arrow: 'Frecce', torch: 'Torce', spear: 'Lance',
  axe: 'Asce', pickaxe: 'Picconi', bow: 'Archi', knife: 'Coltelli', molotov: 'Molotov',
};
const EQUIPPABLE = new Set(['torch', 'spear', 'axe', 'pickaxe', 'bow', 'knife', 'molotov']);

function craftLabel(key) { return LABELS[key] || key; }
function itemName(key) { return ITEM_NAMES[key] || key; }

const els = {};
let craftOpen = false, buildOpen = false;

function cacheEls() {
  els.joinScreen = document.getElementById('joinScreen');
  els.nameInput = document.getElementById('nameInput');
  els.joinBtn = document.getElementById('joinBtn');
  els.deathScreen = document.getElementById('deathScreen');
  els.respawnBtn = document.getElementById('respawnBtn');
  els.hpFill = document.getElementById('hpFill');
  els.dayNight = document.getElementById('dayNight');
  els.dayProgressFill = document.getElementById('dayProgressFill');
  els.invList = document.getElementById('invList');
  els.equippedName = document.getElementById('equippedName');
  els.craftMenu = document.getElementById('craftMenu');
  els.craftList = document.getElementById('craftList');
  els.buildMenu = document.getElementById('buildMenu');
  els.buildList = document.getElementById('buildList');
  els.gatherPrompt = document.getElementById('gatherPrompt');
  els.hitFlash = document.getElementById('hitFlash');
  els.lowHpVignette = document.getElementById('lowHpVignette');
  els.connStatus = document.getElementById('connStatus');
  els.minimap = document.getElementById('minimapCanvas');
  els.minimapCtx = els.minimap.getContext('2d');
}

export function initUI(onJoin) {
  cacheEls();
  els.joinBtn.onclick = () => {
    const name = els.nameInput.value.trim() || 'Sopravvissuto';
    initAudio(); resumeAudio();
    connect(name);
    els.joinScreen.style.display = 'none';
    requestLock();
    onJoin?.(name);
  };
  els.respawnBtn.onclick = () => {
    sendRespawn();
    els.deathScreen.style.display = 'none';
    requestLock();
  };
  els.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.joinBtn.click(); });
}

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
  craftOpen = !craftOpen;
  els.craftMenu.style.display = craftOpen ? 'block' : 'none';
  if (craftOpen) releaseLock(); else requestLock();
}
export function toggleBuildMenu() {
  if (craftOpen) { craftOpen = false; els.craftMenu.style.display = 'none'; }
  buildOpen = !buildOpen;
  els.buildMenu.style.display = buildOpen ? 'block' : 'none';
  if (buildOpen) releaseLock(); else requestLock();
}
export function anyMenuOpen() { return craftOpen || buildOpen; }
export function closeMenus() {
  craftOpen = false; buildOpen = false;
  els.craftMenu.style.display = 'none';
  els.buildMenu.style.display = 'none';
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

  const s = netState.latest;
  if (s) {
    els.dayNight.textContent = s.isNight ? '🌙 Notte — i mostri sono fuori!' : '☀️ Giorno';
    els.dayNight.style.color = s.isNight ? '#ff8f7a' : '#f0ead9';
    const frac = Math.min(1, s.dayTimer / Math.max(1, s.cycleLen));
    els.dayProgressFill.style.width = (frac * 100) + '%';
    els.dayProgressFill.style.background = s.isNight ? 'linear-gradient(90deg,#3a4a70,#7fa2c4)' : 'linear-gradient(90deg,#e8763a,#ffcf7a)';
  }

  const alive = netState.myAlive;
  els.deathScreen.style.display = alive ? 'none' : 'flex';
  if (!alive && document.pointerLockElement) document.exitPointerLock();

  const lowHp = alive && maxHp > 0 && hp / maxHp < 0.3;
  els.lowHpVignette.style.opacity = lowHp ? String(0.6 * (1 - (hp / maxHp) / 0.3)) : '0';

  els.gatherPrompt.style.display = (alive && nearestResourceInRange()) ? 'block' : 'none';

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
    ctx.fillStyle = r.type === 'tree' ? '#3a7d3f' : r.type === 'rock' ? '#9aa0a6' : '#c9b458';
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  for (const s of netState.structures.values()) {
    const [x, y] = proj(s.x, s.y);
    ctx.fillStyle = s.type === 'campfire' ? '#ff8a3a' : s.type === 'torch' ? '#ffb15a' : '#8d6e63';
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
      ctx.fillStyle = '#ff2b2b';
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
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
