/* =========================================================================
   lungs.js — procedural breathing lungs + bronchial tree + cutaway thorax
   Three.js r160 · no network · Pulmonary Mechanics deck module

   mount(container, { mode: 'hero' | 'thorax', autoRotate: true, interactive: true, theme: 'dark' })
   → controller (see bottom of file)

   Coordinates (rest frame, ~1 unit ≈ 10 cm): +y up, +z anterior (towards the
   viewer), patient's RIGHT lung at x < 0 (viewer's left), LEFT lung at x > 0.
   Every moving part (lungs, pleura, bronchi, alveoli, diaphragm, ribs, skin)
   is deformed on the GPU by the same `breathe()` field, mirrored in JS for
   the HTML anchors, so everything stays glued together while breathing.
   ========================================================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ constants */

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const APEX = 1.10;                                 // vertical stretch anchor (lung apex)
const CENTER = new V3(0, 0.15, -0.06);             // disease scaling centre
const HILUM_L = new V3(0.30, 0.30, -0.08);         // left-lung collapse centre (pneumothorax)
const TRACHEA_TOP = new V3(0, 1.84, -0.08);
const CARINA = new V3(0, 0.70, -0.08);
const PHI_CUT = 2.22;                              // chest wall kept for |phi| < PHI_CUT (phi = 0 posterior)
const MAXGEN = 7;                                  // bronchial generations (trachea = 0)

const PAL = {
  dark: {
    bg: 0x000000, yellow: '#ffd60a',
    lung: { face: '#0b3a8f', mid: '#2997ff', rim: '#64d2ff', fiss: '#b8eeff', spec: '#e6f7ff', fib: '#d23a55', aFace: 0.085, aRim: 0.95, specK: 1.0 },
    lungBack: { aFace: 0.05, aRim: 0.32, specK: 0.25 },
    alv: { col: '#8fd9ff', fib: '#ff7b8e', alpha: 0.6, size: 0.03 },
    bron: { col: '#2997ff', em: 0.1, ring: '#a9d6ff', env: 0.7 },
    pleura: { face: '#30d158', mid: '#30d158', rim: '#7dffa4', air: '#cfeeff', aFace: 0.0, aRim: 0.5, specK: 0.15 },
    skin: { face: '#bf5af2', mid: '#bf5af2', rim: '#d49cff', aFace: 0.015, aRim: 0.2, specK: 0.3 },
    dia: { face: '#5a2387', mid: '#a957e0', rim: '#e8b8ff', aFace: 0.5, aRim: 0.92, specK: 0.7 },
    bulla: { face: '#64d2ff', mid: '#8fdfff', rim: '#e4f8ff', aFace: 0.05, aRim: 1.0, specK: 0.9 },
    rib: { col: '#bf5af2', em: 0.05, env: 0.55 },
    air: { core: '#effcff', edge: '#64d2ff', alpha: 0.9 },
    ring: { col: '#64d2ff', em: 0.55 },
  },
  light: {
    bg: 0xfbfbfd, yellow: '#c9a400',
    lung: { face: '#f8bcc7', mid: '#e8657d', rim: '#c23b57', fiss: '#a4243f', spec: '#ffffff', fib: '#8a1a30', aFace: 0.30, aRim: 0.92, specK: 0.9 },
    lungBack: { aFace: 0.12, aRim: 0.3, specK: 0.2 },
    alv: { col: '#c2405b', fib: '#6e0f22', alpha: 0.75, size: 0.03 },
    bron: { col: '#0071e3', em: 0.08, ring: '#7db8f7', env: 1.0 },
    pleura: { face: '#1f9d48', mid: '#1f9d48', rim: '#1f9d48', air: '#4aa6e0', aFace: 0.0, aRim: 0.55, specK: 0.1 },
    skin: { face: '#9b3fd1', mid: '#9b3fd1', rim: '#8a34bf', aFace: 0.02, aRim: 0.26, specK: 0.3 },
    dia: { face: '#d6aef2', mid: '#a35fd6', rim: '#7d2db0', aFace: 0.55, aRim: 0.9, specK: 0.5 },
    bulla: { face: '#f3a6b4', mid: '#d4506a', rim: '#8e1f39', aFace: 0.08, aRim: 1.0, specK: 0.8 },
    rib: { col: '#9b3fd1', em: 0.05, env: 1.0 },
    air: { core: '#ffffff', edge: '#0071e3', alpha: 1.0 },
    ring: { col: '#0071e3', em: 0.45 },
  },
};

// deformation "personalities" (GPU uniforms + JS twin)
const K_LUNG = { scaleK: 1, collapseK: 1, springK: 0, descentK: 1 };
const K_PLEURA = { scaleK: 1, collapseK: 0, springK: 1, descentK: 1 };
const K_CHEST = { scaleK: 0.85, collapseK: 0, springK: 1, descentK: 0 };
const K_DIA = { scaleK: 1, collapseK: 0, springK: 0, descentK: 1 };

/* ------------------------------------------------------------------ math helpers */

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => t * t * (3 - 2 * t);
const ease5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ shared deformation field (JS twin) */

function domeSum(x, z) {
  const ax = x + 0.55, bx = x - 0.58;
  return 0.66 * Math.exp(-(ax * ax / 0.30 + z * z / 0.45)) + 0.56 * Math.exp(-(bx * bx / 0.30 + z * z / 0.45));
}
function diaY(x, z) { return -1.50 + domeSum(x, z) - 0.14 * (1 - smoothstep(-0.6, 0.1, z)); }

function breatheJS(p, side, S, K, out) {
  const ds = domeSum(p.x, p.z);
  const yd = -1.50 + ds - 0.14 * (1 - smoothstep(-0.6, 0.1, p.z));
  const cw = clamp(side, 0, 1) * K.collapseK;
  const v = S.volEff * (1 - S.pneumo * cw);
  const w = clamp((APEX - p.y) / (APEX - yd), 0, 1);
  const top = 1 - smoothstep(APEX - 0.15, APEX + 0.25, p.y);
  const g = (0.35 + 0.65 * w) * top;
  let x = p.x, y = p.y, z = p.z;
  y -= (v * (0.06 + 0.2 * ds / 0.66) + S.emph * 0.40 * ds) * w * K.descentK;
  x += v * 0.075 * p.x * g;
  z += v * 0.09 * (p.z + 0.65) * g;
  x += S.pneumo * K.springK * 0.07 * smoothstep(0.05, 0.6, p.x);
  const s = 1 + (S.dScale - 1) * K.scaleK;
  x = CENTER.x + (x - CENTER.x) * s; y = CENTER.y + (y - CENTER.y) * s; z = CENTER.z + (z - CENTER.z) * s;
  const hx = CENTER.x + (HILUM_L.x - CENTER.x) * s, hy = CENTER.y + (HILUM_L.y - CENTER.y) * s, hz = CENTER.z + (HILUM_L.z - CENTER.z) * s;
  const c = 1 - 0.42 * S.pneumo * cw;
  return out.set(hx + (x - hx) * c, hy + (y - hy) * c, hz + (z - hz) * c);
}

/* ------------------------------------------------------------------ GLSL */

const GLSL_NOISE = /* glsl */`
float lhash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lhash(i), lhash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(lhash(i + vec3(0.0, 1.0, 0.0)), lhash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(lhash(i + vec3(0.0, 0.0, 1.0)), lhash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(lhash(i + vec3(0.0, 1.0, 1.0)), lhash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

const f3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform float uVolEff;
uniform float uEmph;
uniform float uFib;
uniform float uDScale;
uniform float uPneumo;
uniform float uPulse;
uniform float uScaleK;
uniform float uCollapseK;
uniform float uSpringK;
uniform float uDescentK;
${GLSL_NOISE}
float domeSum(vec2 xz) {
  vec2 a = vec2(xz.x + 0.55, xz.y);
  vec2 b = vec2(xz.x - 0.58, xz.y);
  return 0.66 * exp(-(a.x * a.x / 0.30 + a.y * a.y / 0.45)) + 0.56 * exp(-(b.x * b.x / 0.30 + b.y * b.y / 0.45));
}
vec3 breathe(vec3 p, float side) {
  float ds = domeSum(p.xz);
  float yd = -1.50 + ds - 0.14 * (1.0 - smoothstep(-0.6, 0.1, p.z));
  float cw = clamp(side, 0.0, 1.0) * uCollapseK;
  float v = uVolEff * (1.0 - uPneumo * cw);
  float w = clamp((${APEX.toFixed(3)} - p.y) / (${APEX.toFixed(3)} - yd), 0.0, 1.0);
  float top = 1.0 - smoothstep(${(APEX - 0.15).toFixed(3)}, ${(APEX + 0.25).toFixed(3)}, p.y);
  float g = (0.35 + 0.65 * w) * top;
  vec3 q = p;
  q.y -= (v * (0.06 + 0.2 * ds / 0.66) + uEmph * 0.40 * ds) * w * uDescentK;
  q.x += v * 0.075 * p.x * g;
  q.z += v * 0.09 * (p.z + 0.65) * g;
  q.x += uPneumo * uSpringK * 0.07 * smoothstep(0.05, 0.6, p.x);
  float s = 1.0 + (uDScale - 1.0) * uScaleK;
  vec3 C = ${f3(CENTER)};
  q = C + (q - C) * s;
  vec3 H = C + (${f3(HILUM_L)} - C) * s;
  return H + (q - H) * (1.0 - 0.42 * uPneumo * cw);
}
void breatheFrame(vec3 p, vec3 n, float side, out vec3 bp, out vec3 bn) {
  bp = breathe(p, side);
  const float e = 0.015;
  vec3 jx = (breathe(p + vec3(e, 0.0, 0.0), side) - bp) / e;
  vec3 jy = (breathe(p + vec3(0.0, e, 0.0), side) - bp) / e;
  vec3 jz = (breathe(p + vec3(0.0, 0.0, e), side) - bp) / e;
  bn = normalize(transpose(inverse(mat3(jx, jy, jz))) * n);
}
`;

