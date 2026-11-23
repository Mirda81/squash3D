// SQUASH 3D – pohybová hra pro 2 hráče (Three.js + MediaPipe Pose)
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { initPose, startCamera, detectPoses, drawPreview, poseState, calibrate, resetCalibration } from './pose.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { sfx, initAudio } from './audio.js';
import { makePlayer, animatePlayer } from './player.js';

// ---------- rozměry kurtu (m) ----------
const HW = 3.2, L = 9.75, H = 6.0;
const TIN = 0.48, OUT_FRONT = 4.57, SERVICE = 1.78, OUT_BACK = 2.13, SHORT = 5.44;
const G = 9.8, R = 0.045, DRAG = 0.06;
const E_WALL = 0.74, E_FLOOR = 0.62;

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- nastavení ----------
const settings = { speed: 0.85, assist: 'off', quality: 'high', camera: 'user', target: 11 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('sq3d') || '{}')); } catch (e) {}
if (!['off', 'mild'].includes(settings.assist)) settings.assist = 'off';
const QP = new URLSearchParams(location.search);
if (QP.get('q')) settings.quality = QP.get('q');
const TEST_SPEED = +(QP.get('ts') || 1);
const saveSettings = () => { try { localStorage.setItem('sq3d', JSON.stringify(settings)); } catch (e) {} };

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020308);
scene.fog = new THREE.Fog(0x020308, 20, 42);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 120);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.7, 0.35, 2.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  const pr = settings.quality === 'high' ? Math.min(dpr, 2) : settings.quality === 'medium' ? Math.min(dpr, 1.25) : 0.85;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  renderer.shadowMap.enabled = settings.quality !== 'low';
  mirror.visible = settings.quality === 'high';
  floorMat.opacity = mirror.visible ? 0.84 : 1; floorMat.transparent = mirror.visible; floorMat.needsUpdate = true;
  bloom.enabled = settings.quality !== 'low';
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  // na užších displejích (mobil na výšku) oddálit kameru
  camera.fov = w / h < 1.3 ? 62 : 44;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- textury z canvasu ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
const LINE = '#c4162a';

const floorTex = canvasTex(1024, 1560, (g, w, h) => {
  const sx = w / (HW * 2), sz = h / L;
  const pw = 0.08 * sx;
  for (let x = 0, i = 0; x < w; x += pw, i++) {
    let z = -Math.random() * 300;
    while (z < h) {
      const len = rnd(260, 520);
      const t = rnd(0.86, 1.08);
      g.fillStyle = `rgb(${(205 * t) | 0},${(150 * t) | 0},${(95 * t) | 0})`;
      g.fillRect(x, z, pw, len);
      g.fillStyle = 'rgba(90,50,20,0.10)';
      for (let k = 0; k < 6; k++) g.fillRect(x + rnd(0, pw), z, 1, len);
      g.fillStyle = 'rgba(60,30,10,0.35)';
      g.fillRect(x, z, pw, 1.5);
      z += len;
    }
    g.fillStyle = 'rgba(60,30,10,0.35)'; g.fillRect(x, 0, 1.2, h);
  }
  g.fillStyle = LINE;
  const lw = 0.05 * sx;
  const X = (x) => (x + HW) * sx, Z = (z) => z * sz;
  g.fillRect(0, Z(SHORT) - lw / 2, w, lw); // krátká čára
  g.fillRect(X(0) - lw / 2, Z(SHORT), lw, h - Z(SHORT)); // půlicí čára
  // servisní boxy 1.6 m
  g.fillRect(X(-HW + 1.6) - lw / 2, Z(SHORT), lw, 1.6 * sz);
  g.fillRect(X(HW - 1.6) - lw / 2, Z(SHORT), lw, 1.6 * sz);
  g.fillRect(0, Z(SHORT + 1.6) - lw / 2, X(-HW + 1.6), lw);
  g.fillRect(X(HW - 1.6), Z(SHORT + 1.6) - lw / 2, w, lw);
});

const wallNoise = (g, w, h) => {
  g.fillStyle = '#eceef2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // jemné stínění v rozích a dole (ambient occlusion)
  const edge = (x0, y0, x1, y1, a) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, `rgba(20,25,40,${a})`); gr.addColorStop(1, 'rgba(20,25,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); };
  edge(0, 0, w * 0.12, 0, 0.22); edge(w, 0, w * 0.88, 0, 0.22); edge(0, 0, 0, h * 0.15, 0.25); edge(0, h, 0, h * 0.9, 0.18);
};
const frontTex = canvasTex(1024, 960, (g, w, h) => {
  wallNoise(g, w, h);
  const sy = h / H, Y = (y) => h - y * sy, lw = 0.05 * sy;
  g.save(); g.globalAlpha = 0.07; g.fillStyle = '#1a2a6c';
  g.font = `900 ${0.9 * sy}px Arial Black, Arial`; g.textAlign = 'center';
  g.fillText('SQUASH 3D', w / 2, Y(2.9)); g.restore();
  g.fillStyle = LINE;
  g.fillRect(0, Y(OUT_FRONT) - lw / 2, w, lw);
  g.fillRect(0, Y(SERVICE) - lw / 2, w, lw);
  g.fillRect(0, Y(TIN) - lw / 2, w, lw);
});
const sideTex = canvasTex(1560, 960, (g, w, h) => {
  wallNoise(g, w, h);
  const sy = h / H, sz = w / L, lw = 0.05 * sy;
  g.strokeStyle = LINE; g.lineWidth = lw;
  g.beginPath(); g.moveTo(0, h - OUT_FRONT * sy); g.lineTo(L * sz, h - OUT_BACK * sy); g.stroke();
});

// ---------- kurt ----------
const court = new THREE.Group(); scene.add(court);
const floorMat = new THREE.MeshPhysicalMaterial({ map: floorTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.6 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, L), floorMat);
floorMat.transparent = true; floorMat.opacity = 0.84;
const mirror = new Reflector(new THREE.PlaneGeometry(HW * 2, L), { textureWidth: 1024, textureHeight: 1024, color: 0x8a8a8a, clipBias: 0.003 });
mirror.rotation.x = -Math.PI / 2; mirror.position.set(0, -0.002, L / 2); court.add(mirror);
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, L / 2); floor.receiveShadow = true;
court.add(floor);

