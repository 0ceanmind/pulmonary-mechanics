import { clamp, lerp, damp, rangeFill, seg, monotone } from '../lib/util.js';
import { chart, drawIn } from '../lib/chart.js';

const d3 = window.d3;
// R_aw vs lung volume — points read from the lecture figure (slide 31)
const RAW = [[1.6, 4.0], [2.0, 3.0], [2.6, 2.0], [3.0, 1.6], [4.0, 1.05], [4.25, 0.95], [5.0, 0.8], [6.0, 0.65], [7.0, 0.55]];
const rawF = monotone(RAW);

const toneRadius = (t) => (t >= 0 ? 1 - 0.55 * t : 1 - 0.25 * t);

export default {
  poiseuille: {
    async init(el, ctx) {
      const $ = (s) => el.querySelector(s);
      const rr = $('#po-rr'), ll = $('#po-ll'), ee = $('#po-ee');
      [rr, ll, ee].forEach(rangeFill);
      const c = await ctx.mount3d('./three/airway.js', $('#pois-mount'), { mode: 'poiseuille' });
      ctx.c = c;
      const upd = () => {
        const r = rr.value / 100, L = ll.value / 100, eta = ee.value / 100;
        const R = (L * eta) / Math.pow(r, 4);
        $('#po-r').textContent = r.toFixed(2); $('#po-l').textContent = L.toFixed(2); $('#po-e').textContent = eta.toFixed(2);
        $('#po-R').textContent = R < 10 ? R.toFixed(1) : Math.round(R);
        $('#po-F').textContent = (1 / R).toFixed(2);
        c?.setRadius?.(r); c?.setLength?.(L); c?.setViscosity?.(eta);
      };
      [rr, ll, ee].forEach((i) => i.addEventListener('input', upd));
      upd();
      ctx.reset = () => { rr.value = 100; ll.value = 100; ee.value = 100; [rr, ll, ee].forEach((i) => i.dispatchEvent(new Event('input'))); };
    },
  },

  bronchomotor: {
    async init(el, ctx) {
      const c = await ctx.mount3d('./three/airway.js', el.querySelector('#bm-mount'), { mode: 'bronchomotor' });
      ctx.c = c;
      const chips = [...el.querySelectorAll('.bm-chip')];
      const rOut = el.querySelector('#bm-r'), ROut = el.querySelector('#bm-R');
      let locked = 0, shown = 0, target = 0;
      const set = (t) => { target = t; c?.setTone?.(t); };
      chips.forEach((ch) => {
        ch.addEventListener('mouseenter', () => set(+ch.dataset.t));
        ch.addEventListener('mouseleave', () => set(locked));
        ch.addEventListener('click', () => { locked = +ch.dataset.t; chips.forEach((x) => x.classList.toggle('on', x === ch && locked !== 0)); set(locked); });
      });
      ctx.loop((dt) => {
        shown = damp(shown, target, 5, dt);
        const r = toneRadius(shown), R = 1 / Math.pow(r, 4);
        rOut.textContent = '×' + r.toFixed(2);
        ROut.textContent = '×' + (R < 10 ? R.toFixed(1) : Math.round(R));
        rOut.style.color = shown > 0.05 ? 'var(--red)' : shown < -0.05 ? 'var(--green)' : 'var(--text)';
      });
      ctx.reset = () => { locked = 0; chips.forEach((x) => x.classList.remove('on')); set(0); };
    },
    enter(el, ctx) { ctx.reset?.(); },
  },

  traction: {
    async init(el, ctx) {
      const $ = (s) => el.querySelector(s);
      const ch = chart($('#tr-chart'), { x: [0, 7.5], y: [0, 4.4], xTickValues: [0, 2, 4, 6], yTickValues: [0, 1, 2, 3, 4], xLabel: 'Lung volume (L)', yLabel: 'R<tspan baseline-shift="sub" font-size="70%">aw</tspan> (cm H₂O·L⁻¹·s)', m: { l: 100, r: 24, t: 20, b: 92 } });
      const p = ch.path(d3.range(1.6, 7.0001, 0.02).map((v) => [v, rawF(v)]), { color: 'var(--yellow)', glow: true });
      RAW.forEach(([x, y]) => ch.plot.append('circle').attr('cx', ch.x(x)).attr('cy', ch.y(y)).attr('r', 9).style('fill', 'var(--bg)').style('stroke', 'var(--yellow)').style('stroke-width', 4));
      ch.vline(4, { color: 'var(--text-3)' });
      ch.text(ch.x(4) + 10, ch.y(0) - 14, 'FRC', { color: 'var(--text-3)', cls: '' }).style('font-size', '22px');
      const dot = ch.dot(0, 0, { color: 'var(--yellow)', r: 14 });
      const emph = ch.over.append('g').style('opacity', 0);
      emph.append('text').attr('x', ch.iw - 4).attr('y', 40).attr('text-anchor', 'end').attr('class', 'lbl').style('fill', 'var(--red)').text('Loss of traction → ↑ R');
      emph.append('text').attr('x', ch.iw - 4).attr('y', 76).attr('text-anchor', 'end').style('fill', 'var(--text-3)').style('font-size', '22px').text('(qualitative)');
      const range = $('#tr-range'); rangeFill(range);
      const out = $('#tr-out');
      const c = await ctx.mount3d('./three/airway.js', $('#tr-mount'), { mode: 'traction' });
      ctx.c = c;
      let f = 0.45, k = 1;
      seg($('#tr-seg'), (b) => { k = +b.dataset.k; c?.setRecoil?.(k); emph.transition().duration(400).style('opacity', k < 1 ? 1 : 0); dot.transition().duration(400).style('opacity', k < 1 ? 0.25 : 1); });
      ctx.loop((dt) => {
        f = damp(f, range.value / 100, 8, dt);
        const V = lerp(1.6, 7, f);
        dot.attr('transform', `translate(${ch.x(V)},${ch.y(rawF(V))})`);
        out.textContent = `${V.toFixed(1)} L`;
        c?.setLungVolume?.(f);
      });
      ctx.draw = () => drawIn(p, 1400, 200);
    },
    enter(el, ctx) { ctx.draw?.(); },
  },

  turbulence: {
    async init(el, ctx) {
      const $ = (s) => el.querySelector(s);
      const c = await ctx.mount3d('./three/airway.js', $('#tb-mount'), { mode: 'turbulence' });
      ctx.c = c;
      const st = { regime: 'turbulent', gas: 'air' };
      const read = () => {
        const base = { laminar: 1, transitional: 1.5, turbulent: 2.5 }[st.regime];
        const R = st.gas === 'heliox' ? 1 + (base - 1) * 0.5 : base;
        $('#tb-R').textContent = R.toFixed(st.gas === 'heliox' ? 2 : 1);
      };
      seg($('#tb-reg'), (b) => { st.regime = b.dataset.r; c?.setRegime?.(st.regime); read(); });
      seg($('#tb-gas'), (b) => { st.gas = b.dataset.g; c?.setGas?.(st.gas); read(); });
      c?.setRegime?.('turbulent'); c?.setGas?.('air');
      read();
    },
  },
};
