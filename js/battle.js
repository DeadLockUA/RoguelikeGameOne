// Бой: движок + интерфейс
import { CARDS, MONSTERS, FEATURES, HEROES, RUMORS, HERO_LINES, DUNGEONS, WAVES, PARTY_NAMES, COLS, ROWS, ENTRANCE, HEART, TIPS } from './data.js';
import { meta, save, rand, pick, shuffle, addQuest } from './state.js';
import { sfx } from './audio.js';

const INF = 1e9;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / (meta.settings.speed || 1)));
const key = (r, c) => r * COLS + c;
const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cheb = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
const manh = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const isEntrance = (r, c) => r === ENTRANCE.r && c === ENTRANCE.c;
const isHeart = (r, c) => r === HEART.r && c === HEART.c;

export function iconHTML(icon, cls = '') {
  if (icon === 'spikes') return `<span class="ico-spikes ${cls}"></span>`;
  if (icon === 'pit') return `<span class="ico-pit ${cls}"></span>`;
  return `<span class="emo ${cls}">${icon}</span>`;
}

export function cardHTML(id, extra = '') {
  const c = CARDS[id];
  return `<div class="card r-${c.rarity} k-${c.kind} ${extra}" data-card="${id}">
    <div class="ccost">${c.cost}</div>
    <div class="cicon">${iconHTML(c.icon)}</div>
    <div class="cname">${c.name}</div>
  </div>`;
}

export function makeWave(node, run) {
  const tier = node.tier;
  const list = pick(WAVES[tier]).slice();
  const layer = run.layer;
  let scale = 1 + 0.15 * layer;
  if (tier === 'elite') scale += 0.25;
  return { list, scale, name: tier === 'boss' ? 'Избранный и свита' : pick(PARTY_NAMES), elite: tier === 'elite', boss: tier === 'boss' };
}

let heroUid = 1;

export class Battle {
  constructor(app, run, node, cb) {
    this.app = app; this.run = run; this.node = node; this.cb = cb;
    this.g = run.grid;
    this.dg = DUNGEONS[run.dungeon];
    if (!node.wave) node.wave = makeWave(node, run);
    this.wave = node.wave;
    this.queue = this.wave.list.slice();
    this.heroes = [];
    this.turn = 0;
    this.energy = 3;
    this.draw = shuffle(run.deck);
    this.hand = [];
    this.discard = [];
    this.exhausted = [];
    this.selected = -1;
    this.busy = false;
    this.over = false;
    this.goldStart = run.gold;
    this.heartStart = run.heart;
    this.waveKills = 0; this.waveFlees = 0; this.waveEscapes = 0;
    this.tutorial = !meta.tutorialDone;
    this.heroEls = new Map();
    this.build();
    this.say(pick(this.wave.boss ? this.dg.lines.boss : this.dg.lines.waveStart));
    this.startTurn();
  }

  // ---------- helpers ----------
  t(r, c) { return this.g[r][c]; }
  rumor(k) { return this.run.rumors.some((x) => x.key === k); }
  alive() { return this.heroes.filter((h) => h.state === 'in'); }
  heroesAt(r, c) { return this.alive().filter((h) => h.r === r && h.c === c); }

  makeHero(cls) {
    const d = HEROES[cls];
    const sc = this.wave.scale;
    const hp = Math.max(1, Math.round(d.hp * sc));
    let nerve = d.nerve + (this.rumor('bold') ? 2 : 0) - (this.run.nextFear || 0);
    if (d.boss) nerve = 99;
    return {
      id: heroUid++, cls, name: pick(d.names), hp, maxHp: hp, atk: d.atk + (sc >= 1.6 ? 1 : 0),
      nerve: Math.max(1, nerve), maxNerve: Math.max(1, nerve), speed: d.speed,
      gold: rand(d.gold[0], d.gold[1]), r: ENTRANCE.r, c: ENTRANCE.c,
      state: 'in', fleeing: false, stun: 0, dodge: cls === 'thief', cd: 2, dmgBy: {}, revive: !!d.boss, unlucky: false, boss: !!d.boss,
    };
  }

  // ---------- pathfinding ----------
  stepCost(h, r, c) {
    const t = this.t(r, c);
    if (t.f && FEATURES[t.f.type].blocks) return INF;
    let cost = 1;
    if (t.m && !MONSTERS[t.m.type].flying) cost += (h.cls === 'knight' || h.boss) ? 1 : 4;
    if (t.f && FEATURES[t.f.type].trap) {
      let av = { peasant: 1, thief: 0, knight: 1, mage: 2, priest: 6, chosen: 1 }[h.cls];
      if (this.rumor(t.f.type)) av += 8;
      if (t.f.type === 'rune' && h.cls === 'mage' && !this.rumor('rune')) av = 0;
      cost += av;
    }
    if (t.m && t.m.type === 'ghost' && !this.rumor('ghost') && h.cls !== 'priest') cost += 2;
    return cost;
  }

  dijkstra(h) {
    const N = ROWS * COLS;
    const dist = new Array(N).fill(INF), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
    dist[key(h.r, h.c)] = 0;
    for (;;) {
      let u = -1, best = INF;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = true;
      const ur = Math.floor(u / COLS), uc = u % COLS;
      for (const [dr, dc] of D4) {
        const nr = ur + dr, nc = uc + dc;
        if (!inB(nr, nc)) continue;
        const cst = this.stepCost(h, nr, nc);
        if (cst >= INF) continue;
        const v = key(nr, nc);
        if (dist[u] + cst < dist[v]) { dist[v] = dist[u] + cst; prev[v] = u; }
      }
    }
    return { dist, prev };
  }