/* glass shell (lungs, pleura, skin, diaphragm, bullae) */
const GLASS_VERT = /* glsl */`
${GLSL_COMMON}
attribute float aSide;
attribute float aFiss;
attribute float aEdge;
#ifdef INSTANCED
attribute float iSide;
#endif
uniform float uInflate;
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vRest;
varying float vFiss;
varying float vEdge;
float rough(vec3 p) { return vnoise(p * 7.0) * 0.65 + vnoise(p * 17.0) * 0.35 - 0.5; }
void main() {
  vec3 p = position;
  vec3 n = normalize(normal);
  float side = aSide;
#ifdef INSTANCED
  p = (instanceMatrix * vec4(position, 1.0)).xyz;
  n = normalize(mat3(instanceMatrix) * normal);
  side = iSide;
#endif
  vRest = p;
#ifdef USE_ROUGH
  if (uFib > 0.002) {
    float amp = 0.045 * uFib;
    float h0 = rough(p);
    const float e = 0.01;
    vec3 gr = vec3(rough(p + vec3(e, 0.0, 0.0)) - h0, rough(p + vec3(0.0, e, 0.0)) - h0, rough(p + vec3(0.0, 0.0, e)) - h0) / e;
    gr -= n * dot(gr, n);
    p += n * h0 * amp;
    n = normalize(n - gr * amp * 0.9);
  }
#endif
  p += n * uInflate;
  vec3 bp; vec3 bn;
  breatheFrame(p, n, side, bp, bn);
  vec4 wp = modelMatrix * vec4(bp, 1.0);
  vWP = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * bn);
  vFiss = aFiss;
  vEdge = aEdge;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GLASS_FRAG = /* glsl */`
uniform float uFib;
uniform float uEmph;
uniform float uPulse;
uniform vec3 uKeyDir;
uniform vec3 uYellow;
uniform vec3 uColFace;
uniform vec3 uColMid;
uniform vec3 uColRim;
uniform vec3 uColSpec;
uniform vec3 uColFiss;
uniform vec3 uColFib;
uniform vec3 uColAir;
uniform float uAlphaFace;
uniform float uAlphaRim;
uniform float uSpecK;
uniform float uBack;
uniform float uHL;
uniform float uHLFace;
uniform float uDim;
uniform float uVis;
uniform float uAir;
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vRest;
varying float vFiss;
varying float vEdge;
${GLSL_NOISE}
float softbox(vec3 R) {
  float top = smoothstep(0.55, 0.92, R.y) * 0.7;
  float s1 = smoothstep(0.86, 0.975, dot(R, normalize(vec3(-0.78, 0.30, 0.55))));
  float s2 = smoothstep(0.82, 0.96, dot(R, normalize(vec3(0.85, 0.15, -0.50)))) * 0.7;
  float s3 = smoothstep(0.90, 0.985, dot(R, normalize(vec3(0.60, 0.45, 0.66)))) * 0.5;
  return top + s1 + s2 + s3;
}
void main() {
  vec3 N = normalize(vWN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWP);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.2);
  vec3 col = mix(uColFace, uColMid, smoothstep(0.0, 0.55, fr));
  col = mix(col, uColRim, smoothstep(0.3, 1.0, fr));
  col *= 0.62 + 0.38 * (0.5 + 0.5 * dot(N, uKeyDir));
  float a = mix(uAlphaFace, uAlphaRim, fr);
#ifdef USE_FISS
  col = mix(col, uColFiss, vFiss * 0.8);
  a = mix(a, max(a, 0.8), vFiss * 0.85);
#endif
#ifdef USE_FIB
  float m = vnoise(vRest * 11.0) * 0.6 + vnoise(vRest * 27.0) * 0.4;
  col = mix(col, uColFib * (0.5 + 0.75 * m), uFib * 0.85);
  a += uFib * (0.20 + 0.28 * m) * (1.0 - 0.5 * fr);
  a *= 1.0 - 0.35 * uEmph;
#endif
#ifdef USE_STRIPES
  float ang = atan(vRest.z + 0.08, vRest.x);
  float st = 0.5 + 0.5 * cos(ang * 64.0);
  float rad = length(vec2(vRest.x / 1.3, (vRest.z + 0.08) / 0.8));
  float tendon = 1.0 - smoothstep(0.18, 0.34, rad);
  col *= mix(0.82 + 0.18 * st, 1.15, tendon);
#endif
#ifdef USE_EDGE
  col = mix(col, uColRim, vEdge);
  a = max(a, vEdge * 0.85);
#endif
  col = mix(col, uColAir, uAir * 0.85);
  a = mix(a, a + 0.12 + 0.3 * fr, uAir);
  vec3 R = reflect(-V, N);
  float env = softbox(R);
  vec3 H = normalize(uKeyDir + V);
  float spec = pow(max(dot(N, H), 0.0), 80.0);
  float sp = (env * 0.5 + spec) * uSpecK * (1.0 - 0.75 * uBack);
  col += uColSpec * sp;
  a = clamp(a + sp * 0.4, 0.0, 1.0);
  float hl = uHL * (0.6 + 0.4 * uPulse) * (1.0 - 0.55 * uBack);
  float hk = min(uHLFace * 2.2, 0.4);
  col = mix(col, uYellow, clamp(hl * (hk + (1.0 - hk) * fr), 0.0, 1.0));
  a = mix(a, max(a, uHLFace + (0.9 - uHLFace) * fr), hl);
  a *= mix(0.25, 1.0, uDim) * uVis;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* alveolar point cloud */
const ALV_VERT = /* glsl */`
${GLSL_COMMON}
attribute float aSide;
attribute float aSeed;
attribute float aSize;
attribute float aBulla;
uniform float uPx;
uniform float uSize;
uniform float uKeep;
uniform float uVis;
varying float vA;
void main() {
  vec3 p = breathe(position, aSide);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float vis = smoothstep(uKeep - 0.04, uKeep + 0.04, aSeed);
  vis *= 1.0 - aBulla * uEmph;
  float s2 = fract(aSeed * 7.13);
  float tw = 0.5 + 0.5 * sin(uTime * (0.55 + s2 * 1.4) + s2 * 61.0);
  vA = vis * (0.25 + 0.75 * tw) * uVis;
  gl_PointSize = uSize * aSize * (1.0 + 0.3 * uFib) * uPx / max(-mv.z, 0.1);
}
`;
const ALV_FRAG = /* glsl */`
uniform float uFib;
uniform float uPulse;
uniform vec3 uCol;
uniform vec3 uColFib;
uniform vec3 uYellow;
uniform float uAlpha;
uniform float uHL;
uniform float uDim;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vA < 0.003) discard;
  float soft = (1.0 - d); soft *= soft;
  float core = smoothstep(0.42, 0.0, d);
  vec3 col = mix(uCol, uColFib, uFib);
  col = mix(col, uYellow, uHL * (0.6 + 0.4 * uPulse) * 0.85);
  float a = (soft * 0.75 + core * 0.55) * vA * uAlpha * mix(0.25, 1.0, uDim);
  gl_FragColor = vec4(col * (1.0 + core * 0.5), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* air particles (stream through the airways) */
const AIR_VERT = /* glsl */`
${GLSL_COMMON}
attribute float aSide;
attribute float aA;
uniform float uPx;
uniform float uSize;
uniform float uOn;
varying float vA;
void main() {
  vec3 p = breathe(position, aSide);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = aA * uOn;
  gl_PointSize = uSize * uPx / max(-mv.z, 0.1);
}
`;
const AIR_FRAG = /* glsl */`
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uAlpha;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0 || vA < 0.003) discard;
  float core = smoothstep(0.55, 0.15, d);
  float halo = (1.0 - d); halo *= halo;
  vec3 col = mix(uEdge, uCore, core);
  float a = clamp(core + halo * 0.7, 0.0, 1.0) * vA * uAlpha;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------ procedural model (built once, cached) */

function sdEll(px, py, pz, rx, ry, rz) {
  const a = px / rx, b = py / ry, c = pz / rz;
  const k0 = Math.sqrt(a * a + b * b + c * c);
  const d = px / (rx * rx), e = py / (ry * ry), f = pz / (rz * rz);
  const k1 = Math.sqrt(d * d + e * e + f * f);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : k0 * (k0 - 1) / k1;
}
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

// [cx(lateral), cy, cz, rx, ry, rz, taper, medialShift] in lateral-positive local coords.
// taper narrows the upper lobe towards the apex (conical apex, flared base).
const LUNG_E = {
  R: [[0.58, -0.05, -0.07, 0.50, 1.13, 0.54, 0.38, 0.14], [0.63, -0.78, -0.05, 0.56, 0.86, 0.60, 0, 0], [0.55, -0.30, -0.30, 0.42, 0.95, 0.38, 0.30, 0.10]],
  L: [[0.59, -0.06, -0.07, 0.47, 1.14, 0.52, 0.38, 0.14], [0.62, -0.82, -0.06, 0.52, 0.86, 0.57, 0, 0], [0.55, -0.32, -0.30, 0.40, 0.95, 0.37, 0.30, 0.10]],
};
function ellT(X, y, z, e) {
  if (!e[6]) return sdEll(X - e[0], y - e[1], z - e[2], e[3], e[4], e[5]);
  const s = smoothstep(-0.5, 1.1, y), k = 1 - e[6] * s;
  return sdEll(X - (e[0] - e[7] * s), y - e[1], z - e[2], e[3] * k, e[4], e[5] * (1 - 0.6 * e[6] * s));
}

/** implicit lung field, negative inside. side: -1 right lung (x<0), +1 left lung */
function lungField(x, y, z, side) {
  const X = side * x;
  const E = side < 0 ? LUNG_E.R : LUNG_E.L;
  let d = ellT(X, y, z, E[0]);
  d = smin(d, ellT(X, y, z, E[1]), 0.28);
  d = smin(d, ellT(X, y, z, E[2]), 0.20);
  d = smax(d, diaY(x, z) + 0.025 - y, 0.06);               // base rests on the diaphragm dome
  d = smax(d, 0.11 - X, 0.14);                              // mediastinal surface
  const dh = sdEll(x - 0.18, y + 0.74, z - 0.12, 0.44, 0.64, 0.66); // heart → cardiac impression / notch (opens to the base)
  d = smax(d, -(dh - 0.035), 0.2);
  return d;
}
function fieldGrad(p, side, out) {
  const e = 0.003;
  return out.set(
    lungField(p.x + e, p.y, p.z, side) - lungField(p.x - e, p.y, p.z, side),
    lungField(p.x, p.y + e, p.z, side) - lungField(p.x, p.y - e, p.z, side),
    lungField(p.x, p.y, p.z + e, side) - lungField(p.x, p.y, p.z - e, side),
  ).normalize();
}

