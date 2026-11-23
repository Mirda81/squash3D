// Realistická postava hráče: rigovaný model s motion-capture animacemi (idle / chůze / běh / podřep)
// + procedurální švih raketou a kopírování skutečných paží z kamery.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => 1 - Math.pow(1 - k, 3);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function stringsTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
  for (let i = 8; i < 128; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  return new THREE.CanvasTexture(c);
}
const STRINGS = stringsTex();

function makeRacket(accent) {
  const racket = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161e, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 0.3, metalness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }); glow.color.multiplyScalar(6);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.2, 10), dark); grip.position.y = -0.02; racket.add(grip);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.2, 8), white); shaft.position.y = -0.21; racket.add(shaft);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.011, 10, 40), glow); frame.scale.set(0.95, 1.32, 1); frame.position.y = -0.43; racket.add(frame);
  const strings = new THREE.Mesh(new THREE.CircleGeometry(0.094, 32), new THREE.MeshBasicMaterial({ map: STRINGS, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  strings.scale.set(0.95, 1.32, 1); strings.position.y = -0.43; racket.add(strings);
  racket.traverse((o) => { if (o.isMesh && o !== strings) o.castShadow = true; });
  return racket;
}

// natočí kost tak, aby směr kost->dítě mířil daným směrem ve světě (nezávisle na osách rigu)
function aimBone(bone, child, dirWorld, w) {
  if (w <= 0) return;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q.setFromUnitVectors(cur, dirWorld);
  bone.getWorldQuaternion(_q2);
  _q.multiply(_q2); // cílová světová rotace
  bone.parent.getWorldQuaternion(_q3).invert();
  _q3.multiply(_q);
  bone.quaternion.slerp(_q3, w);
}
function twistBone(bone, angle) {
  if (!angle) return;
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(_q2);
  _q.setFromAxisAngle(UP, angle).multiply(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q));
}

export function makePlayer(scene, gltf, { suit, accent }) {
  const root = new THREE.Group(); scene.add(root);
  const model = SkeletonUtils.clone(gltf.scene);
  model.rotation.y = Math.PI; // model kouká na +z, hráč má koukat na přední stěnu (-z)
  root.add(model);
  const suitMat = new THREE.MeshPhysicalMaterial({ color: suit, roughness: 0.42, metalness: 0.05, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(accent), clearcoat: 0.35, clearcoatRoughness: 0.3 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.35, metalness: 0.6, emissive: accent, emissiveIntensity: 0.35 });
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    o.material = /joint/i.test(o.material.name) ? jointMat : suitMat;
  });
  const bone = (n) => model.getObjectByName('mixamorig' + n);
  const b = {
    hips: bone('Hips'), spine: bone('Spine1'), spine2: bone('Spine2'), head: bone('Head'),
    rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
    lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
  };
  const mixer = new THREE.AnimationMixer(model);
  const act = {};
  for (const [k, n] of [['idle', 'idle'], ['walk', 'walk'], ['run', 'run'], ['crouch', 'sneak_pose']]) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, n);
    act[k] = mixer.clipAction(clip); act[k].play(); act[k].setEffectiveWeight(k === 'idle' ? 1 : 0);
  }
  const racket = makeRacket(accent); scene.add(racket);

  const swish = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.045, 6, 48, Math.PI * 0.9),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  swish.material.color.multiplyScalar(2.5); swish.rotation.x = Math.PI / 2; swish.position.set(0.15, 1.15, -0.1); root.add(swish);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.014; root.add(ring);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; shadow.scale.set(1, 0.7, 1); root.add(shadow);

  return { root, model, b, mixer, act, racket, swish, ring, yaw: 0, crouch: 0, w: { idle: 1, walk: 0, run: 0, crouch: 0 },
    armU: V(0.6, -0.4, -0.5), armF: V(0.2, 0.9, -0.3), larmU: V(-0.5, -0.8, -0.2), larmF: V(-0.2, -0.5, -0.8) };
}

// klíčové pozice paže s raketou (lokálně: +x vpravo, +y nahoru, -z dopředu ke stěně)
const K = {
  readyU: V(0.65, -0.35, -0.45), readyF: V(0.15, 0.95, -0.2),
  backU: V(0.75, 0.45, 0.45), backF: V(-0.1, 0.85, 0.5),
  hitU: V(0.45, -0.35, -0.85), hitF: V(0.05, -0.05, -1),
  finU: V(-0.55, 0.05, -0.8), finF: V(-0.7, 0.6, -0.2),
};
const tmpU = new THREE.Vector3(), tmpF = new THREE.Vector3();
const slerpDir = (out, a, b, t) => out.copy(a).lerp(b, t).normalize();

