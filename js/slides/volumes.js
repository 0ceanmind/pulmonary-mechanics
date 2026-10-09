import { svg, clamp, lerp, damp, rangeFill, seg, monotone, html } from '../lib/util.js';
import { chart, drawIn, fadeIn } from '../lib/chart.js';
import { PL } from './compliance.js';

const d3 = window.d3;

// Guyton & Hall 15e — young adult man (mL)
export const GV = { VT: 500, IRV: 3000, ERV: 1100, RV: 1200 };
GV.FRC = GV.ERV + GV.RV; GV.IC = GV.IRV + GV.VT; GV.VC = GV.IRV + GV.VT + GV.ERV; GV.TLC = GV.VC + GV.RV;

// classic spirogram: extremes joined by cosine segments
const KEYS = [[0, 2300], [2, 2800], [4, 2300], [6, 2800], [8, 2300], [10.6, 5800], [13.4, 2300], [15.4, 2800], [17.4, 2300], [20, 1200], [22.8, 2300], [24.8, 2800], [26.8, 2300], [28.8, 2800], [30, 2550]];
export function spiro(t) {
  if (t <= KEYS[0][0]) return KEYS[0][1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [t0, v0] = KEYS[i], [t1, v1] = KEYS[i + 1];
    if (t <= t1) { const p = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * p)); }
  }
  return KEYS[KEYS.length - 1][1];
}
const spiroPts = () => d3.range(0, 30.0001, 0.05).map((t) => [t, spiro(t)]);

const ITEMS = [
  { k: 'VT', name: 'Tidal volume', c: 'var(--orange)', lo: 2300, hi: 2800, type: 'v', f: 'Exhaled in a single quiet breath' },
  { k: 'IRV', name: 'Inspiratory reserve', c: 'var(--blue)', lo: 2800, hi: 5800, type: 'v', f: 'IRV = TLC − (FRC + V<tspan baseline-shift="sub" font-size="70%">T</tspan>)' },
  { k: 'ERV', name: 'Expiratory reserve', c: 'var(--green)', lo: 1200, hi: 2300, type: 'v', f: 'ERV = FRC − RV' },
  { k: 'RV', name: 'Residual volume', c: 'var(--purple)', lo: 0, hi: 1200, type: 'v', f: 'Left after maximal exhalation' },
  { k: 'IC', name: 'Inspiratory capacity', c: 'var(--cyan)', lo: 2300, hi: 5800, type: 'c', f: 'IC = IRV + V<tspan baseline-shift="sub" font-size="70%">T</tspan>' },
  { k: 'FRC', name: 'Functional residual', c: 'var(--yellow)', lo: 0, hi: 2300, type: 'c', f: 'FRC = ERV + RV' },
  { k: 'VC', name: 'Vital capacity', c: 'var(--pink)', lo: 1200, hi: 5800, type: 'c', f: 'VC = TLC − RV' },
  { k: 'TLC', name: 'Total lung capacity', c: 'var(--text)', lo: 0, hi: 5800, type: 'c', f: 'TLC = VC + RV' },
];
const xOf = { VT: 3, IRV: 6.7, ERV: 18.2, RV: 3, IC: 11.9, FRC: 25.4, VC: 20.6, TLC: 29.2 };

