// player.js — telecamera in prima persona: look con pointer lock, movimento WASD con collisioni,
// predizione locale a piena velocità di frame + riconciliazione morbida con il server.
import * as THREE from 'three';
import { camera, EYE_HEIGHT } from './world.js';
import { netState, sendMove, sendGather, sendMelee, sendRanged } from './net.js';
import { sfxBowShot, sfxMolotovThrow } from './audio.js';

const PLAYER_RADIUS = 14;
const SPEED_PER_SEC = 80; // deve combaciare con PLAYER_SPEED_PER_SEC in server.js
const SEND_INTERVAL = 50; // ms: invii al server, disaccoppiati dal framerate di rendering
const GATHER_RANGE = 78; // leggermente sotto la soglia server (80) per evitare falsi "in range"
const RECONCILE_SNAP_DIST = 220; // oltre questa distanza correggiamo di scatto (es. respawn/teletrasporto)
const RECONCILE_LERP = 0.12; // frazione di correzione morbida applicata ogni frame

export const me = { x: 300, y: 300, angle: 0 };
export const keys = {};
export let pointerLocked = false;
export const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;

let yaw = 0, pitch = 0;
let sendTimer = 0;
let bobPhase = 0;
let canvasEl = null;
let touchMoveId = null, touchLookId = null;
let touchMoveOrigin = { x: 0, y: 0 };
let touchMoveVec = { x: 0, y: 0 };
let touchLookLast = { x: 0, y: 0 };

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();

export function initPlayer(canvas) {
  canvasEl = canvas;
  document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  if (isTouchDevice) {
    setupTouchControls();
    return;
  }

  canvas.addEventListener('click', () => { if (!pointerLocked && netState.myAlive) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-1.3, Math.min(1.3, pitch));
  });
  canvas.addEventListener('mousedown', e => {
    if (!pointerLocked || !netState.myAlive) return;
    if (e.button === 0) fireMelee();
    if (e.button === 2) fireRanged();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function fireMelee() { if (netState.myAlive) sendMelee(); }
export function fireRanged() {
  if (!netState.myAlive) return;
  sendRanged();
  if (netState.myEquipped === 'bow' && (netState.myInventory.arrow || 0) > 0) sfxBowShot();
  else if (netState.myEquipped === 'molotov' && (netState.myInventory.molotov || 0) > 0) sfxMolotovThrow();
}

// ---------------- controlli touch (mobile): joystick virtuale + trascinamento per guardarsi intorno ----------------
function setupTouchControls() {
  const joyBase = document.getElementById('touchJoystickBase');
  const joyKnob = document.getElementById('touchJoystickKnob');
  const lookArea = document.getElementById('touchLookArea');
  if (!joyBase || !lookArea) return;

  joyBase.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touchMoveId = t.identifier;
    const rect = joyBase.getBoundingClientRect();
    touchMoveOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.preventDefault();
  }, { passive: false });

  lookArea.addEventListener('touchstart', (e) => {
    if (touchLookId !== null) return;
    const t = e.changedTouches[0];
    touchLookId = t.identifier;
    touchLookLast = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchMoveId) {
        const dx = t.clientX - touchMoveOrigin.x, dy = t.clientY - touchMoveOrigin.y;
        const maxR = 46;
        const d = Math.min(maxR, Math.hypot(dx, dy));
        const ang = Math.atan2(dy, dx);
        touchMoveVec = { x: Math.cos(ang) * (d / maxR), y: Math.sin(ang) * (d / maxR) };
        if (joyKnob) joyKnob.style.transform = `translate(${Math.cos(ang) * d}px, ${Math.sin(ang) * d}px)`;
      } else if (t.identifier === touchLookId) {
        const dxL = t.clientX - touchLookLast.x, dyL = t.clientY - touchLookLast.y;
        yaw -= dxL * 0.0034;
        pitch -= dyL * 0.0034;
        pitch = Math.max(-1.3, Math.min(1.3, pitch));
        touchLookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchMoveId) { touchMoveId = null; touchMoveVec = { x: 0, y: 0 }; if (joyKnob) joyKnob.style.transform = 'translate(0,0)'; }
      if (t.identifier === touchLookId) touchLookId = null;
    }
  });
  window.addEventListener('touchcancel', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchMoveId) { touchMoveId = null; touchMoveVec = { x: 0, y: 0 }; if (joyKnob) joyKnob.style.transform = 'translate(0,0)'; }
      if (t.identifier === touchLookId) touchLookId = null;
    }
  });
}

