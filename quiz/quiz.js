import { BANK_META, TOPICS, QUESTIONS } from './questions.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const COLORS = { pressures: 'var(--pink)', compliance: 'var(--purple)', surfactant: 'var(--cyan)', volumes: 'var(--blue)', resistance: 'var(--orange)', dynamic: 'var(--yellow)', disease: 'var(--green)' };
const LEVEL = { 1: ['Recall', 'var(--cyan)'], 2: ['Understanding', 'var(--purple)'], 3: ['Application', 'var(--orange)'] };
const KEYS = 'ABCDE';
const SECS_PER_Q = 60;

/* ---------- persistence (optional) ---------- */
const STORE = 'pm-quiz-v1';
let saved = { stats: {}, theme: null };
try { saved = Object.assign(saved, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
const persist = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {} };

/* ---------- theme ---------- */
const root = document.documentElement;
const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
root.dataset.theme = saved.theme || (prefersLight ? 'light' : 'dark');
$('#theme').onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; saved.theme = root.dataset.theme; persist(); };

/* ---------- start screen ---------- */
const cfg = { mode: 'practice', count: 20, topics: new Set(Object.keys(TOPICS)), weak: false };
const byTopic = (t) => QUESTIONS.filter((q) => q.topic === t).length;
$('#stats').innerHTML = '';
[[`${QUESTIONS.length} questions`, 'var(--green)'], [`${Object.keys(TOPICS).length} topics`, 'var(--blue)'], ['16 learning objectives', 'var(--purple)'], ['Explanations + slide refs', 'var(--orange)']].forEach(([t, c]) => {
  const p = el('span', 'pill'); p.innerHTML = `<i style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></i>`; p.append(t); $('#stats').append(p);
});
const tbox = $('#topics');
Object.entries(TOPICS).forEach(([k, name]) => {
  const b = el('button', 'topic on'); b.style.setProperty('--c', COLORS[k]); b.dataset.k = k;
  b.innerHTML = '<i></i>'; b.append(name); const sm = el('small', '', String(byTopic(k))); b.append(sm);
  b.onclick = () => { b.classList.toggle('on'); b.classList.contains('on') ? cfg.topics.add(k) : cfg.topics.delete(k); $('#start').disabled = cfg.topics.size === 0; };
  tbox.append(b);
});
$('#all-topics').onclick = () => { tbox.querySelectorAll('.topic').forEach((b) => { b.classList.add('on'); cfg.topics.add(b.dataset.k); }); $('#start').disabled = false; };
const segPick = (rootSel, fn) => { const r = $(rootSel); r.querySelectorAll('button').forEach((b) => (b.onclick = () => { r.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b); })); };
$('#modes').querySelectorAll('.mode').forEach((b) => (b.onclick = () => { $('#modes').querySelectorAll('.mode').forEach((x) => x.classList.toggle('on', x === b)); cfg.mode = b.dataset.mode; }));
segPick('#count', (b) => (cfg.count = b.dataset.n === 'all' ? Infinity : +b.dataset.n));
$('#weak').onchange = (e) => (cfg.weak = e.target.checked);

// about
const about = $('#about');
const p1 = el('p'); p1.append(el('b', '', 'Where the questions come from. ')); p1.append(BANK_META.searchSummary); about.append(p1);
const p2 = el('p', '', 'Every item is an original single-best-answer question written to the lecture’s 16 learning objectives (Dr Rajeev Bajaj, NU Oman; Guyton & Hall 15e, pp. 501–507). They are exam-style practice items, not official past-paper questions.'); about.append(p2);
const ul = el('ul'); BANK_META.sources.forEach((s) => { const li = el('li'); const a = el('a', '', s.label); a.href = s.url; a.target = '_blank'; a.rel = 'noopener'; li.append(a); ul.append(li); }); about.append(ul);

/* ---------- session ---------- */
let S = null;
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function newSession(list) {
  S = {
    items: list.map((q) => ({ q, order: shuffle([0, 1, 2, 3, 4]), chosen: null, locked: false, flagged: false })),
    i: 0, mode: cfg.mode, t0: Date.now(), deadline: cfg.mode === 'exam' ? Date.now() + list.length * SECS_PER_Q * 1000 : 0,
  };
  show('q'); render(); tick();
}
$('#start').onclick = () => {
  let pool = QUESTIONS.filter((q) => cfg.topics.has(q.topic));
  if (cfg.weak) {
    const score = (q) => { const s = saved.stats[q.id]; if (!s) return 1; return s.correct < s.seen ? 2 + (s.seen - s.correct) : 0; };
    pool = shuffle(pool).sort((a, b) => score(b) - score(a));
  } else pool = shuffle(pool);
  newSession(pool.slice(0, Math.min(cfg.count, pool.length)));
};

