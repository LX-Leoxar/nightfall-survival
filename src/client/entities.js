// entities.js — crea le mesh 3D per ogni tipo di entità e le tiene sincronizzate con lo stato di rete.
import * as THREE from 'three';

// ---------------- geometrie / materiali condivisi (creati una sola volta) ----------------
const treeTrunkGeo = new THREE.CylinderGeometry(4, 6, 34, 6);
const treeFoliageGeo = new THREE.ConeGeometry(26, 46, 7);
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#5b3a24', roughness: 1 });
const treeFoliageMatA = new THREE.MeshStandardMaterial({ color: '#2f6b34', roughness: 0.9 });
const treeFoliageMatB = new THREE.MeshStandardMaterial({ color: '#3a7d3f', roughness: 0.9 });

const rockGeo = new THREE.DodecahedronGeometry(20, 0);
const rockMat = new THREE.MeshStandardMaterial({ color: '#7f8c8d', roughness: 1, flatShading: true });

const fiberGeo = new THREE.SphereGeometry(9, 6, 4);
const fiberMat = new THREE.MeshStandardMaterial({ color: '#c9b458', roughness: 1, flatShading: true });

const monsterBodyGeo = new THREE.SphereGeometry(1, 10, 8);
const monsterMat = new THREE.MeshStandardMaterial({ color: '#5c1f18', roughness: 0.85 });
const monsterEyeGeo = new THREE.SphereGeometry(2.6, 6, 6);
const monsterEyeMat = new THREE.MeshStandardMaterial({ color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 2.4 });

const playerBodyGeo = new THREE.CapsuleGeometry(14, 34, 4, 8);
const headGeo = new THREE.SphereGeometry(11, 10, 8);
const headMat = new THREE.MeshStandardMaterial({ color: '#d9a679', roughness: 0.8 });
const playerArmorMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.45, metalness: 0.35 });

const wallGeo = new THREE.BoxGeometry(52, 60, 14);
const wallMat = new THREE.MeshStandardMaterial({ color: '#8d6e63', roughness: 1 });
const spikeGeo = new THREE.ConeGeometry(4, 22, 5);
const spikeMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.55 });
const logGeo = new THREE.CylinderGeometry(4, 4, 30, 6);
const logMat = new THREE.MeshStandardMaterial({ color: '#4a3323', roughness: 1 });
const postGeo = new THREE.CylinderGeometry(2.2, 2.6, 46, 6);

const arrowGeo = new THREE.CylinderGeometry(1.2, 1.2, 26, 5);
arrowGeo.rotateX(Math.PI / 2); // asse lungo Z locale (convenzione "fronte locale = +Z")
const arrowMat = new THREE.MeshStandardMaterial({ color: '#e8e2d6', roughness: 0.7 });

const bottleMat = new THREE.MeshStandardMaterial({ color: '#3a5a3a', roughness: 0.25, transparent: true, opacity: 0.85 });
const ragMat = new THREE.MeshStandardMaterial({ color: '#cbbfa0', roughness: 1 });
const molotovBallMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff6a2a', emissiveIntensity: 1.4 });

const shadowGeo = new THREE.CircleGeometry(1, 16);
const shadowMat = new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 });
const flameTex = makeFlameTexture();

function makeShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.65)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeFlameTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 96;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 70, 2, 32, 50, 46);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.35, 'rgba(255,170,60,0.95)');
  g.addColorStop(0.7, 'rgba(230,90,30,0.5)');
  g.addColorStop(1, 'rgba(230,60,20,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 96);
  return new THREE.CanvasTexture(c);
}

function createFlameSprite(scale) {
  const mat = new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale * 1.5, 1);
  return s;
}

function addShadow(parent, radius) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(radius, radius, 1);
  m.position.y = 0.4;
  parent.add(m);
}

// ---------------- orientamento: allinea il "fronte locale" (+Z) a una direzione del mondo ----------------
const _localFront = new THREE.Vector3(0, 0, 1);
const _worldDir = new THREE.Vector3();
export function orientToward(mesh, dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d < 0.0001) return;
  _worldDir.set(dx / d, 0, dy / d);
  mesh.quaternion.setFromUnitVectors(_localFront, _worldDir);
}

// ---------------- factory: risorse ----------------
export function createTreeMesh() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
  trunk.position.y = 17;
  g.add(trunk);
  const mat = Math.random() < 0.5 ? treeFoliageMatA : treeFoliageMatB;
  const f1 = new THREE.Mesh(treeFoliageGeo, mat);
  f1.position.y = 45;
  const f2 = new THREE.Mesh(treeFoliageGeo, mat);
  f2.position.y = 63; f2.scale.set(0.68, 0.68, 0.68);
  g.add(f1, f2);
  g.rotation.y = Math.random() * Math.PI * 2;
  const s = 0.85 + Math.random() * 0.3;
  g.userData.baseScale = s;
  g.scale.setScalar(s);
  addShadow(g, 22);
  return g;
}

