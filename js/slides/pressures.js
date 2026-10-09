import { svg, clamp, lerp, fmt, monotone, damp, rangeFill, seg, tween, easeInOut } from '../lib/util.js';
import { designUnit, drawIn } from '../lib/chart.js';
import { thorax } from '../lib/shared3d.js';

const d3 = window.d3;
const TAU = Math.PI * 2;

// Lecture values (slides 7–8): P_A in mm Hg, P_pl in cm H2O, tidal volume 0.5 L over a 4 s breath
const PA = (t) => -Math.sin((TAU * t) / 4);
const PPL = monotone([[0, -2.5], [1, -5], [2, -6], [3, -3], [4, -2.5]]);
const VT = (t) => 0.25 * (1 - Math.cos((TAU * t) / 4));
const CHIP = {
  0: { phase: 'Resting', pa: '0', ppl: '−2.5', v: 'FRC', vt: 'V<sub>T</sub> = 0' },
  1: { phase: 'During inspiration', pa: '−1', ppl: '−5', v: '> FRC', vt: 'V<sub>T</sub> increasing' },
  2: { phase: 'End of inspiration', pa: '0', ppl: '−6', v: 'FRC + V<sub>T</sub>', vt: 'V<sub>T</sub> at peak' },
  3: { phase: 'During quiet expiration', pa: '+1', ppl: '−3', v: 'Falling', vt: 'Lung volume decreasing' },
};

