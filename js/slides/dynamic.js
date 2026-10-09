import { clamp, lerp, damp, rangeFill, seg, monotone, tween, easeInOut } from '../lib/util.js';
import { chart, drawIn, pointer } from '../lib/chart.js';

const d3 = window.d3;

/* ---------- hysteresis loop (shape after lecture slides 33–34) ---------- */
// pressure (cm H2O, negative) as a function of volume above FRC (L)
const P_EXP = monotone([[0, -5], [0.1, -5.05], [0.25, -5.2], [0.42, -5.5], [0.6, -6.1], [0.8, -7.2], [0.92, -8.4], [1.0, -10]]);
const P_INS = monotone([[0, -5], [0.05, -6.2], [0.12, -7.4], [0.25, -8.6], [0.42, -9.5], [0.6, -9.85], [0.8, -9.98], [1.0, -10]]);
const P_STA = (v) => -5 - 5 * v;
function volAtP(Pf, P) { // invert monotone-decreasing P(v)
  let a = 0, b = 1;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (Pf(m) > P) a = m; else b = m; }
  return (a + b) / 2;
}

/* ---------- forced expiration (lecture slide 37 figure) ---------- */
const EXP = monotone([[0, 0], [0.15, 6], [0.35, 10.2], [0.6, 11.5], [1.0, 10.6], [2.0, 8.1], [3.0, 5.6], [4.0, 2.9], [4.5, 1.5], [5.0, 0.6], [5.4, 0.15], [5.7, 0]]);
const INS = monotone([[0, 0], [0.15, -2.4], [0.6, -4.4], [1.4, -5.8], [2.4, -6.6], [3.6, -6.8], [4.6, -6.3], [5.3, -5.2], [5.6, -3.5], [5.7, 0]]);
const FVC = 5.7;
// integrate time along the expiratory limb → volume–time curve
const VT_CURVE = (() => {
  const pts = [[0, 0]]; let t = 0, v = 0; const dv = 0.005;
  while (v < FVC - 1e-6) { const f = Math.max(0.12, EXP(v + dv / 2)); t += dv / f; v = Math.min(FVC, v + dv); pts.push([t, v]); }
  return pts;
})();
const T_END = VT_CURVE[VT_CURVE.length - 1][0];
const volAtT = (t) => { if (t >= T_END) return FVC; let i = 0; while (VT_CURVE[i + 1][0] < t) i++; const [t0, v0] = VT_CURVE[i], [t1, v1] = VT_CURVE[i + 1]; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); };
const FEV1 = volAtT(1);