// st: { x, z, vx, vz, swingT, ready, turn, isPose, arm: {rU, rF, lU, lF} | null }
export function animatePlayer(av, st, dt) {
  const k = (v) => clamp(dt * v, 0, 1);
  const sp = Math.hypot(st.vx, st.vz);
  const swinging = st.swingT < 0.42;

  // váhy animací
  const run = smooth(1.6, 3.6, sp), walk = clamp(sp / 1.4, 0, 1) * (1 - run);
  av.crouch = lerp(av.crouch, st.ready ? 1 : 0.15, k(5));
  const still = 1 - walk - run;
  const target = { idle: still * (1 - av.crouch * 0.85), crouch: still * av.crouch * 0.85, walk, run };
  for (const n in av.w) { av.w[n] = lerp(av.w[n], target[n], k(10)); av.act[n].setEffectiveWeight(av.w[n]); }
  av.act.run.timeScale = clamp(sp / 4.2, 0.7, 1.5);
  av.act.walk.timeScale = clamp(sp / 1.2, 0.6, 1.4);
  av.mixer.update(dt);

  // natočení: při běhu po směru pohybu, jinak čelem ke stěně
  let yawT = 0;
  if (sp > 1.6 && !swinging) yawT = clamp(Math.atan2(-st.vx, -st.vz), -1.9, 1.9);
  let dy = yawT - av.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  av.yaw += dy * k(swinging ? 18 : 9);
  av.root.position.set(st.x, 0, st.z);
  av.root.rotation.y = av.yaw;
  av.root.updateMatrixWorld(true);
  const toWorld = (v, out) => out.copy(v).applyQuaternion(av.root.quaternion);
  const b = av.b;

  // paže
  let wR = 0, wL = 0, twist = 0;
  if (st.isPose && st.arm) {
    // kopie skutečných paží z kamery (vyhlazená)
    av.armU.lerp(st.arm.rU, k(14)).normalize(); av.armF.lerp(st.arm.rF, k(14)).normalize();
    av.larmU.lerp(st.arm.lU, k(14)).normalize(); av.larmF.lerp(st.arm.lF, k(14)).normalize();
    tmpU.copy(av.armU); tmpF.copy(av.armF); wR = 0.95; wL = 0.85;
    twist = clamp(-st.arm.rU.x * 0.25, -0.4, 0.4);
    av.swish.material.opacity = swinging ? Math.sin((st.swingT / 0.42) * Math.PI) * 0.6 : 0;
  } else if (swinging) {
    const t = st.swingT / 0.42;
    const back = ease(clamp(t / 0.3, 0, 1)), fwd = ease(clamp((t - 0.3) / 0.4, 0, 1)), fin = ease(clamp((t - 0.62) / 0.38, 0, 1));
    if (t < 0.3) { slerpDir(tmpU, K.readyU, K.backU, back); slerpDir(tmpF, K.readyF, K.backF, back); }
    else if (t < 0.62) { slerpDir(tmpU, K.backU, K.hitU, fwd); slerpDir(tmpF, K.backF, K.hitF, fwd); }
    else { slerpDir(tmpU, K.hitU, K.finU, fin); slerpDir(tmpF, K.hitF, K.finF, fin); }
    twist = t < 0.3 ? -0.7 * back : lerp(-0.7, 0.6, clamp((t - 0.3) / 0.6, 0, 1));
    wR = 1;
    av.swish.material.opacity = Math.sin(clamp((t - 0.25) / 0.6, 0, 1) * Math.PI) * 0.75;
    av.swish.rotation.z = lerp(-0.8, 1.6, fwd);
  } else {
    tmpU.copy(K.readyU); tmpF.copy(K.readyF);
    wR = lerp(0.85, 0.45, run);
    av.swish.material.opacity = 0;
  }
  if (twist) { twistBone(b.spine, twist * 0.6); twistBone(b.spine2, twist * 0.4); }
  if (wR > 0) {
    aimBone(b.rArm, b.rFore, toWorld(tmpU, _a.clone()), wR);
    aimBone(b.rFore, b.rHand, toWorld(tmpF, _a.clone()), wR);
  }
  if (wL > 0) {
    aimBone(b.lArm, b.lFore, toWorld(av.larmU, _a.clone()), wL);
    aimBone(b.lFore, b.lHand, toWorld(av.larmF, _a.clone()), wL);
  }

  // raketa v pravé ruce, prodloužení předloktí
  av.model.updateMatrixWorld(true);
  const hand = b.rHand.getWorldPosition(new THREE.Vector3());
  const fore = b.rFore.getWorldPosition(new THREE.Vector3());
  const dir = hand.clone().sub(fore).normalize();
  const yAxis = dir.clone().negate();
  const fwdW = new THREE.Vector3(0, 0, -1).applyQuaternion(av.root.quaternion);
  let xAxis = new THREE.Vector3().crossVectors(yAxis, fwdW);
  if (xAxis.lengthSq() < 1e-4) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  av.racket.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  av.racket.position.copy(hand).addScaledVector(dir, 0.06);

  const on = st.turn;
  av.ring.material.opacity = lerp(av.ring.material.opacity, on ? 0.95 : 0.15, k(6));
  av.ring.scale.setScalar(on ? 1 + Math.sin(performance.now() / 150) * 0.08 : 0.85);
}
