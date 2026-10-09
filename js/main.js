// Pulmonary Mechanics — presentation engine
import { POPS } from './content.js';
import intro from './slides/intro.js';
import pressures from './slides/pressures.js';
import compliance from './slides/compliance.js';
import surfactant from './slides/surfactant.js';
import volumes from './slides/volumes.js';
import resistance from './slides/resistance.js';
import dynamic from './slides/dynamic.js';
import disease from './slides/disease.js';

const MODULES = { ...intro, ...pressures, ...compliance, ...surfactant, ...volumes, ...resistance, ...dynamic, ...disease };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const slides = $$('#stage > .slide');
const state = { index: -1, theme: 'dark', laser: false };

/* ---------- theme ---------- */
try { const t = localStorage.getItem('pm-theme'); if (t === 'light' || t === 'dark') state.theme = t; } catch (e) {}
root.dataset.theme = state.theme;

/* ---------- per-slide runtime ---------- */
const runtime = new Map(); // slide el -> { inited, loops:Set, ctrls:[], stopTimer }
function rt(el) {
  if (!runtime.has(el)) runtime.set(el, { inited: false, initing: null, loops: new Set(), ctrls: [], stopTimer: 0, steps: 0 });
  return runtime.get(el);
}

const cssVar = (name) => getComputedStyle(root).getPropertyValue('--' + name).trim();

const shared = new Map(); // key -> { holder, ctrlPromise, users:Set }

function makeCtx(el) {
  const r = rt(el);
  const ctx = {
    get theme() { return state.theme; },
    color: cssVar,
    el,
    // run fn(dt, t) every frame while this slide is active
    loop(fn) { r.loops.add(fn); return () => r.loops.delete(fn); },
    // mount a 3D module into container; lifecycle bound to this slide
    async mount3d(path, container, options = {}) {
      try {
        const mod = await import(path);
        const ctrl = mod.mount(container, options);
        ctrl.setTheme?.(state.theme);
        r.ctrls.push(ctrl);
        if (state.index === slides.indexOf(el)) ctrl.start?.();
        return ctrl;
      } catch (e) {
        console.warn('3D module unavailable:', path, e);
        return null;
      }
    },
    // a 3D scene shared between several slides; its holder element is moved into `container`
    async shared(key, path, options, container) {
      let s = shared.get(key);
      if (!s) {
        const holder = document.createElement('div');
        holder.className = 'mount shared-' + key;
        s = { holder, users: new Set(), ctrlPromise: null };
        shared.set(key, s);
        container.appendChild(holder);
        s.ctrlPromise = import(path).then((m) => { const c = m.mount(holder, options); c.setTheme?.(state.theme); return c; })
          .catch((e) => { console.warn('3D module unavailable:', path, e); return null; });
      }
      s.users.add(el);
      r.sharedKeys = r.sharedKeys || new Map();
      r.sharedKeys.set(key, container);
      return s.ctrlPromise;
    },
    // pin HTML labels to 3D anchors: defs = [{ name, html, color, pop }]
    pins(layer, ctrlPromise, defs) {
      const els = defs.map((d) => {
        const p = document.createElement('div');
        p.className = 'pin';
        p.style.setProperty('--c', d.color);
        p.innerHTML = `<i></i><span>${d.html}</span>`;
        if (d.pop) p.dataset.pop = d.pop;
        if (d.onEnter) p.addEventListener('mouseenter', d.onEnter);
        if (d.onLeave) p.addEventListener('mouseleave', d.onLeave);
        p.style.opacity = '0';
        layer.appendChild(p);
        return p;
      });
      let ctrl = null;
      ctrlPromise.then((c) => (ctrl = c)).catch(() => {});
      // anchors are in CSS px of the (unscaled) 3D container; the layer overlaps it exactly
      r.loops.add(() => {
        if (!ctrl?.getAnchors) return;
        const a = ctrl.getAnchors();
        defs.forEach((d, i) => {
          const p = a?.[d.name];
          if (!p) return;
          const x = p.x + (d.dx || 0), y = p.y + (d.dy || 0);
          els[i].style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
          els[i].style.opacity = p.visible === false ? '0' : '1';
        });
      });
      return els;
    },
    onTheme: null,
  };
  return ctx;
}

const ctxs = new Map();
function ctxOf(el) { if (!ctxs.has(el)) ctxs.set(el, makeCtx(el)); return ctxs.get(el); }
function modOf(el) { return MODULES[el.dataset.id] || {}; }

