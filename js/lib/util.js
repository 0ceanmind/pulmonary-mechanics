// Small math + DOM helpers shared by slide modules
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// frame-rate independent exponential approach
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const fmt = (v, d = 1) => {
  const s = Math.abs(v) < Math.pow(10, -d) / 2 ? (0).toFixed(d) : v.toFixed(d);
  return s.replace('-', '−');
};
export const signed = (v, d = 1) => (v > 0.0001 ? '+' : '') + fmt(v, d);

// Monotone cubic (Fritsch–Carlson) interpolation through [[x,y],...] sorted by x
export function monotone(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// sample f over [a,b] → [[x,f(x)],...]
export const sample = (f, a, b, n = 120) => Array.from({ length: n + 1 }, (_, i) => { const x = a + ((b - a) * i) / n; return [x, f(x)]; });

export const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export function html(tag, attrs = {}, parent, inner) {
  const e = document.createElement(tag);
  for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
  if (inner != null) e.innerHTML = inner;
  if (parent) parent.appendChild(e);
  return e;
}

// keep a range input's filled track in sync
export function rangeFill(input) {
  const upd = () => { const p = ((input.value - input.min) / (input.max - input.min)) * 100; input.style.setProperty('--fill', p + '%'); };
  input.addEventListener('input', upd);
  upd();
  return upd;
}

// segmented control helper: calls cb(button) and toggles .on
export function seg(root, cb) {
  const btns = [...root.querySelectorAll('button')];
  btns.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); btns.forEach((x) => x.classList.toggle('on', x === b)); cb(b); }));
  return { set(pred) { const b = btns.find(pred); if (b) { btns.forEach((x) => x.classList.toggle('on', x === b)); cb(b); } }, btns };
}

// animate a value with rAF and an easing; returns a cancel fn
export function tween(from, to, dur, onUpdate, ease = easeInOut, onDone) {
  const t0 = performance.now();
  let raf = 0, dead = false;
  const step = (now) => {
    if (dead) return;
    const t = clamp((now - t0) / (dur * 1000), 0, 1);
    onUpdate(lerp(from, to, ease(t)), t);
    if (t < 1) raf = requestAnimationFrame(step); else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();

// flip cards: wrap face text so inline <b> runs flow normally, and toggle on click
export function flips(root) {
  root.querySelectorAll('.ff, .fb').forEach((face) => {
    if (face.querySelector(':scope > .ft')) return;
    const p = document.createElement('p');
    p.className = 'ft';
    [...face.childNodes].forEach((n) => { if (!(n.nodeType === 1 && n.classList.contains('fq'))) p.appendChild(n); });
    face.appendChild(p);
  });
  root.querySelectorAll('.flip').forEach((f) => f.addEventListener('click', () => f.classList.toggle('open')));
}
