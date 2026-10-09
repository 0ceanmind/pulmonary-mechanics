import { svg, clamp, lerp, damp, seg, easeInOut, easeOut } from '../lib/util.js';

const d3 = window.d3;
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- alveolar wall: type II cell secreting surfactant ---------- */
function alveolarWall(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 1150 640').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  const SURF = 250; // y of the air–fluid interface
  // air
  const airT = svg('text', { x: 40, y: 70, style: 'font:700 28px var(--font);fill:var(--text-3);letter-spacing:.08em' }, s); airT.textContent = 'ALVEOLAR AIR';
  // fluid lining
  svg('path', { d: `M0 ${SURF} Q 290 ${SURF - 14} 575 ${SURF} T 1150 ${SURF} V 330 H 0 Z`, fill: 'color-mix(in srgb, var(--blue) 22%, transparent)' }, s);
  // type I cells (thin, flat)
  svg('path', { d: 'M0 330 H360 Q 390 330 400 352 L 400 372 H0 Z', fill: 'color-mix(in srgb, var(--tissue) 30%, transparent)', stroke: 'var(--tissue)', 'stroke-width': 3 }, s);
  svg('path', { d: 'M1150 330 H760 Q 730 330 720 352 L 720 372 H1150 Z', fill: 'color-mix(in srgb, var(--tissue) 30%, transparent)', stroke: 'var(--tissue)', 'stroke-width': 3 }, s);
  // type II cell (cuboidal dome with microvilli)
  svg('path', { d: 'M400 600 V 372 Q 400 320 450 318 H 670 Q 720 320 720 372 V 600 Z', fill: 'color-mix(in srgb, var(--tissue) 18%, var(--bg))', stroke: 'var(--tissue)', 'stroke-width': 4 }, s);
  for (let x = 430; x <= 690; x += 22) svg('path', { d: `M${x} 320 V 300`, stroke: 'var(--tissue)', 'stroke-width': 5, 'stroke-linecap': 'round' }, s);
  svg('ellipse', { cx: 520, cy: 520, rx: 62, ry: 44, fill: 'color-mix(in srgb, var(--purple) 30%, transparent)', stroke: 'var(--purple)', 'stroke-width': 3 }, s);
  const nT = svg('text', { x: 520, y: 528, 'text-anchor': 'middle', style: 'font:700 22px var(--font);fill:var(--text-2)' }, s); nT.textContent = 'N';
  // golgi stacks
  for (let i = 0; i < 4; i++) svg('path', { d: `M612 ${470 + i * 13} q 30 -10 60 0`, fill: 'none', stroke: 'var(--orange)', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8 }, s);
  // macrophage in the fluid (right)
  const mac = svg('path', { fill: 'color-mix(in srgb, var(--yellow) 20%, transparent)', stroke: 'var(--yellow)', 'stroke-width': 4 }, s);
  // labels
  const L = (x, y, t, c = 'var(--text-2)', anchor = 'start') => { const e = svg('text', { x, y, 'text-anchor': anchor, style: `font:700 26px var(--font);fill:${c}` }, s); e.textContent = t; return e; };
  L(560, 628, 'Type II pneumocyte', 'var(--tissue)', 'middle');
  L(40, 404, 'Type I cell', 'var(--text-3)');
  L(910, 210, 'Macrophage', 'var(--yellow)', 'middle');
  L(40, SURF - 50, 'Monolayer', 'var(--cyan)');
  const lbT = L(760, 470, 'Lamellar body', 'var(--orange)');
  svg('path', { d: 'M755 462 L700 440', stroke: 'var(--orange)', 'stroke-width': 3 }, s);
  void lbT;

  // monolayer slots
  const slots = [];
  for (let x = 30; x <= 1120; x += 26) slots.push({ x, y: SURF - 4 + 6 * Math.sin(x / 90), m: null });
  const layer = svg('g', {}, s), bodies = svg('g', {}, s);
  const mkMol = () => {
    const g = svg('g', {}, layer);
    svg('path', { d: 'M-3 0 q -3 -14 0 -26 M3 0 q 3 -14 0 -26', fill: 'none', stroke: 'var(--cyan)', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
    svg('circle', { r: 7, fill: 'var(--cyan)' }, g);
    return g;
  };
  const mols = [];
  // start half full
  slots.forEach((sl, i) => { if (i % 2 === 0) { const m = { el: mkMol(), x: sl.x, y: sl.y, tx: sl.x, ty: sl.y, slot: sl, state: 'set' }; sl.m = m; mols.push(m); } });
  const lbs = [];
  let tLB = 0, tOut = 0, macPh = 0;
  const macAt = { x: 910, y: 285 };
  return (dt) => {
    tLB += dt; tOut += dt; macPh += dt;
    // macrophage wobble
    const w = (a) => 52 + 6 * Math.sin(macPh * 1.7 + a * 3);
    let d = '';
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 10) { const r = w(a); d += (d ? 'L' : 'M') + (macAt.x + Math.cos(a) * r * 1.35) + ' ' + (macAt.y + Math.sin(a) * r * 0.62); }
    mac.setAttribute('d', d + 'Z');
    // new lamellar body
    if (tLB > 1.5) {
      tLB = 0;
      const g = svg('g', {}, bodies);
      for (let k = 0; k < 4; k++) svg('circle', { r: 22 - k * 5, fill: k === 0 ? 'color-mix(in srgb, var(--orange) 25%, var(--bg))' : 'none', stroke: 'var(--orange)', 'stroke-width': 2.5 }, g);
      lbs.push({ el: g, x: rand(470, 650), y: 470, t: 0 });
    }
    // move lamellar bodies up and release
    for (let i = lbs.length - 1; i >= 0; i--) {
      const b = lbs[i];
      b.t += dt;
      const p = clamp(b.t / 2.2, 0, 1);
      const y = lerp(470, 300, easeInOut(p));
      b.el.setAttribute('transform', `translate(${b.x},${y}) scale(${p < 1 ? 1 : 1})`);
      if (p >= 1) {
        b.el.remove(); lbs.splice(i, 1);
        // exocytosis: release molecules to empty slots
        const empty = slots.filter((sl) => !sl.m).sort((a, c) => Math.abs(a.x - b.x) - Math.abs(c.x - b.x)).slice(0, 4);
        empty.forEach((sl) => { const m = { el: mkMol(), x: b.x + rand(-10, 10), y: 290, tx: sl.x, ty: sl.y, slot: sl, state: 'go' }; sl.m = m; mols.push(m); });
      }
    }
    // turnover: release an old molecule every ~0.9 s
    if (tOut > 0.9) {
      tOut = 0;
      const used = slots.filter((sl) => sl.m && sl.m.state === 'set');
      if (used.length > slots.length * 0.55) {
        const sl = used[Math.floor(Math.random() * used.length)], m = sl.m;
        sl.m = null; m.slot = null;
        if (Math.random() < 0.5) { m.state = 'eat'; m.tx = macAt.x + rand(-20, 20); m.ty = macAt.y + rand(-10, 10); }
        else { m.state = 'recycle'; m.tx = rand(470, 650); m.ty = 330; }
      }
    }
    for (let i = mols.length - 1; i >= 0; i--) {
      const m = mols[i];
      const k = m.state === 'go' ? 4 : 2.6;
      m.x = damp(m.x, m.tx, k, dt); m.y = damp(m.y, m.ty, k, dt);
      const near = Math.hypot(m.x - m.tx, m.y - m.ty) < 3;
      if (near && m.state === 'go') m.state = 'set';
      if (near && (m.state === 'eat' || m.state === 'recycle')) { m.el.remove(); mols.splice(i, 1); continue; }
      const op = m.state === 'eat' || m.state === 'recycle' ? clamp(Math.hypot(m.x - m.tx, m.y - m.ty) / 60, 0, 1) : 1;
      m.el.setAttribute('transform', `translate(${m.x},${m.y})`);
      m.el.setAttribute('opacity', op);
    }
  };
}

/* ---------- gestation timeline ---------- */
function gestation(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 1100 150').attr('preserveAspectRatio', 'xMidYMid meet');
  const x = d3.scaleLinear().domain([0, 40]).range([30, 1070]);
  const g = root.append('g');
  g.append('rect').attr('x', x(0)).attr('y', 70).attr('width', x(40) - x(0)).attr('height', 14).attr('rx', 7).style('fill', 'var(--card-2)');
  const fill = g.append('rect').attr('x', x(25)).attr('y', 70).attr('width', 0).attr('height', 14).attr('rx', 7).style('fill', 'var(--cyan)');
  g.append('rect').attr('x', x(0)).attr('y', 70).attr('width', x(37) - x(0)).attr('height', 14).attr('rx', 7).style('fill', 'none').style('stroke', 'var(--red)').style('stroke-width', 2).style('stroke-dasharray', '6 8');
  [0, 10, 20, 30, 40].forEach((w) => g.append('text').attr('x', x(w)).attr('y', 120).attr('text-anchor', 'middle').style('font-size', '22px').style('fill', 'var(--text-3)').text(w));
  g.append('text').attr('x', x(40)).attr('y', 146).attr('text-anchor', 'end').style('font-size', '20px').style('fill', 'var(--text-3)').text('weeks of gestation');
  const mk = (w, label, color, anchor, dx) => {
    g.append('line').attr('x1', x(w)).attr('x2', x(w)).attr('y1', 52).attr('y2', 100).style('stroke', color).style('stroke-width', 5).style('stroke-linecap', 'round');
    g.append('text').attr('x', x(w) + dx).attr('y', 40).attr('text-anchor', anchor).attr('class', 'lbl').style('fill', color).style('font-size', '26px').text(label);
  };
  mk(25, 'Week 25 · production starts', 'var(--cyan)', 'end', 10);
  mk(37, 'Premature < 37 wk', 'var(--red)', 'middle', 0);
  return () => fill.interrupt().attr('width', 0).transition().delay(500).duration(1600).ease(d3.easeCubicOut).attr('width', x(40) - x(25));
}

/* ---------- composition donut ---------- */
function donut(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 560 640').attr('preserveAspectRatio', 'xMidYMid meet');
  root.append('text').attr('x', 280).attr('y', 34).attr('text-anchor', 'middle').attr('class', 'lbl').style('fill', 'var(--text-2)').text('Composition');
  const data = [
    { k: 'Lipids', v: 90, c: 'var(--cyan)', sub: 'mainly DPPC' },
    { k: 'Proteins', v: 8, c: 'var(--purple)', sub: 'surfactant proteins' },
    { k: 'Carbohydrate', v: 2, c: 'var(--yellow)', sub: '' },
  ];
  const g = root.append('g').attr('transform', 'translate(280,310)');
  const arc = d3.arc().innerRadius(150).outerRadius(220).cornerRadius(10).padAngle(0.025);
  const arcH = d3.arc().innerRadius(150).outerRadius(236).cornerRadius(10).padAngle(0.025);
  const pie = d3.pie().value((d) => d.v).sort(null);
  const arcs = pie(data);
  const paths = g.selectAll('path').data(arcs).join('path').style('fill', (d) => d.data.c).style('cursor', 'pointer');
  const big = g.append('text').attr('text-anchor', 'middle').attr('y', 10).style('font-size', '92px').style('font-weight', 800).style('fill', 'var(--text)');
  const nm = g.append('text').attr('text-anchor', 'middle').attr('y', 60).style('font-size', '30px').style('font-weight', 700);
  const sb = g.append('text').attr('text-anchor', 'middle').attr('y', 96).style('font-size', '23px').style('fill', 'var(--text-2)');
  const focus = (d) => { big.text(d.data.v + '%'); nm.text(d.data.k).style('fill', d.data.c); sb.text(d.data.sub); paths.transition().duration(300).attr('d', (a) => (a === d ? arcH(a) : arc(a))).style('opacity', (a) => (a === d ? 1 : 0.5)); };
  const unfocus = () => { focus(arcs[0]); paths.transition().duration(300).style('opacity', 1).attr('d', arc); };
  paths.on('pointerenter', (e, d) => focus(d)).on('pointerleave', unfocus);
  // legend
  const lg = root.append('g').attr('transform', 'translate(24,590)');
  data.forEach((d, i) => {
    const it = lg.append('g').attr('transform', `translate(${[0, 170, 360][i]},0)`);
    it.append('circle').attr('r', 10).attr('cy', -8).style('fill', d.c);
    it.append('text').attr('x', 18).style('font-size', '24px').style('fill', 'var(--text-2)').text(`${d.k.slice(0, 5) === 'Carbo' ? 'Carbs' : d.k} ${d.v}%`);
  });
  return () => {
    paths.interrupt().transition().duration(1400).ease(d3.easeCubicInOut).attrTween('d', (d) => { const i = d3.interpolate(d.startAngle, d.endAngle); return (t) => arc({ ...d, endAngle: i(t) }); });
    focus(arcs[0]);
    paths.style('opacity', 1);
  };
}

/* ---------- monolayer ---------- */
function monolayer(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 520 560').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  const t0 = svg('text', { x: 260, y: 34, 'text-anchor': 'middle', class: 'lbl', style: 'fill:var(--text-2)' }, s); t0.textContent = 'Structure';
  svg('rect', { x: 20, y: 330, width: 480, height: 190, rx: 24, fill: 'color-mix(in srgb, var(--blue) 20%, transparent)' }, s);
  const air = svg('text', { x: 40, y: 110, style: 'font:700 24px var(--font);fill:var(--text-3)' }, s); air.textContent = 'AIR';
  const wat = svg('text', { x: 40, y: 500, style: 'font:700 24px var(--font);fill:var(--blue)' }, s); wat.textContent = 'H₂O';
  const mols = [];
  for (let i = 0; i < 8; i++) {
    const g = svg('g', {}, s);
    const t1 = svg('path', { fill: 'none', stroke: 'var(--orange)', 'stroke-width': 7, 'stroke-linecap': 'round' }, g);
    const t2 = svg('path', { fill: 'none', stroke: 'var(--orange)', 'stroke-width': 7, 'stroke-linecap': 'round' }, g);
    svg('circle', { cx: 0, cy: 0, r: 20, fill: 'var(--cyan)' }, g);
    mols.push({ g, t1, t2, x: 60 + i * 57, ph: Math.random() * 6 });
  }
  const lh = svg('text', { x: 500, y: 390, 'text-anchor': 'end', style: 'font:700 24px var(--font);fill:var(--cyan)' }, s); lh.textContent = 'Polar heads → water';
  const lt = svg('text', { x: 500, y: 170, 'text-anchor': 'end', style: 'font:700 24px var(--font);fill:var(--orange)' }, s); lt.textContent = 'Non-polar tails → air';
  let time = 0;
  return (dt) => {
    time += dt;
    mols.forEach((m) => {
      const sw = 6 * Math.sin(time * 1.4 + m.ph);
      m.g.setAttribute('transform', `translate(${m.x},330)`);
      m.t1.setAttribute('d', `M-7 -16 C ${-10 + sw} -70 ${-4 + sw} -110 ${-9 + sw * 1.6} -140`);
      m.t2.setAttribute('d', `M7 -16 C ${10 + sw} -70 ${4 + sw} -110 ${9 + sw * 1.6} -140`);
    });
  };
}

/* ---------- turnover cycle ---------- */
function turnover(container) {
  const root = d3.select(container).append('svg').attr('class', 'chart').attr('viewBox', '0 0 560 640').attr('preserveAspectRatio', 'xMidYMid meet');
  const s = root.node();
  const t0 = svg('text', { x: 280, y: 34, 'text-anchor': 'middle', class: 'lbl', style: 'fill:var(--text-2)' }, s); t0.textContent = 'Turnover';
  const cx = 280, cy = 330, R = 190;
  svg('circle', { cx, cy, r: R, fill: 'none', stroke: 'var(--stroke-2)', 'stroke-width': 4, 'stroke-dasharray': '4 14', 'stroke-linecap': 'round' }, s);
  const node = (ang, label, sub, color) => {
    const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
    svg('circle', { cx: x, cy: y, r: 20, fill: color }, s);
    const down = Math.sin(ang) > 0;
    const a = svg('text', { x, y: y + (down ? 58 : -66), 'text-anchor': 'middle', style: `font:750 26px var(--font);fill:${color}` }, s); a.textContent = label;
    if (sub) { const b = svg('text', { x, y: y + (down ? 88 : -36), 'text-anchor': 'middle', style: 'font:600 21px var(--font);fill:var(--text-3)' }, s); b.textContent = sub; }
  };
  node(-Math.PI / 2, 'Secreted', 'type II cell', 'var(--tissue)');
  node(Math.PI / 6, 'Recycled', 'back to type II', 'var(--green)');
  node((5 * Math.PI) / 6, 'Phagocytosed', 'alveolar macrophage', 'var(--yellow)');
  const big = svg('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', style: 'font:800 64px var(--font);fill:var(--cyan)' }, s); big.textContent = 't½ = 2 d';
  const sm = svg('text', { x: cx, y: cy + 46, 'text-anchor': 'middle', style: 'font:650 23px var(--font);fill:var(--text-2)' }, s); sm.textContent = 'constantly made & removed';
  const dots = Array.from({ length: 9 }, (_, i) => ({ el: svg('circle', { r: 9, fill: 'var(--cyan)' }, s), a: (i / 9) * Math.PI * 2 }));
  return (dt) => {
    dots.forEach((d) => { d.a += dt * 0.55; d.el.setAttribute('cx', cx + Math.cos(d.a) * R); d.el.setAttribute('cy', cy + Math.sin(d.a) * R); });
  };
}

