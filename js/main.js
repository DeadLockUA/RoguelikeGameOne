// Экраны и игровой цикл
import { CARDS, HEROES, RUMORS, DUNGEONS, QUESTS, UNLOCKS, STORY, EVENTS } from './data.js';
import { meta, load, save, resetAll, newRun, pickEvent, randomCardFromPool, pick, shuffle, rand, cardPool } from './state.js';
import { Battle, cardHTML, iconHTML, makeWave } from './battle.js';
import { sfx, setSound } from './audio.js';

const app = document.getElementById('app');
let battle = null;

const NODE_INFO = {
  wave: { icon: '⚔️', name: 'Волна героев' },
  elite: { icon: '☠️', name: 'Элитный отряд' },
  shop: { icon: '🛒', name: 'Лавка Шныги' },
  event: { icon: '❓', name: 'Событие' },
  rest: { icon: '🛏️', name: 'Передышка' },
  boss: { icon: '👑', name: 'Избранный' },
};

// ---------- общие UI-хелперы ----------
function modal(html, { onClose, cls = '', lock = false } = {}) {
  const m = document.createElement('div');
  m.className = 'modal-back';
  m.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); onClose && onClose(); };
  m.addEventListener('click', (e) => { if ((e.target === m && !lock) || e.target.closest('[data-close]')) { sfx.tap(); close(); } });
  return { el: m.querySelector('.modal'), close };
}

function cardDetail(id) {
  const c = CARDS[id];
  const rar = { common: 'обычная', uncommon: 'необычная', rare: 'редкая' }[c.rarity];
  return `<div class="card-detail">${cardHTML(id, 'big')}<div><b>${c.name}</b> <small>· ${c.cost}⚡ · ${rar}</small><p>${c.text}</p><p class="flavor">${c.flavor}</p></div></div>`;
}

function showPile(list, title, discard = null) {
  const sorted = list.slice().sort();
  let html = `<h2>${title}</h2><div class="pile-grid">${sorted.map((id) => cardHTML(id)).join('') || '<p>Пусто</p>'}</div>`;
  if (discard) html += `<h3>Сброс</h3><div class="pile-grid">${discard.slice().sort().map((id) => cardHTML(id)).join('') || '<p>Пусто</p>'}</div>`;
  html += '<p class="hint">Тапни карту, чтобы прочитать.</p><button data-close class="btn">Закрыть</button>';
  const m = modal(html);
  m.el.addEventListener('click', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    const box = document.createElement('div');
    box.className = 'detail-pop';
    box.innerHTML = cardDetail(c.dataset.card);
    m.el.querySelectorAll('.detail-pop').forEach((x) => x.remove());
    m.el.prepend(box);
    m.el.scrollTop = 0;
  });
}

function showRumors() {
  const run = meta.run;
  const html = `<h2>📜 Слухи в таверне</h2>
  <p class="hint">Выжившие герои рассказывают о твоих трюках. Следующие гости готовятся. Максимум 3 слуха, новые вытесняют старые.</p>
  ${run.rumors.length ? run.rumors.map((r) => `<div class="rumor"><p>${RUMORS[r.key].quote.replace('%n', r.by)}</p><b>${RUMORS[r.key].effect}</b></div>`).join('') : '<p>Пока тихо. Никто не выжил, чтобы рассказать. 😈</p>'}
  <button data-close class="btn">Закрыть</button>`;
  modal(html);
}

function questTitle(id) { return QUESTS[id].title; }

function questsHTML(run) {
  return run.quests.map((q) => {
    const d = QUESTS[q.id];
    return `<div class="quest ${q.done ? 'done' : ''}"><b>${q.done ? '✅' : '⭐'.repeat(d.stars)} ${d.title}</b><span>${d.text} (${q.p}/${d.goal})</span></div>`;
  }).join('');
}

