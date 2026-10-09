import { svg, clamp, lerp, fmt, monotone, damp, rangeFill, seg, tween, easeInOut, sample } from '../lib/util.js';
import { flips } from '../lib/util.js';
import { chart, drawIn, pointer } from '../lib/chart.js';
import { thorax } from '../lib/shared3d.js';

const d3 = window.d3;

/* Static P–V model shaped after the lecture figure (slides 16–20):
   lung minimal volume ≈ 1 L at 0 cm H2O, chest wall rests ≈ 4 L at 0 cm H2O,
   RV ≈ 1.5 L, TLC ≈ 6 L, the two recoils balance at FRC ≈ 3.1 L. */
export const PL = (V) => -9.2 * Math.log(1 - clamp((V - 1) / 5, 0, 0.995)); // lung transmural P(V)
export const PCW = monotone([[1.5, -40], [2.1, -20], [2.6, -10], [3.1, -5], [4.0, 0], [5.0, 4], [6.0, 10]]);
export const PRS = (V) => PL(V) + PCW(V);
const VL = (P) => 1 + 5 * (1 - Math.exp(-P / 9.2));
function solve(f, a, b) { for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (f(a) * f(m) <= 0) b = m; else a = m; } return (a + b) / 2; }
export const FRC = solve(PRS, 1.6, 5.9);

const lungPts = () => d3.range(1.0, 5.94, 0.02).map((V) => [PL(V), V]);
const chestPts = () => d3.range(1.5, 6.0001, 0.02).map((V) => [PCW(V), V]);
const sysPts = () => d3.range(1.5, 5.93, 0.02).map((V) => [PRS(V), V]);

function pvChart(container, extra = {}) {
  return chart(container, Object.assign({ x: [-60, 60], y: [0, 6], xTicks: 6, yTicks: 6, xLabel: 'Transmural pressure (cm H₂O)', yLabel: 'Volume (L)', m: { l: 104, r: 40, t: 24, b: 96 }, xTickValues: [-60, -40, -20, 0, 20, 40, 60] }, extra));
}