const wallMat = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, envMapIntensity: 0.2 });
const front = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, H), wallMat(frontTex));
front.position.set(0, H / 2, 0); front.receiveShadow = true; court.add(front);
const sideL = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat(sideTex));
sideL.rotation.y = Math.PI / 2; sideL.position.set(-HW, H / 2, L / 2); sideL.receiveShadow = true; court.add(sideL);
const sideR = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat(sideTex));
sideR.rotation.y = -Math.PI / 2; sideR.scale.x = -1; sideR.position.set(HW, H / 2, L / 2); sideR.receiveShadow = true; court.add(sideR);
sideR.material.side = THREE.DoubleSide;

// plech (tin)
function neonTin() { const m = new THREE.MeshBasicMaterial({ color: 0xff2a4a, toneMapped: false }); m.color.multiplyScalar(7); return m; }
const tin = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, TIN, 0.06),
  new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.8, roughness: 0.3 }));
tin.position.set(0, TIN / 2, 0.03); tin.castShadow = tin.receiveShadow = true; court.add(tin);
const tinGlow = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.03, 0.065), neonTin());
tinGlow.position.set(0, TIN - 0.03, 0.035); court.add(tinGlow);

// skleněná zadní stěna
const glass = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, H),
  new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.05, roughness: 0.1, metalness: 0, envMapIntensity: 0.15, depthWrite: false }));
glass.position.set(0, H / 2, L); glass.rotation.y = Math.PI; court.add(glass);
const glassLine = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.05, 0.01), new THREE.MeshBasicMaterial({ color: 0xd0203a }));
glassLine.position.set(0, OUT_BACK, L + 0.01); court.add(glassLine);
const frameMat = new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.9, roughness: 0.25 });
for (const x of [-HW, HW]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, 0.06), frameMat);
  post.position.set(x, H / 2, L + 0.02); court.add(post);
}

// neonové lišty
const neon = (color) => { const m = new THREE.MeshBasicMaterial({ color, toneMapped: false }); m.color.multiplyScalar(7); return m; };
const neonC = neon(0x31e3ff), neonM = neon(0xff3fd2);
function strip(w, h, d, x, y, z, m) { const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); s.position.set(x, y, z); court.add(s); return s; }
strip(HW * 2 + 0.2, 0.06, 0.06, 0, H, 0, neonC);
strip(0.06, 0.06, L, -HW, H, L / 2, neonC);
strip(0.06, 0.06, L, HW, H, L / 2, neonC);
strip(HW * 2, 0.04, 0.04, 0, 0.02, L + 0.05, neonM);
strip(0.04, 0.04, L, -HW - 0.05, 0.02, L / 2, neonM);
strip(0.04, 0.04, L, HW + 0.05, 0.02, L / 2, neonM);

// aréna
const arenaFloor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 0.35, metalness: 0.5 }));
arenaFloor.rotation.x = -Math.PI / 2; arenaFloor.position.y = -0.01; arenaFloor.receiveShadow = true; scene.add(arenaFloor);
const backBox = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 0.4, H + 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x10131d, roughness: 0.9 }));
backBox.position.set(0, H / 2, -0.21); scene.add(backBox);
for (const s of [-1, 1]) {
  const sb = new THREE.Mesh(new THREE.BoxGeometry(0.4, H + 0.4, L + 0.4), backBox.material);
  sb.position.set(s * (HW + 0.21), H / 2, L / 2); scene.add(sb);
}
// tribuny s diváky (instanced)
(function crowd() {
  const geo = new THREE.CapsuleGeometry(0.17, 0.35, 3, 6);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const N = 900; const im = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const palette = [0x2a3a6a, 0x6a2a3a, 0x3a3a3a, 0x24564a, 0x6a5a2a, 0x4a2a6a, 0x777777];
  let i = 0;
  for (let row = 0; row < 9 && i < N; row++) {
    const z = L + 6 + row * 1.0, y = 0.6 + row * 0.55;
    for (let x = -9; x <= 9 && i < N; x += 0.62) {
      if (Math.random() < 0.15) continue;
      m.makeTranslation(x + rnd(-0.08, 0.08), y, z); im.setMatrixAt(i, m);
      im.setColorAt(i++, c.setHex(palette[(Math.random() * palette.length) | 0]));
    }
  }
  for (const s of [-1, 1]) for (let row = 0; row < 6 && i < N; row++) {
    const x = s * (HW + 2.5 + row * 0.9), y = 0.6 + row * 0.55;
    for (let z = 1; z < L + 2 && i < N; z += 0.62) {
      if (Math.random() < 0.2) continue;
      m.makeTranslation(x, y, z); im.setMatrixAt(i, m);
      im.setColorAt(i++, c.setHex(palette[(Math.random() * palette.length) | 0]));
    }
  }
  im.count = i; scene.add(im);
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x0d1019, roughness: 0.8 });
  for (let row = 0; row < 9; row++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(20, 0.55 * (row + 1), 1), stepMat);
    st.position.set(0, 0.275 * (row + 1) - 0.3, L + 6 + row); scene.add(st);
  }
  for (const s of [-1, 1]) for (let row = 0; row < 6; row++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55 * (row + 1), L + 3), stepMat);
    st.position.set(s * (HW + 2.5 + row * 0.9), 0.275 * (row + 1), L / 2); scene.add(st);
  }
})();