function showStory(id, then) {
  const ch = STORY.find((s) => s.id === id);
  if (!ch) { then && then(); return; }
  if (!meta.story.includes(id)) { meta.story.push(id); save(); }
  let i = 0;
  const m = modal(`<div class="story"><h2>${ch.title}</h2><p class="story-text"></p><button class="btn btn-next">Дальше</button></div>`, { cls: 'story-modal', lock: true, onClose: () => then && then() });
  const p = m.el.querySelector('.story-text'), b = m.el.querySelector('.btn-next');
  const show = () => { p.textContent = ch.text[i]; p.classList.remove('fadein'); void p.offsetWidth; p.classList.add('fadein'); b.textContent = i === ch.text.length - 1 ? 'Понятно' : 'Дальше'; };
  show();
  b.onclick = () => { sfx.tap(); i++; if (i >= ch.text.length) m.close(); else show(); };
}

function maybeStory(id, then) {
  if (meta.story.includes(id)) then && then();
  else showStory(id, then);
}

// ---------- главное меню ----------
function menu() {
  battle && battle.destroy(); battle = null;
  const run = meta.run;
  app.innerHTML = `
  <div class="screen menu">
    <div class="logo"><div class="logo-hole">🕳️</div><h1>Дыра</h1><p>подземелье, которое отвечает</p></div>
    <div class="menu-btns">
      ${run ? '<button class="btn big btn-cont">▶ Продолжить забег</button>' : ''}
      <button class="btn big btn-new">${run ? '✦ Новый забег' : '▶ Играть'}</button>
      <button class="btn btn-lair">🏚️ Логово <small>⭐ ${meta.stars}</small></button>
      <button class="btn btn-journal">📖 Дневник</button>
      <button class="btn btn-how">❔ Как играть</button>
      <button class="btn btn-set">⚙️ Настройки</button>
    </div>
    <div class="menu-foot">Забегов: ${meta.stats.runs} · Побед: ${meta.stats.wins} · Героев погибло: ${meta.stats.kills}</div>
  </div>`;
  const q = (s) => app.querySelector(s);
  q('.btn-cont')?.addEventListener('click', () => { sfx.tap(); mapScreen(); });
  q('.btn-new').addEventListener('click', () => {
    sfx.tap();
    if (meta.run) {
      const m = modal(`<h2>Начать заново?</h2><p>Текущий забег будет потерян. Звёзды за него не начислятся.</p><button class="btn btn-yes">Да, новый</button><button class="btn" data-close>Отмена</button>`);
      m.el.querySelector('.btn-yes').onclick = () => { m.close(); meta.run = null; save(); chooseDungeon(); };
    } else maybeStory('prologue', chooseDungeon);
  });
  q('.btn-lair').addEventListener('click', () => { sfx.tap(); lair(); });
  q('.btn-journal').addEventListener('click', () => { sfx.tap(); journal(); });
  q('.btn-how').addEventListener('click', () => { sfx.tap(); howTo(); });
  q('.btn-set').addEventListener('click', () => { sfx.tap(); settings(); });
}

function chooseDungeon() {
  const opts = Object.entries(DUNGEONS).filter(([id]) => id === 'hole' || meta.unlocked.includes(id));
  if (opts.length === 1) { startRun('hole'); return; }
  const m = modal(`<h2>Кем играем?</h2>${opts.map(([id, d]) => `<button class="dungeon-opt" data-id="${id}"><span class="emo big">${d.icon}</span><div><b>${d.name}</b><small>${d.desc}</small><small class="passive">${d.passive}</small><small>Сердце: ${d.heart}❤</small></div></button>`).join('')}<button class="btn" data-close>Отмена</button>`);
  m.el.addEventListener('click', (e) => { const b = e.target.closest('.dungeon-opt'); if (!b) return; m.close(); startRun(b.dataset.id); });
}

function startRun(id) {
  newRun(id);
  mapScreen();
}