function volumesChart(container, legend) {
  const c = chart(container, { x: [0, 30], y: [0, 6200], yTickValues: [0, 1000, 2000, 3000, 4000, 5000, 6000], xTicks: 6, xLabel: 'Time (s)', yLabel: 'Lung volume (mL)', yFormat: d3.format(','), m: { l: 130, r: 30, t: 20, b: 92 } });
  const bands = {};
  ['RV', 'ERV', 'VT', 'IRV'].forEach((k) => {
    const it = ITEMS.find((i) => i.k === k);
    bands[k] = c.plot.append('rect').attr('x', 0).attr('width', c.iw).attr('y', c.y(it.hi)).attr('height', c.y(it.lo) - c.y(it.hi)).style('fill', it.c).style('opacity', 0.08);
  });
  const tr = c.path(spiroPts(), { color: 'var(--blue)', glow: true, curve: d3.curveLinear });
  // bracket + label layer
  const br = c.over.append('g').style('opacity', 0);
  const brLine = br.append('line').style('stroke-width', 6).style('stroke-linecap', 'round');
  const brCap1 = br.append('path').style('fill', 'none').style('stroke-width', 6).style('stroke-linecap', 'round');
  const brCap2 = br.append('path').style('fill', 'none').style('stroke-width', 6).style('stroke-linecap', 'round');
  const tagBg = br.append('rect').attr('rx', 16).style('fill', 'var(--glass)').style('stroke-width', 2);
  const tag = br.append('text').attr('class', 'lbl').style('font-size', '30px');
  const tag2 = br.append('text').style('font-size', '24px').style('font-weight', 600).style('fill', 'var(--text-2)');
  const rows = {};
  const add = (h) => html('div', { class: 'vl-h' }, legend, h);
  add('Volumes');
  ITEMS.forEach((it, i) => {
    if (i === 4) add('Capacities');
    const r = html('button', { class: 'vl', style: `--c:${it.c}` }, legend, `<i></i><b>${it.k}</b><span>${it.name}</span><em>${d3.format(',')(GV[it.k])}</em>`);
    rows[it.k] = r;
    r.addEventListener('mouseenter', () => show(it.k));
    r.addEventListener('mouseleave', () => show(null));
    r.addEventListener('click', () => show(it.k, true));
  });
  html('div', { class: 'vol-src' }, legend, 'mL · young adult man · Guyton &amp; Hall 15e');
  let pinned = null;
  function show(k, pin) {
    if (pin) pinned = pinned === k ? null : k;
    const key = k || pinned;
    Object.entries(rows).forEach(([kk, r]) => r.classList.toggle('hot', kk === key));
    Object.entries(bands).forEach(([kk, b]) => b.transition().duration(300).style('opacity', !key ? 0.08 : kk === key ? 0.32 : 0.04));
    if (!key) { br.transition().duration(250).style('opacity', 0); return; }
    const it = ITEMS.find((i) => i.k === key);
    const x = c.x(xOf[key]), y1 = c.y(it.hi), y0 = c.y(it.lo);
    [brLine, brCap1, brCap2].forEach((e) => e.style('stroke', it.c));
    brLine.attr('x1', x).attr('x2', x).attr('y1', y1 + 4).attr('y2', y0 - 4);
    brCap1.attr('d', `M${x - 16} ${y1 + 20} L${x} ${y1 + 3} L${x + 16} ${y1 + 20}`);
    brCap2.attr('d', `M${x - 16} ${y0 - 20} L${x} ${y0 - 3} L${x + 16} ${y0 - 20}`);
    const ty = (y0 + y1) / 2;
    const right = x < c.iw * 0.62;
    tag.attr('text-anchor', right ? 'start' : 'end').attr('x', x + (right ? 30 : -30)).attr('y', ty - 6).style('fill', it.c).text(`${it.k} = ${d3.format(',')(GV[it.k])} mL`);
    tag2.attr('text-anchor', right ? 'start' : 'end').attr('x', x + (right ? 30 : -30)).attr('y', ty + 30).html(it.f);
    const b1 = tag.node().getBBox(), b2 = tag2.node().getBBox();
    const bx = Math.min(b1.x, b2.x) - 18, bw = Math.max(b1.width, b2.width) + 36;
    tagBg.attr('x', bx).attr('y', b1.y - 12).attr('width', bw).attr('height', b2.y + b2.height - b1.y + 24).style('stroke', it.c);
    br.transition().duration(250).style('opacity', 1);
  }
  return { draw: () => { drawIn(tr, 2600, 200, d3.easeLinear); show(null); pinned = null; } };
}

