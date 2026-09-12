import { t, getLang } from './i18n.js';
import { gameplayStart, gameplayStop, cloudSave, showRewarded, showFullscreen } from './yandex.js';

const SAVE_KEY = 'burger_rush_save_v1';
const WORLD_W = 960;
const WORLD_H = 640;

const COLORS = {
  floor: '#5c3d1e',
  floorAlt: '#6a4726',
  wall: '#3a2414',
  counter: '#8b5a2b',
  grill: '#444',
  grillHot: '#e74c3c',
  prep: '#c9a66b',
  table: '#a67c52',
  dirty: '#6b4423',
  player: '#3498db',
  waiter: '#2ecc71',
  cleaner: '#9b59b6',
  pattyRaw: '#c0392b',
  pattyCooked: '#7b3f00',
  bun: '#f0c27f',
  burger: '#e67e22',
  customer: '#ecf0f1',
  trash: '#555',
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function lerp(a, b, t) { return a + (b - a) * t; }

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.paused = false;
    this.running = false;
    this.time = 0;
    this.dt = 0;
    this.lastTs = 0;
    this.doubleProfitUntil = 0;
    this.tutorialStep = 0;
    this.floatTexts = [];
    this.keys = Object.create(null);
    this.joy = { x: 0, y: 0, active: false };
    this.shopOpen = false;

    this.state = this.defaultState();
    this.layout = this.buildLayout();
    this.customers = [];
    this.workers = [];
    this.plates = []; // dirty plates on tables
    this.spawnTimer = 0;
    this.hintKey = 'hintCook';
    this._saveTimer = 0;
    this._lastFsAt = -999;
    this._cloudTimer = 0;

    this.bindInput();
  }

  defaultState() {
    return {
      cash: 0,
      speedLv: 0,
      capLv: 0,
      profitLv: 0,
      grillLv: 0,
      tablesUnlocked: 1,
      hasWaiter: false,
      hasCleaner: false,
      tutorialDone: false,
      totalServed: 0,
    };
  }

  buildLayout() {
    // Kitchen left, dining right
    const grill = { x: 120, y: 180, w: 100, h: 70, type: 'grill', slots: [
      { progress: 0, state: 'empty' },
      { progress: 0, state: 'empty' },
      { progress: 0, state: 'empty' },
    ]};
    const prep = { x: 120, y: 320, w: 100, h: 60, type: 'prep', patties: 0, burgers: 0 };
    const counter = { x: 280, y: 220, w: 50, h: 200, type: 'counter', burgers: 0 };
    const trash = { x: 80, y: 500, w: 50, h: 50, type: 'trash' };
    const tables = [
      { x: 480, y: 160, w: 70, h: 70, unlocked: true, dirty: false, customer: null, seat: 0 },
      { x: 620, y: 160, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 760, y: 160, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 480, y: 320, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 620, y: 320, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 760, y: 320, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 550, y: 480, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 700, y: 480, w: 70, h: 70, unlocked: false, dirty: false, customer: null, seat: 0 },
    ];
    const queueSpots = [
      { x: 360, y: 260 },
      { x: 360, y: 320 },
      { x: 360, y: 380 },
      { x: 360, y: 440 },
    ];
    return { grill, prep, counter, trash, tables, queueSpots };
  }

  playerSpeed() {
    return 140 + this.state.speedLv * 28;
  }
  carryCap() {
    return 3 + this.state.capLv;
  }
  profitMult() {
    let m = 1 + this.state.profitLv * 0.25;
    if (this.time < this.doubleProfitUntil) m *= 2;
    return m;
  }
  grillCookTime() {
    return Math.max(1.2, 3.2 - this.state.grillLv * 0.35);
  }
  orderPay() {
    return Math.floor(12 * this.profitMult());
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        Object.assign(this.state, data);
      }
    } catch (_) {}
    this.applyUnlocks();
  }

  applyUnlocks() {
    this.layout.tables.forEach((tb, i) => {
      tb.unlocked = i < this.state.tablesUnlocked;
    });
    this.workers = [];
    if (this.state.hasWaiter) {
      this.workers.push({
        type: 'waiter', x: 250, y: 280, vx: 0, vy: 0,
        carrying: 0, task: null, color: COLORS.waiter,
      });
    }
    if (this.state.hasCleaner) {
      this.workers.push({
        type: 'cleaner', x: 400, y: 500, vx: 0, vy: 0,
        carrying: 0, task: null, color: COLORS.cleaner,
      });
    }
  }

  saveLocal() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (_) {}
  }

  async saveCloud() {
    await cloudSave({ ...this.state });
  }

  start() {
    this.load();
    this.player = {
      x: 200, y: 280, r: 18,
      patties: 0, burgers: 0, dirty: 0,
    };
    this.running = true;
    this.paused = false;
    this.lastTs = performance.now();
    gameplayStart();
    requestAnimationFrame((ts) => this.loop(ts));
    this.updateHUD();
    this.refreshShop();
  }

  setPaused(p) {
    if (p === this.paused) return;
    this.paused = p;
    document.getElementById('pauseOverlay')?.classList.toggle('hidden', !p);
    if (p) gameplayStop();
    else {
      this.lastTs = performance.now();
      gameplayStart();
    }
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' || e.code === 'Space') this.tryInteract();
      if (e.code === 'Escape') {
        if (this.shopOpen) this.closeShop();
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.shopOpen) return;
      const p = this.screenToWorld(e.clientX, e.clientY);
      // tap interact near stations
      if (dist(p, this.player) < 80) this.tryInteract();
    });

    // Virtual joystick
    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    if (!base || !knob) return;
    const maxR = 34;
    let pid = null;
    const setKnob = (dx, dy) => {
      const len = Math.hypot(dx, dy) || 1;
      const c = Math.min(1, maxR / len);
      const kx = dx * c;
      const ky = dy * c;
      knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
      this.joy.x = kx / maxR;
      this.joy.y = ky / maxR;
      this.joy.active = true;
    };
    const reset = () => {
      knob.style.transform = 'translate(-50%, -50%)';
      this.joy.x = 0; this.joy.y = 0; this.joy.active = false;
      pid = null;
    };
    base.addEventListener('pointerdown', (e) => {
      pid = e.pointerId;
      base.setPointerCapture(pid);
      const rect = base.getBoundingClientRect();
      setKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
    });
    base.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const rect = base.getBoundingClientRect();
      setKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
    });
    base.addEventListener('pointerup', reset);
    base.addEventListener('pointercancel', reset);
  }

  screenToWorld(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / rect.width;
    const sy = this.canvas.height / rect.height;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  }

  loop(ts) {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (!this.paused && !this.shopOpen) {
      this.dt = dt;
      this.time += dt;
      this.update(dt);
    }
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.updatePlayer(dt);
    this.updateGrill(dt);
    this.updateCustomers(dt);
    this.updateWorkers(dt);
    this.updateTutorial();
    this._saveTimer += dt;
    if (this._saveTimer > 3) {
      this._saveTimer = 0;
    this._lastFsAt = -999;
      this.saveLocal();
    }
    this._cloudTimer += dt;
    if (this._cloudTimer > 25) {
      this._cloudTimer = 0;
      this.saveCloud();
    }
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.y -= 30 * dt;
      f.life -= dt;
      if (f.life <= 0) this.floatTexts.splice(i, 1);
    }
    this.updateHUD();
  }

  updatePlayer(dt) {
    let mx = this.joy.x;
    let my = this.joy.y;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) my -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) my += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0.05) {
      mx /= len; my /= len;
      const sp = this.playerSpeed();
      this.player.x = clamp(this.player.x + mx * sp * dt, 40, WORLD_W - 40);
      this.player.y = clamp(this.player.y + my * sp * dt, 60, WORLD_H - 40);
      // soft walls: kitchen divider is open
    }
    // Auto-interact when standing on stations
    this.autoInteract(dt);
  }

  near(obj, pad = 45) {
    const cx = obj.x + (obj.w || 0) / 2;
    const cy = obj.y + (obj.h || 0) / 2;
    return dist(this.player, { x: cx, y: cy }) < pad + Math.max(obj.w || 20, obj.h || 20) * 0.35;
  }

  autoInteract(dt) {
    const g = this.layout.grill;
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    // Start cooking empty slots when near grill
    if (this.near(g, 55)) {
      for (const s of g.slots) {
        if (s.state === 'empty') {
          s.state = 'cooking';
          s.progress = 0;
          break;
        }
      }
      // Pick cooked
      for (const s of g.slots) {
        if (s.state === 'ready' && this.player.patties < this.carryCap()) {
          s.state = 'empty';
          s.progress = 0;
          this.player.patties++;
          this.float('+🍖', this.player.x, this.player.y - 20);
          if (this.tutorialStep === 1) this.tutorialStep = 2;
        }
      }
    }
    // Drop patties at prep / take burgers
    if (this.near(prep, 50)) {
      if (this.player.patties > 0) {
        prep.patties += this.player.patties;
        this.player.patties = 0;
        if (this.tutorialStep === 2) this.tutorialStep = 3;
      }
      // Assemble: each patty -> burger instantly at prep
      while (prep.patties > 0 && prep.burgers < 20) {
        prep.patties--;
        prep.burgers++;
      }
      const room = this.carryCap() - this.player.burgers;
      if (room > 0 && prep.burgers > 0) {
        const take = Math.min(room, prep.burgers);
        prep.burgers -= take;
        this.player.burgers += take;
        this.float('+🍔', this.player.x, this.player.y - 20);
        if (this.tutorialStep === 3) this.tutorialStep = 4;
      }
    }
    // Serve to counter
    if (this.near(counter, 50) && this.player.burgers > 0) {
      counter.burgers += this.player.burgers;
      this.player.burgers = 0;
      this.float('→ 🍽️', this.player.x, this.player.y - 20);
      if (this.tutorialStep === 4) this.tutorialStep = 5;
    }
    // Clean dirty tables
    for (const tb of this.layout.tables) {
      if (!tb.unlocked || !tb.dirty) continue;
      if (this.near(tb, 48)) {
        tb.dirty = false;
        this.state.cash += 3;
        this.float('+3', tb.x + 35, tb.y, '#2ecc71');
        if (this.tutorialStep === 6) {
          this.tutorialStep = 7;
          this.state.tutorialDone = true;
        }
      }
    }
  }

  tryInteract() {
    this.autoInteract(0);
  }

  updateGrill(dt) {
    const need = this.grillCookTime();
    for (const s of this.layout.grill.slots) {
      if (s.state === 'cooking') {
        s.progress += dt;
        if (s.progress >= need) {
          s.state = 'ready';
          s.progress = need;
          if (this.tutorialStep === 0) this.tutorialStep = 1;
        }
      }
    }
  }

  updateCustomers(dt) {
    this.spawnTimer -= dt;
    const unlocked = this.layout.tables.filter((t) => t.unlocked);
    const waiting = this.customers.filter((c) => c.state === 'queue').length;
    const maxQueue = Math.min(4, 1 + Math.floor(this.state.tablesUnlocked / 2));
    if (this.spawnTimer <= 0 && waiting < maxQueue) {
      this.spawnTimer = Math.max(1.5, 4.5 - this.state.tablesUnlocked * 0.25);
      this.customers.push({
        x: 360, y: 560, targetY: 0, state: 'queue',
        patience: 28, order: 1, color: `hsl(${Math.random() * 360|0},55%,65%)`,
        table: null, eatTime: 0,
      });
    }
    // Assign queue positions
    const queued = this.customers.filter((c) => c.state === 'queue');
    queued.forEach((c, i) => {
      const spot = this.layout.queueSpots[Math.min(i, this.layout.queueSpots.length - 1)];
      c.x = lerp(c.x, spot.x, 1 - Math.pow(0.001, dt));
      c.y = lerp(c.y, spot.y, 1 - Math.pow(0.001, dt));
      c.patience -= dt * 0.15;
    });
    // Serve from counter to first queued
    const counter = this.layout.counter;
    if (counter.burgers > 0 && queued.length) {
      const c = queued[0];
      if (dist(c, this.layout.queueSpots[0]) < 30) {
        counter.burgers--;
        // find free table
        const free = unlocked.find((tb) => !tb.customer && !tb.dirty);
        if (free) {
          c.state = 'toTable';
          c.table = free;
          free.customer = c;
          const pay = this.orderPay();
          this.state.cash += pay;
          this.state.totalServed++;
          this.float(`+${pay}`, free.x + 35, free.y - 10, '#f1c40f');
          if (this.tutorialStep === 5) this.tutorialStep = 6;
        } else {
          // eat at counter quickly then leave — still pay less
          counter.burgers++; // put back, wait for table
        }
      }
    }
    // Move to table / eat / leave
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.state === 'toTable' && c.table) {
        const tx = c.table.x + c.table.w / 2;
        const ty = c.table.y + c.table.h / 2;
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d < 8) {
          c.x = tx; c.y = ty;
          c.state = 'eating';
          c.eatTime = 4 + Math.random() * 2;
        } else {
          c.x += ((tx - c.x) / d) * 110 * dt;
          c.y += ((ty - c.y) / d) * 110 * dt;
        }
      } else if (c.state === 'eating') {
        c.eatTime -= dt;
        if (c.eatTime <= 0) {
          if (c.table) {
            c.table.dirty = true;
            c.table.customer = null;
          }
          c.state = 'leave';
        }
      } else if (c.state === 'leave') {
        c.y += 140 * dt;
        c.x += 40 * dt;
        if (c.y > WORLD_H + 40) this.customers.splice(i, 1);
      } else if (c.state === 'queue' && c.patience <= 0) {
        c.state = 'leave';
      }
    }
  }

  updateWorkers(dt) {
    for (const w of this.workers) {
      if (w.type === 'waiter') this.updateWaiter(w, dt);
      if (w.type === 'cleaner') this.updateCleaner(w, dt);
    }
  }

  updateWaiter(w, dt) {
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    const cap = 2 + Math.floor(this.state.capLv / 2);
    if (w.carrying <= 0) {
      // go to prep
      const tx = prep.x + prep.w / 2;
      const ty = prep.y + prep.h / 2;
      this.moveEntity(w, tx, ty, 100, dt);
      if (dist(w, { x: tx, y: ty }) < 28) {
        // assemble leftover + take
        while (prep.patties > 0 && prep.burgers < 20) {
          prep.patties--;
          prep.burgers++;
        }
        const take = Math.min(cap, prep.burgers);
        prep.burgers -= take;
        w.carrying = take;
      }
    } else {
      const tx = counter.x + counter.w / 2;
      const ty = counter.y + counter.h / 2;
      this.moveEntity(w, tx, ty, 100, dt);
      if (dist(w, { x: tx, y: ty }) < 28) {
        counter.burgers += w.carrying;
        w.carrying = 0;
      }
    }
  }

  updateCleaner(w, dt) {
    const dirty = this.layout.tables.find((tb) => tb.unlocked && tb.dirty);
    if (!dirty) {
      this.moveEntity(w, 400, 520, 80, dt);
      return;
    }
    const tx = dirty.x + dirty.w / 2;
    const ty = dirty.y + dirty.h / 2;
    this.moveEntity(w, tx, ty, 95, dt);
    if (dist(w, { x: tx, y: ty }) < 30) {
      dirty.dirty = false;
      this.state.cash += 2;
    }
  }

  moveEntity(e, tx, ty, speed, dt) {
    const d = Math.hypot(tx - e.x, ty - e.y) || 1;
    if (d < 4) return;
    e.x += ((tx - e.x) / d) * speed * dt;
    e.y += ((ty - e.y) / d) * speed * dt;
  }

  updateTutorial() {
    if (this.state.tutorialDone && this.tutorialStep >= 7) {
      this.hintKey = this.layout.tables.some((t) => t.dirty) ? 'hintClean' : 'hintIdle';
      document.getElementById('tutorialArrow')?.classList.add('hidden');
      return;
    }
    const steps = [
      { key: 'hintCook', target: () => this.layout.grill },
      { key: 'hintPick', target: () => this.layout.grill },
      { key: 'hintStack', target: () => this.layout.prep },
      { key: 'hintStack', target: () => this.layout.prep },
      { key: 'hintServe', target: () => this.layout.counter },
      { key: 'hintIdle', target: () => this.layout.queueSpots[0] },
      { key: 'hintClean', target: () => this.layout.tables.find((t) => t.dirty) || this.layout.tables[0] },
      { key: 'hintUpgrade', target: () => null },
    ];
    const step = steps[Math.min(this.tutorialStep, steps.length - 1)];
    this.hintKey = step.key;
    const arrow = document.getElementById('tutorialArrow');
    const tgt = step.target && step.target();
    if (arrow && tgt) {
      arrow.classList.remove('hidden');
      const rect = this.canvas.getBoundingClientRect();
      const app = document.getElementById('app').getBoundingClientRect();
      const cx = (tgt.x + (tgt.w || 0) / 2) / WORLD_W * rect.width + rect.left - app.left;
      const cy = (tgt.y + (tgt.h || 0) / 2) / WORLD_H * rect.height + rect.top - app.top;
      arrow.style.left = cx + 'px';
      arrow.style.top = Math.max(40, cy - 30) + 'px';
    } else if (arrow) {
      arrow.classList.add('hidden');
    }
  }

  float(text, x, y, color = '#fff') {
    this.floatTexts.push({ text, x, y, life: 1.1, color });
  }

  updateHUD() {
    const cash = document.getElementById('cashDisplay');
    const hint = document.getElementById('hintText');
    if (cash) {
      const bonus = this.time < this.doubleProfitUntil ? ' ✨x2' : '';
      cash.textContent = `${t('cash')} ${Math.floor(this.state.cash)}${bonus}`;
    }
    if (hint) hint.textContent = t(this.hintKey);
  }

  shopItems() {
    const s = this.state;
    return [
      {
        id: 'speed', name: t('speed'), desc: t('speedDesc'),
        level: s.speedLv, max: 8,
        cost: Math.floor(40 * Math.pow(1.55, s.speedLv)),
        buy: () => { s.speedLv++; },
      },
      {
        id: 'cap', name: t('capacity'), desc: t('capacityDesc'),
        level: s.capLv, max: 6,
        cost: Math.floor(50 * Math.pow(1.6, s.capLv)),
        buy: () => { s.capLv++; },
      },
      {
        id: 'profit', name: t('profit'), desc: t('profitDesc'),
        level: s.profitLv, max: 10,
        cost: Math.floor(60 * Math.pow(1.5, s.profitLv)),
        buy: () => { s.profitLv++; },
      },
      {
        id: 'grill', name: t('grillSpeed'), desc: t('grillSpeedDesc'),
        level: s.grillLv, max: 6,
        cost: Math.floor(45 * Math.pow(1.55, s.grillLv)),
        buy: () => { s.grillLv++; },
      },
      {
        id: 'table', name: t('table'), desc: t('tableDesc'),
        level: s.tablesUnlocked, max: this.layout.tables.length,
        cost: Math.floor(80 * Math.pow(1.45, s.tablesUnlocked - 1)),
        buy: () => {
          s.tablesUnlocked++;
          this.applyUnlocks();
        },
      },
      {
        id: 'waiter', name: t('waiter'), desc: t('waiterDesc'),
        level: s.hasWaiter ? 1 : 0, max: 1,
        cost: 200,
        buy: () => { s.hasWaiter = true; this.applyUnlocks(); },
      },
      {
        id: 'cleaner', name: t('cleaner'), desc: t('cleanerDesc'),
        level: s.hasCleaner ? 1 : 0, max: 1,
        cost: 180,
        buy: () => { s.hasCleaner = true; this.applyUnlocks(); },
      },
    ];
  }

  refreshShop() {
    const list = document.getElementById('shopList');
    if (!list) return;
    list.innerHTML = '';
    for (const item of this.shopItems()) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      const maxed = item.level >= item.max;
      const can = !maxed && this.state.cash >= item.cost;
      const lvlLabel = item.max === 1
        ? (item.level ? t('owned') : '')
        : `${t('lvl')} ${item.level}/${item.max}`;
      row.innerHTML = `
        <div class="info">
          <div class="name">${item.name} ${lvlLabel ? `<small>(${lvlLabel})</small>` : ''}</div>
          <div class="desc">${item.desc}</div>
        </div>
        <button type="button" ${maxed || !can ? 'disabled' : ''}>
          ${maxed ? t('max') : `💰 ${item.cost}`}
        </button>`;
      const btn = row.querySelector('button');
      btn.addEventListener('click', () => {
        if (item.level >= item.max || this.state.cash < item.cost) return;
        this.state.cash -= item.cost;
        item.buy();
        this.saveLocal();
        this.refreshShop();
        this.updateHUD();
      });
      list.appendChild(row);
    }
  }

  openShop() {
    this.shopOpen = true;
    gameplayStop();
    this.refreshShop();
    document.getElementById('shop')?.classList.remove('hidden');
  }

  async closeShop() {
    this.shopOpen = false;
    document.getElementById('shop')?.classList.add('hidden');
    if (!this.paused) gameplayStart();
    // Fullscreen interstitial in a logical pause (Yandex 1.12 monetization)
    if (this.time - this._lastFsAt > 90) {
      this._lastFsAt = this.time;
      await showFullscreen();
    }
  }

  async onReward() {
    const ok = await showRewarded();
    if (ok) {
      this.doubleProfitUntil = this.time + 60;
      this.float(t('rewardOk'), this.player.x, this.player.y - 40, '#f1c40f');
    } else {
      this.float(t('rewardFail'), this.player.x, this.player.y - 40, '#e74c3c');
    }
  }

  // ——— Drawing ———
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);
    this.drawFloor(ctx);
    this.drawKitchen(ctx);
    this.drawTables(ctx);
    this.drawCounterQueue(ctx);
    this.drawCustomers(ctx);
    this.drawWorkers(ctx);
    this.drawPlayer(ctx);
    this.drawFloats(ctx);
    this.drawMinimapLabels(ctx);
  }

  drawFloor(ctx) {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let y = 0; y < WORLD_H; y += 40) {
      for (let x = 0; x < WORLD_W; x += 40) {
        if (((x + y) / 40) % 2 === 0) {
          ctx.fillStyle = COLORS.floorAlt;
          ctx.fillRect(x, y, 40, 40);
        }
      }
    }
    // kitchen zone tint
    ctx.fillStyle = 'rgba(80,50,20,0.35)';
    ctx.fillRect(0, 0, 260, WORLD_H);
    // walls
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, WORLD_W, 40);
    ctx.fillRect(0, 0, 30, WORLD_H);
    ctx.fillRect(WORLD_W - 30, 0, 30, WORLD_H);
    ctx.fillRect(0, WORLD_H - 30, WORLD_W, 30);
    // title on wall
    ctx.fillStyle = '#ffc857';
    ctx.font = 'bold 22px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(getLang() === 'en' ? 'Burger Rush' : 'Бургерная', WORLD_W / 2, 28);
  }

  drawKitchen(ctx) {
    const g = this.layout.grill;
    // grill body
    this.roundRect(ctx, g.x, g.y, g.w, g.h, 8, '#2c2c2c');
    ctx.fillStyle = '#ffc857';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🔥 GRILL', g.x + g.w / 2, g.y - 8);
    g.slots.forEach((s, i) => {
      const sx = g.x + 12 + i * 30;
      const sy = g.y + 18;
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(sx + 10, sy + 18, 12, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      if (s.state === 'cooking' || s.state === 'ready') {
        const tCook = s.progress / this.grillCookTime();
        ctx.fillStyle = s.state === 'ready' ? COLORS.pattyCooked : COLORS.pattyRaw;
        ctx.beginPath();
        ctx.ellipse(sx + 10, sy + 18, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        if (s.state === 'cooking') {
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(sx, sy + 32, 20, 5);
          ctx.fillStyle = '#f1c40f';
          ctx.fillRect(sx, sy + 32, 20 * tCook, 5);
        }
        if (s.state === 'ready') {
          ctx.fillStyle = '#2ecc71';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText('OK', sx + 10, sy + 8);
        }
      }
    });

    const prep = this.layout.prep;
    this.roundRect(ctx, prep.x, prep.y, prep.w, prep.h, 8, COLORS.prep);
    ctx.fillStyle = '#5c3d1e';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('🍔 PREP', prep.x + prep.w / 2, prep.y - 8);
    ctx.fillStyle = '#3d2914';
    ctx.font = '11px sans-serif';
    ctx.fillText(`🍖${prep.patties}  🍔${prep.burgers}`, prep.x + prep.w / 2, prep.y + prep.h / 2 + 4);

    const trash = this.layout.trash;
    this.roundRect(ctx, trash.x, trash.y, trash.w, trash.h, 6, COLORS.trash);
    ctx.fillStyle = '#bbb';
    ctx.font = '20px sans-serif';
    ctx.fillText('🗑️', trash.x + trash.w / 2, trash.y + trash.h / 2 + 8);
  }

  drawTables(ctx) {
    for (const tb of this.layout.tables) {
      if (!tb.unlocked) {
        ctx.globalAlpha = 0.35;
        this.roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 8, '#555');
        ctx.fillStyle = '#fff';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔒', tb.x + tb.w / 2, tb.y + tb.h / 2 + 8);
        ctx.globalAlpha = 1;
        continue;
      }
      this.roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 8, tb.dirty ? COLORS.dirty : COLORS.table);
      // plates
      ctx.fillStyle = tb.dirty ? '#8e5a3a' : '#eee';
      ctx.beginPath();
      ctx.ellipse(tb.x + tb.w / 2, tb.y + tb.h / 2, 16, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      if (tb.dirty) {
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🧼', tb.x + tb.w / 2, tb.y - 6);
      }
    }
  }

  drawCounterQueue(ctx) {
    const c = this.layout.counter;
    this.roundRect(ctx, c.x, c.y, c.w, c.h, 6, COLORS.counter);
    ctx.fillStyle = '#ffc857';
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('COUNTER', 0, 0);
    ctx.restore();
    // burgers stacked
    for (let i = 0; i < Math.min(c.burgers, 8); i++) {
      this.drawBurger(ctx, c.x + c.w / 2, c.y + c.h - 20 - i * 14, 0.7);
    }
    if (c.burgers > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(c.burgers), c.x + c.w / 2, c.y + 16);
    }
  }

  drawCustomers(ctx) {
    for (const c of this.customers) {
      this.drawPerson(ctx, c.x, c.y, c.color, 16);
      if (c.state === 'queue') {
        ctx.fillStyle = '#fff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🍔?', c.x, c.y - 22);
      }
    }
  }

  drawWorkers(ctx) {
    for (const w of this.workers) {
      this.drawPerson(ctx, w.x, w.y, w.color, 15);
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.type === 'waiter' ? '👔' : '🧹', w.x, w.y - 20);
      if (w.carrying > 0) {
        for (let i = 0; i < w.carrying; i++) {
          this.drawBurger(ctx, w.x, w.y - 28 - i * 10, 0.5);
        }
      }
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    this.drawPerson(ctx, p.x, p.y, COLORS.player, 18);
    // hat
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - 16, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(p.x - 8, p.y - 28, 16, 12);
    // carry stack
    let stack = 0;
    for (let i = 0; i < p.patties; i++) {
      ctx.fillStyle = COLORS.pattyCooked;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 32 - stack * 8, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      stack++;
    }
    for (let i = 0; i < p.burgers; i++) {
      this.drawBurger(ctx, p.x, p.y - 32 - stack * 10, 0.55);
      stack++;
    }
  }

  drawPerson(ctx, x, y, color, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.7, r * 0.7, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe0bd';
    ctx.beginPath();
    ctx.arc(x, y - r * 0.55, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBurger(ctx, x, y, scale = 1) {
    const s = scale;
    ctx.fillStyle = COLORS.bun;
    ctx.beginPath();
    ctx.ellipse(x, y - 4 * s, 11 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.pattyCooked;
    ctx.beginPath();
    ctx.ellipse(x, y, 10 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2ecc71';
    ctx.fillRect(x - 8 * s, y - 1 * s, 16 * s, 2 * s);
    ctx.fillStyle = COLORS.bun;
    ctx.beginPath();
    ctx.ellipse(x, y + 4 * s, 11 * s, 4 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawFloats(ctx) {
    for (const f of this.floatTexts) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
  }

  drawMinimapLabels(ctx) {
    // carry capacity indicator
    const p = this.player;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.roundRect(ctx, 40, WORLD_H - 70, 160, 28, 8, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🍖${p.patties} 🍔${p.burgers} / ${this.carryCap()}`, 52, WORLD_H - 52);
  }

  roundRect(ctx, x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
}