// ---------- карта забега ----------
function mapScreen() {
  battle && battle.destroy(); battle = null;
  const run = meta.run;
  if (!run) return menu();
  const d = DUNGEONS[run.dungeon];
  const layers = run.map.map((layer, li) => {
    const nodes = layer.map((n, ni) => {
      const info = NODE_INFO[n.type];
      let st = 'locked';
      if (li < run.layer) st = run.chosen[li] === ni ? 'done' : 'skipped';
      if (li === run.layer) st = 'avail';
      let sub = '';
      if ((n.type === 'wave' || n.type === 'elite' || n.type === 'boss') && li <= run.layer + 1) {
        if (!n.wave) n.wave = makeWave(n, { ...run, layer: li });
        sub = `<div class="party">${n.wave.list.map((c) => HEROES[c].icon).join('')}</div>`;
      }
      return `<button class="node n-${n.type} ${st}" data-l="${li}" data-i="${ni}" ${st !== 'avail' ? 'disabled' : ''}><span class="emo">${info.icon}</span><small>${info.name}</small>${sub}</button>`;
    }).join('');
    return `<div class="layer ${li === run.layer ? 'cur' : ''}"><div class="lnum">${li + 1}</div>${nodes}</div>`;
  }).reverse().join('');
  save();
  app.innerHTML = `
  <div class="screen map">
    <div class="topbar">
      <div class="stat">${d.icon} <b>${d.name}</b></div>
      <div class="stat">💖 <b>${run.heart}/${run.heartMax}</b></div>
      <div class="stat">💰 <b>${run.gold}</b></div>
      <button class="iconbtn btn-menu">☰</button>
    </div>
    <div class="map-scroll"><div class="map-title">Путь к Избранному</div>${layers}</div>
    <div class="map-bottom">
      <div class="quests">${questsHTML(run)}</div>
      <div class="row"><button class="btn btn-deck">🂠 Колода (${run.deck.length})</button><button class="btn btn-rum">📜 Слухи (${run.rumors.length})</button></div>
    </div>
  </div>`;
  app.querySelector('.layer.cur')?.scrollIntoView({ block: 'center' });
  app.querySelectorAll('.node.avail').forEach((b) => b.addEventListener('click', () => { sfx.tap(); enterNode(+b.dataset.l, +b.dataset.i); }));
  app.querySelector('.btn-deck').addEventListener('click', () => { sfx.tap(); showPile(run.deck, 'Твоя колода'); });
  app.querySelector('.btn-rum').addEventListener('click', () => { sfx.tap(); showRumors(); });
  app.querySelector('.btn-menu').addEventListener('click', () => { sfx.tap(); menu(); });
}

function enterNode(li, ni) {
  const run = meta.run;
  const n = run.map[li][ni];
  run.chosen[li] = ni;
  run.pending = { l: li, i: ni };
  save();
  if (n.type === 'wave' || n.type === 'elite' || n.type === 'boss') {
    if (n.type === 'boss') { meta.stats.bossSeen++; maybeStory('firstBoss', () => startBattle(n)); }
    else startBattle(n);
  } else if (n.type === 'shop') shop();
  else if (n.type === 'event') eventScreen();
  else if (n.type === 'rest') rest();
}

function advance() {
  const run = meta.run;
  run.layer++;
  run.pending = null;
  save();
  mapScreen();
}

// ---------- бой ----------
function startBattle(n) {
  const run = meta.run;
  // снимок сетки для повтора, если игра закрылась во время боя
  if (!run.gridSnap) run.gridSnap = JSON.stringify({ grid: run.grid, gold: run.gold, heart: run.heart, rumors: run.rumors, quests: run.quests, stats: run.stats });
  save();
  battle = new Battle(app, run, n, {
    onEnd: (sum) => { run.gridSnap = null; save(); sum.win ? waveWon(n, sum) : runLost(sum); },
    showRumors, showPile, questTitle,
    showMenu: () => battleMenu(),
  });
}

