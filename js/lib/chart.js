// Thin d3 wrapper: consistent, projector-friendly SVG charts.
// The SVG viewBox is measured in design pixels (1/1920 of the stage), so
// font sizes and stroke widths in CSS are stable at any screen size.
const d3 = window.d3;

export function designUnit() {
  const st = document.getElementById('stage');
  return st.clientWidth / 1920 || 1;
}

export function chart(container, opt = {}) {
  const u = designUnit();
  const W = opt.W || Math.max(200, container.clientWidth / u);
  const H = opt.H || Math.max(150, container.clientHeight / u);
  const m = Object.assign({ l: 112, r: 36, t: 28, b: 96 }, opt.m || {});
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const svg = d3.select(container).append('svg')
    .attr('class', 'chart')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  const defs = svg.append('defs');
  const x = (opt.xScale || d3.scaleLinear()).domain(opt.x).range(opt.xReverse ? [iw, 0] : [0, iw]);
  const y = d3.scaleLinear().domain(opt.y).range([ih, 0]);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);

  const xTicks = opt.xTicks ?? 5, yTicks = opt.yTicks ?? 5;
  const xAxis = d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0).tickPadding(14);
  const yAxis = d3.axisLeft(y).ticks(yTicks).tickSizeOuter(0).tickPadding(14);
  if (opt.xTickValues) xAxis.tickValues(opt.xTickValues);
  if (opt.yTickValues) yAxis.tickValues(opt.yTickValues);
  if (opt.xFormat) xAxis.tickFormat(opt.xFormat);
  if (opt.yFormat) yAxis.tickFormat(opt.yFormat);

  if (opt.grid !== false) {
    const gy = d3.axisLeft(y).ticks(yTicks).tickSize(-iw).tickFormat('');
    if (opt.yTickValues) gy.tickValues(opt.yTickValues);
    g.append('g').attr('class', 'grid').call(gy);
    if (opt.xGrid) {
      const gx = d3.axisBottom(x).ticks(xTicks).tickSize(-ih).tickFormat('');
      if (opt.xTickValues) gx.tickValues(opt.xTickValues);
      g.append('g').attr('class', 'grid').attr('transform', `translate(0,${ih})`).call(gx);
    }
  }
  const xAxisY = opt.xAxisAt != null ? y(opt.xAxisAt) : ih;
  const xa = g.append('g').attr('class', 'axis x').attr('transform', `translate(0,${xAxisY})`).call(xAxis);
  const yAxisX = opt.yAxisAt != null ? x(opt.yAxisAt) : 0;
  const ya = g.append('g').attr('class', 'axis y').attr('transform', `translate(${yAxisX},0)`).call(yAxis);
  if (opt.hideXTicks) xa.selectAll('text').remove();
  if (opt.hideYTicks) ya.selectAll('text').remove();

  if (opt.xLabel) svg.append('text').attr('class', 'ax-title').attr('x', m.l + iw / 2).attr('y', H - 18).attr('text-anchor', 'middle').html(opt.xLabel);
  if (opt.yLabel) svg.append('text').attr('class', 'ax-title').attr('transform', `translate(30,${m.t + ih / 2}) rotate(-90)`).attr('text-anchor', 'middle').html(opt.yLabel);

  const plot = g.append('g').attr('class', 'plot');
  const over = g.append('g').attr('class', 'over');
  // clip so animated paths never escape the plot area
  const clipId = 'clip' + Math.random().toString(36).slice(2, 8);
  defs.append('clipPath').attr('id', clipId).append('rect').attr('x', -10).attr('y', -10).attr('width', iw + 20).attr('height', ih + 20);
  plot.attr('clip-path', opt.clip === false ? null : `url(#${clipId})`);

  const lineGen = (curve = d3.curveCatmullRom.alpha(0.5)) => d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(curve);

  const api = {
    svg, g, plot, over, defs, x, y, iw, ih, W, H, m,
    path(data, { color = 'var(--blue)', cls = 'line', curve, parent = plot, glow = false } = {}) {
      const p = parent.append('path').attr('class', cls + (glow ? ' glow' : '')).attr('d', lineGen(curve)(data)).style('stroke', color).style('color', color);
      return p;
    },
    update(p, data, { curve, dur = 0 } = {}) {
      const d = lineGen(curve)(data);
      if (dur) p.transition().duration(dur).ease(d3.easeCubicInOut).attr('d', d); else p.attr('d', d);
      return p;
    },
    area(data, { color = 'var(--blue)', opacity = 0.18, curve = d3.curveLinear, parent = plot } = {}) {
      return parent.append('path').attr('d', d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(curve)(data) + 'Z').style('fill', color).style('fill-opacity', opacity).style('stroke', 'none');
    },
    line: lineGen,
    text(px, py, str, { color = 'var(--text)', cls = 'lbl', anchor = 'start', parent = over, dy = 0 } = {}) {
      return parent.append('text').attr('class', cls).attr('x', px).attr('y', py).attr('dy', dy).attr('text-anchor', anchor).style('fill', color).html(str);
    },
    dot(px, py, { r = 12, color = 'var(--blue)', parent = over, ring = true } = {}) {
      const gg = parent.append('g').attr('transform', `translate(${px},${py})`);
      if (ring) gg.append('circle').attr('r', r * 2.1).style('fill', color).style('opacity', 0.18);
      gg.append('circle').attr('r', r).style('fill', color).style('stroke', 'var(--bg)').style('stroke-width', 4);
      return gg;
    },
    hline(v, { color = 'var(--text-3)', dash = true, parent = plot, width = 2.5 } = {}) {
      return parent.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(v)).attr('y2', y(v)).style('stroke', color).style('stroke-width', width).style('stroke-dasharray', dash ? '8 10' : null);
    },
    vline(v, { color = 'var(--text-3)', dash = true, parent = plot, width = 2.5 } = {}) {
      return parent.append('line').attr('y1', 0).attr('y2', ih).attr('x1', x(v)).attr('x2', x(v)).style('stroke', color).style('stroke-width', width).style('stroke-dasharray', dash ? '8 10' : null);
    },
  };
  return api;
}

// stroke draw-in animation for a d3 path selection
export function drawIn(sel, dur = 1400, delay = 0, ease = d3.easeCubicInOut) {
  sel.each(function () {
    const L = this.getTotalLength();
    d3.select(this).interrupt().attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L)
      .transition().delay(delay).duration(dur).ease(ease).attr('stroke-dashoffset', 0)
      .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
  });
  return sel;
}
export function hideStroke(sel) {
  sel.each(function () { const L = this.getTotalLength(); d3.select(this).interrupt().attr('stroke-dasharray', `${L} ${L}`).attr('stroke-dashoffset', L); });
}
// fade a selection in
export function fadeIn(sel, dur = 600, delay = 0) {
  sel.interrupt().style('opacity', 0).transition().delay(delay).duration(dur).style('opacity', 1);
  return sel;
}

// convert a pointer event into chart data coordinates
export function pointer(c, ev) {
  const [px, py] = d3.pointer(ev, c.g.node());
  return { px, py, x: c.x.invert(px), y: c.y.invert(py) };
}