/** fissures & lobes: right = upper(0) middle(1) lower(2); left = upper(3) lower(4) */
function fissure(x, y, z, side) {
  const W = 0.034;
  let dObl, g, lobe;
  if (side < 0) {
    dObl = 0.549 * (y - 0.55) + 0.836 * (z + 0.6);
    const dH = y - 0.10;
    g = Math.max(Math.exp(-((dObl / W) ** 2)), Math.exp(-((dH / W) ** 2)) * smoothstep(-0.01, 0.06, dObl));
    lobe = dObl < 0 ? 2 : (dH > 0 ? 0 : 1);
  } else {
    dObl = 0.521 * (y - 0.62) + 0.854 * (z + 0.6);
    g = Math.exp(-((dObl / W) ** 2));
    lobe = dObl < 0 ? 4 : 3;
  }
  return { g, lobe };
}

function buildLung(side, N = 60) {
  const box = new THREE.BoxGeometry(2, 2, 2, N, N, N);
  box.deleteAttribute('normal'); box.deleteAttribute('uv');
  const g = mergeVertices(box);
  box.dispose();
  const P = g.attributes.position.array;
  const n = P.length / 3;
  const c = new V3(side * (side > 0 ? 0.74 : 0.62), -0.12, -0.08);
  const d = new V3(), p = new V3(), nn = new V3();
  const F = (r) => lungField(c.x + d.x * r, c.y + d.y * r, c.z + d.z * r, side);
  for (let i = 0; i < n; i++) {
    d.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]).normalize();
    d.set(d.x * 0.5, d.y * 1.15, d.z * 0.55).normalize();
    let r = 2.2, prev = r, f = F(r), it = 0;
    while (f > 0 && it++ < 600) { prev = r; r -= Math.max(f * 0.45, 0.012); if (r <= 0) { r = 0; break; } f = F(r); }
    let lo = r, hi = prev;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) * 0.5; if (F(m) < 0) lo = m; else hi = m; }
    r = (lo + hi) * 0.5;
    P[3 * i] = c.x + d.x * r; P[3 * i + 1] = c.y + d.y * r; P[3 * i + 2] = c.z + d.z * r;
  }
  // tangential relaxation re-projected onto the implicit surface → even triangles (no stretched,
  // "pleated" facets in concave regions such as the cardiac notch and the diaphragmatic base)
  {
    const I = g.index.array;
    const nb = Array.from({ length: n }, () => new Set());
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c2 = I[t + 2];
      nb[a].add(b); nb[a].add(c2); nb[b].add(a); nb[b].add(c2); nb[c2].add(a); nb[c2].add(b);
    }
    const NB = nb.map((st) => Int32Array.from(st));
    const G = new Float32Array(n * 3), Q = new Float32Array(n * 3);
    const e = 0.002;
    const project = (i, x, y, z, steps) => {
      for (let k = 0; k < steps; k++) {
        const f0 = lungField(x, y, z, side);
        let gx = (lungField(x + e, y, z, side) - f0) / e, gy = (lungField(x, y + e, z, side) - f0) / e, gz = (lungField(x, y, z + e, side) - f0) / e;
        const gl = gx * gx + gy * gy + gz * gz || 1;
        x -= gx * f0 / gl; y -= gy * f0 / gl; z -= gz * f0 / gl;
        const il = 1 / Math.sqrt(gl); G[3 * i] = gx * il; G[3 * i + 1] = gy * il; G[3 * i + 2] = gz * il;
      }
      Q[3 * i] = x; Q[3 * i + 1] = y; Q[3 * i + 2] = z;
    };
    for (let i = 0; i < n; i++) project(i, P[3 * i], P[3 * i + 1], P[3 * i + 2], 1);
    P.set(Q);
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < n; i++) {
        const L = NB[i];
        let ax = 0, ay = 0, az = 0;
        for (let k = 0; k < L.length; k++) { const j = L[k]; ax += P[3 * j]; ay += P[3 * j + 1]; az += P[3 * j + 2]; }
        const inv = 1 / L.length;
        let dx = ax * inv - P[3 * i], dy = ay * inv - P[3 * i + 1], dz = az * inv - P[3 * i + 2];
        const gx = G[3 * i], gy = G[3 * i + 1], gz = G[3 * i + 2];
        const dn = dx * gx + dy * gy + dz * gz;
        dx -= gx * dn; dy -= gy * dn; dz -= gz * dn;
        project(i, P[3 * i] + dx * 0.6, P[3 * i + 1] + dy * 0.6, P[3 * i + 2] + dz * 0.6, 1);
      }
      P.set(Q);
    }
  }
  // fissure grooves along the SDF normal
  const fiss = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    const fi = fissure(p.x, p.y, p.z, side);
    if (fi.g > 0.01) {
      fieldGrad(p, side, nn);
      p.addScaledVector(nn, -0.028 * fi.g);
      P[3 * i] = p.x; P[3 * i + 1] = p.y; P[3 * i + 2] = p.z;
    }
    fiss[i] = fi.g;
  }
  g.computeVertexNormals();
  const sideArr = new Float32Array(n).fill(side);
  return { pos: P, nrm: g.attributes.normal.array, idx: g.index.array, fiss, side: sideArr, count: n };
}

/* ---------------- tube builder (bronchi, ribs) ---------------- */

function newAcc() { return { pos: [], nrm: [], rad: [], side: [], ring: [], idx: [] }; }

function appendTube(acc, pts, rads, sides, radial, o = {}) {
  const n = pts.length;
  const T = [], NN = [], BB = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n - 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let n0 = Math.abs(T[0].y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  n0.addScaledVector(T[0], -n0.dot(T[0])).normalize();
  NN.push(n0); BB.push(T[0].clone().cross(n0));
  for (let i = 1; i < n; i++) {
    const v = NN[i - 1].clone();
    v.addScaledVector(T[i], -v.dot(T[i])).normalize();
    NN.push(v); BB.push(T[i].clone().cross(v));
  }
  const rings = [];
  const CAP = 3;
  if (o.capStart) {
    for (let k = CAP; k >= 1; k--) {
      const a = (k / CAP) * Math.PI / 2;
      rings.push({ c: pts[0].clone().addScaledVector(T[0], -rads[0] * Math.sin(a) * 0.9), r: rads[0] * Math.cos(a), i: 0, ca: -a, arc: 0 });
    }
  }
  let arc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) arc += pts[i].distanceTo(pts[i - 1]);
    rings.push({ c: pts[i], r: rads[i], i, ca: 0, arc });
  }
  if (o.capEnd !== false) {
    for (let k = 1; k <= CAP; k++) {
      const a = (k / CAP) * Math.PI / 2;
      rings.push({ c: pts[n - 1].clone().addScaledVector(T[n - 1], rads[n - 1] * Math.sin(a) * 0.9), r: rads[n - 1] * Math.cos(a), i: n - 1, ca: a, arc });
    }
  }
  const base = acc.pos.length / 3;
  const dir = new V3(), nr = new V3();
  for (const R of rings) {
    const Tn = T[R.i], Nn = NN[R.i], Bn = BB[R.i];
    const cosA = Math.cos(R.ca), sinA = Math.sin(R.ca);
    for (let q = 0; q < radial; q++) {
      const th = (q / radial) * TAU;
      dir.copy(Nn).multiplyScalar(Math.cos(th)).addScaledVector(Bn, Math.sin(th));
      let r = R.r, ringv = 0;
      if (o.cartilage && R.ca === 0) {
        const prof = Math.pow(0.5 + 0.5 * Math.cos(TAU * R.arc / o.cartilage), 6);
        const front = smoothstep(-0.5, 0.2, dir.z);
        ringv = prof * front;
        r *= (1 + 0.085 * ringv) * (1 - 0.1 * smoothstep(0.4, 0.95, -dir.z));
      }
      acc.pos.push(R.c.x + dir.x * r, R.c.y + dir.y * r, R.c.z + dir.z * r);
      nr.copy(dir).multiplyScalar(cosA).addScaledVector(Tn, sinA).normalize();
      acc.nrm.push(nr.x, nr.y, nr.z);
      acc.rad.push(rads[R.i]);
      acc.side.push(sides[R.i]);
      acc.ring.push(ringv);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let q = 0; q < radial; q++) {
      const a = base + j * radial + q, b = base + j * radial + ((q + 1) % radial);
      const c2 = a + radial, d2 = b + radial;
      acc.idx.push(a, b, c2, b, d2, c2);
    }
  }
}

function accToData(acc) {
  const nV = acc.pos.length / 3;
  return {
    pos: new Float32Array(acc.pos), nrm: new Float32Array(acc.nrm), rad: new Float32Array(acc.rad),
    side: new Float32Array(acc.side), ring: new Float32Array(acc.ring),
    idx: nV > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx),
  };
}

/* ---------------- bronchial tree ---------------- */

function bez(b, t, out = new V3()) {
  const a = (1 - t) * (1 - t), m = 2 * (1 - t) * t, c = t * t;
  return out.set(a * b.p0.x + m * b.c.x + c * b.p1.x, a * b.p0.y + m * b.c.y + c * b.p1.y, a * b.p0.z + m * b.c.z + c * b.p1.z);
}