function battleMenu() {
  const m = modal(`<h2>Пауза</h2>
    <button class="btn btn-q">⭐ Квесты</button>
    <button class="btn btn-help">❔ Как играть</button>
    <button class="btn btn-snd">${meta.settings.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'}</button>
    <button class="btn btn-exit">🏠 В меню (бой начнётся заново)</button>
    <button class="btn" data-close>Продолжить</button>`);
  m.el.querySelector('.btn-q').onclick = () => { m.close(); modal(`<h2>Квесты забега</h2>${questsHTML(meta.run)}<button class="btn" data-close>Ок</button>`); };
  m.el.querySelector('.btn-help').onclick = () => { m.close(); howTo(true); };
  m.el.querySelector('.btn-snd').onclick = (e) => { meta.settings.sound = !meta.settings.sound; setSound(meta.settings.sound); save(); e.target.textContent = meta.settings.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; };
  m.el.querySelector('.btn-exit').onclick = () => { m.close(); restoreSnap(); menu(); };
}

function restoreSnap() {
  const run = meta.run;
  if (run && run.gridSnap) {
    const s = JSON.parse(run.gridSnap);
    Object.assign(run, s);
    run.gridSnap = null;
    save();
  }
}

function waveWon(n, sum) {
  const run = meta.run;
  if (n.type === 'boss') { runWon(sum); return; }
  const gold = sum.gold;
  const m = modal(`<h2>Волна отбита! 🎉</h2>
    <div class="sum"><div>💀 Погибло: <b>${sum.kills}</b></div><div>😱 Сбежало от страха: <b>${sum.flees}</b></div><div>🏃 Ушло живыми: <b>${sum.escapes}</b></div><div>💰 Добыча: <b>${gold >= 0 ? '+' : ''}${gold}</b></div><div>💖 Сердце: <b>-${Math.max(0, sum.heartLost)}</b></div></div>
    <button class="btn big btn-ok">Забрать награду</button>`, { lock: true });
  m.el.querySelector('.btn-ok').onclick = () => { sfx.tap(); m.close(); openReward(n.type === 'elite', advance); };
}

function openReward(rare, then) {
  const ex = [];
  const opts = [];
  for (let i = 0; i < 3; i++) {
    const id = randomCardFromPool(rare && i === 0 ? 'rare' : null, ex);
    ex.push(id); opts.push(id);
  }
  const m = modal(`<h2>Выбери карту в колоду</h2><div class="reward">${opts.map((id) => `<div class="ropt" data-id="${id}">${cardDetail(id)}</div>`).join('')}</div><button class="btn btn-skip">Пропустить (+3💰)</button>`, { lock: true, onClose: () => then && then() });
  m.el.addEventListener('click', (e) => {
    const o = e.target.closest('.ropt');
    if (o) { sfx.coin(); meta.run.deck.push(o.dataset.id); save(); m.close(); }
  });
  m.el.querySelector('.btn-skip').onclick = () => { meta.run.gold += 3; save(); m.close(); };
}

function openRemove(goldBonus, then, cost = 0) {
  const run = meta.run;
  const m = modal(`<h2>Убрать карту из колоды</h2>${cost ? `<p>Цена: ${cost}💰</p>` : ''}<div class="pile-grid">${run.deck.map((id, i) => cardHTML(id).replace('data-card', `data-i="${i}" data-card`)).join('')}</div><button class="btn" data-close>Отмена</button>`, { onClose: () => then && then() });
  m.el.addEventListener('click', (e) => {
    const c = e.target.closest('.card'); if (!c) return;
    if (run.deck.length <= 5) { alert('В колоде должно остаться хотя бы 5 карт.'); return; }
    run.deck.splice(+c.dataset.i, 1);
    run.gold += goldBonus - cost;
    sfx.coin(); save(); m.close();
  });
}

function computeStars(win) {
  const run = meta.run;
  let s = run.stats.waves;
  if (win) s += 5;
  for (const q of run.quests) if (q.done) s += QUESTS[q.id].stars;
  return s;
}