export function requestLock() { if (!isTouchDevice) canvasEl?.requestPointerLock(); }
export function releaseLock() { if (!isTouchDevice && document.pointerLockElement) document.exitPointerLock(); }

export function spawnAt(x, y) { me.x = x; me.y = y; me.angle = 0; yaw = 0; pitch = 0; }

function getSolids() {
  const solids = [];
  for (const r of netState.resources.values()) {
    if (r.type === 'tree') solids.push({ x: r.x, y: r.y, radius: 24 });
    else if (r.type === 'rock') solids.push({ x: r.x, y: r.y, radius: 20 });
  }
  for (const s of netState.structures.values()) {
    if (s.type === 'wall') solids.push({ x: s.x, y: s.y, radius: 26 });
    else if (s.type === 'campfire') solids.push({ x: s.x, y: s.y, radius: 18 });
  }
  return solids;
}
function collides(x, y, solids) {
  for (const s of solids) if (Math.hypot(x - s.x, y - s.y) < PLAYER_RADIUS + s.radius) return true;
  return false;
}

export function update(dt) {
  if (!netState.joined) return;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  const alive = netState.myAlive;
  const inputActive = isTouchDevice || pointerLocked;
  if (alive && inputActive) {
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() > 0.0001) _forward.normalize();
    _right.crossVectors(_forward, camera.up);

    _moveDir.set(0, 0, 0);
    if (keys['w']) _moveDir.add(_forward);
    if (keys['s']) _moveDir.sub(_forward);
    if (keys['a']) _moveDir.sub(_right);
    if (keys['d']) _moveDir.add(_right);
    if (touchMoveVec.x || touchMoveVec.y) {
      _moveDir.addScaledVector(_forward, -touchMoveVec.y);
      _moveDir.addScaledVector(_right, touchMoveVec.x);
    }

    if (_moveDir.lengthSq() > 0) {
      const mag = Math.min(1, _moveDir.length());
      _moveDir.normalize().multiplyScalar(SPEED_PER_SEC * dt * mag);
      const solids = getSolids();
      const nx = me.x + _moveDir.x, ny = me.y + _moveDir.z;
      const stuck = collides(me.x, me.y, solids);
      if (stuck || !collides(nx, ny, solids)) { me.x = nx; me.y = ny; }
      else if (!collides(nx, me.y, solids)) { me.x = nx; }
      else if (!collides(me.x, ny, solids)) { me.y = ny; }
      bobPhase += dt * 9;
    } else {
      bobPhase += dt * 2.4;
    }
    me.x = Math.max(0, Math.min(netState.worldSize, me.x));
    me.y = Math.max(0, Math.min(netState.worldSize, me.y));
    me.angle = Math.atan2(_forward.z, _forward.x);
  }

  // riconciliazione morbida con l'ultima posizione autoritativa nota del server
  if (netState.selfServerPos) {
    const d = Math.hypot(netState.selfServerPos.x - me.x, netState.selfServerPos.y - me.y);
    if (d > RECONCILE_SNAP_DIST) {
      me.x = netState.selfServerPos.x; me.y = netState.selfServerPos.y;
    } else if (d > 1.5) {
      me.x += (netState.selfServerPos.x - me.x) * RECONCILE_LERP;
      me.y += (netState.selfServerPos.y - me.y) * RECONCILE_LERP;
    }
  }

  const bob = alive && inputActive ? Math.sin(bobPhase) * 2.1 : 0;
  camera.position.set(me.x, EYE_HEIGHT + bob, me.y);

  sendTimer += dt * 1000;
  if (sendTimer >= SEND_INTERVAL) { sendTimer = 0; sendMove(me.x, me.y, me.angle); }
}

export function nearestResourceInRange() {
  let best = null, bestD = GATHER_RANGE;
  for (const r of netState.resources.values()) {
    const d = Math.hypot(r.x - me.x, r.y - me.y);
    if (d < bestD) { best = r; bestD = d; }
  }
  return best;
}

export function tryGather() {
  const r = nearestResourceInRange();
  if (r) sendGather(r.id);
  return r;
}
