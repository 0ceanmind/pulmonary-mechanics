/**
 * Water-seal (bell) spirometer with kymograph drum.
 * Procedural Three.js r160 module for the Pulmonary Mechanics deck.
 *
 *   import { mount } from './js/three/spirometer.js';
 *   const ctl = mount(container, { theme: 'dark', sequence: 'full' });
 *   ctl.start();
 *
 * Physics: exhaling into the mouthpiece fills the bell -> bell rises, counterweight + pen
 * descend; inhaling empties the bell -> bell sinks, pen rises. The pen therefore records
 * lung volume vs time (inspiration = upward deflection) on the rotating paper drum.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ------------------------------------------------------------------ tokens */
const TOKENS = {
  dark: {
    text: '#f5f5f7', text2: '#a1a1a6', blue: '#2997ff', cyan: '#64d2ff', green: '#30d158',
    pink: '#ff375f', orange: '#ff9f0a', purple: '#bf5af2', yellow: '#ffd60a', red: '#ff453a', tissue: '#ff8fa3',
  },
  light: {
    text: '#1d1d1f', text2: '#6e6e73', blue: '#0071e3', cyan: '#0a84c6', green: '#1f9d48',
    pink: '#e0254e', orange: '#d97a00', purple: '#9b3fd1', yellow: '#c9a400', red: '#d70015', tissue: '#e8657d',
  },
};

/** Guyton 15e static lung volumes (mL). */
export const VOLUMES = Object.freeze({
  RV: 1200, ERV: 1100, VT: 500, IRV: 3000, FRC: 2300, IC: 3500, VC: 4600, TLC: 5800,
});
const { RV, VT, FRC, TLC, VC } = VOLUMES;

/* Material look per theme (non-token, purely visual). */
const LOOK = {
  dark: {
    exposure: 1.0,
    slab: '#141416', slabRough: 0.5,
    structure: '#c3c6cc', structureRough: 0.3,
    hub: '#2c2c30',
    plastic: '#efeff2',
    paper: '#ece8de', gridMinor: 'rgba(28,44,72,0.075)', gridMajor: 'rgba(28,44,72,0.15)', fibre: 'rgba(70,58,36,',
    glass: { color: '#dfeaff', a: 0.025, f: 0.42, s: 1.0 },
    bell: { color: '#d3dce8', a: 0.035, f: 0.36, s: 1.0 },
    hose: { color: '#e9eef5', a: 0.05, f: 0.3, s: 0.9 },
    pipe: { color: '#eaf2ff', a: 0.03, f: 0.42, s: 1.0 },
    water: { a: 0.34, f: 0.26, surf: 0.34, tint: 0.26 },
    key: 2.7, rim: 2.4, fill: 0.55, hemi: 0.45,
    blob: 0.0, contact: 0.5,
    additive: true,
  },
  light: {
    exposure: 0.95,
    slab: '#e6e6eb', slabRough: 0.55,
    structure: '#666a72', structureRough: 0.34,
    hub: '#3a3a3e',
    plastic: '#aab0ba',
    paper: '#fbfaf6', gridMinor: 'rgba(28,44,72,0.07)', gridMajor: 'rgba(28,44,72,0.14)', fibre: 'rgba(70,58,36,',
    glass: { color: '#46536a', a: 0.04, f: 0.36, s: 0.6 },
    bell: { color: '#4a586c', a: 0.1, f: 0.42, s: 0.6 },
    hose: { color: '#5a687c', a: 0.1, f: 0.36, s: 0.6 },
    pipe: { color: '#4a586c', a: 0.05, f: 0.45, s: 0.6 },
    water: { a: 0.2, f: 0.32, surf: 0.26, tint: 0.95 },
    key: 2.6, rim: 1.6, fill: 0.7, hemi: 0.75,
    blob: 0.28, contact: 0.35,
    additive: false,
  },
};

/* ---------------------------------------------------------------- geometry */
// Scene units ~ decimetres. All motion derives from these constants.
const G = {
  tankX: -2.0, tankR: 1.05, tankBottom: 0.40, tankTop: 3.0, waterY: 2.66,
  bellR: 0.78, bellH: 2.5, bellLow: 0.58, travel: 1.8, bellEye: 0.1,
  pipeR: 0.075, pipeTop: 2.88,
  pulleyY: 5.45, rc: 0.31, pulleyR: 0.36,
  frameZ: -0.5, colX: -0.5,
  cwX: 2.55, cwR: 0.2, cwH: 0.56, cwEye: 0.36,
  drumX: 0.72, drumR: 0.82, drumY0: 1.6, drumH: 2.6,
  penLow: 2.0,
};
G.p1x = G.tankX + G.rc;
G.p2x = G.cwX - G.rc;
G.nibX = G.drumX + G.drumR; // pen contact (world x, z = 0)

const OMEGA = THREE.MathUtils.degToRad(7); // drum speed, rad per sequence-second
const PW = 2048, PH = 1024;                // paper canvas
const TRACE_W = 20;                         // trace stroke (paper px)
const SNAP_DUR = 0.7;                       // s, smoothing for discontinuities (reset / setSequence)

const bellBottomAt = (v) => G.bellLow + ((TLC - v) / VC) * G.travel; // ∝ volume in spirometer
const penYAt = (v) => G.penLow + ((v - RV) / VC) * G.travel;         // ∝ lung volume

/* ---------------------------------------------------------------- sequence */
function buildSequence(name) {
  const segs = [];
  let v = FRC;
  const add = (dur, to, phase, segment) => { segs.push({ dur, from: v, to, phase, segment }); v = to; };
  const tidal = (n, ti, te) => {
    for (let i = 0; i < n; i++) { add(ti, FRC + VT, 'insp', 'tidal'); add(te, FRC, 'exp', 'tidal'); }
  };
  if (name === 'tidal') {
    tidal(1, 1.6, 2.4); // period 4 s, repeated forever
  } else {
    tidal(3, 1.25, 1.75);
    add(2.4, TLC, 'insp', 'maxInsp');
    add(0.45, TLC, 'hold', 'maxInsp');
    add(3.2, RV, 'exp', 'maxExp');
    add(0.45, RV, 'hold', 'maxExp');
    add(1.8, FRC, 'insp', 'maxExp');
    tidal(3, 1.25, 1.75);
  }
  let t = 0;
  for (const s of segs) { s.t0 = t; t += s.dur; }
  return { name: name === 'tidal' ? 'tidal' : 'full', segs, total: t, endless: name === 'tidal' };
}

function evalSequence(seq, time, out) {
  let t = time;
  if (seq.endless) t = ((t % seq.total) + seq.total) % seq.total;
  else t = Math.min(Math.max(t, 0), seq.total);
  let s = seq.segs[seq.segs.length - 1];
  for (const g of seq.segs) { if (t < g.t0 + g.dur) { s = g; break; } }
  const x = Math.min(Math.max((t - s.t0) / s.dur, 0), 1);
  const e = 0.5 - 0.5 * Math.cos(Math.PI * x);
  out.v = s.from + (s.to - s.from) * e;
  out.phase = s.phase;
  out.segment = s.segment;
  return out;
}

/* ----------------------------------------------------------------- helpers */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const frac = (x) => x - Math.floor(x);