function runLost(sum) {
  const run = meta.run;
  const stars = computeStars(false);
  meta.stars += stars; meta.totalStars += stars; meta.stats.deaths++;
  const d = DUNGEONS[run.dungeon];
  meta.run = null; save();
  app.innerHTML = `<div class="screen result lose">
    <div class="big-emo">💔</div><h1>Сердце разбито</h1>
    <p class="quote">«${pick(['Закрыто на ремонт. Приходите позже.', 'Гильдия поставила одну звезду. С жалостью.', 'Тут мог быть ваш торговый центр.', 'Ничего, у подземелий вечность впереди.'])}»</p>
    <div class="sum"><div>Подземелье: <b>${d.name}</b></div><div>Волн пройдено: <b>${run.stats.waves}</b></div><div>Героев погибло: <b>${run.stats.kills}</b></div><div>Сбежало в ужасе: <b>${run.stats.flees}</b></div><div>Добыто золота: <b>${run.stats.gold}</b></div></div>
    <div class="quests">${questsHTML(run)}</div>
    <div class="stars-got">+${stars} ⭐</div>
    <button class="btn big btn-ok">Дальше</button></div>`;
  app.querySelector('.btn-ok').onclick = () => { sfx.tap(); maybeStory('firstDeath', menu); };
}

function runWon() {
  const run = meta.run;
  const stars = computeStars(true);
  meta.stars += stars; meta.totalStars += stars; meta.stats.wins++;
  const d = DUNGEONS[run.dungeon];
  meta.run = null; save();
  app.innerHTML = `<div class="screen result win">
    <div class="big-emo">🏆</div><h1>Избранный повержен!</h1>
    <p class="quote">«${pick(['Пророчество, конечно, неловко вышло.', 'Сюжетная броня оказалась из фольги.', 'Гильдия срочно переписывает учебники.'])}»</p>
    <div class="sum"><div>Подземелье: <b>${d.name}</b></div><div>Волн пройдено: <b>${run.stats.waves}</b></div><div>Героев погибло: <b>${run.stats.kills}</b></div><div>Сбежало в ужасе: <b>${run.stats.flees}</b></div><div>Добыто золота: <b>${run.stats.gold}</b></div></div>
    <div class="quests">${questsHTML(run)}</div>
    <div class="stars-got">+${stars} ⭐</div>
    <button class="btn big btn-ok">Дальше</button></div>`;
  const w = meta.stats.wins;
  const chain = (ids) => { const id = ids.shift(); if (!id) return menu(); maybeStory(id, () => chain(ids)); };
  app.querySelector('.btn-ok').onclick = () => { sfx.tap(); chain([w >= 1 ? 'firstWin' : null, w >= 2 ? 'secondWin' : null, w >= 5 ? 'fiveWins' : null].filter(Boolean)); };
}

