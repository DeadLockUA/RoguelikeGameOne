// Сохранения, мета-прогресс, генерация забега
import { CARDS, BASE_POOL, DUNGEONS, QUESTS, COLS, ROWS, EVENTS } from './data.js';

const KEY = 'dyra_save_v1';

export const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function defaultMeta() {
  return {
    stars: 0, totalStars: 0,
    unlocked: [], // карты и подземелья
    story: [], // увиденные главы
    stats: { runs: 0, wins: 0, deaths: 0, kills: 0, flees: 0, bossSeen: 0 },
    settings: { sound: true, speed: 1 },
    tutorialDone: false,
    run: null,
  };
}

export let meta = defaultMeta();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) meta = Object.assign(defaultMeta(), JSON.parse(raw));
  } catch (e) { meta = defaultMeta(); }
  return meta;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
}
export function resetAll() { meta = defaultMeta(); save(); }

export function cardPool() {
  return BASE_POOL.concat(meta.unlocked.filter((id) => CARDS[id]));
}

export function randomCardFromPool(rarity = null, exclude = []) {
  const pool = cardPool().filter((id) => !exclude.includes(id));
  let list = rarity ? pool.filter((id) => CARDS[id].rarity === rarity) : pool;
  if (!list.length) list = pool;
  // веса: обычные чаще
  const w = list.map((id) => (rarity ? 1 : { common: 6, uncommon: 3, rare: 1 }[CARDS[id].rarity]));
  let s = w.reduce((a, b) => a + b, 0);
  let x = Math.random() * s;
  for (let i = 0; i < list.length; i++) { x -= w[i]; if (x <= 0) return list[i]; }
  return list[list.length - 1];
}

export function emptyGrid() {
  const g = [];
  for (let r = 0; r < ROWS; r++) { const row = []; for (let c = 0; c < COLS; c++) row.push({ f: null, m: null }); g.push(row); }
  return g;
}

function genMap() {
  // 7 слоёв: волна / выбор / волна / выбор / волна / выбор / босс
  const L = [];
  L.push([{ type: 'wave', tier: 1 }]);
  L.push(shuffle(['elite', 'shop', 'event', 'wave']).slice(0, 3).map((t) => t === 'wave' ? { type: 'wave', tier: 2 } : t === 'elite' ? { type: 'elite', tier: 'elite' } : { type: t }));
  L.push([{ type: 'wave', tier: 2 }, { type: 'wave', tier: 2 }]);
  L.push(shuffle(['shop', 'event', 'rest', 'elite']).slice(0, 3).map((t) => t === 'elite' ? { type: 'elite', tier: 'elite' } : { type: t }));
  L.push([{ type: 'wave', tier: 3 }, { type: 'wave', tier: 3 }]);
  L.push(shuffle(['shop', 'rest', 'event']).map((t) => ({ type: t })));
  L.push([{ type: 'boss', tier: 'boss' }]);
  return L;
}

export function newRun(dungeonId) {
  const d = DUNGEONS[dungeonId];
  const qids = shuffle(Object.keys(QUESTS)).slice(0, 3);
  meta.run = {
    dungeon: dungeonId,
    deck: d.deck.slice(),
    gold: 0,
    heart: d.heart, heartMax: d.heart,
    layer: 0,
    map: genMap(),
    chosen: [], // выбранный индекс на каждом слое
    rumors: [], // {key, by}
    grid: emptyGrid(),
    quests: qids.map((id) => ({ id, p: 0, done: false })),
    stats: { kills: 0, flees: 0, gold: 0, waves: 0, monsterKills: 0 },
    usedEvents: [],
    nextFear: 0,
    pending: null, // текущий узел
  };
  meta.stats.runs++;
  save();
  return meta.run;
}

export function pickEvent(run) {
  const avail = EVENTS.filter((e) => !run.usedEvents.includes(e.id));
  const e = pick(avail.length ? avail : EVENTS);
  run.usedEvents.push(e.id);
  return e;
}

export function addQuest(run, id, n = 1) {
  if (!run) return null;
  const q = run.quests.find((x) => x.id === id);
  if (!q || q.done) return null;
  q.p += n;
  if (q.p >= QUESTS[id].goal) { q.p = QUESTS[id].goal; q.done = true; return q; }
  return null;
}
