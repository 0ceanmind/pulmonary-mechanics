/**
 * airway.js — procedural 3D airway module for the Pulmonary Mechanics deck
 * (airway-resistance section). One scene per mount.
 *
 *   const ctl = mount(container, { mode: 'poiseuille' | 'bronchomotor' | 'traction' | 'turbulence', theme: 'dark' | 'light' });
 *   ctl.start(); ctl.stop(); ctl.dispose(); ctl.setTheme('light'); ctl.getAnchors();
 *
 * Mode APIs
 *   poiseuille   setRadius(r 0.4–1) setLength(L 0.5–1.5) setViscosity(eta 1–3) getState() → { r, L, eta, R, flow }
 *   bronchomotor setTone(x −1…+1) getState() → { tone, radius, Raw, flow }
 *   traction     setLungVolume(v 0–1) setRecoil(k 0–1) getState() → { v, k, radius, Raw }
 *   turbulence   setRegime('laminar'|'transitional'|'turbulent') setGas('air'|'heliox') getState() → { regime, gas, relativeResistance }
 *
 * Every setter accepts an optional second argument `{ instant: true }` to skip the tween.
 * Three.js r160, no network, procedural everything.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

/* ------------------------------------------------------------------ */
/* tokens & small utilities                                            */
/* ------------------------------------------------------------------ */

const PALETTE = {
  dark: {
    text: '#f5f5f7', text2: '#a1a1a6', blue: '#2997ff', cyan: '#64d2ff', green: '#30d158', pink: '#ff375f',
    orange: '#ff9f0a', purple: '#bf5af2', yellow: '#ffd60a', red: '#ff453a', tissue: '#ff8fa3',
  },
  light: {
    text: '#1d1d1f', text2: '#6e6e73', blue: '#0071e3', cyan: '#0a84c6', green: '#1f9d48', pink: '#e0254e',
    orange: '#d97a00', purple: '#9b3fd1', yellow: '#c9a400', red: '#d70015', tissue: '#e8657d',
  },
};

function makeTokens(theme) {
  const src = PALETTE[theme] || PALETTE.dark;
  const out = {};
  for (const k of Object.keys(src)) out[k] = new THREE.Color(src[k]);
  return out;
}

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const num = (v, d) => (Number.isFinite(+v) ? +v : d);

/** Visual clamp for particle speed: proportional to flow, but never frozen and never frantic. */
const visSpeed = (f) => Math.min(2.3, Math.sqrt(f * f + 0.055 * 0.055));

/** Deterministic PRNG (mulberry32) so every mount looks identical. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Critically damped spring (smooth, velocity-preserving retargeting). omega 6 ≈ 0.8 s settle. */
class Spring {
  constructor(v, omega = 6) {
    this.v = v; this.t = v; this.vel = 0; this.w = omega;
  }
  set(t, instant = false) {
    this.t = t;
    if (instant) { this.v = t; this.vel = 0; }
  }
  update(dt) {
    const w = this.w, x = this.v - this.t;
    const e = Math.exp(-w * dt);
    const tmp = (this.vel + w * x) * dt;
    this.vel = (this.vel - w * tmp) * e;
    this.v = this.t + (x + tmp) * e;
    if (Math.abs(this.v - this.t) < 4e-4 && Math.abs(this.vel) < 4e-3) { this.v = this.t; this.vel = 0; }
    return this.v;
  }
}

/* ------------------------------------------------------------------ */
/* materials                                                           */
/* ------------------------------------------------------------------ */

/**
 * Premium "acrylic" glass without transmission passes: fresnel rim + env specular,
 * composited premultiplied so reflections stay bright while the body stays clear.
 */
function makeGlass({ side = THREE.FrontSide, rimPow = 2.4, roughness = 0.07, env = 1.0 } = {}) {
  const u = {
    uTint: { value: new THREE.Color(1, 1, 1) },
    uBodyA: { value: 0.03 },
    uRimColor: { value: new THREE.Color(1, 1, 1) },
    uRimA: { value: 0.45 },
    uRimPow: { value: rimPow },
    uSpecK: { value: 1.0 },
    uFade: { value: new THREE.Vector2(0, 0) },
    uAlphaK: { value: 1.0 },
  };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness, envMapIntensity: env, side,
    transparent: true, depthWrite: false,
  });
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTint; uniform float uBodyA; uniform vec3 uRimColor; uniform float uRimA;
uniform float uRimPow; uniform float uSpecK; uniform vec2 uFade; uniform float uAlphaK;
vec3 awOut(vec3 c) {
#ifdef TONE_MAPPING
  c = toneMapping(c);
#endif
  return linearToOutputTexel(vec4(c, 1.0)).rgb;
}`)
      .replace('#include <opaque_fragment>', `
  float awNdv = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
  float awFr = pow(1.0 - awNdv, uRimPow);
  float awFade = 1.0;
  if (uFade.y > uFade.x) awFade = 1.0 - smoothstep(uFade.x, uFade.y, vViewPosition.z);
  float awRim = awFr * uRimA * awFade;
  float awBody = uBodyA * awFade;
  vec3 awSpec = awOut(totalSpecular * uSpecK * mix(0.22, 1.0, pow(1.0 - awNdv, 1.5))) * awFade;
  gl_FragColor = vec4(awOut(uTint) * awBody + awOut(uRimColor) * awRim + awSpec, clamp((awBody + awRim) * uAlphaK, 0.0, 1.0));
