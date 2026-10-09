import { clamp, lerp, seg, tween, easeInOut, html } from '../lib/util.js';
import { flips } from '../lib/util.js';
import { chart } from '../lib/chart.js';
import { hero } from '../lib/shared3d.js';

const d3 = window.d3;

// Representative spirometry (textbook example: Costanzo, Physiology — FEV1/FVC normal 0.80, obstructive 0.42, restrictive 0.90)
const PAT = {
  norm: { name: 'Normal', c: 'var(--green)', FEV1: 4.0, FVC: 5.0, TLC: 6.0, peak: 10 },
  obs: { name: 'Obstructive', c: 'var(--orange)', FEV1: 1.3, FVC: 3.1, TLC: 7.2, peak: 4.2 },
  res: { name: 'Restrictive', c: 'var(--purple)', FEV1: 2.8, FVC: 3.1, TLC: 4.0, peak: 8.2 },
};
const tau = (p) => -1 / Math.log(1 - p.FEV1 / p.FVC);
const vt = (p) => d3.range(0, 6.0001, 0.04).map((t) => [t, p.FVC * (1 - Math.exp(-t / tau(p)))]);
// flow–volume loop on an absolute lung-volume axis (TLC on the left, RV on the right)
function fvLoop(p, key) {
  const RV = p.TLC - p.FVC, pts = [];
  const scoop = key === 'obs' ? 2.1 : key === 'res' ? 0.95 : 1.15;
  for (let x = 0; x <= 1.0001; x += 0.01) {
    const rise = 1 - Math.exp(-x / 0.035);
    const fall = Math.pow(Math.max(0, 1 - (x - 0.08) / 0.92), scoop);
    const f = x < 0.08 ? p.peak * rise * (0.92 + x) : p.peak * fall;
    pts.push([p.TLC - x * p.FVC, Math.max(0, f)]);
  }
  const insPk = key === 'obs' ? -4.6 : key === 'res' ? -5.6 : -6.5;
  for (let x = 0.99; x >= -0.0001; x -= 0.01) pts.push([p.TLC - x * p.FVC, insPk * Math.pow(Math.max(0, Math.sin(Math.PI * x)), 0.7)]);
  void RV;
  return pts;
}

function bars(container, kind) {
  const N = { TLC: 5.8, FRC: 2.3, RV: 1.2 };
  const D = kind === 'fib' ? { TLC: 5.0, FRC: 1.45, RV: 1.2 } : { TLC: 6.4, FRC: 3.7, RV: 2.5 };
  const lab = kind === 'fib' ? { TLC: 'small ↓', FRC: 'large ↓', RV: 'unaffected' } : { TLC: 'small ↑', FRC: 'large ↑', RV: '↑' };
  const col = kind === 'fib' ? 'var(--purple)' : 'var(--orange)';
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 560 760').attr('preserveAspectRatio', 'xMidYMid meet');
  const y = d3.scaleLinear().domain([0, 7]).range([640, 60]);
  const keys = ['TLC', 'FRC', 'RV'];
  const g = root.append('g');
  root.append('text').attr('x', 280).attr('y', 30).attr('text-anchor', 'middle').style('font-size', '23px').style('fill', 'var(--text-3)').style('font-weight', 650)
    .html(`<tspan fill="var(--text-2)">▢ normal</tspan>   <tspan fill="${col}">■ ${kind === 'fib' ? 'fibrosis' : 'emphysema'}</tspan>`);
  const parts = keys.map((k, i) => {
    const x = 50 + i * 170, w = 120;
    const ghost = g.append('rect').attr('x', x).attr('width', w).attr('y', y(N[k])).attr('height', y(0) - y(N[k])).attr('rx', 18).style('fill', 'none').style('stroke', 'var(--text-3)').style('stroke-width', 4).style('stroke-dasharray', '10 9');
    const bar = g.append('rect').attr('x', x + 14).attr('width', w - 28).attr('y', y(0)).attr('height', 0).attr('rx', 14).style('fill', col).style('opacity', 0.85);
    g.append('text').attr('x', x + w / 2).attr('y', 690).attr('text-anchor', 'middle').attr('class', 'lbl').style('font-size', '34px').style('fill', 'var(--text)').text(k);
    const t = g.append('text').attr('x', x + w / 2).attr('y', 732).attr('text-anchor', 'middle').style('font-size', '25px').style('font-weight', 750).style('fill', col).text(lab[k]);
    void ghost;
    return { k, bar, t };
  });
  return () => parts.forEach((p, i) => p.bar.interrupt().attr('y', y(N[p.k])).attr('height', y(0) - y(N[p.k])).transition().delay(500 + i * 180).duration(1300).ease(d3.easeCubicInOut).attr('y', y(D[p.k])).attr('height', y(0) - y(D[p.k])));
}

