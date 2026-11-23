// Rozpoznání 2 postav přes kameru (MediaPipe Pose Landmarker)
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_LOCAL = './models/pose_landmarker_lite.task';
const MODEL_REMOTE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const SWING_TH = 4.8;      // rychlost zápěstí v šířkách ramen za sekundu
const SWING_COOLDOWN = 0.45;

export const poseState = {
  ready: false, solo: false, video: null, landmarks: [],
  players: [0, 1].map(() => ({ seen: false, lastSeen: 0, hipX: null, courtX: 0, courtZ: null, lift: 0, handsUp: false, full: false, torso: 0, prev: null, lastSwing: 0, cal: null, arm: null })),
};
let landmarker = null, lastVideoTime = -1;

export async function startCamera(facing) {
  if (poseState.video) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Prohlížeč nepodporuje kameru');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  const v = document.createElement('video');
  v.playsInline = true; v.muted = true; v.srcObject = stream;
  await v.play();
  poseState.video = v;
}

export async function initPose() {
  if (landmarker) { poseState.ready = true; return; }
  const fileset = await FilesetResolver.forVisionTasks('./wasm');
  const opts = (modelAssetPath, delegate) => ({
    baseOptions: { modelAssetPath, delegate }, runningMode: 'VIDEO', numPoses: 2,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  const attempts = [[MODEL_LOCAL, 'GPU'], [MODEL_LOCAL, 'CPU'], [MODEL_REMOTE, 'GPU'], [MODEL_REMOTE, 'CPU']];
  let lastErr;
  for (const [m, d] of attempts) {
    try { landmarker = await PoseLandmarker.createFromOptions(fileset, opts(m, d)); break; }
    catch (e) { lastErr = e; console.warn('pose init fail', m, d, e); }
  }
  if (!landmarker) throw lastErr;
  poseState.ready = true;
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const map = (v, a, b, c, d) => c + (Math.min(Math.max((v - a) / (b - a), 0), 1)) * (d - c);

// vrací seznam švihů [{player, aim, lift, power}]
export function detectPoses() {
  const v = poseState.video;
  const out = [];
  if (!landmarker || !v || v.readyState < 2 || v.currentTime === lastVideoTime) return out;
  lastVideoTime = v.currentTime;
  const now = performance.now();
  let res;
  try { res = landmarker.detectForVideo(v, now); } catch (e) { return out; }
  const aspect = v.videoWidth / v.videoHeight || 16 / 9;
  // zrcadlení: x -> 1 - x (jako v zrcadle)
  const poses = (res.landmarks || []).map((lm) => {
    const m = lm.map((p) => ({ x: 1 - p.x, y: p.y, v: p.visibility ?? 1 }));
    const hip = mid(m[23], m[24]);
    const sw = Math.hypot((m[11].x - m[12].x) * aspect, m[11].y - m[12].y) || 0.1;
    return { m, hipX: hip.x, sw };
  });
  poseState.landmarks = poses;
  poses.sort((a, b) => a.hipX - b.hipX);

  const st = poseState.players;
  const assign = [null, null];
  if (poseState.solo) {
    if (poses.length) assign[0] = poses.reduce((a, b) => (b.sw > a.sw ? b : a));
  } else if (poses.length >= 2) { assign[0] = poses[0]; assign[1] = poses[poses.length - 1]; }
  else if (poses.length === 1) {
    const p = poses[0];
    let who = p.hipX < 0.5 ? 0 : 1;
    if (st[0].hipX != null && st[1].hipX != null) who = Math.abs(st[0].hipX - p.hipX) < Math.abs(st[1].hipX - p.hipX) ? 0 : 1;
    assign[who] = p;
  }

  for (let i = 0; i < 2; i++) {
    const s = st[i], p = assign[i];
    if (!p) { if (now - s.lastSeen > 600) { s.seen = false; s.prev = null; } continue; }
    s.seen = true; s.lastSeen = now; s.hipX = p.hipX; s.pose = p;
    const m = p.m;
    // velikost trupu (rameno-kyčel) = vzdálenost od kamery
    const shM = mid(m[11], m[12]), hpM = mid(m[23], m[24]);
    const torso = Math.hypot((shM.x - hpM.x) * aspect, shM.y - hpM.y);
    s.torso = s.torso ? s.torso + (torso - s.torso) * 0.35 : torso;
    s.hipS = s.hipS == null ? p.hipX : s.hipS + (p.hipX - s.hipS) * 0.5;
    const inFrame = (k) => m[k].v > 0.5 && m[k].y > 0.01 && m[k].y < 0.99 && m[k].x > 0.01 && m[k].x < 0.99;
    s.full = [0, 11, 12, 23, 24, 27, 28].every(inFrame);
    const c = s.cal;
    if (c) {
      s.courtX = Math.max(-2.9, Math.min(2.9, c.baseX + (s.hipS - c.cx) * c.gainX));
      const t = s.torso;
      const z = t >= c.base ? 5.8 - (t - c.base) / Math.max(c.fwd - c.base, 0.005) * 3.4
                            : 5.8 + (c.base - t) / Math.max(c.base - c.back, 0.005) * 3.0;
      s.courtZ = Math.max(1.6, Math.min(9.3, z));
    } else {
      s.courtX = poseState.solo ? map(p.hipX, 0.2, 0.8, -2.8, 2.8)
        : i === 0 ? map(p.hipX, 0.08, 0.48, -2.8, 2.8) : map(p.hipX, 0.52, 0.92, -2.8, 2.8);
      s.courtZ = null;
    }
    // směry paží pro avatara (zrcadleně: pravá ruka člověka = pravá ruka postavy)
    const dirv = (a, b) => { const x = (b.x - a.x) * aspect, y = -(b.y - a.y); const z = -0.35 * Math.hypot(x, y); const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };
    s.arm = { rU: dirv(m[12], m[14]), rF: dirv(m[14], m[16]), lU: dirv(m[11], m[13]), lF: dirv(m[13], m[15]) };
    const shY = (m[11].y + m[12].y) / 2;
    const wr = [m[15], m[16]];
    s.lift = Math.max((shY - wr[0].y) / p.sw, (shY - wr[1].y) / p.sw);
    s.handsUp = wr[0].y < m[0].y && wr[1].y < m[0].y && wr[0].v > 0.4 && wr[1].v > 0.4;

    const cur = wr.map((w) => ({ x: w.x * aspect, y: w.y, v: w.v }));
    if (s.prev) {
      const dt = Math.max((now - s.prev.t) / 1000, 1 / 60);
      let best = null;
      for (let k = 0; k < 2; k++) {
        if (cur[k].v < 0.45) continue;
        const vx = (cur[k].x - s.prev.w[k].x) / dt / p.sw, vy = (cur[k].y - s.prev.w[k].y) / dt / p.sw;
        const sp = Math.hypot(vx, vy);
        if (!best || sp > best.sp) best = { vx, vy, sp };
      }
      if (best && best.sp > SWING_TH && (now - s.lastSwing) / 1000 > SWING_COOLDOWN) {
        s.lastSwing = now;
        out.push({
          player: i,
          aim: Math.max(-1, Math.min(1, (best.vx / best.sp) * 1.4)),
          lift: -best.vy / best.sp,
          power: Math.max(0, Math.min(1, (best.sp - SWING_TH) / 9 + 0.25)),
        });
      }
    }
    s.prev = { t: now, w: cur };
  }
  return out;
}

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
export function drawPreview(canvas, colors, active) {
  const v = poseState.video;
  if (!v || !active.some(Boolean)) { canvas.style.display = 'none'; return; }
  canvas.style.display = 'block';
  const w = canvas.width = 320, h = canvas.height = 180;
  const g = canvas.getContext('2d');
  g.save(); g.translate(w, 0); g.scale(-1, 1); g.drawImage(v, 0, 0, w, h); g.restore();
  g.fillStyle = 'rgba(0,0,10,0.35)'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.25)'; if (!poseState.solo) g.fillRect(w / 2 - 1, 0, 2, h);
  for (let i = 0; i < 2; i++) {
    const p = poseState.players[i].seen && poseState.players[i].pose;
    if (!p) continue;
    g.strokeStyle = colors[i]; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath();
    for (const [a, b] of BONES) { g.moveTo(p.m[a].x * w, p.m[a].y * h); g.lineTo(p.m[b].x * w, p.m[b].y * h); }
    g.stroke();
    g.fillStyle = colors[i];
    for (const k of [15, 16]) { g.beginPath(); g.arc(p.m[k].x * w, p.m[k].y * h, 5, 0, 7); g.fill(); }
    g.beginPath(); g.arc(p.m[0].x * w, p.m[0].y * h, 7, 0, 7); g.fill();
  }
}

// kalibrace: zaznamená aktuální polohu hráče
export function calibrate(i, step) {
  const s = poseState.players[i];
  s.cal = s.cal || {};
  if (step === 'stand') {
    s.cal = { cx: s.hipS, base: s.torso, fwd: s.torso * 1.18, back: s.torso * 0.85, baseX: poseState.solo ? 0 : i ? 1.3 : -1.3, gainX: poseState.solo ? 9 : 14 };
  } else if (step === 'fwd') s.cal.fwd = Math.max(s.torso, s.cal.base * 1.04);
  else if (step === 'back') s.cal.back = Math.min(s.torso, s.cal.base * 0.97);
}
export function resetCalibration() { for (const s of poseState.players) s.cal = null; }