`)
      .replace('#include <tonemapping_fragment>', '')
      .replace('#include <colorspace_fragment>', '');
  };
  m.customProgramCacheKey = () => 'airway-glass-v2';
  m.userData.u = u;
  return m;
}

function glassTheme(mat, dark, { tint, rim, bodyA, rimA, specK, powK = 1, alphaK }) {
  const u = mat.userData.u;
  if (u.basePow === undefined) u.basePow = u.uRimPow.value;
  // dark theme: glass mostly *adds* light (never muddies what is behind it); light theme: true alpha
  u.uAlphaK.value = alphaK !== undefined ? alphaK : (dark ? 0.35 : 1.0);
  u.uTint.value.copy(tint);
  u.uRimColor.value.copy(rim);
  u.uBodyA.value = bodyA;
  u.uRimA.value = rimA;
  u.uSpecK.value = specK;
  u.uRimPow.value = u.basePow * powK;
}

/** Clear glass presets per theme. */
function clearGlass(mat, dark, strength = 1) {
  if (dark) {
    glassTheme(mat, dark, {
      tint: new THREE.Color(0.85, 0.92, 1.0), rim: new THREE.Color(0.62, 0.8, 1.0),
      bodyA: 0.02 * strength, rimA: 0.42 * strength, specK: 0.75 * strength,
    });
  } else {
    glassTheme(mat, dark, {
      tint: new THREE.Color(0.45, 0.53, 0.66), rim: new THREE.Color(0.14, 0.2, 0.3),
      bodyA: 0.045 * strength, rimA: Math.min(0.85, 0.68 * strength), specK: 0.12 * strength, powK: 0.72,
    });
  }
}

/* ------------------------------------------------------------------ */
/* streak particles (trails through 6 history points, screen-space)    */
/* ------------------------------------------------------------------ */

const STREAK_VERT = /* glsl */`
attribute vec3 h0; attribute vec3 h1; attribute vec3 h2; attribute vec3 h3; attribute vec3 h4; attribute vec3 h5;
attribute vec4 aCol; attribute float aW;
uniform vec2 uRes; uniform float uPhase; uniform float uWidth;
varying vec4 vCol; varying float vSide; varying float vT;
vec3 hp(float i) {
  if (i < 0.5) return h0;
  if (i < 1.5) return h1;
  if (i < 2.5) return h2;
  if (i < 3.5) return h3;
  if (i < 4.5) return h4;
  return mix(h5, h4, uPhase);
}
void main() {
  float i = position.x; float side = position.y;
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 c  = mvp * vec4(hp(i), 1.0);
  vec4 ca = mvp * vec4(hp(max(i - 1.0, 0.0)), 1.0);
  vec4 cb = mvp * vec4(hp(min(i + 1.0, 5.0)), 1.0);
  vec2 sa = ca.xy / ca.w * uRes; vec2 sb = cb.xy / cb.w * uRes;
  vec2 d = sa - sb; float len = length(d);
  vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float t = i / 5.0;
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uRes.y / c.w;
  float hw = max(aW * uWidth * pxPerUnit * 0.5, 0.9) * (1.0 - 0.72 * t);
  vec2 off = nrm * hw * side;
  if (i < 0.5) off += dir * hw;
  c.xy += off / (0.5 * uRes) * c.w;
  gl_Position = c;
  vCol = aCol; vSide = side; vT = t;
}`;

const STREAK_FRAG = /* glsl */`
uniform float uCore; uniform float uOpacity;
varying vec4 vCol; varying float vSide; varying float vT;
void main() {
  float e = abs(vSide);
  float prof = exp(-e * e * 2.6);
  float fade = pow(1.0 - vT, 1.25);
  float a = vCol.a * prof * fade * uOpacity;
  if (a < 0.002) discard;
  vec3 col = mix(vCol.rgb, vec3(1.0), uCore * exp(-e * e * 6.0) * (1.0 - vT));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

const HEAD_VERT = /* glsl */`
attribute vec3 h0; attribute vec4 aCol; attribute float aW;
uniform vec2 uRes; uniform float uHead;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec4 c = projectionMatrix * modelViewMatrix * vec4(h0, 1.0);
  float pxPerUnit = projectionMatrix[1][1] * 0.5 * uRes.y / c.w;
  float r = max(aW * uHead * pxPerUnit * 0.5, 1.4);
  c.xy += position.xy * r / (0.5 * uRes) * c.w;
  gl_Position = c; vUv = position.xy; vCol = aCol;
}`;

const HEAD_FRAG = /* glsl */`
uniform float uCore; uniform float uOpacity; uniform float uHeadA;
varying vec2 vUv; varying vec4 vCol;
void main() {
  float d2 = dot(vUv, vUv);
  if (d2 > 1.0) discard;
  float a = vCol.a * exp(-d2 * 3.2) * uOpacity * uHeadA;
  if (a < 0.002) discard;
  vec3 col = mix(vCol.rgb, vec3(1.0), uCore * exp(-d2 * 9.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

class Streaks {
  constructor(max, res, { trail = 0.3, width = 0.07, head = 2.3, darkBlend = 'additive' } = {}) {
    this.max = max;
    this.darkBlend = darkBlend;
    this.interval = trail / 4;
    this.acc = 0;
    this.h = [];
    for (let k = 0; k < 6; k++) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      a.setUsage(THREE.DynamicDrawUsage);
      this.h.push(a);
    }
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.w = new THREE.InstancedBufferAttribute(new Float32Array(max).fill(width), 1).setUsage(THREE.DynamicDrawUsage);

    const g = new THREE.InstancedBufferGeometry();
    const pos = new Float32Array(12 * 3);
    for (let i = 0; i < 6; i++) {
      pos[(2 * i) * 3] = i; pos[(2 * i) * 3 + 1] = -1;
      pos[(2 * i + 1) * 3] = i; pos[(2 * i + 1) * 3 + 1] = 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = [];
    for (let i = 0; i < 5; i++) {
      const a = 2 * i, b = 2 * i + 1, c = 2 * i + 2, d = 2 * i + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    for (let k = 0; k < 6; k++) g.setAttribute('h' + k, this.h[k]);
    g.setAttribute('aCol', this.col);
    g.setAttribute('aW', this.w);
    g.instanceCount = max;

    this.uniforms = {
      uRes: { value: res }, uPhase: { value: 0 }, uWidth: { value: 1 }, uHead: { value: head },
      uCore: { value: 0.55 }, uOpacity: { value: 1 }, uHeadA: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;

    const hg = new THREE.InstancedBufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    hg.setIndex([0, 1, 2, 0, 2, 3]);
    hg.setAttribute('h0', this.h[0]);
    hg.setAttribute('aCol', this.col);
    hg.setAttribute('aW', this.w);
    hg.instanceCount = max;
    this.headMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: HEAD_VERT, fragmentShader: HEAD_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.heads = new THREE.Mesh(hg, this.headMat);
    this.heads.frustumCulled = false;

    this.geo = g; this.headGeo = hg;
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.heads);
    this._count = max;
  }
  setRenderOrder(o) { this.mesh.renderOrder = o; this.heads.renderOrder = o + 0.01; }
  set count(n) { n = clamp(n | 0, 0, this.max); this._count = n; this.geo.instanceCount = n; this.headGeo.instanceCount = n; }
  get count() { return this._count; }
  head(i, x, y, z) { const a = this.h[0].array, j = i * 3; a[j] = x; a[j + 1] = y; a[j + 2] = z; }
  resetTrail(i) {
    const a = this.h[0].array, j = i * 3;
    for (let k = 1; k < 6; k++) { const b = this.h[k].array; b[j] = a[j]; b[j + 1] = a[j + 1]; b[j + 2] = a[j + 2]; }
  }
  color(i, c, alpha) { const a = this.col.array, j = i * 4; a[j] = c.r; a[j + 1] = c.g; a[j + 2] = c.b; a[j + 3] = alpha; }
  rgba(i, r, g, b, alpha) { const a = this.col.array, j = i * 4; a[j] = r; a[j + 1] = g; a[j + 2] = b; a[j + 3] = alpha; }
  width(i, w) { this.w.array[i] = w; }
  tick(dt) {
    this.acc += dt;
    if (this.acc >= this.interval) {
      this.acc %= this.interval;
      for (let k = 5; k >= 1; k--) this.h[k].array.set(this.h[k - 1].array);
    }
    this.uniforms.uPhase.value = this.acc / this.interval;
    for (let k = 0; k < 6; k++) this.h[k].needsUpdate = true;
    this.col.needsUpdate = true;
    this.w.needsUpdate = true;
  }
  setTheme(dark) {
    const b = dark && this.darkBlend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.mat.blending = b; this.headMat.blending = b;
    this.uniforms.uCore.value = dark ? (this.darkBlend === 'additive' ? 0.55 : 0.4) : 0.0;
    this.uniforms.uHeadA.value = dark ? 1.0 : 0.85;
  }
}

/* ------------------------------------------------------------------ */
/* procedural geometry helpers                                         */
/* ------------------------------------------------------------------ */

/** Area-weighted vertex normals on raw typed arrays (~10× faster than computeVertexNormals). */
function fastNormals(geo) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index.array;
  nor.fill(0);
  for (let i = 0, n = idx.length; i < n; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const abx = pos[b] - pos[a], aby = pos[b + 1] - pos[a + 1], abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a], acy = pos[c + 1] - pos[a + 1], acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz;
    nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz;
    nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
  }
  for (let i = 0, n = nor.length; i < n; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  geo.attributes.normal.needsUpdate = true;
}

/** Grid quads; aFirst → face normal = ∂a × ∂b, otherwise ∂b × ∂a. */
function quadIdx(out, base, na, nb, aFirst) {
  const S = nb + 1;
  for (let a = 0; a < na; a++) {
    for (let b = 0; b < nb; b++) {
      const i00 = base + a * S + b, i10 = i00 + S, i01 = i00 + 1, i11 = i10 + 1;
      if (aFirst) out.push(i00, i10, i01, i10, i11, i01);
      else out.push(i00, i01, i10, i10, i01, i11);
    }
  }
}

/**
 * Thick tubular shell along x: P(θ, x, r) = (x, r cosθ, r sinθ), θ ∈ [t0, t1].
 * Groups: 0 = inner + outer surfaces, 1 = cut faces + end faces.
 */
function createShell({ nT, nX, t0, t1, len, cut }) {
  const SS = (nX + 1) * (nT + 1);
  const F = {};
  let n = 0;
  F.inner = n; n += SS;
  F.outer = n; n += SS;
  if (cut) { F.cutA = n; n += (nX + 1) * 2; F.cutB = n; n += (nX + 1) * 2; }
  F.endL = n; n += (nT + 1) * 2;
  F.endR = n; n += (nT + 1) * 2;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const i0 = [], i1 = [];
  quadIdx(i0, F.inner, nX, nT, true);
  quadIdx(i0, F.outer, nX, nT, false);
  if (cut) { quadIdx(i1, F.cutA, nX, 1, false); quadIdx(i1, F.cutB, nX, 1, true); }
  quadIdx(i1, F.endL, nT, 1, true);
  quadIdx(i1, F.endR, nT, 1, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(i0.concat(i1));
  geo.addGroup(0, i0.length, 0);
  geo.addGroup(i0.length, i1.length, 1);
  const th = new Float32Array(nT + 1), ct = new Float32Array(nT + 1), st = new Float32Array(nT + 1);
  for (let b = 0; b <= nT; b++) { th[b] = t0 + (t1 - t0) * b / nT; ct[b] = Math.cos(th[b]); st[b] = Math.sin(th[b]); }
  for (let a = 0; a <= nX; a++) {
    for (let b = 0; b <= nT; b++) {
      const k1 = F.inner + a * (nT + 1) + b, k2 = F.outer + a * (nT + 1) + b;
      uv[k1 * 2] = uv[k2 * 2] = b / nT * (t1 - t0) / TAU * 6;
      uv[k1 * 2 + 1] = uv[k2 * 2 + 1] = a / nX * len / 2;
    }
  }
  const nrm = geo.attributes.normal.array;
  function set(i, x, r, c, s) { const j = i * 3; pos[j] = x; pos[j + 1] = r * c; pos[j + 2] = r * s; }
  function update(rIn, rOut) {
    for (let a = 0; a <= nX; a++) {
      const x = -len / 2 + len * a / nX;
      for (let b = 0; b <= nT; b++) {
        const c = ct[b], s = st[b];
        const ri = rIn(th[b], x), ro = rOut(th[b], x);
        set(F.inner + a * (nT + 1) + b, x, ri, c, s);
        set(F.outer + a * (nT + 1) + b, x, ro, c, s);
        if (cut && b === 0) { set(F.cutA + a * 2, x, ri, c, s); set(F.cutA + a * 2 + 1, x, ro, c, s); }
        if (cut && b === nT) { set(F.cutB + a * 2, x, ri, c, s); set(F.cutB + a * 2 + 1, x, ro, c, s); }
        if (a === 0) { set(F.endL + b * 2, x, ri, c, s); set(F.endL + b * 2 + 1, x, ro, c, s); }
        if (a === nX) { set(F.endR + b * 2, x, ri, c, s); set(F.endR + b * 2 + 1, x, ro, c, s); }
      }
    }
    geo.attributes.position.needsUpdate = true;
    fastNormals(geo);
    if (!cut) {
      // closed ring: weld the seam normals
      const weld = (base, S, last) => {
        for (let a = 0; a <= nX; a++) {
          const p = (base + a * S) * 3, q = (base + a * S + last) * 3;
          let x = nrm[p] + nrm[q], y = nrm[p + 1] + nrm[q + 1], z = nrm[p + 2] + nrm[q + 2];
          const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
          nrm[p] = nrm[q] = x; nrm[p + 1] = nrm[q + 1] = y; nrm[p + 2] = nrm[q + 2] = z;
        }
      };
      weld(F.inner, nT + 1, nT);
      weld(F.outer, nT + 1, nT);
    }
    geo.attributes.normal.needsUpdate = true;
  }
  return { geometry: geo, update };
}

/**
 * Smooth-muscle bands: rounded-rectangle ribbons swept along helical arcs around the x axis.
 */
function createBands(count, nU, nV) {
  const per = (nU + 1) * nV;
  const n = per * count;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const idx = [];
  for (let j = 0; j < count; j++) {
    const base = j * per;
    for (let a = 0; a < nU; a++) {
      for (let b = 0; b < nV; b++) {
        const b1 = (b + 1) % nV;
        const i00 = base + a * nV + b, i01 = base + a * nV + b1, i10 = base + (a + 1) * nV + b, i11 = base + (a + 1) * nV + b1;
        idx.push(i00, i01, i10, i10, i01, i11);
      }
    }
    for (let a = 0; a <= nU; a++) for (let b = 0; b < nV; b++) {
      const k = base + a * nV + b;
      uv[k * 2] = a / nU * 4; uv[k * 2 + 1] = b / nV;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const px = new Float32Array(nV), pr = new Float32Array(nV);
  for (let b = 0; b < nV; b++) {
    const f = TAU * b / nV, c = Math.cos(f), s = Math.sin(f);
    px[b] = Math.sign(c) * Math.pow(Math.abs(c), 0.55);
    pr[b] = Math.sign(s) * Math.pow(Math.abs(s), 0.55);
  }
  const us = new Float32Array(nU + 1);
  for (let a = 0; a <= nU; a++) us[a] = 0.5 - 0.5 * Math.cos(Math.PI * a / nU);
  const E = 0.045;
  const taper = (u) => {
    if (u < E) { const q = 1 - u / E; return Math.sqrt(Math.max(0, 1 - q * q)); }
    if (u > 1 - E) { const q = 1 - (1 - u) / E; return Math.sqrt(Math.max(0, 1 - q * q)); }
    return 1;
  };
  function update(centres, { R, t, w, a0, a1, pitch }) {
    const mid = (a0 + a1) / 2;
    for (let j = 0; j < count; j++) {
      const base = j * per, xc = centres[j];
      for (let a = 0; a <= nU; a++) {
        const u = us[a], th = a0 + (a1 - a0) * u, tp = taper(u);
        const c = Math.cos(th), s = Math.sin(th);
        const xh = xc + pitch * (th - mid) / TAU;
        for (let b = 0; b < nV; b++) {
          const k = (base + a * nV + b) * 3;
          const x = xh + px[b] * w * 0.5 * tp;
          const r = R + pr[b] * t * 0.5 * tp;
          pos[k] = x; pos[k + 1] = r * c; pos[k + 2] = r * s;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    fastNormals(geo);
  }
  return { geometry: geo, update };
}

/**
 * Tether tube lying in the xy plane, built from two halves so it can "snap" in the middle.
 * Normals are analytic (planar centre-line).
 */
function createTether(nS, nR) {
  const rings = 2 * (nS + 1);
  const n = rings * nR;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const idx = [];
  for (let h = 0; h < 2; h++) {
    const base = h * (nS + 1) * nR;
    for (let a = 0; a < nS; a++) {
      for (let b = 0; b < nR; b++) {
        const b1 = (b + 1) % nR;
        const i00 = base + a * nR + b, i01 = base + a * nR + b1, i10 = base + (a + 1) * nR + b, i11 = base + (a + 1) * nR + b1;
        idx.push(i00, i01, i10, i10, i01, i11);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const ca = new Float32Array(nR), sa = new Float32Array(nR);
  for (let b = 0; b < nR; b++) { ca[b] = Math.cos(TAU * b / nR); sa[b] = Math.sin(TAU * b / nR); }
  const P = { x: 0, y: 0 }, Q = { x: 0, y: 0 };
  /** path(s, out) writes the centre-line point; ranges: [[s0,s1],[s2,s3]]; radius(s) */
  function update(path, ranges, radius) {
    for (let h = 0; h < 2; h++) {
      const base = h * (nS + 1) * nR;
      const [sA, sB] = ranges[h];
      for (let a = 0; a <= nS; a++) {
        const s = sA + (sB - sA) * a / nS;
        path(s, P);
        path(Math.min(1, s + 0.004), Q);
        let tx = Q.x - P.x, ty = Q.y - P.y;
        if (s + 0.004 > 1) { path(s - 0.004, Q); tx = P.x - Q.x; ty = P.y - Q.y; }
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const nx = -ty, ny = tx;
        const r = radius(s, h);
        for (let b = 0; b < nR; b++) {
          const ox = nx * ca[b], oy = ny * ca[b], oz = sa[b];
          const k = (base + a * nR + b) * 3;
          pos[k] = P.x + ox * r; pos[k + 1] = P.y + oy * r; pos[k + 2] = oz * r;
          nor[k] = ox; nor[k + 1] = oy; nor[k + 2] = oz;
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
  }
  return { geometry: geo, update };
}

/** Torus lip around the x axis whose major radius can be updated in place. */
function createLip(radial = 14, tubular = 128) {
  const geo = new THREE.TorusGeometry(1, 0.05, radial, tubular);
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array;
  function update(R, t) {
    let k = 0;
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * TAU, cv = Math.cos(v), sv = Math.sin(v);
      for (let i = 0; i <= tubular; i++) {
        const u = i / tubular * TAU, cu = Math.cos(u), su = Math.sin(u);
        pos[k] = t * sv; pos[k + 1] = (R + t * cv) * cu; pos[k + 2] = (R + t * cv) * su;
        nor[k] = sv; nor[k + 1] = cv * cu; nor[k + 2] = cv * su;
        k += 3;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
  }
  update(1, 0.05);
  return { geometry: geo, update };
}

/** Fine fibre striations used as a bump map on smooth muscle. */
function striationTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, 64, 256);
  const r = rng(7);
  for (let y = 0; y < 256; y += 1) {
    const v = 128 + Math.sin(y * 0.9) * 40 + (r() - 0.5) * 50;
    g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
    g.fillRect(0, y, 64, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Soft radial falloff (for ground glows/shadows). */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addGlassPair(parent, geo, makeMat, orderBack = 1, orderFront = 4) {
  const back = new THREE.Mesh(geo, makeMat(THREE.BackSide));
  const front = new THREE.Mesh(geo, makeMat(THREE.FrontSide));
  back.renderOrder = orderBack; front.renderOrder = orderFront;
  parent.add(back, front);
  return { back, front, mats: [back.material, front.material] };
}

/* ------------------------------------------------------------------ */
/* MODE: poiseuille                                                    */
/* ------------------------------------------------------------------ */

const FRONT_VERT = /* glsl */`
uniform float uX0; uniform float uD; uniform float uR;
varying vec3 vN; varying vec3 vV; varying float vRho;
void main() {
  float rho = position.x; float th = position.y;
  vec3 p = vec3(uX0 + uD * (1.0 - rho * rho), rho * uR * cos(th), rho * uR * sin(th));
  float R2 = max(uR * uR, 1e-4);
  vec3 g = vec3(1.0, 2.0 * uD * p.y / R2, 2.0 * uD * p.z / R2);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * g); vV = -mv.xyz; vRho = rho;
  gl_Position = projectionMatrix * mv;
}`;
const FRONT_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying float vRho;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float fr = pow(1.0 - ndv, 2.2);
  float a = uOpacity * (0.06 + 0.94 * fr) * (1.0 - smoothstep(0.86, 1.0, vRho));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

function buildPoiseuille(ctx) {
  const root = new THREE.Group();
  ctx.scene.add(root);
  const R0 = 1.12, L0 = 7.2, WALL = 0.075;
  const sR = new Spring(1), sL = new Spring(1), sE = new Spring(1);
  const target = { r: 1, L: 1, eta: 1 };

  // glass tube (outer + inner skins, each drawn back-then-front)
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).rotateZ(Math.PI / 2);
  const outer = addGlassPair(root, cyl, (side) => makeGlass({ side, rimPow: 2.2 }), 1, 5);
  const inner = addGlassPair(root, cyl, (side) => makeGlass({ side, rimPow: 3.0 }), 2, 4);
  const lipL = createLip(), lipR = createLip();
  const lipMat = makeGlass({ side: THREE.FrontSide, rimPow: 1.4 });
  const lipMeshL = new THREE.Mesh(lipL.geometry, lipMat), lipMeshR = new THREE.Mesh(lipR.geometry, lipMat);
  lipMeshL.renderOrder = lipMeshR.renderOrder = 6;
  root.add(lipMeshL, lipMeshR);

  // ground glow / contact shadow
  const groundTex = radialTexture();
  const groundMat = new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false, toneMapped: false });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = 0;
  root.add(ground);

  // parabolic "dye front" (velocity-profile bullet)
  const NFR = 26, NFT = 72;
  const fpos = new Float32Array((NFR + 1) * (NFT + 1) * 3);
  const fidx = [];
  for (let i = 0; i <= NFR; i++) for (let j = 0; j <= NFT; j++) {
    const k = (i * (NFT + 1) + j) * 3;
    fpos[k] = 0.98 * Math.sqrt(i / NFR); fpos[k + 1] = TAU * j / NFT;
  }
  quadIdx(fidx, 0, NFR, NFT, true);
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  fgeo.setIndex(fidx);
  const fUni = { uX0: { value: 0 }, uD: { value: 0 }, uR: { value: 1 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } };
  const fmat = new THREE.ShaderMaterial({
    uniforms: fUni, vertexShader: FRONT_VERT, fragmentShader: FRONT_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const frontMesh = new THREE.Mesh(fgeo, fmat);
  frontMesh.frustumCulled = false;
  frontMesh.renderOrder = 3;
  root.add(frontMesh);
  const front = { D: 0, a: 0, state: 'in', hold: 0 };

  // particles: a mid-plane "sheet" of lanes (shows the profile) + a volumetric cloud
  const LANES = 13, PER = 15, NSHEET = LANES * PER;
  const NVOL = 900, N = NSHEET + NVOL;
  const st = new Streaks(N, ctx.res, { trail: 0.3, width: 0.07, head: 1.9 });
  st.setRenderOrder(3);
  root.add(st.group);
  const xi = new Float32Array(N), rho = new Float32Array(N), th = new Float32Array(N), sheet = new Uint8Array(N);
  const r = rng(11);
  for (let l = 0; l < LANES; l++) {
    const rr = -0.93 + 1.86 * l / (LANES - 1);
    for (let p = 0; p < PER; p++) {
      const i = l * PER + p;
      sheet[i] = 1; rho[i] = rr; th[i] = 0;
      xi[i] = (p + 0.5 + (r() - 0.5) * 0.5 + (l % 2) * 0.5) / PER % 1;
    }
  }
  for (let i = NSHEET; i < N; i++) {
    rho[i] = 0.93 * Math.sqrt(r());
    th[i] = r() * TAU;
    xi[i] = r();
  }
  let active = -1;
  const cSlow = new THREE.Color(), cFast = new THREE.Color(), cTmp = new THREE.Color();
  let dark = true;
  let lastR = -1;

  function setTheme(isDark, tok) {
    dark = isDark;
    for (const m of outer.mats) clearGlass(m, dark, 1);
    for (const m of inner.mats) clearGlass(m, dark, 0.35);
    clearGlass(lipMat, dark, 1.6);
    st.setTheme(dark);
    if (dark) {
      cSlow.copy(tok.blue).multiplyScalar(0.75);
      cFast.copy(tok.blue).lerp(tok.cyan, 0.55);
      fUni.uColor.value.copy(tok.cyan);
      fmat.blending = THREE.AdditiveBlending;
      groundMat.color.copy(tok.blue).multiplyScalar(0.14);
      groundMat.blending = THREE.AdditiveBlending;
      groundMat.opacity = 1;
    } else {
      cSlow.copy(tok.blue).lerp(new THREE.Color(1, 1, 1), 0.35);
      cFast.copy(tok.blue).multiplyScalar(0.8);
      fUni.uColor.value.copy(tok.cyan).multiplyScalar(0.85);
      fmat.blending = THREE.NormalBlending;
      groundMat.color.setRGB(0.05, 0.08, 0.14);
      groundMat.blending = THREE.NormalBlending;
      groundMat.opacity = 0.16;
    }
  }

  function update(dt) {
    const rr = sR.update(dt), LL = sL.update(dt), eta = sE.update(dt);
    const R = R0 * rr, Lw = L0 * LL, Ri = R - WALL;
    outer.back.scale.set(Lw, R, R); outer.front.scale.copy(outer.back.scale);
    inner.back.scale.set(Lw, Ri, Ri); inner.front.scale.copy(inner.back.scale);
    if (Math.abs(R - lastR) > 1e-5) {
      lipL.update(R - WALL * 0.5, WALL * 0.62);
      lipR.update(R - WALL * 0.5, WALL * 0.62);
      lastR = R;
    }
    lipMeshL.position.x = -Lw / 2; lipMeshR.position.x = Lw / 2;
    ground.position.set(0, -R - 0.5, 0);
    ground.scale.set(Lw * 1.2, R * 3.0 + 0.6, 1);

    const flow = Math.pow(rr, 4) / (LL * eta);
    const vC = 3.1 * visSpeed(flow);
    const wK = (0.45 + 0.55 * rr) * (1 + 0.32 * (eta - 1));
    const aK = 1 + 0.1 * (eta - 1);
    const nVol = Math.round(260 + 220 * (eta - 1));
    const n = NSHEET + Math.min(NVOL, nVol);
    const reset0 = active < 0 ? 0 : active;
    st.count = n;

    for (let i = 0; i < n; i++) {
      const p = rho[i], prof = 1 - p * p;
      let x = xi[i] + vC * prof * dt / Lw;
      let wrapped = false;
      if (x >= 1) { x -= 1; wrapped = true; }
      xi[i] = x;
      const rad = p * Ri * 0.97;
      const px = (x - 0.5) * Lw;
      if (sheet[i]) st.head(i, px, rad, 0.0);
      else st.head(i, px, rad * Math.cos(th[i]), rad * Math.sin(th[i]));
      if (wrapped || i >= reset0) st.resetTrail(i);
      const fade = smooth(0, 0.045, x) * (1 - smooth(0.955, 1, x));
      cTmp.copy(cSlow).lerp(cFast, prof);
      const base = sheet[i] ? (dark ? 1.0 : 0.92) : (dark ? 0.16 : 0.16);
      st.color(i, cTmp, base * fade * aK);
      st.width(i, (sheet[i] ? 0.095 : 0.05) * wK);
    }
    active = n;
    st.tick(dt);

    // dye front life-cycle
    const x0 = -Lw / 2 + 0.12;
    if (front.state === 'in') { front.a = Math.min(1, front.a + dt / 0.45); if (front.a >= 1) front.state = 'run'; }
    front.D += vC * dt;
    if (front.state !== 'out' && x0 + front.D > Lw / 2 - 0.15) front.state = 'out';
    if (front.state === 'out') {
      front.a = Math.max(0, front.a - dt / 0.5);
      if (front.a <= 0) { front.hold += dt; if (front.hold > 0.35) { front.D = 0; front.state = 'in'; front.hold = 0; } }
    }
    front.D = Math.min(front.D, Lw - 0.3);
    fUni.uX0.value = x0; fUni.uD.value = front.D; fUni.uR.value = Ri * 0.97;
    fUni.uOpacity.value = front.a * (dark ? 0.55 : 0.42);
  }

  const api = {
    setRadius(v, o = {}) { target.r = clamp(num(v, 1), 0.4, 1); sR.set(target.r, o.instant); },
    setLength(v, o = {}) { target.L = clamp(num(v, 1), 0.5, 1.5); sL.set(target.L, o.instant); },
    setViscosity(v, o = {}) { target.eta = clamp(num(v, 1), 1, 3); sE.set(target.eta, o.instant); },
    getState() {
      const { r: rr, L, eta } = target;
      const Rres = (L * eta) / Math.pow(rr, 4);
      return { r: rr, L, eta, R: Rres, flow: 1 / Rres };
    },
  };

  function anchors() {
    const R = R0 * sR.v, Lw = L0 * sL.v;
    return {
      tube: { p: new THREE.Vector3(0, R, 0) },
      inlet: { p: new THREE.Vector3(-Lw / 2, 0, 0) },
      outlet: { p: new THREE.Vector3(Lw / 2, 0, 0) },
      lumen: { p: new THREE.Vector3(0, 0, 0) },
      wall: { p: new THREE.Vector3(Lw * 0.22, -(R - WALL), 0) },
      front: { p: new THREE.Vector3(fUni.uX0.value + front.D, 0, 0), visible: front.a > 0.4 },
    };
  }

  return {
    root, update, setTheme, api, anchors,
    frame: { center: new THREE.Vector3(0, -0.15, 0), halfW: 6.7, halfH: 2.2, dir: new THREE.Vector3(0.1, 0.3, 1).normalize() },
    textures: [groundTex],
  };
}

/* ------------------------------------------------------------------ */
/* MODE: bronchomotor                                                  */
/* ------------------------------------------------------------------ */

function buildBronchomotor(ctx) {
  const root = new THREE.Group();
  ctx.scene.add(root);
  const LEN = 6.4, RI0 = 1.0, A0 = 1.42 * 1.42 - 1;
  const CUT_C = 0.62, CUT_W = 1.95;
  const T0 = CUT_C + CUT_W / 2, T1 = CUT_C - CUT_W / 2 + TAU;
  const NFOLD = 9;

  const shell = createShell({ nT: 120, nX: 22, t0: T0, t1: T1, len: LEN, cut: true });
  const matSurf = new THREE.MeshPhysicalMaterial({
    roughness: 0.46, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.35, sheenRoughness: 0.5,
    side: THREE.DoubleSide, envMapIntensity: 0.55,
  });
  const matCut = new THREE.MeshPhysicalMaterial({ roughness: 0.7, side: THREE.DoubleSide, envMapIntensity: 0.5, sheen: 0.2 });
  const mucosa = new THREE.Mesh(shell.geometry, [matSurf, matCut]);
  mucosa.frustumCulled = false;
  root.add(mucosa);

  const NB = 7;
  const bands = createBands(NB, 84, 14);
  const stri = striationTexture();
  stri.repeat.set(1, 1);
  const matBand = new THREE.MeshPhysicalMaterial({
    roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.3, sheen: 0.5, sheenRoughness: 0.5,
    bumpMap: stri, bumpScale: 2.2, side: THREE.DoubleSide, envMapIntensity: 0.9,
  });
  const bandMesh = new THREE.Mesh(bands.geometry, matBand);
  bandMesh.frustumCulled = false;
  root.add(bandMesh);
  const centres = [];
  for (let j = 0; j < NB; j++) centres.push(-LEN / 2 + (j + 0.5) * LEN / NB);

  // air particles in the lumen
  const N = 300;
  const st = new Streaks(N, ctx.res, { trail: 0.3, width: 0.07, head: 2.0, darkBlend: 'normal' });
  st.setRenderOrder(3);
  root.add(st.group);
  const xi = new Float32Array(N), rho = new Float32Array(N), th = new Float32Array(N);
  const r = rng(23);
  for (let i = 0; i < N; i++) { xi[i] = r(); rho[i] = 0.84 * Math.sqrt(r()); th[i] = r() * TAU; }

  const sTone = new Spring(0, 6);
  let targetTone = 0;
  let G = null;
  let lastTone = NaN, firstReset = true;
  let dark = true, tok = ctx.tok;
  const cNeutral = new THREE.Color(), cBand = new THREE.Color(), cAir = new THREE.Color(), cAirFast = new THREE.Color(), cT = new THREE.Color();

  function geomFor(tone) {
    const s = tone >= 0 ? lerp(1, 0.45, tone) : lerp(1, 1.25, -tone);
    const Ri = RI0 * s;
    const Ro = Math.sqrt(Ri * Ri + A0);
    const fold = 0.3 * smooth(0.08, 1, tone);
    const tp = Math.max(0, tone), tn = Math.max(0, -tone);
    const tB = 0.17 + 0.2 * tp - 0.06 * tn;
    const wB = 0.46 + 0.12 * tp - 0.07 * tn;
    return { s, Ri, Ro, fold, tB, wB };
  }
  const rIn = (t, x) => G.Ri * (1 - G.fold * (0.5 + 0.5 * Math.cos(NFOLD * t + 0.5 * Math.sin(x * 0.8)))) * (1 + 0.012 * Math.sin(x * 2.1 + t * 3));
  const rOut = (t, x) => G.Ro * (1 + 0.01 * Math.sin(x * 1.7 - t * 2));

  const cRedT = new THREE.Color(), cGreenT = new THREE.Color();
  function recolor(tone) {
    if (tone >= 0) cBand.copy(cNeutral).lerp(cRedT, smooth(0, 0.85, tone));
    else cBand.copy(cNeutral).lerp(cGreenT, smooth(0, 0.85, -tone));
    matBand.color.copy(cBand);
    matBand.sheenColor.copy(cBand);
    matBand.emissive.copy(cBand).multiplyScalar(dark ? 0.08 + 0.2 * Math.abs(tone) : 0.02);
  }

  function setTheme(isDark, t) {
    dark = isDark; tok = t;
    matSurf.color.copy(t.tissue).multiplyScalar(dark ? 0.82 : 0.95);
    matSurf.sheenColor.copy(t.tissue).lerp(new THREE.Color(1, 1, 1), 0.35);
    matSurf.emissive.copy(t.tissue).multiplyScalar(dark ? 0.05 : 0);
    matCut.color.copy(t.tissue).lerp(new THREE.Color(1, 1, 1), dark ? 0.22 : 0.3);
    matCut.sheenColor.copy(matCut.color);
    matCut.emissive.copy(t.tissue).multiplyScalar(dark ? 0.05 : 0);
    cNeutral.copy(t.tissue).lerp(t.purple, 0.42).multiplyScalar(dark ? 0.36 : 0.42);
    cRedT.copy(t.red).multiplyScalar(dark ? 0.62 : 0.8);
    cGreenT.copy(t.green).multiplyScalar(dark ? 0.62 : 0.85);
    st.setTheme(dark);
    if (dark) { cAir.copy(t.blue).multiplyScalar(0.8); cAirFast.copy(t.blue).lerp(t.cyan, 0.5); }
    else { cAir.copy(t.blue).lerp(new THREE.Color(1, 1, 1), 0.3); cAirFast.copy(t.blue).multiplyScalar(0.85); }
    recolor(sTone.v);
  }

  function update(dt) {
    const tone = sTone.update(dt);
    if (tone !== lastTone) {
      G = geomFor(tone);
      shell.update(rIn, rOut);
      bands.update(centres, { R: G.Ro + G.tB * 0.5 - 0.035, t: G.tB, w: G.wB, a0: T0 + 0.07, a1: T1 - 0.07, pitch: 0.42 });
      recolor(tone);
      lastTone = tone;
    }
    const f = Math.pow(G.s, 4);
    const vC = 2.7 * visSpeed(f);
    for (let i = 0; i < N; i++) {
      const p = rho[i] / 0.84, prof = 1 - 0.9 * p * p;
      let x = xi[i] + vC * prof * dt / LEN, wrapped = false;
      if (x >= 1) { x -= 1; wrapped = true; }
      xi[i] = x;
      const px = (x - 0.5) * LEN;
      const rad = rho[i] * rIn(th[i], px) * 0.9;
      st.head(i, px, rad * Math.cos(th[i]), rad * Math.sin(th[i]));
      if (wrapped || firstReset) st.resetTrail(i);
      const fade = smooth(0.03, 0.16, x) * (1 - smooth(0.93, 0.995, x));
      cT.copy(cAir).lerp(cAirFast, prof);
      st.color(i, cT, (dark ? 0.85 : 0.8) * fade);
      st.width(i, 0.068 * (0.6 + 0.4 * G.s));
    }
    firstReset = false;
    st.tick(dt);
  }

  const api = {
    setTone(x, o = {}) { targetTone = clamp(num(x, 0), -1, 1); sTone.set(targetTone, o.instant); },
    getState() {
      const g = geomFor(targetTone);
      return { tone: targetTone, radius: g.s, Raw: 1 / Math.pow(g.s, 4), flow: Math.pow(g.s, 4) };
    },
  };

  function anchors() {
    const g = G || geomFor(0);
    const tm = 2.15, xb = centres[4] + 0.42 * (tm - (T0 + T1) / 2) / TAU;
    const rb = g.Ro + g.tB * 0.95;
    const tc = T0 + 0.01, rm = (g.Ri + g.Ro) / 2;
    const tb = Math.PI + 0.65, rf = g.Ri * (1 - g.fold);
    const tt = 2.7, rt = g.Ro + g.tB;
    return {
      lumen: { p: new THREE.Vector3(0, 0, 0) },
      inlet: { p: new THREE.Vector3(-LEN / 2, 0, 0) },
      outlet: { p: new THREE.Vector3(LEN / 2, 0, 0) },
      muscle: { p: new THREE.Vector3(xb, rb * Math.cos(tm), rb * Math.sin(tm)) },
      mucosa: { p: new THREE.Vector3(-1.4, rm * Math.cos(tc), rm * Math.sin(tc)) },
      tube: { p: new THREE.Vector3(-2.3, rt * Math.cos(tt), rt * Math.sin(tt)) },
      fold: { p: new THREE.Vector3(1.0, rf * Math.cos(tb), rf * Math.sin(tb)), visible: g.fold > 0.08 },
    };
  }

  return {
    root, update, setTheme, api, anchors,
    frame: { center: new THREE.Vector3(0.1, -0.1, 0), halfW: 4.9, halfH: 2.75, dir: new THREE.Vector3(0.52, 0.46, 1).normalize() },
    textures: [stri],
  };
}

/* ------------------------------------------------------------------ */
/* MODE: traction (radial traction of elastin tethers)                 */
/* ------------------------------------------------------------------ */

function buildTraction(ctx) {
  const root = new THREE.Group();
  ctx.scene.add(root);
  const NA = 10, R0 = 1.0, WALL = 0.34, DEPTH = 1.25;
  const BREAK = [0.8, -1, 0.52, -1, 0.3, 0.66, -1, 0.42, -1, -1];

  // airway wall (closed thick ring) — built along x, turned so local x → world z
  const wallG = new THREE.Group();
  wallG.rotation.y = -Math.PI / 2;
  root.add(wallG);
  const shell = createShell({ nT: 200, nX: 4, t0: 0, t1: TAU, len: DEPTH, cut: false });
  const matWall = new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  const matWallCut = new THREE.MeshPhysicalMaterial({ roughness: 0.45, clearcoat: 0.35, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  const wall = new THREE.Mesh(shell.geometry, [matWall, matWallCut]);
  wall.frustumCulled = false;
  wallG.add(wall);

  // ghost glass continuation of the airway into depth
  const ghostGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).rotateX(Math.PI / 2);
  const ghost = addGlassPair(root, ghostGeo, (side) => makeGlass({ side, rimPow: 2.2 }), 1, 5);
  const GHOST_LEN = 9;
  for (const m of [ghost.back, ghost.front]) m.position.z = -DEPTH / 2 - GHOST_LEN / 2 + 0.02;

  // alveoli
  const r = rng(5);
  const sph = new THREE.SphereGeometry(1, 56, 40);
  const alv = [];
  for (let i = 0; i < NA; i++) {
    const phi = i * TAU / NA + 0.31;
    const a = { phi, psi: phi + (r() - 0.5) * 0.1, size: 0.9 + 0.2 * r(), squash: 0.9 + 0.08 * r() };
    a.pair = addGlassPair(root, sph, (side) => makeGlass({ side, rimPow: 1.6, roughness: 0.45, env: 0.6 }), 1, 5);
    alv.push(a);
  }

  // elastin tethers
  const tethers = [];
  for (let i = 0; i < NA; i++) {
    const tg = createTether(40, 10);
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6, transparent: true, envMapIntensity: 0.9 });
    const mesh = new THREE.Mesh(tg.geometry, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    root.add(mesh);
    tethers.push({ tg, mat, mesh, brk: BREAK[i], waves: 2.5 + (i % 3) * 0.25, phase: r() * 0.6, beta: 0, A: new THREE.Vector2(), B: new THREE.Vector2(), mid: new THREE.Vector2() });
  }

  // air streaming into the airway (away from the viewer)
  const NP = 260;
  const st = new Streaks(NP, ctx.res, { trail: 0.3, width: 0.065, head: 2.4 });
  st.setRenderOrder(3);
  root.add(st.group);
  const pxi = new Float32Array(NP), prh = new Float32Array(NP), pth = new Float32Array(NP);
  for (let i = 0; i < NP; i++) { pxi[i] = r(); prh[i] = 0.82 * Math.sqrt(r()); pth[i] = r() * TAU; }
  const Z0 = DEPTH / 2 - 0.05, ZL = 9.5;

  const sV = new Spring(0.5), sK = new Spring(1);
  const target = { v: 0.5, k: 1 };
  let dark = true, tok = ctx.tok;
  let lastV = NaN, lastK = NaN, first = true;
  const cAir = new THREE.Color(), cAirFast = new THREE.Color(), cT = new THREE.Color();
  const cSlack = new THREE.Color(), cTaut = new THREE.Color(), cBroken = new THREE.Color();

  const fRad = (v, k) => 0.7 * (0.85 + 0.15 * k) + 0.6 * v * k;
  let F = 1, K = 1, V = 0.5;
  const irr = (phi) => (1 - K) * (0.14 * Math.cos(2 * phi + 0.5) + 0.07 * Math.cos(3 * phi + 2.1) + 0.035 * Math.cos(5 * phi + 0.7));
  const wIn = (phi) => R0 * F * (1 + irr(phi));
  const wOut = (phi) => wIn(phi) + WALL;
  // shell is parameterised in local θ; world angle φ = θ + π/2
  const sIn = (t) => wIn(t + Math.PI / 2);
  const sOut = (t) => wOut(t + Math.PI / 2);

  const CONTOUR = 1.78;
  function layout() {
    const aBase = 0.46 + 0.42 * V;
    const chord = 0.78 + 0.88 * V;
    for (let i = 0; i < NA; i++) {
      const a = alv[i];
      const rad = aBase * a.size * (1 + 0.1 * (1 - K));
      const D = wOut(a.psi) + chord + rad;
      const cx = D * Math.cos(a.psi), cy = D * Math.sin(a.psi);
      for (const m of [a.pair.back, a.pair.front]) {
        m.position.set(cx, cy, 0);
        m.scale.set(rad, rad * a.squash, rad * a.squash);
        m.rotation.z = a.psi;
      }
      a.c = { x: cx, y: cy, rad };
      // tether endpoints
      const t = tethers[i];
      const ra = wOut(a.phi) - 0.04;
      t.A.set(ra * Math.cos(a.phi), ra * Math.sin(a.phi));
      const dx = t.A.x - cx, dy = t.A.y - cy, dl = Math.hypot(dx, dy) || 1;
      t.B.set(cx + dx / dl * rad * 0.97, cy + dy / dl * rad * 0.97);
    }
  }

  function updateTethers() {
    for (let i = 0; i < NA; i++) {
      const t = tethers[i];
      t.beta = t.brk < 0 ? 0 : 1 - smooth(t.brk - 0.09, t.brk + 0.09, K);
      const ex = t.B.x - t.A.x, ey = t.B.y - t.A.y, d = Math.hypot(ex, ey) || 1;
      const ux = ex / d, uy = ey / d, nx = -uy, ny = ux;
      const taut = clamp(d / CONTOUR, 0, 1);
      const amp = Math.min(0.24 * Math.sqrt(Math.max(0, 1 - taut * taut)) + 0.12 * (1 - K), d * 0.22);
      const W = t.waves, ph = t.phase, beta = t.beta;
      const path = (s, out) => {
        const env = Math.pow(Math.max(0, Math.sin(Math.PI * s)), 0.7);
        // broken halves recoil: they curl more toward their free ends
        const curl = beta * 0.22 * (s < 0.5 ? smooth(0, 0.5, s) : smooth(1, 0.5, s));
        const off = (amp + curl) * Math.sin(TAU * W * s + ph) * env;
        out.x = t.A.x + ex * s + nx * off;
        out.y = t.A.y + ey * s + ny * off;
      };
      const half = 0.5 - 0.32 * beta;
      const rt = 0.062 * (0.45 + 0.55 * K);
      t.tg.update(path, [[0, half], [1 - half, 1]], (s, h) => {
        if (beta <= 0.001) return rt;
        const free = h === 0 ? smooth(half, half - 0.12, s) : smooth(1 - half, 1 - half + 0.12, s);
        return rt * (0.35 + 0.65 * free);
      });
      // broken fibres snap, recoil into short curled stubs and dim (they stay faintly visible)
      const op = 1 - 0.62 * beta;
      t.mat.opacity = op;
      t.mat.transparent = op < 0.999;
      t.mesh.visible = op > 0.01;
      cT.copy(cSlack).lerp(cTaut, smooth(0.55, 0.97, taut) * K);
      if (beta > 0) cT.lerp(cBroken, Math.min(1, beta * 1.6));
      t.mat.color.copy(cT);
      t.mat.emissive.copy(cT).multiplyScalar(dark ? 0.12 + 0.25 * taut * K : 0);
      path(0.5, t.mid);
      t.taut = taut;
    }
  }

  function setTheme(isDark, t) {
    dark = isDark; tok = t;
    matWall.color.copy(t.yellow).multiplyScalar(dark ? 0.78 : 0.9);
    matWall.emissive.copy(t.yellow).multiplyScalar(dark ? 0.06 : 0);
    matWallCut.color.copy(t.yellow).lerp(t.orange, 0.45).multiplyScalar(dark ? 0.8 : 0.9);
    matWallCut.emissive.copy(t.orange).multiplyScalar(dark ? 0.05 : 0);
    for (const m of ghost.mats) clearGlass(m, dark, 0.5);
    for (const a of alv) {
      for (const m of a.pair.mats) {
        const back = m.side === THREE.BackSide;
        if (dark) glassTheme(m, dark, { tint: t.tissue, rim: t.tissue, bodyA: back ? 0.22 : 0.42, rimA: 0.95, specK: 0.35, alphaK: 0.4 });
        else glassTheme(m, dark, { tint: t.tissue, rim: t.tissue.clone().multiplyScalar(0.85), bodyA: back ? 0.1 : 0.16, rimA: 0.85, specK: 0.25 });
      }
    }
    if (dark) { cSlack.copy(t.text2).multiplyScalar(0.85); cTaut.copy(t.text); }
    else { cSlack.copy(t.text2).multiplyScalar(0.9); cTaut.copy(t.text); }
    cBroken.copy(t.red);
    st.setTheme(dark);
    if (dark) { cAir.copy(t.blue).multiplyScalar(0.8); cAirFast.copy(t.blue).lerp(t.cyan, 0.5); }
    else { cAir.copy(t.blue).lerp(new THREE.Color(1, 1, 1), 0.3); cAirFast.copy(t.blue).multiplyScalar(0.85); }
    lastV = NaN; // force tether recolour
  }

  function update(dt) {
    V = sV.update(dt); K = sK.update(dt);
    F = fRad(V, K);
    if (V !== lastV || K !== lastK) {
      shell.update(sIn, sOut);
      layout();
      updateTethers();
      const gr = R0 * F + WALL * 0.5;
      for (const m of [ghost.back, ghost.front]) m.scale.set(gr, gr, GHOST_LEN);
      lastV = V; lastK = K;
    }
    // ghost tube fades into the distance
    const camD = ctx.camera.position.distanceTo(root.position);
    for (const m of ghost.mats) m.userData.u.uFade.value.set(camD - 0.5, camD + GHOST_LEN * 0.6);

    const flow = Math.pow(F, 4);
    const vC = 4.2 * visSpeed(flow);
    for (let i = 0; i < NP; i++) {
      const p = prh[i] / 0.82, prof = 1 - 0.85 * p * p;
      let x = pxi[i] + vC * prof * dt / ZL, wrapped = false;
      if (x >= 1) { x -= 1; wrapped = true; }
      pxi[i] = x;
      const rad = prh[i] * wIn(pth[i]) * 0.92;
      st.head(i, rad * Math.cos(pth[i]), rad * Math.sin(pth[i]), Z0 - x * ZL);
      if (wrapped || first) st.resetTrail(i);
      const fade = smooth(0, 0.05, x) * (1 - smooth(0.25, 0.7, x));
      cT.copy(cAir).lerp(cAirFast, prof);
      st.color(i, cT, (dark ? 0.75 : 0.6) * fade);
      st.width(i, 0.065 * (0.6 + 0.4 * F));
    }
    first = false;
    st.tick(dt);
  }

  const api = {
    setLungVolume(v, o = {}) { target.v = clamp(num(v, 0.5), 0, 1); sV.set(target.v, o.instant); },
    setRecoil(k, o = {}) { target.k = clamp(num(k, 1), 0, 1); sK.set(target.k, o.instant); },
    getState() {
      const rad = fRad(target.v, target.k);
      return { v: target.v, k: target.k, radius: rad, Raw: 1 / Math.pow(rad, 4) };
    },
  };

  const ALV_ANCHOR = 1, TETHER_ANCHOR = 9, BROKEN_ANCHOR = 0;
  function anchors() {
    const a = alv[ALV_ANCHOR].c || { x: 0, y: 0 };
    const tm = tethers[TETHER_ANCHOR].mid, bm = tethers[BROKEN_ANCHOR];
    return {
      airway: { p: new THREE.Vector3(0, wOut(Math.PI / 2), DEPTH / 2) },
      lumen: { p: new THREE.Vector3(0, 0, DEPTH / 2) },
      alveolus: { p: new THREE.Vector3(a.x, a.y, 0) },
      tether: { p: new THREE.Vector3(tm.x, tm.y, 0) },
      broken: { p: new THREE.Vector3((bm.A.x + bm.B.x) / 2, (bm.A.y + bm.B.y) / 2, 0), visible: bm.beta > 0.5 },
    };
  }

  return {
    root, update, setTheme, api, anchors,
    frame: { center: new THREE.Vector3(0, 0.1, 0), halfW: 5.0, halfH: 4.9, dir: new THREE.Vector3(0.12, 0.24, 1).normalize() },
    textures: [],
  };
}

/* ------------------------------------------------------------------ */
/* MODE: turbulence (bifurcating tube, laminar → turbulent)            */
/* ------------------------------------------------------------------ */

const BIF = {
  J: new THREE.Vector3(-0.2, 0, 0),
  ANG: 35 * Math.PI / 180,
  Rp: 0.95, Rd: 0.74,
  XIN: -7.2, LD: 5.3,
};
BIF.dirU = new THREE.Vector3(Math.cos(BIF.ANG), Math.sin(BIF.ANG), 0);
BIF.dirD = new THREE.Vector3(Math.cos(BIF.ANG), -Math.sin(BIF.ANG), 0);
BIF.endU = BIF.J.clone().addScaledVector(BIF.dirU, BIF.LD);
BIF.endD = BIF.J.clone().addScaledVector(BIF.dirD, BIF.LD);
let BIF_CACHE = null;

function computeBifurcation() {
  const { J, Rp, Rd, XIN, dirU, dirD, endU, endD } = BIF;
  const RES = 100;
  const lo = new THREE.Vector3(-7.7, -4.05, -1.22), hi = new THREE.Vector3(5.05, 4.05, 1.22);
  const c = lo.clone().add(hi).multiplyScalar(0.5), h = hi.clone().sub(lo).multiplyScalar(0.5);
  const dummy = new THREE.MeshBasicMaterial();
  const mc = new MarchingCubes(RES, dummy, false, false, 220000);
  mc.isolation = 0;
  const caps = [
    [XIN - 1.2, 0, 0, J.x, J.y, 0, Rp],
    [J.x, J.y, 0, endU.x + dirU.x * 1.2, endU.y + dirU.y * 1.2, 0, Rd],
    [J.x, J.y, 0, endD.x + dirD.x * 1.2, endD.y + dirD.y * 1.2, 0, Rd],
  ];
  const capD = (px, py, pz, s) => {
    const ax = s[0], ay = s[1], az = s[2], bx = s[3] - ax, by = s[4] - ay, bz = s[5] - az;
    const qx = px - ax, qy = py - ay, qz = pz - az;
    const t = clamp((qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
    return Math.hypot(qx - bx * t, qy - by * t, qz - bz * t) - s[6];
  };
  const smin = (a, b, k) => { const hh = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - hh * hh * k * 0.25; };
  const size = mc.size, half = size / 2, field = mc.field;
  for (let z = 0; z < size; z++) {
    const wz = c.z + (z - half) / half * h.z;
    for (let y = 0; y < size; y++) {
      const wy = c.y + (y - half) / half * h.y;
      for (let x = 0; x < size; x++) {
        const wx = c.x + (x - half) / half * h.x;
        const d = smin(smin(capD(wx, wy, wz, caps[0]), capD(wx, wy, wz, caps[1]), 0.45), capD(wx, wy, wz, caps[2]), 0.45);
        field[z * size * size + y * size + x] = -d;
      }
    }
  }
  mc.update();
  const count = mc.count;
  const P = mc.positionArray, Nn = mc.normalArray;
  const planes = [
    { p: new THREE.Vector3(XIN, 0, 0), a: new THREE.Vector3(-1, 0, 0) },
    { p: endU, a: dirU },
    { p: endD, a: dirD },
  ];
  const outP = [], outN = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let tri = 0; tri < count; tri += 3) {
    for (let k = 0; k < 3; k++) {
      const j = (tri + k) * 3;
      v[k].set(c.x + P[j] * h.x, c.y + P[j + 1] * h.y, c.z + P[j + 2] * h.z);
      n[k].set(Nn[j] / h.x, Nn[j + 1] / h.y, Nn[j + 2] / h.z).normalize();
    }
    let drop = false;
    for (const pl of planes) {
      let beyond = 0;
      const t = [0, 0, 0];
      for (let k = 0; k < 3; k++) { t[k] = v[k].clone().sub(pl.p).dot(pl.a); if (t[k] > 0) beyond++; }
      if (beyond === 3) { drop = true; break; }
      for (let k = 0; k < 3; k++) if (t[k] > 0) v[k].addScaledVector(pl.a, -t[k]);
    }
    if (drop) continue;
    for (let k = 0; k < 3; k++) { outP.push(v[k].x, v[k].y, v[k].z); outN.push(n[k].x, n[k].y, n[k].z); }
  }
  dummy.dispose();
  mc.geometry.dispose();
  return { pos: new Float32Array(outP), nor: new Float32Array(outN) };
}

function buildBranchLUT(sign) {
  const { J, ANG, XIN, LD } = BIF;
  const dir = new THREE.Vector2(Math.cos(ANG), sign * Math.sin(ANG));
  const pts = [];
  const xB0 = J.x - 1.35, xStart = XIN - 0.05;
  for (let x = xStart; x < xB0 - 0.01; x += 0.05) pts.push(new THREE.Vector2(x, 0));
  const iB0 = pts.length;
  const p0 = new THREE.Vector2(xB0, 0), p1 = new THREE.Vector2(J.x, 0), p2 = new THREE.Vector2(J.x + dir.x * 1.35, dir.y * 1.35);
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, mt = 1 - t;
    pts.push(new THREE.Vector2(mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y));
  }
  const iB1 = pts.length - 1;
  for (let s = 1.35 + 0.05; s < LD + 0.05; s += 0.05) pts.push(new THREE.Vector2(J.x + dir.x * s, dir.y * s));
  pts.push(new THREE.Vector2(J.x + dir.x * (LD + 0.05), dir.y * (LD + 0.05)));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  const sB0 = cum[iB0], sB1 = cum[iB1];
  const M = 420;
  const lut = { M, total, ds: total / M, x: new Float32Array(M + 1), y: new Float32Array(M + 1), tx: new Float32Array(M + 1), ty: new Float32Array(M + 1), w: new Float32Array(M + 1), sJ: (sB0 + sB1) / 2, sign };
  let j = 0;
  for (let i = 0; i <= M; i++) {
    const s = i * lut.ds;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const f = clamp((s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]), 0, 1);
    lut.x[i] = lerp(pts[j].x, pts[j + 1].x, f);
    lut.y[i] = lerp(pts[j].y, pts[j + 1].y, f);
    let tx = pts[j + 1].x - pts[j].x, ty = pts[j + 1].y - pts[j].y;
    const tl = Math.hypot(tx, ty) || 1;
    lut.tx[i] = tx / tl; lut.ty[i] = ty / tl;
    lut.w[i] = smooth(sB0 - 0.25, sB1 + 0.35, s);
  }
  return lut;
}

function buildTurbulence(ctx) {
  const root = new THREE.Group();
  ctx.scene.add(root);
  const { J, Rp, Rd, XIN, dirU, dirD, endU, endD } = BIF;

  if (!BIF_CACHE) BIF_CACHE = computeBifurcation();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(BIF_CACHE.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(BIF_CACHE.nor, 3));
  geo.computeBoundingSphere();
  const glass = addGlassPair(root, geo, (side) => makeGlass({ side, rimPow: 2.2 }), 1, 5);

  // glass lips at the three openings
  const lipMat = makeGlass({ side: THREE.FrontSide, rimPow: 1.4 });
  const lips = [];
  const mkLip = (R, pos, dir) => {
    const g = new THREE.TorusGeometry(R - 0.03, 0.045, 14, 128).rotateY(Math.PI / 2);
    const m = new THREE.Mesh(g, lipMat);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    m.renderOrder = 6;
    root.add(m); lips.push(m);
  };
  mkLip(Rp, new THREE.Vector3(XIN, 0, 0), new THREE.Vector3(1, 0, 0));
  mkLip(Rd, endU, dirU);
  mkLip(Rd, endD, dirD);

  const LUT = [buildBranchLUT(1), buildBranchLUT(-1)];

  const N = 760;
  const st = new Streaks(N, ctx.res, { trail: 0.36, width: 0.074, head: 2.2 });
  st.setRenderOrder(3);
  root.add(st.group);
  const r = rng(31);
  const S = new Float32Array(N), AD = new Float32Array(N), BD = new Float32Array(N), BR = new Uint8Array(N);
  const PH = new Float32Array(N), OM = new Float32Array(N), RE = new Float32Array(N), SU = new Float32Array(N);
  const PH2 = new Float32Array(N), OM2 = new Float32Array(N), PH3 = new Float32Array(N), PEND = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    BR[i] = r() < 0.5 ? 0 : 1;
    let a, b;
    do { a = r() * 2 - 1; b = r() * 2 - 1; } while (a * a + b * b > 1);
    AD[i] = a * 0.88; BD[i] = b * 0.88;
    S[i] = r() * LUT[BR[i]].total;
    PH[i] = r() * TAU; OM[i] = (r() < 0.5 ? -1 : 1) * (4.0 + 4.5 * r());
    RE[i] = 0.2 + 0.24 * r(); SU[i] = r();
    PH2[i] = r() * TAU; OM2[i] = 0.6 + 1.4 * r(); PH3[i] = r() * TAU;
  }

  const REG = { laminar: [0, 0, 1], transitional: [1, 0, 1.5], turbulent: [1, 1, 2.5] };
  let regime = 'laminar', gas = 'air';
  const sJE = new Spring(0, 4.5), sGE = new Spring(0, 4.5), sGas = new Spring(0, 4.5);
  let dark = true, tok = ctx.tok, time = 0, first = true;
  const cAir = new THREE.Color(), cHel = new THREE.Color(), cBase = new THREE.Color(), cHot = new THREE.Color(), cT = new THREE.Color();

  function setTheme(isDark, t) {
    dark = isDark; tok = t;
    for (const m of glass.mats) clearGlass(m, dark, 1);
    clearGlass(lipMat, dark, 1.6);
    st.setTheme(dark);
    if (dark) {
      cAir.copy(t.blue).multiplyScalar(0.9);
      cHel.copy(t.blue).lerp(t.cyan, 0.55);
      cHot.copy(t.cyan).lerp(new THREE.Color(1, 1, 1), 0.35);
    } else {
      cAir.copy(t.blue).multiplyScalar(0.92);
      cHel.copy(t.cyan);
      cHot.copy(t.blue).multiplyScalar(0.55);
    }
  }

  const Up = 2.5;
  function update(dt) {
    time += dt;
    const jE = sJE.update(dt), gE = sGE.update(dt), g = sGas.update(dt);
    const ampK = lerp(1, 0.42, g), frac = lerp(1, 0.45, g), omK = lerp(1, 0.62, g), wanderK = lerp(1, 0.3, g);
    cBase.copy(cAir).lerp(cHel, g);
    const gT = gE * ampK;
    for (let i = 0; i < N; i++) {
      const L = LUT[BR[i]];
      let s = S[i];
      const k = clamp(s / L.ds, 0, L.M - 1e-4), i0 = k | 0, f = k - i0;
      const x = L.x[i0] + (L.x[i0 + 1] - L.x[i0]) * f;
      const y = L.y[i0] + (L.y[i0 + 1] - L.y[i0]) * f;
      let tx = L.tx[i0] + (L.tx[i0 + 1] - L.tx[i0]) * f, ty = L.ty[i0] + (L.ty[i0 + 1] - L.ty[i0]) * f;
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const nx = -ty, ny = tx;
      const w = L.w[i0] + (L.w[i0 + 1] - L.w[i0]) * f;
      const R = lerp(Rp, Rd, w) * 0.97;
      const ap = BR[i] === 0 ? (AD[i] + 1) * 0.5 : (AD[i] - 1) * 0.5;
      let a = lerp(ap, AD[i], w), b = BD[i];
      const pm = Math.hypot(a, b);
      if (pm > 0.9) { a *= 0.9 / pm; b *= 0.9 / pm; }
      const rho2 = a * a + b * b;

      // eddy fields
      const ds = (s - L.sJ - 0.55) / 1.25;
      const Ej = Math.exp(-ds * ds);
      const wallF = smooth(0.25, 0.8, Math.abs(AD[i]));
      const Eg = smooth(0.4, 1.6, s) * (1 - smooth(L.total - 0.8, L.total, s) * 0.3);
      const part = 1 - smooth(frac - 0.08, frac + 0.08, SU[i]);
      const E = (jE * Ej * wallF * ampK * 1.1 + gT * Eg) * part;

      PH[i] += OM[i] * omK * dt;
      const amp = RE[i] * R * E * (0.75 + 0.25 * Math.sin(time * OM2[i] + PH3[i]));
      const cph = Math.cos(PH[i]), sph = Math.sin(PH[i]);
      const dT = amp * cph, dN = amp * sph, dZ = amp * 0.6 * Math.sin(PH[i] * 0.63 + PH2[i]);
      const wa = gT * wanderK * 0.28 * Math.sin(time * OM2[i] + PH2[i]) * part;
      const wb = gT * wanderK * 0.28 * Math.cos(time * OM2[i] * 0.8 + PH3[i]) * part;
      let la = a + wa + dN / R, lb = b + wb + dZ / R;
      const lm = Math.hypot(la, lb);
      if (lm > 0.9) { la *= 0.9 / lm; lb *= 0.9 / lm; }

      // forward speed: parabolic (laminar) → blunt (turbulent)
      const U = Up * lerp(1, 0.82, w);
      const lam = 1 - rho2, blunt = 0.88 * (1 - Math.pow(rho2, 4));
      let u = U * lerp(lam, blunt, gT);
      u *= 1 - 0.75 * jE * Ej * wallF * ampK * part;
      u *= 1 + 0.3 * gT * Eg * Math.sin(PH[i] * 0.5 + PH3[i]) * part;
      u = Math.max(u, 0.14 * U);
      const px = x + tx * dT + nx * la * R, py = y + ty * dT + ny * la * R, pz = lb * R;
      st.head(i, px, py, pz);
      if (PEND[i] || first) { st.resetTrail(i); PEND[i] = 0; }

      s += u * dt;
      if (s >= L.total) { s -= L.total; PEND[i] = 1; }
      S[i] = s;
      const fade = smooth(0, 0.7, s) * (1 - smooth(L.total - 0.5, L.total, s));
      const hot = Math.min(1, E * 1.3) * 0.55;
      cT.copy(cBase).lerp(cHot, hot);
      st.color(i, cT, (dark ? 0.72 : 0.66) * fade);
    }
    first = false;
    st.tick(dt);
  }

  function relRes() {
    const base = REG[regime][2];
    return gas === 'heliox' ? 1 + (base - 1) * 0.5 : base;
  }

  const api = {
    setRegime(name, o = {}) {
      if (!REG[name]) return;
      regime = name;
      sJE.set(REG[name][0], o.instant); sGE.set(REG[name][1], o.instant);
    },
    setGas(name, o = {}) {
      if (name !== 'air' && name !== 'heliox') return;
      gas = name;
      sGas.set(name === 'heliox' ? 1 : 0, o.instant);
    },
    getState() { return { regime, gas, relativeResistance: relRes() }; },
  };

  function anchors() {
    const L = LUT[0];
    const sE = L.sJ + 0.9, ke = Math.min(L.M, Math.round(sE / L.ds));
    const ex = L.x[ke] - L.ty[ke] * Rd * 0.85, ey = L.y[ke] + L.tx[ke] * Rd * 0.85;
    return {
      branch: { p: new THREE.Vector3(J.x + 1.12, 0, 0) },
      inlet: { p: new THREE.Vector3(XIN, 0, 0) },
      outlet: { p: endU.clone() },
      outlet2: { p: endD.clone() },
      tube: { p: new THREE.Vector3(-4.2, Rp, 0) },
      lumen: { p: new THREE.Vector3(-4.2, 0, 0) },
      eddy: { p: new THREE.Vector3(ex, ey, 0), visible: sJE.v > 0.3 || sGE.v > 0.3 },
    };
  }

  return {
    root, update, setTheme, api, anchors,
    frame: { center: new THREE.Vector3(-1.25, 0, 0), halfW: 6.75, halfH: 4.05, dir: new THREE.Vector3(0.1, 0.26, 1).normalize() },
    textures: [],
  };
}

const BUILDERS = {
  poiseuille: buildPoiseuille,
  bronchomotor: buildBronchomotor,
  traction: buildTraction,
  turbulence: buildTurbulence,
};

/* ------------------------------------------------------------------ */
/* mount                                                               */
/* ------------------------------------------------------------------ */

export function mount(container, options = {}) {
  const modeName = BUILDERS[options.mode] ? options.mode : 'poiseuille';
  let theme = options.theme === 'light' ? 'light' : 'dark';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', outline: 'none' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment(renderer);
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(4, 8, 7);
  const rim = new THREE.DirectionalLight(0xbfdcff, 0.9);
  rim.position.set(-6, 3, -6);
  const fill = new THREE.HemisphereLight(0xffffff, 0x404858, 0.35);
  scene.add(key, rim, fill);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const ctx = { scene, camera, renderer, res: new THREE.Vector2(1, 1), tok: makeTokens(theme) };
  const mode = BUILDERS[modeName](ctx);
  mode.setTheme(theme === 'dark', ctx.tok);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  if (options.interactive === false) controls.enabled = false;

  const size = { w: 0, h: 0 };
  let fitted = false;
  const tmpV = new THREE.Vector3();

  function fit() {
    if (!size.w || !size.h) return;
    camera.aspect = size.w / size.h;
    const f = mode.frame;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(f.halfH / tanV, f.halfW / (tanV * camera.aspect));
    const dir = fitted ? tmpV.copy(camera.position).sub(controls.target).normalize() : tmpV.copy(f.dir);
    camera.position.copy(f.center).addScaledVector(dir, dist);
    controls.target.copy(f.center);
    camera.near = Math.max(0.05, dist * 0.05);
    camera.far = dist * 6;
    camera.updateProjectionMatrix();
    if (!fitted) {
      const off = camera.position.clone().sub(f.center);
      const az = Math.atan2(off.x, off.z);
      const pol = Math.acos(clamp(off.y / off.length(), -1, 1));
      controls.minAzimuthAngle = az - 0.55;
      controls.maxAzimuthAngle = az + 0.55;
      controls.minPolarAngle = Math.max(0.15, pol - 0.4);
      controls.maxPolarAngle = Math.min(Math.PI - 0.15, pol + 0.35);
      fitted = true;
    }
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    if (w === size.w && h === size.h) return;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    renderer.getDrawingBufferSize(ctx.res);
    fit();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const clock = new THREE.Clock(false);
  let raf = 0, running = false, disposed = false;

  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!size.w) resize();
    controls.update();
    mode.update(dt);
    renderer.render(scene, camera);
  }

  function start() {
    if (running || disposed) return;
    running = true;
    resize();
    clock.start();
    clock.getDelta();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    clock.stop();
  }
  function setTheme(t) {
    theme = t === 'light' ? 'light' : 'dark';
    ctx.tok = makeTokens(theme);
    mode.setTheme(theme === 'dark', ctx.tok);
  }
  function getAnchors() {
    const out = {};
    if (disposed) return out;
    camera.updateMatrixWorld();
    const pts = mode.anchors();
    for (const name of Object.keys(pts)) {
      const a = pts[name];
      tmpV.copy(a.p).applyMatrix4(camera.matrixWorldInverse);
      const inFront = tmpV.z < 0;
      tmpV.copy(a.p).project(camera);
      const x = (tmpV.x + 1) / 2 * size.w, y = (1 - tmpV.y) / 2 * size.h;
      out[name] = { x, y, visible: a.visible !== false && inFront && x >= 0 && y >= 0 && x <= size.w && y <= size.h };
    }
    return out;
  }
  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    ro.disconnect();
    controls.dispose();
    const mats = new Set(), geos = new Set();
    scene.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => {
      for (const k of ['map', 'bumpMap', 'normalMap']) if (m[k]) m[k].dispose();
      m.dispose();
    });
    (mode.textures || []).forEach((t) => t.dispose());
    envRT.dispose();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }

  /** Test hook: advance the simulation deterministically by `seconds` (60 Hz steps) and render once. */
  function _step(seconds = 1, dt = 1 / 60) {
    if (disposed) return;
    resize();
    for (let t = 0; t < seconds; t += dt) mode.update(dt);
    controls.update();
    renderer.render(scene, camera);
  }

  return {
    mode: modeName,
    start, stop, dispose, setTheme, getAnchors, _step,
    isRunning: () => running,
    ...mode.api,
  };
}

export default { mount };