export function createRockMesh() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(rockGeo, rockMat);
  m.position.y = 10;
  m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  const s = 0.7 + Math.random() * 0.5;
  m.scale.set(s, s * 0.7, s);
  g.userData.baseScale = 1;
  g.add(m);
  addShadow(g, 18);
  return g;
}

export function createFiberMesh() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(fiberGeo, fiberMat);
    m.position.set((Math.random() - 0.5) * 12, 6, (Math.random() - 0.5) * 12);
    m.scale.set(0.8, 0.55, 0.8);
    g.add(m);
  }
  g.userData.baseScale = 1;
  return g;
}

// ---------------- factory: mostro ----------------
export function createMonsterMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(monsterBodyGeo, monsterMat);
  body.scale.set(20, 24, 24);
  body.position.y = 24;
  g.add(body);
  const eyeL = new THREE.Mesh(monsterEyeGeo, monsterEyeMat);
  eyeL.position.set(-7, 28, 18);
  const eyeR = eyeL.clone();
  eyeR.position.x = 7;
  g.add(eyeL, eyeR);
  addShadow(g, 22);
  g.userData.bobSeed = Math.random() * 100;
  return g;
}

// ---------------- attrezzi (condivisi fra vista in prima persona e modello degli altri giocatori) ----------------
export function createToolMesh(type) {
  const g = new THREE.Group();
  if (type === 'spear') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 62, 6), logMat);
    shaft.rotation.x = Math.PI / 2.3; shaft.position.z = 10;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(4, 14, 4), spikeMat);
    tip.position.z = 40; tip.rotation.x = Math.PI / 2;
    g.add(shaft, tip);
  } else if (type === 'axe') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 46, 6), logMat);
    shaft.rotation.x = Math.PI / 2.4; shaft.position.z = 8;
    const head = new THREE.Mesh(new THREE.BoxGeometry(3, 10, 14), rockMat);
    head.position.z = 28;
    g.add(shaft, head);
  } else if (type === 'pickaxe') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 46, 6), logMat);
    shaft.rotation.x = Math.PI / 2.4; shaft.position.z = 8;
    const head = new THREE.Mesh(new THREE.ConeGeometry(3, 20, 4), rockMat);
    head.position.z = 28; head.rotation.x = Math.PI / 2;
    g.add(shaft, head);
  } else if (type === 'knife') {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(3, 20, 4), arrowMat);
    blade.rotation.x = Math.PI / 2; blade.position.z = 12;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 12, 6), logMat);
    handle.rotation.x = Math.PI / 2;
    g.add(blade, handle);
  } else if (type === 'bow') {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(18, 1.4, 5, 10, Math.PI * 1.15), logMat);
    arc.rotation.x = Math.PI / 2;
    g.add(arc);
  } else if (type === 'torch') {
    const stick = new THREE.Mesh(postGeo.clone(), logMat);
    stick.scale.set(0.7, 0.75, 0.7);
    const flame = createFlameSprite(20);
    flame.position.y = 20;
    const light = new THREE.PointLight('#ff9a4a', 24, 340, 1);
    light.position.y = 20;
    light.userData.seed = Math.random() * 100;
    g.add(stick, flame, light);
    g.userData.flame = flame; g.userData.light = light;
  } else if (type === 'molotov') {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 14, 7), bottleMat);
    const rag = new THREE.Mesh(new THREE.SphereGeometry(3, 6, 5), ragMat);
    rag.position.y = 9;
    g.add(bottle, rag);
  }
  return g;
}