async function ensureInit(el) {
  const r = rt(el);
  if (r.inited) return;
  if (r.initing) return r.initing;
  const m = modOf(el);
  r.initing = (async () => {
    try { await m.init?.(el, ctxOf(el)); } catch (e) { console.error('init failed', el.dataset.id, e); }
    r.inited = true;
  })();
  return r.initing;
}

/* ---------- steps (builds) ---------- */
function stepEls(el) {
  return $$('[data-step]', el).sort((a, b) => +a.dataset.step - +b.dataset.step);
}
function maxStep(el) { const s = stepEls(el); return s.length ? Math.max(...s.map((x) => +x.dataset.step)) : 0; }
function setStep(el, n) {
  const r = rt(el);
  r.steps = n;
  stepEls(el).forEach((s) => s.classList.toggle('pending', +s.dataset.step > n));
  modOf(el).step?.(n, el, ctxOf(el));
}

/* ---------- navigation ---------- */
function attachShared(el) {
  const r = rt(el);
  if (!r.sharedKeys) return;
  r.sharedKeys.forEach((container, key) => {
    const s = shared.get(key);
    if (s && s.holder.parentElement !== container) container.appendChild(s.holder);
    s?.ctrlPromise.then((c) => { if (!c) return; c.__activeSlide = el; c.start?.(); });
  });
}
function detachShared(el, next) {
  const r = rt(el);
  if (!r.sharedKeys) return;
  r.sharedKeys.forEach((_, key) => {
    const nr = rt(next);
    if (nr.sharedKeys?.has(key)) return; // next slide keeps using it
    const s = shared.get(key);
    s?.ctrlPromise.then((c) => { if (c) setTimeout(() => { if (c.__activeSlide === el) c.stop?.(); }, 950); });
  });
}

async function go(i, { fromBack = false, instant = false } = {}) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === state.index) return;
  const prev = slides[state.index];
  const next = slides[i];
  const forward = i > state.index;
  state.index = i;

  hidePop(true);
  if (prev) {
    const pr = rt(prev);
    prev.classList.remove('active');
    prev.classList.toggle('leaving-fwd', forward);
    prev.classList.toggle('leaving-back', !forward);
    try { modOf(prev).leave?.(prev, ctxOf(prev)); } catch (e) { console.error(e); }
    clearTimeout(pr.stopTimer);
    pr.stopTimer = setTimeout(() => pr.ctrls.forEach((c) => c.stop?.()), 950);
    detachShared(prev, next);
  }

  await ensureInit(next);
  if (state.index !== i) return; // user moved on meanwhile
  const nr = rt(next);
  clearTimeout(nr.stopTimer);
  next.classList.remove('leaving-fwd', 'leaving-back');
  setStep(next, fromBack ? maxStep(next) : 0);
  next.classList.add('active');
  nr.ctrls.forEach((c) => c.start?.());
  attachShared(next);
  try { modOf(next).enter?.(next, ctxOf(next), { fromBack }); } catch (e) { console.error(e); }

  updateHud();
  history.replaceState(null, '', '#/' + (i + 1));
  // warm up the next slides while the presenter talks
  idle(() => { [i + 1, i + 2].forEach((k) => slides[k] && ensureInit(slides[k])); });
}
const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 400));

function next() {
  const el = slides[state.index];
  const r = rt(el);
  if (r.steps < maxStep(el)) return setStep(el, r.steps + 1);
  go(state.index + 1);
}
function prev() {
  const el = slides[state.index];
  const r = rt(el);
  if (r.steps > 0) return setStep(el, r.steps - 1);
  go(state.index - 1, { fromBack: true });
}

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const el = slides[state.index];
  if (el) rt(el).loops.forEach((fn) => { try { fn(dt, now / 1000); } catch (e) { console.error(e); } });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- HUD ---------- */
const hud = {
  progress: $('#progress'), counter: $('#counter'), section: $('#section-name'), src: $('#src-chip'),
};
function updateHud() {
  const el = slides[state.index];
  hud.progress.style.width = ((state.index + 1) / slides.length) * 100 + '%';
  hud.counter.textContent = `${state.index + 1} / ${slides.length}`;
  hud.section.textContent = el.dataset.section || '';
  const src = el.dataset.src;
  hud.src.classList.toggle('hidden', !src);
  if (src) hud.src.innerHTML = `<i style="--c:var(--text-3)"></i>Lecture slide ${src.replace(/,/g, ', ')}`;
}

