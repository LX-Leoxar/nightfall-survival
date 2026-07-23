// world.js — scena, camera, renderer, terreno, cielo e luce che transita fra giorno e notte.
import * as THREE from 'three';

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 2400);
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
export const EYE_HEIGHT = 42;

const DAY_SKY = new THREE.Color('#5a9bd4');
const NIGHT_SKY = new THREE.Color('#080a12');
const DAY_FOG = new THREE.Color('#bcd9ee');
const NIGHT_FOG = new THREE.Color('#05060a');
const DAY_AMBIENT = new THREE.Color('#fff2df');
const NIGHT_AMBIENT = new THREE.Color('#3c4a70');
const DAY_SUN = new THREE.Color('#fff3d6');
const NIGHT_MOON = new THREE.Color('#a9bce0');

let ambient, hemi, sunMoon, fog, starsPoints, sunSpriteMesh;
const _c = new THREE.Color();

export function initWorld(hostEl) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false; // niente shadow map: ombre "finte" via decal, molto più economiche
  hostEl.appendChild(renderer.domElement);

  scene.background = DAY_SKY.clone();
  fog = new THREE.FogExp2(DAY_FOG.getHex(), 0.0018);
  scene.fog = fog;

  ambient = new THREE.AmbientLight(DAY_AMBIENT.getHex(), 0.6);
  hemi = new THREE.HemisphereLight(DAY_SKY.getHex(), '#3a3226', 0.5);
  sunMoon = new THREE.DirectionalLight(DAY_SUN.getHex(), 1.5);
  sunMoon.position.set(300, 500, 200);
  scene.add(ambient, hemi, sunMoon, sunMoon.target);

  buildGround();
  buildStars();
  buildSunSprite();

  camera.rotation.order = 'YXZ';
  camera.position.set(300, EYE_HEIGHT, 300);

  window.addEventListener('resize', onResize);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function buildGround() {
  const size = 2600;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = '#3d5a33';
  c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const shade = Math.random() * 26;
    const dark = Math.random() < 0.5;
    c.fillStyle = dark ? `rgba(20,28,14,${0.15 + Math.random() * 0.2})` : `rgba(${140 + shade},${170 + shade},${90 + shade * 0.6},0.14)`;
    c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 20, size / 20);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(1000, 0, 1000); // mondo server 0..WORLD_SIZE mappato su x,z three.js
  scene.add(ground);
}

function buildStars() {
  const count = 700;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 1300;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.48;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) + 60;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: '#ffffff', size: 3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  starsPoints = new THREE.Points(geo, mat);
  scene.add(starsPoints);
}

function buildSunSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,240,200,0.85)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  sunSpriteMesh = new THREE.Sprite(mat);
  sunSpriteMesh.scale.set(230, 230, 1);
  scene.add(sunSpriteMesh);
}

// 0 = pieno giorno, 1 = piena notte, con una breve transizione (alba/tramonto) all'inizio di ogni fase
function computeNightT(isNight, dayTimer, cycleLen) {
  const TRANSITION_FRAC = 0.12;
  const transitionMs = Math.max(1, cycleLen * TRANSITION_FRAC);
  const p = Math.min(1, dayTimer / transitionMs);
  return isNight ? p : 1 - p;
}

function dayPhaseArc(dayTimer, cycleLen) {
  return Math.PI * Math.min(1, dayTimer / cycleLen); // 0 = orizzonte, PI/2 = zenit, PI = orizzonte opposto
}

function lerp(a, b, f) { return a + (b - a) * f; }

export function updateWorldTime(isNight, dayTimer, cycleLen, camPos) {
  const t = computeNightT(isNight, dayTimer, cycleLen);

  scene.background.copy(_c.copy(DAY_SKY).lerp(NIGHT_SKY, t));
  fog.color.copy(_c.copy(DAY_FOG).lerp(NIGHT_FOG, t));
  fog.density = lerp(0.0016, 0.0052, t);

  ambient.color.copy(_c.copy(DAY_AMBIENT).lerp(NIGHT_AMBIENT, t));
  ambient.intensity = lerp(0.6, 0.2, t);
  hemi.intensity = lerp(0.5, 0.12, t);

  sunMoon.color.copy(_c.copy(DAY_SUN).lerp(NIGHT_MOON, t));
  sunMoon.intensity = lerp(1.5, 0.32, t);

  if (starsPoints) starsPoints.material.opacity = Math.max(0, (t - 0.35) / 0.65);

  if (camPos) {
    starsPoints.position.copy(camPos);
    const arc = dayPhaseArc(dayTimer, cycleLen);
    const sx = camPos.x + Math.cos(arc) * 700;
    const sy = Math.sin(arc) * 550 + 40;
    const sz = camPos.z + 260;
    sunMoon.position.set(sx, sy, sz);
    sunMoon.target.position.copy(camPos);
    sunMoon.target.updateMatrixWorld();
    if (sunSpriteMesh) {
      sunSpriteMesh.position.set(sx, sy, sz);
      sunSpriteMesh.material.opacity = sy > 20 ? lerp(1, 0.4, t) : 0;
      sunSpriteMesh.material.color.copy(sunMoon.color);
    }
  }
}