export default {
  'obstructive-restrictive': {
    init(el, ctx) {
      const a = chart(el.querySelector('#or-vt'), { x: [0, 6], y: [0, 5.6], xTickValues: [0, 1, 2, 3, 4, 5, 6], yTickValues: [0, 1, 2, 3, 4, 5], xLabel: 'Time (s)', yLabel: 'Volume exhaled (L)', m: { l: 96, r: 20, t: 16, b: 88 } });
      a.vline(1, { color: 'var(--cyan)' });
      a.text(a.x(1) + 8, 30, '1 s', { color: 'var(--cyan)', cls: '' }).style('font-size', '22px').style('font-weight', 700);
      const ghostA = a.path(vt(PAT.norm), { color: 'var(--text-3)', cls: 'line thin dash' }).style('opacity', 0);
      const pa = a.path(vt(PAT.norm), { color: PAT.norm.c, glow: true });
      const fevDot = a.dot(0, 0, { color: 'var(--cyan)', r: 11 });
      const b = chart(el.querySelector('#or-fv'), { x: [8, 0], y: [-7.5, 11], xTickValues: [8, 6, 4, 2, 0], yTickValues: [-6, -3, 0, 3, 6, 9], xAxisAt: 0, xLabel: 'Lung volume (L)  ·  TLC ← → RV', yLabel: 'Flow (L/s)', m: { l: 96, r: 20, t: 16, b: 88 } });
      const ghostB = b.path(fvLoop(PAT.norm, 'norm'), { color: 'var(--text-3)', cls: 'line thin dash' }).style('opacity', 0);
      const pb = b.path(fvLoop(PAT.norm, 'norm'), { color: PAT.norm.c, glow: true });
      const read = el.querySelector('#or-read');
      const R = (k, v, c2) => `<div class="readout"><div class="k">${k}</div><div class="v" style="color:${c2}">${v}</div></div>`;
      const cards = [...el.querySelectorAll('.or-card')];
      const s = seg(el.querySelector('#or-seg'), (btn) => {
        const k = btn.dataset.m, p = PAT[k];
        cards.forEach((cd) => cd.classList.toggle('on', cd.dataset.m === k));
        ghostA.transition().duration(400).style('opacity', k === 'norm' ? 0 : 0.6);
        ghostB.transition().duration(400).style('opacity', k === 'norm' ? 0 : 0.6);
        a.update(pa.style('stroke', p.c).style('color', p.c), vt(p), { dur: 900 });
        b.update(pb.style('stroke', p.c).style('color', p.c), fvLoop(p, k), { dur: 900 });
        fevDot.transition().duration(900).attr('transform', `translate(${a.x(1)},${a.y(p.FEV1)})`);
        const ratio = p.FEV1 / p.FVC;
        read.innerHTML = R('FEV₁', `${p.FEV1.toFixed(1)}<small>L</small>`, 'var(--cyan)') + R('FVC', `${p.FVC.toFixed(1)}<small>L</small>`, 'var(--green)') + R('FEV₁ / FVC', `${Math.round(ratio * 100)}<small>%</small>`, ratio < 0.7 ? 'var(--orange)' : 'var(--text)');
      });
      cards.forEach((cd) => cd.addEventListener('click', () => s.set((x) => x.dataset.m === cd.dataset.m)));
      fevDot.attr('transform', `translate(${a.x(1)},${a.y(PAT.norm.FEV1)})`);
      ctx.reset = () => s.set((x) => x.dataset.m === 'norm');
      const note = html('div', { style: 'position:absolute;right:0;bottom:calc(var(--px)*-34);font-size:calc(var(--px)*19);color:var(--text-3)' }, el.querySelector('.or-vis'), 'Representative textbook values');
      void note;
    },
    enter(el, ctx) { ctx.reset?.(); },
  },

  fibrosis: {
    async init(el, ctx) {
      ctx.bars = bars(el.querySelector('#fib-bars'), 'fib');
      ctx.c = await hero(ctx, el.querySelector('.dz-slot'));
    },
    enter(el, ctx) {
      ctx.bars?.();
      const c = ctx.c; if (!c) return;
      c.setAirflow?.(false); c.highlight?.(null); c.setAutoBreath?.(true, 4);
      c.setDisease?.('normal');
      clearTimeout(ctx.t); ctx.t = setTimeout(() => c.setDisease?.('fibrosis'), 700);
    },
    leave(el, ctx) { clearTimeout(ctx.t); },
  },

  emphysema: {
    async init(el, ctx) {
      ctx.bars = bars(el.querySelector('#emp-bars'), 'emp');
      ctx.c = await hero(ctx, el.querySelector('.dz-slot'));
    },
    enter(el, ctx) {
      ctx.bars?.();
      const c = ctx.c; if (!c) return;
      c.setAirflow?.(false); c.highlight?.(null); c.setAutoBreath?.(true, 4);
      c.setDisease?.('normal');
      clearTimeout(ctx.t); ctx.t = setTimeout(() => c.setDisease?.('emphysema'), 700);
    },
    leave(el, ctx) { clearTimeout(ctx.t); },
  },

  clinical: {
    init(el) { flips(el); },
    leave(el) { el.querySelectorAll('.flip').forEach((f) => f.classList.remove('open')); },
  },
};