/* ---------- compliance vs elastance balloon ---------- */
function balloon(container, range, outEl) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 1150 800').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  // left: the "lung"
  const glow = svg('circle', { cx: 300, cy: 400, fill: 'var(--green)', opacity: 0.12 }, s);
  const body = svg('circle', { cx: 300, cy: 400, fill: 'color-mix(in srgb, var(--green) 22%, transparent)', stroke: 'var(--green)', 'stroke-width': 7 }, s);
  const neck = svg('path', { d: 'M300 690 V740', stroke: 'var(--green)', 'stroke-width': 10, 'stroke-linecap': 'round' }, s);
  void neck;
  const springs = Array.from({ length: 3 }, () => svg('path', { fill: 'none', stroke: 'var(--purple)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.9 }, s));
  const lblP = svg('text', { x: 300, y: 790, 'text-anchor': 'middle', style: 'font:700 28px var(--font);fill:var(--text-2)' }, s); lblP.textContent = 'Same ΔP every breath';
  // right: mini P–V line
  const ox = 660, oy = 640, w = 430, h = 520;
  svg('path', { d: `M${ox} ${oy - h} V${oy} H${ox + w}`, fill: 'none', stroke: 'var(--stroke-2)', 'stroke-width': 4 }, s);
  const tx = svg('text', { x: ox + w / 2, y: oy + 60, 'text-anchor': 'middle', class: 'ax-title' }, s); tx.textContent = 'ΔP';
  const ty = svg('text', { x: ox - 30, y: oy - h / 2, 'text-anchor': 'middle', class: 'ax-title', transform: `rotate(-90 ${ox - 30} ${oy - h / 2})` }, s); ty.textContent = 'ΔV';
  const line = svg('line', { x1: ox, y1: oy, stroke: 'var(--green)', 'stroke-width': 8, 'stroke-linecap': 'round' }, s);
  const dot = svg('circle', { r: 16, fill: 'var(--green)', stroke: 'var(--bg)', 'stroke-width': 5 }, s);
  const slope = svg('text', { x: ox + w, y: oy - h + 10, 'text-anchor': 'end', style: 'font:750 40px var(--font);fill:var(--green)' }, s);
  let t = 0, E = 1, Eshow = 1;
  const read = () => { const k = range.value / 100; E = lerp(0.45, 3.2, k); outEl.textContent = k < 0.25 ? 'Low → very compliant' : k < 0.6 ? 'Normal' : 'High → stiff'; };
  range.addEventListener('input', read); read();
  return (dt) => {
    t += dt;
    Eshow = damp(Eshow, E, 8, dt);
    const C = 1 / Eshow;
    const dP = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 4);
    const dV = C * dP; // 0 .. ~2.2
    const r = 120 + 110 * dV;
    body.setAttribute('r', r); glow.setAttribute('r', r + 40);
    body.setAttribute('cy', 690 - r); glow.setAttribute('cy', 690 - r);
    // elastic fibres: wavy rings that straighten as the lung stretches; thicker when elastance is high
    springs.forEach((p, i) => {
      const cx = 300, cy = 690 - r, rr = r * (0.42 + i * 0.22), waves = 14 + i * 4, amp = 14 * (1 - Math.min(1, dV / 2.2)) + 2;
      let d = '';
      for (let k = 0; k <= 120; k++) {
        const a = (k / 120) * Math.PI * 2, q = rr + amp * Math.sin(a * waves + t * 0.6);
        d += (k ? 'L' : 'M') + (cx + Math.cos(a) * q).toFixed(1) + ' ' + (cy + Math.sin(a) * q).toFixed(1);
      }
      p.setAttribute('d', d + 'Z');
      p.setAttribute('stroke-width', 2 + 2.6 * Eshow);
    });
    const sx = (p) => ox + (p / 1) * w * 0.92, sy = (v) => oy - (v / 2.3) * h;
    const endP = Math.min(1, 2.3 / C);
    line.setAttribute('x2', sx(endP)); line.setAttribute('y2', sy(C * endP));
    dot.setAttribute('cx', sx(dP)); dot.setAttribute('cy', sy(dV));
    slope.textContent = `C = ${C.toFixed(2)}×`;
  };
}

/* ---------- Laplace bubble ---------- */
function laplace(container, range, outEl) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 1100 760').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  const cx = 550, cy = 330;
  const defs = svg('defs', {}, s);
  const gr = svg('radialGradient', { id: 'bubg', cx: '35%', cy: '30%', r: '75%' }, defs);
  svg('stop', { offset: '0%', 'stop-color': 'white', 'stop-opacity': 0.35 }, gr);
  svg('stop', { offset: '55%', 'stop-color': 'var(--blue)', 'stop-opacity': 0.12 }, gr);
  svg('stop', { offset: '100%', 'stop-color': 'var(--cyan)', 'stop-opacity': 0.35 }, gr);
  const halo = svg('circle', { cx, cy, fill: 'var(--blue)', opacity: 0.1 }, s);
  const bub = svg('circle', { cx, cy, fill: 'url(#bubg)', stroke: 'var(--cyan)', 'stroke-width': 6 }, s);
  const arrows = Array.from({ length: 10 }, () => svg('path', { fill: 'none', stroke: 'var(--pink)', 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s));
  const tens = Array.from({ length: 10 }, () => svg('path', { fill: 'none', stroke: 'var(--yellow)', 'stroke-width': 5, 'stroke-linecap': 'round', opacity: 0.85 }, s));
  const pT = svg('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', style: 'font:800 54px var(--font);fill:var(--text);font-variant-numeric:tabular-nums' }, s);
  const legend = svg('text', { x: cx, y: 690, 'text-anchor': 'middle', style: 'font:650 28px var(--font);fill:var(--text-2)' }, s);
  legend.innerHTML = '<tspan fill="var(--yellow)">● Surface tension T</tspan>   <tspan fill="var(--pink)">● Collapsing pressure P</tspan>';
  let r = 0.7, rt = 0.7;
  const read = () => { rt = range.value / 100; outEl.textContent = rt < 0.5 ? 'Small alveolus' : rt < 0.8 ? 'Medium' : 'Large alveolus'; };
  range.addEventListener('input', read); read();
  let time = 0;
  return (dt) => {
    time += dt;
    r = damp(r, rt, 10, dt);
    const R = 90 + r * 210, P = 2 / r; // T = 1
    bub.setAttribute('r', R); halo.setAttribute('r', R + 30);
    pT.textContent = `P = ${P.toFixed(1)}`;
    const L = 26 + P * 15;
    arrows.forEach((a, i) => {
      const ang = (i / arrows.length) * Math.PI * 2 + 0.3, ux = Math.cos(ang), uy = Math.sin(ang);
      const x0 = cx + ux * (R - 10), y0 = cy + uy * (R - 10), x1 = cx + ux * (R - 10 - L), y1 = cy + uy * (R - 10 - L);
      const hx = -uy * 12, hy = ux * 12, bx = x1 + ux * 16, by = y1 + uy * 16;
      a.setAttribute('d', `M${x0} ${y0} L${x1} ${y1} M${bx + hx} ${by + hy} L${x1} ${y1} L${bx - hx} ${by - hy}`);
      a.setAttribute('opacity', R - 10 - L > 40 ? 1 : 0.35);
    });
    tens.forEach((p, i) => {
      const ang = (i / tens.length) * Math.PI * 2 + 0.3 + Math.PI / tens.length, span = 0.22 + 0.04 * Math.sin(time * 3 + i);
      const a0 = ang - span, a1 = ang + span;
      p.setAttribute('d', `M${cx + Math.cos(a0) * (R + 22)} ${cy + Math.sin(a0) * (R + 22)} A${R + 22} ${R + 22} 0 0 1 ${cx + Math.cos(a1) * (R + 22)} ${cy + Math.sin(a1) * (R + 22)}`);
    });
  };
}