// ---------- лавка ----------
const PRICE = { common: 5, uncommon: 9, rare: 14 };
function shop() {
  const run = meta.run;
  if (!run.shopStock) {
    const ex = [];
    run.shopStock = [];
    for (let i = 0; i < 5; i++) { const id = randomCardFromPool(i === 4 ? 'rare' : null, ex); ex.push(id); run.shopStock.push({ id, sold: false }); }
    run.shopServices = { heal: false, remove: false };
    save();
  }
  const render = () => {
    app.innerHTML = `<div class="screen shop">
      <div class="topbar"><div class="stat">🛒 <b>Лавка гоблина Шныги</b></div><div class="stat">💖 <b>${run.heart}/${run.heartMax}</b></div><div class="stat">💰 <b>${run.gold}</b></div></div>
      <p class="npc">👺 «${pick(['Бери-бери, гарантия до первой смерти!', 'Скидок нет. Есть только наценки.', 'Всё честно добыто. С трупов.', 'Возврат не принимаем. Мёртвые тоже.'])}»</p>
      <div class="stock">${run.shopStock.map((s, i) => `<div class="sitem ${s.sold ? 'sold' : ''}" data-i="${i}">${cardHTML(s.id)}<div class="price">${s.sold ? 'Продано' : PRICE[CARDS[s.id].rarity] + '💰'}</div></div>`).join('')}</div>
      <div class="services">
        <button class="btn sv-heal" ${run.shopServices.heal || run.gold < 6 ? 'disabled' : ''}>🩹 Сердце +4❤ — 6💰</button>
        <button class="btn sv-remove" ${run.shopServices.remove || run.gold < 7 ? 'disabled' : ''}>🗑️ Убрать карту — 7💰</button>
      </div>
      <div class="detail-slot"><p class="hint">Тапни карту, чтобы рассмотреть. Тапни ещё раз — купить.</p></div>
      <button class="btn big btn-leave">Уйти</button>
    </div>`;
    let selected = -1;
    app.querySelectorAll('.sitem').forEach((el) => el.addEventListener('click', () => {
      const i = +el.dataset.i; const s = run.shopStock[i];
      if (s.sold) return;
      const price = PRICE[CARDS[s.id].rarity];
      if (selected === i) {
        if (run.gold < price) { app.querySelector('.detail-slot').innerHTML = '<p class="hint">Шныга: «Денег нет — иди героев убивай».</p>'; return; }
        run.gold -= price; s.sold = true; run.deck.push(s.id); sfx.coin(); save(); render(); return;
      }
      selected = i; sfx.tap();
      app.querySelectorAll('.sitem').forEach((x) => x.classList.toggle('sel', +x.dataset.i === i));
      app.querySelector('.detail-slot').innerHTML = cardDetail(s.id) + `<p class="hint">Тапни ещё раз, чтобы купить за ${price}💰</p>`;
    }));
    app.querySelector('.sv-heal').onclick = () => { run.gold -= 6; run.heart = Math.min(run.heartMax, run.heart + 4); run.shopServices.heal = true; sfx.coin(); save(); render(); };
    app.querySelector('.sv-remove').onclick = () => { openRemove(0, () => render(), 7); };
    app.querySelector('.btn-leave').onclick = () => { sfx.tap(); run.shopStock = null; advance(); };
  };
  render();
}

// ---------- события ----------
function eventCtx(run, after) {
  return {
    run,
    addRumor: (k, by) => { const i = run.rumors.findIndex((x) => x.key === k); if (i >= 0) run.rumors.splice(i, 1); run.rumors.push({ key: k, by }); if (run.rumors.length > 3) run.rumors.shift(); },
    healHeart: (n) => { run.heart = Math.min(run.heartMax, run.heart + n); },
    randomCard: (r) => randomCardFromPool(r),
    destroyRandom: (n) => {
      const list = [];
      run.grid.forEach((row, r) => row.forEach((t, c) => { if (t.f || t.m) list.push(t); }));
      const ch = shuffle(list).slice(0, n);
      ch.forEach((t) => { if (t.m) t.m = null; else t.f = null; });
      return ch.length;
    },
    openRemove: (bonus) => openRemove(bonus, after),
    openReward: (rare) => openReward(rare, after),
  };
}

function eventScreen() {
  const run = meta.run;
  if (!run.curEvent) { run.curEvent = pickEvent(run).id; save(); }
  const ev = EVENTS.find((e) => e.id === run.curEvent);
  const done = () => { run.curEvent = null; advance(); };
  const ctx = eventCtx(run, done);
  app.innerHTML = `<div class="screen event">
    <div class="ev-icon">${ev.icon}</div><h2>${ev.title}</h2><p class="ev-text">${ev.text}</p>
    <div class="ev-opts">${ev.options.map((o, i) => `<button class="btn ev-opt" data-i="${i}" ${o.need && !o.need(ctx) ? 'disabled' : ''}>${o.label}</button>`).join('')}</div>
    <div class="topbar bottom"><div class="stat">💖 <b>${run.heart}/${run.heartMax}</b></div><div class="stat">💰 <b>${run.gold}</b></div></div>
  </div>`;
  app.querySelectorAll('.ev-opt').forEach((b) => b.addEventListener('click', () => {
    sfx.tap();
    const res = ev.options[+b.dataset.i].act(ctx);
    save();
    if (res === null) return; // откроется модалка
    const m = modal(`<h2>${ev.icon} ${ev.title}</h2><p>${res}</p><button class="btn big" data-close>Дальше</button>`, { lock: true, onClose: done });
  }));
}