/* ---------- popovers ---------- */
const pop = $('#popover');
let popTimer = 0, popHideTimer = 0, popAnchor = null, popPinned = false;
function renderPop(key) {
  const d = POPS[key];
  if (!d) return false;
  pop.style.setProperty('--pc', d.color ? `var(--${d.color})` : 'var(--blue)');
  const rows = (d.rows || []).map((r) => `<div class="p-row"><div class="p-ico">${r[0]}</div><div>${r[1]}</div></div>`).join('');
  pop.innerHTML = `${d.kicker ? `<div class="p-kicker">${d.kicker}</div>` : ''}<h4>${d.title}</h4><div class="p-body">${d.formula ? `<div class="p-formula">${d.formula}</div>` : ''}${rows}</div>${d.src ? `<div class="p-src">${d.src}</div>` : ''}`;
  return true;
}
function placePop(anchor) {
  const a = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight, W = innerWidth, H = innerHeight, m = 16;
  let x, y, ox = '0%', oy = '50%';
  if (a.right + pw + m * 2 < W) { x = a.right + m; ox = '0%'; }
  else if (a.left - pw - m * 2 > 0) { x = a.left - pw - m; ox = '100%'; }
  else { x = Math.min(W - pw - m, Math.max(m, a.left + a.width / 2 - pw / 2)); ox = '50%'; }
  y = Math.min(H - ph - m, Math.max(m, a.top + a.height / 2 - ph / 2));
  if (ox === '50%') { y = a.bottom + m + ph < H ? a.bottom + m : a.top - ph - m; oy = a.bottom + m + ph < H ? '0%' : '100%'; }
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  pop.style.setProperty('--ox', ox);
  pop.style.setProperty('--oy', oy);
}
function showPop(anchor) {
  if (!renderPop(anchor.dataset.pop)) return;
  popAnchor?.classList.remove('open');
  popAnchor = anchor;
  anchor.classList.add('open');
  pop.classList.add('show');
  placePop(anchor);
}
function hidePop(force) {
  if (popPinned && !force) return;
  popPinned = false;
  pop.classList.remove('show');
  popAnchor?.classList.remove('open');
  popAnchor = null;
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('[data-pop]');
  if (t && t !== popAnchor) {
    clearTimeout(popHideTimer); clearTimeout(popTimer);
    popTimer = setTimeout(() => { popPinned = false; showPop(t); }, 110);
  } else if (t === popAnchor || e.target.closest?.('#popover')) {
    clearTimeout(popHideTimer);
  }
});
document.addEventListener('mouseout', (e) => {
  const t = e.target.closest?.('[data-pop]') || e.target.closest?.('#popover');
  if (!t) return;
  const to = e.relatedTarget;
  if (to && (to.closest?.('#popover') || to.closest?.('[data-pop]') === popAnchor)) return;
  clearTimeout(popTimer);
  popHideTimer = setTimeout(() => hidePop(), 220);
});
document.addEventListener('click', (e) => {
  const t = e.target.closest?.('[data-pop]');
  if (t) { if (popAnchor === t && popPinned) { hidePop(true); } else { showPop(t); popPinned = true; } return; }
  if (!e.target.closest?.('#popover')) hidePop(true);
}, true);

/* ---------- overview ---------- */
const ov = $('#overview');
function buildOverview() {
  const grid = $('.ov-grid', ov);
  grid.innerHTML = '';
  slides.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'ov-item' + (i === state.index ? ' cur' : '');
    b.style.setProperty('--accent', s.style.getPropertyValue('--accent') || 'var(--blue)');
    b.innerHTML = `<div class="n">${String(i + 1).padStart(2, '0')}</div><div class="t">${s.dataset.title || ''}</div><div class="s">${s.dataset.section || ''}</div>`;
    b.onclick = () => { toggleOverview(false); go(i); };
    grid.appendChild(b);
  });
}
function toggleOverview(show = !ov.classList.contains('show')) {
  if (show) buildOverview();
  ov.classList.toggle('show', show);
}

