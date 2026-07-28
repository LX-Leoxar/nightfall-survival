// main.js — punto di ingresso: collega i moduli e gestisce il loop principale.
import * as THREE from 'three';
import { scene, camera, renderer, initWorld, updateWorldTime } from './world.js';
import * as entities from './entities.js';
import * as player from './player.js';
import * as ui from './ui.js';
import * as audio from './audio.js';
import { netState, getInterpolatedView, sendEquip, sendEat } from './net.js';

const canvasHost = document.getElementById('canvasHost');
initWorld(canvasHost);
entities.initEntities(scene);
player.initPlayer(renderer.domElement);
ui.initUI();

// ---------------- viewmodel: l'attrezzo tenuto in mano, visibile in prima persona ----------------
const viewmodelRig = new THREE.Group();
viewmodelRig.position.set(16, -16, -26);
viewmodelRig.rotation.y = -0.22;
camera.add(viewmodelRig);
scene.add(camera); // necessario perché il viewmodel (figlio della camera) venga renderizzato

let currentToolMesh = null;
let currentToolType = null;
let vmBobPhase = 0;

function setViewmodel(type) {
  currentToolType = type;
  if (currentToolMesh) viewmodelRig.remove(currentToolMesh);
  currentToolMesh = entities.createToolMesh(type);
  viewmodelRig.add(currentToolMesh);
}
setViewmodel('hand');

function updateViewmodel(dt) {
  if (netState.myEquipped !== currentToolType) setViewmodel(netState.myEquipped);
  const moving = (player.keys['w'] || player.keys['a'] || player.keys['s'] || player.keys['d']) && (player.pointerLocked || player.isTouchDevice) && netState.myAlive;
  vmBobPhase += dt * (moving ? 9 : 2.2);
  if (currentToolMesh) {
    currentToolMesh.position.set(Math.cos(vmBobPhase * 0.5) * (moving ? 1.4 : 0.4), Math.sin(vmBobPhase) * (moving ? 1.8 : 0.6), 0);
  }
}

// ---------------- reazioni agli eventi di rete (unico punto in cui i moduli si collegano) ----------------
netState.onInit = (data) => {
  ui.buildCraftMenu(data.craftRecipes);
  ui.buildBuildMenu(data.buildRecipes);
  player.spawnAt(data.x, data.y);
  for (const r of netState.resources.values()) entities.addResourceToScene(r);
  for (const s of netState.structures.values()) entities.addStructureToScene(s);
};
netState.onResourceAdded = (r) => entities.addResourceToScene(r);
netState.onResourceRemoved = (id) => entities.removeResourceFromScene(id);
netState.onResourceUpdate = (u) => entities.updateResourceAmount(u.id, u.amount);
netState.onStructureAdded = (s) => { entities.addStructureToScene(s); audio.sfxBuild(); };
netState.onStructureRemoved = (id) => entities.removeStructureFromScene(id);
netState.onHitConfirm = () => audio.sfxHit();
netState.onDamaged = () => { ui.flashHit(); audio.sfxHurt(); };
netState.onNightChange = (isNight) => { isNight ? audio.sfxNightFall() : audio.sfxDayBreak(); };
netState.onLeaderboard = (list) => ui.renderLeaderboard(list);

// ---------------- tasti di azione ----------------
// E raccogli · F mangia · C crafting · Q costruzione · L classifica · 1-9 equip rapido
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === 'e') {
    if (player.tryGather()) audio.sfxGather();
  } else if (key === 'f') {
    sendEat();
  } else if (key === 'c') {
    ui.toggleCraftMenu();
  } else if (key === 'q') {
    ui.toggleBuildMenu();
  } else if (key === 'l' || key === 'tab') {
    e.preventDefault();
    ui.toggleLeaderboard();
  } else if (key === 'escape') {
    if (ui.anyMenuOpen()) { ui.closeMenus(); player.requestLock(); }
  } else if (key >= '1' && key <= '9') {
    const item = netState.equipOrder[parseInt(key, 10) - 1];
    if (item) sendEquip(item);
  }
});

// ---------------- loop principale ----------------
let lastTime = performance.now();
let minimapAccum = 0;
let lastWeather = 'clear';

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  dt = Math.min(dt, 0.1); // evita salti enormi dopo un tab in background

  player.update(dt);
  updateViewmodel(dt);

  const view = getInterpolatedView();
  if (view) {
    entities.syncMonsters(view.monsters);
    entities.syncPlayers(view.players, netState.myId);
    entities.syncProjectiles(view.projectiles);
    entities.syncFireZones(view.fireZones);
    updateWorldTime(view.isNight, view.dayTimer, view.cycleLen, camera.position, view.weather || 'clear', dt);
    if (view.weather && view.weather !== lastWeather) {
      if (view.weather === 'rain') audio.sfxRainStart();
      lastWeather = view.weather;
    }
  }
  entities.updateFlames(now);

  ui.updateHUD();
  minimapAccum += dt;
  if (minimapAccum > 0.05) { minimapAccum = 0; ui.updateMinimap(); }
  audio.setLowHpHeartbeat(ui.isLowHp());

  renderer.render(scene, camera);
}
animate();
