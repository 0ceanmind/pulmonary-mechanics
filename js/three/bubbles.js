/* =========================================================================
   bubbles.js — Laplace's law & pulmonary surfactant
   Two alveoli (iridescent soap-film bubbles) on a glass Y-airway with a
   stopcock valve at the junction.  P = 2T / r.
     Surfactant OFF : T = 50 dyn/cm in both → P_small > P_large → the small
                      alveolus empties into the large one and collapses.
     Surfactant ON  : T falls with surface area (T ∝ r, clamped 5–30 dyn/cm)
                      → P_small = P_large → no pressure gradient → stable.
   Build contract: dev/CONTRACT.md (r160, alpha canvas, mount/controller).
   ========================================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

/* per-theme look (premultiplied output: rgb = tint * alpha + additive light) */
const LOOK = {
  dark: {
    envTop: '#262b36', envBottom: '#040405', key: 3.4, fill: 2.4, top: 1.5,
    bubble: { base: 0.006, edge: 0.5, pow: 1.5, start: 0.28, tint: 1.0, spec: 1.15, back: 0.7, ink: 0.0 },
    glass: { tint: '#b4d2ff', base: 0.006, edge: 0.5, pow: 2.4, spec: 1.0 },
    dotCover: 0.12, dotSoft: 1.0,
    metal: '#c9ccd2', metalRough: 0.22, lever: '#f5f5f7', hub: '#8d9097',
  },
  light: {
    envTop: '#2a2e35', envBottom: '#0c0d10', key: 1.7, fill: 1.1, top: 0.7,
    bubble: { base: 0.045, edge: 0.9, pow: 1.25, start: 0.12, tint: 0.3, spec: 0.14, back: 0.5, ink: 0.75 },
    glass: { tint: '#55657e', base: 0.035, edge: 0.75, pow: 2.0, spec: 0.35 },
    dotCover: 1.0, dotSoft: 0.0,
    metal: '#b8bcc4', metalRough: 0.25, lever: '#2c2c2e', hub: '#9a9da4',
  },
};

/* --------------------------------------------------------------- physics */
const PHYS = {
  r1: 0.55,          // small alveolus (model units; 1.0 ≙ 100 µm)
  r2: 1.0,           // large alveolus
  Twater: 50,        // dyn/cm — alveolar fluid without surfactant
  Tsurf0: 25,        // dyn/cm at r = rSurf0 with surfactant
  rSurf0: 1.0,
  Tmin: 5, Tmax: 30, // clamp with surfactant
  G: 3.8e-4,         // airway conductance  (Δvolume / s per unit ΔP)
  Qmax: 0.055,       // soft cap so the collapse stays followable
  rCollapse: 0.16,   // radius at which the alveolus is considered collapsed
  unitCm: 0.01,      // r = 1 ≙ 0.01 cm (100 µm)
};
const DYN_PER_CMH2O = 980.665;
const VTOT = PHYS.r1 ** 3 + PHYS.r2 ** 3;

/* ---------------------------------------------------------------- layout */
const J = new THREE.Vector3(0, 1.3, 0);                      // junction / valve
const ML = new THREE.Vector3(-1.55, 0.3, 0);                 // left mouth
const MR = new THREE.Vector3(1.55, 0.3, 0);                  // right mouth
const AXL = new THREE.Vector3(-0.6, -0.8, 0).normalize();    // bubble axis (mouth → centre)
const AXR = new THREE.Vector3(0.6, -0.8, 0).normalize();
const TUBE_R = 0.105;
const INSET = 0.93;                                          // mouth sits slightly inside the bubble
const FRAME = { cx: 0.38, cy: 0.42, hw: 3.35, hh: 2.3 };   // framing box (half extents)

/* ------------------------------------------------------------------ GLSL */
const NOISE = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/* keep the premultiplied output valid (rgb <= a); compositors un-premultiply otherwise */
const PREMUL = /* glsl */`gl_FragColor = clamp(gl_FragColor, 0.0, 1.0);
  gl_FragColor.a = max(gl_FragColor.a, max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)));`;

