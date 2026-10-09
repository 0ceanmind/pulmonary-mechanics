/* =========================================================================
   boyle.js — Boyle's law  (P1·V1 = P2·V2, temperature constant)
   A glass cylinder with a metal piston, ~120 gas molecules in real 3D
   kinetic motion (constant speeds = constant temperature) and an analog
   pressure gauge reading P = 1/V (relative to 1 at V = 1).
   Wall / piston hits flash briefly, so the hit rate visibly rises as V falls.
   Build contract: dev/CONTRACT.md (r160, alpha canvas, mount/controller).
   ========================================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ---------------------------------------------------------------- tokens */
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
const FONT = '"SF Pro Display", "Inter", system-ui, sans-serif';

const LOOK = {
  dark: {
    envTop: '#262b36', envBottom: '#040405', key: 2.4, fill: 2.0, top: 1.4,
    glass: { tint: '#b4d2ff', base: 0.008, edge: 0.42, pow: 2.6, spec: 1.0 },
    gas: { base: 0.01, edge: 0.07, pow: 2.5 },
    plinth: '#3a3a3f', plinthRough: 0.34, floor: '#0d0d0f',
    piston: '#d4d6db', chrome: '#eceef2', grip: '#e5e5ea', rubber: '#141416',
    housing: '#3a3a3f',
    face: ['#232327', '#0f0f11'], ink: '#f5f5f7', ink2: '#a1a1a6',
    molEmissive: 1.1, halo: 0.22, shadow: 0.0, pool: 0.075, tick: '#a1a1a6',
  },
  light: {
    envTop: '#2a2e35', envBottom: '#0c0d10', key: 1.6, fill: 1.1, top: 0.7,
    glass: { tint: '#55657e', base: 0.03, edge: 0.62, pow: 2.2, spec: 0.35 },
    gas: { base: 0.025, edge: 0.12, pow: 2.5 },
    plinth: '#c4c6cc', plinthRough: 0.3, floor: '#dcdde2',
    piston: '#c9ccd2', chrome: '#d8dade', grip: '#2c2c2e', rubber: '#1d1d1f',
    housing: '#c4c6cc',
    face: ['#ffffff', '#f1f1f4'], ink: '#1d1d1f', ink2: '#6e6e73',
    molEmissive: 0.18, halo: 0.0, shadow: 0.2, pool: 0.0, tick: '#6e6e73',
  },
};

/* ---------------------------------------------------------------- layout */
const Y0 = 0.0;             // chamber floor (top of the plinth)
const HMAX = 2.7;           // gas column height at V = 1
const R_IN = 1.0;           // bore radius (molecules bounce here)
const R_GLASS = 1.06;       // glass surface radius
const GLASS_TOP = 3.25;
const PISTON_H = 0.24;
const ROD_LEN = 2.35;
const MOL_R = 0.055;
const N_MOL = 120;
const V_MIN = 0.35, V_MAX = 1.0;
const P_MAX_DIAL = 3;
const GAUGE_POS = new THREE.Vector3(2.55, 1.4, 0.12);
const GAUGE_R = 0.86;
const FRAME = { cx: 0.85, cy: 2.5, hw: 2.65, hh: 2.95 };

/* ------------------------------------------------------------------ GLSL */
const PREMUL = /* glsl */`gl_FragColor = clamp(gl_FragColor, 0.0, 1.0);
  gl_FragColor.a = max(gl_FragColor.a, max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)));`;

const STUDIO = /* glsl */`
uniform vec3 uEnvTop;
uniform vec3 uEnvBottom;
uniform float uKey;
uniform float uFill;
uniform float uTop;
float softbox(vec3 R, vec3 C, vec2 size, float feather){
  float d = dot(R, C);
  if (d <= 0.0) return 0.0;
  vec3 U = abs(C.y) < 0.99 ? normalize(vec3(C.z, 0.0, -C.x)) : vec3(1.0, 0.0, 0.0);
  vec3 W = cross(C, U);
  vec2 q = abs(vec2(dot(R, U), dot(R, W)) / d);
  vec2 m = 1.0 - smoothstep(size - feather, size, q);
  return m.x * m.y;
}
vec3 studio(vec3 R){
  float up = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uEnvBottom, uEnvTop, smoothstep(0.2, 0.92, up));
  c += uKey  * softbox(R, normalize(vec3(-0.55, 0.30, 0.78)), vec2(0.16, 0.95), 0.08);
  c += uFill * softbox(R, normalize(vec3(0.80, 0.10, 0.60)), vec2(0.07, 0.90), 0.05);
  c += uTop  * softbox(R, vec3(0.0, 1.0, 0.0), vec2(0.62, 0.26), 0.20);
  return c;
}
`;