// ---------- отдых ----------
function rest() {
  const run = meta.run;
  app.innerHTML = `<div class="screen event">
    <div class="ev-icon">🛏️</div><h2>Передышка</h2>
    <p class="ev-text">Героев нет. Капает вода, скелет Валера полирует кости. Можно заняться собой.</p>
    <div class="ev-opts">
      <button class="btn r-heal">💖 Отдохнуть: Сердце +6❤</button>
      <button class="btn r-rum" ${run.rumors.length ? '' : 'disabled'}>🤫 Пустить контрслух: убрать 2 слуха</button>
      <button class="btn r-rm">✂️ Медитация: убрать карту из колоды</button>
    </div></div>`;
  app.querySelector('.r-heal').onclick = () => { run.heart = Math.min(run.heartMax, run.heart + 6); sfx.coin(); advance(); };
  app.querySelector('.r-rum').onclick = () => { run.rumors.splice(0, 2); sfx.coin(); advance(); };
  app.querySelector('.r-rm').onclick = () => openRemove(0, advance);
}

// ---------- логово (мета) ----------
function lair() {
  const items = UNLOCKS.map((u) => {
    const owned = meta.unlocked.includes(u.id);
    if (u.type === 'card') {
      return `<div class="unlock ${owned ? 'owned' : ''}" data-id="${u.id}">${cardHTML(u.id)}<div><b>${CARDS[u.id].name}</b><small>${CARDS[u.id].text}</small></div><button class="btn sm" ${owned || meta.stars < u.cost ? 'disabled' : ''}>${owned ? 'Есть' : u.cost + '⭐'}</button></div>`;
    }
    const d = DUNGEONS[u.id];
    return `<div class="unlock ${owned ? 'owned' : ''}" data-id="${u.id}"><span class="emo big">${d.icon}</span><div><b>${d.name}</b><small>${d.desc} ${d.passive}</small></div><button class="btn sm" ${owned || meta.stars < u.cost ? 'disabled' : ''}>${owned ? 'Есть' : u.cost + '⭐'}</button></div>`;
  }).join('');
  app.innerHTML = `<div class="screen lair">
    <div class="topbar"><button class="iconbtn btn-back">←</button><div class="stat">🏚️ <b>Логово</b></div><div class="stat">⭐ <b>${meta.stars}</b></div></div>
    <p class="hint">Звёзды даются за пройденные волны, квесты и победу над Избранным. Открытые карты начнут попадаться в наградах и в лавке.</p>
    <div class="unlocks">${items}</div></div>`;
  app.querySelector('.btn-back').onclick = () => { sfx.tap(); menu(); };
  app.querySelectorAll('.unlock button').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('.unlock').dataset.id;
    const u = UNLOCKS.find((x) => x.id === id);
    if (meta.stars < u.cost || meta.unlocked.includes(id)) return;
    meta.stars -= u.cost; meta.unlocked.push(id); save(); sfx.win(); lair();
  }));
}