// ---------------- factory: giocatore ----------------
export function createPlayerMesh(hue) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue}, 50%, 42%)`), roughness: 0.75 });
  const body = new THREE.Mesh(playerBodyGeo, bodyMat);
  body.position.y = 31;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 56;
  const armor = new THREE.Mesh(playerBodyGeo, playerArmorMat);
  armor.position.y = 31; armor.scale.set(1.12, 0.62, 1.12);
  armor.visible = false;
  const nameSprite = makeNameSprite('');
  nameSprite.position.y = 80;
  const toolSlot = new THREE.Group();
  toolSlot.position.set(15, 42, 10);
  g.add(body, head, armor, nameSprite, toolSlot);
  addShadow(g, 20);
  g.userData = { bodyMat, armor, nameSprite, toolSlot, lastTool: null, lastName: null };
  return g;
}

function makeNameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(72, 18, 1);
  s.userData.canvas = canvas;
  s.userData.ctx = canvas.getContext('2d');
  updateNameSprite(s, text);
  return s;
}

function updateNameSprite(sprite, text) {
  const ctx = sprite.userData.ctx, canvas = sprite.userData.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 30px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(5,6,8,0.6)';
  ctx.fillText(text, canvas.width / 2 + 2, 40 + 2);
  ctx.fillStyle = '#f0ead9';
  ctx.fillText(text, canvas.width / 2, 40);
  sprite.material.map.needsUpdate = true;
}

// ---------------- factory: strutture ----------------
export function createStructureMesh(type) {
  if (type === 'wall') {
    const m = new THREE.Mesh(wallGeo, wallMat);
    m.position.y = 30;
    return m;
  }
  if (type === 'spikes') {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      s.position.set((Math.random() - 0.5) * 34, 11, (Math.random() - 0.5) * 34);
      s.rotation.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
      g.add(s);
    }
    return g;
  }
  if (type === 'campfire') {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(logGeo, logMat);
      l.rotation.z = Math.PI / 2;
      l.rotation.y = (i / 5) * Math.PI * 2;
      l.position.y = 4;
      g.add(l);
    }
    const flame = createFlameSprite(34);
    flame.position.y = 22;
    const light = new THREE.PointLight('#ff8a3a', 55, 500, 1);
    light.position.y = 20;
    light.userData.seed = Math.random() * 100;
    g.add(flame, light);
    addShadow(g, 24);
    g.userData.flame = flame; g.userData.light = light;
    return g;
  }
  if (type === 'torch') {
    const g = new THREE.Group();
    const post = new THREE.Mesh(postGeo, logMat);
    post.position.y = 23;
    const flame = createFlameSprite(24);
    flame.position.y = 48;
    const light = new THREE.PointLight('#ff9a4a', 24, 340, 1);
    light.position.y = 48;
    light.userData.seed = Math.random() * 100;
    g.add(post, flame, light);
    g.userData.flame = flame; g.userData.light = light;
    return g;
  }
  return new THREE.Group();
}

// ---------------- factory: proiettili e zone di fuoco ----------------
export function createProjectileMesh(type) {
  if (type === 'molotov') {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(6, 6, 5), molotovBallMat);
    const light = new THREE.PointLight('#ff7a30', 16, 140, 2);
    g.add(ball, light);
    return g;
  }
  return new THREE.Mesh(arrowGeo, arrowMat);
}

export function createFireZoneMesh(radius) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const f = createFlameSprite(22 + Math.random() * 14);
    f.position.set((Math.random() - 0.5) * radius * 0.7, 12, (Math.random() - 0.5) * radius * 0.7);
    g.add(f);
  }
  const light = new THREE.PointLight('#ff6a2a', 36, radius * 2.4, 2);
  light.position.y = 16;
  light.userData.seed = Math.random() * 100;
  g.add(light);
  g.userData.light = light;
  return g;
}

// ---------------- registri + sincronizzazione con lo stato di rete ----------------
const resourceMeshes = new Map();
const structureMeshes = new Map();
const monsterMeshes = new Map();
const playerMeshes = new Map();
const projectileMeshes = new Map();
const fireZoneMeshes = new Map();

let sceneRef = null;
export function initEntities(scene) { sceneRef = scene; }

export function addResourceToScene(res) {
  const mesh = res.type === 'tree' ? createTreeMesh() : res.type === 'rock' ? createRockMesh() : createFiberMesh();
  mesh.position.set(res.x, 0, res.y);
  mesh.userData.maxAmount = res.type === 'fiber' ? 3 : 5;
  sceneRef.add(mesh);
  resourceMeshes.set(res.id, mesh);
}
export function removeResourceFromScene(id) {
  const m = resourceMeshes.get(id);
  if (!m) return;
  sceneRef.remove(m);
  resourceMeshes.delete(id);
}
export function updateResourceAmount(id, amount) {
  const m = resourceMeshes.get(id);
  if (!m) return;
  const f = Math.max(0.35, amount / m.userData.maxAmount);
  m.scale.setScalar(f * (m.userData.baseScale || 1));
}

export function addStructureToScene(s) {
  const mesh = createStructureMesh(s.type);
  mesh.position.set(s.x, 0, s.y);
  if (typeof s.angle === 'number') orientToward(mesh, Math.cos(s.angle), Math.sin(s.angle));
  sceneRef.add(mesh);
  structureMeshes.set(s.id, mesh);
}
export function removeStructureFromScene(id) {
  const m = structureMeshes.get(id);
  if (!m) return;
  if (m.userData.flame) m.userData.flame.material.dispose();
  sceneRef.remove(m);
  structureMeshes.delete(id);
}

function disposePlayerMesh(mesh) {
  mesh.userData.bodyMat?.dispose();
  const ns = mesh.userData.nameSprite;
  if (ns) { ns.material.map?.dispose(); ns.material.dispose(); }
  mesh.userData.toolSlot?.traverse(n => { if (n.isSprite) n.material.dispose(); });
}

export function syncMonsters(list) {
  const seen = new Set();
  const t = performance.now();
  for (const m of list) {
    seen.add(m.id);
    let mesh = monsterMeshes.get(m.id);
    if (!mesh) {
      mesh = createMonsterMesh();
      mesh.position.set(m.x, 0, m.y);
      mesh.userData.lastX = m.x; mesh.userData.lastY = m.y;
      sceneRef.add(mesh);
      monsterMeshes.set(m.id, mesh);
    }
    const dx = m.x - mesh.userData.lastX, dy = m.y - mesh.userData.lastY;
    if (dx * dx + dy * dy > 0.3) orientToward(mesh, dx, dy);
    mesh.userData.lastX = m.x; mesh.userData.lastY = m.y;
    mesh.position.x = m.x; mesh.position.z = m.y;
    mesh.position.y = Math.sin(t * 0.006 + mesh.userData.bobSeed) * 2 + 2;
  }
  for (const [id, mesh] of monsterMeshes) {
    if (!seen.has(id)) { sceneRef.remove(mesh); monsterMeshes.delete(id); }
  }
}

export function syncPlayers(playersObj, myId) {
  const seen = new Set();
  for (const id in playersObj) {
    if (id === myId) continue; // il proprio giocatore è la telecamera stessa (prima persona)
    seen.add(id);
    const p = playersObj[id];
    let mesh = playerMeshes.get(id);
    if (!mesh) { mesh = createPlayerMesh(p.hue); sceneRef.add(mesh); playerMeshes.set(id, mesh); }
    mesh.visible = p.alive;
    mesh.position.set(p.x, 0, p.y);
    orientToward(mesh, Math.cos(p.angle), Math.sin(p.angle));
    mesh.userData.armor.visible = !!p.hasArmor;
    if (mesh.userData.lastName !== p.name) { updateNameSprite(mesh.userData.nameSprite, p.name); mesh.userData.lastName = p.name; }
    if (mesh.userData.lastTool !== p.equipped) {
      mesh.userData.toolSlot.clear();
      mesh.userData.toolSlot.add(createToolMesh(p.equipped));
      mesh.userData.lastTool = p.equipped;
    }
  }
  for (const [id, mesh] of playerMeshes) {
    if (!seen.has(id)) { sceneRef.remove(mesh); disposePlayerMesh(mesh); playerMeshes.delete(id); }
  }
}

export function syncProjectiles(list) {
  const seen = new Set();
  for (const pr of list) {
    seen.add(pr.id);
    let mesh = projectileMeshes.get(pr.id);
    if (!mesh) { mesh = createProjectileMesh(pr.type); sceneRef.add(mesh); projectileMeshes.set(pr.id, mesh); }
    mesh.position.set(pr.x, pr.type === 'molotov' ? 16 : 22, pr.y);
    orientToward(mesh, Math.cos(pr.angle), Math.sin(pr.angle));
  }
  for (const [id, mesh] of projectileMeshes) {
    if (!seen.has(id)) { sceneRef.remove(mesh); projectileMeshes.delete(id); }
  }
}

export function syncFireZones(list) {
  const seen = new Set();
  for (const fz of list) {
    seen.add(fz.id);
    let mesh = fireZoneMeshes.get(fz.id);
    if (!mesh) { mesh = createFireZoneMesh(fz.radius); sceneRef.add(mesh); fireZoneMeshes.set(fz.id, mesh); }
    mesh.position.set(fz.x, 0, fz.y);
  }
  for (const [id, mesh] of fireZoneMeshes) {
    if (!seen.has(id)) { sceneRef.remove(mesh); fireZoneMeshes.delete(id); }
  }
}

// tremolio di fiamme/luci (falò, torce, zone di fuoco) — chiamato ogni frame
export function updateFlames(time) {
  for (const mesh of structureMeshes.values()) if (mesh.userData.light) flicker(mesh.userData.light, mesh.userData.flame, time);
  for (const mesh of fireZoneMeshes.values()) flicker(mesh.userData.light, null, time);
}
function flicker(light, flame, time) {
  if (light.userData.base === undefined) light.userData.base = light.intensity;
  const seed = light.userData.seed || 0;
  const n = Math.sin(time * 0.011 + seed) * 0.5 + Math.sin(time * 0.027 + seed * 3) * 0.3;
  light.intensity = light.userData.base * (1 + n * 0.25);
  if (flame) {
    if (flame.userData.baseY === undefined) flame.userData.baseY = flame.scale.y;
    flame.scale.y = flame.userData.baseY * (1 + Math.sin(time * 0.02 + seed) * 0.08);
  }
}

export function resourceMeshCount() { return resourceMeshes.size; }