/* ---------- spirometry blind spot ---------- */
function blindChart(container) {
  const c = chart(container, { x: [0, 30], y: [0, 6200], yTickValues: [0, 1200, 2300, 5800], xTicks: 6, xLabel: 'Time (s)', yLabel: 'Lung volume (mL)', yFormat: d3.format(','), m: { l: 130, r: 260, t: 20, b: 92 } });
  const fog = c.plot.append('rect').attr('x', 0).attr('width', c.iw).attr('y', c.y(1200)).attr('height', c.y(0) - c.y(1200)).style('fill', 'var(--orange)').style('opacity', 0);
  const pat = c.defs.append('pattern').attr('id', 'hatch').attr('width', 18).attr('height', 18).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
  pat.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 18).style('stroke', 'var(--orange)').style('stroke-width', 5).style('opacity', 0.35);
  const hatch = c.plot.append('rect').attr('x', 0).attr('width', c.iw).attr('y', c.y(1200)).attr('height', c.y(0) - c.y(1200)).style('fill', 'url(#hatch)').style('opacity', 0);
  const fogT = c.over.append('text').attr('x', c.iw / 2).attr('y', c.y(600) + 10).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', 'var(--orange)').style('font-size', '32px').text('Never leaves the lung — the spirometer can’t see it').style('opacity', 0);
  const tr = c.path(spiroPts(), { color: 'var(--blue)', glow: true, curve: d3.curveLinear });
  const brs = [
    { k: 'RV', lo: 0, hi: 1200, c: 'var(--orange)', x: c.iw + 40 },
    { k: 'FRC', lo: 0, hi: 2300, c: 'var(--green)', x: c.iw + 120 },
    { k: 'TLC', lo: 0, hi: 5800, c: 'var(--purple)', x: c.iw + 200 },
  ].map((b) => {
    const g = c.g.append('g').style('opacity', 0);
    g.append('line').attr('x1', b.x).attr('x2', b.x).attr('y1', c.y(b.hi)).attr('y2', c.y(b.lo)).style('stroke', b.c).style('stroke-width', 8).style('stroke-linecap', 'round');
    g.append('line').attr('x1', b.x - 14).attr('x2', b.x + 14).attr('y1', c.y(b.hi)).attr('y2', c.y(b.hi)).style('stroke', b.c).style('stroke-width', 6).style('stroke-linecap', 'round');
    g.append('text').attr('x', b.x).attr('y', c.y(b.hi) - 18).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', b.c).text(b.k);
    return g;
  });
  return {
    draw() {
      [fog, hatch, fogT, ...brs].forEach((e) => e.interrupt().style('opacity', 0));
      drawIn(tr, 2200, 100, d3.easeLinear);
      fog.transition().delay(2300).duration(800).style('opacity', 0.14);
      hatch.transition().delay(2300).duration(800).style('opacity', 1);
      fogT.transition().delay(2600).duration(800).style('opacity', 1);
      brs.forEach((b, i) => b.transition().delay(3200 + i * 350).duration(600).style('opacity', 1));
    },
  };
}