function buildTree(rnd) {
  const R = (a, b) => a + (b - a) * rnd();
  const branches = [];
  const nodes = [];
  function mk(o) {
    const b = Object.assign({ children: [], parentT: 1, cartilage: 0, capStart: false }, o);
    if (!b.c) b.c = b.p0.clone().lerp(b.p1, 0.5);
    b.len = b.p0.distanceTo(b.p1);
    if (b.parent) b.parent.children.push(b);
    branches.push(b);
    nodes.push(b.p1.clone(), b.p0.clone().lerp(b.p1, 0.5));
    return b;
  }
  function child(parent, p0, dir, len, r0, r1, gen, side, lobe, parentT = 1) {
    dir = dir.clone().normalize();
    const p1 = p0.clone().addScaledVector(dir, len);
    const pdir = parent.p1.clone().sub(parent.c).normalize();
    const c = p0.clone().addScaledVector(pdir.lerp(dir, 0.62).normalize(), len * 0.42);
    return mk({ parent, p0: p0.clone(), p1, c, r0, r1, gen, sA: side, sB: side, side, lobe, parentT });
  }

  const tr = mk({ p0: TRACHEA_TOP.clone(), p1: CARINA.clone(), r0: 0.088, r1: 0.084, gen: 0, sA: 0, sB: 0, side: 0, lobe: -1, cartilage: 0.072, capStart: true });
  const RH = new V3(-0.19, 0.44, -0.08), LH = new V3(0.31, 0.40, -0.09);
  const rmb = mk({ parent: tr, p0: CARINA.clone(), p1: RH, c: new V3(-0.085, 0.585, -0.08), r0: 0.066, r1: 0.060, gen: 1, sA: 0, sB: -1, side: -1, lobe: -1, cartilage: 0.062 });
  const lmb = mk({ parent: tr, p0: CARINA.clone(), p1: LH, c: new V3(0.14, 0.61, -0.085), r0: 0.058, r1: 0.052, gen: 1, sA: 0, sB: 1, side: 1, lobe: -1, cartilage: 0.058 });

  // lobar / segmental scaffold
  const rul = child(rmb, bez(rmb, 0.62), new V3(-1, 0.6, -0.05), 0.19, 0.043, 0.039, 2, -1, 0, 0.62);
  const bi = child(rmb, RH, new V3(-0.2, -1, 0.04), 0.2, 0.053, 0.05, 2, -1, -1);
  const rml = child(bi, bi.p1, new V3(-0.42, -0.5, 0.78), 0.2, 0.034, 0.031, 3, -1, 1);
  const rll = child(bi, bi.p1, new V3(-0.3, -1, -0.38), 0.32, 0.046, 0.043, 3, -1, 2);
  const lul = child(lmb, LH, new V3(0.8, 0.5, 0.25), 0.15, 0.044, 0.041, 2, 1, 3);
  const lulUp = child(lul, lul.p1, new V3(0.4, 1, 0.05), 0.22, 0.036, 0.033, 3, 1, 3);
  const ling = child(lul, lul.p1, new V3(0.5, -0.55, 0.72), 0.22, 0.032, 0.029, 3, 1, 3);
  const lll = child(lmb, LH, new V3(0.3, -1, -0.4), 0.34, 0.047, 0.044, 2, 1, 4);

  const tmp = new V3(), gr = new V3();
  const queue = [rul, rml, rll, lulUp, ling, lll];
  const lobeScale = [1.0, 0.95, 1.12, 1.0, 1.12];
  while (queue.length) {
    const b = queue.shift();
    if (b.gen >= MAXGEN) continue;
    const dir = b.p1.clone().sub(b.c).normalize();
    let pn = b.pn;
    if (!pn) { pn = new V3(0, 0, 1).cross(dir); if (pn.lengthSq() < 1e-4) pn.set(1, 0, 0); pn.normalize(); }
    const cpn = pn.clone().applyAxisAngle(dir, Math.PI / 2 + R(-0.45, 0.45));
    const specs = [{ ang: R(0.34, 0.55), rs: 0.84, ls: R(0.8, 0.92) }, { ang: -R(0.55, 0.85), rs: 0.74, ls: R(0.72, 0.86) }];
    for (const sp of specs) {
      for (let att = 0; att < 9; att++) {
        const rot = att === 0 ? 0 : (att % 2 ? 1 : -1) * Math.ceil(att / 2) * 0.42;
        const axis = cpn.clone().applyAxisAngle(dir, rot);
        const cd = dir.clone().applyAxisAngle(axis, sp.ang * (att > 4 ? 0.75 : 1));
        const len = Math.max(b.len * sp.ls * Math.pow(0.9, att) * (b.gen <= 3 ? lobeScale[b.lobe] : 1), 0.055);
        tmp.copy(b.p1).addScaledVector(cd, len);
        const f0 = lungField(tmp.x, tmp.y, tmp.z, b.side);
        if (f0 > -0.22) { fieldGrad(tmp, b.side, gr); cd.addScaledVector(gr, -0.65 * clamp((f0 + 0.22) / 0.22, 0, 1.4)).normalize(); }
        const p1 = b.p1.clone().addScaledVector(cd, len);
        const mid = b.p1.clone().addScaledVector(cd, len * 0.5);
        const r0 = Math.max(b.r1 * sp.rs, 0.0115), r1 = Math.max(r0 * 0.9, 0.011);
        if (lungField(p1.x, p1.y, p1.z, b.side) > -Math.max(0.045, r1 * 1.8)) continue;
        if (lungField(mid.x, mid.y, mid.z, b.side) > -0.03) continue;
        if (b.lobe >= 0 && fissure(p1.x, p1.y, p1.z, b.side).lobe !== b.lobe) continue;
        const minD = len * 0.45;
        let close = false;
        for (let k = 0; k < nodes.length && !close; k++) if (nodes[k].distanceToSquared(p1) < minD * minD) close = true;
        if (close) continue;
        const ch = child(b, b.p1.clone(), cd, len, r0, r1, b.gen + 1, b.side, b.lobe);
        ch.pn = cpn;
        queue.push(ch);
        break;
      }
    }
  }

  // tubes
  const acc = newAcc();
  for (const b of branches) {
    const segs = b.gen === 0 ? 72 : b.gen === 1 ? 20 : Math.max(3, Math.ceil(b.len / (b.gen <= 3 ? 0.028 : 0.04)));
    const radial = b.gen <= 1 ? 22 : b.gen <= 3 ? 14 : b.gen <= 5 ? 10 : 8;
    const pts = [], rads = [], sides = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push(bez(b, t));
      rads.push(lerp(b.r0, b.r1, t));
      sides.push(lerp(b.sA, b.sB, smoothstep(0, 1, t)));
    }
    b.samples = { pts, rads, sides, segs };
    appendTube(acc, pts, rads, sides, radial, { capStart: b.capStart, capEnd: true, cartilage: b.cartilage });
  }

  // air paths: mouth → each terminal bronchiole
  const paths = [];
  for (const b of branches) {
    if (b.children.length) continue;
    const chain = [];
    let cur = b, cut = 1;
    while (cur) { chain.push({ b: cur, cut }); cut = cur.parentT; cur = cur.parent; }
    chain.reverse();
    const P = [], Rr = [], S = [];
    for (const { b: cb, cut: ct } of chain) {
      const sm = cb.samples;
      for (let i = 0; i <= sm.segs; i++) {
        const t = i / sm.segs;
        if (t > ct + 1e-6) { P.push(bez(cb, ct)); Rr.push(lerp(cb.r0, cb.r1, ct)); S.push(sm.sides[i]); break; }
        P.push(sm.pts[i]); Rr.push(sm.rads[i]); S.push(sm.sides[i]);
      }
    }
    const n = P.length;
    const pts = new Float32Array(n * 3), cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pts[3 * i] = P[i].x; pts[3 * i + 1] = P[i].y; pts[3 * i + 2] = P[i].z;
      if (i) cum[i] = cum[i - 1] + P[i].distanceTo(P[i - 1]);
    }
    paths.push({ pts, rad: new Float32Array(Rr), side: new Float32Array(S), cum, L: cum[n - 1] });
  }
  return { data: accToData(acc), paths, branchCount: branches.length };
}

/* ---------------- alveoli & bullae ---------------- */

function buildBullae(rnd) {
  const out = [];
  let tries = 0;
  while (out.length < 11 && tries++ < 20000) {
    const side = out.length % 2 ? 1 : -1;
    const x = side * (0.22 + rnd() * 0.92), y = -0.35 + rnd() * 1.38, z = -0.6 + rnd() * 1.1;
    const f = lungField(x, y, z, side);
    if (f > -0.035 || f < -0.11) continue;
    const r = 0.10 + rnd() * 0.09;
    let ok = true;
    for (const b of out) if (Math.hypot(b.x - x, b.y - y, b.z - z) < b.r + r + 0.05) { ok = false; break; }
    if (ok) out.push({ x, y, z, r, side });
  }
  return out;
}

function buildAlveoli(rnd, bullae) {
  const counts = [[-1, 2300], [1, 1900]];
  const total = counts[0][1] + counts[1][1];
  const pos = new Float32Array(total * 3), side = new Float32Array(total), seed = new Float32Array(total), size = new Float32Array(total), bulla = new Float32Array(total);
  let k = 0;
  for (const [s, cnt] of counts) {
    let acc = 0;
    while (acc < cnt) {
      const x = s * (0.08 + rnd() * 1.12), y = -1.55 + rnd() * 2.7, z = -0.75 + rnd() * 1.35;
      if (lungField(x, y, z, s) > -0.035) continue;
      pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = z;
      side[k] = s; seed[k] = rnd(); size[k] = 0.6 + rnd() * 0.8;
      for (const b of bullae) if (b.side === s && Math.hypot(b.x - x, b.y - y, b.z - z) < b.r * 1.12) { bulla[k] = 1; break; }
      k++; acc++;
    }
  }
  return { pos, side, seed, size, bulla, count: total };
}

/* ---------------- thorax: cage profile, ribs, skin, diaphragm ---------------- */

const CAGE_TAB = [ // y, rx, zFront, zBack
  [-1.80, 1.16, 0.62, -0.82], [-1.40, 1.22, 0.66, -0.85], [-1.00, 1.25, 0.67, -0.86], [-0.50, 1.25, 0.67, -0.86],
  [0.00, 1.21, 0.65, -0.84], [0.50, 1.10, 0.58, -0.80], [0.90, 0.95, 0.48, -0.75], [1.20, 0.78, 0.40, -0.68],
  [1.45, 0.62, 0.33, -0.62], [1.75, 0.50, 0.28, -0.56],
];