function show(v) { ['start', 'q', 'res'].forEach((k) => $('#v-' + k).classList.toggle('hidden', k !== v)); window.scrollTo({ top: 0, behavior: 'smooth' }); $('#timer').classList.toggle('hidden', v !== 'q'); }

const correctIdx = (it) => it.order.indexOf(it.q.answer);
const isRight = (it) => it.chosen != null && it.order[it.chosen] === it.q.answer;

function render() {
  const it = S.items[S.i], q = it.q, n = S.items.length;
  $('#qbar').style.width = ((S.i + (it.chosen != null ? 1 : 0)) / n) * 100 + '%';
  $('#qnum').textContent = `Question ${S.i + 1} of ${n}`;
  const tp = $('#qtopic'); tp.textContent = TOPICS[q.topic]; tp.style.color = COLORS[q.topic];
  const lv = $('#qlevel'); lv.textContent = LEVEL[q.level]?.[0] || ''; lv.style.setProperty('--c', LEVEL[q.level]?.[1]);
  $('#flag').classList.toggle('on', it.flagged);
  $('#stem').textContent = q.stem;
  const box = $('#opts'); box.innerHTML = '';
  it.order.forEach((oi, di) => {
    const b = el('button', 'opt');
    b.append(el('span', 'k', KEYS[di]), el('span', 't', q.options[oi]), el('span', 'm', ''));
    b.onclick = () => choose(di);
    box.append(b);
  });
  paintOpts();
  const ex = $('#explain');
  if (S.mode === 'practice' && it.locked) showExplain(it); else ex.classList.add('hidden');
  $('#prev').disabled = S.i === 0;
  const last = S.i === n - 1;
  $('#next').textContent = last ? 'Finish' : 'Next';
  $('#next').disabled = S.mode === 'practice' ? !it.locked : false;
  dots();
}
function paintOpts() {
  const it = S.items[S.i];
  const btns = [...$('#opts').children];
  btns.forEach((b, di) => {
    b.className = 'opt';
    b.querySelector('.m').textContent = '';
    if (S.mode === 'practice' && it.locked) {
      b.disabled = true;
      if (di === correctIdx(it)) { b.classList.add('right'); b.querySelector('.m').textContent = '✓'; }
      else if (di === it.chosen) { b.classList.add('wrong'); b.querySelector('.m').textContent = '✕'; }
      else b.classList.add('dim');
    } else {
      b.disabled = false;
      if (di === it.chosen) b.classList.add('sel');
    }
  });
}
function showExplain(it) {
  const ok = isRight(it), ex = $('#explain');
  ex.style.setProperty('--c', ok ? 'var(--green)' : 'var(--red)');
  ex.innerHTML = '';
  ex.append(el('div', 'ek', ok ? 'Correct' : `Not quite — answer ${KEYS[correctIdx(it)]}`), el('p', '', it.q.explain), el('div', 'ref', it.q.ref));
  ex.classList.remove('hidden');
}
function choose(di) {
  const it = S.items[S.i];
  if (S.mode === 'practice' && it.locked) return;
  it.chosen = di;
  if (S.mode === 'practice') {
    it.locked = true;
    record(it);
    paintOpts();
    const btns = [...$('#opts').children];
    (isRight(it) ? btns[di] : btns[di]).classList.add(isRight(it) ? 'pop' : 'shake');
    showExplain(it);
    $('#next').disabled = false;
  } else paintOpts();
  $('#qbar').style.width = ((S.i + 1) / S.items.length) * 100 + '%';
  dots();
}
function record(it) {
  const s = (saved.stats[it.q.id] = saved.stats[it.q.id] || { seen: 0, correct: 0 });
  s.seen++; if (isRight(it)) s.correct++;
  persist();
}
function dots() {
  const d = $('#dots'); d.innerHTML = '';
  if (S.items.length > 60) return;
  S.items.forEach((it, k) => {
    const b = el('button', 'dot');
    if (k === S.i) b.classList.add('cur');
    if (S.mode === 'practice' && it.locked) b.classList.add(isRight(it) ? 'ok' : 'no');
    else if (it.chosen != null) b.classList.add('ans');
    if (it.flagged) b.classList.add('fl');
    b.title = `Question ${k + 1}`;
    b.onclick = () => { S.i = k; render(); };
    d.append(b);
  });
}
$('#next').onclick = () => { if (S.i < S.items.length - 1) { S.i++; render(); } else finish(); };
$('#prev').onclick = () => { if (S.i > 0) { S.i--; render(); } };
$('#flag').onclick = () => { const it = S.items[S.i]; it.flagged = !it.flagged; render(); };