/**
 * Glass / acrylic / water look without a transmission pass (keeps the canvas transparent).
 * Premultiplied output: body tint scaled by a fresnel-driven alpha, reflections added on top,
 * so highlights stay bright on a black page and edges read on a white page.
 */
function makeGlass({ color = '#ffffff', a = 0.05, f = 0.4, s = 1, roughness = 0.06, side = THREE.FrontSide, env = 1.2, under = 1, grad = 0 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness, metalness: 0, side, transparent: true, depthWrite: false, envMapIntensity: env, ior: 1.5,
  });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const u = {
    uBodyA: { value: a }, uFres: { value: f }, uSpec: { value: s },
    uUnder: { value: under }, uGrad: { value: grad }, uWater: { value: new THREE.Vector2(G.tankBottom, G.waterY) },
  };
  m.userData.glass = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uBodyA;
        uniform float uFres;
        uniform float uSpec;
        uniform float uUnder;
        uniform float uGrad;
        uniform vec2 uWater;`)
      .replace('#include <opaque_fragment>', `
        float glNV = saturate( dot( normal, geometryViewDir ) );
        float glF = pow( 1.0 - glNV, 3.0 );
        float glA = saturate( uBodyA + uFres * glF );
        float glY = ( inverse( viewMatrix ) * vec4( - vViewPosition, 1.0 ) ).y;
        float glUnder = mix( 1.0, uUnder, smoothstep( uWater.y + 0.012, uWater.y - 0.025, glY ) );
        float glDepth = mix( 1.0, mix( 0.45, 1.0, smoothstep( uWater.x, uWater.y, glY ) ), uGrad );
        glA *= glUnder;
        gl_FragColor = vec4( totalDiffuse * glA * glDepth + totalSpecular * uSpec * glUnder * ( 0.45 + 0.55 * glF ), glA );
      `);
  };
  m.customProgramCacheKey = () => 'spiro-glass';
  return m;
}

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** TubeGeometry with breathing-hose corrugations. */
function corrugatedTube(curve, segs, radius, radial, pitch, amp) {
  const geo = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const pos = geo.attributes.position;
  const len = curve.getLength();
  const c = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, c);
    const w = Math.cos((u * len / pitch) * Math.PI * 2);
    const k = 1 + amp * Math.sign(w) * Math.pow(Math.abs(w), 0.6);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/* =================================================================== mount */
export function mount(container, options = {}) {
  const opts = Object.assign(
    { theme: 'dark', sequence: 'full', speed: 1, autoplay: true, loop: false, sway: true },
    options,
  );
  let theme = opts.theme === 'light' ? 'light' : 'dark';

  /* ---------- renderer */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, {
    position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', outline: 'none',
  });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envRT = pmrem.fromScene(room, 0.035);
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const target = new THREE.Vector3(-0.15, 2.82, 0.3);
  {
    const az = THREE.MathUtils.degToRad(24), el = THREE.MathUtils.degToRad(9);
    camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(16).add(target);
    camera.lookAt(target);
  }

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.45;
  controls.minPolarAngle = THREE.MathUtils.degToRad(58);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(92);
  controls.minAzimuthAngle = THREE.MathUtils.degToRad(-60);
  controls.maxAzimuthAngle = THREE.MathUtils.degToRad(75);
  let interacting = false, idleFor = 10;
  controls.addEventListener('start', () => { interacting = true; });
  controls.addEventListener('end', () => { interacting = false; idleFor = 0; });

  /* ---------- lights */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a40, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-3.6, 9.5, 6.8);
  key.target.position.set(-0.2, 2.2, 0.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4.6, right: 4.6, top: 4.4, bottom: -4.4, near: 2, far: 26 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  const rim = new THREE.DirectionalLight(0xe2ebff, 2.2);
  rim.position.set(5.5, 6.5, -6.5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(7, 2.5, 5);
  scene.add(hemi, key, key.target, rim, fill);

  /* ---------- rig (gentle sway) + model */
  const rig = new THREE.Group();
  const model = new THREE.Group();
  rig.add(model);
  scene.add(rig);

  /* ---------- materials */
  const M = {
    structure: new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.32 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xd8dbe0, metalness: 1, roughness: 0.27 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xf1f2f4, metalness: 1, roughness: 0.1 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd8b072, metalness: 1, roughness: 0.24 }),
    hub: new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.42 }),
    slab: new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
    plastic: new THREE.MeshPhysicalMaterial({ roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    ink: new THREE.MeshPhysicalMaterial({ roughness: 0.18, metalness: 0.1, clearcoat: 1, emissiveIntensity: 0.35 }),
    led: new THREE.MeshBasicMaterial({ toneMapped: false }),
    chainSteel: new THREE.MeshStandardMaterial({ color: 0xd2d5da, metalness: 1, roughness: 0.3 }),
  };
  M.aluFront = M.alu.clone();
  M.alu.side = THREE.DoubleSide;

  const glass = {
    tankBack: makeGlass({ side: THREE.BackSide }),
    tankFront: makeGlass({ side: THREE.FrontSide }),
    bellBack: makeGlass({ side: THREE.BackSide, roughness: 0.12, under: 0.3 }),
    bellFront: makeGlass({ side: THREE.FrontSide, roughness: 0.12, under: 0.3 }),
    pipe: makeGlass({ side: THREE.FrontSide, roughness: 0.08, under: 0.7 }),
    hoseBack: makeGlass({ side: THREE.BackSide, roughness: 0.22 }),
    hoseFront: makeGlass({ side: THREE.FrontSide, roughness: 0.22 }),
    waterBody: makeGlass({ side: THREE.FrontSide, roughness: 0.05, env: 1.4, grad: 1 }),
    waterSurf: makeGlass({ side: THREE.DoubleSide, roughness: 0.04, env: 1.6 }),
    waterInner: makeGlass({ side: THREE.DoubleSide, roughness: 0.05, env: 1.2 }),
  };

  /* ---------- paper (kymograph) */
  // The trace is inked into a 2D canvas (CanvasTexture). Only the small dirty rectangle the pen
  // touched each frame is re-uploaded (texSubImage2D) so the live pen costs ~nothing per frame.
  const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = PW; gridCanvas.height = PH;
  const gctx = ctx2d(gridCanvas);
  const paperCanvas = document.createElement('canvas');
  paperCanvas.width = PW; paperCanvas.height = PH;
  const pctx = ctx2d(paperCanvas);
  const paperTex = new THREE.CanvasTexture(paperCanvas);
  paperTex.colorSpace = THREE.SRGBColorSpace;
  paperTex.wrapS = THREE.RepeatWrapping;
  paperTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  M.paper = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.8, metalness: 0, envMapIntensity: 0.55 });

  function drawGrid() {
    const L = LOOK[theme];
    const g = gctx;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = L.paper;
    g.fillRect(0, 0, PW, PH);
    const rnd = mulberry32(11);
    for (let i = 0; i < 16000; i++) {
      g.fillStyle = L.fibre + (0.02 + rnd() * 0.035).toFixed(3) + ')';
      g.fillRect(rnd() * PW, rnd() * PH, 1 + rnd() * 3, 1);
    }
    g.lineCap = 'butt';
    g.strokeStyle = L.gridMinor; g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= PW; x += 32) { g.moveTo(x, 0); g.lineTo(x, PH); }
    for (let y = 0; y <= PH; y += 32) { g.moveTo(0, y); g.lineTo(PW, y); }
    g.stroke();
    g.strokeStyle = L.gridMajor; g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= PW; x += 128) { g.moveTo(x, 0); g.lineTo(x, PH); }
    for (let y = 0; y <= PH; y += 128) { g.moveTo(0, y); g.lineTo(PW, y); }
    g.stroke();
    // soft edge bands top & bottom
    const band = g.createLinearGradient(0, 0, 0, PH);
    band.addColorStop(0, 'rgba(0,0,0,0.10)');
    band.addColorStop(0.035, 'rgba(0,0,0,0)');
    band.addColorStop(0.965, 'rgba(0,0,0,0)');
    band.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = band;
    g.fillRect(0, 0, PW, PH);
  }

  const trace = { prevU: null, prevY: 0, erasedTo: 0, hist: [] };
  let paperFull = true;           // needs a full texture upload
  const dirty = [];               // x0,y0,x1,y1 rects (canvas px) awaiting partial upload
  const PAD = TRACE_W / 2 + 3;

  function strokeLine(x0, y0, x1, y1) {
    pctx.beginPath(); pctx.moveTo(x0, y0); pctx.lineTo(x1, y1); pctx.stroke();
    dirty.push(Math.min(x0, x1) - PAD, Math.min(y0, y1) - PAD, Math.max(x0, x1) + PAD, Math.max(y0, y1) + PAD);
  }
  function setInk() {
    pctx.strokeStyle = TOKENS[theme].blue;
    pctx.lineWidth = TRACE_W;
    pctx.lineCap = 'round';
    pctx.lineJoin = 'round';
  }
  function drawSeg(u0, y0, u1, y1) {
    const x1 = frac(u1) * PW;
    const x0 = x1 - (u1 - u0) * PW;
    strokeLine(x0, y0, x1, y1);
    if (x0 < PAD) strokeLine(x0 + PW, y0, x1 + PW, y1);
    if (x1 > PW - PAD) strokeLine(x0 - PW, y0, x1 - PW, y1);
  }
  function eraseRange(uA, uB) {
    const copy = (x, w) => {
      const xa = Math.max(0, Math.floor(x)), xb = Math.min(PW, Math.ceil(x + w));
      if (xb <= xa) return;
      pctx.drawImage(gridCanvas, xa, 0, xb - xa, PH, xa, 0, xb - xa, PH);
      dirty.push(xa, 0, xb, PH);
    };
    const a = frac(uA) * PW, w = Math.min(1, uB - uA) * PW;
    if (a + w <= PW) copy(a, w); else { copy(a, PW - a); copy(0, a + w - PW); }
  }
  function flushPaper() {
    if (paperFull) { paperTex.needsUpdate = true; paperFull = false; dirty.length = 0; return; }
    if (!dirty.length) return;
    const glTex = renderer.properties.get(paperTex).__webglTexture;
    if (!glTex) { paperTex.needsUpdate = true; dirty.length = 0; return; }
    const gl = renderer.getContext();
    renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // merge into at most a few rects
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rects = [];
    for (let i = 0; i < dirty.length; i += 4) {
      const a = Math.max(0, Math.floor(dirty[i])), b = Math.max(0, Math.floor(dirty[i + 1]));
      const c = Math.min(PW, Math.ceil(dirty[i + 2])), d = Math.min(PH, Math.ceil(dirty[i + 3]));
      if (c <= a || d <= b) continue;
      if (c - a > PW / 2) { rects.push([a, b, c, d]); continue; }
      if (x1 > -Infinity && (a > x1 + 64 || c < x0 - 64)) { rects.push([x0, y0, x1, y1]); x0 = y0 = Infinity; x1 = y1 = -Infinity; }
      x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    }
    if (x1 > x0) rects.push([x0, y0, x1, y1]);
    for (const [a, b, c, d] of rects) {
      const img = pctx.getImageData(a, b, c - a, d - b);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, a, PH - d, c - a, d - b, gl.RGBA, gl.UNSIGNED_BYTE, img);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    dirty.length = 0;
  }
  const paperU = () => 0.25 + (OMEGA * paperTime) / (Math.PI * 2);
  const penCanvasY = (y) => (1 - (y - G.drumY0) / G.drumH) * PH;

  function clearPaper() {
    pctx.globalCompositeOperation = 'source-over';
    pctx.drawImage(gridCanvas, 0, 0);
    trace.prevU = null;
    trace.hist.length = 0;
    trace.erasedTo = paperU() + 0.99;
    paperFull = true;
  }
  function redrawPaper() {
    drawGrid();
    pctx.drawImage(gridCanvas, 0, 0);
    setInk();
    const h = trace.hist;
    for (let i = 2; i < h.length; i += 2) drawSeg(h[i - 2], h[i - 1], h[i], h[i + 1]);
    if (h.length === 2) drawSeg(h[0] - 1e-6, h[1], h[0], h[1]);
    paperFull = true;
  }
  function penWrite(penY) {
    const U = paperU();
    const ahead = U + 0.07;
    if (ahead > trace.erasedTo) { eraseRange(trace.erasedTo, ahead); trace.erasedTo = ahead; }
    const y = penCanvasY(penY);
    setInk();
    if (trace.prevU === null) drawSeg(U - 1e-6, y, U, y);
    else drawSeg(trace.prevU, trace.prevY, U, y);
    trace.prevU = U; trace.prevY = y;
    const h = trace.hist;
    h.push(U, y);
    let cut = 0;
    while (cut < h.length && h[cut] < U - 0.92) cut += 2;
    if (cut) h.splice(0, cut);
  }

  /* ---------- build model */
  function mesh(geo, mat, { cast = true, receive = false, order = 0 } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    if (order) m.renderOrder = order;
    return m;
  }
  const along = (geo, axis) => { // cylinder default is along +y
    if (axis === 'x') geo.rotateZ(-Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    return geo;
  };

  // base slab
  const slab = mesh(new RoundedBoxGeometry(6.9, 0.16, 2.95, 5, 0.075), M.slab, { cast: false, receive: true });
  slab.position.set(-0.2, -0.08, 0.42);
  model.add(slab);

  // soft contact shadow under the slab + AO blobs on the slab
  const blobTex = radialTexture([[0, 'rgba(0,0,0,1)'], [0.45, 'rgba(0,0,0,0.55)'], [1, 'rgba(0,0,0,0)']]);
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.3 });
  const groundBlob = new THREE.Mesh(new THREE.PlaneGeometry(9.2, 4.6).rotateX(-Math.PI / 2), blobMat);
  groundBlob.position.set(-0.2, -0.165, 0.45);
  groundBlob.renderOrder = -1;
  model.add(groundBlob);
  const aoMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
  const addAO = (x, z, sx, sz) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2), aoMat);
    m.position.set(x, 0.002, z);
    model.add(m);
  };
  addAO(G.tankX, 0, 2.9, 2.9);
  addAO(G.drumX, 0, 1.7, 1.7);
  addAO(G.colX, G.frameZ, 0.7, 0.7);
  addAO(G.cwX, G.frameZ, 0.6, 0.6);

  /* tank + stand */
  const tank = new THREE.Group();
  tank.position.x = G.tankX;
  model.add(tank);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const leg = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.36, 20), M.structure);
    leg.position.set(Math.cos(a) * 0.86, 0.18, Math.sin(a) * 0.86);
    const foot = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.03, 24), M.structure);
    foot.position.set(Math.cos(a) * 0.86, 0.015, Math.sin(a) * 0.86);
    tank.add(leg, foot);
  }
  const cup = mesh(new THREE.CylinderGeometry(G.tankR + 0.035, G.tankR + 0.035, 0.24, 96, 1, true), M.aluFront);
  cup.position.y = 0.46;
  const cupLip = mesh(new THREE.TorusGeometry(G.tankR + 0.035, 0.02, 10, 96).rotateX(Math.PI / 2), M.alu);
  cupLip.position.y = 0.58;
  const plate = mesh(new THREE.RingGeometry(0.1, G.tankR + 0.035, 96, 1).rotateX(-Math.PI / 2), M.hub, { receive: true });
  plate.position.y = G.tankBottom;
  const plateUnder = mesh(new THREE.RingGeometry(0.1, G.tankR + 0.035, 96, 1).rotateX(Math.PI / 2), M.structure);
  plateUnder.position.y = 0.34;
  tank.add(cup, cupLip, plate, plateUnder);

  const glassH = G.tankTop - G.tankBottom;
  const glassGeo = new THREE.CylinderGeometry(G.tankR, G.tankR, glassH, 128, 1, true);
  const tankBack = mesh(glassGeo, glass.tankBack, { cast: false, order: 1 });
  const tankFront = mesh(glassGeo, glass.tankFront, { cast: false, order: 9 });
  tankBack.position.y = tankFront.position.y = G.tankBottom + glassH / 2;
  const tankRim = mesh(new THREE.TorusGeometry(G.tankR + 0.005, 0.032, 14, 128).rotateX(Math.PI / 2), M.alu);
  tankRim.position.y = G.tankTop;
  tank.add(tankBack, tankFront, tankRim);

  // water
  const waterH = G.waterY - G.tankBottom;
  const waterBody = mesh(new THREE.CylinderGeometry(G.tankR - 0.025, G.tankR - 0.025, waterH, 128, 1, true), glass.waterBody, { cast: false, order: 8 });
  waterBody.position.y = G.tankBottom + waterH / 2;
  const ringGeo = new THREE.RingGeometry(G.bellR + 0.028, G.tankR - 0.025, 128, 6);
  ringGeo.rotateX(-Math.PI / 2);
  const ringBase = ringGeo.attributes.position.array.slice();
  const ringN = ringGeo.attributes.position.count;
  const ringR = new Float32Array(ringN), ringT = new Float32Array(ringN);
  for (let i = 0; i < ringN; i++) {
    ringR[i] = Math.hypot(ringBase[i * 3], ringBase[i * 3 + 2]);
    ringT[i] = Math.atan2(ringBase[i * 3 + 2], ringBase[i * 3]);
  }
  const waterSurf = mesh(ringGeo, glass.waterSurf, { cast: false, order: 7 });
  waterSurf.position.y = G.waterY;
  const waterInner = mesh(new THREE.CircleGeometry(G.bellR - 0.02, 96).rotateX(-Math.PI / 2), glass.waterInner, { cast: false, order: 4 });
  waterInner.position.y = G.waterY - 0.012;
  const meniscus = mesh(new THREE.TorusGeometry(G.tankR - 0.03, 0.012, 8, 128).rotateX(Math.PI / 2), glass.waterSurf, { cast: false, order: 7 });
  meniscus.position.y = G.waterY + 0.004;
  tank.add(waterBody, waterSurf, waterInner, meniscus);

  // rigid breathing pipe rising inside the bell (clear acrylic)
  const pipeH = G.pipeTop - G.tankBottom;
  const pipe = mesh(new THREE.CylinderGeometry(G.pipeR, G.pipeR, pipeH, 36, 1, true), glass.pipe, { cast: false, order: 2 });
  pipe.position.y = G.tankBottom + pipeH / 2;
  const pipeCollar = mesh(new THREE.CylinderGeometry(G.pipeR + 0.022, G.pipeR + 0.022, 0.07, 36, 1, true), M.alu);
  pipeCollar.position.y = G.pipeTop - 0.03;
  const pipeLip = mesh(new THREE.TorusGeometry(G.pipeR + 0.012, 0.014, 10, 36).rotateX(Math.PI / 2), M.chrome);
  pipeLip.position.y = G.pipeTop + 0.004;
  const pipeFoot = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 36), M.alu);
  pipeFoot.position.y = G.tankBottom + 0.025;
  const pipeUnder = mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.12, 32), M.chrome);
  pipeUnder.position.y = 0.3;
  tank.add(pipe, pipeCollar, pipeLip, pipeFoot, pipeUnder);

  /* bell */
  const bell = new THREE.Group();
  bell.position.set(G.tankX, bellBottomAt(FRC), 0);
  model.add(bell);
  const bellWallH = G.bellH - 0.06;
  const bellGeo = new THREE.CylinderGeometry(G.bellR, G.bellR, bellWallH, 128, 1, true);
  const bellBack = mesh(bellGeo, glass.bellBack, { cast: false, order: 3 });
  const bellFront = mesh(bellGeo, glass.bellFront, { cast: false, order: 5 });
  bellBack.position.y = bellFront.position.y = bellWallH / 2;
  const bellCap = mesh(new THREE.CylinderGeometry(G.bellR + 0.022, G.bellR + 0.022, 0.09, 128), M.alu);
  bellCap.position.y = G.bellH - 0.045;
  const bellCapEdge = mesh(new THREE.TorusGeometry(G.bellR + 0.006, 0.026, 12, 128).rotateX(Math.PI / 2), M.alu);
  bellCapEdge.position.y = G.bellH;
  const bellBoss = mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.05, 48), M.chrome);
  bellBoss.position.y = G.bellH + 0.025;
  const bellEye = mesh(new THREE.TorusGeometry(0.042, 0.014, 10, 24), M.chrome);
  bellEye.position.y = G.bellH + 0.085;
  const bellRing = mesh(new THREE.CylinderGeometry(G.bellR + 0.014, G.bellR + 0.014, 0.085, 128, 1, true), M.alu);
  bellRing.position.y = 0.0425;
  const bellBand = mesh(new THREE.CylinderGeometry(G.bellR + 0.01, G.bellR + 0.01, 0.035, 128, 1, true), M.alu);
  bellBand.position.y = G.bellH - 0.32;
  bell.add(bellBack, bellFront, bellCap, bellCapEdge, bellBoss, bellEye, bellRing, bellBand);

  /* frame: columns, beam, pulleys */
  const colL = mesh(new THREE.CylinderGeometry(0.065, 0.065, G.pulleyY, 28), M.structure);
  colL.position.set(G.colX, G.pulleyY / 2, G.frameZ);
  const colR = mesh(new THREE.CylinderGeometry(0.05, 0.05, G.pulleyY, 24), M.chrome);
  colR.position.set(G.cwX, G.pulleyY / 2, G.frameZ);
  const footL = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.05, 32), M.structure);
  footL.position.set(G.colX, 0.025, G.frameZ);
  const footR = mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.05, 32), M.structure);
  footR.position.set(G.cwX, 0.025, G.frameZ);
  const beamX0 = G.p1x - 0.42, beamX1 = G.cwX + 0.24;
  const beam = mesh(new RoundedBoxGeometry(beamX1 - beamX0, 0.17, 0.17, 4, 0.05), M.structure);
  beam.position.set((beamX0 + beamX1) / 2, G.pulleyY, G.frameZ);
  model.add(colL, colR, footL, footR, beam);

  function makePulley(x) {
    const grp = new THREE.Group();
    grp.position.set(x, G.pulleyY, 0);
    const axle = mesh(along(new THREE.CylinderGeometry(0.035, 0.035, -G.frameZ + 0.08, 20), 'z'), M.chrome);
    axle.position.set(x, G.pulleyY, G.frameZ / 2 + 0.04);
    model.add(axle);
    const wheel = new THREE.Group();
    const R = G.pulleyR, rc = G.rc, w = 0.065;
    const prof = [
      [0.25, -w], [R - 0.012, -w], [R, -w + 0.012], [R, -0.034], [rc + 0.012, -0.012], [rc, 0],
      [rc + 0.012, 0.012], [R, 0.034], [R, w - 0.012], [R - 0.012, w], [0.25, w], [0.25, -w],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const rimGeo = new THREE.LatheGeometry(prof, 96);
    rimGeo.rotateX(Math.PI / 2);
    wheel.add(mesh(rimGeo, M.alu));
    for (let i = 0; i < 5; i++) {
      const sp = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), M.structure);
      const a = (i / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0);
      sp.rotation.z = a;
      wheel.add(sp);
    }
    const hub = mesh(along(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 32), 'z'), M.hub);
    const cap = mesh(new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), M.chrome);
    cap.position.z = 0.06;
    wheel.add(hub, cap);
    grp.add(wheel);
    model.add(grp);
    return wheel;
  }
  const pulley1 = makePulley(G.p1x);
  const pulley2 = makePulley(G.p2x);

  /* chain */
  const LINK_PITCH = 0.074;
  const linkGeo = new THREE.TorusGeometry(0.032, 0.0098, 8, 16);
  linkGeo.scale(1.45, 1, 1);
  const bellAttachAt = (v) => bellBottomAt(v) + G.bellH + G.bellEye;
  const LbAt = (v) => G.pulleyY - bellAttachAt(v);
  const LcAt = (v) => G.pulleyY - (penYAt(v) + G.cwEye);
  const ARC = (Math.PI / 2) * G.rc, SPAN = G.p2x - G.p1x;
  const CHAIN_LEN = LbAt(FRC) + LcAt(FRC) + 2 * ARC + SPAN;
  const NLINK = Math.floor((CHAIN_LEN - 0.03) / LINK_PITCH) + 1;
  const chain = new THREE.InstancedMesh(linkGeo, M.chainSteel, NLINK);
  chain.castShadow = true;
  chain.frustumCulled = false;
  model.add(chain);
  const Lb0 = LbAt(FRC);
  const _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _cn = new THREE.Vector3(), _cz = new THREE.Vector3(0, 0, 1);
  const _m4 = new THREE.Matrix4(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  function chainPoint(s, Lb) {
    if (s < Lb) { _cp.set(G.tankX, G.pulleyY - Lb + s, 0); _ct.set(0, 1, 0); return; }
    s -= Lb;
    if (s < ARC) {
      const a = Math.PI - s / G.rc;
      _cp.set(G.p1x + G.rc * Math.cos(a), G.pulleyY + G.rc * Math.sin(a), 0); _ct.set(Math.sin(a), -Math.cos(a), 0); return;
    }
    s -= ARC;
    if (s < SPAN) { _cp.set(G.p1x + s, G.pulleyY + G.rc, 0); _ct.set(1, 0, 0); return; }
    s -= SPAN;
    if (s < ARC) {
      const a = Math.PI / 2 - s / G.rc;
      _cp.set(G.p2x + G.rc * Math.cos(a), G.pulleyY + G.rc * Math.sin(a), 0); _ct.set(Math.sin(a), -Math.cos(a), 0); return;
    }
    s -= ARC;
    _cp.set(G.cwX, G.pulleyY - s, 0); _ct.set(0, -1, 0);
  }
  function updateChain(Lb) {
    for (let k = 0; k < NLINK; k++) {
      chainPoint(0.03 + k * LINK_PITCH, Lb);
      _cn.set(-_ct.y, _ct.x, 0);
      if (k % 2 === 0) { _y.copy(_cn); _z.copy(_cz); } else { _y.copy(_cz); _z.copy(_cn).negate(); }
      _m4.makeBasis(_ct, _y, _z).setPosition(_cp);
      chain.setMatrixAt(k, _m4);
    }
    chain.instanceMatrix.needsUpdate = true;
  }

  /* counterweight + pen */
  const cw = new THREE.Group();
  cw.position.set(G.cwX, penYAt(FRC), 0);
  model.add(cw);
  {
    const h = G.cwH / 2, r = G.cwR;
    const prof = [[0, -h], [r - 0.03, -h], [r, -h + 0.03], [r, h - 0.03], [r - 0.03, h], [0, h]].map(([a, b]) => new THREE.Vector2(a, b));
    cw.add(mesh(new THREE.LatheGeometry(prof, 64), M.brass));
    for (const yy of [-h + 0.1, h - 0.1]) {
      const g = mesh(new THREE.TorusGeometry(r + 0.002, 0.008, 8, 64).rotateX(Math.PI / 2), M.hub);
      g.position.y = yy;
      cw.add(g);
    }
    const boss = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 24), M.chrome);
    boss.position.y = h + 0.02;
    const eye = mesh(new THREE.TorusGeometry(0.04, 0.013, 10, 24), M.chrome);
    eye.position.y = h + 0.07;
    eye.rotation.y = Math.PI / 2;
    const bracket = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), M.structure);
    bracket.position.set(0, 0, -0.34);
    const sleeve = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.24, 28), M.structure);
    sleeve.position.set(0, 0, G.frameZ);
    cw.add(boss, eye, bracket, sleeve);
    // pen arm
    const nibLocal = G.nibX - G.cwX; // negative
    const armX0 = -r + 0.01, armX1 = nibLocal + 0.17;
    const arm = mesh(along(new THREE.CylinderGeometry(0.02, 0.02, armX0 - armX1, 16), 'x'), M.chrome);
    arm.position.x = (armX0 + armX1) / 2;
    const clamp = mesh(along(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 20), 'x'), M.structure);
    clamp.position.x = -r - 0.02;
    const holder = mesh(along(new THREE.CylinderGeometry(0.044, 0.044, 0.12, 24), 'x'), M.ink);
    holder.position.x = nibLocal + 0.11;
    const ferrule = mesh(along(new THREE.CylinderGeometry(0.047, 0.047, 0.02, 24), 'x'), M.chrome);
    ferrule.position.x = nibLocal + 0.175;
    const tip = mesh(new THREE.ConeGeometry(0.03, 0.06, 20).rotateZ(Math.PI / 2), M.chrome);
    tip.position.x = nibLocal + 0.03;
    cw.add(arm, clamp, holder, ferrule, tip);
  }
  const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, depthTest: true });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(0.26);
  glow.position.set(G.nibX - G.cwX + 0.01, 0, 0.02);
  glow.renderOrder = 21;
  cw.add(glow);

  /* kymograph drum */
  const housing = mesh(new RoundedBoxGeometry(0.98, 0.42, 0.98, 5, 0.09), M.structure, { receive: true });
  housing.position.set(G.drumX, 0.21, 0);
  const ledPos = new THREE.Vector3(G.drumX + 0.3, 0.27, 0.492);
  const led = mesh(new THREE.CircleGeometry(0.03, 24), M.led, { cast: false });
  led.position.copy(ledPos);
  const ledRing = mesh(new THREE.RingGeometry(0.03, 0.045, 24), M.hub, { cast: false });
  ledRing.position.copy(ledPos).add(new THREE.Vector3(0, 0, -0.001));
  const spindle = mesh(new THREE.CylinderGeometry(0.055, 0.055, G.drumY0 - 0.42, 24), M.chrome);
  spindle.position.set(G.drumX, 0.42 + (G.drumY0 - 0.42) / 2, 0);
  const collar = mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.06, 32), M.alu);
  collar.position.set(G.drumX, 0.45, 0);
  model.add(housing, led, ledRing, spindle, collar);

  const drumRot = new THREE.Group();
  drumRot.position.set(G.drumX, 0, 0);
  model.add(drumRot);
  const paper = mesh(new THREE.CylinderGeometry(G.drumR, G.drumR, G.drumH, 192, 1, true), M.paper, { receive: true });
  paper.position.y = G.drumY0 + G.drumH / 2;
  const flangeGeo = new THREE.CylinderGeometry(G.drumR + 0.045, G.drumR + 0.045, 0.06, 128);
  const flB = mesh(flangeGeo, M.structure);
  flB.position.y = G.drumY0 - 0.03;
  const flT = mesh(flangeGeo, M.structure);
  flT.position.y = G.drumY0 + G.drumH + 0.03;
  const knob = mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.09, 32), M.chrome);
  knob.position.y = G.drumY0 + G.drumH + 0.105;
  drumRot.add(paper, flB, flT, knob);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bolt = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 16), M.chrome);
    bolt.position.set(Math.cos(a) * (G.drumR - 0.14), G.drumY0 + G.drumH + 0.07, Math.sin(a) * (G.drumR - 0.14));
    drumRot.add(bolt);
  }
  const hubMark = mesh(new THREE.BoxGeometry(G.drumR - 0.2, 0.012, 0.05), M.hub, { cast: false });
  hubMark.position.set((G.drumR - 0.2) / 2 + 0.1, G.drumY0 + G.drumH + 0.066, 0);
  drumRot.add(hubMark);

  /* breathing hose + mouthpiece */
  const hosePts = [
    [G.tankX, 0.3, 0.0], [G.tankX, 0.18, 0.13], [G.tankX + 0.06, 0.125, 0.55], [G.tankX + 0.38, 0.12, 1.02],
    [G.tankX + 0.95, 0.122, 1.32], [G.tankX + 1.45, 0.15, 1.45], [G.tankX + 1.75, 0.2, 1.52],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const hoseCurve = new THREE.CatmullRomCurve3(hosePts, false, 'centripetal');
  const hoseGeo = corrugatedTube(hoseCurve, 320, 0.098, 20, 0.06, 0.16);
  const hoseBack = mesh(hoseGeo, glass.hoseBack, { cast: false, order: 10 });
  const hoseFront = mesh(hoseGeo, glass.hoseFront, { cast: false, order: 11 });
  model.add(hoseBack, hoseFront);
  const hoseEnd = hoseCurve.getPointAt(1);
  const hoseDir = hoseCurve.getTangentAt(1).normalize();
  const mouth = new THREE.Group();
  mouth.position.copy(hoseEnd);
  mouth.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), hoseDir);
  {
    const sleeve = mesh(along(new THREE.CylinderGeometry(0.126, 0.126, 0.16, 36), 'x'), M.plastic);
    const band = mesh(along(new THREE.CylinderGeometry(0.131, 0.131, 0.03, 36), 'x'), M.alu);
    band.position.x = -0.05;
    const neck = mesh(along(new THREE.CylinderGeometry(0.08, 0.115, 0.12, 36), 'x'), M.plastic);
    neck.position.x = 0.14;
    const flangeG = along(new THREE.CylinderGeometry(0.2, 0.2, 0.028, 48), 'x');
    flangeG.scale(1, 0.62, 1);
    const flange = mesh(flangeG, M.plastic);
    flange.position.x = 0.215;
    const bite = mesh(new RoundedBoxGeometry(0.15, 0.075, 0.22, 3, 0.032), M.plastic);
    bite.position.x = 0.3;
    mouth.add(sleeve, band, neck, flange, bite);
  }
  model.add(mouth);
  const mouthTip = hoseEnd.clone().addScaledVector(hoseDir, 0.38);

  /* airflow particles */
  const pathPts = [];
  {
    pathPts.push(mouthTip.clone(), hoseEnd.clone().addScaledVector(hoseDir, 0.12));
    for (let i = 0; i <= 120; i++) pathPts.push(hoseCurve.getPointAt(1 - i / 120));
    pathPts.push(new THREE.Vector3(G.tankX, G.tankBottom, 0), new THREE.Vector3(G.tankX, G.pipeTop - 0.02, 0));
  }
  const pathCurve = new THREE.CatmullRomCurve3(pathPts, false, 'catmullrom', 0.0);
  const LUT_N = 512;
  const lut = new Float32Array((LUT_N + 1) * 3);
  for (let i = 0; i <= LUT_N; i++) {
    const p = pathCurve.getPointAt(i / LUT_N);
    lut[i * 3] = p.x; lut[i * 3 + 1] = p.y; lut[i * 3 + 2] = p.z;
  }
  const S_MAX = 1.24;
  const NP = 110;
  const rnd = mulberry32(5);
  const pS = new Float32Array(NP), pOff = new Float32Array(NP * 3), pAng = new Float32Array(NP), pRad = new Float32Array(NP);
  const pPos = new Float32Array(NP * 3), pAlpha = new Float32Array(NP), pSize = new Float32Array(NP);
  for (let i = 0; i < NP; i++) {
    pS[i] = rnd() * S_MAX;
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.045, h = (rnd() - 0.5) * 0.06;
    pOff[i * 3] = Math.cos(a) * r; pOff[i * 3 + 1] = h; pOff[i * 3 + 2] = Math.sin(a) * r;
    pAng[i] = rnd() * Math.PI * 2;
    pRad[i] = 0.25 + rnd() * 0.75;
    pSize[i] = 0.052 + rnd() * 0.04;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uScale: { value: 400 }, uCore: { value: 1 } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize;
      uniform float uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / max( 0.001, -mv.z );
        vA = aAlpha;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uCore; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = length( d ) * 2.0;
        if ( r > 1.0 ) discard;
        float a = smoothstep( 1.0, 0.45, r ) * 0.95;
        vec3 c = mix( uColor, vec3( 1.0 ), uCore * smoothstep( 0.6, 1.0, 1.0 - r ) * 0.4 );
        gl_FragColor = vec4( c, a * vA );
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.renderOrder = 20;
  model.add(particles);
  const pColInsp = new THREE.Color(), pColExp = new THREE.Color();
  let flowSmooth = 0, flowDir = 0;

  function updateParticles(dt, flow, bellTop) {
    // flow > 0: lung volume rising (inspiration) -> air leaves bell towards mouth (s decreasing)
    const speed = -flow / 1700;
    const vis = smoothstep(60, 420, Math.abs(flow));
    if (Math.abs(flow) > 30) flowDir += (Math.sign(flow) - flowDir) * Math.min(1, dt * 6);
    pMat.uniforms.uColor.value.copy(pColExp).lerp(pColInsp, (flowDir + 1) / 2);
    const yCap = bellTop - 0.14;
    for (let i = 0; i < NP; i++) {
      let s = pS[i] + speed * dt * (0.85 + 0.3 * pRad[i]);
      if (s > S_MAX) s -= S_MAX; else if (s < 0) s += S_MAX;
      pS[i] = s;
      let x, y, z;
      if (s <= 1) {
        const f = s * LUT_N, i0 = Math.min(LUT_N - 1, Math.floor(f)), t = f - i0;
        x = lut[i0 * 3] + (lut[i0 * 3 + 3] - lut[i0 * 3]) * t;
        y = lut[i0 * 3 + 1] + (lut[i0 * 3 + 4] - lut[i0 * 3 + 1]) * t;
        z = lut[i0 * 3 + 2] + (lut[i0 * 3 + 5] - lut[i0 * 3 + 2]) * t;
        x += pOff[i * 3]; y += pOff[i * 3 + 1]; z += pOff[i * 3 + 2];
      } else {
        const d = (s - 1) / (S_MAX - 1);
        const rr = Math.min(G.bellR - 0.12, d * 0.62 * pRad[i] + 0.03);
        x = G.tankX + Math.cos(pAng[i]) * rr;
        z = Math.sin(pAng[i]) * rr;
        y = Math.min(G.pipeTop + d * 0.6, yCap);
      }
      pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
      const fade = smoothstep(0, 0.035, s) * (1 - smoothstep(S_MAX - 0.1, S_MAX, s));
      pAlpha[i] = vis * fade;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ---------- theme */
  function applyTheme() {
    const T = TOKENS[theme], L = LOOK[theme];
    renderer.toneMappingExposure = L.exposure;
    M.structure.color.set(L.structure); M.structure.roughness = L.structureRough;
    M.hub.color.set(L.hub);
    M.slab.color.set(L.slab); M.slab.roughness = L.slabRough;
    M.plastic.color.set(L.plastic);
    M.ink.color.set(T.blue); M.ink.emissive.set(T.blue);
    const setG = (m, cfg, color) => {
      m.color.set(color || cfg.color);
      m.userData.glass.uBodyA.value = cfg.a; m.userData.glass.uFres.value = cfg.f; m.userData.glass.uSpec.value = cfg.s ?? 1;
    };
    setG(glass.tankBack, { ...L.glass, a: L.glass.a * 0.8 });
    setG(glass.tankFront, L.glass);
    setG(glass.bellBack, { ...L.bell, a: L.bell.a * 0.9 });
    setG(glass.bellFront, L.bell);
    setG(glass.hoseBack, { ...L.hose, a: L.hose.a * 0.7 });
    setG(glass.hoseFront, L.hose);
    setG(glass.pipe, L.pipe);
    const wc = new THREE.Color(T.cyan).multiplyScalar(L.water.tint);
    glass.waterBody.userData.glass.uGrad.value = theme === 'dark' ? 1 : 0.55;
    setG(glass.waterBody, { a: L.water.a, f: L.water.f, s: 1 }, wc);
    setG(glass.waterSurf, { a: L.water.surf, f: 0.4, s: 1.2 }, wc);
    setG(glass.waterInner, { a: L.water.surf * 0.8, f: 0.3, s: 1 }, wc);
    hemi.intensity = L.hemi; key.intensity = L.key; rim.intensity = L.rim; fill.intensity = L.fill;
    blobMat.opacity = L.blob; aoMat.opacity = L.contact;
    pColInsp.set(T.blue); pColExp.set(T.orange);
    pMat.blending = THREE.NormalBlending; // keeps token colour legible over the bright water
    pMat.uniforms.uCore.value = L.additive ? 0.5 : 0;
    pMat.needsUpdate = true;
    glowMat.color.set(T.blue);
    glowMat.blending = L.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    glowMat.opacity = L.additive ? 0.9 : 0.35;
    glowMat.needsUpdate = true;
    redrawPaper();
  }

  /* ---------- state */
  let seq = buildSequence(opts.sequence);
  let seqTime = 0, paperTime = 0;
  let speed = Math.max(0.05, Number(opts.speed) || 1);
  let playing = !!opts.autoplay, finished = false, loop = !!opts.loop;
  const S = { v: FRC, phase: 'insp', segment: 'tidal' };
  let curV = FRC, prevBellY = bellBottomAt(FRC);
  const snap = { from: FRC, k: 1 };
  let ripple = 0, elapsed = 0, ledLevel = 0;
  const listeners = new Set();
  let swayT = 0, swayAmt = 1;

  function startSnap() { snap.from = curV; snap.k = 0; }

  function poseFor(V) {
    const bb = bellBottomAt(V);
    bell.position.y = bb;
    cw.position.y = penYAt(V);
    const Lb = G.pulleyY - (bb + G.bellH + G.bellEye);
    updateChain(Lb);
    const rot = (Lb - Lb0) / G.rc;
    pulley1.rotation.z = rot;
    pulley2.rotation.z = rot;
    drumRot.rotation.y = -OMEGA * paperTime;
    return bb;
  }

  function updateWater(dt, bellSpeed) {
    ripple += (Math.min(1, bellSpeed * 0.9) - ripple) * Math.min(1, dt * (bellSpeed * 0.9 > ripple ? 4 : 1.2));
    const pos = ringGeo.attributes.position;
    const arr = pos.array;
    const t = elapsed;
    const A = 0.0035 + ripple * 0.016;
    const r0 = G.bellR + 0.028, r1 = G.tankR - 0.025;
    for (let i = 0; i < ringN; i++) {
      const r = ringR[i], th = ringT[i];
      const edge = smoothstep(r0, r0 + 0.04, r) * (1 - smoothstep(r1 - 0.03, r1, r)) * 0.7 + 0.3;
      arr[i * 3 + 1] = edge * (
        A * Math.sin(r * 26 - t * 4.6) +
        0.0022 * Math.sin(th * 3 + r * 9 + t * 1.7) +
        0.0016 * Math.sin(-th * 5 + r * 7 - t * 2.3));
    }
    pos.needsUpdate = true;
    ringGeo.computeVertexNormals();
  }

  /* ---------- frame loop */
  const clock = new THREE.Clock(false);
  let raf = 0, running = false, disposed = false;

  function update(dt) {
    elapsed += dt;
    const wasPlaying = playing;
    let sdt = 0;
    if (playing) {
      sdt = dt * speed;
      seqTime += sdt; paperTime += sdt;
      if (!seq.endless && seqTime >= seq.total) {
        if (loop) seqTime -= seq.total;
        else { paperTime -= seqTime - seq.total; sdt -= seqTime - seq.total; seqTime = seq.total; playing = false; finished = true; }
      }
    }
    evalSequence(seq, seqTime, S);
    let V = S.v;
    if (snap.k < 1) { snap.k = Math.min(1, snap.k + dt / SNAP_DUR); V = snap.from + (S.v - snap.from) * easeInOut(snap.k); }
    const flowNow = dt > 0 ? (V - curV) / dt : 0;
    curV = V;
    flowSmooth += (flowNow - flowSmooth) * Math.min(1, dt * 14);

    const bb = poseFor(V);
    const bellSpeed = dt > 0 ? Math.abs(bb - prevBellY) / dt : 0;
    prevBellY = bb;

    if (wasPlaying && sdt > 0) penWrite(penYAt(V));

    updateWater(dt, bellSpeed);
    updateParticles(dt, flowSmooth, bb + G.bellH - 0.09);

    ledLevel += ((playing ? 1 : 0.15) - ledLevel) * Math.min(1, dt * 5);
    M.led.color.set(TOKENS[theme].green).multiplyScalar(0.35 + 0.65 * ledLevel);
    glow.scale.setScalar(0.22 + 0.05 * Math.sin(elapsed * 3.1));
    glowMat.opacity = (0.45 + 0.55 * ledLevel) * (theme === 'dark' ? 0.9 : 0.35);

    // idle sway
    if (opts.sway) {
      if (!interacting) idleFor += dt;
      const want = interacting || idleFor < 2.5 ? 0 : 1;
      swayAmt += (want - swayAmt) * Math.min(1, dt * 0.8);
      swayT += dt;
      rig.rotation.y = THREE.MathUtils.degToRad(3.5) * Math.sin((swayT / 30) * Math.PI * 2) * swayAmt;
    }

    if (wasPlaying && listeners.size) {
      const sample = { t: seqTime, lungVolume: V, phase: S.phase, segment: S.segment };
      for (const cb of listeners) { try { cb(sample); } catch (e) { console.error(e); } }
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    controls.update();
    flushPaper();
    renderer.render(scene, camera);
  }

  /* ---------- sizing / framing */
  const BOX_MIN = new THREE.Vector3(-3.15, -0.18, -0.75);
  const BOX_MAX = new THREE.Vector3(2.85, G.pulleyY + G.pulleyR + 0.06, 1.95);
  const _corner = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  function fitCamera() {
    _f.copy(camera.position).sub(controls.target).normalize();
    _r.crossVectors(camera.up, _f).normalize();
    _u.crossVectors(_f, _r);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanH = tanV * camera.aspect;
    let d = 0;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? BOX_MAX.x : BOX_MIN.x, i & 2 ? BOX_MAX.y : BOX_MIN.y, i & 4 ? BOX_MAX.z : BOX_MIN.z).sub(controls.target);
      const cx = _corner.dot(_r), cy = _corner.dot(_u), cz = _corner.dot(_f);
      d = Math.max(d, Math.abs(cx) / tanH + cz, Math.abs(cy) / tanV + cz);
    }
    camera.position.copy(controls.target).addScaledVector(_f, d * 1.05);
    camera.updateMatrixWorld();
  }
  let cw_ = 0, ch_ = 0;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    if (w === cw_ && h === ch_) return;
    cw_ = w; ch_ = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
    pMat.uniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  /* ---------- anchors */
  const _a = new THREE.Vector3(), _camL = new THREE.Vector3();
  function facing(cx, y, cz, r) {
    _camL.copy(camera.position);
    model.worldToLocal(_camL);
    const dx = _camL.x - cx, dz = _camL.z - cz, L = Math.hypot(dx, dz) || 1;
    return _a.set(cx + (dx / L) * r, y, cz + (dz / L) * r);
  }
  function project(local) {
    const w = container.clientWidth, h = container.clientHeight;
    _a.copy(local);
    model.localToWorld(_a);
    _a.project(camera);
    const visible = _a.z > -1 && _a.z < 1 && Math.abs(_a.x) <= 1 && Math.abs(_a.y) <= 1;
    return { x: ((_a.x + 1) / 2) * w, y: ((1 - _a.y) / 2) * h, visible };
  }
  const _tmp = new THREE.Vector3();
  function getAnchors() {
    rig.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const V = curV;
    const bb = bellBottomAt(V), bellTop = bb + G.bellH, py = penYAt(V);
    const out = {};
    const put = (name, v) => { _tmp.copy(v); out[name] = project(_tmp); };
    put('bell', facing(G.tankX, Math.max(G.tankTop + 0.05, Math.min(bellTop - 0.15, (bellTop + G.tankTop) / 2 + 0.1)), 0, G.bellR));
    put('counterweight', facing(G.cwX, py + 0.05, 0, G.cwR));
    put('pen', _tmp.set(G.nibX, py, 0).clone());
    put('drum', facing(G.drumX, G.drumY0 + G.drumH * 0.86, 0, G.drumR));
    put('mouthpiece', mouthTip);
    put('pulley', _tmp.set(G.p1x, G.pulleyY, 0.07).clone());
    put('water', facing(G.tankX, G.tankBottom + 0.5, 0, G.tankR));
    // extras
    put('pulley2', _tmp.set(G.p2x, G.pulleyY, 0.07).clone());
    put('chain', _tmp.set((G.p1x + G.p2x) / 2, G.pulleyY + G.rc, 0).clone());
    put('tube', _tmp.set(G.tankX, G.pipeTop, 0).clone());
    put('hose', hoseCurve.getPointAt(0.45));
    put('tank', facing(G.tankX, G.tankTop - 0.15, 0, G.tankR));
    return out;
  }

  /* ---------- init */
  drawGrid();
  clearPaper();
  applyTheme();
  poseFor(FRC);
  updateChain(Lb0);
  resize();

  /* ---------- controller */
  const ctl = {
    start() {
      if (running || disposed) return;
      running = true;
      clock.start();
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      clock.stop();
    },
    dispose() {
      if (disposed) return;
      ctl.stop();
      disposed = true;
      ro.disconnect();
      controls.dispose();
      listeners.clear();
      const mats = new Set(), geos = new Set(), texs = new Set([paperTex, blobTex, glowTex]);
      scene.traverse((o) => {
        if (o.geometry && !o.isSprite) geos.add(o.geometry); // Sprite geometry is shared by three.js
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
      });
      mats.forEach((m) => { if (m.map) texs.add(m.map); m.dispose(); });
      geos.forEach((g) => g.dispose());
      texs.forEach((t) => t.dispose());
      linkGeo.dispose();
      envRT.dispose();
      scene.environment = null;
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
    setTheme(t) {
      const next = t === 'light' ? 'light' : 'dark';
      if (next === theme) return;
      theme = next;
      applyTheme();
    },
    play() {
      if (finished) ctl.reset();
      playing = true;
    },
    pause() { playing = false; },
    reset() {
      seqTime = 0;
      paperTime = 0;
      finished = false;
      startSnap();
      clearPaper();
    },
    setSequence(name) {
      seq = buildSequence(name === 'tidal' ? 'tidal' : 'full');
      seqTime = 0;
      finished = false;
      startSnap();
    },
    setSpeed(x) { const v = Number(x); if (isFinite(v) && v > 0) speed = Math.min(10, Math.max(0.05, v)); },
    onSample(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getAnchors,
    /* extras */
    setLoop(b) { loop = !!b; },
    getState() {
      return { t: seqTime, lungVolume: curV, phase: S.phase, segment: S.segment, playing, finished, sequence: seq.name, speed, loop, duration: seq.endless ? Infinity : seq.total };
    },
    get volumes() { return VOLUMES; },
  };
  return ctl;
}

export default { mount, VOLUMES };