/* ---------- figure modal (original lecture slide) ---------- */
const fig = $('#figmodal');
let figList = [], figI = 0;
function showFig(i) {
  figI = (i + figList.length) % figList.length;
  const n = figList[figI];
  $('img', fig).src = `assets/figures/slide-${String(n).padStart(2, '0')}.jpg`;
  $('figcaption', fig).textContent = `Original lecture slide ${n}` + (figList.length > 1 ? `  ·  ${figI + 1}/${figList.length}  (← → to switch)` : '');
}
function openFig() {
  const src = slides[state.index].dataset.src;
  if (!src) return;
  figList = [];
  src.split(',').forEach((part) => {
    const [a, b] = part.split(/[–-]/).map((x) => parseInt(x, 10));
    for (let k = a; k <= (b || a); k++) if (k > 1) figList.push(k);
  });
  if (!figList.length) return;
  showFig(0);
  fig.classList.add('show');
}
hud.src.addEventListener('click', openFig);
fig.addEventListener('click', () => fig.classList.remove('show'));

/* ---------- theme ---------- */
function setTheme(t) {
  state.theme = t;
  root.dataset.theme = t;
  try { localStorage.setItem('pm-theme', t); } catch (e) {}
  runtime.forEach((r, el) => {
    r.ctrls.forEach((c) => c.setTheme?.(t));
    if (r.inited) modOf(el).theme?.(t, el, ctxOf(el));
  });
  shared.forEach((s) => s.ctrlPromise.then((c) => c?.setTheme?.(t)));
}

/* ---------- fullscreen, laser, idle ---------- */
function fullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
}
const laser = $('#laser');
document.addEventListener('mousemove', (e) => {
  if (state.laser) { laser.style.left = e.clientX + 'px'; laser.style.top = e.clientY + 'px'; }
  document.body.classList.remove('idle', 'hide-cursor');
  clearTimeout(idleT);
  idleT = setTimeout(() => document.body.classList.add('idle', 'hide-cursor'), 2600);
});
let idleT = setTimeout(() => document.body.classList.add('idle'), 3000);

/* ---------- keyboard ---------- */
let numBuf = '';
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select') && !['Escape'].includes(e.key)) {
    if (e.target.type !== 'range') return;
    if (!['PageDown', 'PageUp', ' '].includes(e.key)) return;
  }
  if (fig.classList.contains('show')) {
    if (e.key === 'Escape') fig.classList.remove('show');
    if (e.key === 'ArrowRight') showFig(figI + 1);
    if (e.key === 'ArrowLeft') showFig(figI - 1);
    return;
  }
  const k = e.key;
  if (/^[0-9]$/.test(k)) { numBuf += k; return; }
  if (k === 'Enter' && numBuf) { go(parseInt(numBuf, 10) - 1); numBuf = ''; return; }
  numBuf = '';
  switch (k) {
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter':
      e.preventDefault(); if (ov.classList.contains('show')) return; next(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
      e.preventDefault(); if (ov.classList.contains('show')) return; prev(); break;
    case 'Home': go(0); break;
    case 'End': go(slides.length - 1); break;
    case 'Escape':
      if ($('#help').classList.contains('show')) { $('#help').classList.remove('show'); break; }
      if (popAnchor) { hidePop(true); break; }
      toggleOverview(); break;
    case 'o': case 'O': hidePop(true); toggleOverview(); break;
    case 'f': case 'F': fullscreen(); break;
    case 't': case 'T': setTheme(state.theme === 'dark' ? 'light' : 'dark'); break;
    case 'l': case 'L': state.laser = !state.laser; document.body.classList.toggle('laser', state.laser); break;
    case 's': case 'S': openFig(); break;
    case 'q': case 'Q': window.open('quiz/', '_blank'); break;
    case '?': case 'h': case 'H': $('#help').classList.toggle('show'); break;
  }
});

/* click navigation on HUD */
$('#btn-prev').onclick = prev;
$('#btn-next').onclick = next;
$('#btn-grid').onclick = () => toggleOverview();
$('#btn-theme').onclick = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
$('#btn-full').onclick = fullscreen;

/* touch swipe */
let tx = 0, ty = 0;
document.addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('input, canvas')) (dx < 0 ? next : prev)();
}, { passive: true });

/* ---------- start ---------- */
const startAt = (() => { const m = location.hash.match(/#\/(\d+)/); return m ? parseInt(m[1], 10) - 1 : 0; })();
go(startAt, { instant: true });
window.addEventListener('hashchange', () => { const m = location.hash.match(/#\/(\d+)/); if (m) go(parseInt(m[1], 10) - 1); });
window.deck = { go, next, prev, setTheme, slides };