/* ---------- static vs dynamic pictograms ---------- */
function staticViz(box) {
  const s = svg('svg', { viewBox: '0 0 600 300' }, box);
  svg('path', { d: 'M60 260 H560 M60 260 V30', stroke: 'var(--stroke-2)', 'stroke-width': 4, fill: 'none' }, s);
  const pts = d3.range(0, 8).map((i) => { const P = i * 4.6; return [60 + P * 13, 260 - (VLp(P) - 1) * 46]; });
  const dots = pts.map(([x, y]) => svg('circle', { cx: x, cy: y, r: 13, fill: 'var(--c)', opacity: 0 }, s));
  const ln = svg('path', { d: d3.line().curve(d3.curveCatmullRom)(pts), fill: 'none', stroke: 'var(--c)', 'stroke-width': 5, opacity: 0.4, 'stroke-dasharray': '8 10' }, s);
  const t = svg('text', { x: 560, y: 290, 'text-anchor': 'end', style: 'font:650 22px var(--font);fill:var(--text-3)' }, s); t.textContent = 'pressure → (one held breath at a time)';
  let time = 0;
  return (dt) => { time += dt; const n = Math.floor((time % 6) / 0.6); dots.forEach((d, i) => d.setAttribute('opacity', i <= n ? 1 : 0.12)); void ln; };
}
const VLp = (P) => 1 + 5 * (1 - Math.exp(-P / 9.2));
function dynamicViz(box) {
  const s = svg('svg', { viewBox: '0 0 600 300' }, box);
  svg('path', { d: 'M60 260 H560 M60 260 V30', stroke: 'var(--stroke-2)', 'stroke-width': 4, fill: 'none' }, s);
  const f = (v) => (v < 0.12 ? v / 0.12 : 1 - ((v - 0.12) / 0.88) ** 0.9);
  const pts = d3.range(0, 1.0001, 0.01).map((v) => [60 + v * 480, 250 - f(v) * 210]);
  const path = svg('path', { d: d3.line()(pts), fill: 'none', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
  const L = path.getTotalLength();
  path.setAttribute('stroke-dasharray', `${L} ${L}`);
  const dot = svg('circle', { r: 13, fill: 'var(--c)' }, s);
  const t = svg('text', { x: 560, y: 290, 'text-anchor': 'end', style: 'font:650 22px var(--font);fill:var(--text-3)' }, s); t.textContent = 'volume → (one forced breath)';
  let time = 0;
  return (dt) => { time += dt; const p = clamp((time % 3.2) / 2.2, 0, 1); path.setAttribute('stroke-dashoffset', L * (1 - p)); const pt = path.getPointAtLength(L * p); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); };
}

/* ---------- live trace for the 3D spirometer ---------- */
function liveTrace(container) {
  const c = chart(container, { x: [0, 26], y: [0, 6200], yTickValues: [1200, 2300, 5800], xTicks: 0, xTickValues: [], yFormat: d3.format(','), m: { l: 130, r: 30, t: 10, b: 20 }, grid: true });
  const p = c.path([], { color: 'var(--blue)', glow: true, curve: d3.curveLinear });
  const head = c.dot(0, 0, { color: 'var(--blue)', r: 10 });
  let pts = [], t0 = 0;
  return {
    reset() { pts = []; t0 = 0; c.x.domain([0, 26]); p.attr('d', null); },
    push(t, v) {
      if (pts.length && t < pts[pts.length - 1][0] - 0.5) { pts = []; }
      pts.push([t, v]);
      if (t > c.x.domain()[1]) { c.x.domain([t - 26, t]); }
      if (pts.length > 4000) pts.shift();
      p.attr('d', c.line(d3.curveLinear)(pts.filter((q) => q[0] >= c.x.domain()[0])));
      head.attr('transform', `translate(${c.x(t)},${c.y(v)})`);
      void t0;
    },
  };
}

export default {
  'static-dynamic': {
    init(el, ctx) {
      const a = staticViz(el.querySelector('#sd-static')), b = dynamicViz(el.querySelector('#sd-dynamic'));
      ctx.loop((dt) => { a(dt); b(dt); });
    },
  },

  spirometer: {
    async init(el, ctx) {
      const trace = liveTrace(el.querySelector('#sp-trace'));
      const c = await ctx.mount3d('./three/spirometer.js', el.querySelector('#sp-mount'));
      ctx.c = c;
      if (!c) return;
      ctx.pins(el.querySelector('.pin-layer'), Promise.resolve(c), [
        { name: 'bell', html: 'Bell', color: 'var(--cyan)' },
        { name: 'pen', html: 'Pen', color: 'var(--orange)' },
        { name: 'mouthpiece', html: 'Mouthpiece', color: 'var(--blue)' },
        { name: 'drum', html: 'Drum', color: 'var(--text-2)' },
      ]);
      c.onSample?.((s) => trace.push(s.t, s.lungVolume));
      ctx.replay = () => { trace.reset(); c.reset?.(); c.play?.(); };
      seg(el.querySelector('#sp-seg'), (b) => { c.setSequence?.(b.dataset.q); ctx.replay(); });
      el.querySelector('#sp-play').addEventListener('click', () => ctx.replay());
    },
    enter(el, ctx) { ctx.replay?.(); },
    leave(el, ctx) { ctx.c?.pause?.(); },
  },

  volumes: {
    init(el, ctx) { ctx.v = volumesChart(el.querySelector('#vol-chart'), el.querySelector('#vol-legend')); },
    enter(el, ctx) { ctx.v.draw(); },
  },

  'not-measurable': {
    init(el, ctx) { ctx.b = blindChart(el.querySelector('#nm-chart')); },
    enter(el, ctx) { ctx.b.draw(); },
  },

  'volume-links': {
    init(el, ctx) {
      const a = chart(el.querySelector('#lk-a'), { x: [0, 45], y: [0, 6.2], xTickValues: [0, 10, 20, 30, 40], yTickValues: [0, 2, 4, 6], xLabel: 'Transmural pressure (cm H₂O)', yLabel: 'Volume (L)', m: { l: 100, r: 30, t: 20, b: 92 } });
      a.path(d3.range(1.0, 5.94, 0.02).map((V) => [PL(V), V]), { color: 'var(--blue)', glow: true });
      const tan = a.over.append('line').style('stroke', 'var(--yellow)').style('stroke-width', 6).style('stroke-linecap', 'round');
      const da = a.dot(0, 0, { color: 'var(--yellow)', r: 13 });
      const ta = a.text(a.iw - 6, a.ih - 24, '', { anchor: 'end', color: 'var(--green)' });
      // Raw vs lung volume — data points read from the lecture figure (slide 31)
      const RAW = [[1.6, 4.0], [2.0, 3.0], [2.6, 2.0], [3.0, 1.6], [4.0, 1.05], [4.25, 0.95], [5.0, 0.8], [6.0, 0.65], [7.0, 0.55]];
      const rawF = monotone(RAW);
      const b = chart(el.querySelector('#lk-b'), { x: [0, 7.5], y: [0, 4.3], xTickValues: [0, 2, 4, 6], yTickValues: [0, 1, 2, 3, 4], xLabel: 'Lung volume (L)', yLabel: 'R<tspan baseline-shift="sub" font-size="70%">aw</tspan> (cm H₂O·L⁻¹·s)', m: { l: 100, r: 30, t: 20, b: 92 } });
      b.path(d3.range(1.6, 7.0001, 0.02).map((v) => [v, rawF(v)]), { color: 'var(--orange)', glow: true });
      RAW.forEach(([x, y]) => b.plot.append('circle').attr('cx', b.x(x)).attr('cy', b.y(y)).attr('r', 9).style('fill', 'var(--bg)').style('stroke', 'var(--orange)').style('stroke-width', 4));
      b.vline(4, { color: 'var(--text-3)' }); b.text(b.x(4) + 10, b.y(0) - 14, 'FRC', { color: 'var(--text-3)', cls: '' }).style('font-size', '22px');
      const db = b.dot(0, 0, { color: 'var(--yellow)', r: 13 });
      const tb = b.text(b.iw - 6, 40, '', { anchor: 'end', color: 'var(--orange)' });
      const r = el.querySelector('#lk-range'); rangeFill(r);
      const out = el.querySelector('#lk-out');
      let f = 0.35;
      ctx.loop((dt) => {
        f = damp(f, r.value / 100, 9, dt);
        const Va = lerp(1.25, 5.85, f), Pa = PL(Va), slope = (5 / 9.2) * Math.exp(-Pa / 9.2);
        da.attr('transform', `translate(${a.x(Pa)},${a.y(Va)})`);
        tan.attr('x1', a.x(Pa - 6)).attr('y1', a.y(Va - slope * 6)).attr('x2', a.x(Pa + 6)).attr('y2', a.y(Va + slope * 6));
        ta.text(slope > 0.25 ? 'Compliance high' : slope > 0.08 ? 'Compliance falling' : 'Compliance low');
        const Vb = lerp(1.6, 7, f), R = rawF(Vb);
        db.attr('transform', `translate(${b.x(Vb)},${b.y(R)})`);
        tb.text(`Raw ≈ ${R.toFixed(1)}`);
        out.textContent = f < 0.3 ? 'Low' : f < 0.7 ? 'Mid' : 'High';
      });
    },
  },
};