function buildCage(lungs) {
  const Y0 = -1.8, DY = 0.05, NB = Math.round((1.8 - Y0) / DY) + 1;
  const lx = new Float32Array(NB).fill(0), lzf = new Float32Array(NB).fill(-9), lzb = new Float32Array(NB).fill(9);
  for (const L of lungs) {
    for (let i = 0; i < L.count; i++) {
      const x = L.pos[3 * i], y = L.pos[3 * i + 1], z = L.pos[3 * i + 2];
      const b = clamp(Math.round((y - Y0) / DY), 0, NB - 1);
      lx[b] = Math.max(lx[b], Math.abs(x)); lzf[b] = Math.max(lzf[b], z); lzb[b] = Math.min(lzb[b], z);
    }
  }
  const tab = (y, col) => {
    if (y <= CAGE_TAB[0][0]) return CAGE_TAB[0][col];
    for (let i = 1; i < CAGE_TAB.length; i++) {
      if (y <= CAGE_TAB[i][0]) {
        const a = CAGE_TAB[i - 1], b = CAGE_TAB[i];
        return lerp(a[col], b[col], easeInOut((y - a[0]) / (b[0] - a[0])));
      }
    }
    return CAGE_TAB[CAGE_TAB.length - 1][col];
  };
  const rx = new Float32Array(NB), zf = new Float32Array(NB), zb = new Float32Array(NB);
  for (let b = 0; b < NB; b++) {
    const y = Y0 + b * DY;
    rx[b] = Math.max(tab(y, 1), lx[b] + 0.095);
    zf[b] = Math.max(tab(y, 2), lzf[b] + 0.1);
    zb[b] = Math.min(tab(y, 3), lzb[b] - 0.12);
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const arr of [rx, zf, zb]) {
      const c = arr.slice();
      for (let b = 1; b < NB - 1; b++) arr[b] = c[b - 1] * 0.25 + c[b] * 0.5 + c[b + 1] * 0.25;
    }
  }
  return (y) => {
    const fb = clamp((y - Y0) / DY, 0, NB - 1.001), b = Math.floor(fb), t = fb - b;
    const RX = lerp(rx[b], rx[b + 1], t), F = lerp(zf[b], zf[b + 1], t), B = lerp(zb[b], zb[b + 1], t);
    return { rx: RX, rz: (F - B) / 2, zc: (F + B) / 2 };
  };
}

function buildRibs(cage) {
  const acc = newAcc();
  const ends = [2.16, 2.2, 2.22, 2.22, 2.22, 2.22, 2.2, 2.08, 1.92, 1.68, 1.4];
  for (let i = 0; i < 11; i++) {
    const yp = 1.17 - i * 0.215;
    const drop = 0.36 + 0.025 * i;
    const rr = i === 0 ? 0.022 : 0.026;
    for (const s of [-1, 1]) {
      const pts = [], rads = [], sides = [];
      const N = 40, p0 = 0.55, p1 = ends[i];
      for (let k = 0; k <= N; k++) {
        const t = k / N, phi = lerp(p0, p1, t);
        const u = (phi - 0.1) / (Math.PI - 0.1);
        const y = yp + 0.05 * Math.sin(Math.min(u * 3, 1) * Math.PI) - drop * Math.pow(u, 1.45);
        const c = cage(y);
        pts.push(new V3(s * Math.sin(phi) * c.rx, y, c.zc - Math.cos(phi) * c.rz));
        rads.push(rr * (0.7 + 0.3 * smoothstep(0, 0.35, t)));
        sides.push(0);
      }
      appendTube(acc, pts, rads, sides, 9, { capStart: true, capEnd: true });
    }
  }
  return accToData(acc);
}

function gridIndex(nu, nv, outward) {
  const idx = [];
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      if (outward) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  return idx;
}

function buildSkin(cage) {
  const NU = 84, NV = 76, Y0 = -1.60, Y1 = 1.62;
  const pos = [], edge = [];
  for (let j = 0; j < NV; j++) {
    const t = j / (NV - 1);
    const y = lerp(Y0, Y1, t);
    const c = cage(Math.min(y, 1.25));
    const sh = 1 - 0.68 * Math.pow(smoothstep(1.05, Y1, y), 1.3);      // rounded shoulders → neck
    const rx = (c.rx + 0.075) * sh, rz = (c.rz + 0.075) * lerp(sh, 1, 0.25), zc = lerp(c.zc, -0.08, smoothstep(1.05, Y1, y));
    for (let i = 0; i < NU; i++) {
      const phi = lerp(-PHI_CUT, PHI_CUT, i / (NU - 1));
      pos.push(Math.sin(phi) * rx, y, zc - Math.cos(phi) * rz);
      const eP = Math.exp(-((((PHI_CUT - Math.abs(phi)) * rx) / 0.028) ** 2));
      const eY = Math.max(Math.exp(-(((y - Y0) / 0.028) ** 2)), Math.exp(-(((Y1 - y) / 0.028) ** 2)));
      edge.push(Math.max(eP, eY));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(gridIndex(NU, NV, true));
  g.computeVertexNormals();
  return { pos: new Float32Array(pos), nrm: g.attributes.normal.array, idx: new Uint16Array(g.index.array), edge: new Float32Array(edge) };
}

function buildDiaphragm(cage) {
  const NA = 112, NR = 40;
  const c = cage(-1.3);
  const pos = [];
  for (let j = 0; j < NR; j++) {
    const rho = j / (NR - 1);
    for (let i = 0; i < NA; i++) {
      const a = (i / (NA - 1)) * TAU;
      const x = Math.cos(a) * (c.rx - 0.02) * rho, z = c.zc + Math.sin(a) * (c.rz - 0.02) * rho;
      pos.push(x, diaY(x, z) - 0.004, z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(gridIndex(NA, NR, true));
  g.computeVertexNormals();
  // ensure the dome normals point up (towards the lungs)
  const ny = g.attributes.normal.array;
  let sum = 0; for (let i = 1; i < ny.length; i += 3) sum += ny[i];
  let idx = Array.from(g.index.array);
  if (sum < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx); g.computeVertexNormals();
  }
  // weld the seam normals (first/last column coincide)
  const N = g.attributes.normal.array;
  for (let j = 0; j < NR; j++) {
    const a = (j * NA) * 3, b = (j * NA + NA - 1) * 3;
    for (let k = 0; k < 3; k++) { const m = (N[a + k] + N[b + k]) / 2; N[a + k] = m; N[b + k] = m; }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(N), idx: new Uint16Array(idx) };
}

let MODEL = null;
let THORAX = null;
function getModel() {
  if (MODEL) return MODEL;
  const rnd = mulberry32(20240611);
  const lungs = [buildLung(-1), buildLung(1)];
  const tree = buildTree(rnd);
  const bullae = buildBullae(rnd);
  const alveoli = buildAlveoli(rnd, bullae);
  // pleural-space anchor: right lung lateral surface at mid-height
  let r = 1.6; while (lungField(-r, 0.2, -0.05, -1) > 0 && r > 0.3) r -= 0.004;
  const pplPoint = new V3(-(r + 0.024), 0.2, -0.05);
  MODEL = { lungs, tree, bullae, alveoli, pplPoint };
  return MODEL;
}
function getThorax() {
  if (THORAX) return THORAX;
  const M = getModel();
  const cage = buildCage(M.lungs);
  const c0 = cage(0.0);
  THORAX = { cage, ribs: buildRibs(cage), skin: buildSkin(cage), dia: buildDiaphragm(cage), pbsPoint: new V3(-(c0.rx + 0.085), 0.0, c0.zc) };
  return THORAX;
}

function makeGeo(attrs, idx) {
  const g = new THREE.BufferGeometry();
  for (const [name, arr, size] of attrs) if (arr) g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  if (idx) g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* =========================================================================
   mount
   ========================================================================= */

export function mount(container, options = {}) {
  const opts = Object.assign({ mode: 'hero', autoRotate: true, interactive: true, theme: 'dark' }, options);
  const mode = opts.mode === 'thorax' ? 'thorax' : 'hero';
  const isThorax = mode === 'thorax';
  const M = getModel();
  const TH = isThorax ? getThorax() : null;

  /* ---------- renderer ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  const PR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const root = new THREE.Group();
  scene.add(root);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment(renderer);
  const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
  scene.environment = envTex;
  roomEnv.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-3, 4, 5);
  const rimLight = new THREE.DirectionalLight(0x9fd8ff, 2.0);
  rimLight.position.set(3.5, 2, -4);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
  fillLight.position.set(2, -2, 3);
  scene.add(keyLight, rimLight, fillLight);

  /* ---------- shared uniforms ---------- */
  const U = {
    uTime: { value: 0 }, uVolEff: { value: 0 }, uEmph: { value: 0 }, uFib: { value: 0 }, uDScale: { value: 1 }, uPneumo: { value: 0 },
    uPulse: { value: 0 }, uYellow: { value: new THREE.Color() }, uBgOut: { value: new THREE.Color() },
    uKeyDir: { value: new V3(-0.45, 0.6, 0.66).normalize() }, uPx: { value: 800 },
  };
  const HL = { pa: { value: 0 }, pao: { value: 0 }, ppl: { value: 0 }, pbs: { value: 0 }, dia: { value: 0 } };
  const DIM = { pa: { value: 1 }, pao: { value: 1 }, ppl: { value: 1 }, pbs: { value: 1 }, dia: { value: 1 } };
  const kUni = (K) => ({ uScaleK: { value: K.scaleK }, uCollapseK: { value: K.collapseK }, uSpringK: { value: K.springK }, uDescentK: { value: K.descentK } });

  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };

  function glassMaterial({ K, part, defines = {}, side = THREE.FrontSide, inflate = 0, back = 0, style, hlFace = 0.2 }) {
    const uniforms = Object.assign({}, U, kUni(K), {
      uInflate: { value: inflate }, uBack: { value: back },
      uColFace: { value: new THREE.Color() }, uColMid: { value: new THREE.Color() }, uColRim: { value: new THREE.Color() },
      uColSpec: { value: new THREE.Color(0xffffff) }, uColFiss: { value: new THREE.Color() }, uColFib: { value: new THREE.Color() },
      uColAir: { value: new THREE.Color() }, uAlphaFace: { value: 0.1 }, uAlphaRim: { value: 0.9 }, uSpecK: { value: 1 },
      uHL: HL[part], uHLFace: { value: hlFace }, uDim: DIM[part], uVis: { value: 1 }, uAir: { value: 0 },
    });
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: GLASS_VERT, fragmentShader: GLASS_FRAG, defines, transparent: true, depthWrite: false, side });
    m.userData.style = style;
    m.userData.back = back;
    return track(m);
  }

  function solidMaterial({ K, part, kind, hlMask = '1.0', postFade = 0, widen = 0 }) {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.18 });
    const local = Object.assign(kUni(K), { uRingCol: { value: new THREE.Color() }, uPostFade: { value: postFade }, uWiden: { value: widen } });
    m.defines = Object.assign({}, m.defines, { HL_MASK: hlMask });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U, local, { uHL: HL[part], uDim: DIM[part] });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
${GLSL_COMMON}
attribute float aSide;
attribute float aRadius;
attribute float aRing;
uniform float uWiden;
varying float vRing;
varying float vTop;
varying float vPost;`)
        .replace('#include <beginnormal_vertex>', `
vec3 bPos; vec3 bNrm;
breatheFrame(position + normal * aRadius * uWiden * uVolEff, normal, aSide, bPos, bNrm);
vec3 objectNormal = bNrm;
vRing = aRing;
vTop = smoothstep(1.32, 1.72, position.y);
vPost = 1.0 - smoothstep(-0.7, -0.15, position.z);`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uHL;
uniform float uDim;
uniform float uPulse;
uniform float uPostFade;
uniform vec3 uYellow;
uniform vec3 uBgOut;
uniform vec3 uRingCol;
varying float vRing;
varying float vTop;
varying float vPost;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, uRingCol, vRing * 0.5);
float hlk = uHL * (0.6 + 0.4 * uPulse) * (HL_MASK);
diffuseColor.rgb = mix(diffuseColor.rgb, uYellow, hlk * 0.7);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance = mix(totalEmissiveRadiance, uYellow * 0.45, hlk);`)
        .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