// světla
const coneMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ float f = pow(abs(dot(vN, vV)), 2.0); float a = pow(vUv.y, 1.6) * 0.10 * f; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, a); }`,
});
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x20140a, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1.5, 12, 7); sun.target.position.set(0, 0, 4.5);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 7, bottom: -7, near: 2, far: 25 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
for (const [x, z] of [[-1.6, 2], [1.6, 2], [-1.6, 7], [1.6, 7]]) {
  const sp = new THREE.SpotLight(0xfff4e0, 4, 14, 0.9, 0.6, 1.6);
  sp.position.set(x, H - 0.1, z); sp.target.position.set(x, 0, z);
  scene.add(sp, sp.target);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 1.7, H - 0.1, 32, 1, true), coneMat);
  cone.position.set(x, (H - 0.1) / 2, z); scene.add(cone);
}
// prach ve světle
const DUST = 700;
const dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) { dustPos[i * 3] = rnd(-HW, HW); dustPos[i * 3 + 1] = rnd(0.2, H); dustPos[i * 3 + 2] = rnd(0, L); }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff2d8, size: 0.018, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(dust);
// LED tabule nad přední stěnou
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 192;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }); boardMat.color.setScalar(1.6);
const board = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.01), boardMat);
board.position.set(0, H + 0.75, 0.02); scene.add(board);
const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0x0c0e16, metalness: 0.6, roughness: 0.4 }));
boardFrame.position.set(0, H + 0.75, -0.14); scene.add(boardFrame);
function drawBoard(a, b, server) {
  const g = boardCanvas.getContext('2d'), w = 1024, h = 192;
  g.fillStyle = '#05060c'; g.fillRect(0, 0, w, h);
  g.font = '900 120px Arial Black, Arial'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.shadowBlur = 24;
  g.shadowColor = g.fillStyle = '#38d6ff'; g.fillText(String(a), w * 0.38, h / 2 + 6);
  g.shadowColor = g.fillStyle = '#ff4f7a'; g.fillText(String(b), w * 0.62, h / 2 + 6);
  g.shadowColor = g.fillStyle = '#ffffff'; g.font = '900 90px Arial'; g.fillText(':', w / 2, h / 2);
  g.font = '800 44px Arial'; g.shadowBlur = 12;
  g.shadowColor = g.fillStyle = '#38d6ff'; g.fillText((server === 0 ? '● ' : '') + 'MODRÝ', w * 0.15, h / 2);
  g.shadowColor = g.fillStyle = '#ff4f7a'; g.fillText('ČERVENÝ' + (server === 1 ? ' ●' : ''), w * 0.85, h / 2);
  g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1.5);
  for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1.5, h);
  boardTex.needsUpdate = true;
}
drawBoard(0, 0, 0);

// ---------- hráči ----------
const COLORS = [
  { name: 'MODRÝ', num: '1', suit: 0x1f5fd6, accent: 0x38d6ff, css: '#38d6ff' },
  { name: 'ČERVENÝ', num: '2', suit: 0xc61f36, accent: 0xff4f7a, css: '#ff4f7a' },
];
const players = [];
const makePlayers = (gltf) => COLORS.forEach((c, i) => players.push({
  idx: i, ...c, avatar: makePlayer(scene, gltf, c),
  x: i ? 1.4 : -1.4, z: 6.2, inX: i ? 1.4 : -1.4, vx: 0, vz: 0,
  control: 'cpu', score: 0, pending: null, swingT: 9, swingDir: 1, phase: 0,
  armLift: 0, keyDir: 0, cpuNext: 0, cpuErr: 0,
}));

// ---------- míček, stopa, efekty ----------
const ball = { p: new THREE.Vector3(0, 1, 3), v: new THREE.Vector3(), color: new THREE.Color(0xffffff) };
const ballMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 5 });
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), ballMat); ballMesh.castShadow = true; scene.add(ballMesh);
const ballLight = new THREE.PointLight(0xffffff, 3, 3, 2); scene.add(ballLight);
const blob = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.006; scene.add(blob);

const TRAIL = 28;
const trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), trailMat, TRAIL); scene.add(trail);
const trailPts = Array.from({ length: TRAIL }, () => new THREE.Vector3(0, -5, 0));

const PCOUNT = 400;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PCOUNT * 3), pCol = new Float32Array(PCOUNT * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const parts = Array.from({ length: PCOUNT }, () => ({ life: 0, max: 1, v: new THREE.Vector3(), c: new THREE.Color() }));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
points.frustumCulled = false; scene.add(points);
let pNext = 0;
function burst(pos, color, n = 30, speed = 4) {
  for (let k = 0; k < n; k++) {
    const i = pNext; pNext = (pNext + 1) % PCOUNT;
    const p = parts[i];
    p.life = p.max = rnd(0.35, 0.8);
    p.v.set(rnd(-1, 1), rnd(-0.3, 1.2), rnd(-1, 1)).normalize().multiplyScalar(speed * rnd(0.3, 1));
    p.c.set(color);
    pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
  }
}
const marks = Array.from({ length: 14 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.16, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  scene.add(m); m.userData.life = 0; return m;
});
let markNext = 0;
function wallMark(pos, normal, color) {
  const m = marks[markNext]; markNext = (markNext + 1) % marks.length;
  m.position.copy(pos).addScaledVector(normal, 0.012 - R);
  m.lookAt(m.position.clone().add(normal));
  m.material.color.set(color); m.userData.life = 1.4; m.scale.setScalar(0.5);
}

// cíl: kde půjde míček odehrát
const targetMk = new THREE.Group(); scene.add(targetMk);
const tmMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
const tmRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 40), tmMat); tmRing.rotation.x = -Math.PI / 2; targetMk.add(tmRing);
const tmDot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), tmMat); tmDot.rotation.x = -Math.PI / 2; targetMk.add(tmDot);
targetMk.position.y = 0.016;

// ---------- stav hry ----------
const game = {
  state: 'demo', timer: 0, server: 0, side: 1, target: 11,
  rally: { last: 0, front: false, bounces: 0, serve: false },
  pred: null, slow: 1, slowT: 0, shake: 0, demo: true, hitCount: 0,
};
const turnIdx = () => 1 - game.rally.last;

function resetScores() { players.forEach((p) => (p.score = 0)); game.server = 0; game.side = 1; }

function setupServe() {
  const s = players[game.server], r = players[1 - game.server];
  s.x = s.inX = game.side * 2.0; s.z = 6.3;
  r.x = r.inX = -game.side * 1.6; r.z = 7.4;
  game.state = 'serve'; game.timer = 0; game.pred = null;
  game.rally = { last: game.server, front: false, bounces: 0, serve: true };
  placeBallForServe();
  ball.color.set(players[game.server].accent);
  if (!game.demo) {
    const who = players[game.server];
    banner(`PODÁVÁ ${who.name}`, who.css, who.control === 'pose' ? 'máchni rukou' : who.control === 'keys' ? 'stiskni úder' : '');
  }
  updateHUD();
}
function placeBallForServe() {
  const s = players[game.server];
  ball.p.set(s.x + 0.35, 1.0 + Math.abs(Math.sin(game.timer * 3)) * 0.5, s.z - 0.35);
  ball.v.set(0, 0, 0);
}

function shotVelocity(from, tx, ty, hspeed) {
  const dx = tx - from.x, dz = R - from.z;
  const d = Math.hypot(dx, dz), t = d / hspeed;
  const vy = (ty - from.y + 0.5 * G * t * t) / t;
  return new THREE.Vector3(dx / t, vy, dz / t).multiplyScalar(1 + DRAG * t * 0.6);
}

function doServe(sw) {
  const s = players[game.server];
  ball.p.set(s.x + 0.3, 1.45, s.z - 0.45);
  const tx = clamp(-game.side * 0.9 + (sw.aim || 0) * 0.7, -2.6, 2.6);
  const ty = rnd(2.5, 3.1);
  ball.v.copy(shotVelocity(ball.p, tx, ty, 8.5 + (sw.power || 0.5) * 2));
  game.rally = { last: game.server, front: false, bounces: 0, serve: true };
  game.state = 'rally'; game.timer = 0; game.hitCount = 0;
  ball.color.set(s.accent);
  onHitFx(s, 0.6);
  predict();
  if (!game.demo) hideBanner();
}

function canHit(p) {
  if (game.state !== 'rally' || turnIdx() !== p.idx) return false;
  if (!game.rally.front || game.rally.bounces > 1) return false;
  return inReach(p, p.control === 'pose' ? (settings.assist === 'mild' ? 1.5 : 1.3) : 1.2);
}
function hitCenter(p) { return { x: p.x + 0.45, z: p.z - 0.25 }; }
function inReach(p, reach) {
  const c = hitCenter(p);
  const d = Math.hypot(ball.p.x - c.x, ball.p.z - c.z);
  return d < reach && ball.p.y > 0.04 && ball.p.y < 2.5;
}

function executeHit(p, sw, quality) {
  const lob = sw.lift > 0.45;
  const power = clamp(sw.power, 0, 1);
  const err = (1 - quality) * 0.55;
  const aim = clamp(sw.aim, -1, 1);
  let tx = clamp(aim * 2.5 + rnd(-err, err), -2.9, 2.9);
  let ty, hs;
  if (lob) { ty = rnd(3.5, 4.1) + rnd(-err, err) * 0.5; hs = 7 + power; }
  else { ty = 0.72 + (1 - power) * 0.75 + rnd(-err, err) * 0.6; hs = 10.5 + power * 6; }
  if (sw.lift < -0.55 && power > 0.6) ty -= 0.15; // smeč dolů = kraťas, riskuje plech
  ball.v.copy(shotVelocity(ball.p, tx, ty, hs));
  game.rally = { last: p.idx, front: false, bounces: 0, serve: false };
  game.hitCount++;
  ball.color.set(p.accent);
  onHitFx(p, power);
  if (power > 0.8 && !lob) { // tvrdý úder: zpomalení + ohnivý míček
    ball.color.set(0xff7a1a);
    game.slow = 0.3; game.slowT = 0.22;
    burst(ball.p, 0xffb040, 50, 7);
    game.shake = 0.14;
    if (!game.demo) flash();
  }
  predict();
}

function onHitFx(p, power) {
  p.swingT = 0;
  burst(ball.p, p.accent, 26 + power * 30, 3 + power * 4);
  sfx.hit(power);
  game.shake = Math.max(game.shake, 0.04 + power * 0.06);
}

function flash() { const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function pointTo(winner, reason) {
  if (game.state !== 'rally') return;
  const w = players[winner];
  (window.__log = window.__log || []).push([reason, winner, game.hitCount]);
  game.state = 'point'; game.timer = 0;
  w.score++;
  if (winner === game.server) game.side = -game.side; else { game.server = winner; game.side = 1; }
  const over = w.score >= game.target && w.score - players[1 - winner].score >= 2;
  game.slow = 0.28; game.slowT = 0.9;
  for (let k = 0; k < 4; k++) burst(new THREE.Vector3(rnd(-2.5, 2.5), rnd(3, 5), rnd(0.5, 4)), k % 2 ? 0xffffff : w.accent, 40, 5);
  sfx.point(over);
  if (!game.demo) banner(reason, '#fff', `BOD PRO ${w.name}`, w.css);
  game.over = over ? winner : -1;
  updateHUD(true);
}

// ---------- fyzika ----------
function physStep(dt) {
  const prevState = game.state;
  ball.v.y -= G * dt;
  ball.v.multiplyScalar(1 - DRAG * dt);
  ball.p.addScaledVector(ball.v, dt);
  const ev = [];
  if (ball.p.z < R && ball.v.z < 0) { ball.p.z = R; ball.v.z *= -E_WALL; ball.v.x *= 0.92; ball.v.y *= 0.92; ev.push(['front', new THREE.Vector3(0, 0, 1)]); }
  if (ball.p.z > L - R && ball.v.z > 0) { ball.p.z = L - R; ball.v.z *= -E_WALL; ball.v.x *= 0.9; ev.push(['back', new THREE.Vector3(0, 0, -1)]); }
  if (ball.p.x < -HW + R && ball.v.x < 0) { ball.p.x = -HW + R; ball.v.x *= -E_WALL; ball.v.z *= 0.92; ev.push(['side', new THREE.Vector3(1, 0, 0)]); }
  if (ball.p.x > HW - R && ball.v.x > 0) { ball.p.x = HW - R; ball.v.x *= -E_WALL; ball.v.z *= 0.92; ev.push(['side', new THREE.Vector3(-1, 0, 0)]); }
  if (ball.p.y > H - R && ball.v.y > 0) { ball.p.y = H - R; ball.v.y *= -0.5; ev.push(['ceil', new THREE.Vector3(0, -1, 0)]); }
  if (ball.p.y < R && ball.v.y < 0) {
    ball.p.y = R; ball.v.y *= -E_FLOOR; ball.v.x *= 0.86; ball.v.z *= 0.86;
    if (Math.abs(ball.v.y) < 0.4) ball.v.y = 0;
    ev.push(['floor', new THREE.Vector3(0, 1, 0)]);
  }
  for (const [type, n] of ev) {
    const sp = ball.v.length();
    if (type === 'floor') { if (sp > 1) sfx.floor(sp); }
    else { sfx.wall(sp); if (sp > 2) { wallMark(ball.p, n, ball.color); burst(ball.p, ball.color, 10, 2); } }
    if (prevState === 'rally') rules(type);
  }
  if (ev.length && game.state === 'rally') predict();
}

function rules(type) {
  const r = game.rally, y = ball.p.y, z = ball.p.z;
  const striker = r.last, receiver = 1 - r.last;
  if (type === 'front') {
    if (r.front) return;
    if (y < TIN) return pointTo(receiver, 'PLECH!');
    if (y > OUT_FRONT) return pointTo(receiver, 'AUT!');
    if (r.serve && y < SERVICE) return pointTo(receiver, 'ŠPATNÉ PODÁNÍ');
    r.front = true; r.bounces = 0; r.serve = false;
  } else if (type === 'side') {
    if (y > lerp(OUT_FRONT, OUT_BACK, z / L)) return pointTo(receiver, 'AUT!');
  } else if (type === 'back') {
    if (y > OUT_BACK) return pointTo(receiver, 'AUT!');
  } else if (type === 'ceil') {
    return pointTo(receiver, 'AUT!');
  } else if (type === 'floor') {
    if (!r.front) return pointTo(receiver, 'NEDOLETĚL NA STĚNU');
    r.bounces++;
    if (r.bounces >= 2) return pointTo(striker, 'DVA ODSKOKY');
  }
}

// předpověď, kde bude míček k odehrání
function predict() {
  const p = ball.p.clone(), v = ball.v.clone();
  let front = game.rally.front, bounces = game.rally.bounces;
  const dt = 1 / 120;
  let best = null;
  for (let t = 0; t < 4; t += dt) {
    v.y -= G * dt; v.multiplyScalar(1 - DRAG * dt); p.addScaledVector(v, dt);
    if (p.z < R && v.z < 0) { p.z = R; v.z *= -E_WALL; v.x *= 0.92; v.y *= 0.92; front = true; bounces = 0; }
    if (p.z > L - R && v.z > 0) { p.z = L - R; v.z *= -E_WALL; v.x *= 0.9; }
    if (Math.abs(p.x) > HW - R && Math.sign(v.x) === Math.sign(p.x)) { p.x = Math.sign(p.x) * (HW - R); v.x *= -E_WALL; v.z *= 0.92; }
    if (p.y < R && v.y < 0) {
      p.y = R; v.y *= -E_FLOOR; v.x *= 0.86; v.z *= 0.86;
      if (front) bounces++;
      if (bounces >= 2) { best = best || { x: p.x, z: p.z, t }; break; }
    }
    if (front && !best) {
      const volley = bounces === 0 && v.z > 0 && p.z > 6.2 && p.y < 1.9 && p.y > 0.7;
      const after = bounces === 1 && v.y < 0 && p.y < 1.05;
      if (volley || after || (bounces === 1 && p.z > L - 0.4)) { best = { x: p.x, z: p.z, t }; break; }
    }
  }
  game.pred = best;
}

// ---------- ovládání: švihy ----------
function onSwing(pi, sw) {
  const p = players[pi];
  p.swingT = 0; p.swingDir = sw.aim >= 0 ? 1 : -1;
  sw.t = performance.now() / 1000;
  if (game.state === 'calib') { poseState.players[pi].calSwing = true; return; }
  if (game.state === 'serve' && pi === game.server && game.timer > 0.5) return doServe(sw);
  if (game.state === 'rally') p.pending = sw;
}

function tryPendingHits() {
  const now = performance.now() / 1000;
  for (const p of players) {
    if (!p.pending) continue;
    const age = now - p.pending.t;
    if (age > 0.4) { p.pending = null; continue; }
    if (canHit(p)) {
      const c = hitCenter(p);
      const d = Math.hypot(ball.p.x - c.x, ball.p.z - c.z);
      const quality = clamp(1 - d * 0.35 - age * 0.6, 0.2, 1);
      executeHit(p, p.pending, quality);
      p.pending = null;
    }
  }
}

function cpuThink(p, dt) {
  const t = game.pred;
  const target = t && turnIdx() === p.idx ? t.x - 0.45 : (p.idx ? 1.2 : -1.2);
  p.inX = lerp(p.inX, target + p.cpuErr, clamp(dt * 3.5, 0, 1));
  if (game.state === 'serve' && game.server === p.idx && game.timer > 1.1) {
    onSwing(p.idx, { aim: rnd(-0.6, 0.6), lift: 0, power: rnd(0.4, 0.9) });
  }
  if (canHit(p)) {
    const c = hitCenter(p);
    const d = Math.hypot(ball.p.x - c.x, ball.p.z - c.z);
    if (d < 0.75 || ball.p.y < 0.35) {
      const skill = game.demo ? 0.97 : 0.9;
      if (Math.random() < skill) {
        const sw = { aim: rnd(-1, 1), lift: Math.random() < 0.2 ? 0.8 : rnd(-0.4, 0.3), power: rnd(0.35, 0.95) };
        p.swingT = 0;
        executeHit(p, sw, game.demo ? 0.9 : rnd(0.6, 1));
      } else p.cpuErr = rnd(-1.5, 1.5);
    }
  }
  if (game.state === 'rally' && turnIdx() !== p.idx) p.cpuErr = rnd(-0.25, 0.25);
}

// klávesnice / TV ovladač
const keys = {};
window.addEventListener('keydown', (e) => {
  if (keys[e.code]) return; keys[e.code] = true;
  const kp = (pi, lift) => players[pi].control === 'keys' && onSwing(pi, { aim: players[pi].keyDir * 0.8, lift, power: 0.75 });
  if (e.code === 'KeyS') kp(0, 0);
  if (e.code === 'KeyW') kp(0, 0.9);
  if (e.code === 'ArrowDown') kp(1, 0);
  if (e.code === 'ArrowUp') kp(1, 0.9);
  if (e.code === 'Escape' && game.state !== 'demo') showMenu();
});
window.addEventListener('keyup', (e) => (keys[e.code] = false));

// ---------- pohyb hráčů ----------
function movePlayers(dt) {
    for (const p of players) {
    if (p.control === 'keys') {
      const k = p.idx === 0 ? [keys.KeyA, keys.KeyD] : [keys.ArrowLeft, keys.ArrowRight];
      p.keyDir = (k[1] ? 1 : 0) - (k[0] ? 1 : 0);
      p.inX = clamp(p.inX + p.keyDir * 5 * dt, -2.9, 2.9);
    }
    const myTurn = game.state === 'rally' && turnIdx() === p.idx;
    let tx = p.inX, tz = 5.9;
    if (p.control === 'pose') {
      // skutečný pohyb: kde stojíš před kamerou, tam je postava na kurtu
      const ps = poseState.players[p.idx];
      if (ps.seen) { p.inX = ps.courtX; p.inZ = ps.courtZ ?? 5.8; }
      tx = p.inX; tz = p.inZ ?? 5.8;
      if (ps.arm) {
        const A = ps.arm, w = (o) => new THREE.Vector3(o.x, o.y, o.z);
        p.arm = { rU: w(A.rU), rF: w(A.rF), lU: w(A.lU), lF: w(A.lF) };
      }
      if (settings.assist === 'mild' && myTurn && game.pred) { tx = lerp(tx, game.pred.x - 0.45, 0.3); tz = lerp(tz, game.pred.z + 0.3, 0.3); }
    } else {
      if (p.control === 'cpu') cpuThink(p, dt);
      tx = p.inX;
      if (myTurn && game.pred) {
        tz = clamp(game.pred.z + 0.3, 2.2, 9.3);
        if (p.control === 'keys') tx = lerp(p.inX, game.pred.x - 0.45, 0.5);
      }
      if (game.state === 'serve') { tz = p.z; tx = p.x; }
    }
    const maxV = p.control === 'pose' ? 9 : 6.5;
    const ax = clamp((tx - p.x) * 7, -maxV, maxV), az = clamp((tz - p.z) * 5, -maxV, maxV);
    p.vx = ax; p.vz = az;
    p.x = clamp(p.x + ax * dt, -HW + 0.35, HW - 0.35);
    p.z = clamp(p.z + az * dt, 1.0, L - 0.35);
  }
  // nepřekrývat se
  const a = players[0], b = players[1];
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  if (d < 0.75 && d > 0.0001) {
    const push = (0.75 - d) / 2, nx = dx / d, nz = dz / d;
    const t = turnIdx();
    const wa = game.state === 'rally' ? (t === 0 ? 0.2 : 1.8) : 1, wb = 2 - wa;
    a.x -= nx * push * wa; a.z -= nz * push * wa; b.x += nx * push * wb; b.z += nz * push * wb;
  }
}

function animatePlayers(dt) {
  for (const p of players) {
    p.swingT += dt;
    const myTurn = (game.state === 'rally' && turnIdx() === p.idx) || (game.state === 'serve' && game.server === p.idx);
    p.ready = myTurn; p.turn = myTurn; p.isPose = p.control === 'pose';
    animatePlayer(p.avatar, p, dt);
  }
}

// ---------- HUD ----------
function updateHUD(flash) {
  const [a, b] = players;
  $('s0').textContent = a.score; $('s1').textContent = b.score;
  drawBoard(a.score, b.score, game.server);
  $('srv0').style.opacity = game.server === 0 ? 1 : 0;
  $('srv1').style.opacity = game.server === 1 ? 1 : 0;
  if (flash) { const el = $('score'); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}
let bannerTimer = 0;
function banner(text, color, sub = '', subColor = '#fff') {
  const el = $('banner');
  $('bannerText').textContent = text; $('bannerText').style.color = color;
  $('bannerSub').textContent = sub; $('bannerSub').style.color = subColor;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  bannerTimer = 0;
}
function hideBanner() { $('banner').classList.remove('show'); }

// ---------- menu & průběh ----------
function showMenu() {
  game.demo = true; game.state = 'serve'; game.target = 99;
  players.forEach((p) => (p.control = 'cpu'));
  resetScores(); setupServe();
  document.body.className = 'menu';
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden'); $('calib').classList.add('hidden'); $('over').classList.add('hidden');
  hideBanner();
  setTimeout(() => $('menu').querySelector('button')?.focus(), 50);
}

async function startMatch(mode) {
  initAudio();
  $('menu').classList.add('hidden');
  game.demo = false; game.target = settings.target;
  if (mode === 'keys') players.forEach((p) => (p.control = 'keys'));
  else if (mode === 'solo') { players[0].control = 'pose'; players[1].control = 'cpu'; }
  else players.forEach((p) => (p.control = 'pose'));
  poseState.solo = mode === 'solo';
  resetScores();
  document.body.className = 'play';
  $('hud').classList.remove('hidden');
  if (mode === 'keys') { countdown(); return; }
  $('calib').classList.remove('hidden');
  $('calibMsg').textContent = 'Spouštím kameru…';
  try {
    await startCamera(settings.camera);
    $('calibMsg').textContent = 'Načítám rozpoznávání postavy…';
    await initPose();
    startCalibration();
  } catch (err) {
    console.error(err);
    $('calibMsg').innerHTML = `Kamera nejde spustit 😕<br><small>${err && err.message ? err.message : err}</small><br>Povol kameru, nebo hraj na klávesnici.`;
  }
}

function countdown() {
  $('calib').classList.add('hidden');
  game.state = 'countdown'; game.timer = 0;
  players.forEach((p, i) => { p.x = p.inX = i ? 1.4 : -1.4; p.z = 6.3; });
}

// kalibrace těla před každou hrou (bez ní se hra nespustí)
const CAL_STEPS = [
  { id: 'stand', title: 'VÝCHOZÍ POZICE', hold: 1.2,
    text: (solo) => solo ? 'Stoupni si 2–3 m od mobilu, <b>celá postava v záběru</b> (i nohy). Pak <b>zvedni obě ruce nad hlavu</b>.'
      : 'Stoupněte si <b>vedle sebe</b> 2–3 m od mobilu – MODRÝ vlevo, ČERVENÝ vpravo. <b>Celé postavy v záběru</b>, pak <b>ruce nad hlavu</b>.',
    ok: (ps) => ps.full && ps.handsUp, hint: (ps) => !ps.full ? 'nevidím celou postavu' : 'zvedni ruce' },
  { id: 'fwd', title: 'KROK DOPŘEDU', hold: 1.0,
    text: () => 'Udělejte <b>velký krok ke kameře</b> (to je dopředu ke stěně) a <b>zvedněte ruce</b>.',
    ok: (ps) => ps.handsUp && ps.cal && ps.torso > ps.cal.base * 1.05, hint: (ps) => ps.cal && ps.torso <= ps.cal.base * 1.05 ? 'víc dopředu' : 'zvedni ruce' },
  { id: 'back', title: 'KROK DOZADU', hold: 1.0,
    text: () => 'Teď <b>dva kroky dozadu</b> od kamery (dozadu na kurtu), <b>ruce nahoru</b>.',
    ok: (ps) => ps.handsUp && ps.cal && ps.torso < ps.cal.base * 0.96, hint: (ps) => ps.cal && ps.torso >= ps.cal.base * 0.96 ? 'víc dozadu' : 'zvedni ruce' },
  { id: 'swing', title: 'ZKUŠEBNÍ ÚDER', hold: 0,
    text: () => 'Vraťte se doprostřed a <b>rychle máchněte pravou rukou</b> jako raketou.',
    ok: (ps) => ps.calSwing, hint: () => 'máchni rukou' },
];
function startCalibration() {
  resetCalibration();
  game.state = 'calib'; game.calStep = 0;
  for (const ps of poseState.players) { ps.stepT = 0; ps.stepDone = false; ps.calSwing = false; }
  document.body.classList.add('calib');
  $('calib').classList.remove('hidden');
  showCalStep();
}
function showCalStep() {
  const st = CAL_STEPS[game.calStep];
  $('calStep').textContent = `KALIBRACE ${game.calStep + 1}/${CAL_STEPS.length} · ${st.title}`;
  $('calibMsg').innerHTML = st.text(poseState.solo);
  for (const ps of poseState.players) { ps.stepT = 0; ps.stepDone = false; ps.calSwing = false; }
}
function calibStep(dt) {
  const need = poseState.solo ? [0] : [0, 1];
  const st = CAL_STEPS[game.calStep];
  let all = true;
  for (const i of [0, 1]) {
    const ps = poseState.players[i], el = $('cal' + i);
    if (!need.includes(i)) { el.style.display = 'none'; continue; }
    el.style.display = '';
    if (!ps.stepDone) {
      const ok = ps.seen && st.ok(ps);
      ps.stepT = ok ? ps.stepT + dt : Math.max(0, ps.stepT - dt * 2);
      if (ok && ps.stepT >= st.hold) {
        ps.stepDone = true;
        if (st.id !== 'swing') calibrate(i, st.id);
        sfx.beep(660 + i * 220);
      }
    }
    const prog = ps.stepDone ? 1 : st.hold ? ps.stepT / st.hold : 0;
    el.className = 'calp' + (ps.seen ? ' seen' : '') + (ps.stepDone ? ' ready' : '');
    el.querySelector('.st').textContent = !ps.seen ? 'nevidím tě' : ps.stepDone ? 'HOTOVO ✓' : st.hint(ps);
    el.querySelector('.bar i').style.width = (prog * 100).toFixed(0) + '%';
    if (!ps.stepDone) all = false;
  }
  if (all) {
    game.calStep++;
    if (game.calStep >= CAL_STEPS.length) {
      sfx.point(false);
      document.body.classList.remove('calib');
      countdown();
    } else { sfx.beep(990); showCalStep(); }
  }
}

// ---------- hlavní smyčka ----------
const clock = new THREE.Clock();
let acc = 0, lastCd = -1, menuAngle = 0;
const camPos = new THREE.Vector3(0, 4.4, 14.6), camLook = new THREE.Vector3(0, 1.5, 3.3);

function frame() {
  requestAnimationFrame(frame);
  const rdt = Math.min(clock.getDelta(), 0.05) * TEST_SPEED;

  if (poseState.ready) {
    const swings = detectPoses();
    if (!game.demo) for (const s of swings) if (players[s.player].control === 'pose') onSwing(s.player, s);
  }

  if (game.slowT > 0) { game.slowT -= rdt; if (game.slowT <= 0) game.slow = 1; }
  const dt = rdt * settings.speed * (game.slowT > 0 ? game.slow : 1);
  game.timer += rdt;

  if (game.state === 'calib') calibStep(rdt);
  if (game.state === 'countdown') {
    const n = 3 - Math.floor(game.timer);
    if (n !== lastCd) { lastCd = n; if (n > 0) { banner(String(n), '#fff'); sfx.beep(520); } }
    if (game.timer >= 3) { lastCd = -1; sfx.beep(1040); game.server = 0; game.side = 1; setupServe(); }
  }
  if (game.state === 'serve') {
    placeBallForServe();
    if (game.timer > 9 && !game.demo) doServe({ aim: 0, power: 0.5 }); // automatické podání
  }
  if (game.state === 'rally' || game.state === 'point') {
    acc += dt;
    const step = 1 / 240;
    while (acc >= step) { physStep(step); if (game.state === 'rally') tryPendingHits(); acc -= step; }
  }
  if (game.state === 'point' && game.timer > 2.2) {
    if (game.over >= 0 && !game.demo) gameOver(game.over);
    else { if (game.demo && Math.max(players[0].score, players[1].score) > 20) resetScores(); setupServe(); }
  }
  if (['serve', 'rally', 'point', 'countdown', 'calib', 'over'].includes(game.state)) movePlayers(dt);
  if (game.state === 'over') {
    const all = players.filter((p) => p.control === 'pose');
    if (all.length && all.every((p) => poseState.players[p.idx].handsUp)) { game.overT = (game.overT || 0) + rdt; if (game.overT > 1) rematch(); }
    else game.overT = 0;
  }
  animatePlayers(dt);
  renderFx(dt, rdt);

  // kamera
  if (game.demo) {
    menuAngle += rdt * 0.15;
    camera.position.set(Math.sin(menuAngle) * 2.6, 3.6 + Math.sin(menuAngle * 0.7) * 1.2, 12.2 + Math.cos(menuAngle * 0.5) * 2);
    camera.lookAt(ball.p.x * 0.3, 1.4, 3.8);
  } else {
    const tgt = camPos.clone(), look = camLook.clone();
    if (game.state === 'rally' || game.state === 'point') { tgt.x = ball.p.x * 0.22; look.x = ball.p.x * 0.3; }
    if (game.state === 'point') { tgt.lerp(new THREE.Vector3(ball.p.x * 0.6, 3.2, 12), 0.35); }
    camera.position.lerp(tgt, clamp(rdt * 2.5, 0, 1));
    camera.lookAt(look);
    if (game.shake > 0) {
      camera.position.x += rnd(-1, 1) * game.shake; camera.position.y += rnd(-1, 1) * game.shake;
      game.shake = Math.max(0, game.shake - rdt * 0.4);
    }
  }
  if (window.__closeup) { const q = players[0]; camera.position.set(q.x + 1.6, 1.5, q.z + 2.0); camera.lookAt(q.x, 1.0, q.z); }
  if (bloom.enabled) composer.render(); else renderer.render(scene, camera);
  drawPreview($('cam'), COLORS.map((c) => c.css), players.map((p) => p.control === 'pose'));
}

const tmpM = new THREE.Matrix4();
function renderFx(dt, rdt) {
  const showT = !game.demo && game.state === 'rally' && game.pred && game.rally.front;
  tmMat.opacity = lerp(tmMat.opacity, showT ? 0.9 : 0, clamp(rdt * 8, 0, 1));
  if (game.pred) {
    targetMk.position.x = lerp(targetMk.position.x, game.pred.x, clamp(rdt * 12, 0, 1));
    targetMk.position.z = lerp(targetMk.position.z, game.pred.z, clamp(rdt * 12, 0, 1));
    tmMat.color.set(players[turnIdx()].accent).multiplyScalar(3);
    targetMk.scale.setScalar(1 + Math.sin(performance.now() / 120) * 0.12);
  }
  // počítadlo výměny
  const rc = $('rally');
  if (!game.demo && game.state === 'rally' && game.hitCount >= 3) {
    rc.textContent = (game.hitCount >= 10 ? '🔥 ' : '') + 'VÝMĚNA ' + game.hitCount;
    rc.classList.add('on'); rc.classList.toggle('hot', game.hitCount >= 10);
  } else if (game.state !== 'point') rc.classList.remove('on');
  const tt = performance.now() / 1000;
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3 + 1] += Math.sin(tt * 0.3 + i) * 0.0015 - 0.0006;
    dustPos[i * 3] += Math.cos(tt * 0.2 + i * 1.7) * 0.001;
    if (dustPos[i * 3 + 1] < 0.1) dustPos[i * 3 + 1] = H;
  }
  dustGeo.attributes.position.needsUpdate = true;
  ballMesh.position.copy(ball.p);
  ballMat.emissive.copy(ball.color);
  ballLight.position.copy(ball.p); ballLight.color.copy(ball.color);
  blob.position.x = ball.p.x; blob.position.z = ball.p.z;
  const hgt = clamp(ball.p.y / 3, 0, 1);
  blob.scale.setScalar(1 + hgt * 1.5); blob.material.opacity = 0.5 * (1 - hgt * 0.7);
  trailPts.pop(); trailPts.unshift(ball.p.clone());
  const moving = ball.v.lengthSq() > 4;
  for (let i = 0; i < TRAIL; i++) {
    const s = moving ? (1 - i / TRAIL) * 0.95 : 0.0001;
    tmpM.makeScale(s, s, s).setPosition(trailPts[i]);
    trail.setMatrixAt(i, tmpM);
  }
  trail.instanceMatrix.needsUpdate = true;
  trailMat.color.copy(ball.color).multiplyScalar(4);
  for (let i = 0; i < PCOUNT; i++) {
    const p = parts[i];
    if (p.life <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; }
    p.life -= rdt; p.v.y -= 6 * rdt;
    pPos[i * 3] += p.v.x * rdt; pPos[i * 3 + 1] += p.v.y * rdt; pPos[i * 3 + 2] += p.v.z * rdt;
    const k = Math.max(0, p.life / p.max) * 1.5;
    pCol[i * 3] = p.c.r * k; pCol[i * 3 + 1] = p.c.g * k; pCol[i * 3 + 2] = p.c.b * k;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  for (const m of marks) {
    if (m.userData.life <= 0) { m.material.opacity = 0; continue; }
    m.userData.life -= rdt;
    m.material.opacity = clamp(m.userData.life, 0, 1) * 0.9;
    m.scale.setScalar(lerp(m.scale.x, 1, rdt * 10));
  }
  // turn indikátor
  if (!game.demo && (game.state === 'rally' || game.state === 'serve')) {
    const t = game.state === 'serve' ? game.server : turnIdx();
    $('turn').textContent = `NA ŘADĚ: ${players[t].name}`; $('turn').style.color = players[t].css;
  } else $('turn').textContent = '';
}

function gameOver(w) {
  game.state = 'over'; game.overT = 0;
  const p = players[w];
  hideBanner();
  $('overTitle').textContent = `VYHRÁL ${p.name}!`; $('overTitle').style.color = p.css;
  $('overScore').textContent = `${players[0].score} : ${players[1].score}`;
  $('over').classList.remove('hidden');
  sfx.point(true);
  setTimeout(() => $('again').focus(), 50);
}
function rematch() {
  $('over').classList.add('hidden'); resetScores(); updateHUD();
  game.overT = 0;
  if (players.some((p) => p.control === 'pose')) startCalibration(); else countdown();
}

// ---------- UI ----------
function bindSetting(id, key, values, labels) {
  const el = $(id);
  const show = () => { el.querySelector('b').textContent = labels[values.indexOf(settings[key])] ?? labels[0]; };
  el.addEventListener('click', () => {
    const i = (values.indexOf(settings[key]) + 1) % values.length;
    settings[key] = values[i]; saveSettings(); show();
    if (key === 'quality') applyQuality();
  });
  show();
}
bindSetting('optSpeed', 'speed', [0.7, 0.85, 1.0], ['POMALÁ', 'NORMÁLNÍ', 'RYCHLÁ']);
bindSetting('optAssist', 'assist', ['off', 'mild'], ['VYPNUTÁ', 'MÍRNÁ']);
bindSetting('optQuality', 'quality', ['high', 'medium', 'low'], ['ULTRA', 'STŘEDNÍ', 'NÍZKÁ']);
bindSetting('optCamera', 'camera', ['user', 'environment'], ['PŘEDNÍ', 'ZADNÍ']);
bindSetting('optTarget', 'target', [11, 7, 15], ['11', '7', '15']);
$('play2').addEventListener('click', () => startMatch('duo'));
$('play1').addEventListener('click', () => startMatch('solo'));
$('playK').addEventListener('click', () => startMatch('keys'));
$('again').addEventListener('click', rematch);
$('toMenu').addEventListener('click', showMenu);
$('calibBack').addEventListener('click', () => { document.body.classList.remove('calib'); showMenu(); });
$('calibKeys').addEventListener('click', () => { document.body.classList.remove('calib'); players.forEach((p) => (p.control = 'keys')); countdown(); });
$('menuBtn').addEventListener('click', showMenu);

// D-pad navigace v menu (TV ovladač)
window.addEventListener('keydown', (e) => {
  const panel = ['menu', 'over', 'calib'].map($).find((el) => !el.classList.contains('hidden'));
  if (!panel) return;
  const btns = [...panel.querySelectorAll('button')];
  const i = btns.indexOf(document.activeElement);
  if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { btns[(i + 1) % btns.length].focus(); e.preventDefault(); }
  if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { btns[(i - 1 + btns.length) % btns.length].focus(); e.preventDefault(); }
});

applyQuality();
new GLTFLoader().load('./models/Xbot.glb', (gltf) => {
  makePlayers(gltf);
  $('loading').classList.add('hidden');
  showMenu();
  frame();
  if (params.get('auto') === 'keys') startMatch('keys');
  if (params.get('auto') === 'cpu') { startMatch('keys'); players.forEach((p) => (p.control = 'cpu')); }
}, undefined, (e) => { $('loading').textContent = 'Chyba načítání modelu: ' + e.message; });
const params = new URLSearchParams(location.search);
window.__game = { game, players, ball };