function journal() {
  const list = STORY.map((s) => meta.story.includes(s.id)
    ? `<button class="btn chap" data-id="${s.id}">📖 ${s.title}</button>`
    : `<button class="btn chap" disabled>🔒 ???</button>`).join('');
  app.innerHTML = `<div class="screen lair">
    <div class="topbar"><button class="iconbtn btn-back">←</button><div class="stat">📖 <b>Дневник подземелья</b></div></div>
    <p class="hint">Главы открываются по ходу истории: умри, встреть Избранного, победи его… и не раз.</p>
    <div class="chapters">${list}</div>
    <h3>Бестиарий героев</h3>
    <div class="bestiary">${Object.values(HEROES).map((h) => `<div class="beast"><span class="emo big">${h.icon}</span><div><b>${h.title}</b><small>${h.desc}</small></div></div>`).join('')}</div>
  </div>`;
  app.querySelector('.btn-back').onclick = () => { sfx.tap(); menu(); };
  app.querySelectorAll('.chap[data-id]').forEach((b) => b.addEventListener('click', () => showStory(b.dataset.id)));
}

function howTo(inModal = false) {
  const html = `<h2>Как играть</h2>
  <div class="how">
  <p>🕳️ Ты — <b>подземелье</b>. Герои лезут сверху (🚪) к твоему <b>Сердцу</b> (💖) внизу. Если Сердце разобьют — забег окончен.</p>
  <p>🃏 Каждый ход у тебя <b>3⚡ энергии</b> и 5 карт. Тапни карту, затем подсвеченную клетку. Заклинания без цели применяются кнопкой.</p>
  <p>🪨 Стены удлиняют путь, но перекрыть его полностью нельзя. Длинный путь = больше шипов, ям и монстров на пути.</p>
  <p>🎭 У героев характеры: 🥷 вор бежит к золоту, 🤺 рыцарь ищет монстров, 🧙 маг лезет к рунам, 😇 жрец обходит ловушки. Стрелочка показывает, куда герой шагнёт. <b>Используй жадность и глупость героев!</b></p>
  <p>😱 Полоска под здоровьем — <b>храбрость</b>. Если она кончится, герой бросит половину золота и побежит к выходу.</p>
  <p>📜 Кто ушёл живым — расскажет в таверне. Появится <b>слух</b>, и следующие герои будут готовы к твоему любимому трюку. Меняй тактику!</p>
  <p>🗺️ Между волнами выбирай путь: лавка, события, отдых, элитные отряды. В конце ждёт Избранный.</p>
  <p>⭐ Звёзды за волны и квесты тратятся в <b>Логове</b> на новые карты и второе подземелье.</p>
  </div><button class="btn big" data-close>Понятно</button>`;
  if (inModal) modal(html); else { modal(html, { onClose: menu }); }
}

function settings() {
  const m = modal(`<h2>Настройки</h2>
    <button class="btn s-snd">${meta.settings.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'}</button>
    <button class="btn s-spd">Скорость боя: ${meta.settings.speed >= 2 ? 'быстро' : 'обычно'}</button>
    <button class="btn s-reset danger">🗑️ Сбросить весь прогресс</button>
    <button class="btn" data-close>Закрыть</button>
    <p class="hint">Совет: добавь игру на домашний экран — она работает офлайн как приложение.</p>`, { onClose: menu });
  m.el.querySelector('.s-snd').onclick = (e) => { meta.settings.sound = !meta.settings.sound; setSound(meta.settings.sound); save(); e.target.textContent = meta.settings.sound ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; };
  m.el.querySelector('.s-spd').onclick = (e) => { meta.settings.speed = meta.settings.speed >= 2 ? 1 : 2; save(); e.target.textContent = 'Скорость боя: ' + (meta.settings.speed >= 2 ? 'быстро' : 'обычно'); };
  m.el.querySelector('.s-reset').onclick = () => { if (confirm('Точно сбросить всё? Звёзды, открытия, сюжет.')) { resetAll(); m.close(); } };
}

// ---------- старт ----------
load();
setSound(meta.settings.sound);
// если игра закрылась посреди боя — откатываем к началу боя
if (meta.run && meta.run.gridSnap) restoreSnap();
if (meta.run && meta.run.pending) {
  // незавершённый узел: вернём игрока на карту, слой не сдвигаем
  meta.run.pending = null;
}
menu();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__dyra = { meta, menu, get battle() { return battle; } };