gl_FragColor.rgb = mix(uBgOut, gl_FragColor.rgb, mix(0.28, 1.0, uDim));
gl_FragColor.a *= 1.0 - uPostFade * vPost;`);
    };
    m.customProgramCacheKey = () => 'lungs-solid-' + kind;
    m.userData.kind = kind;
    m.userData.local = local;
    return track(m);
  }

  // additive light whose alpha stays a legal premultiplied value (max), so the transparent canvas
  // composites as pure glow over the black page and never darkens/greys the background
  function setAdditive(m, on) {
    if (on) {
      m.blending = THREE.CustomBlending;
      m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor;
      m.blendEquationAlpha = THREE.MaxEquation; m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneFactor;
    } else {
      m.blending = THREE.NormalBlending;
    }
  }

  /* ---------- lungs ---------- */
  const pleuraMeshes = [];
  const lungGeos = M.lungs.map((L) => track(makeGeo([['position', L.pos, 3], ['normal', L.nrm, 3], ['aSide', L.side, 1], ['aFiss', L.fiss, 1]], L.idx)));
  for (let i = 0; i < 2; i++) {
    const g = lungGeos[i];
    const back = new THREE.Mesh(g, glassMaterial({ K: K_LUNG, part: 'pa', side: THREE.BackSide, back: 1, defines: { USE_FISS: '', USE_ROUGH: '', USE_FIB: '' }, style: 'lungBack', hlFace: 0.06 }));
    back.renderOrder = 3;
    const front = new THREE.Mesh(g, glassMaterial({ K: K_LUNG, part: 'pa', side: THREE.FrontSide, defines: { USE_FISS: '', USE_ROUGH: '', USE_FIB: '' }, style: 'lung', hlFace: 0.16 }));
    front.renderOrder = 6;
    const pleura = new THREE.Mesh(g, glassMaterial({ K: K_PLEURA, part: 'ppl', side: THREE.FrontSide, inflate: 0.045, style: 'pleura', hlFace: 0.03 }));
    pleura.renderOrder = 7;
    pleura.userData.left = i === 1;
    root.add(back, front, pleura);
    pleuraMeshes.push(pleura);
    for (const m of [back, front, pleura]) m.frustumCulled = false;
  }

  /* ---------- bronchial tree ---------- */
  const T = M.tree.data;
  const treeGeo = track(makeGeo([['position', T.pos, 3], ['normal', T.nrm, 3], ['aRadius', T.rad, 1], ['aSide', T.side, 1], ['aRing', T.ring, 1]], T.idx));
  const bronMat = solidMaterial({ K: K_LUNG, part: 'pao', kind: 'bronchi', hlMask: 'vTop', widen: 0.14 });
  const tree = new THREE.Mesh(treeGeo, bronMat);
  tree.frustumCulled = false;
  root.add(tree);

  /* ---------- alveoli ---------- */
  const A = M.alveoli;
  const alvGeo = track(makeGeo([['position', A.pos, 3], ['aSide', A.side, 1], ['aSeed', A.seed, 1], ['aSize', A.size, 1], ['aBulla', A.bulla, 1]]));
  const alvMat = track(new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, kUni(K_LUNG), {
      uSize: { value: 0.032 }, uKeep: { value: 0.2 }, uVis: { value: 1 }, uAlpha: { value: 1 },
      uCol: { value: new THREE.Color() }, uColFib: { value: new THREE.Color() }, uHL: HL.pa, uDim: DIM.pa,
    }),
    vertexShader: ALV_VERT, fragmentShader: ALV_FRAG, transparent: true, depthWrite: false,
  }));
  const alveoli = new THREE.Points(alvGeo, alvMat);
  alveoli.renderOrder = 5; alveoli.frustumCulled = false;
  root.add(alveoli);

  /* ---------- bullae (emphysema) ---------- */
  const bullaGeo = track(new THREE.IcosahedronGeometry(1, 4));
  bullaGeo.setAttribute('iSide', new THREE.InstancedBufferAttribute(new Float32Array(M.bullae.map((b) => b.side)), 1));
  const bullaMat = glassMaterial({ K: K_LUNG, part: 'pa', defines: { INSTANCED: '' }, style: 'bulla' });
  const bullae = new THREE.InstancedMesh(bullaGeo, bullaMat, M.bullae.length);
  {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    M.bullae.forEach((b, i) => bullae.setMatrixAt(i, mtx.compose(new V3(b.x, b.y, b.z), q, new V3(b.r, b.r * 0.92, b.r))));
  }
  bullae.renderOrder = 4; bullae.frustumCulled = false; bullae.visible = false;
  root.add(bullae);

  /* ---------- air particles ---------- */
  const AIR_N = 240;
  const paths = M.tree.paths;
  const air = {
    s: new Float32Array(AIR_N), path: new Uint16Array(AIR_N), off: new Float32Array(AIR_N * 3), sp: new Float32Array(AIR_N),
    pos: new Float32Array(AIR_N * 3), side: new Float32Array(AIR_N), a: new Float32Array(AIR_N), r: new Float32Array(AIR_N).fill(0.085),
  };
  {
    const rnd = mulberry32(777);
    for (let i = 0; i < AIR_N; i++) {
      air.path[i] = Math.floor(rnd() * paths.length);
      air.s[i] = rnd() * paths[air.path[i]].L;
      const u = rnd() * 2 - 1, th = rnd() * TAU, rr = Math.sqrt(1 - u * u), m = Math.sqrt(rnd()) * 0.5;
      air.off[3 * i] = rr * Math.cos(th) * m; air.off[3 * i + 1] = u * m; air.off[3 * i + 2] = rr * Math.sin(th) * m;
      air.sp[i] = 0.85 + rnd() * 0.3;
    }
  }
  const airGeo = track(new THREE.BufferGeometry());
  airGeo.setAttribute('position', new THREE.BufferAttribute(air.pos, 3).setUsage(THREE.DynamicDrawUsage));
  airGeo.setAttribute('aSide', new THREE.BufferAttribute(air.side, 1).setUsage(THREE.DynamicDrawUsage));
  airGeo.setAttribute('aA', new THREE.BufferAttribute(air.a, 1).setUsage(THREE.DynamicDrawUsage));
  const airMat = track(new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, kUni(K_LUNG), { uSize: { value: 0.055 }, uOn: { value: 0 }, uAlpha: { value: 1 }, uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() } }),
    vertexShader: AIR_VERT, fragmentShader: AIR_FRAG, transparent: true, depthWrite: false, depthTest: false,
  }));
  const airPts = new THREE.Points(airGeo, airMat);
  airPts.renderOrder = 10; airPts.frustumCulled = false; airPts.visible = false;
  root.add(airPts);

  /* ---------- airway opening marker ---------- */
  const ringGeo = track(new THREE.TorusGeometry(0.13, 0.024, 20, 72));
  const ringMat = track(new THREE.MeshPhysicalMaterial({ roughness: 0.25, clearcoat: 1, transparent: true }));
  const ringCol = new THREE.Color();
  const paoRing = new THREE.Mesh(ringGeo, ringMat);
  paoRing.rotation.x = Math.PI / 2;
  paoRing.renderOrder = 9;
  root.add(paoRing);

  /* ---------- thorax ---------- */
  let skinBack = null, skinFront = null, ribs = null, dia = null;
  if (isThorax) {
    const SK = TH.skin;
    const skinGeo = track(makeGeo([['position', SK.pos, 3], ['normal', SK.nrm, 3], ['aEdge', SK.edge, 1]], SK.idx));
    skinBack = new THREE.Mesh(skinGeo, glassMaterial({ K: K_CHEST, part: 'pbs', side: THREE.BackSide, back: 1, defines: { USE_EDGE: '' }, style: 'skinBack', hlFace: 0.0 }));
    skinBack.renderOrder = 1;
    skinFront = new THREE.Mesh(skinGeo, glassMaterial({ K: K_CHEST, part: 'pbs', side: THREE.FrontSide, defines: { USE_EDGE: '' }, style: 'skin', hlFace: 0.05 }));
    skinFront.renderOrder = 8;
    const R = TH.ribs;
    const ribGeo = track(makeGeo([['position', R.pos, 3], ['normal', R.nrm, 3], ['aRadius', R.rad, 1], ['aSide', R.side, 1], ['aRing', R.ring, 1]], R.idx));
    ribs = new THREE.Mesh(ribGeo, solidMaterial({ K: K_CHEST, part: 'pbs', kind: 'ribs', postFade: 0.85 }));
    ribs.material.transparent = true;            // posterior arcs fade out with alpha (drawn first of the transparents)
    ribs.renderOrder = 0.5;
    const D = TH.dia;
    const diaGeo = track(makeGeo([['position', D.pos, 3], ['normal', D.nrm, 3]], D.idx));
    dia = new THREE.Mesh(diaGeo, glassMaterial({ K: K_DIA, part: 'dia', side: THREE.DoubleSide, defines: { USE_STRIPES: '' }, style: 'dia' }));
    dia.renderOrder = 2;
    for (const m of [skinBack, skinFront, ribs, dia]) { m.frustumCulled = false; root.add(m); }
  }

  /* ---------- glow (dark theme only) ----------
     Tight bloom: the wide "haze" mips are zeroed, the bloom is faded out before the canvas edges, and the
     final alpha is max(alpha, max(rgb)) so glow over the transparent canvas stays legal premultiplied colour
     (no grey/navy rectangle, nothing clipped hard at the edges). */
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(PR);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.0, 0.6);
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.8, 0.42, 0.1, 0.0];
  bloom.compositeMaterial.fragmentShader = bloom.compositeMaterial.fragmentShader
    .replace('void main() {', `float edgeFade(vec2 uv) {
      vec2 e = smoothstep(vec2(0.0), vec2(0.08), uv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - uv);
      return e.x * e.y;
    }
    void main() {`)
    .replace('gl_FragColor = bloomStrength * (', 'gl_FragColor = edgeFade(vUv) * bloomStrength * (');
  bloom.compositeMaterial.needsUpdate = true;
  bloom.blendMaterial.blending = THREE.CustomBlending;           // add bloom colour, keep scene alpha
  bloom.blendMaterial.blendEquation = THREE.AddEquation;
  bloom.blendMaterial.blendSrc = THREE.OneFactor;
  bloom.blendMaterial.blendDst = THREE.OneFactor;
  bloom.blendMaterial.blendSrcAlpha = THREE.ZeroFactor;
  bloom.blendMaterial.blendDstAlpha = THREE.OneFactor;
  composer.addPass(bloom);
  const outputPass = new OutputPass();
  {
    const fs = outputPass.material.fragmentShader, i = fs.lastIndexOf('}');
    outputPass.material.fragmentShader = fs.slice(0, i) +
      '\n  gl_FragColor.a = clamp(max(gl_FragColor.a, max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b))), 0.0, 1.0);\n' + fs.slice(i);
  }
  composer.addPass(outputPass);

  /* ---------- controls ---------- */
  let controls = null;
  if (opts.interactive) {
    controls = new OrbitControls(camera, canvas);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.minPolarAngle = Math.PI * 0.3;
    controls.maxPolarAngle = Math.PI * 0.62;
  }

  /* ---------- state ---------- */
  const st = {
    theme: opts.theme === 'light' ? 'light' : 'dark',
    running: false, raf: 0, time: 0, disposed: false,
    auto: true, period: 4, cycleT: 0, target: 0, vol: 0, rawVol: 0, flow: 0, phase: 'insp',
    airflow: false, airOn: 0,
    w: { n: 1, f: 0, e: 0 }, wFrom: { n: 1, f: 0, e: 0 }, wTo: { n: 1, f: 0, e: 0 }, wK: 1,
    pneumo: 0, pneumoFrom: 0, pneumoTo: 0, pneumoK: 1,
    hl: null, hlAmt: { pa: 0, pao: 0, ppl: 0, pbs: 0, dia: 0 }, dim: { pa: 1, pao: 1, ppl: 1, pbs: 1, dia: 1 },
    size: { w: 0, h: 0 },
  };
  const breathCbs = new Set();
  const clock = new THREE.Clock(false);

  /* ---------- theme ---------- */
  const cSet = (u, hex) => u.value.set(hex);
  function applyTheme() {
    const P = PAL[st.theme];
    U.uYellow.value.set(P.yellow);
    if (st.theme === 'light') U.uBgOut.value.setHex(P.bg, THREE.LinearSRGBColorSpace); else U.uBgOut.value.setRGB(0, 0, 0);
    const styleOf = (name) => {
      if (name === 'lungBack') return Object.assign({}, P.lung, P.lungBack);
      if (name === 'skinBack') return Object.assign({}, P.skin, { aFace: P.skin.aFace * 0.7, aRim: P.skin.aRim * 0.55, specK: 0.15 });
      return P[name];
    };
    for (const m of disposables) {
      if (!m.isShaderMaterial || !m.userData.style) continue;
      const s = styleOf(m.userData.style), u = m.uniforms;
      cSet(u.uColFace, s.face); cSet(u.uColMid, s.mid); cSet(u.uColRim, s.rim);
      cSet(u.uColFiss, s.fiss || s.rim); cSet(u.uColFib, s.fib || s.mid); cSet(u.uColAir, s.air || s.mid);
      u.uColSpec.value.set(s.spec || (st.theme === 'dark' ? '#e6f7ff' : '#ffffff'));
      u.uAlphaFace.value = s.aFace; u.uAlphaRim.value = s.aRim; u.uSpecK.value = s.specK;
    }
    alvMat.uniforms.uCol.value.set(P.alv.col); alvMat.uniforms.uColFib.value.set(P.alv.fib);
    alvMat.uniforms.uAlpha.value = P.alv.alpha; alvMat.uniforms.uSize.value = P.alv.size;
    setAdditive(alvMat, st.theme === 'dark');
    airMat.uniforms.uCore.value.set(P.air.core); airMat.uniforms.uEdge.value.set(P.air.edge); airMat.uniforms.uAlpha.value = P.air.alpha;
    setAdditive(airMat, st.theme === 'dark');

    bronMat.color.set(P.bron.col); bronMat.emissive.set(P.bron.col); bronMat.emissiveIntensity = P.bron.em; bronMat.envMapIntensity = P.bron.env;
    bronMat.userData.local.uRingCol.value.set(P.bron.ring);
    ringCol.set(P.ring.col); ringMat.color.set(P.ring.col); ringMat.emissive.set(P.ring.col); ringMat.emissiveIntensity = P.ring.em;
    if (ribs) {
      const rm = ribs.material; rm.color.set(P.rib.col); rm.emissive.set(P.rib.col); rm.emissiveIntensity = P.rib.em; rm.envMapIntensity = P.rib.env;
      rm.roughness = 0.42; rm.clearcoat = 0.5;
    }
    rimLight.color.set(st.theme === 'dark' ? 0x9fd8ff : 0xffffff);
    rimLight.intensity = st.theme === 'dark' ? 2.2 : 1.2;
    renderer.toneMappingExposure = st.theme === 'dark' ? 1.0 : 1.05;
  }

  /* ---------- framing ---------- */
  const FRAME = isThorax ? { cy: 0.12, hw: 1.52, hh: 2.22, elev: 6 } : { cy: 0.2, hw: 1.34, hh: 1.9, elev: 4 };
  let shiftFrac = 0;
  function frameCamera(w, h) {
    camera.aspect = w / h;
    shiftFrac = isThorax && camera.aspect > 1.15 ? 0.14 : 0;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const usable = camera.aspect * (1 - 2 * shiftFrac);
    const dist = Math.max(FRAME.hh * 1.04 / tanH, FRAME.hw * 1.06 / (tanH * usable));
    const target = new V3(0, FRAME.cy, 0);
    let dir = new V3(0, Math.sin(THREE.MathUtils.degToRad(FRAME.elev)), Math.cos(THREE.MathUtils.degToRad(FRAME.elev)));
    if (controls && st.size.w > 0) dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = Math.max(0.1, dist - 5); camera.far = dist + 6;
    if (controls) { controls.target.copy(target); controls.update(); } else camera.lookAt(target);
    if (shiftFrac) camera.setViewOffset(w, h, -shiftFrac * w, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    U.uPx.value = (h * PR) / (2 * tanH);
  }
  function resize() {
    const w = Math.max(1, Math.round(container.clientWidth)), h = Math.max(1, Math.round(container.clientHeight));
    if (w === st.size.w && h === st.size.h) return;
    frameCamera(w, h);
    st.size.w = w; st.size.h = h;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();
  applyTheme();
  try { renderer.compile(scene, camera); } catch (e) { /* compile lazily */ }

  /* ---------- per-frame updates ---------- */
  const S = { volEff: 0, emph: 0, dScale: 1, pneumo: 0 };
  function derived() {
    const { f, e } = st.w;
    return { fib: f, emph: e, dScale: 1 - 0.2 * f + 0.15 * e, exc: 1 - 0.5 * f - 0.12 * e, keep: 0.2 * st.w.n + 0.0 * f + 0.66 * e, tiFrac: 0.5 - 0.14 * e };
  }

  function updateBreath(dt, D) {
    const T = st.period;
    if (st.auto) {
      st.cycleT = (st.cycleT + dt) % T;
      const Ti = T * D.tiFrac, t = st.cycleT;
      let v, dv;
      if (t < Ti) { v = 0.5 - 0.5 * Math.cos(Math.PI * t / Ti); dv = 0.5 * Math.PI / Ti * Math.sin(Math.PI * t / Ti); st.phase = 'insp'; }
      else { const u = (t - Ti) / (T - Ti); v = 0.5 + 0.5 * Math.cos(Math.PI * u); dv = -0.5 * Math.PI / (T - Ti) * Math.sin(Math.PI * u); st.phase = 'exp'; }
      st.rawVol = v; st.flow = dv;
      st.vol += (v - st.vol) * (1 - Math.exp(-dt * 25));
    } else {
      const prev = st.vol;
      st.vol += (st.target - st.vol) * (1 - Math.exp(-dt * 9));
      const dv = (st.vol - prev) / Math.max(dt, 1e-4);
      st.flow += (dv - st.flow) * (1 - Math.exp(-dt * 14));
      if (Math.abs(st.flow) < 0.004) st.flow = 0;
      if (Math.abs(st.flow) > 0.02) st.phase = st.flow > 0 ? 'insp' : 'exp';
      st.rawVol = st.vol;
    }
  }

  function updateAir(dt, flowEff) {
    const on = st.airOn;
    if (on <= 0.001) { airPts.visible = false; return; }
    airPts.visible = true;
    const speed = flowEff * 3.2;                       // path units per second (in the trachea)
    const vis = smoothstep(0.03, 0.3, Math.abs(flowEff) / 0.785);
    const P = air.pos;
    for (let i = 0; i < AIR_N; i++) {
      let pth = paths[air.path[i]];
      // velocity falls as total airway cross-section grows distally (fast in the trachea, slow in bronchioles)
      const calibre = clamp(Math.pow(air.r[i] / 0.085, 0.9), 0.22, 1);
      air.s[i] += speed * air.sp[i] * dt * calibre;
      if (air.s[i] > pth.L) { air.path[i] = (air.path[i] * 7 + 13 + i) % paths.length; pth = paths[air.path[i]]; air.s[i] = air.s[i] - pth.L * Math.floor(air.s[i] / pth.L); if (air.s[i] > 0.25) air.s[i] = 0; }
      else if (air.s[i] < 0) { air.path[i] = (air.path[i] * 5 + 3 + i) % paths.length; pth = paths[air.path[i]]; air.s[i] = pth.L - Math.min(-air.s[i], 0.2); }
      const s = air.s[i], cum = pth.cum;
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
      const segL = cum[hi] - cum[lo], t = segL > 1e-6 ? clamp((s - cum[lo]) / segL, 0, 1) : 0;
      const r = lerp(pth.rad[lo], pth.rad[hi], t);
      air.r[i] = r;
      const pp = pth.pts;
      P[3 * i] = lerp(pp[3 * lo], pp[3 * hi], t) + air.off[3 * i] * r;
      P[3 * i + 1] = lerp(pp[3 * lo + 1], pp[3 * hi + 1], t) + air.off[3 * i + 1] * r;
      P[3 * i + 2] = lerp(pp[3 * lo + 2], pp[3 * hi + 2], t) + air.off[3 * i + 2] * r;
      air.side[i] = lerp(pth.side[lo], pth.side[hi], t);
      air.a[i] = vis * smoothstep(0.0, 0.14, s) * (1 - smoothstep(pth.L - 0.14, pth.L, s));
    }
    airGeo.attributes.position.needsUpdate = true;
    airGeo.attributes.aSide.needsUpdate = true;
    airGeo.attributes.aA.needsUpdate = true;
  }

  const PAO_P = TRACHEA_TOP.clone().add(new V3(0, 0.015, 0));
  function update(dt) {
    st.time += dt;
    U.uTime.value = st.time;
    U.uPulse.value = Math.sin(st.time * TAU * 0.9);

    // disease morph (1.2 s)
    if (st.wK < 1) {
      st.wK = Math.min(1, st.wK + dt / 1.2);
      const k = ease5(st.wK);
      for (const key of ['n', 'f', 'e']) st.w[key] = lerp(st.wFrom[key], st.wTo[key], k);
    }
    // pneumothorax (1.5 s)
    if (st.pneumoK < 1) {
      st.pneumoK = Math.min(1, st.pneumoK + dt / 1.5);
      st.pneumo = lerp(st.pneumoFrom, st.pneumoTo, ease5(st.pneumoK));
    }
    const D = derived();
    updateBreath(dt, D);

    S.volEff = st.vol * D.exc; S.emph = D.emph; S.dScale = D.dScale; S.pneumo = st.pneumo;
    U.uVolEff.value = S.volEff; U.uEmph.value = D.emph; U.uFib.value = D.fib; U.uDScale.value = D.dScale; U.uPneumo.value = st.pneumo;
    alvMat.uniforms.uKeep.value = D.keep;

    // highlight / dim
    const kk = 1 - Math.exp(-dt * 7);
    for (const p of Object.keys(HL)) {
      st.hlAmt[p] += ((st.hl === p ? 1 : 0) - st.hlAmt[p]) * kk;
      st.dim[p] += ((st.hl === null || st.hl === p ? 1 : 0) - st.dim[p]) * kk;
      HL[p].value = st.hlAmt[p]; DIM[p].value = st.dim[p];
    }
    // visibility of mode-dependent parts
    const pleuraVis = isThorax ? 1 : st.hlAmt.ppl;
    for (const m of pleuraMeshes) {
      m.visible = pleuraVis > 0.004;
      m.material.uniforms.uVis.value = pleuraVis;
      m.material.uniforms.uAir.value = m.userData.left && isThorax ? st.pneumo : 0;
    }
    const ringVis = isThorax ? 1 : st.hlAmt.pao;
    const rk = st.hlAmt.pao * (0.6 + 0.4 * U.uPulse.value);
    ringMat.color.copy(ringCol).lerp(U.uYellow.value, rk);
    ringMat.emissive.copy(ringCol).lerp(U.uYellow.value, rk);
    ringMat.emissiveIntensity = lerp(PAL[st.theme].ring.em, 0.6, rk);
    paoRing.visible = ringVis > 0.004;
    ringMat.opacity = ringVis;
    breatheJS(PAO_P, 0, S, K_LUNG, paoRing.position);
    paoRing.scale.setScalar(D.dScale * (1 + 0.25 * st.hlAmt.pao * (0.5 + 0.5 * U.uPulse.value)));
    bullae.visible = D.emph > 0.004;
    bullaMat.uniforms.uVis.value = D.emph;

    // airflow
    st.airOn += ((st.airflow ? 1 : 0) - st.airOn) * (1 - Math.exp(-dt * 5));
    airMat.uniforms.uOn.value = st.airOn;
    updateAir(dt, st.flow * D.exc);

    // idle motion
    if (opts.autoRotate) {
      root.rotation.y = THREE.MathUtils.degToRad(20) * Math.sin(st.time * TAU / 22);
      root.position.y = 0.03 * Math.sin(st.time * TAU / 8);
    }
    if (controls) controls.update();

    const payload = { t: st.cycleT, phase: st.phase, volume: st.rawVol };
    for (const cb of breathCbs) { try { cb(payload); } catch (e) { console.error(e); } }
  }

  function render() {
    if (st.theme === 'dark') composer.render(); else renderer.render(scene, camera);
  }

  function loop() {
    if (!st.running) return;
    st.raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt);
    render();
  }

  /* ---------- anchors ---------- */
  const ANCH = {
    pao: { p: TRACHEA_TOP.clone().add(new V3(0, 0.015, 0)), side: 0, K: K_LUNG, vis: () => true },
    ppl: { p: M.pplPoint.clone(), side: -1, K: K_PLEURA, vis: () => isThorax || st.hlAmt.ppl > 0.5 },
    pa: { p: new V3(-0.66, -0.3, 0.06), side: -1, K: K_LUNG, vis: () => true },
    pbs: { p: TH ? TH.pbsPoint.clone() : new V3(-1.4, 0, -0.1), side: 0, K: K_CHEST, vis: () => isThorax },
    trachea: { p: new V3(0, 1.3, -0.08), side: 0, K: K_LUNG, vis: () => true },
    leftLung: { p: new V3(0.64, -0.05, -0.04), side: 1, K: K_LUNG, vis: () => true },
    rightLung: { p: new V3(-0.66, -0.05, -0.04), side: -1, K: K_LUNG, vis: () => true },
    diaphragm: { p: new V3(-0.55, diaY(-0.55, 0.0), 0.0), side: 0, K: K_DIA, vis: () => isThorax },
  };

  function getAnchors() {
    const out = {};
    const w = st.size.w, h = st.size.h;
    root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const v = new V3();
    for (const [name, a] of Object.entries(ANCH)) {
      breatheJS(a.p, a.side, S, a.K, v);
      v.applyMatrix4(root.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (0.5 - v.y * 0.5) * h;
      const on = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1.02 && Math.abs(v.y) <= 1.02;
      out[name] = { x, y, visible: !!(on && a.vis()) };
    }
    return out;
  }

  /* ---------- controller ---------- */
  const ctl = {
    start() {
      if (st.running || st.disposed) return;
      st.running = true;
      resize();
      clock.start(); clock.getDelta();
      st.raf = requestAnimationFrame(loop);
    },
    stop() {
      st.running = false;
      cancelAnimationFrame(st.raf);
      clock.stop();
    },
    dispose() {
      if (st.disposed) return;
      ctl.stop();
      st.disposed = true;
      ro.disconnect();
      breathCbs.clear();
      if (controls) controls.dispose();
      for (const d of disposables) d.dispose && d.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
      envTex.dispose(); pmrem.dispose();
      bloom.dispose(); outputPass.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); rt.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
    setTheme(theme) {
      st.theme = theme === 'light' ? 'light' : 'dark';
      applyTheme();
    },
    setAutoBreath(on, period = 4) {
      const p = Math.max(0.5, Number(period) || 4);
      if (on) {
        if (!st.auto) {
          // resume the cycle from the current volume (rising) to avoid a jump
          const v = clamp(st.vol, 0, 1), Ti = p * derived().tiFrac;
          st.cycleT = Ti * Math.acos(1 - 2 * v) / Math.PI;
        } else if (p !== st.period) {
          st.cycleT = (st.cycleT / st.period) * p;
        }
        st.period = p; st.auto = true;
      } else {
        st.period = p; st.auto = false; st.target = st.vol;
      }
    },
    setVolume(v) {
      if (st.auto) return;
      st.target = clamp(Number(v) || 0, 0, 1.8);
    },
    onBreath(cb) {
      if (typeof cb !== 'function') return () => {};
      breathCbs.add(cb);
      return () => breathCbs.delete(cb);
    },
    setAirflow(on) { st.airflow = !!on; },
    setDisease(name) {
      const to = { n: name === 'fibrosis' || name === 'emphysema' ? 0 : 1, f: name === 'fibrosis' ? 1 : 0, e: name === 'emphysema' ? 1 : 0 };
      st.wFrom = Object.assign({}, st.w); st.wTo = to; st.wK = 0;
    },
    highlight(name) {
      st.hl = ['pao', 'ppl', 'pa', 'pbs'].includes(name) ? name : null;
    },
    setPneumothorax(on) {
      if (!isThorax) return;
      st.pneumoFrom = st.pneumo; st.pneumoTo = on ? 1 : 0; st.pneumoK = 0;
    },
    getAnchors,
  };
  return ctl;
}

export default { mount };