  targets(h) {
    if (h.fleeing) return [ENTRANCE];
    const out = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = this.t(r, c);
      if (h.cls === 'knight' && t.m && !MONSTERS[t.m.type].flying) out.push({ r, c });
      if (h.cls === 'thief') {
        if (t.f && t.f.type === 'gold') out.push({ r, c });
        if (t.m && t.m.type === 'mimic' && !this.rumor('mimic')) out.push({ r, c });
      }
      if (h.cls === 'mage' && t.f && t.f.type === 'rune' && !this.rumor('rune')) out.push({ r, c });
    }
    return out;
  }

  plan(h) {
    const { dist, prev } = this.dijkstra(h);
    let goal = null, best = INF;
    for (const p of this.targets(h)) { const d = dist[key(p.r, p.c)]; if (d < best) { best = d; goal = p; } }
    if (!goal || best >= INF) { goal = h.fleeing ? ENTRANCE : HEART; best = dist[key(goal.r, goal.c)]; }
    if (best >= INF) {
      // запасной вариант — к Сердцу
      goal = HEART; best = dist[key(HEART.r, HEART.c)];
      if (best >= INF) return null;
    }
    let v = key(goal.r, goal.c);
    const start = key(h.r, h.c);
    if (v === start) return null;
    const path = [];
    while (v !== start && v >= 0) { path.push(v); v = prev[v]; }
    if (v < 0) return null;
    path.reverse();
    return path.map((k) => ({ r: Math.floor(k / COLS), c: k % COLS }));
  }

  // связность: из Сердца должны быть достижимы вход и все герои (монстры проходимы)
  connectedWith(br, bc) {
    const seen = new Set([key(HEART.r, HEART.c)]);
    const q = [HEART];
    while (q.length) {
      const p = q.shift();
      for (const [dr, dc] of D4) {
        const nr = p.r + dr, nc = p.c + dc;
        if (!inB(nr, nc) || (nr === br && nc === bc)) continue;
        const t = this.t(nr, nc);
        if (t.f && FEATURES[t.f.type].blocks) continue;
        const k = key(nr, nc);
        if (seen.has(k)) continue;
        seen.add(k); q.push({ r: nr, c: nc });
      }
    }
    if (!seen.has(key(ENTRANCE.r, ENTRANCE.c))) return false;
    return this.alive().every((h) => seen.has(key(h.r, h.c)));
  }

  validEmpty(r, c, cardId) {
    if (!inB(r, c) || isEntrance(r, c) || isHeart(r, c)) return false;
    const t = this.t(r, c);
    if (t.f || t.m) return false;
    if (this.heroesAt(r, c).length) return false;
    if (cardId === 'wall' && !this.connectedWith(r, c)) return false;
    return true;
  }

  cardCost(id) {
    if (id === 'wall' && this.run.dungeon === 'hole' && this.freeWall) return 0;
    return CARDS[id].cost;
  }

  // ---------- turns ----------
  async startTurn() {
    if (this.over) return;
    this.turn++;
    this.energy = 3;
    this.freeWall = true;
    this.cryptRaised = false;
    this.drawCards(5);
    const spawnN = this.queue.length && (this.run.layer >= 4 || this.wave.elite) && this.turn % 2 === 0 ? 2 : 1;
    for (let i = 0; i < spawnN && this.queue.length; i++) {
      // босс выходит последним, когда очередь почти пуста
      const h = this.makeHero(this.queue.shift());
      this.heroes.push(h);
      sfx.step();
      this.renderAll();
      if (h.boss) this.say(pick(this.dg.lines.boss));
      this.bubble(h, pick(HERO_LINES.spawn[h.cls]));
    }
    if (this.tutorial && TIPS[this.turn - 1]) this.say('💡 ' + TIPS[this.turn - 1], true);
    this.renderAll();
  }

  drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (!this.draw.length) { if (!this.discard.length) break; this.draw = shuffle(this.discard); this.discard = []; }
      this.hand.push(this.draw.pop());
    }
  }

  async endTurn() {
    if (this.busy || this.over) return;
    this.busy = true;
    this.selected = -1;
    this.discard.push(...this.hand); this.hand = [];
    this.renderAll();
    // ход героев
    for (const h of this.heroes.slice()) {
      if (h.state !== 'in' || this.over) continue;
      await this.heroAct(h);
      this.renderAll();
      if (this.checkEnd()) { this.busy = false; return; }
    }
    // ход монстров
    await this.monsterPhase();
    this.renderAll();
    if (this.checkEnd()) { this.busy = false; return; }
    this.busy = false;
    await this.startTurn();
  }

  checkEnd() {
    if (this.over) return true;
    if (this.run.heart <= 0) { this.over = true; this.finish(false); return true; }
    if (!this.queue.length && !this.alive().length) { this.over = true; this.finish(true); return true; }
    return false;
  }

  async finish(win) {
    this.renderAll();
    await sleep(700);
    const sum = {
      win, gold: this.run.gold - this.goldStart, kills: this.waveKills, flees: this.waveFlees, escapes: this.waveEscapes,
      heartLost: this.heartStart - this.run.heart, boss: this.wave.boss, elite: this.wave.elite,
    };
    if (win) {
      this.say(pick(this.dg.lines.win));
      this.run.stats.waves++;
      this.run.nextFear = 0;
      if (this.run.heart >= this.heartStart) { const q = addQuest(this.run, 'noLeak'); if (q) this.questDone(q); }
      if (!meta.tutorialDone) { meta.tutorialDone = true; }
      sfx.win();
    } else sfx.lose();
    save();
    await sleep(500);
    this.cb.onEnd(sum);
  }

  // ---------- hero actions ----------
  async heroAct(h) {
    if (h.stun > 0) { h.stun--; if (Math.random() < 0.4) this.bubble(h, pick(HERO_LINES.stuck)); await sleep(150); return; }
    // способности
    if (h.cls === 'priest') this.priestAbility(h);
    if (h.cls === 'mage') { h.cd--; if (h.cd <= 0 && await this.fireball(h)) h.cd = 3; }
    if (h.fleeing && isEntrance(h.r, h.c)) { this.escape(h); return; }
    // страховка от бесконечного боя
    if (this.turn > 45) { this.bubble(h, 'Скукота. Я домой.'); this.escape(h); return; }
    const steps = h.speed + (h.fleeing ? 1 : 0);
    for (let s = 0; s < steps; s++) {
      if (h.state !== 'in') return;
      const path = this.plan(h);
      if (!path || !path.length) return;
      const nx = path[0];
      const t = this.t(nx.r, nx.c);
      if (t.m && !MONSTERS[t.m.type].flying) { await this.heroAttack(h, nx.r, nx.c); return; }
      h.r = nx.r; h.c = nx.c;
      sfx.step();
      this.renderHeroes();
      await sleep(260);
      await this.onEnter(h, t);
      if (h.state !== 'in') return;
      if (!h.fleeing && isHeart(h.r, h.c)) { await this.reachHeart(h); return; }
      if (h.fleeing && isEntrance(h.r, h.c)) { this.escape(h); return; }
      if (h.stun > 0) return;
    }
  }

  priestAbility(h) {
    let healed = false;
    for (const o of this.alive()) {
      if (cheb(o, h) <= 1 && o.hp < o.maxHp) { o.hp++; healed = true; this.float(o.r, o.c, '+1', 'heal'); }
    }
    if (healed && Math.random() < 0.3) this.bubble(h, pick(HERO_LINES.heal));
    // изгнание призраков
    for (let r = Math.max(0, h.r - 1); r <= Math.min(ROWS - 1, h.r + 1); r++) for (let c = Math.max(0, h.c - 1); c <= Math.min(COLS - 1, h.c + 1); c++) {
      const t = this.t(r, c);
      if (t.m && t.m.type === 'ghost') { this.bubble(h, pick(HERO_LINES.exorcise)); this.hurtMonster(r, c, 2); return; }
    }
  }

  async fireball(h) {
    let best = null, bd = INF;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = this.t(r, c);
      const d = manh(h, { r, c });
      if (d > 3 || d >= bd) continue;
      const okF = t.f && ['wall', 'spikes', 'pit'].includes(t.f.type);
      if (t.m || okF) { best = { r, c }; bd = d; }
    }
    if (!best) return false;
    this.bubble(h, pick(HERO_LINES.fireball));
    this.float(best.r, best.c, '🔥', 'big');
    sfx.boom();
    await sleep(300);
    const t = this.t(best.r, best.c);
    if (t.m) this.hurtMonster(best.r, best.c, 3);
    else if (t.f) { t.f = null; this.flashCell(best.r, best.c); }
    this.renderCells();
    return true;
  }

  async heroAttack(h, r, c) {
    const m = this.t(r, c).m;
    const def = MONSTERS[m.type];
    let dmg = h.atk;
    if (h.cls === 'priest' && def.undead) dmg *= 2;
    if (this.rumor(m.type)) dmg += 1;
    this.lunge(h, r, c);
    sfx.hit();
    await sleep(200);
    if (m.type === 'mimic' && h.cls === 'thief' && Math.random() < 0.6) this.bubble(h, pick(HERO_LINES.mimic));
    this.hurtMonster(r, c, dmg);
    await sleep(150);
  }

  hurtMonster(r, c, dmg) {
    const t = this.t(r, c);
    if (!t.m) return;
    t.m.hp -= dmg;
    this.float(r, c, '-' + dmg, 'mdmg');
    this.shakeCell(r, c);
    if (t.m.hp <= 0) { this.float(r, c, '💥', 'big'); t.m = null; }
    this.renderCells();
  }

  async onEnter(h, t) {
    if (!t.f) return;
    const f = t.f;
    const def = FEATURES[f.type];
    if (f.type === 'gold') {
      h.gold += f.amount;
      t.f = null;
      sfx.coin();
      this.float(h.r, h.c, '+' + f.amount + '💰', 'gold');
      if (Math.random() < 0.6) this.bubble(h, pick(HERO_LINES.gold));
      this.renderCells();
      return;
    }
    if (!def.trap) return;
    if (h.cls === 'priest') { const q = addQuest(this.run, 'priestTrap'); if (q) this.questDone(q); }
    if (h.dodge && f.type !== 'rune') {
      h.dodge = false;
      this.float(h.r, h.c, 'Увернулся!', 'info');
      this.bubble(h, 'Ха! Ловкость рук!');
      return;
    }
    f.uses--;
    if (f.type === 'rune') {
      sfx.boom();
      this.bubble(h, pick(HERO_LINES.rune));
      this.flashCell(h.r, h.c, true);
      const victims = this.alive().filter((o) => cheb(o, h) <= 1);
      t.f = null;
      this.renderCells();
      for (const o of victims) this.hurtHero(o, def.dmg, 'rune');
      for (let r = h.r - 1; r <= h.r + 1; r++) for (let c = h.c - 1; c <= h.c + 1; c++) if (inB(r, c) && this.t(r, c).m) this.hurtMonster(r, c, 2);
      return;
    }
    sfx.hit();
    this.flashCell(h.r, h.c);
    if (f.type === 'spikes' && Math.random() < 0.5) this.bubble(h, pick(HERO_LINES.spikes));
    if (f.type === 'pit') {
      if (Math.random() < 0.6) this.bubble(h, pick(HERO_LINES.pit));
      if (!this.rumor('pit')) h.stun = 1;
    }
    if (f.uses <= 0) t.f = null;
    this.renderCells();
    this.hurtHero(h, def.dmg, f.type);
  }

  hurtHero(h, amt, source) {
    if (h.state !== 'in') return;
    if (['spikes', 'pit', 'rune'].includes(source) && this.rumor(source)) amt = Math.max(1, Math.floor(amt / 2));
    if (MONSTERS[source] && this.rumor(source)) amt = Math.max(0, amt - 1);
    if (source === 'spell' && this.rumor('spell')) amt = Math.max(1, amt - 1);
    if (h.unlucky && amt > 0) { amt *= 3; h.unlucky = false; this.float(h.r, h.c, '🐈‍⬛ ×3', 'info'); }
    if (amt <= 0) { this.float(h.r, h.c, '0', 'info'); return; }
    h.hp -= amt;
    h.dmgBy[source] = (h.dmgBy[source] || 0) + amt;
    if (source === 'spikes') { const q = addQuest(this.run, 'spikes10', amt); if (q) this.questDone(q); }
    this.float(h.r, h.c, '-' + amt, 'dmg');
    this.hitAnim(h);
    if (h.hp <= 0) { this.killHero(h, source); return; }
    // страх только от «страшных» источников
    const FEAR = { pit: 1, rune: 2, mimic: 2, ogre: 1, spell: 1 };
    if (!h.boss && FEAR[source]) h.nerve -= FEAR[source];
    if (Math.random() < 0.15) this.bubble(h, pick(HERO_LINES.hurt));
    this.checkNerve(h);
  }

  scare(h, amt, source) {
    if (h.state !== 'in' || h.boss || h.fleeing) return;
    h.nerve -= amt;
    h.dmgBy[source] = (h.dmgBy[source] || 0) + amt * 0.5;
    this.float(h.r, h.c, '-' + amt + '😨', 'fear');
    this.checkNerve(h);
  }

  checkNerve(h) {
    if (h.state !== 'in' || h.fleeing || h.boss) return;
    if (h.nerve <= 0) {
      h.nerve = 0;
      h.fleeing = true;
      const drop = Math.ceil(h.gold / 2);
      h.gold -= drop;
      this.gainGold(drop, h);
      this.run.stats.flees++; meta.stats.flees++; this.waveFlees++;
      sfx.scream();
      this.bubble(h, pick(HERO_LINES.flee));
      if (Math.random() < 0.5) this.say(pick(this.dg.lines.flee));
      const q = addQuest(this.run, 'flee3'); if (q) this.questDone(q);
      this.renderHeroes();
    }
  }

  gainGold(n, h) {
    if (n <= 0) return;
    this.run.gold += n;
    this.run.stats.gold += n;
    if (h) this.float(h.r, h.c, '+' + n + '💰', 'gold');
    sfx.coin();
    const q = addQuest(this.run, 'gold40', n); if (q) this.questDone(q);
    this.renderHud();
  }

  killHero(h, source) {
    if (h.revive) {
      h.revive = false;
      h.hp = 6;
      this.bubble(h, pick(HERO_LINES.revive));
      this.float(h.r, h.c, 'Сюжетная броня!', 'info');
      this.renderHeroes();
      return;
    }
    h.state = 'dead';
    h.hp = 0;
    sfx.die();
    this.bubble(h, pick(HERO_LINES.die), true);
    let gold = h.gold + (h.fleeing ? 2 : 0);
    this.gainGold(gold, h);
    this.run.stats.kills++; meta.stats.kills++; this.waveKills++;
    const qs = [];
    if (source === 'pit' && h.cls === 'thief') qs.push(addQuest(this.run, 'pitThief'));
    if (MONSTERS[source]) { this.run.stats.monsterKills++; qs.push(addQuest(this.run, 'monsterKill5')); if (h.cls === 'knight') qs.push(addQuest(this.run, 'knightMonster')); }
    if (h.cls === 'peasant') qs.push(addQuest(this.run, 'peasants3'));
    if (h.fleeing) qs.push(addQuest(this.run, 'killFleeing'));
    qs.filter(Boolean).forEach((q) => this.questDone(q));
    if (Math.random() < 0.55) this.say(pick(this.dg.lines.kill));
    // страх у соседей
    for (const o of this.alive()) if (cheb(o, h) <= 1) this.scare(o, 1, source);
    // пассивка Склепа
    if (this.run.dungeon === 'crypt' && !this.cryptRaised) {
      const t = this.t(h.r, h.c);
      if (!t.f && !t.m && !isEntrance(h.r, h.c) && !isHeart(h.r, h.c) && !this.heroesAt(h.r, h.c).length) {
        this.cryptRaised = true;
        t.m = { type: 'skeleton', hp: MONSTERS.skeleton.hp, maxHp: MONSTERS.skeleton.hp };
        this.float(h.r, h.c, 'Встал!', 'info');
      }
    }
    this.renderAll();
  }

  async reachHeart(h) {
    const d = HEROES[h.cls].heartDmg;
    this.run.heart = Math.max(0, this.run.heart - d);
    sfx.heart();
    this.bubble(h, pick(HERO_LINES.heart));
    this.float(HEART.r, HEART.c, '-' + d + '❤', 'dmg big');
    this.app.querySelector('.board').classList.add('shake');
    setTimeout(() => this.app.querySelector('.board')?.classList.remove('shake'), 400);
    this.say(pick(this.dg.lines.heartHit));
    if (h.cls === 'thief') {
      const s = Math.min(5, this.run.gold);
      if (s > 0) { this.run.gold -= s; h.gold += s; this.float(h.r, h.c, '-' + s + '💰', 'dmg'); this.bubble(h, pick(HERO_LINES.steal)); }
    }
    await sleep(350);
    this.escape(h);
  }

  escape(h) {
    h.state = 'escaped';
    this.waveEscapes++;
    let top = null, tv = 0;
    for (const [k, v] of Object.entries(h.dmgBy)) if (v > tv) { tv = v; top = k; }
    if (!top || !RUMORS[top]) top = 'bold';
    this.addRumor(top, h.name);
    this.renderAll();
  }

  addRumor(k, by) {
    const ex = this.run.rumors.findIndex((x) => x.key === k);
    if (ex >= 0) this.run.rumors.splice(ex, 1);
    this.run.rumors.push({ key: k, by });
    if (this.run.rumors.length > 3) this.run.rumors.shift();
    sfx.rumor();
    this.toast(`📜 Новый слух! ${RUMORS[k].quote.replace('%n', by)}`, 'rumor');
    if (Math.random() < 0.6) setTimeout(() => this.say(pick(this.dg.lines.rumor)), 600);
    this.renderHud();
  }

  async monsterPhase() {
    const ms = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (this.t(r, c).m) ms.push({ r, c });
    let any = false;
    for (const p of ms) {
      const t = this.t(p.r, p.c);
      if (!t.m) continue;
      const def = MONSTERS[t.m.type];
      if (def.fear) {
        if (this.rumor('ghost')) continue;
        const vs = this.alive().filter((h) => cheb(h, p) <= 1 && !h.fleeing && !h.boss);
        if (vs.length) {
          any = true;
          this.shakeCell(p.r, p.c);
          for (const h of vs) { this.scare(h, def.fear, 'ghost'); if (Math.random() < 0.35) this.bubble(h, pick(HERO_LINES.ghost)); }
          await sleep(200);
        }
        continue;
      }
      const vs = this.alive().filter((h) => manh(h, p) <= def.range).sort((a, b) => a.hp - b.hp);
      if (!vs.length) continue;
      const h = vs[0];
      any = true;
      this.monsterLunge(p, h);
      sfx.hit();
      await sleep(180);
      this.hurtHero(h, def.atk, t.m.type);
      if (def.sticky && h.state === 'in' && !this.rumor('slime')) h.stun = Math.max(h.stun, 1);
      this.renderHeroes();
      await sleep(180);
      if (this.checkEnd()) return;
    }
    if (any) await sleep(150);
  }

  // ---------- игрок ----------
  async playCard(idx, r, c) {
    const id = this.hand[idx];
    const card = CARDS[id];
    const cost = this.cardCost(id);
    if (cost > this.energy) { this.toast('Не хватает энергии ⚡'); return false; }
    let target = null;
    if (card.target === 'empty') {
      if (!this.validEmpty(r, c, id)) { this.toast(id === 'wall' && inB(r, c) && !this.t(r, c).f && !this.t(r, c).m ? 'Нельзя полностью перекрыть путь!' : 'Сюда нельзя'); return false; }
    } else if (card.target === 'hero') {
      target = this.heroesAt(r, c)[0];
      if (!target) { this.toast('Выбери героя'); return false; }
    }
    this.energy -= cost;
    if (id === 'wall' && this.run.dungeon === 'hole') this.freeWall = false;
    this.hand.splice(idx, 1);
    if (card.exhaust) this.exhausted.push(id); else this.discard.push(id);
    this.selected = -1;
    const t = inB(r, c) ? this.t(r, c) : null;
    if (card.kind === 'build') {
      const fd = FEATURES[id];
      t.f = { type: id, uses: fd.uses || 0, amount: fd.amount || 0 };
      sfx.place(); this.flashCell(r, c);
    } else if (card.kind === 'monster') {
      const md = MONSTERS[id];
      t.m = { type: id, hp: md.hp, maxHp: md.hp };
      sfx.place(); this.flashCell(r, c);
    } else {
      sfx.spell();
      this.castSpell(id, target);
    }
    this.renderAll();
    if (this.checkEnd()) return true;
    return true;
  }

  castSpell(id, h) {
    const run = this.run;
    switch (id) {
      case 'howl': {
        const amt = this.rumor('spell') ? 1 : 2;
        this.app.querySelector('.board').classList.add('shake');
        setTimeout(() => this.app.querySelector('.board')?.classList.remove('shake'), 400);
        for (const o of this.alive()) this.scare(o, amt, 'spell');
        break;
      }
      case 'dark': this.drawCards(2); break;
      case 'collapse': this.hurtHero(h, 4, 'spell'); if (h.state === 'in') h.stun = Math.max(h.stun, 1); this.flashCell(h.r, h.c, true); sfx.boom(); break;
      case 'patch': run.heart = Math.min(run.heartMax, run.heart + 3); this.float(HEART.r, HEART.c, '+3❤', 'heal big'); break;
      case 'gossip': if (run.rumors.length) { const x = run.rumors.shift(); this.toast(`Слух «${RUMORS[x.key].title}» опровергнут!`); } else this.toast('Слухов нет. Опровергать нечего. Обидно.'); break;
      case 'coffee': this.energy += 2; break;
      case 'portal': h.r = ENTRANCE.r; h.c = ENTRANCE.c; this.bubble(h, pick(HERO_LINES.portal)); this.scare(h, 2, 'spell'); break;
      case 'blackcat': h.unlucky = true; this.float(h.r, h.c, '🐈‍⬛', 'big'); break;
      case 'bones': {
        const cand = [];
        for (const o of this.alive()) for (const [dr, dc] of D4) {
          const nr = o.r + dr, nc = o.c + dc;
          if (this.validEmpty(nr, nc, 'skeleton') && !cand.some((p) => p.r === nr && p.c === nc)) cand.push({ r: nr, c: nc });
        }
        shuffle(cand).slice(0, 2).forEach((p) => { this.t(p.r, p.c).m = { type: 'skeleton', hp: 3, maxHp: 3 }; this.flashCell(p.r, p.c); });
        if (!cand.length) this.toast('Скелетам негде встать…');
        break;
      }
    }
  }

  questDone(q) {
    this.toast(`⭐ Квест выполнен: «${q ? (this.cb.questTitle(q.id)) : ''}»`, 'quest');
  }

  // ---------- UI ----------
  build() {
    this.app.innerHTML = `
    <div class="battle">
      <div class="topbar">
        <div class="stat heart-stat">💖 <b class="v-heart"></b></div>
        <div class="stat">💰 <b class="v-gold"></b></div>
        <button class="stat btn-rumors">📜 <b class="v-rum"></b></button>
        <div class="queue"></div>
        <button class="iconbtn btn-speed">⏩</button>
        <button class="iconbtn btn-menu">☰</button>
      </div>
      <div class="narr"><span class="narr-ico">${this.dg.icon}</span><span class="narr-text"></span></div>
      <div class="board-wrap"><div class="board"><div class="cells"></div><div class="heroes"></div><div class="fx"></div></div></div>
      <div class="info"></div>
      <div class="controls">
        <div class="energy"><span class="v-energy"></span><small>⚡</small></div>
        <button class="pile btn-draw">🂠 <b class="v-draw"></b></button>
        <div class="wave-name"></div>
        <button class="btn-end">Ход ▶</button>
      </div>
      <div class="hand"></div>
      <div class="toasts"></div>
    </div>`;
    const q = (s) => this.app.querySelector(s);
    this.el = {
      cells: q('.cells'), heroes: q('.heroes'), fx: q('.fx'), board: q('.board'), hand: q('.hand'), info: q('.info'),
      heart: q('.v-heart'), gold: q('.v-gold'), rum: q('.v-rum'), energy: q('.v-energy'), drawN: q('.v-draw'),
      narr: q('.narr-text'), queue: q('.queue'), waveName: q('.wave-name'), toasts: q('.toasts'), end: q('.btn-end'), speed: q('.btn-speed'),
    };
    this.el.waveName.textContent = this.wave.name;
    let html = '';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) html += `<div class="cell" data-r="${r}" data-c="${c}"></div>`;
    this.el.cells.innerHTML = html;
    this.cellEls = [...this.el.cells.children];
    this.layout();
    this.onResize = () => { this.layout(); this.renderAll(); };
    window.addEventListener('resize', this.onResize);

    this.el.board.addEventListener('click', (e) => this.onBoardTap(e));
    this.el.hand.addEventListener('click', (e) => {
      const cEl = e.target.closest('.card'); if (!cEl) return;
      this.onCardTap(+cEl.dataset.idx);
    });
    this.el.end.addEventListener('click', () => { sfx.tap(); this.endTurn(); });
    q('.btn-rumors').addEventListener('click', () => { sfx.tap(); this.cb.showRumors(); });
    q('.btn-menu').addEventListener('click', () => { sfx.tap(); this.cb.showMenu(); });
    q('.btn-draw').addEventListener('click', () => { sfx.tap(); this.cb.showPile(this.draw.slice(), 'Колода (осталось)', this.discard.slice()); });
    this.el.speed.addEventListener('click', () => {
      meta.settings.speed = meta.settings.speed >= 2 ? 1 : 2; save(); this.renderHud(); sfx.tap();
    });
  }

  destroy() { window.removeEventListener('resize', this.onResize); }

  layout() {
    const W = Math.min(window.innerWidth, 520);
    const H = window.innerHeight;
    const reserved = 44 + 50 + 44 + 46 + 112 + 18;
    const cell = Math.max(30, Math.floor(Math.min((W - 12) / COLS, (H - reserved) / ROWS)));
    this.cell = cell;
    this.app.style.setProperty('--cell', cell + 'px');
    this.el.board.style.width = cell * COLS + 'px';
    this.el.board.style.height = cell * ROWS + 'px';
  }

  onCardTap(idx) {
    if (this.busy || this.over) return;
    sfx.tap();
    if (this.selected === idx) { this.selected = -1; this.renderAll(); return; }
    const id = this.hand[idx];
    const card = CARDS[id];
    if (card.target === 'none') {
      // подтверждение двойным тапом
      this.selected = idx;
      this.renderAll();
      this.showInfo(`<b>${card.name}</b> — ${card.text} <i>${card.flavor}</i><button class="btn-cast">Применить</button>`);
      this.el.info.querySelector('.btn-cast').onclick = (e) => { e.stopPropagation(); this.playCard(idx, -1, -1); };
      return;
    }
    this.selected = idx;
    this.renderAll();
    this.showInfo(`<b>${card.name}</b> (${this.cardCost(id)}⚡) — ${card.text} <i>${card.flavor}</i>`);
  }

  onBoardTap(e) {
    if (this.over) return;
    const rect = this.el.board.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / this.cell), r = Math.floor((e.clientY - rect.top) / this.cell);
    if (!inB(r, c)) return;
    if (this.selected >= 0 && !this.busy) {
      const id = this.hand[this.selected];
      if (CARDS[id].target !== 'none') { this.playCard(this.selected, r, c); return; }
    }
    this.inspect(r, c);
  }

  inspect(r, c) {
    const hs = this.heroesAt(r, c);
    const t = this.t(r, c);
    const parts = [];
    for (const h of hs) {
      const d = HEROES[h.cls];
      const st = [h.fleeing ? '😱 бежит' : '', h.stun ? '💫 оглушён' : '', h.unlucky ? '🐈‍⬛ проклят' : '', h.dodge ? '🍀 увернётся' : ''].filter(Boolean).join(', ');
      parts.push(`<b>${d.icon} ${h.name}</b> (${d.title}) ❤${h.hp}/${h.maxHp} 💪${h.boss ? '∞' : h.nerve} 💰${h.gold} ${st}<br><small>${d.desc}</small>`);
    }
    if (t.m) { const d = MONSTERS[t.m.type]; parts.push(`<b>${d.icon} ${d.name}</b> ❤${t.m.hp}/${t.m.maxHp}<br><small>${CARDS[t.m.type].text}</small>`); }
    if (t.f) { const d = FEATURES[t.f.type]; parts.push(`<b>${d.name}</b>${d.uses ? ` (осталось ${t.f.uses})` : ''}<br><small>${CARDS[t.f.type].text}</small>`); }
    if (isEntrance(r, c)) parts.push('<b>🚪 Вход.</b> Отсюда приходят герои. Сюда же убегают трусы.');
    if (isHeart(r, c)) parts.push(`<b>💖 Сердце подземелья</b> ❤${this.run.heart}/${this.run.heartMax}. Если обнулится — конец забега.`);
    if (!parts.length) parts.push('Пустая клетка. Сыро. Пахнет приключениями.');
    this.showInfo(parts.join('<hr>'));
  }

  showInfo(html) { this.el.info.innerHTML = html; this.el.info.scrollTop = 0; }

  say(text, tip = false) {
    this.el.narr.textContent = text;
    this.el.narr.parentElement.classList.toggle('tip', tip);
    this.el.narr.parentElement.classList.remove('pop'); void this.el.narr.offsetWidth; this.el.narr.parentElement.classList.add('pop');
  }

  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), cls === 'rumor' ? 4200 : 2200);
    setTimeout(() => d.remove(), cls === 'rumor' ? 4700 : 2700);
  }

  renderAll() { this.renderCells(); this.renderHeroes(); this.renderHud(); this.renderHand(); }

  renderHud() {
    const e = this.el;
    e.heart.textContent = `${this.run.heart}/${this.run.heartMax}`;
    e.gold.textContent = this.run.gold;
    e.rum.textContent = this.run.rumors.length;
    e.energy.textContent = this.energy;
    e.drawN.textContent = this.draw.length;
    e.queue.innerHTML = this.queue.map((c) => `<span>${HEROES[c].icon}</span>`).join('');
    e.end.disabled = this.busy || this.over;
    e.end.textContent = this.busy ? '…' : 'Ход ▶';
    e.speed.textContent = meta.settings.speed >= 2 ? '⏩2' : '▶1';
  }

  renderHand() {
    this.el.hand.innerHTML = this.hand.map((id, i) => {
      const cost = this.cardCost(id);
      const cls = [i === this.selected ? 'sel' : '', cost > this.energy ? 'dim' : '', cost < CARDS[id].cost ? 'free' : ''].join(' ');
      return cardHTML(id, cls).replace('data-card', `data-idx="${i}" data-card`).replace(`<div class="ccost">${CARDS[id].cost}</div>`, `<div class="ccost">${cost}</div>`);
    }).join('');
    const n = this.hand.length;
    this.el.hand.style.setProperty('--n', Math.max(n, 5));
  }

  renderCells() {
    const sel = this.selected >= 0 ? this.hand[this.selected] : null;
    const sc = sel ? CARDS[sel] : null;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const el = this.cellEls[r * COLS + c];
      const t = this.t(r, c);
      let cls = 'cell';
      let html = '';
      if ((r + c) % 2) cls += ' alt';
      if (isEntrance(r, c)) { cls += ' entrance'; html = '<span class="emo">🚪</span>'; }
      if (isHeart(r, c)) { cls += ' heartcell'; html = '<span class="emo heartbeat">💖</span>'; }
      if (t.f) {
        cls += ' f-' + t.f.type;
        if (t.f.type === 'wall') html = '<span class="emo">🪨</span>';
        else if (t.f.type === 'spikes') html = `<span class="ico-spikes"></span><i class="uses">${t.f.uses}</i>`;
        else if (t.f.type === 'pit') html = `<span class="ico-pit"></span><i class="uses">${t.f.uses}</i>`;
        else if (t.f.type === 'gold') html = '<span class="emo sm">💰</span>';
        else if (t.f.type === 'rune') html = '<span class="emo sm glow">✴️</span>';
      }
      if (t.m) {
        const d = MONSTERS[t.m.type];
        html += `<span class="mon m-${t.m.type}"><span class="emo">${d.icon}</span><i class="mhp">${t.m.hp}</i></span>`;
      }
      if (sc) {
        if (sc.target === 'empty' && this.validEmpty(r, c, sel)) cls += ' valid';
        if (sc.target === 'hero' && this.heroesAt(r, c).length) cls += ' valid';
      }
      if (el.className !== cls) el.className = cls;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
    }
  }

  renderHeroes() {
    const cell = this.cell;
    const counts = {};
    const live = new Set();
    for (const h of this.heroes) {
      let el = this.heroEls.get(h.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'hero';
        el.innerHTML = `<div class="hbody">${HEROES[h.cls].icon}</div><div class="hbar"><i class="hp"></i></div><div class="nbar"><i></i></div><div class="arrow"></div><div class="bubble"></div>`;
        this.el.heroes.appendChild(el);
        this.heroEls.set(h.id, el);
      }
      if (h.state === 'escaped' && !el.classList.contains('gone')) { el.classList.add('gone', 'escaped'); setTimeout(() => el.remove(), 900); }
      if (h.state === 'dead' && !el.classList.contains('gone')) { el.classList.add('gone', 'dead'); setTimeout(() => el.remove(), 1600); }
      if (h.state !== 'in') continue;
      live.add(h.id);
      const k = key(h.r, h.c);
      const idx = counts[k] = (counts[k] || 0) + 1;
      const off = idx > 1 ? (idx - 1) * cell * 0.18 : 0;
      el.style.transform = `translate(${h.c * cell + off}px, ${h.r * cell - off * 0.5}px)`;
      el.querySelector('.hp').style.width = Math.max(0, (h.hp / h.maxHp) * 100) + '%';
      el.querySelector('.nbar i').style.width = h.boss ? '100%' : Math.max(0, (h.nerve / h.maxNerve) * 100) + '%';
      el.classList.toggle('fleeing', h.fleeing);
      el.classList.toggle('stunned', h.stun > 0);
      el.classList.toggle('boss', h.boss);
      el.classList.toggle('unlucky', h.unlucky);
      // стрелка намерения
      const arrow = el.querySelector('.arrow');
      const path = this.busy ? null : this.plan(h);
      if (path && path.length) {
        const n = path[0];
        const ang = n.r > h.r ? 90 : n.r < h.r ? -90 : n.c > h.c ? 0 : 180;
        arrow.style.display = 'block';
        arrow.style.transform = `rotate(${ang}deg)`;
      } else arrow.style.display = 'none';
    }
  }

  bubble(h, text, sticky = false) {
    const el = this.heroEls.get(h.id);
    if (!el) return;
    const b = el.querySelector('.bubble');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('show'), sticky ? 1500 : 2000);
  }

  float(r, c, text, cls = '') {
    const d = document.createElement('div');
    d.className = 'float ' + cls;
    d.textContent = text;
    d.style.left = (c + 0.5) * this.cell + 'px';
    d.style.top = (r + 0.3) * this.cell + 'px';
    this.el.fx.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  flashCell(r, c, big = false) {
    const el = this.cellEls[r * COLS + c];
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (big) { el.classList.add('boom'); setTimeout(() => el.classList.remove('boom'), 500); }
  }
  shakeCell(r, c) {
    const el = this.cellEls[r * COLS + c].querySelector('.mon');
    if (!el) return;
    el.classList.remove('hurt'); void el.offsetWidth; el.classList.add('hurt');
  }
  hitAnim(h) {
    const el = this.heroEls.get(h.id); if (!el) return;
    const b = el.querySelector('.hbody');
    b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt');
  }
  lunge(h, r, c) {
    const el = this.heroEls.get(h.id); if (!el) return;
    const b = el.querySelector('.hbody');
    b.style.setProperty('--dx', (c - h.c) * 0.35 * this.cell + 'px');
    b.style.setProperty('--dy', (r - h.r) * 0.35 * this.cell + 'px');
    b.classList.remove('lunge'); void b.offsetWidth; b.classList.add('lunge');
  }
  monsterLunge(p, h) {
    const el = this.cellEls[p.r * COLS + p.c].querySelector('.mon');
    if (!el) return;
    if (MONSTERS[this.t(p.r, p.c).m.type].range > 1) {
      this.float(h.r, h.c, '➶', 'info');
    }
    el.style.setProperty('--dx', Math.sign(h.c - p.c) * 0.3 * this.cell + 'px');
    el.style.setProperty('--dy', Math.sign(h.r - p.r) * 0.3 * this.cell + 'px');
    el.classList.remove('lunge'); void el.offsetWidth; el.classList.add('lunge');
  }
}