let timerId = 0;
function tick() {
  clearInterval(timerId);
  const t = $('#timer');
  const upd = () => {
    if (!S) return;
    if (S.mode === 'exam') {
      const left = Math.max(0, S.deadline - Date.now());
      t.textContent = '⏱ ' + fmtT(left);
      t.style.color = left < 60000 ? 'var(--red)' : 'var(--text)';
      if (left <= 0) finish();
    } else t.textContent = fmtT(Date.now() - S.t0);
  };
  upd(); timerId = setInterval(upd, 500);
}
const fmtT = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* ---------- results ---------- */
function finish() {
  clearInterval(timerId);
  if (S.mode === 'exam') S.items.forEach((it) => { if (!it.locked) { it.locked = true; if (it.chosen != null) record(it); else record(it); } });
  const n = S.items.length, right = S.items.filter(isRight).length, pct = Math.round((right / n) * 100);
  show('res');
  const ring = $('#ring');
  ring.style.stroke = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
  ring.style.strokeDashoffset = 540.35;
  requestAnimationFrame(() => requestAnimationFrame(() => (ring.style.strokeDashoffset = 540.35 * (1 - pct / 100))));
  let k = 0; const step = () => { k = Math.min(pct, k + Math.max(1, Math.round(pct / 40))); $('#pct').textContent = k + '%'; if (k < pct) requestAnimationFrame(step); }; step();
  $('#frac').textContent = `${right} / ${n} correct · ${fmtT(Date.now() - S.t0)}`;
  const [v, vs] = pct >= 85 ? ['Excellent — exam ready.', 'You have a firm grip on the whole chapter.'] : pct >= 70 ? ['Good work.', 'Review the topics below that are under 70%.'] : pct >= 50 ? ['Getting there.', 'Re-read the weak topics, then retry your mistakes.'] : ['Time to revisit the lecture.', 'Go back through the slides, then try again.'];
  $('#verdict').textContent = v; $('#verdict-s').textContent = vs;
  // topic bars
  const bars = $('#bars'); bars.innerHTML = '';
  Object.keys(TOPICS).forEach((t) => {
    const its = S.items.filter((it) => it.q.topic === t); if (!its.length) return;
    const r = its.filter(isRight).length, p = Math.round((r / its.length) * 100);
    const row = el('div', 'bar'); row.style.setProperty('--c', p >= 70 ? 'var(--green)' : p >= 50 ? 'var(--orange)' : 'var(--red)');
    const f = el('div', 'f'); const tr = el('div', 't'); tr.append(f);
    row.append(el('div', 'n', TOPICS[t]), tr, el('div', 'v', `${r}/${its.length}`));
    bars.append(row);
    setTimeout(() => (f.style.width = p + '%'), 120);
  });
  $('#retry-wrong').disabled = right === n;
  renderReview('wrong');
}
function renderReview(filter) {
  const box = $('#review'); box.innerHTML = '';
  const list = S.items.filter((it) => (filter === 'wrong' ? !isRight(it) : filter === 'flag' ? it.flagged : true));
  if (!list.length) { box.append(el('div', 'empty', filter === 'wrong' ? 'No mistakes — brilliant.' : 'Nothing here.')); return; }
  list.forEach((it) => {
    const ok = isRight(it), c = el('div', 'rv'); c.style.setProperty('--c', ok ? 'var(--green)' : 'var(--red)');
    const a = el('div', 'a');
    const ci = correctIdx(it);
    if (!ok) { a.append('Your answer: '); const b = el('b', 'no', it.chosen == null ? 'not answered' : `${KEYS[it.chosen]}. ${it.q.options[it.order[it.chosen]]}`); a.append(b, el('br')); }
    a.append('Correct: '); a.append(el('b', 'ok', `${KEYS[ci]}. ${it.q.options[it.q.answer]}`));
    c.append(el('div', 'q', it.q.stem), a, el('div', 'e', it.q.explain), el('div', 'r', it.q.ref));
    box.append(c);
  });
}
segPick('#rev-filter', (b) => renderReview(b.dataset.f));
$('#retry-wrong').onclick = () => { const wrong = S.items.filter((it) => !isRight(it)).map((it) => it.q); if (wrong.length) newSession(shuffle(wrong)); };
$('#restart').onclick = () => { S = null; show('start'); };

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
  if (!S || $('#v-q').classList.contains('hidden')) return;
  const k = e.key.toUpperCase();
  const n = '12345'.indexOf(k) >= 0 ? '12345'.indexOf(k) : KEYS.indexOf(k);
  if (n >= 0 && k.length === 1 && k !== 'F') { choose(n); return; }
  if (k === 'F') { $('#flag').click(); return; }
  if (e.key === 'Enter' || e.key === 'ArrowRight') { if (!$('#next').disabled) $('#next').click(); e.preventDefault(); }
  if (e.key === 'ArrowLeft') $('#prev').click();
});
