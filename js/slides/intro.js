import { svg, clamp } from '../lib/util.js';
import { hero } from '../lib/shared3d.js';

const QUIZ_URL = 'https://0ceanmind.github.io/pulmonary-mechanics/quiz/';

/* --- tiny particle helpers for the "bottom line" cards --- */
function bl1(root) {
  // high-pressure chamber → tube → low-pressure chamber
  svg('rect', { x: 14, y: 40, width: 120, height: 120, rx: 26, fill: 'none', stroke: 'var(--c)', 'stroke-width': 5 }, root);
  svg('rect', { x: 266, y: 58, width: 120, height: 84, rx: 22, fill: 'none', stroke: 'var(--c)', 'stroke-width': 5, opacity: 0.55 }, root);
  svg('path', { d: 'M134 88 H266 M134 112 H266', stroke: 'var(--c)', 'stroke-width': 5, opacity: 0.55, fill: 'none' }, root);
  const t1 = svg('text', { x: 74, y: 190, 'text-anchor': 'middle', style: 'font: 700 22px var(--font); fill: var(--text-2)' }, root); t1.textContent = 'High P';
  const t2 = svg('text', { x: 326, y: 190, 'text-anchor': 'middle', style: 'font: 700 22px var(--font); fill: var(--text-2)' }, root); t2.textContent = 'Low P';
  const dense = [], sparse = [], flow = [];
  for (let i = 0; i < 26; i++) dense.push({ el: svg('circle', { r: 5, fill: 'var(--c)' }, root), x: 30 + Math.random() * 90, y: 55 + Math.random() * 90, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60 });
  for (let i = 0; i < 9; i++) sparse.push({ el: svg('circle', { r: 5, fill: 'var(--c)', opacity: 0.7 }, root), x: 280 + Math.random() * 90, y: 70 + Math.random() * 60, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60 });
  for (let i = 0; i < 7; i++) flow.push({ el: svg('circle', { r: 6, fill: 'var(--c)' }, root), x: 134 + i * 20 });
  const box = (p, x0, x1, y0, y1, dt) => {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < x0 || p.x > x1) p.vx *= -1;
    if (p.y < y0 || p.y > y1) p.vy *= -1;
    p.x = clamp(p.x, x0, x1); p.y = clamp(p.y, y0, y1);
    p.el.setAttribute('cx', p.x); p.el.setAttribute('cy', p.y);
  };
  return (dt) => {
    dense.forEach((p) => box(p, 28, 120, 54, 146, dt));
    sparse.forEach((p) => box(p, 280, 372, 72, 128, dt));
    flow.forEach((p) => { p.x += 70 * dt; if (p.x > 266) p.x = 134; p.el.setAttribute('cx', p.x); p.el.setAttribute('cy', 100); p.el.setAttribute('opacity', Math.sin(((p.x - 134) / 132) * Math.PI)); });
  };
}
function bl2(root) {
  const chest = svg('path', { fill: 'none', stroke: 'var(--c)', 'stroke-width': 5, 'stroke-linecap': 'round' }, root);
  const lungL = svg('ellipse', { fill: 'var(--c)', opacity: 0.22 }, root);
  const lungR = svg('ellipse', { fill: 'var(--c)', opacity: 0.22 }, root);
  const dia = svg('path', { fill: 'none', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linecap': 'round' }, root);
  svg('path', { d: 'M200 18 V58', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linecap': 'round' }, root);
  const lbl = svg('text', { x: 200, y: 196, 'text-anchor': 'middle', style: 'font: 700 22px var(--font); fill: var(--text-2)' }, root);
  let t = 0;
  return (dt) => {
    t += dt;
    const s = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4); // 0..1
    const w = 120 + 16 * s, h = 116 + 22 * s;
    chest.setAttribute('d', `M${200 - w} ${150 + 10 * s} C${200 - w} ${40} ${200 - 40} ${30} 200 30 C${200 + 40} 30 ${200 + w} 40 ${200 + w} ${150 + 10 * s}`);
    lungL.setAttribute('cx', 200 - 52 - 6 * s); lungL.setAttribute('cy', 104 + 6 * s); lungL.setAttribute('rx', 40 + 8 * s); lungL.setAttribute('ry', 52 + 12 * s);
    lungR.setAttribute('cx', 200 + 52 + 6 * s); lungR.setAttribute('cy', 104 + 6 * s); lungR.setAttribute('rx', 40 + 8 * s); lungR.setAttribute('ry', 52 + 12 * s);
    dia.setAttribute('d', `M${200 - w + 6} ${150 + 10 * s} Q200 ${118 + 44 * s} ${200 + w - 6} ${150 + 10 * s}`);
    const insp = Math.sin((2 * Math.PI * t) / 4) > 0;
    lbl.textContent = insp ? 'Volume ↑  →  alveolar P ↓' : 'Volume ↓  →  alveolar P ↑';
    void h;
  };
}
function bl3(root) {
  svg('path', { d: 'M20 60 H150 C185 60 185 82 215 82 H250 C285 82 285 60 320 60 H380 M20 140 H150 C185 140 185 118 215 118 H250 C285 118 285 140 320 140 H380', fill: 'none', stroke: 'var(--c)', 'stroke-width': 5, 'stroke-linecap': 'round' }, root);
  const r = svg('text', { x: 232, y: 106, 'text-anchor': 'middle', style: 'font: 800 26px var(--font); fill: var(--c)' }, root); r.textContent = 'R';
  const dp = svg('text', { x: 20, y: 190, style: 'font: 700 22px var(--font); fill: var(--text-2)' }, root); dp.textContent = 'ΔP drives';
  const rr = svg('text', { x: 380, y: 190, 'text-anchor': 'end', style: 'font: 700 22px var(--font); fill: var(--text-2)' }, root); rr.textContent = 'R opposes';
  const ps = [];
  for (let i = 0; i < 16; i++) ps.push({ el: svg('circle', { r: 5.5, fill: 'var(--c)' }, root), x: Math.random() * 360 + 20, lane: Math.random() * 2 - 1 });
  const half = (x) => (x > 150 && x < 320 ? (x > 185 && x < 285 ? 18 : 32 - 14 * Math.min(1, Math.abs(x < 235 ? x - 150 : 320 - x) / 35)) : 32);
  return (dt) => {
    ps.forEach((p) => {
      const h = half(p.x);
      const v = 90 * (32 / h); // faster through the narrow part (continuity), but less total flow
      p.x += v * dt;
      if (p.x > 380) { p.x = 20; p.lane = Math.random() * 2 - 1; }
      p.el.setAttribute('cx', p.x);
      p.el.setAttribute('cy', 100 + p.lane * (h - 9));
    });
  };
}

export default {
  title: {
    async init(el, ctx) {
      const c = await hero(ctx, el.querySelector('#hero-mount'));
      ctx.heroCtrl = c;
    },
    enter(el, ctx) {
      const c = ctx.heroCtrl;
      if (!c) return;
      c.setDisease?.('normal');
      c.setAutoBreath?.(true, 4);
      c.setAirflow?.(true);
      c.highlight?.(null);
    },
  },

  'bottom-line': {
    init(el, ctx) {
      const f1 = bl1(el.querySelector('#bl1')), f2 = bl2(el.querySelector('#bl2')), f3 = bl3(el.querySelector('#bl3'));
      ctx.loop((dt) => { f1(dt); f2(dt); f3(dt); });
    },
  },

  takeaways: {},

  quiz: {
    async init(el) {
      const box = el.querySelector('#qr');
      try {
        const q = window.qrcode(0, 'M');
        q.addData(QUIZ_URL);
        q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
      } catch (e) { box.textContent = QUIZ_URL; }
      try {
        const m = await import('../../quiz/questions.js');
        const n = m.QUESTIONS?.length || 0, t = Object.keys(m.TOPICS || {}).length;
        el.querySelector('#qz-count').innerHTML = `<i style="--c:var(--green)"></i>${n} questions · ${t} topics`;
      } catch (e) {
        el.querySelector('#qz-count').innerHTML = '<i style="--c:var(--green)"></i>Question bank';
      }
    },
  },

  thanks: {
    async init(el, ctx) {
      ctx.endCtrl = await hero(ctx, el.querySelector('#end-mount'));
    },
    enter(el, ctx) {
      const c = ctx.endCtrl;
      c?.setDisease?.('normal');
      c?.setAutoBreath?.(true, 4);
      c?.setAirflow?.(true);
      c?.highlight?.(null);
    },
  },
};