/* ---------- tug-of-war arrows for the system slide ---------- */
function tug(container) {
  const s = svg('svg', { viewBox: '0 0 640 230', width: '100%', height: '100%' }, container);
  const chestR = svg('rect', { y: 22, height: 156, rx: 46, fill: 'none', stroke: 'var(--purple)', 'stroke-width': 6 }, s);
  const lungE = svg('ellipse', { cx: 320, cy: 100, ry: 54, fill: 'color-mix(in srgb, var(--blue) 22%, transparent)', stroke: 'var(--blue)', 'stroke-width': 5 }, s);
  const mk = (c) => svg('path', { 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', stroke: c }, s);
  const lungA = [mk('var(--blue)'), mk('var(--blue)')], chestA = [mk('var(--purple)'), mk('var(--purple)')];
  const t1 = svg('text', { x: 320, y: 112, 'text-anchor': 'middle', style: 'font:750 28px var(--font);fill:var(--text)' }, s);
  const t2 = svg('text', { x: 320, y: 222, 'text-anchor': 'middle', style: 'font:650 23px var(--font);fill:var(--text-2)' }, s);
  const arrow = (x0, x1, y) => { const d = Math.sign(x1 - x0) || 1; return `M${x0} ${y} H${x1} M${x1 - d * 18} ${y - 15} L${x1} ${y} L${x1 - d * 18} ${y + 15}`; };
  const len = (p) => 20 * Math.sqrt(Math.abs(p));
  return (V) => {
    const pl = PL(V), pcw = PCW(V), net = pl + pcw;
    const cw = 150 + (V - 1.5) * 22, lw = cw - 34;
    chestR.setAttribute('x', 320 - cw); chestR.setAttribute('width', cw * 2);
    lungE.setAttribute('rx', lw);
    // lung recoil: always inward, drawn just inside the lung edge
    const L = Math.min(lw - 30, len(pl));
    lungA[0].setAttribute('d', arrow(320 - lw + 6, 320 - lw + 6 + L, 70));
    lungA[1].setAttribute('d', arrow(320 + lw - 6, 320 + lw - 6 - L, 70));
    // chest wall recoil: outward below its resting volume, inward above it
    const C = Math.min(150, len(pcw));
    if (Math.abs(pcw) < 0.4) { chestA[0].setAttribute('d', ''); chestA[1].setAttribute('d', ''); }
    else if (pcw < 0) { chestA[0].setAttribute('d', arrow(320 - cw - 8, 320 - cw - 8 - C, 140)); chestA[1].setAttribute('d', arrow(320 + cw + 8, 320 + cw + 8 + C, 140)); }
    else { chestA[0].setAttribute('d', arrow(320 - cw - 8 - C, 320 - cw - 8, 140)); chestA[1].setAttribute('d', arrow(320 + cw + 8 + C, 320 + cw + 8, 140)); }
    const bal = Math.abs(net) < 1.2;
    t1.textContent = bal ? 'Balanced' : net > 0 ? 'Net inward' : 'Net outward';
    t1.style.fill = bal ? 'var(--green)' : 'var(--text)';
    t2.textContent = bal ? 'Resting position = FRC' : net > 0 ? (pcw > 0.4 ? 'Both recoil inward → passive expiration' : 'Recoils back toward FRC') : 'Springs out toward FRC';
  };
}

/* ---------- slides ---------- */
export default {
  'compliance-elastance': {
    init(el, ctx) {
      const r = el.querySelector('#ce-range'); rangeFill(r);
      const f = balloon(el.querySelector('#ce-mount'), r, el.querySelector('#ce-out'));
      ctx.loop((dt) => f(dt));
    },
  },

  recoil: {
    init(el, ctx) {
      const r = el.querySelector('#lap-range'); rangeFill(r);
      const f = laplace(el.querySelector('#lap-mount'), r, el.querySelector('#lap-out'));
      ctx.loop((dt) => f(dt));
    },
  },

  'lung-compliance': {
    init(el, ctx) {
      const c = pvChart(el.querySelector('#lc-chart'));
      c.vline(0, { dash: false, color: 'var(--stroke-2)' });
      const p = c.path(lungPts(), { color: 'var(--blue)', glow: true });
      c.text(c.x(22), c.y(3.4), 'Lung', { color: 'var(--blue)' });
      c.text(c.x(1.5), c.y(0.55), '← minimal volume', { color: 'var(--text-3)', cls: '' }).style('font-size', '22px');
      const tan = c.over.append('line').style('stroke', 'var(--yellow)').style('stroke-width', 6).style('stroke-linecap', 'round');
      const dot = c.dot(0, 0, { color: 'var(--yellow)', r: 13 });
      const fill = el.querySelector('#lc-fill'), lbl = el.querySelector('#lc-lbl');
      let V = 2.4, Vt = 2.4, user = false, time = 0;
      c.svg.on('pointermove', (ev) => { user = true; Vt = clamp(pointer(c, ev).y, 1.05, 5.9); }).on('pointerleave', () => (user = false));
      ctx.loop((dt) => {
        time += dt;
        if (!user) Vt = 3.4 + 2.3 * Math.sin(time * 0.6);
        V = damp(V, Vt, 9, dt);
        const P = PL(V), slope = (5 / 9.2) * Math.exp(-P / 9.2); // dV/dP (L per cm H2O)
        dot.attr('transform', `translate(${c.x(P)},${c.y(V)})`);
        const dP = 9; // half-length of tangent in cm H2O
        tan.attr('x1', c.x(P - dP)).attr('y1', c.y(V - slope * dP)).attr('x2', c.x(P + dP)).attr('y2', c.y(V + slope * dP));
        const k = clamp(slope / 0.5, 0, 1);
        fill.style.width = k * 100 + '%';
        lbl.textContent = k > 0.45 ? 'High — steep' : k > 0.15 ? 'Falling' : 'Low — flat, stiff';
        lbl.style.color = k > 0.45 ? 'var(--green)' : k > 0.15 ? 'var(--yellow)' : 'var(--orange)';
      });
      ctx.draw = () => drawIn(p, 1500, 200);
    },
    enter(el, ctx) { ctx.draw?.(); },
  },

  'chest-compliance': {
    init(el, ctx) {
      const c = pvChart(el.querySelector('#cw-chart'));
      c.area([[-60, 0], [0, 0], [0, 6], [-60, 6]], { color: 'var(--red)', opacity: 0.06 });
      c.area([[0, 0], [60, 0], [60, 6], [0, 6]], { color: 'var(--green)', opacity: 0.06 });
      c.vline(0, { dash: false, color: 'var(--stroke-2)' });
      c.text(c.x(-56), c.y(5.55), 'Compress: great force', { color: 'var(--red)', cls: '' }).style('font-size', '24px').style('font-weight', 700);
      c.text(c.x(56), c.y(0.5), 'Inflate: less force', { color: 'var(--green)', anchor: 'end', cls: '' }).style('font-size', '24px').style('font-weight', 700);
      const p = c.path(chestPts(), { color: 'var(--purple)', glow: true });
      c.text(c.x(-36), c.y(2.25), 'Chest wall', { color: 'var(--purple)' });
      c.hline(4, { color: 'var(--purple)' });
      const rest = c.dot(c.x(0), c.y(4), { color: 'var(--purple)', r: 14 });
      c.text(c.x(4), c.y(4) - 26, 'Rests ≈ 4 L at 0 pressure', { color: 'var(--text)', cls: '' }).style('font-size', '26px').style('font-weight', 700);
      void rest;
      ctx.draw = () => drawIn(p, 1500, 200);
    },
    enter(el, ctx) { ctx.draw?.(); },
  },

  'combined-frc': {
    init(el, ctx) {
      const c = pvChart(el.querySelector('#sys-chart'), { m: { l: 104, r: 110, t: 24, b: 96 } });
      // right %VC axis
      const vc = d3.scaleLinear().domain([0, 100]).range([c.y(1.5), c.y(6)]);
      c.g.append('g').attr('class', 'axis').attr('transform', `translate(${c.iw},0)`).call(d3.axisRight(vc).tickValues([0, 50, 100]).tickSizeOuter(0).tickPadding(10));
      c.svg.append('text').attr('class', 'ax-title').attr('transform', `translate(${c.W - 24},${c.m.t + c.ih / 2}) rotate(90)`).attr('text-anchor', 'middle').text('% VC');
      c.vline(0, { dash: false, color: 'var(--stroke-2)' });
      c.hline(1.5); c.text(c.iw - 8, c.y(1.5) - 12, 'RV', { anchor: 'end', color: 'var(--text-3)', cls: '' }).style('font-size', '22px');
      c.hline(FRC, { color: 'var(--green)' }); c.text(c.iw - 8, c.y(FRC) - 12, 'FRC', { anchor: 'end', color: 'var(--green)' });
      const pl = c.path(lungPts(), { color: 'var(--blue)', cls: 'line mid' });
      const pc = c.path(chestPts(), { color: 'var(--purple)', cls: 'line mid' });
      const ps = c.path(sysPts(), { color: 'var(--text)', glow: true });
      c.text(c.x(12), c.y(1.25), 'Lung', { color: 'var(--blue)' });
      c.text(c.x(-14), c.y(4.9), 'Chest wall', { color: 'var(--purple)', anchor: 'end' });
      c.text(c.x(30), c.y(4.3), 'Lung + chest', { color: 'var(--text)' });
      const hl = c.over.append('line').attr('x1', 0).attr('x2', c.iw).style('stroke', 'var(--yellow)').style('stroke-width', 3).style('opacity', 0.8);
      const dL = c.dot(0, 0, { color: 'var(--blue)', r: 11 }), dC = c.dot(0, 0, { color: 'var(--purple)', r: 11 }), dS = c.dot(0, 0, { color: 'var(--text)', r: 13 });
      const range = el.querySelector('#sys-range'); const upd = rangeFill(range);
      const out = el.querySelector('#sys-out');
      const t = tug(el.querySelector('#sys-arrows'));
      let V = FRC, Vt = FRC;
      range.value = Math.round(FRC * 100); upd();
      range.addEventListener('input', () => (Vt = range.value / 100));
      ctx.loop((dt) => {
        V = damp(V, Vt, 10, dt);
        hl.attr('y1', c.y(V)).attr('y2', c.y(V));
        dL.attr('transform', `translate(${c.x(PL(V))},${c.y(V)})`);
        dC.attr('transform', `translate(${c.x(PCW(V))},${c.y(V)})`);
        dS.attr('transform', `translate(${c.x(clamp(PRS(V), -60, 60))},${c.y(V)})`);
        out.textContent = `${V.toFixed(1)} L`;
        t(V);
      });
      ctx.draw = () => { drawIn(pl, 1200, 100); drawIn(pc, 1200, 350); drawIn(ps, 1400, 700); };
      ctx.reset = () => { Vt = FRC; range.value = Math.round(FRC * 100); upd(); };
    },
    enter(el, ctx) { ctx.draw?.(); ctx.reset?.(); },
  },

  pneumothorax: {
    async init(el, ctx) {
      const cp = thorax(ctx, el.querySelector('.thorax-slot'));
      ctx.cp = cp;
      const defs = [{ name: 'ppl', html: 'P<sub>pl</sub> ≈ −5 cm H₂O', color: 'var(--green)', pop: 'ppl-neg' }];
      const pins = ctx.pins(el.querySelector('.pin-layer'), cp, defs);
      seg(el.querySelector('#ptx-seg'), (b) => {
        const on = b.dataset.p === '1';
        defs[0].name = on ? 'leftLung' : 'ppl';
        defs[0].dx = on ? 40 : 0; defs[0].dy = on ? -150 : 0;
        cp.then((c) => c?.setPneumothorax?.(on));
        pins[0].querySelector('span').innerHTML = on ? 'P<sub>pl</sub> = 0 (atmospheric)' : 'P<sub>pl</sub> ≈ −5 cm H₂O';
        pins[0].style.setProperty('--c', on ? 'var(--red)' : 'var(--green)');
      });
      ctx.seg = el.querySelector('#ptx-seg');
    },
    enter(el, ctx) {
      ctx.cp?.then((c) => { if (!c) return; c.setDisease?.('normal'); c.setAutoBreath?.(true, 4); c.setAirflow?.(false); c.highlight?.('ppl'); });
      ctx.seg?.querySelector('[data-p="0"]').click();
    },
    leave(el, ctx) { ctx.cp?.then((c) => { c?.setPneumothorax?.(false); c?.highlight?.(null); }); },
  },

  'frc-disease': {
    init(el, ctx) {
      const c = chart(el.querySelector('#frcd-chart'), { x: [-45, 45], y: [0.8, 6.2], xTickValues: [-40, -20, 0, 20, 40], yTickValues: [1, 2, 3, 4, 5, 6], xLabel: 'Pressure (cm H₂O)  ·  ← chest pulls out   |   lung pulls in →', yLabel: 'Volume (L)' });
      c.vline(0, { dash: false, color: 'var(--stroke-2)' });
      const MODES = [{ a: 1, b: 1 }, { a: 2.5, b: 1 }, { a: 1, b: 2.5 }];
      const lungF = (a) => d3.range(1.0, 5.9, 0.02).map((V) => [a * PL(V), V]).filter((p) => p[0] <= 46);
      const chestF = (b) => d3.range(1.5, 4.0001, 0.02).map((V) => [b * PCW(V), V]).filter((p) => p[0] >= -46);
      const ghostL = c.path(lungF(1), { color: 'var(--blue)', cls: 'line thin dash' }).style('opacity', 0);
      const ghostC = c.path(chestF(1), { color: 'var(--purple)', cls: 'line thin dash' }).style('opacity', 0);
      const pL = c.path(lungF(1), { color: 'var(--blue)', glow: true });
      const pC = c.path(chestF(1), { color: 'var(--purple)', glow: true });
      const tL = c.text(0, 0, 'Lungs', { color: 'var(--blue)' }), tC = c.text(0, 0, 'Chest', { color: 'var(--purple)', anchor: 'end' });
      const bar = c.over.append('g');
      const barL = bar.append('line').style('stroke', 'var(--red)').style('stroke-width', 7).style('stroke-linecap', 'round');
      const tick = bar.append('line').style('stroke', 'var(--red)').style('stroke-width', 7);
      const frcT = bar.append('text').attr('class', 'lbl').style('fill', 'var(--green)').attr('text-anchor', 'start');
      const ghostFRC = c.hline(FRC, { color: 'var(--text-3)' });
      const st = { a: 1, b: 1 };
      const frcOf = (a, b) => solve((V) => a * PL(V) + b * PCW(V), 1.6, 3.99);
      const render = () => {
        c.update(pL, lungF(st.a)); c.update(pC, chestF(st.b));
        const F = frcOf(st.a, st.b), half = st.a * PL(F);
        barL.attr('x1', c.x(-half)).attr('x2', c.x(half)).attr('y1', c.y(F)).attr('y2', c.y(F));
        tick.attr('x1', c.x(0)).attr('x2', c.x(0)).attr('y1', c.y(F) - 18).attr('y2', c.y(F) + 18);
        frcT.attr('x', c.x(half) + 22).attr('y', c.y(F) + 10).text('FRC');
        const lp = lungF(st.a), cpx = chestF(st.b);
        const lt = lp[Math.min(lp.length - 1, Math.round(lp.length * 0.62))]; tL.attr('x', c.x(lt[0]) + 18).attr('y', c.y(lt[1]));
        const ct = cpx[Math.round(cpx.length * 0.3)]; tC.attr('x', c.x(ct[0]) - 18).attr('y', c.y(ct[1]));
        return F;
      };
      render();
      const out = el.querySelector('#frcd-v');
      seg(el.querySelector('#frcd-seg'), (b) => {
        const i = +b.dataset.m, to = MODES[i], from = { ...st };
        ghostL.style('opacity', i === 1 ? 0.5 : 0); ghostC.style('opacity', i === 2 ? 0.5 : 0);
        tween(0, 1, 1.0, (p) => { st.a = lerp(from.a, to.a, p); st.b = lerp(from.b, to.b, p); render(); }, easeInOut);
        out.textContent = i === 0 ? 'Normal' : i === 1 ? 'Decreased ↓' : 'Increased ↑';
        out.style.color = i === 0 ? 'var(--green)' : i === 1 ? 'var(--blue)' : 'var(--purple)';
      });
      void ghostFRC;
      ctx.draw = () => { drawIn(pL, 1200, 100); drawIn(pC, 1200, 300); };
    },
    enter(el, ctx) { ctx.draw?.(); },
  },

  think: {
    init(el) {
      flips(el);
    },
    leave(el) { el.querySelectorAll('.flip').forEach((f) => f.classList.remove('open')); },
  },
};