const GLASS_VERT = /* glsl */`
varying vec3 vW;
varying vec3 vN;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const GLASS_FRAG = /* glsl */`
${STUDIO}
uniform vec3 uGTint;
uniform float uGBase;
uniform float uGEdge;
uniform float uGPow;
uniform float uGSpec;
uniform float uBackK;
varying vec3 vW;
varying vec3 vN;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  // three.js flips the winding for BackSide materials (gl_FrontFacing stays true)
  #ifdef FLIP_SIDED
    N = -N;
  #endif
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float edge = 1.0 - cosT;
  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(edge, 5.0);
  vec3 spec = studio(R) * (0.10 + 0.90 * F) * uGSpec;
  float a = clamp(uGBase + pow(edge, uGPow) * uGEdge, 0.0, 1.0);
  gl_FragColor = vec4(uGTint * a + spec, a) * uBackK;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${PREMUL}
}
`;

/* round sprites: molecule halos */
const DOT_VERT = /* glsl */`
attribute float aAlpha;
uniform float uScale;
uniform float uSize;
varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uScale / max(-mv.z, 0.001);
  vAlpha = aAlpha;
}
`;
const HALO_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float a = exp(-d * 4.5) * (1.0 - d) * uOpacity * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
  ${PREMUL}
}
`;
/* hit flashes: expanding ring + hot core */
const FLASH_VERT = /* glsl */`
attribute float aAge;
uniform float uScale;
uniform float uSize;
varying float vAge;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vAge = aAge;
  gl_PointSize = aAge >= 1.0 ? 0.0 : uSize * (0.55 + 0.45 * aAge) * uScale / max(-mv.z, 0.001);
}
`;
const FLASH_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vAge;
void main(){
  if (vAge >= 1.0) discard;
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float r = mix(0.2, 0.82, vAge);
  float ring = 1.0 - smoothstep(0.0, 0.16, abs(d - r));
  float core = (1.0 - smoothstep(0.0, 0.42, d)) * (1.0 - vAge) * (1.0 - vAge);
  float fade = 1.0 - vAge;
  float a = clamp((ring * 0.75 + core) * fade * uOpacity, 0.0, 1.0);
  vec3 c = mix(uColor, vec3(1.0), core * 0.5);
  gl_FragColor = vec4(c * a, a);
  #include <colorspace_fragment>
  ${PREMUL}
}
`;
/* gauge arc fill (0 → P along the dial) */
const ARC_VERT = /* glsl */`
varying vec2 vP;
void main(){
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ARC_FRAG = /* glsl */`
uniform float uValue;
uniform vec3 uColor;
uniform vec3 uTrack;
uniform float uTrackA;
varying vec2 vP;
void main(){
  float deg = degrees(atan(vP.y, vP.x));
  if (deg < -135.0) deg += 360.0;
  float p = (225.0 - deg) / 270.0 * ${P_MAX_DIAL.toFixed(1)};
  if (p < 0.0 || p > ${P_MAX_DIAL.toFixed(1)}) discard;
  float fill = 1.0 - smoothstep(uValue - 0.012, uValue + 0.012, p);
  vec3 c = mix(uTrack, uColor, fill);
  float a = mix(uTrackA, 1.0, fill);
  gl_FragColor = vec4(c * a, a);
  #include <colorspace_fragment>
  ${PREMUL}
}
`;

/* ---------------------------------------------------------------- helpers */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const dialAngle = (p) => THREE.MathUtils.degToRad(225 - (clamp(p, 0, P_MAX_DIAL) / P_MAX_DIAL) * 270);
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function drawFace(ctx, size, L, T) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(c, c * 0.8, size * 0.05, c, c, c);
  g.addColorStop(0, L.face[0]);
  g.addColorStop(1, L.face[1]);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
  const R = c * 0.97;
  // ticks
  for (let i = 0; i <= P_MAX_DIAL * 10; i++) {
    const p = i / 10;
    const a = dialAngle(p);
    const major = i % 10 === 0, half = i % 5 === 0;
    const r0 = R * (major ? 0.78 : half ? 0.83 : 0.87), r1 = R * 0.95;
    ctx.strokeStyle = major || half ? L.ink : L.ink2;
    ctx.lineWidth = major ? size * 0.014 : half ? size * 0.009 : size * 0.005;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c - Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c - Math.sin(a) * r1);
    ctx.stroke();
  }
  // numerals
  ctx.fillStyle = L.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(size * 0.15)}px ${FONT}`;
  for (let p = 0; p <= P_MAX_DIAL; p++) {
    const a = dialAngle(p);
    const r = R * 0.5;
    ctx.fillText(String(p), c + Math.cos(a) * r, c - Math.sin(a) * r + size * 0.008);
  }
  // unit label
  ctx.fillStyle = L.ink2;
  ctx.font = `600 ${Math.round(size * 0.1)}px ${FONT}`;
  ctx.fillText('P', c, c + R * 0.62);
}

/* ================================================================== mount */
export function mount(container, options = {}) {
  const opts = Object.assign({ theme: 'dark', orbit: true, volume: 1 }, options);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  /* renderer ------------------------------------------------------------ */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', outline: 'none' });
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment(renderer);
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  roomEnv.dispose();
  scene.environment = envRT.texture;

  const framing = Object.assign({}, FRAME, opts.frame || {});
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const target = new THREE.Vector3(framing.cx, framing.cy, 0);
  camera.position.set(framing.cx, framing.cy + 3.2, 13);
  camera.lookAt(target);

  /* lights -------------------------------------------------------------- */
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-3.5, 9, 5.5);
  sun.target.position.set(0.8, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4.5; sun.shadow.camera.right = 4.5;
  sun.shadow.camera.top = 4.5; sun.shadow.camera.bottom = -4.5;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 22;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 6;
  scene.add(sun, sun.target);

  /* shared uniforms ---------------------------------------------------- */
  const U = {
    uEnvTop: { value: new THREE.Color() }, uEnvBottom: { value: new THREE.Color() },
    uKey: { value: 1 }, uFill: { value: 1 }, uTop: { value: 1 },
    uScale: { value: 800 },
  };
  const premulBlend = {
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };
  function glassMaterial(side, backK, look) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uEnvTop: U.uEnvTop, uEnvBottom: U.uEnvBottom, uKey: U.uKey, uFill: U.uFill, uTop: U.uTop,
        uGTint: look.tint, uGBase: look.base, uGEdge: look.edge, uGPow: look.pow, uGSpec: look.spec,
        uBackK: { value: backK },
      },
      vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, side, ...premulBlend,
    });
  }
  const glassLook = { tint: { value: new THREE.Color() }, base: { value: 0 }, edge: { value: 0 }, pow: { value: 2 }, spec: { value: 1 } };
  const gasLook = { tint: { value: new THREE.Color() }, base: { value: 0 }, edge: { value: 0 }, pow: { value: 2 }, spec: { value: 0 } };

  /* materials ----------------------------------------------------------- */
  const mPlinth = new THREE.MeshPhysicalMaterial({ color: '#3a3a3f', metalness: 1, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  const mFloor = new THREE.MeshStandardMaterial({ color: '#0d0d0f', metalness: 0.2, roughness: 0.65 });
  const mPiston = new THREE.MeshPhysicalMaterial({ color: '#d4d6db', metalness: 1, roughness: 0.26, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const mChrome = new THREE.MeshPhysicalMaterial({ color: '#eceef2', metalness: 1, roughness: 0.1 });
  const mGrip = new THREE.MeshPhysicalMaterial({ color: '#e5e5ea', metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.18, emissive: new THREE.Color(0, 0, 0) });
  const mRubber = new THREE.MeshStandardMaterial({ color: '#141416', metalness: 0, roughness: 0.55 });
  const mHousing = new THREE.MeshPhysicalMaterial({ color: '#3a3a3f', metalness: 1, roughness: 0.3, clearcoat: 0.4 });
  const mTick = new THREE.MeshBasicMaterial({ color: '#a1a1a6', toneMapped: false, transparent: true, opacity: 0.85 });

  const rig = new THREE.Group();
  scene.add(rig);

  /* plinth + chamber floor ------------------------------------------------ */
  const plinthProfile = [
    [0, -0.34], [1.44, -0.34], [1.49, -0.32], [1.52, -0.28], [1.52, -0.07], [1.5, -0.025], [1.46, 0], [0, 0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const plinth = new THREE.Mesh(new THREE.LatheGeometry(plinthProfile, 128), mPlinth);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  rig.add(plinth);
  const floorDisc = new THREE.Mesh(new THREE.CircleGeometry(R_GLASS, 96), mFloor);
  floorDisc.rotation.x = -Math.PI / 2;
  floorDisc.position.y = 0.002;
  floorDisc.receiveShadow = true;
  rig.add(floorDisc);
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(R_GLASS, 0.03, 16, 128), mRubber);
  gasket.rotation.x = Math.PI / 2;
  gasket.position.y = 0.02;
  rig.add(gasket);

  /* glass cylinder ------------------------------------------------------- */
  const glassGeo = new THREE.CylinderGeometry(R_GLASS, R_GLASS, GLASS_TOP, 128, 1, true);
  glassGeo.translate(0, GLASS_TOP / 2, 0);
  const glassBack = new THREE.Mesh(glassGeo, glassMaterial(THREE.BackSide, 0.75, glassLook));
  glassBack.renderOrder = 1;
  const glassFront = new THREE.Mesh(glassGeo, glassMaterial(THREE.FrontSide, 1.0, glassLook));
  glassFront.renderOrder = 6;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R_GLASS, 0.032, 16, 128), glassMaterial(THREE.FrontSide, 1.0, glassLook));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = GLASS_TOP;
  lip.renderOrder = 6;
  rig.add(glassBack, glassFront, lip);

  // volume graduations etched on the glass (V = 0.4 … 1.0)
  const tickGroup = new THREE.Group();
  rig.add(tickGroup);
  const TICK_AZ = -0.62;
  for (let i = 4; i <= 10; i++) {
    const v = i / 10;
    const major = i === 5 || i === 10;
    const t = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.22 : 0.13, 0.022, 0.006), mTick);
    t.position.set(Math.sin(TICK_AZ) * (R_GLASS + 0.004), Y0 + v * HMAX, Math.cos(TICK_AZ) * (R_GLASS + 0.004));
    t.rotation.y = TICK_AZ;
    t.renderOrder = 7;
    tickGroup.add(t);
  }

  /* gas column tint (cyan = volume) -------------------------------------- */
  const gasGeo = new THREE.CylinderGeometry(R_IN - 0.005, R_IN - 0.005, 1, 96, 1, true);
  gasGeo.translate(0, 0.5, 0);
  const gasBack = new THREE.Mesh(gasGeo, glassMaterial(THREE.BackSide, 0.7, gasLook));
  gasBack.renderOrder = 2;
  const gasFront = new THREE.Mesh(gasGeo, glassMaterial(THREE.FrontSide, 1.0, gasLook));
  gasFront.renderOrder = 5;
  rig.add(gasBack, gasFront);

  /* piston, rod, handle -------------------------------------------------- */
  const piston = new THREE.Group();
  rig.add(piston);
  const pistonProfile = [
    [0, 0], [0.972, 0], [0.985, 0.015], [0.985, PISTON_H - 0.035], [0.95, PISTON_H], [0, PISTON_H],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const pistonBody = new THREE.Mesh(new THREE.LatheGeometry(pistonProfile, 128), mPiston);
  pistonBody.castShadow = true;
  piston.add(pistonBody);
  [0.065, PISTON_H - 0.085].forEach((y) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.982, 0.02, 12, 128), mRubber);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    piston.add(ring);
  });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, ROD_LEN, 32), mChrome);
  rod.position.y = PISTON_H + ROD_LEN / 2;
  rod.castShadow = true;
  piston.add(rod);
  const handle = new THREE.Group();
  handle.position.y = PISTON_H + ROD_LEN;
  piston.add(handle);
  const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 1.05, 10, 32), mGrip);
  bar.rotation.z = Math.PI / 2;
  bar.castShadow = true;
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.24, 48), mChrome);
  boss.rotation.z = Math.PI / 2;
  boss.castShadow = true;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 32), mChrome);
  collar.position.y = -0.14;
  handle.add(bar, boss, collar);
  const pickables = [bar, boss, collar, rod, pistonBody];

  /* gas molecules --------------------------------------------------------- */
  const molGeo = new THREE.SphereGeometry(MOL_R, 20, 14);
  const mMol = new THREE.MeshStandardMaterial({ color: '#2997ff', emissive: new THREE.Color('#2997ff'), emissiveIntensity: 1.2, roughness: 0.25, metalness: 0 });
  const mols = new THREE.InstancedMesh(molGeo, mMol, N_MOL);
  mols.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mols.frustumCulled = false;
  rig.add(mols);
  const molPos = new Float32Array(N_MOL * 3);
  const molVel = new Float32Array(N_MOL * 3);
  const SIGMA = 0.82;   // velocity spread per axis (fixed → constant temperature)

  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(molPos, 3).setUsage(THREE.DynamicDrawUsage));
  const haloA = new Float32Array(N_MOL).fill(1);
  haloGeo.setAttribute('aAlpha', new THREE.BufferAttribute(haloA, 1));
  const uHaloColor = { value: new THREE.Color() };
  const uHaloOpacity = { value: 0.4 };
  const halos = new THREE.Points(haloGeo, new THREE.ShaderMaterial({
    uniforms: { uScale: U.uScale, uSize: { value: 0.26 }, uColor: uHaloColor, uOpacity: uHaloOpacity },
    vertexShader: DOT_VERT, fragmentShader: HALO_FRAG, toneMapped: false, ...premulBlend,
  }));
  halos.frustumCulled = false;
  halos.renderOrder = 3;
  rig.add(halos);

  /* hit flashes ------------------------------------------------------------ */
  const N_FLASH = 160;
  const FLASH_LIFE = 0.3;
  const flashPos = new Float32Array(N_FLASH * 3);
  const flashAge = new Float32Array(N_FLASH).fill(1);
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3).setUsage(THREE.DynamicDrawUsage));
  flashGeo.setAttribute('aAge', new THREE.BufferAttribute(flashAge, 1).setUsage(THREE.DynamicDrawUsage));
  const uFlashColor = { value: new THREE.Color() };
  const uFlashOpacity = { value: 1 };
  const flashes = new THREE.Points(flashGeo, new THREE.ShaderMaterial({
    uniforms: { uScale: U.uScale, uSize: { value: 0.3 }, uColor: uFlashColor, uOpacity: uFlashOpacity },
    vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, toneMapped: false, ...premulBlend,
  }));
  flashes.frustumCulled = false;
  flashes.renderOrder = 4;
  rig.add(flashes);
  let flashHead = 0;
  const FLASH_P = 0.55;
  function spawnFlash(x, y, z) {
    if (Math.random() > FLASH_P) return;
    const i = flashHead;
    flashHead = (flashHead + 1) % N_FLASH;
    flashPos[i * 3] = x; flashPos[i * 3 + 1] = y; flashPos[i * 3 + 2] = z;
    flashAge[i] = 0;
  }

  /* pressure gauge --------------------------------------------------------- */
  const gauge = new THREE.Group();
  gauge.position.copy(GAUGE_POS);
  gauge.rotation.y = -0.16;
  rig.add(gauge);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(GAUGE_R + 0.06, GAUGE_R + 0.06, 0.24, 96), mHousing);
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -0.12;
  housing.castShadow = true;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(GAUGE_R + 0.02, 0.055, 24, 128), mChrome);
  bezel.position.z = 0.02;
  bezel.castShadow = true;
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = faceCanvas.height = 1024;
  const faceCtx = faceCanvas.getContext('2d');
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.CircleGeometry(GAUGE_R, 128), new THREE.MeshBasicMaterial({ map: faceTex, toneMapped: false }));
  face.position.z = 0.012;
  const uArcValue = { value: 1 };
  const uArcColor = { value: new THREE.Color() };
  const uArcTrack = { value: new THREE.Color() };
  const uArcTrackA = { value: 0.2 };
  const arc = new THREE.Mesh(new THREE.RingGeometry(GAUGE_R * 0.665, GAUGE_R * 0.73, 160, 1), new THREE.ShaderMaterial({
    uniforms: { uValue: uArcValue, uColor: uArcColor, uTrack: uArcTrack, uTrackA: uArcTrackA },
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, toneMapped: false, ...premulBlend, depthWrite: false,
  }));
  arc.position.z = 0.018;
  // needle (points along +x, rotated by dial angle)
  const needleShape = new THREE.Shape();
  needleShape.moveTo(-0.17, -0.045);
  needleShape.lineTo(0.0, -0.032);
  needleShape.lineTo(GAUGE_R * 0.86, -0.008);
  needleShape.quadraticCurveTo(GAUGE_R * 0.885, 0, GAUGE_R * 0.86, 0.008);
  needleShape.lineTo(0.0, 0.032);
  needleShape.lineTo(-0.17, 0.045);
  needleShape.quadraticCurveTo(-0.2, 0, -0.17, -0.045);
  const mNeedle = new THREE.MeshStandardMaterial({ color: '#ff375f', emissive: new THREE.Color('#ff375f'), emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1 });
  const needle = new THREE.Mesh(new THREE.ExtrudeGeometry(needleShape, { depth: 0.018, bevelEnabled: false, curveSegments: 12 }), mNeedle);
  needle.position.z = 0.04;
  needle.castShadow = true;
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 40), mChrome);
  hubCap.rotation.x = Math.PI / 2;
  hubCap.position.z = 0.07;
  const coverLook = { tint: { value: new THREE.Color('#ffffff') }, base: { value: 0.0 }, edge: { value: 0.0 }, pow: { value: 2 }, spec: { value: 0.55 } };
  const cover = new THREE.Mesh(new THREE.CircleGeometry(GAUGE_R, 96), glassMaterial(THREE.FrontSide, 1.0, coverLook));
  cover.position.z = 0.1;
  cover.renderOrder = 8;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 32), mChrome);
  stem.position.set(0, -GAUGE_R - 0.16, -0.12);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 6), mChrome);
  nut.position.set(0, -GAUGE_R - 0.27, -0.12);
  gauge.add(housing, bezel, face, arc, needle, hubCap, cover, stem, nut);

  // pipe from the plinth to the gauge
  const gaugeBottom = new THREE.Vector3(0, -GAUGE_R - 0.3, -0.12).applyEuler(gauge.rotation).add(GAUGE_POS);
  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.4, -0.17, 0.05),
    new THREE.Vector3(1.95, -0.17, 0.06),
    new THREE.Vector3(gaugeBottom.x - 0.05, -0.1, gaugeBottom.z),
    new THREE.Vector3(gaugeBottom.x, gaugeBottom.y, gaugeBottom.z),
  ], false, 'centripetal');
  const pipe = new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 64, 0.055, 20, false), mChrome);
  pipe.castShadow = true;
  rig.add(pipe);

  /* floor: soft shadow catcher + subtle light pool -------------------------- */
  const FLOOR_Y = -0.34;
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.2, transparent: true, depthWrite: false });
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), shadowMat);
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.set(0.8, FLOOR_Y, 0);
  shadowFloor.receiveShadow = true;
  rig.add(shadowFloor);
  const poolTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 4.6), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, opacity: 0.07, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0.9, FLOOR_Y - 0.002, 0.1);
  pool.renderOrder = -1;
  rig.add(pool);

  /* controls --------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const dragPlane = new THREE.Plane();
  const hitPt = new THREE.Vector3();
  let dragging = false, hover = false, grabOffset = 0, dragPointer = -1;

  function setNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  function pickHandle(e) {
    setNdc(e);
    return raycaster.intersectObjects(pickables, false).length > 0;
  }
  function planeY() {
    const n = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize();
    dragPlane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(0, 0, 0));
    return raycaster.ray.intersectPlane(dragPlane, hitPt) ? hitPt.y : null;
  }
  const pistonY = (v) => Y0 + v * HMAX;
  function onPointerDown(e) {
    if (e.button !== 0 || !pickHandle(e)) return;
    const y = planeY();
    if (y === null) return;
    dragging = true;
    dragPointer = e.pointerId;
    grabOffset = y - pistonY(state.V);
    state.mode = 'drag';
    state.dragV = state.V;
    if (controls) controls.enabled = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (dragging && e.pointerId === dragPointer) {
      setNdc(e);
      const y = planeY();
      if (y !== null) state.dragV = clamp((y - grabOffset - Y0) / HMAX, V_MIN, V_MAX);
      return;
    }
    if (e.buttons) return;
    const h = pickHandle(e);
    if (h !== hover) {
      hover = h;
      canvas.style.cursor = h ? 'grab' : '';
    }
  }
  function onPointerUp(e) {
    if (!dragging || e.pointerId !== dragPointer) return;
    dragging = false;
    dragPointer = -1;
    state.mode = 'follow-end';
    if (controls) controls.enabled = true;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    canvas.style.cursor = hover ? 'grab' : '';
  }
  function onPointerLeave() {
    if (!dragging && hover) { hover = false; canvas.style.cursor = ''; }
  }
  // registered before OrbitControls so a handle grab can disable orbiting first
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  let controls = null;
  if (opts.orbit) {
    controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.45;
    controls.minAzimuthAngle = -0.6;
    controls.maxAzimuthAngle = 0.6;
    controls.minPolarAngle = 1.05;
    controls.maxPolarAngle = 1.62;
    controls.target.copy(target);
    controls.update();
  }

  /* --------------------------------------------------------------- state */
  const V0 = clamp(opts.volume, V_MIN, V_MAX);
  const state = {
    V: V0, mode: 'idle', tween: null, dragV: V0,
    needleP: 1 / V0, needleVel: 0,
  };
  let theme = opts.theme === 'light' ? 'light' : 'dark';
  let running = false, started = false, disposed = false;
  let raf = 0;
  let elapsed = 0;
  const clock = new THREE.Clock(false);
  const listeners = new Set();
  let lastEmitV = NaN;

  // seed molecules uniformly in the initial gas volume
  for (let i = 0; i < N_MOL; i++) {
    const rr = Math.sqrt(Math.random()) * (R_IN - MOL_R - 0.02);
    const th = Math.random() * Math.PI * 2;
    molPos[i * 3] = Math.cos(th) * rr;
    molPos[i * 3 + 1] = Y0 + MOL_R + 0.01 + Math.random() * (V0 * HMAX - 2 * MOL_R - 0.02);
    molPos[i * 3 + 2] = Math.sin(th) * rr;
    molVel[i * 3] = gauss() * SIGMA;
    molVel[i * 3 + 1] = gauss() * SIGMA;
    molVel[i * 3 + 2] = gauss() * SIGMA;
  }

  /* --------------------------------------------------------------- theme */
  function applyTheme() {
    const T = TOKENS[theme], L = LOOK[theme];
    U.uEnvTop.value.set(L.envTop); U.uEnvBottom.value.set(L.envBottom);
    U.uKey.value = L.key; U.uFill.value = L.fill; U.uTop.value = L.top;
    glassLook.tint.value.set(L.glass.tint); glassLook.base.value = L.glass.base; glassLook.edge.value = L.glass.edge;
    glassLook.pow.value = L.glass.pow; glassLook.spec.value = L.glass.spec;
    gasLook.tint.value.set(T.cyan); gasLook.base.value = L.gas.base; gasLook.edge.value = L.gas.edge; gasLook.pow.value = L.gas.pow;
    coverLook.spec.value = theme === 'dark' ? 0.55 : 0.25;
    mPlinth.color.set(L.plinth); mPlinth.roughness = L.plinthRough;
    mFloor.color.set(L.floor);
    mPiston.color.set(L.piston);
    mChrome.color.set(L.chrome);
    mGrip.color.set(L.grip);
    mRubber.color.set(L.rubber);
    mHousing.color.set(L.housing);
    mTick.color.set(L.tick);
    mMol.color.set(T.blue); mMol.emissive.set(T.blue); mMol.emissiveIntensity = L.molEmissive;
    uHaloColor.value.set(T.blue); uHaloOpacity.value = L.halo;
    halos.visible = L.halo > 0;
    uFlashColor.value.set(T.pink); uFlashOpacity.value = theme === 'dark' ? 1.0 : 0.9;
    mNeedle.color.set(T.pink); mNeedle.emissive.set(T.pink); mNeedle.emissiveIntensity = theme === 'dark' ? 0.38 : 0.1;
    uArcColor.value.set(T.pink); uArcTrack.value.set(T.text2); uArcTrackA.value = theme === 'dark' ? 0.22 : 0.18;
    shadowMat.opacity = L.shadow;
    shadowFloor.visible = L.shadow > 0;
    pool.material.opacity = L.pool;
    pool.visible = L.pool > 0;
    sun.intensity = theme === 'dark' ? 1.4 : 1.1;
    drawFace(faceCtx, faceCanvas.width, L, T);
    faceTex.needsUpdate = true;
  }

  /* ------------------------------------------------------------- physics */
  const m4 = new THREE.Matrix4();
  function updatePiston(dt) {
    if (state.mode === 'drag') {
      state.V += (state.dragV - state.V) * (1 - Math.exp(-dt * 20));
    } else if (state.mode === 'follow-end') {
      state.V += (state.dragV - state.V) * (1 - Math.exp(-dt * 20));
      if (Math.abs(state.dragV - state.V) < 1e-4) { state.V = state.dragV; state.mode = 'idle'; }
    } else if (state.mode === 'tween' && state.tween) {
      const tw = state.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      state.V = tw.from + (tw.to - tw.from) * easeInOut(tw.t);
      if (tw.t >= 1) { state.V = tw.to; state.mode = 'idle'; state.tween = null; }
    }
    state.V = clamp(state.V, V_MIN, V_MAX);
  }

  function stepMolecules(dt) {
    const ceil = pistonY(state.V) - MOL_R;
    const floorY = Y0 + MOL_R;
    const rMax = R_IN - MOL_R;
    const sub = 2, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < N_MOL; i++) {
        const k = i * 3;
        let x = molPos[k] + molVel[k] * h;
        let y = molPos[k + 1] + molVel[k + 1] * h;
        let z = molPos[k + 2] + molVel[k + 2] * h;
        // cylindrical wall
        const rr = Math.hypot(x, z);
        if (rr > rMax) {
          const nx = x / rr, nz = z / rr;
          const vn = molVel[k] * nx + molVel[k + 2] * nz;
          if (vn > 0) {
            molVel[k] -= 2 * vn * nx;
            molVel[k + 2] -= 2 * vn * nz;
            spawnFlash(nx * (R_IN + 0.01), y, nz * (R_IN + 0.01));
          }
          const back = Math.max(rMax - (rr - rMax), 0);
          x = nx * back; z = nz * back;
        }
        // floor
        if (y < floorY) {
          y = floorY + (floorY - y);
          if (molVel[k + 1] < 0) { molVel[k + 1] = -molVel[k + 1]; spawnFlash(x, Y0 + 0.01, z); }
        }
        // piston face (moving wall; speed kept constant → isothermal)
        if (y > ceil) {
          y = ceil - (y - ceil);
          if (molVel[k + 1] > 0) { molVel[k + 1] = -molVel[k + 1]; spawnFlash(x, ceil + MOL_R - 0.01, z); }
        }
        y = clamp(y, floorY, Math.max(ceil, floorY));
        molPos[k] = x; molPos[k + 1] = y; molPos[k + 2] = z;
      }
    }
    for (let i = 0; i < N_MOL; i++) {
      m4.makeTranslation(molPos[i * 3], molPos[i * 3 + 1], molPos[i * 3 + 2]);
      mols.setMatrixAt(i, m4);
    }
    mols.instanceMatrix.needsUpdate = true;
    haloGeo.attributes.position.needsUpdate = true;
    // age flashes
    for (let i = 0; i < N_FLASH; i++) if (flashAge[i] < 1) flashAge[i] = Math.min(1, flashAge[i] + dt / FLASH_LIFE);
    flashGeo.attributes.position.needsUpdate = true;
    flashGeo.attributes.aAge.needsUpdate = true;
  }

  function updateVisuals(dt) {
    const yb = pistonY(state.V);
    piston.position.y = yb;
    gasFront.scale.y = gasBack.scale.y = Math.max(yb - Y0, 0.001);
    // needle: critically damped spring toward P = 1/V
    const P = 1 / state.V;
    const w = 9;
    const acc = w * w * (P - state.needleP) - 2 * w * state.needleVel;
    state.needleVel += acc * dt;
    state.needleP += state.needleVel * dt;
    needle.rotation.z = dialAngle(state.needleP);
    uArcValue.value = clamp(state.needleP, 0, P_MAX_DIAL);
    // handle feedback
    const hl = dragging ? 1 : hover ? 0.6 : 0;
    const target = TOKENS[theme].yellow;
    mGrip.emissive.set(target).multiplyScalar(hl * (theme === 'dark' ? 0.35 : 0.5));
  }

  /* --------------------------------------------------------------- state */
  function computeState() { return { V: state.V, P: 1 / state.V }; }
  function emit(force) {
    if (!listeners.size) return;
    if (!force && Math.abs(state.V - lastEmitV) < 1e-6) return;
    lastEmitV = state.V;
    const s = computeState();
    listeners.forEach((cb) => { try { cb(s); } catch (e) { console.error(e); } });
  }

  /* -------------------------------------------------------------- sizing */
  let cw = 1, ch = 1;
  const viewDir = new THREE.Vector3();
  function resize() {
    cw = Math.max(1, container.clientWidth);
    ch = Math.max(1, container.clientHeight);
    renderer.setSize(cw, ch, false);
    camera.aspect = cw / ch;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const dist = Math.max(framing.hh / tanV, framing.hw / (tanV * camera.aspect)) + 1.6;
    viewDir.copy(camera.position).sub(controls ? controls.target : target).normalize();
    target.set(framing.cx, framing.cy, 0);
    if (controls) controls.target.copy(target);
    camera.position.copy(target).addScaledVector(viewDir, dist);
    camera.updateProjectionMatrix();
    if (controls) controls.update(); else camera.lookAt(target);
    U.uScale.value = (ch * renderer.getPixelRatio()) / (2 * tanV);
    if (started && !running) renderer.render(scene, camera);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  /* ---------------------------------------------------------------- loop */
  function tick(dt) {
    elapsed += dt;
    updatePiston(dt);
    stepMolecules(dt);
    updateVisuals(dt);
    if (controls) controls.update();
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    tick(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
    emit(false);
  }

  applyTheme();
  resize();
  stepMolecules(0);
  updateVisuals(0);

  /* ----------------------------------------------------------- controller */
  const api = {
    start() {
      if (disposed || running) return;
      running = true; started = true;
      clock.start();
      clock.getDelta();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      clock.stop();
      if (dragging) { dragging = false; if (controls) controls.enabled = true; }
    },
    dispose() {
      if (disposed) return;
      api.stop();
      disposed = true;
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      if (controls) controls.dispose();
      listeners.clear();
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => { if (!seen.has(m)) { seen.add(m); if (m.map) m.map.dispose(); m.dispose(); } });
      });
      if (sun.shadow.map) sun.shadow.map.dispose();
      faceTex.dispose();
      poolTex.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
    setTheme(t) {
      theme = t === 'light' ? 'light' : 'dark';
      applyTheme();
      if (started && !running) { updateVisuals(0); renderer.render(scene, camera); }
    },
    setVolume(v) {
      const to = clamp(Number(v), V_MIN, V_MAX);
      if (!Number.isFinite(to)) return;
      if (dragging) return;
      const d = Math.abs(to - state.V);
      if (d < 1e-5) return;
      state.tween = { from: state.V, to, t: 0, dur: 0.55 + 1.1 * d };
      state.mode = 'tween';
    },
    onState(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      try { cb(computeState()); } catch (e) { console.error(e); }
      return () => listeners.delete(cb);
    },
    getAnchors() {
      camera.updateMatrixWorld();
      rig.updateMatrixWorld();
      const proj = (v) => {
        const w = v.clone().applyMatrix4(rig.matrixWorld);
        const camSpace = w.clone().applyMatrix4(camera.matrixWorldInverse);
        w.project(camera);
        const x = (w.x * 0.5 + 0.5) * cw, y = (-w.y * 0.5 + 0.5) * ch;
        return { x, y, visible: camSpace.z < 0 && x >= 0 && x <= cw && y >= 0 && y <= ch };
      };
      const yb = pistonY(state.V);
      const gaugeLabel = new THREE.Vector3(0, -GAUGE_R - 0.5, 0).applyEuler(gauge.rotation).add(GAUGE_POS);
      return {
        piston: proj(new THREE.Vector3(-(R_GLASS + 0.12), yb + PISTON_H / 2, 0)),
        gauge: proj(GAUGE_POS.clone()),
        gas: proj(new THREE.Vector3(0, Y0 + (yb - Y0) / 2, 0)),
        handle: proj(new THREE.Vector3(0, yb + PISTON_H + ROD_LEN + 0.25, 0)),
        gaugeLabel: proj(gaugeLabel),
      };
    },
    getState: () => computeState(),
    // test hook: advance the simulation synchronously (e.g. when rAF is paused in a hidden tab)
    _debug: { advance(sec, fps = 60) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) tick(1 / fps); renderer.render(scene, camera); emit(false); } },
  };
  return api;
}

export default { mount };
