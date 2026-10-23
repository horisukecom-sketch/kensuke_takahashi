// ことばレンズ 解析エンジン：分かち書き・集計・各ビューの描画
// 使い方：結果エリアと解析条件のマークアップを置いたページで KotobaLens.init() し、KotobaLens.setText(text) で文章を渡す
(() => {
'use strict';
const $ = s => document.querySelector(s);

const STOP_DEFAULT = 'こと もの ため よう これ それ あれ ところ とき 感じ 自分 私 今回 場合 部分 方 的 等 中 上 下 前 後 毎 少し もう 一番 とても 特に すぐ 最後 たい ほしい しい もう少し 分';

const TYPES = [
  {id:'kanji', label:'漢字', color:'--c1'},
  {id:'kata',  label:'カタカナ', color:'--c2'},
  {id:'alpha', label:'英数字', color:'--c3'},
  {id:'mixed', label:'混在', color:'--c4'},
  {id:'hira',  label:'ひらがな', color:'--c5'},
];
const TYPE_BY_ID = Object.fromEntries(TYPES.map(t => [t.id, t]));
function wordType(w){
  if (/^[\p{Script=Han}々〆ヶ]+$/u.test(w)) return 'kanji';
  if (/^[\p{Script=Katakana}ー・]+$/u.test(w)) return 'kata';
  if (/^[\p{Script=Hiragana}ー]+$/u.test(w)) return 'hira';
  if (/^[a-z0-9][a-z0-9'_.-]*$/i.test(w)) return 'alpha';
  return 'mixed';
}

// 分かち書き：Intl.Segmenter（辞書ベースの単語分割）を使い、無い環境では文字種の切れ目で分ける
const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', {granularity:'word'}) : null;
function tokenize(s){
  if (segmenter) {
    const out = [];
    for (const x of segmenter.segment(s)) if (x.isWordLike) out.push(x.segment);
    return out;
  }
  return s.match(/[\p{Script=Han}々〆ヶ]+|[\p{Script=Katakana}ー]+|[\p{Script=Hiragana}ー]+|[a-zA-Z0-9]+/gu) || [];
}

function splitUnits(text, mode){
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (mode === 'line') return lines;
  return lines.flatMap(l => l.split(/(?<=[。．！？!?])/).map(s => s.trim()).filter(Boolean));
}

const state = {text:'', units:[], unitSets:[], freq:new Map(), df:new Map(), bigram:new Map(), rows:[]};
let emptyMessage = '語が見つかりません。原文を入力するか、解析条件をゆるめてください。';

function readOpts(){
  return {
    unit: $('#unit').value,
    minLen: Math.max(1, parseInt($('#minLen').value, 10) || 1),
    kanji1: $('#kanji1').checked,
    noHira: $('#noHira').checked,
    noNum: $('#noNum').checked,
    stop: new Set($('#stop').value.normalize('NFKC').toLowerCase().split(/[\s,、，]+/).filter(Boolean)),
  };
}

function analyze(){
  const o = readOpts();
  const text = state.text.normalize('NFKC');
  const keep = w => {
    if (o.stop.has(w)) return false;
    const t = wordType(w);
    if (o.noNum && /^[0-9.,]+$/.test(w)) return false;
    if (o.noHira && t === 'hira') return false;
    const len = [...w].length;
    if (len < o.minLen && !(o.kanji1 && t === 'kanji' && len === 1)) return false;
    return true;
  };
  const units = splitUnits(text, o.unit);
  const freq = new Map(), df = new Map(), bigram = new Map(), unitSets = [];
  for (const u of units) {
    const kept = tokenize(u).map(w => w.toLowerCase()).map(w => keep(w) ? w : null);
    const set = new Set();
    kept.forEach((w, i) => {
      if (!w) return;
      freq.set(w, (freq.get(w) || 0) + 1);
      set.add(w);
      const nx = kept[i + 1];
      if (nx) { const k = w + '\u0000' + nx; bigram.set(k, (bigram.get(k) || 0) + 1); }
    });
    for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    unitSets.push(set);
  }
  const rows = [...freq].map(([w, n]) => ({w, n, df: df.get(w), t: wordType(w)}))
    .sort((a, b) => b.n - a.n || b.df - a.df || a.w.localeCompare(b.w, 'ja'));
  Object.assign(state, {units, unitSets, freq, df, bigram, rows});

  const chars = text.replace(/\s/g, '').length;
  const sentences = splitUnits(text, 'sentence').length;
  const lines = splitUnits(text, 'line').length;
  const total = rows.reduce((s, r) => s + r.n, 0);
  renderStats([
    [chars.toLocaleString(), '文字数'],
    [lines.toLocaleString(), '行（件）'],
    [sentences.toLocaleString(), '文'],
    [total.toLocaleString(), '延べ語数'],
    [rows.length.toLocaleString(), '異なり語数'],
    [sentences ? (chars / sentences).toFixed(1) : '0', '平均文長（字）'],
  ]);
  renderFreq(); renderNgram(); renderActive();
  if ($('#kwicQ').value) renderKwic($('#kwicQ').value);
}

function renderStats(items){
  $('#stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chip = t => `<span class="chip"><i style="background:var(${TYPE_BY_ID[t].color})"></i>${TYPE_BY_ID[t].label}</span>`;

function renderFreq(){
  const n = +$('#topN').value;
  const rows = state.rows.slice(0, n);
  if (!rows.length) { $('#freqTable').innerHTML = `<tbody><tr><td class="empty">${esc(emptyMessage)}</td></tr></tbody>`; return; }
  const max = rows[0].n;
  $('#freqTable').innerHTML = `<thead><tr><th class="num">順位</th><th>語</th><th>文字種</th><th class="num">出現回数</th><th class="num">出現文書</th><th></th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="word"><button type="button" data-kwic="${esc(r.w)}">${esc(r.w)}</button></td><td>${chip(r.t)}</td><td class="num">${r.n}</td><td class="num">${r.df}</td><td class="barcell"><div class="bar" style="width:${(r.n / max * 100).toFixed(1)}%"></div></td></tr>`).join('') + '</tbody>';
}

function renderNgram(){
  const rows = [...state.bigram].map(([k, n]) => ({k: k.split('\u0000'), n})).filter(r => r.n >= 2)
    .sort((a, b) => b.n - a.n || a.k.join('').localeCompare(b.k.join(''), 'ja')).slice(0, 60);
  if (!rows.length) { $('#ngramTable').innerHTML = `<tbody><tr><td class="empty">2回以上続けて現れる語の組はありません。</td></tr></tbody>`; return; }
  const max = rows[0].n;
  $('#ngramTable').innerHTML = `<thead><tr><th class="num">順位</th><th>語の並び</th><th class="num">回数</th><th></th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr><td class="num">${i + 1}</td><td class="word"><button type="button" data-kwic="${esc(r.k[0])}">${esc(r.k[0])}</button> → <button type="button" data-kwic="${esc(r.k[1])}">${esc(r.k[1])}</button></td><td class="num">${r.n}</td><td class="barcell"><div class="bar" style="width:${(r.n / max * 100).toFixed(1)}%"></div></td></tr>`).join('') + '</tbody>';
}

// ---------- KWIC ----------
function renderKwic(q){
  q = q.normalize('NFKC').trim();
  $('#kwicQ').value = q;
  if (!q) { $('#kwicTable').innerHTML = ''; $('#kwicInfo').textContent = ''; return; }
  const W = 24, hits = [];
  const needle = q.toLowerCase();
  state.units.forEach((u, ui) => {
    const low = u.toLowerCase();
    let i = low.indexOf(needle);
    while (i !== -1 && hits.length < 500) {
      hits.push({ui, l: u.slice(Math.max(0, i - W), i), k: u.slice(i, i + q.length), r: u.slice(i + q.length, i + q.length + W)});
      i = low.indexOf(needle, i + needle.length);
    }
  });
  const unitName = $('#unit').value === 'line' ? '行' : '文';
  $('#kwicInfo').textContent = hits.length ? `「${q}」は ${hits.length} 箇所に出現（${new Set(hits.map(h => h.ui)).size} ${unitName}）` : `「${q}」は原文に見つかりませんでした。`;
  $('#kwicTable').innerHTML = hits.length ? `<thead><tr><th class="num">${unitName}</th><th style="text-align:right">前の文脈</th><th>語</th><th>後の文脈</th></tr></thead><tbody>` +
    hits.map(h => `<tr><td class="num">${h.ui + 1}</td><td class="l"><span>${esc(h.l)}</span></td><td class="k"><mark>${esc(h.k)}</mark></td><td class="r">${esc(h.r)}</td></tr>`).join('') + '</tbody>' : '';
}
function showKwic(w){ selectTab('kwic'); renderKwic(w); }

// ---------- canvas helpers ----------
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function setupCanvas(cv, h){
  const w = cv.parentElement.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return {ctx, w, h};
}
function canvasEmpty(ctx, w, h, msg){
  ctx.fillStyle = css('--muted'); ctx.font = `14px ${css('--body')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}
function pointer(cv, e){ const r = cv.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; }
// 大きく表示するページでは --canvas-scale で縦幅を広げる
const canvasScale = () => parseFloat(css('--canvas-scale')) || 1;

// ---------- ワードクラウド ----------
let cloudHits = [];
function renderCloud(){
  const cv = $('#cloud');
  const box = cv.parentElement.clientWidth; if (!box) return;
  const H = Math.round(Math.max(320, Math.min(600, box * 0.6)) * canvasScale());
  const {ctx, w, h} = setupCanvas(cv, H);
  const words = state.rows.slice(0, +$('#cloudN').value);
  cloudHits = [];
  if (!words.length) { canvasEmpty(ctx, w, h, '表示できる語がありません'); return; }
  const maxN = words[0].n, minN = words[words.length - 1].n;
  // よく出た語ほど大きく濃く、少ない語ほど小さく薄く（出現回数に比例）
  const maxS = Math.min(96 * canvasScale(), w / 5.5), minS = Math.max(12, maxS / 7);
  const ratio = n => (n - minN) / ((maxN - minN) || 1);
  const font = css('--display'), accent = css('--accent');
  $('#typeLegend').innerHTML = `<span class="cloud-key"><b>よく出た語</b>ほど大きく濃く、<small>少ない語</small>ほど小さく薄く表示しています（最多 ${maxN} 回・最少 ${minN} 回）。語にカーソルを合わせると回数が出ます。</span>`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const placed = [];
  const overlaps = b => placed.some(p => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
  // 語の面積の合計が枠の約3割になるよう全体を拡大・縮小する（語が少ないときも枠いっぱいに広げる）
  const ks = words.map(r => maxN === minN ? 0.5 : ratio(r.n));
  const measure = (r, k, f) => {
    const size = (minS + (maxS - minS) * k) * f;
    ctx.font = `${k >= 0.5 ? 900 : 700} ${size.toFixed(1)}px ${font}`;
    return {size, tw: ctx.measureText(r.w).width};
  };
  const area = words.reduce((sum, r, i) => { const m = measure(r, ks[i], 1); return sum + m.tw * m.size * 1.05; }, 0);
  const top = measure(words[0], ks[0], 1);
  const f = Math.max(0.6, Math.min(Math.sqrt(0.3 * w * h / (area || 1)), 3, w * 0.8 / top.tw, h * 0.4 / top.size));
  words.forEach((r, i) => {
    const k = ks[i];
    const {size, tw} = measure(r, k, f);
    const th = size * 1.05, pad = 3;
    let spot = null;
    for (let t = 0; t < 2400; t++) {
      const a = t * 0.31, rad = 1.6 * a;
      const x = w / 2 + rad * Math.cos(a) * (w / h) - tw / 2;
      const y = h / 2 + rad * Math.sin(a) - th / 2;
      if (x < 4 || y < 4 || x + tw > w - 4 || y + th > h - 4) { if (rad > Math.max(w, h)) break; continue; }
      const b = {x: x - pad, y: y - pad, w: tw + pad * 2, h: th + pad * 2};
      if (!overlaps(b)) { spot = {x, y, b}; break; }
    }
    if (!spot) return;
    placed.push(spot.b);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.38 + 0.62 * k;
    ctx.fillText(r.w, spot.x, spot.y + th / 2);
    ctx.globalAlpha = 1;
    cloudHits.push({...spot.b, w0: r.w, n: r.n});
  });
}

// ---------- 共起ネットワーク ----------
let netHits = [];
function buildNetwork(){
  const N = +$('#netN').value, E = +$('#netE').value, minC = +$('#netMin').value;
  const top = state.rows.slice(0, N);
  const idx = new Map(top.map((r, i) => [r.w, i]));
  const co = new Map();
  for (const set of state.unitSets) {
    const ids = [...set].map(w => idx.get(w)).filter(i => i !== undefined).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i] * 1000 + ids[j]; co.set(k, (co.get(k) || 0) + 1);
    }
  }
  let edges = [...co].map(([k, c]) => {
    const a = Math.floor(k / 1000), b = k % 1000;
    return {a, b, c, j: c / (top[a].df + top[b].df - c)};
  }).filter(e => e.c >= minC).sort((x, y) => y.j - x.j || y.c - x.c).slice(0, E);
  const used = [...new Set(edges.flatMap(e => [e.a, e.b]))].sort((a, b) => a - b);
  const remap = new Map(used.map((o, i) => [o, i]));
  const nodes = used.map(o => ({...top[o]}));
  edges = edges.map(e => ({...e, a: remap.get(e.a), b: remap.get(e.b)}));
  return {nodes, edges};
}
function communities(n, edges){
  const adj = Array.from({length: n}, () => []);
  edges.forEach(e => { adj[e.a].push([e.b, e.j]); adj[e.b].push([e.a, e.j]); });
  const lab = Array.from({length: n}, (_, i) => i);
  for (let it = 0; it < 25; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const score = new Map();
      for (const [nb, wt] of adj[i]) score.set(lab[nb], (score.get(lab[nb]) || 0) + wt);
      let best = lab[i], bs = -1;
      for (const [l, s] of score) if (s > bs + 1e-9 || (Math.abs(s - bs) < 1e-9 && l < best)) { best = l; bs = s; }
      if (best !== lab[i]) { lab[i] = best; changed = true; }
    }
    if (!changed) break;
  }
  const sizes = new Map(); lab.forEach(l => sizes.set(l, (sizes.get(l) || 0) + 1));
  const rank = new Map([...sizes].sort((a, b) => b[1] - a[1]).map(([l], i) => [l, i]));
  return lab.map(l => rank.get(l));
}
function layout(nodes, edges){
  const n = nodes.length, k = 70;
  const P = nodes.map((_, i) => ({x: Math.cos(i * 2.399) * (20 + i * 4), y: Math.sin(i * 2.399) * (20 + i * 4)}));
  let temp = 60;
  for (let it = 0; it < 450; it++) {
    const D = P.map(() => ({x: 0, y: 0}));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = k * k / d;
      D[i].x += dx / d * f; D[i].y += dy / d * f; D[j].x -= dx / d * f; D[j].y -= dy / d * f;
    }
    for (const e of edges) {
      const dx = P[e.a].x - P[e.b].x, dy = P[e.a].y - P[e.b].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = d * d / k * (0.4 + e.j * 1.6);
      D[e.a].x -= dx / d * f; D[e.a].y -= dy / d * f; D[e.b].x += dx / d * f; D[e.b].y += dy / d * f;
    }
    for (let i = 0; i < n; i++) {
      D[i].x -= P[i].x * 0.6; D[i].y -= P[i].y * 0.6;
      const m = Math.sqrt(D[i].x ** 2 + D[i].y ** 2) || 1;
      P[i].x += D[i].x / m * Math.min(m, temp); P[i].y += D[i].y / m * Math.min(m, temp);
    }
    temp = Math.max(1, temp * 0.985);
  }
  return P;
}
let netCache = null;
function renderNet(){
  const cv = $('#net');
  const box = cv.parentElement.clientWidth; if (!box) return;
  const H = Math.round(Math.max(360, Math.min(640, box * 0.65)) * canvasScale());
  const {ctx, w, h} = setupCanvas(cv, H);
  const key = [$('#netN').value, $('#netE').value, $('#netMin').value, state.text.length, state.units.length, state.rows[0]?.w, $('#unit').value].join('|');
  if (!netCache || netCache.key !== key) {
    const g = buildNetwork();
    netCache = {key, ...g, com: communities(g.nodes.length, g.edges), P: layout(g.nodes, g.edges)};
  }
  const {nodes, edges, com, P} = netCache;
  netHits = [];
  renderEdgeTable(nodes, edges);
  if (!nodes.length) { canvasEmpty(ctx, w, h, '条件に合う共起がありません。最小共起回数を下げてください'); return; }
  const xs = P.map(p => p.x), ys = P.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const mx = Math.min(70, w * 0.12), my = 36;
  const s = Math.min((w - mx * 2) / ((maxX - minX) || 1), (h - my * 2) / ((maxY - minY) || 1));
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  const pt = p => ({x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s});
  const maxN = Math.max(...nodes.map(d => d.n));
  const palette = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(css);
  const maxJ = Math.max(...edges.map(e => e.j));
  ctx.strokeStyle = css('--muted');
  for (const e of edges) {
    const a = pt(P[e.a]), b = pt(P[e.b]);
    ctx.globalAlpha = 0.25 + 0.45 * (e.j / maxJ);
    ctx.lineWidth = 0.6 + 3.4 * (e.j / maxJ);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const surface = css('--surface'), ink = css('--ink'), muted = css('--muted'), font = css('--body');
  const sc = canvasScale();
  nodes.forEach((d, i) => {
    const p = pt(P[i]), r = (5 + 17 * Math.sqrt(d.n / maxN)) * sc;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = com[i] < palette.length ? palette[com[i]] : muted;
    ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5; ctx.strokeStyle = surface; ctx.stroke();
    netHits.push({x: p.x, y: p.y, r: Math.max(r, 12), w0: d.w});
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  nodes.forEach((d, i) => {
    const p = pt(P[i]);
    ctx.font = `700 ${Math.round((d.n / maxN > 0.5 ? 14 : 12) * sc)}px ${font}`;
    ctx.lineWidth = 4; ctx.strokeStyle = surface; ctx.strokeText(d.w, p.x, p.y);
    ctx.fillStyle = ink; ctx.fillText(d.w, p.x, p.y);
  });
}
function renderEdgeTable(nodes, edges){
  if (!edges.length) { $('#edgeTable').innerHTML = ''; return; }
  $('#edgeTable').innerHTML = `<thead><tr><th>語の組</th><th class="num">共起回数</th><th class="num">Jaccard</th></tr></thead><tbody>` +
    edges.slice(0, 20).map(e => `<tr><td class="word"><button type="button" data-kwic="${esc(nodes[e.a].w)}">${esc(nodes[e.a].w)}</button> ― <button type="button" data-kwic="${esc(nodes[e.b].w)}">${esc(nodes[e.b].w)}</button></td><td class="num">${e.c}</td><td class="num">${e.j.toFixed(3)}</td></tr>`).join('') +
    `</tbody>`;
}

// ---------- タブ ----------
let active = 'freq';
function selectTab(id){
  active = id;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'v-' + id);
  renderActive();
}
function renderActive(){
  if (active === 'cloud') renderCloud();
  if (active === 'net') renderNet();
}

function toast(msg){
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2400);
}

let timer = 0;
const schedule = () => { clearTimeout(timer); timer = setTimeout(analyze, 350); };

function init(opts = {}){
  if (opts.emptyMessage) emptyMessage = opts.emptyMessage;
  const engine = $('#engine');
  if (engine) engine.textContent = segmenter ? '分割方式：ブラウザ内蔵の日本語単語分割' : '分割方式：文字種の切れ目（簡易）';
  $('#stop').value = STOP_DEFAULT;

  document.addEventListener('click', e => { const b = e.target.closest('[data-kwic]'); if (b) showKwic(b.dataset.kwic); });
  $('#kwicForm').addEventListener('submit', e => { e.preventDefault(); renderKwic($('#kwicQ').value); });
  $('#cloud').addEventListener('mousemove', e => {
    const p = pointer($('#cloud'), e);
    const hit = cloudHits.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    $('#cloud').title = hit ? `${hit.w0}：${hit.n} 回` : '';
  });
  $('#cloud').addEventListener('click', e => {
    const p = pointer($('#cloud'), e);
    const hit = cloudHits.find(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (hit) showKwic(hit.w0);
  });
  $('#net').addEventListener('click', e => {
    const p = pointer($('#net'), e);
    const hit = netHits.find(n => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 <= n.r * n.r);
    if (hit) showKwic(hit.w0);
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  ['#unit', '#minLen', '#kanji1', '#noHira', '#noNum'].forEach(s => $(s).addEventListener('change', analyze));
  $('#stop').addEventListener('input', schedule);
  $('#run')?.addEventListener('click', analyze);
  $('#topN').addEventListener('change', renderFreq);
  [['#cloudN', '#cloudNo', renderCloud], ['#netN', '#netNo', renderNet], ['#netE', '#netEo', renderNet], ['#netMin', '#netMino', renderNet]].forEach(([i, o, fn]) => {
    $(i).addEventListener('input', () => { $(o).textContent = $(i).value; fn(); });
  });

  $('#copyFreq').addEventListener('click', () => {
    const q = s => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const csv = ['順位,語,文字種,出現回数,出現文書', ...state.rows.map((r, i) => [i + 1, q(r.w), TYPE_BY_ID[r.t].label, r.n, r.df].join(','))].join('\n');
    const out = $('#csvOut');
    const fallback = () => { out.value = csv; out.hidden = false; out.focus(); out.select(); toast('自動でコピーできなかったため、表示した欄から選択してコピーしてください'); };
    try {
      navigator.clipboard.writeText(csv).then(() => { out.hidden = true; toast(`${state.rows.length}語のCSVをコピーしました`); }, fallback);
    } catch (_) { fallback(); }
  });

  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderActive, 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', renderActive);
  new MutationObserver(renderActive).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  document.fonts?.ready.then(renderActive);

  const h = location.hash.slice(1);
  if (opts.defaultTab) active = opts.defaultTab;
  if (['freq', 'cloud', 'net', 'ngram', 'kwic'].includes(h)) active = h;
  selectTab(active);
}

window.KotobaLens = {
  init,
  // 文章を差し替えて解析する（immediate=false なら入力中の連打をまとめる）
  setText(text, immediate = true){ state.text = text; immediate ? analyze() : schedule(); },
  analyze, renderActive, selectTab, toast,
};
})();