export default {
  hysteresis: {
    init(el, ctx) {
      const c = chart(el.querySelector('#hy-chart'), { x: [0, -10.8], y: [0, 1.08], xTickValues: [0, -2, -4, -6, -8, -10], yTickValues: [0, 0.2, 0.4, 0.6, 0.8, 1.0], xLabel: 'Intrapleural pressure (cm H₂O)', yLabel: 'Lung volume above FRC (L)', yFormat: d3.format('.1f') });
      const vs = d3.range(0, 1.0001, 0.01);
      const loopArea = c.area([...vs.map((v) => [P_INS(v), v]), ...vs.slice().reverse().map((v) => [P_EXP(v), v])], { color: 'var(--orange)', opacity: 0.12, curve: d3.curveLinear });
      const sta = c.path([[-5, 0], [-10, 1]], { color: 'var(--text-2)', cls: 'line mid dash', curve: d3.curveLinear });
      const ins = c.path(vs.map((v) => [P_INS(v), v]), { color: 'var(--blue)', glow: true });
      const exp = c.path(vs.map((v) => [P_EXP(v), v]), { color: 'var(--orange)', glow: true });
      const lI = c.text(c.x(-9.85) + 14, c.y(0.36), 'Inspiration ↑', { color: 'var(--blue)' });
      const lE = c.text(c.x(-5.6) - 14, c.y(0.64), '↓ Expiration', { color: 'var(--orange)', anchor: 'end' });
      const lS = c.text(c.x(-8.2) + 6, c.y(0.7), 'Static', { color: 'var(--text-2)', cls: '' }).style('font-size', '24px').style('font-weight', 700);
      c.dot(c.x(-5), c.y(0), { color: 'var(--text-2)', r: 10, ring: false });
      c.dot(c.x(-10), c.y(1), { color: 'var(--text-2)', r: 10, ring: false });
      // probe
      const probe = c.over.append('g');
      const pl = probe.append('line').attr('y1', 0).attr('y2', c.ih).style('stroke', 'var(--yellow)').style('stroke-width', 3).style('stroke-dasharray', '6 8');
      const pE = c.dot(0, 0, { color: 'var(--orange)', r: 11, parent: probe }), pI = c.dot(0, 0, { color: 'var(--blue)', r: 11, parent: probe });
      const tE = probe.append('text').attr('class', 'lbl').style('fill', 'var(--orange)');
      const tI = probe.append('text').attr('class', 'lbl').style('fill', 'var(--blue)');
      const run = c.dot(0, 0, { color: 'var(--yellow)', r: 14 });
      let P = -7.3, Pt = -7.3, user = false, mode = 'dynamic', time = 0;
      c.svg.on('pointermove', (ev) => { user = true; Pt = clamp(pointer(c, ev).x, -9.9, -5.1); }).on('pointerleave', () => (user = false));
      seg(el.querySelector('#hy-seg'), (b) => {
        mode = b.dataset.m;
        const dyn = mode === 'dynamic';
        [ins, exp, lI, lE, loopArea, probe].forEach((e) => e.transition().duration(500).style('opacity', dyn ? 1 : 0.0));
        sta.transition().duration(500).style('opacity', dyn ? 0.7 : 1).style('stroke', dyn ? 'var(--text-2)' : 'var(--green)');
        lS.text(dyn ? 'Static' : 'Static compliance').style('fill', dyn ? 'var(--text-2)' : 'var(--green)');
      });
      ctx.loop((dt) => {
        time += dt;
        if (!user) Pt = -7.3 + 1.8 * Math.sin(time * 0.5);
        P = damp(P, Pt, 8, dt);
        const vE = volAtP(P_EXP, P), vI = volAtP(P_INS, P);
        pl.attr('x1', c.x(P)).attr('x2', c.x(P));
        pE.attr('transform', `translate(${c.x(P)},${c.y(vE)})`); pI.attr('transform', `translate(${c.x(P)},${c.y(vI)})`);
        tE.attr('x', c.x(P) + 20).attr('y', c.y(vE) - 14).text(`${vE.toFixed(2)} L`);
        tI.attr('x', c.x(P) + 20).attr('y', c.y(vI) + 38).text(`${vI.toFixed(2)} L`);
        // running dot: 2 s up the inspiratory limb, 2 s down the expiratory limb
        const ph = (time % 4) / 2;
        let x, y;
        if (mode === 'static') { const v = ph < 1 ? ph : 2 - ph; x = P_STA(v); y = v; }
        else if (ph < 1) { const v = 0.5 - 0.5 * Math.cos(Math.PI * ph); x = P_INS(v); y = v; }
        else { const v = 0.5 + 0.5 * Math.cos(Math.PI * (ph - 1)); x = P_EXP(v); y = v; }
        run.attr('transform', `translate(${c.x(x)},${c.y(y)})`);
      });
      ctx.draw = () => { drawIn(ins, 1300, 100); drawIn(exp, 1300, 700); };
    },
    enter(el, ctx) { ctx.draw?.(); },
  },

  work: {
    init(el, ctx) {
      const c = chart(el.querySelector('#wk-chart'), { x: [-4, -15.5], y: [-0.08, 1.15], xTickValues: [], yTickValues: [0, 1], yFormat: (d) => (d === 0 ? 'FRC' : 'FRC + Vᴛ'), xLabel: 'Increasing negative intrapleural pressure →', m: { l: 150, r: 30, t: 20, b: 80 }, grid: false });
      const MODES = [{ end: -10, B: 2.2 }, { end: -13.5, B: 2.2 }, { end: -10, B: 4.4 }];
      const st = { end: -10, B: 2.2 };
      const vs = d3.range(0, 1.0001, 0.01);
      const P0 = -5;
      const insF = (v) => lerp(P0, st.end, v) - st.B * Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.85) * (1 - 0.25 * v);
      const elastic = c.plot.append('path').style('fill', 'var(--purple)').style('fill-opacity', 0.3);
      const resist = c.plot.append('path').style('fill', 'var(--orange)').style('fill-opacity', 0.32);
      const outline = c.plot.append('path').style('fill', 'none').style('stroke', 'var(--red)').style('stroke-width', 9).style('stroke-linejoin', 'round');
      const ins = c.plot.append('path').attr('class', 'line mid').style('stroke', 'var(--blue)');
      const sta = c.plot.append('path').attr('class', 'line thin dash').style('stroke', 'var(--text-2)');
      const lE = c.text(0, 0, 'Elastic', { color: 'var(--purple)' }), lR = c.text(0, 0, 'Resistive', { color: 'var(--orange)' });
      const ln = d3.line().x((d) => c.x(d[0])).y((d) => c.y(d[1]));
      const shoelace = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };
      const insPts = () => vs.map((v) => [insF(v), v]);
      const total = () => { const e = shoelace([[P0, 0], [P0, 1], [st.end, 1]]); const r = shoelace([...vs.map((v) => [lerp(P0, st.end, v), v]), ...insPts().reverse()]); return { e, r }; };
      const base = (() => { const s0 = { ...st }; const t = total(); Object.assign(st, s0); return t.e + t.r; })();
      const out = el.querySelector('#wk-v');
      const render = () => {
        const ip = insPts();
        elastic.attr('d', ln([[P0, 0], [P0, 1], [st.end, 1]]) + 'Z');
        resist.attr('d', ln([...vs.map((v) => [lerp(P0, st.end, v), v]), ...ip.slice().reverse()]) + 'Z');
        outline.attr('d', ln([[P0, 1], [P0, 0], ...ip, [st.end, 1]]) + 'Z');
        ins.attr('d', ln(ip));
        sta.attr('d', ln([[P0, 0], [st.end, 1]]));
        lE.attr('x', c.x(P0 + (st.end - P0) * 0.24)).attr('y', c.y(0.82));
        const mv = 0.42; lR.attr('x', c.x((lerp(P0, st.end, mv) + insF(mv)) / 2) - 40).attr('y', c.y(mv) + 14);
        const t = total();
        out.textContent = ((t.e + t.r) / base).toFixed(2);
      };
      render();
      seg(el.querySelector('#wk-seg'), (b) => {
        const to = MODES[+b.dataset.m], from = { ...st };
        tween(0, 1, 1.0, (p) => { st.end = lerp(from.end, to.end, p); st.B = lerp(from.B, to.B, p); render(); }, easeInOut);
      });
    },
  },

  'flow-volume': {
    init(el, ctx) {
      const c = chart(el.querySelector('#fv-chart'), { x: [-0.2, 6.4], y: [-8, 12.5], xTickValues: [0, 1, 2, 3, 4, 5, 6], yTickValues: [-8, -4, 0, 4, 8, 12], xAxisAt: 0, xLabel: 'Volume exhaled (L)', yLabel: 'Flow (L/s)' });
      const exPts = d3.range(0, FVC + 0.0001, 0.02).map((v) => [v, EXP(v)]);
      const inPts = d3.range(FVC, -0.0001, -0.02).map((v) => [v, INS(v)]);
      const fef = c.area([[FVC * 0.25, 0], ...d3.range(FVC * 0.25, FVC * 0.75, 0.02).map((v) => [v, EXP(v)]), [FVC * 0.75, EXP(FVC * 0.75)], [FVC * 0.75, 0]], { color: 'var(--pink)', opacity: 0.0 });
      const ex = c.path(exPts, { color: 'var(--blue)', glow: true });
      const inn = c.path(inPts, { color: 'var(--green)', glow: true });
      const peak = c.over.append('g').style('opacity', 0);
      peak.append('circle').attr('cx', c.x(0.6)).attr('cy', c.y(11.5)).attr('r', 14).style('fill', 'var(--blue)').style('stroke', 'var(--bg)').style('stroke-width', 5);
      peak.append('text').attr('x', c.x(0.6) + 30).attr('y', c.y(11.5) + 8).attr('class', 'lbl').style('fill', 'var(--blue)').text('PEFR');
      const fev = c.over.append('g').style('opacity', 0);
      fev.append('line').attr('x1', c.x(FEV1)).attr('x2', c.x(FEV1)).attr('y1', c.y(0)).attr('y2', c.y(EXP(FEV1)) - 46).style('stroke', 'var(--cyan)').style('stroke-width', 5);
      fev.append('text').attr('x', c.x(FEV1) - 14).attr('y', c.y(EXP(FEV1)) - 30).attr('text-anchor', 'end').attr('class', 'lbl').style('fill', 'var(--cyan)').text('FEV₁ (1 s)');
      const fvc = c.over.append('g').style('opacity', 0);
      fvc.append('path').attr('d', `M${c.x(0)} ${c.y(-7.3)} H${c.x(FVC)} M${c.x(0) + 18} ${c.y(-7.3) - 14} L${c.x(0)} ${c.y(-7.3)} L${c.x(0) + 18} ${c.y(-7.3) + 14} M${c.x(FVC) - 18} ${c.y(-7.3) - 14} L${c.x(FVC)} ${c.y(-7.3)} L${c.x(FVC) - 18} ${c.y(-7.3) + 14}`).style('stroke', 'var(--green)').style('stroke-width', 5).style('fill', 'none');
      fvc.append('text').attr('x', c.x(FVC / 2)).attr('y', c.y(-7.3) - 16).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', 'var(--green)').text('FVC');
      const fefT = c.text(c.x(FVC / 2), c.y(2.2), 'FEF₂₅–₇₅%', { color: 'var(--pink)', anchor: 'middle' }).style('opacity', 0);
      c.text(c.x(0.12), c.y(-1.6), 'TLC', { color: 'var(--text-3)', cls: '' }).style('font-size', '22px').style('font-weight', 700);
      c.text(c.x(FVC) + 6, c.y(1.2), 'RV', { color: 'var(--text-3)', cls: '' }).style('font-size', '22px').style('font-weight', 700);
      const dot = c.dot(c.x(0), c.y(0), { color: 'var(--yellow)', r: 14 });
      // inset volume–time
      const ic = chart(el.querySelector('#fv-inset'), { x: [0, 6], y: [0, 6.3], xTickValues: [0, 1, 2, 4, 6], yTickValues: [0, 2, 4, 6], xFormat: (d) => d + ' s', m: { l: 64, r: 20, t: 14, b: 44 }, grid: true });
      ic.svg.selectAll('.axis text').style('font-size', '20px');
      ic.svg.selectAll('.ax-title').style('font-size', '20px');
      const ivt = ic.path(VT_CURVE.filter((p) => p[0] <= 6).concat([[6, FVC]]), { color: 'var(--blue)', cls: 'line mid', curve: d3.curveLinear });
      ic.hline(FVC, { color: 'var(--green)' });
      ic.vline(1, { color: 'var(--cyan)' });
      ic.text(ic.x(1) + 10, ic.y(FEV1) + 34, `FEV₁ ${FEV1.toFixed(1)} L`, { color: 'var(--cyan)', cls: '' }).style('font-size', '22px').style('font-weight', 750);
      ic.text(ic.iw - 4, ic.y(FVC) - 12, `FVC ${FVC.toFixed(1)} L`, { color: 'var(--green)', anchor: 'end', cls: '' }).style('font-size', '22px').style('font-weight', 750);
      ic.text(ic.iw - 4, ic.y(1.4), `FEV₁/FVC ≈ ${Math.round((FEV1 / FVC) * 100)}%`, { color: 'var(--yellow)', anchor: 'end', cls: '' }).style('font-size', '24px').style('font-weight', 800);
      const steps = [...el.querySelectorAll('#fv-steps li')];
      const setStepUI = (i) => steps.forEach((s, k) => s.classList.toggle('on', k === i));
      let cancel = [];
      const stop = () => { cancel.forEach((f) => f()); cancel = []; };
      ctx.play = () => {
        stop();
        [peak, fev, fvc, fefT].forEach((e) => e.interrupt().style('opacity', 0)); fef.interrupt().style('fill-opacity', 0);
        [ex, inn].forEach((p) => p.each(function () { const L = this.getTotalLength(); d3.select(this).interrupt().attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L); }));
        ivt.each(function () { const L = this.getTotalLength(); d3.select(this).interrupt().attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L); });
        dot.attr('transform', `translate(${c.x(0)},${c.y(0)})`);
        setStepUI(0);
        const t1 = setTimeout(() => {
          setStepUI(1);
          const exL = ex.node().getTotalLength(), ivL = ivt.node().getTotalLength();
          cancel.push(tween(0, 1, 3.6, (p) => {
            const tt = p * Math.min(6, T_END);
            const v = volAtT(tt);
            const frac = v / FVC;
            ex.attr('stroke-dashoffset', exL * (1 - frac));
            ivt.attr('stroke-dashoffset', ivL * (1 - tt / 6));
            dot.attr('transform', `translate(${c.x(v)},${c.y(EXP(v))})`);
            if (v > 0.75) peak.style('opacity', 1);
            if (tt > 1) fev.style('opacity', 1);
          }, (x) => x, () => {
            fvc.transition().duration(500).style('opacity', 1);
            fef.transition().duration(700).style('fill-opacity', 0.22); fefT.transition().duration(700).style('opacity', 1);
            setStepUI(2);
            const inL = inn.node().getTotalLength();
            cancel.push(tween(0, 1, 1.8, (p) => {
              inn.attr('stroke-dashoffset', inL * (1 - p));
              const v = FVC * (1 - p);
              dot.attr('transform', `translate(${c.x(v)},${c.y(INS(v))})`);
            }, easeInOut));
          }));
        }, 1100);
        cancel.push(() => clearTimeout(t1));
      };
      el.querySelector('#fv-play').addEventListener('click', () => ctx.play());
      ctx.stop = stop;
    },
    enter(el, ctx) { ctx.play?.(); },
    leave(el, ctx) { ctx.stop?.(); },
  },

  effort: {
    init(el, ctx) {
      const c = chart(el.querySelector('#ef-chart'), { x: [-0.1, 6], y: [0, 12.8], xTickValues: [0, 1, 2, 3, 4, 5, 6], yTickValues: [0, 4, 8, 12], xLabel: 'Volume exhaled (L)', yLabel: 'Expiratory flow (L/s)' });
      // maximal-effort envelope = lecture curve; lower efforts rise to a lower plateau, then merge onto the envelope
      const curve = (e) => d3.range(0, FVC + 0.0001, 0.02).map((v) => { const rise = e * 11.8 * (1 - Math.exp(-v / (0.14 + 0.25 * (1 - e)))); const env = EXP(v); const k = 6; const m = -Math.log(Math.exp(-k * rise) + Math.exp(-k * env)) / k; return [v, Math.max(0, Math.min(env, m))]; });
      const zoneI = c.area([[2.2, 0], [2.2, 12.8], [6, 12.8], [6, 0]], { color: 'var(--pink)', opacity: 0.07 });
      const zoneD = c.area([[0, 0], [0, 12.8], [1.4, 12.8], [1.4, 0]], { color: 'var(--blue)', opacity: 0.07 });
      void zoneI; void zoneD;
      c.text(c.x(0.7), c.ih - 18, 'Effort-dependent', { color: 'var(--blue)', anchor: 'middle', cls: '' }).style('font-size', '25px').style('font-weight', 750);
      c.text(c.x(4.1), c.ih - 18, 'Effort-independent', { color: 'var(--pink)', anchor: 'middle', cls: '' }).style('font-size', '25px').style('font-weight', 750);
      [0.4, 0.6, 0.8].forEach((e) => c.path(curve(e), { color: 'var(--text-3)', cls: 'line thin' }).style('opacity', 0.55));
      const env = c.path(curve(1), { color: 'var(--text-3)', cls: 'line thin' }).style('opacity', 0.55);
      void env;
      const main = c.path(curve(1), { color: 'var(--orange)', glow: true });
      const pk = c.dot(0, 0, { color: 'var(--blue)', r: 13 });
      const pkT = c.text(0, 0, '', { color: 'var(--blue)' });
      const range = el.querySelector('#ef-range'); rangeFill(range);
      const out = el.querySelector('#ef-out');
      let e = 1;
      ctx.loop((dt) => {
        e = damp(e, range.value / 100, 7, dt);
        const pts = curve(e);
        main.attr('d', c.line(d3.curveLinear)(pts));
        const top = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
        pk.attr('transform', `translate(${c.x(top[0])},${c.y(top[1])})`);
        pkT.attr('x', c.x(top[0]) + 26).attr('y', c.y(top[1]) - 18).text(`PEFR ${top[1].toFixed(1)} L/s`);
        out.textContent = e > 0.92 ? 'Maximal' : e > 0.6 ? 'Moderate' : 'Gentle';
      });
      ctx.draw = () => drawIn(main, 1400, 100);
    },
    enter(el, ctx) { ctx.draw?.(); },
  },
};