/* analytic studio: gradient + three soft-boxes (crisp "product shot" reflections) */
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
  c += uKey  * softbox(R, normalize(vec3(-0.55, 0.45, 0.70)), vec2(0.36, 0.52), 0.16);
  c += uFill * softbox(R, normalize(vec3(0.86, 0.12, 0.50)), vec2(0.09, 0.80), 0.06);
  c += uTop  * softbox(R, vec3(0.0, 1.0, 0.0), vec2(0.62, 0.26), 0.20);
  return c;
}
`;

const DEFORM = /* glsl */`
uniform float uTime;
uniform float uRadius;
uniform float uSquash;
uniform float uCrumple;
uniform float uWobble;
uniform float uSeed;
uniform vec3 uAxis;
vec3 deform(vec3 d){
  float r = uRadius;
  float w = sin(dot(d, vec3(2.3, 3.1, 1.3)) * 1.4 + uTime * 1.6 + uSeed)
          * sin(dot(d, vec3(-1.7, 1.2, 2.9)) * 1.2 - uTime * 1.2);
  r *= 1.0 + w * uWobble;
  vec3 p = d * r;
  if (uCrumple > 0.001) {
    // a deflated sac: broad wrinkles + soft pleats around the duct axis
    float n = snoise(d * 1.25 + uSeed) * 0.7 + snoise(d * 2.5 - uSeed) * 0.3;
    vec3 b1 = normalize(cross(uAxis, vec3(0.0, 0.0, 1.0)));
    vec3 b2 = cross(uAxis, b1);
    float ang = atan(dot(d, b2), dot(d, b1));
    float rim = 1.0 - abs(dot(d, uAxis));
    float pleat = sin(ang * 7.0 + n * 2.5) * rim;
    p += d * (n * 0.22 + pleat * 0.07) * uCrumple * uRadius;
  }
  float ax = dot(p, uAxis);
  p -= uAxis * ax * (1.0 - uSquash);
  return p;
}
`;

const BUBBLE_VERT = /* glsl */`
${NOISE}
${DEFORM}
varying vec3 vW;
varying vec3 vN;
varying vec3 vDir;
void main(){
  vec3 d = normalize(position);
  vec3 up = abs(d.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(d, up));
  vec3 t2 = cross(d, t1);
  vec3 p0 = deform(d);
  vec3 p1 = deform(normalize(d + t1 * 0.02));
  vec3 p2 = deform(normalize(d + t2 * 0.02));
  vec3 n = normalize(cross(p1 - p0, p2 - p0));
  vec4 wp = modelMatrix * vec4(p0, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vDir = d;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BUBBLE_FRAG = /* glsl */`
${NOISE}
${STUDIO}
uniform float uTime;
uniform float uSeed;
uniform float uCollapse;
uniform float uFade;
uniform float uBase;
uniform float uEdge;
uniform float uPow;
uniform float uRimStart;
uniform float uTint;
uniform float uSpec;
uniform float uBack;
uniform float uInk;
uniform vec3 uInkColor;
uniform vec3 uRed;
uniform vec3 uTissue;
varying vec3 vW;
varying vec3 vN;
varying vec3 vDir;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float faceK = 1.0;
  // three.js flips the winding for BackSide materials (gl_FrontFacing stays true)
  #ifdef FLIP_SIDED
    N = -N; faceK = uBack;
  #endif
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float edge = 1.0 - cosT;

  // soap-film thickness field (nm): swirling, draining (thinner at the top)
  float t = uTime;
  float n1 = snoise(vDir * 0.95 + vec3(uSeed, t * 0.05, t * 0.03));
  float n2 = snoise(vDir * 2.1 + vec3(-t * 0.04, uSeed, t * 0.02));
  float thick = 470.0 + 150.0 * n1 + 45.0 * n2 - 210.0 * vDir.y;
  thick = max(thick, 90.0);
  float sinI2 = 1.0 - cosT * cosT;
  float cosR = sqrt(max(0.0, 1.0 - sinI2 / 1.7689));
  vec3 phase = 12.5663706 * 1.33 * thick * cosR / vec3(650.0, 532.0, 450.0);
  vec3 film = 0.5 - 0.5 * cos(phase);
  float lum = dot(film, vec3(0.3333));
  film = clamp(mix(vec3(lum), film, 1.3), 0.0, 1.0);

  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(edge, 5.0);
  vec3 env = studio(R);
  vec3 spec = env * (0.18 + 0.9 * film) * (0.05 + 0.95 * F) * uSpec;

  float a = clamp(uBase + pow(smoothstep(uRimStart, 1.0, edge), uPow) * uEdge, 0.0, 1.0);
  vec3 tint = film * uTint;
  tint = mix(tint, uInkColor, smoothstep(0.72, 1.0, edge) * uInk);
  vec3 rgb = tint * a + spec;

  // atelectasis: a crumpled, wet, red-tinted shell
  if (uCollapse > 0.001) {
    vec3 L = normalize(vec3(-0.4, 0.8, 0.5));
    float shade = 0.32 + 0.68 * max(dot(N, L), 0.0);
    float ac = clamp(0.42 + 0.45 * pow(edge, 1.2), 0.0, 1.0);
    vec3 shell = mix(uRed, uTissue, 0.3 * edge) * shade * 0.85;
    rgb = mix(rgb, shell * ac + studio(R) * (0.04 + 0.5 * F) * 0.6, uCollapse);
    a = mix(a, ac, uCollapse);
  }
  gl_FragColor = vec4(rgb, a) * uFade * faceK;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${PREMUL}
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
uniform vec2 uFadeY;
uniform float uBackK;
varying vec3 vW;
varying vec3 vN;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  #ifdef FLIP_SIDED
    N = -N;
  #endif
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float edge = 1.0 - cosT;
  vec3 R = reflect(-V, N);
  float F = 0.04 + 0.96 * pow(edge, 5.0);
  vec3 spec = studio(R) * (0.10 + 0.90 * F) * uGSpec;
  float a = clamp(uGBase + pow(edge, uGPow) * uGEdge, 0.0, 1.0);
  float fade = 1.0 - smoothstep(uFadeY.x, uFadeY.y, vW.y);
  gl_FragColor = vec4(uGTint * a + spec, a) * fade * uBackK;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${PREMUL}
}
`;

/* round glowing sprites (air particles, junction glow) */
const DOT_VERT = /* glsl */`
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.001);
  vAlpha = aAlpha;
}
`;
const DOT_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uCover;
uniform float uSoft;
uniform float uOpacity;
varying float vAlpha;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float disc = 1.0 - smoothstep(0.62, 0.8, d);
  float glow = exp(-d * d * 5.0);
  float shape = mix(disc, max(disc * 0.85, glow), uSoft);
  float a = shape * vAlpha * uOpacity;
  vec3 c = mix(uColor, vec3(1.0), uSoft * 0.45 * smoothstep(0.45, 0.0, d));
  gl_FragColor = vec4(c * a, a * uCover);
  #include <colorspace_fragment>
  ${PREMUL}
}
`;

/* surfactant molecules: same deformation as the bubble they sit on */
const SURF_VERT = /* glsl */`
${NOISE}
${DEFORM}
attribute float aRand;
uniform float uScale;
uniform float uReveal;
uniform float uDotSize;
varying float vAlpha;
void main(){
  vec3 d = normalize(position);
  vec3 p = deform(d) * 1.012;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 V = normalize(cameraPosition - wp.xyz);
  vec3 n = normalize(mat3(modelMatrix) * normalize(p));
  float facing = dot(n, V);
  float vis = smoothstep(aRand * 0.8, aRand * 0.8 + 0.2, uReveal);
  float tw = 0.82 + 0.18 * sin(uTime * 2.2 + aRand * 40.0);
  vAlpha = vis * tw * mix(0.14, 1.0, smoothstep(-0.2, 0.35, facing));
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uDotSize * uScale / max(-mv.z, 0.001) * (0.6 + 0.4 * vis);
}
`;

/* ---------------------------------------------------------------- helpers */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
const col = (hex) => new THREE.Color(hex);

function tension(r, s) {
  const ts = clamp(PHYS.Tsurf0 * (r / PHYS.rSurf0), PHYS.Tmin, PHYS.Tmax);
  return lerp(PHYS.Twater, ts, s);
}

function fibonacciSphere(n) {
  const pts = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) * (2 / n);
    const rr = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts[i * 3] = Math.cos(th) * rr;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = Math.sin(th) * rr;
  }
  return pts;
}

/* ================================================================== mount */
export function mount(container, options = {}) {
  const opts = Object.assign({ theme: 'dark', orbit: true, surfactant: false }, options);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  /* renderer ------------------------------------------------------------ */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
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
  camera.position.set(framing.cx, framing.cy + 1.6, 12);
  camera.lookAt(target);

  let controls = null;
  if (opts.orbit) {
    controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.45;
    controls.minAzimuthAngle = -0.55;
    controls.maxAzimuthAngle = 0.55;
    controls.minPolarAngle = 1.15;
    controls.maxPolarAngle = 1.75;
    controls.target.copy(target);
    controls.update();
  }

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 6, 6);
  scene.add(key);

  const rig = new THREE.Group();
  scene.add(rig);

  /* shared uniforms ---------------------------------------------------- */
  const U = {
    uTime: { value: 0 },
    uEnvTop: { value: new THREE.Color() },
    uEnvBottom: { value: new THREE.Color() },
    uKey: { value: 1 }, uFill: { value: 1 }, uTop: { value: 1 },
    uBase: { value: 0 }, uEdge: { value: 0 }, uPow: { value: 2 }, uRimStart: { value: 0.3 }, uTint: { value: 1 }, uSpec: { value: 1 }, uBack: { value: 1 }, uInk: { value: 0 }, uInkColor: { value: new THREE.Color() },
    uRed: { value: new THREE.Color() }, uTissue: { value: new THREE.Color() },
    uGTint: { value: new THREE.Color() }, uGBase: { value: 0 }, uGEdge: { value: 0 }, uGPow: { value: 2 }, uGSpec: { value: 1 },
    uScale: { value: 800 },
  };
  const premulBlend = {
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };

  /* glass airway -------------------------------------------------------- */
  const leftCurve = new THREE.CubicBezierCurve3(J.clone(), J.clone().add(new THREE.Vector3(-0.6, -0.02, 0)), ML.clone().addScaledVector(AXL, -0.55), ML.clone());
  const rightCurve = new THREE.CubicBezierCurve3(J.clone(), J.clone().add(new THREE.Vector3(0.6, -0.02, 0)), MR.clone().addScaledVector(AXR, -0.55), MR.clone());
  const trunkCurve = new THREE.LineCurve3(new THREE.Vector3(0, 3.15, 0), J.clone());
  const lenL = leftCurve.getLength();
  const lenR = rightCurve.getLength();

  function glassMaterial(side, backK, fadeY) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uEnvTop: U.uEnvTop, uEnvBottom: U.uEnvBottom, uKey: U.uKey, uFill: U.uFill, uTop: U.uTop,
        uGTint: U.uGTint, uGBase: U.uGBase, uGEdge: U.uGEdge, uGPow: U.uGPow, uGSpec: U.uGSpec,
        uFadeY: { value: new THREE.Vector2(fadeY[0], fadeY[1]) }, uBackK: { value: backK },
      },
      vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, side, ...premulBlend,
    });
  }
  const airway = new THREE.Group();
  rig.add(airway);
  const tubeGeoms = [
    new THREE.TubeGeometry(leftCurve, 64, TUBE_R, 28, false),
    new THREE.TubeGeometry(rightCurve, 64, TUBE_R, 28, false),
    new THREE.TubeGeometry(trunkCurve, 8, TUBE_R * 1.12, 28, false),
  ];
  tubeGeoms.forEach((g, i) => {
    const fade = i === 2 ? [2.35, 3.1] : [50, 60];
    const back = new THREE.Mesh(g, glassMaterial(THREE.BackSide, 0.7, fade));
    back.renderOrder = 1;
    const front = new THREE.Mesh(g, glassMaterial(THREE.FrontSide, 1.0, fade));
    front.renderOrder = 4;
    airway.add(back, front);
  });
  // glass collars at the mouths (alveolar duct openings)
  const collarGeo = new THREE.TorusGeometry(TUBE_R * 1.02, 0.028, 16, 48);
  [[ML, AXL], [MR, AXR]].forEach(([m, ax]) => {
    const c = new THREE.Mesh(collarGeo, glassMaterial(THREE.FrontSide, 1.0, [50, 60]));
    c.position.copy(m).addScaledVector(ax, -0.04);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
    c.renderOrder = 4;
    airway.add(c);
  });

  /* valve (stopcock) at the junction ------------------------------------ */
  const metalMat = new THREE.MeshPhysicalMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const hubMat = new THREE.MeshPhysicalMaterial({ color: '#8d9097', metalness: 1, roughness: 0.3 });
  const leverMat = new THREE.MeshPhysicalMaterial({ color: '#f5f5f7', metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15 });
  const valve = new THREE.Group();
  valve.position.copy(J);
  rig.add(valve);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.19, 48, 32), metalMat);
  valve.add(hub);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.5, 48), hubMat);
  barrel.rotation.x = Math.PI / 2;
  valve.add(barrel);
  const leverPivot = new THREE.Group();
  leverPivot.position.z = 0.27;
  valve.add(leverPivot);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 32), metalMat);
  axle.rotation.x = Math.PI / 2;
  leverPivot.add(axle);
  const lever = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.64, 0.07, 4, 0.035), leverMat);
  lever.position.z = 0.05;
  leverPivot.add(lever);
  const leverCap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 32), metalMat);
  leverCap.rotation.x = Math.PI / 2;
  leverCap.position.z = 0.09;
  leverPivot.add(leverCap);

  /* bubbles ------------------------------------------------------------- */
  const sphereGeo = new THREE.SphereGeometry(1, 112, 80);
  const SURF_N = 240;
  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute('position', new THREE.BufferAttribute(fibonacciSphere(SURF_N), 3));
  const rands = new Float32Array(SURF_N);
  for (let i = 0; i < SURF_N; i++) rands[i] = Math.random();
  surfGeo.setAttribute('aRand', new THREE.BufferAttribute(rands, 1));
  const uSurfColor = { value: new THREE.Color() };
  const uSurfCover = { value: 0.1 };
  const uSurfSoft = { value: 1 };
  const uReveal = { value: 0 };

  function makeBubble(mouth, axis, seed) {
    const local = {
      uRadius: { value: 1 }, uSquash: { value: 1 }, uCrumple: { value: 0 }, uWobble: { value: 0.006 },
      uSeed: { value: seed }, uAxis: { value: axis.clone() }, uCollapse: { value: 0 }, uFade: { value: 1 },
    };
    const uniforms = { ...U, ...local };
    const group = new THREE.Group();
    rig.add(group);
    const back = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, side: THREE.BackSide, ...premulBlend }));
    back.renderOrder = 2;
    const front = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: BUBBLE_VERT, fragmentShader: BUBBLE_FRAG, side: THREE.FrontSide, ...premulBlend }));
    front.renderOrder = 5;
    back.frustumCulled = front.frustumCulled = false;
    const surf = new THREE.Points(surfGeo, new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms, uReveal, uDotSize: { value: 0.05 },
        uColor: uSurfColor, uCover: uSurfCover, uSoft: uSurfSoft, uOpacity: { value: 1 },
      },
      vertexShader: SURF_VERT, fragmentShader: DOT_FRAG, toneMapped: false, ...premulBlend,
    }));
    surf.renderOrder = 6;
    surf.frustumCulled = false;
    group.add(back, front, surf);
    return { group, local, mouth, axis, back, front, surf, rv: 1, squash: 1 };
  }
  const bSmall = makeBubble(ML, AXL, 1.7);
  const bLarge = makeBubble(MR, AXR, 7.3);
  bSmall.surf.material.uniforms.uDotSize.value = 0.05;
  bLarge.surf.material.uniforms.uDotSize.value = 0.05;

  /* soft contact shadows (light theme) ---------------------------------- */
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const FLOOR_Y = -1.95;
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  const mkShadow = () => {
    const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.1, toneMapped: false }));
    m.position.y = FLOOR_Y;
    m.renderOrder = 0;
    rig.add(m);
    return m;
  };
  const shSmall = mkShadow();
  const shLarge = mkShadow();

  /* air particles -------------------------------------------------------- */
  const NP = 46, TRAIL = 4, NPT = NP * TRAIL;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(NPT * 3);
  const pAlpha = new Float32Array(NPT);
  const pSize = new Float32Array(NPT);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const uAirColor = { value: new THREE.Color() };
  const uAirCover = { value: 0.15 };
  const uAirSoft = { value: 1 };
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uScale: U.uScale, uColor: uAirColor, uCover: uAirCover, uSoft: uAirSoft, uOpacity: { value: 1 } },
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, toneMapped: false, ...premulBlend,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  rig.add(points);
  const parts = [];
  const randUnit = () => {
    const v = new THREE.Vector3();
    do { v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (v.lengthSq() > 1);
    return v;
  };
  for (let i = 0; i < NP; i++) parts.push({ f: i / NP, off: randUnit(), jit: 0.85 + Math.random() * 0.3, ph: Math.random() * 6.283, s: 0 });

  // junction glow
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([J.x, J.y, J.z + 0.05]), 3));
  gGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array([0]), 1));
  gGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([0.62]), 1));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uScale: U.uScale, uColor: uAirColor, uCover: { value: 0 }, uSoft: { value: 1 }, uOpacity: { value: 1 } },
    vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, toneMapped: false, ...premulBlend,
  });
  const glow = new THREE.Points(gGeo, glowMat);
  glow.frustumCulled = false;
  glow.renderOrder = 7;
  rig.add(glow);

  /* --------------------------------------------------------------- state */
  const sim = {
    V1: PHYS.r1 ** 3, V2: PHYS.r2 ** 3,
    surfTarget: opts.surfactant ? 1 : 0, surfLin: opts.surfactant ? 1 : 0, surf: opts.surfactant ? 1 : 0,
    valveTarget: 0, valveLin: 0,
    collapsed: false, crumple: 0, collapseAnim: 0,
    Q: 0, flowVis: 0, stableVis: 0,
    phase: 'idle',             // idle | running | settled | resetting
    runTime: 0, quietTime: 0,
    reset: null, queuedPlay: false,
  };
  let theme = opts.theme === 'light' ? 'light' : 'dark';
  let elapsed = 0;
  let running = false, started = false, disposed = false;
  let raf = 0;
  const clock = new THREE.Clock(false);
  const listeners = new Set();
  let lastState = null;

  /* --------------------------------------------------------------- theme */
  function applyTheme() {
    const T = TOKENS[theme], L = LOOK[theme];
    U.uEnvTop.value.set(L.envTop);
    U.uEnvBottom.value.set(L.envBottom);
    U.uKey.value = L.key; U.uFill.value = L.fill; U.uTop.value = L.top;
    U.uBase.value = L.bubble.base; U.uEdge.value = L.bubble.edge; U.uPow.value = L.bubble.pow; U.uRimStart.value = L.bubble.start;
    U.uTint.value = L.bubble.tint; U.uSpec.value = L.bubble.spec; U.uBack.value = L.bubble.back;
    U.uInk.value = L.bubble.ink; U.uInkColor.value.set(T.text).multiplyScalar(0.6);
    U.uRed.value.set(T.red); U.uTissue.value.set(T.tissue);
    U.uGTint.value.set(L.glass.tint); U.uGBase.value = L.glass.base; U.uGEdge.value = L.glass.edge;
    U.uGPow.value = L.glass.pow; U.uGSpec.value = L.glass.spec;
    uAirColor.value.set(T.blue); uAirCover.value = L.dotCover; uAirSoft.value = L.dotSoft;
    uSurfColor.value.set(T.yellow); uSurfCover.value = theme === 'dark' ? 0.2 : 1.0; uSurfSoft.value = L.dotSoft;
    metalMat.color.set(L.metal); metalMat.roughness = L.metalRough;
    hubMat.color.set(L.hub);
    leverMat.color.set(L.lever);
    shSmall.visible = shLarge.visible = theme === 'light';
    key.intensity = theme === 'dark' ? 1.6 : 1.2;
  }

  /* ------------------------------------------------------------- physics */
  const rOf = (v) => Math.cbrt(Math.max(v, 1e-6));
  function pressures(r1, r2) {
    const T1 = tension(r1, sim.surf), T2 = tension(r2, sim.surf);
    return { T1, T2, P1: (2 * T1) / r1, P2: (2 * T2) / r2 };
  }
  function physicsStep(dt) {
    // surfactant level eases (0.8 s)
    const sDir = Math.sign(sim.surfTarget - sim.surfLin);
    sim.surfLin = clamp(sim.surfLin + sDir * dt / 0.8, 0, 1);
    if (sDir > 0) sim.surfLin = Math.min(sim.surfLin, sim.surfTarget);
    sim.surf = smooth(sim.surfLin);

    // valve lever animation (0.9 s)
    const vDir = Math.sign(sim.valveTarget - sim.valveLin);
    sim.valveLin = clamp(sim.valveLin + vDir * dt / 0.9, 0, 1);

    if (sim.phase === 'resetting') {
      const R = sim.reset;
      R.t = Math.min(1, R.t + dt / R.dur);
      const e = easeInOut(R.t);
      const r1 = lerp(R.r1, PHYS.r1, e), r2 = lerp(R.r2, PHYS.r2, e);
      sim.V1 = r1 ** 3; sim.V2 = r2 ** 3;
      sim.crumple = lerp(R.crumple, 0, e);
      sim.collapseAnim = lerp(R.collapseAnim, 0, e);
      sim.Q = 0;
      if (R.t >= 1) {
        sim.V1 = PHYS.r1 ** 3; sim.V2 = PHYS.r2 ** 3;
        sim.crumple = 0; sim.collapseAnim = 0; sim.collapsed = false;
        sim.phase = 'idle';
        sim.reset = null;
        if (sim.queuedPlay) { sim.queuedPlay = false; openValve(); }
      }
      return;
    }

    const cond = smoothstep(0.35, 1.0, sim.valveLin);
    let Q = 0;
    if (cond > 0 && !sim.collapsed) {
      const sub = 4, h = dt / sub;
      for (let k = 0; k < sub; k++) {
        const r1 = rOf(sim.V1), r2 = rOf(sim.V2);
        const { P1, P2 } = pressures(r1, r2);
        Q = PHYS.G * cond * (P1 - P2);
        Q = PHYS.Qmax * Math.tanh(Q / PHYS.Qmax);
        sim.V1 = Math.max(sim.V1 - Q * h, 0);
        sim.V2 = VTOT - sim.V1;
        if (sim.V1 <= PHYS.rCollapse ** 3) {
          sim.V1 = PHYS.rCollapse ** 3;
          sim.V2 = VTOT - sim.V1;
          sim.collapsed = true;
          Q = 0;
          break;
        }
        // keep the large one from emptying in any odd configuration
        if (sim.V2 <= PHYS.rCollapse ** 3) { sim.V2 = PHYS.rCollapse ** 3; sim.V1 = VTOT - sim.V2; Q = 0; break; }
      }
    }
    sim.Q = Q;

    // crumple follows the radius, then completes once collapsed
    const r1 = rOf(sim.V1);
    const crTarget = sim.collapsed ? 1 : smoothstep(0.36, PHYS.rCollapse, r1);
    sim.crumple += (crTarget - sim.crumple) * (1 - Math.exp(-dt * 7));
    if (sim.collapsed) sim.collapseAnim = Math.min(1, sim.collapseAnim + dt / 0.7);

    if (sim.phase === 'running') {
      sim.runTime += dt;
      if (Math.abs(Q) < 2e-4) sim.quietTime += dt; else sim.quietTime = 0;
      if ((sim.collapsed && sim.collapseAnim >= 1) || (sim.valveLin >= 1 && sim.quietTime > 1.6 && sim.runTime > 3.2)) sim.phase = 'settled';
    }
  }

  function openValve() {
    sim.valveTarget = 1;
    sim.phase = 'running';
    sim.runTime = 0;
    sim.quietTime = 0;
  }

  /* ----------------------------------------------------- visual updates */
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function layoutBubble(b, rPhys, crumple, collapseAnim, t) {
    const c = smooth(crumple);
    const rv = lerp(rPhys, 0.34, c);
    const squash = lerp(1, 0.3, c);
    b.rv = rv;
    b.squash = squash;
    b.local.uRadius.value = rv;
    b.local.uSquash.value = squash;
    b.local.uCrumple.value = c;
    b.local.uCollapse.value = Math.max(c * 0.85, collapseAnim);
    b.local.uWobble.value = 0.006 * (1 - c) + 0.004 * Math.max(0, sim.valveLin * (1 - sim.valveLin)) * 4;
    b.group.position.copy(b.mouth).addScaledVector(b.axis, rv * squash * INSET);
    return rv;
  }

  function bubbleCenter(b, out) { return out.copy(b.mouth).addScaledVector(b.axis, b.rv * b.squash * INSET); }

  const posTmp = new THREE.Vector3();
  function pathPoint(s, off, L, out) {
    // A: small centre → left mouth  |  B: left tube → junction → right tube  |  C: right mouth → large centre
    const c1 = bubbleCenter(bSmall, tmpA);
    const c2 = bubbleCenter(bLarge, tmpB);
    const LA = L.A, LB1 = lenL, LB2 = lenR, LC = L.C;
    if (s < LA) {
      const t = s / LA;
      out.copy(c1).lerp(ML, t).addScaledVector(off, lerp(bSmall.rv * 0.5 * bSmall.squash, TUBE_R * 0.4, t));
    } else if (s < LA + LB1) {
      const t = (s - LA) / LB1;
      leftCurve.getPointAt(1 - t, out).addScaledVector(off, TUBE_R * 0.4);
    } else if (s < LA + LB1 + LB2) {
      const t = (s - LA - LB1) / LB2;
      rightCurve.getPointAt(t, out).addScaledVector(off, TUBE_R * 0.4);
    } else {
      const t = clamp((s - LA - LB1 - LB2) / LC, 0, 1);
      out.copy(MR).lerp(c2, t).addScaledVector(off, lerp(TUBE_R * 0.4, bLarge.rv * 0.55, t));
    }
    return out;
  }

  function updateParticles(dt) {
    const c1 = bubbleCenter(bSmall, tmpA).clone();
    const c2 = bubbleCenter(bLarge, tmpB).clone();
    const L = { A: Math.max(c1.distanceTo(ML), 0.05), C: Math.max(c2.distanceTo(MR), 0.05) };
    const total = L.A + lenL + lenR + L.C;
    const q = sim.Q;
    const flowTarget = smoothstep(0.0003, 0.003, Math.abs(q));
    sim.flowVis += (flowTarget - sim.flowVis) * (1 - Math.exp(-dt * 4));
    const openVis = smooth(sim.valveLin);
    const stableTarget = (sim.phase !== 'resetting' && !sim.collapsed && sim.valveLin > 0.5) ? (1 - flowTarget) : 0;
    sim.stableVis += (stableTarget - sim.stableVis) * (1 - Math.exp(-dt * 3));
    const speed = Math.abs(q) > 1e-5 ? Math.sign(q) * (0.25 + Math.min(Math.abs(q) * 52, 2.9)) : 0;
    const flowA = sim.flowVis * openVis;
    const stabA = sim.stableVis * 0.75;
    const trailGap = Math.min(0.03 + Math.abs(speed) * 0.05, 0.16);
    const trailK = smoothstep(0.4, 1.4, Math.abs(speed));
    const tubeStart = L.A, tubeEnd = L.A + lenL + lenR;
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      p.f += (speed * p.jit * dt) / total;
      if (p.f > 1) { p.f -= 1; p.off = randUnit(); }
      if (p.f < 0) { p.f += 1; p.off = randUnit(); }
      // calm Brownian sway (visible in the stable state)
      const sway = Math.sin(elapsed * 0.7 + p.ph) * 0.05 + Math.sin(elapsed * 0.31 + p.ph * 2.0) * 0.03;
      const s = clamp(p.f * total + sway * sim.stableVis, 0, total - 1e-4);
      // region alphas
      const aFlow = smoothstep(0, L.A * 0.6, s) * (1 - smoothstep(total - L.C * 0.75, total, s));
      const aStab = smoothstep(tubeStart, tubeStart + 0.25, s) * (1 - smoothstep(tubeEnd - 0.25, tubeEnd, s));
      const alpha = clamp(flowA * aFlow + stabA * aStab, 0, 1);
      for (let k = 0; k < TRAIL; k++) {
        const idx = i * TRAIL + k;
        const sk = clamp(s - Math.sign(speed || 1) * k * trailGap, 0, total - 1e-4);
        pathPoint(sk, p.off, L, posTmp);
        pPos[idx * 3] = posTmp.x; pPos[idx * 3 + 1] = posTmp.y; pPos[idx * 3 + 2] = posTmp.z;
        if (k === 0) { pAlpha[idx] = alpha; pSize[idx] = 0.1; }
        else { pAlpha[idx] = alpha * trailK * 0.55 * (1 - k / TRAIL); pSize[idx] = 0.1 * (1 - k * 0.16); }
      }
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.aAlpha.needsUpdate = true;
    pGeo.attributes.aSize.needsUpdate = true;
    // junction glow while air is flowing
    gGeo.attributes.aAlpha.array[0] = 0.22 * sim.flowVis * openVis * (theme === 'dark' ? 1 : 0.0);
    gGeo.attributes.aAlpha.needsUpdate = true;
  }

  function updateVisuals(dt) {
    U.uTime.value = elapsed;
    const r1 = rOf(sim.V1), r2 = rOf(sim.V2);
    layoutBubble(bSmall, r1, sim.crumple, sim.collapseAnim, elapsed);
    layoutBubble(bLarge, r2, 0, 0, elapsed);
    uReveal.value = sim.surf * 1.0;
    // lever: vertical = closed, horizontal = open (in line with the flow)
    leverPivot.rotation.z = -easeInOut(sim.valveLin) * Math.PI / 2;
    // contact shadows
    const c1 = bubbleCenter(bSmall, tmpA), c2 = bubbleCenter(bLarge, tmpB);
    shSmall.position.set(c1.x, FLOOR_Y, c1.z);
    shSmall.scale.setScalar(bSmall.rv * 2.6);
    shSmall.material.opacity = 0.09 * (1 - 0.5 * smooth(sim.crumple));
    shLarge.position.set(c2.x, FLOOR_Y, c2.z);
    shLarge.scale.setScalar(bLarge.rv * 2.6);
    shLarge.material.opacity = 0.09;
    rig.position.y = Math.sin(elapsed * 0.45) * 0.025;
    updateParticles(dt);
  }

  /* --------------------------------------------------------------- state */
  function computeState() {
    const r1 = rOf(sim.V1), r2 = rOf(sim.V2);
    const { T1, T2, P1, P2 } = pressures(r1, r2);
    const toCm = (P) => (P / PHYS.unitCm) / DYN_PER_CMH2O;   // 2T/r with r in cm → dyn/cm² → cmH2O
    const q = sim.Q;
    const flowDir = Math.abs(q) > 4e-4 ? (q > 0 ? 1 : -1) : 0;
    return {
      r1, r2, T1, T2, P1, P2,
      P1cm: toCm(P1), P2cm: toCm(P2),
      flowDir,
      collapsed: sim.collapsed,
      valveOpen: sim.valveTarget > 0.5,
      surfactant: sim.surfTarget > 0.5,
      phase: sim.phase,
    };
  }
  function emit() {
    if (!listeners.size) return;
    lastState = computeState();
    listeners.forEach((cb) => { try { cb(lastState); } catch (e) { console.error(e); } });
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
    const dist = Math.max(framing.hh / tanV, framing.hw / (tanV * camera.aspect)) + 1.2;
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
    physicsStep(dt);
    updateVisuals(dt);
    if (controls) controls.update();
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    tick(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
    emit();
  }

  applyTheme();
  resize();
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
    },
    dispose() {
      if (disposed) return;
      api.stop();
      disposed = true;
      ro.disconnect();
      if (controls) controls.dispose();
      listeners.clear();
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => { if (!seen.has(m)) { seen.add(m); if (m.map) m.map.dispose(); m.dispose(); } });
      });
      shadowTex.dispose();
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
    setSurfactant(on) {
      sim.surfTarget = on ? 1 : 0;
      if (sim.phase === 'settled' && !sim.collapsed) { sim.phase = 'running'; sim.runTime = 0; sim.quietTime = 0; }
    },
    play() {
      if (disposed) return;
      if (sim.phase === 'running') return;
      if (sim.phase === 'resetting') { sim.queuedPlay = true; return; }
      if (sim.phase === 'idle' && sim.valveTarget === 0 && sim.valveLin === 0) { openValve(); return; }
      api.reset();
      sim.queuedPlay = true;
    },
    reset() {
      sim.queuedPlay = false;
      sim.valveTarget = 0;
      const r1 = rOf(sim.V1), r2 = rOf(sim.V2);
      const atRest = Math.abs(r1 - PHYS.r1) < 1e-4 && Math.abs(r2 - PHYS.r2) < 1e-4 && sim.crumple < 1e-3;
      if (atRest && sim.phase !== 'resetting') { sim.phase = 'idle'; sim.collapsed = false; sim.Q = 0; return; }
      sim.reset = { t: 0, dur: 1.0, r1, r2, crumple: sim.crumple, collapseAnim: sim.collapseAnim };
      sim.phase = 'resetting';
      sim.collapsed = false;
      sim.Q = 0;
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
        const visible = camSpace.z < 0 && x >= 0 && x <= cw && y >= 0 && y <= ch;
        return { x, y, visible };
      };
      const c1 = bubbleCenter(bSmall, new THREE.Vector3());
      const c2 = bubbleCenter(bLarge, new THREE.Vector3());
      return {
        small: proj(c1),
        large: proj(c2),
        junction: proj(J),
        smallBelow: proj(c1.clone().add(new THREE.Vector3(0, -(bSmall.rv * bSmall.squash + 0.18), 0))),
        largeBelow: proj(c2.clone().add(new THREE.Vector3(0, -(bLarge.rv + 0.18), 0))),
        valve: proj(J.clone().add(new THREE.Vector3(0, 0.45, 0.3))),
      };
    },
    getState: () => computeState(),
    // test hook: advance the simulation synchronously (e.g. when rAF is paused in a hidden tab)
    _debug: { advance(sec, fps = 60) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) tick(1 / fps); renderer.render(scene, camera); emit(); } },
  };
  return api;
}

export default { mount };