export default {
  'surfactant-source': {
    init(el, ctx) {
      const f = alveolarWall(el.querySelector('#surf-mount'));
      ctx.loop((dt) => f(dt));
      ctx.gest = gestation(el.querySelector('#gest'));
    },
    enter(el, ctx) { ctx.gest?.(); },
  },

  'surfactant-composition': {
    init(el, ctx) {
      ctx.donut = donut(el.querySelector('#donut'));
      const m = monolayer(el.querySelector('#mono'));
      const t = turnover(el.querySelector('#turn'));
      ctx.loop((dt) => { m(dt); t(dt); });
    },
    enter(el, ctx) { ctx.donut?.(); },
  },

  'surfactant-function': {
    async init(el, ctx) {
      const c = await ctx.mount3d('./three/bubbles.js', el.querySelector('#bub-mount'));
      ctx.c = c;
      if (!c) return;
      const p1 = el.querySelector('#bub-p1'), p2 = el.querySelector('#bub-p2'), st = el.querySelector('#bub-status');
      c.onState?.((s) => {
        const a = s.P1cm ?? s.P1, b = s.P2cm ?? s.P2;
        p1.textContent = Number.isFinite(a) && !s.collapsed ? a.toFixed(1) : '—';
        p2.textContent = Number.isFinite(b) ? b.toFixed(1) : '—';
        p1.style.color = a > b + 0.05 && !s.collapsed ? 'var(--red)' : 'var(--text)';
        if (s.collapsed) { st.textContent = 'Collapsed → atelectasis'; st.style.color = 'var(--red)'; }
        else if (!s.valveOpen) { st.textContent = 'Valve closed'; st.style.color = 'var(--text-3)'; }
        else if (s.flowDir !== 0) { st.textContent = 'Small → large'; st.style.color = 'var(--orange)'; }
        else { st.textContent = 'Stable — both stay open'; st.style.color = 'var(--green)'; }
      });
      ctx.segc = seg(el.querySelector('#bub-seg'), (b) => { c.reset?.(); c.setSurfactant?.(b.dataset.s === '1'); });
      el.querySelector('#bub-play').addEventListener('click', () => c.play?.());
      el.querySelector('#bub-reset').addEventListener('click', () => c.reset?.());
    },
    enter(el, ctx) { ctx.c?.reset?.(); },
  },
};
