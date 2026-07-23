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

let yaw = 0, pitch = 0;
let sendTimer = 0;
let bobPhase = 0;
let canvasEl = null;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3();

export function initPlayer(canvas) {
  canvasEl = canvas;
  document.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

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
    if (e.button === 0) sendMelee();
    if (e.button === 2) {
      sendRanged();
      if (netState.myEquipped === 'bow' && (netState.myInventory.arrow || 0) > 0) sfxBowShot();
      else if (netState.myEquipped === 'molotov' && (netState.myInventory.molotov || 0) > 0) sfxMolotovThrow();
    }
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function requestLock() { canvasEl?.requestPointerLock(); }
export function releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

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
  if (alive && pointerLocked) {
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() > 0.0001) _forward.normalize();
    _right.crossVectors(_forward, camera.up);

    _moveDir.set(0, 0, 0);
    if (keys['w']) _moveDir.add(_forward);
    if (keys['s']) _moveDir.sub(_forward);
    if (keys['a']) _moveDir.sub(_right);
    if (keys['d']) _moveDir.add(_right);

    if (_moveDir.lengthSq() > 0) {
      _moveDir.normalize().multiplyScalar(SPEED_PER_SEC * dt);
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

  const bob = alive && pointerLocked ? Math.sin(bobPhase) * 2.1 : 0;
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