/* ---------------- breathing-cycle chart ---------------- */
function cycleChart(container) {
  const u = designUnit();
  const W = container.clientWidth / u, H = container.clientHeight / u;
  const m = { l: 250, r: 40, t: 70, b: 80 }, gap = 34;
  const iw = W - m.l - m.r, ph = (H - m.t - m.b - gap * 2) / 3;
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleLinear().domain([0, 4]).range([0, iw]);
  const g = root.append('g').attr('transform', `translate(${m.l},${m.t})`);
  // phase bands
  const bandH = ph * 3 + gap * 2;
  g.append('rect').attr('x', 0).attr('y', -8).attr('width', x(2)).attr('height', bandH + 8).style('fill', 'var(--blue)').style('opacity', 0.07).attr('rx', 14);
  g.append('rect').attr('x', x(2)).attr('y', -8).attr('width', x(4) - x(2)).attr('height', bandH + 8).style('fill', 'var(--orange)').style('opacity', 0.07).attr('rx', 14);
  g.append('text').attr('x', x(1)).attr('y', -26).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', 'var(--blue)').text('Inspiration');
  g.append('text').attr('x', x(3)).attr('y', -26).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', 'var(--orange)').text('Expiration');

  const panels = [
    { key: 'pa', f: PA, dom: [-1.6, 1.6], ticks: [-1, 0, 1], color: 'var(--pink)', name: 'Alveolar P', unit: 'mm Hg', zero: true },
    { key: 'ppl', f: PPL, dom: [-7, -1.5], ticks: [-6, -4, -2], color: 'var(--green)', name: 'Pleural P', unit: 'cm H₂O' },
    { key: 'v', f: VT, dom: [-0.04, 0.6], ticks: [0, 0.25, 0.5], color: 'var(--cyan)', name: 'Volume', unit: 'L' },
  ];
  const data = (f) => d3.range(0, 4.0001, 0.02).map((t) => [t, f(t)]);
  panels.forEach((p, i) => {
    const pg = g.append('g').attr('transform', `translate(0,${i * (ph + gap)})`);
    const y = d3.scaleLinear().domain(p.dom).range([ph, 0]);
    p.y = y; p.g = pg;
    pg.append('g').attr('class', 'grid').call(d3.axisLeft(y).tickValues(p.ticks).tickSize(-iw).tickFormat(''));
    pg.append('g').attr('class', 'axis').call(d3.axisLeft(y).tickValues(p.ticks).tickSizeOuter(0).tickPadding(12).tickFormat(d3.format('~g')));
    if (p.zero) pg.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--text-3)').style('stroke-width', 2.5).style('stroke-dasharray', '8 10');
    pg.append('text').attr('x', -236).attr('y', ph / 2 - 4).attr('class', 'lbl').style('fill', p.color).style('font-size', '27px').text(p.name);
    pg.append('text').attr('x', -236).attr('y', ph / 2 + 28).style('font-size', '22px').style('fill', 'var(--text-3)').text(p.unit);
    p.path = pg.append('path').attr('class', 'line glow').style('stroke', p.color).style('color', p.color)
      .attr('d', d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveCatmullRom)(data(p.f)));
    p.dot = pg.append('circle').attr('r', 13).style('fill', p.color).style('stroke', 'var(--bg)').style('stroke-width', 5);
  });
  const xa = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${bandH})`).call(d3.axisBottom(x).ticks(4).tickSizeOuter(0).tickPadding(12));
  void xa;
  root.append('text').attr('class', 'ax-title').attr('x', m.l + iw / 2).attr('y', H - 14).attr('text-anchor', 'middle').text('Time (s)');
  const head = g.append('line').attr('y1', -8).attr('y2', bandH).style('stroke', 'var(--text)').style('stroke-width', 3).style('opacity', 0.7);
  const marks = g.append('g');
  [0, 1, 2, 3].forEach((t) => marks.append('text').attr('x', x(t)).attr('y', bandH + 66).attr('text-anchor', 'middle').style('font-size', '0px').text(''));
  return {
    set(t) {
      head.attr('x1', x(t)).attr('x2', x(t));
      panels.forEach((p) => p.dot.attr('cx', x(t)).attr('cy', p.y(p.f(t))));
    },
    draw() { panels.forEach((p, i) => drawIn(p.path, 1600, 150 + i * 220)); },
  };
}

/* ---------------- transmural diagram ---------------- */
const TM = [
  { name: 'Pre-inspiration', ppl: -5, pa: 0, paw: 0, tm: 5, r: 92, k: 0 },
  { name: 'During inspiration', ppl: -7, pa: -2, paw: -1, tm: 6, r: 104, k: 0 },
  { name: 'End-inspiration', ppl: -8, pa: 0, paw: 0, tm: 8, r: 114, k: 0 },
  { name: 'Forced expiration', ppl: 30, pa: 38, paw: 19, tm: -11, r: 86, k: 1 },
];
function transmural(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 1100 720').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  const thor = svg('path', { d: 'M150 90 C470 90 690 230 730 360 C690 490 470 630 150 630 C70 520 70 200 150 90 Z', fill: 'color-mix(in srgb, var(--green) 9%, transparent)', stroke: 'var(--text-2)', 'stroke-width': 5 }, s);
  void thor;
  const air = svg('path', { fill: 'color-mix(in srgb, var(--blue) 16%, var(--bg))', stroke: 'var(--text)', 'stroke-width': 5, 'stroke-linejoin': 'round' }, s);
  const alv = svg('circle', { cx: 300, cy: 360, fill: 'color-mix(in srgb, var(--blue) 16%, var(--bg))', stroke: 'var(--text)', 'stroke-width': 5 }, s);
  const T = (x, y, cls, size = 54, color = 'var(--text)') => { const e = svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle', style: `font: 750 ${size}px var(--font); fill: ${color}; font-variant-numeric: tabular-nums` }, s); return e; };
  const tPpl = T(250, 170, '', 58, 'var(--green)');
  const tPplL = T(250, 220, '', 24, 'var(--text-3)'); tPplL.textContent = 'pleural';
  const tPa = T(300, 360, '', 52);
  const tPaw = T(560, 448, '', 40);
  const tPawL = T(560, 490, '', 22, 'var(--text-3)'); tPawL.textContent = 'airway';
  const tMouth = T(1010, 360, '', 40, 'var(--text-2)'); tMouth.textContent = '0';
  const tMouthL = T(1010, 410, '', 22, 'var(--text-3)'); tMouthL.textContent = 'mouth';
  const lead = svg('path', { fill: 'none', stroke: 'var(--yellow)', 'stroke-width': 4, 'stroke-dasharray': '10 10' }, s);
  const arrow = svg('path', { fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s);
  const bub = svg('circle', { cx: 820, cy: 150, r: 74, fill: 'var(--bg)', 'stroke-width': 6 }, s);
  const tTm = T(820, 152, '', 56);
  const tTmL = T(820, 250, '', 24, 'var(--text-3)'); tTmL.textContent = 'transmural';
  const tName = T(550, 690, '', 34, 'var(--text-2)');
  const st = { ppl: -5, pa: 0, paw: 0, tm: 5, r: 92, k: 0 };
  function render() {
    const k = st.k, r = st.r;
    // airway top/bottom edges with optional compression bump between x 470–650
    const top = (x) => 330 + (x > 470 && x < 650 ? k * 26 * Math.sin(((x - 470) / 180) * Math.PI) : 0);
    const pts = d3.range(300, 961, 10);
    const up = pts.map((x) => [x, top(x)]), dn = pts.map((x) => [x, 720 - top(x)]).reverse();
    air.setAttribute('d', d3.line().curve(d3.curveCatmullRom)(up) + 'L' + d3.line().curve(d3.curveCatmullRom)(dn).slice(1) + 'Z');
    alv.setAttribute('r', r);
    tPpl.textContent = (st.ppl > 0 ? '+' : '') + fmt(st.ppl, 0);
    tPa.textContent = (st.pa > 0 ? '+' : '') + fmt(st.pa, 0);
    tPaw.textContent = (st.paw > 0 ? '+' : '') + fmt(st.paw, 0);
    tTm.textContent = (st.tm > 0 ? '+' : '') + fmt(st.tm, 0);
    const pos = st.tm >= 0, col = pos ? 'var(--green)' : 'var(--red)';
    bub.setAttribute('stroke', col); tTm.style.fill = col;
    const wx = 560, wy = top(wx);
    arrow.setAttribute('stroke', col);
    arrow.setAttribute('d', pos ? `M${wx} ${wy + 40} V${wy - 46} M${wx - 16} ${wy - 28} L${wx} ${wy - 48} L${wx + 16} ${wy - 28}` : `M${wx} ${wy - 86} V${wy - 6} M${wx - 16} ${wy - 24} L${wx} ${wy - 4} L${wx + 16} ${wy - 24}`);
    lead.setAttribute('d', `M${wx + 10} ${wy - 60} L760 190`);
  }
  let cancel = null;
  return {
    go(i) {
      const to = TM[i], from = { ...st };
      tName.textContent = to.name;
      cancel?.();
      cancel = tween(0, 1, 1.1, (p) => {
        ['ppl', 'pa', 'paw', 'tm', 'r', 'k'].forEach((key) => (st[key] = lerp(from[key], to[key], p)));
        render();
      }, easeInOut);
    },
    render,
  };
}

/* ---------------- four factor pictograms ---------------- */
function factor(kind, box) {
  const s = svg('svg', { viewBox: '0 0 300 260' }, box);
  if (kind === 'size') {
    const c1 = svg('circle', { cx: 150, cy: 130, fill: 'none', stroke: 'var(--c)', 'stroke-width': 6 }, s);
    const c2 = svg('circle', { cx: 150, cy: 130, fill: 'var(--c)', opacity: 0.16 }, s);
    const t = svg('text', { x: 150, y: 142, 'text-anchor': 'middle', style: 'font: 800 40px var(--font); fill: var(--c)' }, s); t.textContent = 'V';
    return (time) => { const r = 62 + 26 * (0.5 - 0.5 * Math.cos(time * 1.6)); c1.setAttribute('r', r); c2.setAttribute('r', r); };
  }
  if (kind === 'comp') {
    const b = svg('path', { fill: 'color-mix(in srgb, var(--c) 22%, transparent)', stroke: 'var(--c)', 'stroke-width': 6 }, s);
    svg('path', { d: 'M150 236 V214', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
    return (time) => { const k = 0.5 - 0.5 * Math.cos(time * 1.6), r = 46 + 50 * k; b.setAttribute('d', `M150 214 C${150 - r * 1.25} ${214 - r * 0.6} ${150 - r} ${214 - r * 2.1} 150 ${214 - r * 2.1} C${150 + r} ${214 - r * 2.1} ${150 + r * 1.25} ${214 - r * 0.6} 150 214 Z`); };
  }
  if (kind === 'elast') {
    const sp = svg('path', { fill: 'none', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
    svg('path', { d: 'M40 40 H260', stroke: 'var(--text-3)', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
    const w = svg('rect', { width: 90, height: 36, rx: 10, fill: 'var(--c)' }, s);
    return (time) => {
      const ph = (time * 0.55) % 1; // stretch slowly, recoil fast
      const k = ph < 0.7 ? easeInOut(ph / 0.7) : 1 - Math.pow((ph - 0.7) / 0.3, 0.35);
      const L = 70 + 110 * k, n = 9;
      let d = 'M150 40';
      for (let i = 1; i <= n; i++) d += ` L${150 + (i % 2 ? 30 : -30)} ${40 + (L * i) / (n + 1)}`;
      d += ` L150 ${40 + L}`;
      sp.setAttribute('d', d);
      w.setAttribute('x', 105); w.setAttribute('y', 40 + L);
    };
  }
  // resistance
  svg('path', { d: 'M20 80 H110 C140 80 140 112 170 112 H190 C220 112 220 80 250 80 H280 M20 180 H110 C140 180 140 148 170 148 H190 C220 148 220 180 250 180 H280', fill: 'none', stroke: 'var(--c)', 'stroke-width': 6, 'stroke-linecap': 'round' }, s);
  const ps = Array.from({ length: 12 }, () => ({ el: svg('circle', { r: 6, fill: 'var(--c)' }, s), x: 20 + Math.random() * 260, lane: Math.random() * 2 - 1 }));
  let last = 0;
  return (time) => {
    const dt = Math.min(0.05, time - last); last = time;
    ps.forEach((p) => {
      const h = p.x > 120 && p.x < 240 ? 20 : 46;
      p.x += (h === 20 ? 150 : 70) * dt;
      if (p.x > 280) { p.x = 20; p.lane = Math.random() * 2 - 1; }
      p.el.setAttribute('cx', p.x); p.el.setAttribute('cy', 130 + p.lane * (h - 10));
    });
  };
}

/* ---------------- slides ---------------- */
export default {
  pressures: {
    async init(el, ctx) {
      const slot = el.querySelector('.thorax-slot');
      const cp = thorax(ctx, slot);
      const items = [...el.querySelectorAll('.plist li')];
      const hot = (k) => { items.forEach((li) => li.classList.toggle('hot', li.dataset.k === k)); pins.forEach((p, i) => p.classList.toggle('hot', defs[i].name === k)); cp.then((c) => c?.highlight?.(k)); };
      const defs = [
        { name: 'pao', html: 'P<sub>ao</sub>', color: 'var(--blue)', pop: 'p-pao', dx: 0, dy: -10 },
        { name: 'ppl', html: 'P<sub>pl</sub>', color: 'var(--green)', pop: 'p-ppl', dx: 10, dy: -64 },
        { name: 'pa', html: 'P<sub>A</sub>', color: 'var(--pink)', pop: 'p-pa' },
        { name: 'pbs', html: 'P<sub>bs</sub>', color: 'var(--purple)', pop: 'p-pbs', dx: -40, dy: 70 },
      ];
      defs.forEach((d) => { d.onEnter = () => hot(d.name); d.onLeave = () => hot(null); });
      const pins = ctx.pins(el.querySelector('.pin-layer'), cp, defs);
      items.forEach((li) => { li.addEventListener('mouseenter', () => hot(li.dataset.k)); li.addEventListener('mouseleave', () => hot(null)); });
      ctx.cp = cp;
    },
    enter(el, ctx) {
      ctx.cp?.then((c) => { if (!c) return; c.setPneumothorax?.(false); c.setDisease?.('normal'); c.setAutoBreath?.(true, 4); c.setAirflow?.(false); c.highlight?.(null); });
    },
  },

  'air-movement': {
    async init(el, ctx) {
      const cp = thorax(ctx, el.querySelector('.thorax-slot'));
      ctx.cp = cp;
      const rules = [...el.querySelectorAll('.rule')];
      const out = el.querySelector('#am-pa'), fill = el.querySelector('#am-fill');
      let shown = 0;
      ctx.loop((dt) => {
        cp.then((c) => {
          if (!c) return;
          const t = c.__last?.t ?? 0;
          const pa = PA(t % 4);
          shown = damp(shown, pa, 18, dt);
          out.textContent = (shown > 0.05 ? '+' : '') + fmt(shown, 1);
          const w = Math.abs(shown) * 50;
          fill.style.width = w + '%';
          fill.style.left = shown < 0 ? 50 - w + '%' : '50%';
          fill.style.background = Math.abs(shown) < 0.12 ? 'var(--red)' : shown < 0 ? 'var(--blue)' : 'var(--green)';
          const r = Math.abs(pa) < 0.12 ? 0 : pa < 0 ? 1 : 2;
          rules.forEach((b, i) => b.classList.toggle('live', i === r));
        });
      });
    },
    enter(el, ctx) {
      ctx.cp?.then((c) => { if (!c) return; c.setPneumothorax?.(false); c.setDisease?.('normal'); c.setAutoBreath?.(true, 4); c.setAirflow?.(true); c.highlight?.(null); });
    },
    leave(el, ctx) { ctx.cp?.then((c) => c?.highlight?.(null)); },
  },

  'breathing-cycle': {
    init(el, ctx) {
      const ch = cycleChart(el.querySelector('#cy-chart'));
      ctx.ch = ch;
      const st = (ctx.st = { t: 0, live: true });
      const $ = (id) => el.querySelector(id);
      const show = (t, chip) => {
        ch.set(t);
        if (chip != null) {
          const c = CHIP[chip];
          $('#cy-phase').textContent = c.phase;
          $('#cy-pa').textContent = c.pa; $('#cy-ppl').textContent = c.ppl;
          $('#cy-v').innerHTML = c.v; $('#cy-vt').innerHTML = c.vt;
          return;
        }
        const pa = PA(t), ppl = PPL(t), v = VT(t);
        $('#cy-phase').textContent = t < 0.12 || t > 3.92 ? 'Resting' : Math.abs(t - 2) < 0.1 ? 'End of inspiration' : t < 2 ? 'Inspiration' : 'Quiet expiration';
        $('#cy-pa').textContent = (pa > 0.05 ? '+' : '') + fmt(pa, 1);
        $('#cy-ppl').textContent = fmt(ppl, 1);
        $('#cy-v').innerHTML = v < 0.005 ? 'FRC' : `+${v.toFixed(2)}`;
        $('#cy-vt').innerHTML = v < 0.005 ? 'V<sub>T</sub> = 0' : t < 2 ? 'L · rising' : 'L · falling';
      };
      ctx.show = show;
      seg(el.querySelector('#cy-seg'), (b) => {
        if (b.dataset.t === 'play') { st.live = true; return; }
        st.live = false;
        const target = +b.dataset.t, from = st.t;
        tween(from, target + (target < from - 2 ? 4 : 0), 0.7, (v) => { st.t = v % 4; show(st.t, null); }, easeInOut, () => { st.t = target; show(target, target); });
      });
      ctx.loop((dt) => { if (st.live) { st.t = (st.t + dt) % 4; show(st.t, null); } });
    },
    enter(el, ctx) { ctx.ch.draw(); },
  },

  transmural: {
    init(el, ctx) {
      const tm = transmural(el.querySelector('#tm-mount'));
      ctx.tm = tm;
      tm.render();
      seg(el.querySelector('#tm-seg'), (b) => tm.go(+b.dataset.i));
      tm.go(0);
    },
  },

  'four-factors': {
    init(el, ctx) {
      const fns = [...el.querySelectorAll('.f-viz')].map((b) => factor(b.dataset.anim, b));
      let time = 0;
      ctx.loop((dt) => { time += dt; fns.forEach((f) => f(time)); });
    },
  },

  'size-boyle': {
    async init(el, ctx) {
      const range = el.querySelector('#by-range');
      const upd = rangeFill(range);
      const c = await ctx.mount3d('./three/boyle.js', el.querySelector('#boyle-mount'));
      ctx.c = c;
      const $ = (id) => el.querySelector(id);
      const show = ({ V, P }) => { $('#by-v').textContent = V.toFixed(2); $('#by-p').textContent = P.toFixed(2); $('#by-pv').textContent = (P * V).toFixed(2); };
      show({ V: 1, P: 1 });
      if (!c) return;
      let dragging = false;
      range.addEventListener('pointerdown', () => (dragging = true));
      window.addEventListener('pointerup', () => (dragging = false));
      c.onState?.((s) => { show(s); if (!dragging) { range.value = Math.round(s.V * 100); upd(); } });
      range.addEventListener('input', () => c.setVolume(range.value / 100));
    },
  },
};
