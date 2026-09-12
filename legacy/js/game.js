import { t, getLang } from './i18n.js';
import { gameplayStart, gameplayStop, cloudSave, showRewarded, showFullscreen } from './yandex.js';

const SAVE_KEY = 'burger_rush_save_v1';
const WORLD_W = 960;
const WORLD_H = 640;
const SKINS = ['#f1c27d', '#ffdeb4', '#e0ac69', '#c68642', '#8d5524'];

const COLORS = {
  kitchenA: '#c4784a',
  kitchenB: '#d4895a',
  diningA: '#7d5a38',
  diningB: '#6e4e30',
  wall: '#4a2c1a',
  wallTop: '#6b3e24',
  grillBody: '#2a2a2a',
  grillHot: '#e74c3c',
  prep: '#f4d03f',
  counter: '#27ae60',
  table: '#a67c52',
  cloth: '#5d8aa8',
  dirty: '#6b3a1f',
  trash: '#3a3a3a',
  waiter: '#1abc9c',
  cleaner: '#9b59b6',
  pattyRaw: '#c0392b',
  pattyCooked: '#6b3a12',
  bun: '#f0c27f',
  coat: '#f4f6f7',
};

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function lerp(a, b, t) { return a + (b - a) * t; }
function patienceColor(p) {
  const t = clamp(p, 0, 1);
  if (t > 0.5) {
    const k = (t - 0.5) * 2;
    return `rgb(${Math.round(241 - 80 * k)},${Math.round(196 + 20 * k)},${Math.round(15 + 20 * k)})`;
  }
  const k = t * 2;
  return `rgb(${Math.round(231)},${Math.round(76 + 120 * k)},${Math.round(60)})`;
}

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
    this.plates = [];
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
    const grill = { x: 118, y: 178, w: 112, h: 78, type: 'grill', slots: [
      { progress: 0, state: 'empty' },
      { progress: 0, state: 'empty' },
      { progress: 0, state: 'empty' },
    ]};
    const prep = { x: 118, y: 318, w: 112, h: 68, type: 'prep', patties: 0, burgers: 0 };
    const counter = { x: 278, y: 210, w: 56, h: 220, type: 'counter', burgers: 0 };
    const trash = { x: 78, y: 498, w: 56, h: 56, type: 'trash' };
    const tables = [
      { x: 480, y: 160, w: 74, h: 74, unlocked: true, dirty: false, customer: null, seat: 0 },
      { x: 620, y: 160, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 760, y: 160, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 480, y: 320, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 620, y: 320, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 760, y: 320, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 550, y: 480, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
      { x: 700, y: 480, w: 74, h: 74, unlocked: false, dirty: false, customer: null, seat: 0 },
    ];
    const queueSpots = [
      { x: 368, y: 258 },
      { x: 368, y: 318 },
      { x: 368, y: 378 },
      { x: 368, y: 438 },
    ];
    return { grill, prep, counter, trash, tables, queueSpots };
  }

  playerSpeed() { return 140 + this.state.speedLv * 28; }
  carryCap() { return 3 + this.state.capLv; }
  profitMult() {
    let m = 1 + this.state.profitLv * 0.25;
    if (this.time < this.doubleProfitUntil) m *= 2;
    return m;
  }
  grillCookTime() { return Math.max(1.2, 3.2 - this.state.grillLv * 0.35); }
  orderPay() { return Math.floor(12 * this.profitMult()); }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) Object.assign(this.state, JSON.parse(raw));
    } catch (_) {}
    this.applyUnlocks();
    if (this.state.tutorialDone) this.tutorialStep = 5;
  }

  applyUnlocks() {
    this.layout.tables.forEach((tb, i) => { tb.unlocked = i < this.state.tablesUnlocked; });
    this.workers = [];
    if (this.state.hasWaiter) {
      this.workers.push({
        type: 'waiter', x: 250, y: 280, vx: 0, vy: 0,
        carrying: 0, task: null, color: COLORS.waiter, facing: 1, walk: 0,
      });
    }
    if (this.state.hasCleaner) {
      this.workers.push({
        type: 'cleaner', x: 400, y: 500, vx: 0, vy: 0,
        carrying: 0, task: null, color: COLORS.cleaner, facing: 1, walk: 0,
      });
    }
  }

  saveLocal() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state)); } catch (_) {}
  }

  async saveCloud() {
    await cloudSave({ ...this.state });
  }

  start() {
    this.load();
    this.player = {
      x: 200, y: 280, r: 18,
      patties: 0, burgers: 0, dirty: 0,
      facing: 1, walk: 0,
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
      if (e.code === 'Escape' && this.shopOpen) this.closeShop();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.shopOpen) return;
      const p = this.screenToWorld(e.clientX, e.clientY);
      if (dist(p, this.player) < 80) this.tryInteract();
    });

    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    if (!base || !knob) return;
    const maxR = 36;
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
      this.saveLocal();
    }
    this._cloudTimer += dt;
    if (this._cloudTimer > 25) {
      this._cloudTimer = 0;
      this.saveCloud();
    }
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.y -= 36 * dt;
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
      if (mx !== 0) this.player.facing = mx >= 0 ? 1 : -1;
      this.player.walk += dt * 12;
      const sp = this.playerSpeed();
      this.player.x = clamp(this.player.x + mx * sp * dt, 40, WORLD_W - 40);
      this.player.y = clamp(this.player.y + my * sp * dt, 70, WORLD_H - 40);
    } else {
      this.player.walk *= 0.85;
    }
    this.autoInteract(dt);
  }

  near(obj, pad = 45) {
    const cx = obj.x + (obj.w || 0) / 2;
    const cy = obj.y + (obj.h || 0) / 2;
    return dist(this.player, { x: cx, y: cy }) < pad + Math.max(obj.w || 20, obj.h || 20) * 0.35;
  }

  getFocusStation() {
    const list = [
      { obj: this.layout.grill, pad: 55, kind: 'grill', color: '#ff6b35' },
      { obj: this.layout.prep, pad: 50, kind: 'prep', color: '#f1c40f' },
      { obj: this.layout.counter, pad: 50, kind: 'counter', color: '#2ecc71' },
    ];
    for (const tb of this.layout.tables) {
      if (tb.unlocked && tb.dirty) {
        list.push({ obj: tb, pad: 48, kind: 'table', color: '#e67e22' });
      }
    }
    let best = null;
    let bestD = 1e9;
    for (const s of list) {
      if (!this.near(s.obj, s.pad)) continue;
      const cx = s.obj.x + s.obj.w / 2;
      const cy = s.obj.y + s.obj.h / 2;
      const d = dist(this.player, { x: cx, y: cy });
      if (d < bestD) { best = s; bestD = d; }
    }
    if (!best) return null;
    if (best.kind === 'prep' && this.player.patties <= 0 && this.layout.prep.burgers <= 0) return null;
    if (best.kind === 'counter' && this.player.burgers <= 0) return null;
    return best;
  }

  autoInteract(dt) {
    const g = this.layout.grill;
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    if (this.near(g, 55)) {
      for (const s of g.slots) {
        if (s.state === 'empty') {
          s.state = 'cooking';
          s.progress = 0;
          break;
        }
      }
      for (const s of g.slots) {
        if (s.state === 'ready' && this.player.patties < this.carryCap()) {
          s.state = 'empty';
          s.progress = 0;
          this.player.patties++;
          this.float('+🍖', this.player.x, this.player.y - 28);
          if (this.tutorialStep <= 1) this.tutorialStep = 2;
        }
      }
    }
    if (this.near(prep, 50)) {
      if (this.player.patties > 0) {
        prep.patties += this.player.patties;
        this.player.patties = 0;
      }
      while (prep.patties > 0 && prep.burgers < 20) {
        prep.patties--;
        prep.burgers++;
      }
      const room = this.carryCap() - this.player.burgers;
      if (room > 0 && prep.burgers > 0) {
        const take = Math.min(room, prep.burgers);
        prep.burgers -= take;
        this.player.burgers += take;
        this.float('+🍔', this.player.x, this.player.y - 28);
        if (this.tutorialStep <= 2) this.tutorialStep = 3;
      }
    }
    if (this.near(counter, 50) && this.player.burgers > 0) {
      counter.burgers += this.player.burgers;
      this.player.burgers = 0;
      this.float('→ 🍽️', this.player.x, this.player.y - 28);
      if (this.tutorialStep <= 3) this.tutorialStep = 4;
    }
    for (const tb of this.layout.tables) {
      if (!tb.unlocked || !tb.dirty) continue;
      if (this.near(tb, 48)) {
        tb.dirty = false;
        this.state.cash += 3;
        this.float('+$3', tb.x + 37, tb.y, '#2ecc71');
        if (this.tutorialStep <= 4) {
          this.tutorialStep = 5;
          this.state.tutorialDone = true;
        }
      }
    }
  }

  tryInteract() { this.autoInteract(0); }

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
    const unlocked = this.layout.tables.filter((tb) => tb.unlocked);
    const waiting = this.customers.filter((c) => c.state === 'queue').length;
    const maxQueue = Math.min(4, 1 + Math.floor(this.state.tablesUnlocked / 2));
    if (this.spawnTimer <= 0 && waiting < maxQueue) {
      this.spawnTimer = Math.max(1.5, 4.5 - this.state.tablesUnlocked * 0.25);
      this.customers.push({
        x: 360, y: 560, state: 'queue',
        patience: 28, order: 1,
        shirt: `hsl(${(Math.random() * 360) | 0},62%,56%)`,
        skin: SKINS[(Math.random() * SKINS.length) | 0],
        shape: (Math.random() * 4) | 0,
        hair: `hsl(${(Math.random() * 40 + 8) | 0},38%,${(18 + Math.random() * 22) | 0}%)`,
        table: null, eatTime: 0, facing: -1,
      });
    }
    const queued = this.customers.filter((c) => c.state === 'queue');
    queued.forEach((c, i) => {
      const spot = this.layout.queueSpots[Math.min(i, this.layout.queueSpots.length - 1)];
      c.x = lerp(c.x, spot.x, 1 - Math.pow(0.001, dt));
      c.y = lerp(c.y, spot.y, 1 - Math.pow(0.001, dt));
      c.patience -= dt * 0.15;
    });
    const counter = this.layout.counter;
    if (counter.burgers > 0 && queued.length) {
      const c = queued[0];
      if (dist(c, this.layout.queueSpots[0]) < 30) {
        counter.burgers--;
        const free = unlocked.find((tb) => !tb.customer && !tb.dirty);
        if (free) {
          c.state = 'toTable';
          c.table = free;
          free.customer = c;
          const pay = this.orderPay();
          this.state.cash += pay;
          this.state.totalServed++;
          this.float(`+$${pay}`, free.x + 37, free.y - 12, '#f1c40f');
        } else {
          counter.burgers++;
        }
      }
    }
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.state === 'toTable' && c.table) {
        const tx = c.table.x + c.table.w / 2;
        const ty = c.table.y + c.table.h / 2 + 18;
        const d = Math.hypot(tx - c.x, ty - c.y);
        if (d < 8) {
          c.x = tx; c.y = ty;
          c.state = 'eating';
          c.eatTime = 4 + Math.random() * 2;
        } else {
          c.facing = tx >= c.x ? 1 : -1;
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
        c.facing = 1;
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
      const tx = prep.x + prep.w / 2;
      const ty = prep.y + prep.h / 2;
      this.moveEntity(w, tx, ty, 100, dt);
      if (dist(w, { x: tx, y: ty }) < 28) {
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
    if (d < 4) { e.walk = 0; return; }
    e.facing = tx >= e.x ? 1 : -1;
    e.walk = (e.walk || 0) + dt * 10;
    e.x += ((tx - e.x) / d) * speed * dt;
    e.y += ((ty - e.y) / d) * speed * dt;
  }

  tutorialTarget() {
    if (this.state.tutorialDone || this.tutorialStep >= 5) return null;
    if (this.tutorialStep <= 1) return this.layout.grill;
    if (this.tutorialStep === 2) return this.layout.prep;
    if (this.tutorialStep === 3) return this.layout.counter;
    if (this.tutorialStep === 4) {
      return this.layout.tables.find((tb) => tb.dirty) || null;
    }
    return null;
  }

  updateTutorial() {
    const arrow = document.getElementById('tutorialArrow');
    if (this.state.tutorialDone || this.tutorialStep >= 5) {
      this.hintKey = this.layout.tables.some((tb) => tb.dirty) ? 'hintClean' : 'hintIdle';
      arrow?.classList.add('hidden');
      return;
    }
    const keys = ['hintCook', 'hintPick', 'hintStack', 'hintServe', 'hintClean'];
    this.hintKey = keys[Math.min(this.tutorialStep, keys.length - 1)];
    if (this.tutorialStep === 4 && !this.layout.tables.some((tb) => tb.dirty)) {
      this.hintKey = 'hintWait';
    }
    // Canvas draws the pulsing arrow; hide the DOM one to avoid double arrows.
    arrow?.classList.add('hidden');
  }

  float(text, x, y, color = '#fff') {
    this.floatTexts.push({ text, x, y, life: 1.15, color });
  }

  updateHUD() {
    const cash = document.getElementById('cashDisplay');
    const hint = document.getElementById('hintText');
    const carry = document.getElementById('carryDisplay');
    const stepEl = document.getElementById('hintStep');
    const banner = document.getElementById('hintBanner');
    if (cash) {
      const bonus = this.time < this.doubleProfitUntil ? ' ✨x2' : '';
      cash.textContent = `${t('cash')} ${Math.floor(this.state.cash)}${bonus}`;
    }
    if (carry && this.player) {
      carry.textContent = `🍖 ${this.player.patties}  ·  🍔 ${this.player.burgers}  /  ${this.carryCap()}`;
    }
    if (hint) hint.textContent = t(this.hintKey);
    if (stepEl && banner) {
      const tutoring = !this.state.tutorialDone && this.tutorialStep < 5;
      stepEl.classList.toggle('hidden', !tutoring);
      banner.classList.toggle('idle', !tutoring);
      if (tutoring) stepEl.textContent = `${t('step')} ${this.tutorialStep + 1}/5`;
    }
  }

  shopItems() {
    const s = this.state;
    return [
      { id: 'speed', icon: '👟', name: t('speed'), desc: t('speedDesc'), level: s.speedLv, max: 8, cost: Math.floor(40 * Math.pow(1.55, s.speedLv)), buy: () => { s.speedLv++; } },
      { id: 'cap', icon: '🎒', name: t('capacity'), desc: t('capacityDesc'), level: s.capLv, max: 6, cost: Math.floor(50 * Math.pow(1.6, s.capLv)), buy: () => { s.capLv++; } },
      { id: 'profit', icon: '💵', name: t('profit'), desc: t('profitDesc'), level: s.profitLv, max: 10, cost: Math.floor(60 * Math.pow(1.5, s.profitLv)), buy: () => { s.profitLv++; } },
      { id: 'grill', icon: '🔥', name: t('grillSpeed'), desc: t('grillSpeedDesc'), level: s.grillLv, max: 6, cost: Math.floor(45 * Math.pow(1.55, s.grillLv)), buy: () => { s.grillLv++; } },
      { id: 'table', icon: '🪑', name: t('table'), desc: t('tableDesc'), level: s.tablesUnlocked, max: this.layout.tables.length, cost: Math.floor(80 * Math.pow(1.45, s.tablesUnlocked - 1)), buy: () => { s.tablesUnlocked++; this.applyUnlocks(); } },
      { id: 'waiter', icon: '👔', name: t('waiter'), desc: t('waiterDesc'), level: s.hasWaiter ? 1 : 0, max: 1, cost: 200, buy: () => { s.hasWaiter = true; this.applyUnlocks(); } },
      { id: 'cleaner', icon: '🧹', name: t('cleaner'), desc: t('cleanerDesc'), level: s.hasCleaner ? 1 : 0, max: 1, cost: 180, buy: () => { s.hasCleaner = true; this.applyUnlocks(); } },
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
        <div class="shop-icon" aria-hidden="true">${item.icon}</div>
        <div class="info">
          <div class="name">${item.name} ${lvlLabel ? `<small>(${lvlLabel})</small>` : ''}</div>
          <div class="desc">${item.desc}</div>
        </div>
        <button type="button" ${maxed || !can ? 'disabled' : ''}>
          ${maxed ? t('max') : `💰 ${item.cost}`}
        </button>`;
      row.querySelector('button').addEventListener('click', () => {
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
    this.drawZonePads(ctx);
    this.drawDecor(ctx);
    this.drawKitchen(ctx);
    this.drawTables(ctx);
    this.drawCounterQueue(ctx);
    this.drawFocusGlow(ctx);
    this.drawCustomers(ctx);
    this.drawWorkers(ctx);
    this.drawPlayer(ctx);
    this.drawTutorialMark(ctx);
    this.drawInteractPrompt(ctx);
    this.drawFloats(ctx);
  }

  drawFloor(ctx) {
    const tile = 40;
    for (let y = 0; y < WORLD_H; y += tile) {
      for (let x = 0; x < WORLD_W; x += tile) {
        const kitchen = x < 430;
        const alt = ((x + y) / tile) % 2 === 0;
        ctx.fillStyle = kitchen
          ? (alt ? COLORS.kitchenA : COLORS.kitchenB)
          : (alt ? COLORS.diningA : COLORS.diningB);
        ctx.fillRect(x, y, tile, tile);
      }
    }
    ctx.fillStyle = 'rgba(230,90,40,0.10)';
    ctx.fillRect(0, 40, 430, WORLD_H - 70);
    ctx.fillStyle = 'rgba(50,90,160,0.08)';
    ctx.fillRect(430, 40, WORLD_W - 430, WORLD_H - 70);

    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, WORLD_W, 44);
    ctx.fillRect(0, 0, 28, WORLD_H);
    ctx.fillRect(WORLD_W - 28, 0, 28, WORLD_H);
    ctx.fillRect(0, WORLD_H - 28, WORLD_W, 28);
    ctx.fillStyle = COLORS.wallTop;
    ctx.fillRect(0, 40, WORLD_W, 6);

    ctx.fillStyle = '#ffd36a';
    ctx.font = 'bold 22px Trebuchet MS, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(getLang() === 'en' ? '🍔 Burger Rush' : '🍔 Бургерная', WORLD_W / 2, 30);

    // divider
    ctx.fillStyle = 'rgba(255,210,120,0.28)';
    ctx.fillRect(426, 50, 6, WORLD_H - 84);
  }

  drawZonePads(ctx) {
    const g = this.layout.grill;
    const p = this.layout.prep;
    const c = this.layout.counter;
    this.roundRect(ctx, g.x - 14, g.y - 28, g.w + 28, g.h + 42, 16, 'rgba(230,70,30,0.30)');
    this.roundRect(ctx, p.x - 14, p.y - 28, p.w + 28, p.h + 40, 16, 'rgba(255,200,40,0.30)');
    this.roundRect(ctx, c.x - 16, c.y - 16, c.w + 32, c.h + 32, 16, 'rgba(40,180,80,0.26)');
    this.roundRect(ctx, 470, 120, 380, 460, 18, 'rgba(70,120,190,0.10)');

    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd0c0';
    ctx.fillText('🔥 ' + t('zoneGrill'), g.x + g.w / 2, g.y - 12);
    ctx.fillStyle = '#5a3d00';
    ctx.fillText('🍔 ' + t('zonePrep'), p.x + p.w / 2, p.y - 12);
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#e8ffe8';
    ctx.font = 'bold 14px Trebuchet MS, sans-serif';
    ctx.fillText('✅ ' + t('zoneCounter'), 0, 4);
    ctx.restore();
    ctx.fillStyle = 'rgba(200,220,255,0.7)';
    ctx.font = 'bold 12px Trebuchet MS, sans-serif';
    ctx.fillText('🪑 ' + t('zoneTables'), 660, 132);
  }

  drawDecor(ctx) {
    // menu board
    this.roundRect(ctx, 40, 58, 68, 86, 8, '#2b1d12', '#c9a227', 2);
    ctx.fillStyle = '#f5e6b8';
    ctx.font = 'bold 11px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MENU', 74, 76);
    ctx.font = '16px sans-serif';
    ctx.fillText('🍔', 74, 100);
    ctx.fillText('🥤', 74, 124);

    this.drawPlant(ctx, 900, 88);
    this.drawPlant(ctx, 442, 580);
    // exit door
    this.roundRect(ctx, 820, WORLD_H - 28, 70, 26, 6, '#3d2a18');
    ctx.fillStyle = '#c9a66b';
    ctx.font = 'bold 10px Trebuchet MS, sans-serif';
    ctx.fillText('EXIT', 855, WORLD_H - 10);
  }

  drawPlant(ctx, x, y) {
    ctx.fillStyle = '#5d3a1a';
    this.roundRect(ctx, x - 10, y + 10, 20, 16, 4, '#5d3a1a');
    ctx.fillStyle = '#27ae60';
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 8, 14, -0.4, 0, Math.PI * 2);
    ctx.ellipse(x + 6, y + 4, 7, 12, 0.5, 0, Math.PI * 2);
    ctx.ellipse(x - 6, y + 6, 7, 11, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  drawKitchen(ctx) {
    const g = this.layout.grill;
    this.roundRect(ctx, g.x, g.y, g.w, g.h, 10, COLORS.grillBody, '#e67e22', 3);
    // grate
    ctx.strokeStyle = 'rgba(255,120,40,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(g.x + 8, g.y + 14 + i * 12);
      ctx.lineTo(g.x + g.w - 8, g.y + 14 + i * 12);
      ctx.stroke();
    }
    const need = this.grillCookTime();
    g.slots.forEach((s, i) => {
      const sx = g.x + 22 + i * 34;
      const sy = g.y + 40;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 13, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (s.state === 'cooking' || s.state === 'ready') {
        ctx.fillStyle = s.state === 'ready' ? COLORS.pattyCooked : COLORS.pattyRaw;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s.state === 'cooking') {
        const pr = s.progress / need;
        ctx.strokeStyle = '#f39c12';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pr);
        ctx.stroke();
      }
      if (s.state === 'ready') {
        const pulse = 0.55 + Math.sin(this.time * 8) * 0.35;
        ctx.strokeStyle = `rgba(46,204,113,${pulse})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(sx, sy, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#2ecc71';
        ctx.font = 'bold 9px Trebuchet MS, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t('readyLabel'), sx, sy - 20);
      }
    });

    const prep = this.layout.prep;
    this.roundRect(ctx, prep.x, prep.y, prep.w, prep.h, 10, COLORS.prep, '#c9a227', 3);
    // cutting board
    this.roundRect(ctx, prep.x + 10, prep.y + 16, prep.w - 20, prep.h - 28, 6, '#e8c27a');
    ctx.fillStyle = '#4a3208';
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🍖${prep.patties}   🍔${prep.burgers}`, prep.x + prep.w / 2, prep.y + prep.h / 2 + 6);
    if (prep.burgers > 0) {
      this.drawBurger(ctx, prep.x + prep.w - 18, prep.y + 18, 0.45);
    }

    const trash = this.layout.trash;
    this.roundRect(ctx, trash.x, trash.y, trash.w, trash.h, 8, COLORS.trash, '#f1c40f', 2);
    // hazard stripes
    ctx.save();
    ctx.beginPath();
    this._pathRound(ctx, trash.x, trash.y, trash.w, 10, 4);
    ctx.clip();
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(trash.x, trash.y, trash.w, 10);
    ctx.fillStyle = '#222';
    for (let i = -10; i < trash.w; i += 10) {
      ctx.fillRect(trash.x + i, trash.y, 5, 10);
    }
    ctx.restore();
    ctx.fillStyle = '#eee';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🗑️', trash.x + trash.w / 2, trash.y + trash.h / 2 + 12);
    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 10px Trebuchet MS, sans-serif';
    ctx.fillText(t('zoneTrash'), trash.x + trash.w / 2, trash.y - 6);
  }

  drawTables(ctx) {
    for (const tb of this.layout.tables) {
      if (!tb.unlocked) {
        ctx.globalAlpha = 0.38;
        this.roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 10, '#555');
        ctx.fillStyle = '#fff';
        ctx.font = '22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔒', tb.x + tb.w / 2, tb.y + tb.h / 2 + 8);
        ctx.globalAlpha = 1;
        continue;
      }
      // floor pad
      ctx.fillStyle = tb.dirty ? 'rgba(180,60,20,0.22)' : 'rgba(80,130,190,0.16)';
      ctx.beginPath();
      ctx.ellipse(tb.x + tb.w / 2, tb.y + tb.h / 2 + 6, 46, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      this.roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 10, tb.dirty ? COLORS.dirty : COLORS.table, tb.dirty ? '#e74c3c' : COLORS.cloth, 3);
      // cloth
      if (!tb.dirty) {
        this.roundRect(ctx, tb.x + 8, tb.y + 8, tb.w - 16, tb.h - 16, 6, 'rgba(93,138,168,0.35)');
      }
      ctx.fillStyle = tb.dirty ? '#8e5a3a' : '#f3f3f3';
      ctx.beginPath();
      ctx.ellipse(tb.x + tb.w / 2, tb.y + tb.h / 2 - 2, 16, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      if (tb.dirty) {
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(tb.x + tb.w / 2 - 4, tb.y + tb.h / 2 - 2, 3, 0, Math.PI * 2);
        ctx.arc(tb.x + tb.w / 2 + 5, tb.y + tb.h / 2 + 2, 2.2, 0, Math.PI * 2);
        ctx.fill();
        const pulse = 0.7 + Math.sin(this.time * 5) * 0.3;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#ff6b35';
        ctx.font = 'bold 12px Trebuchet MS, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🧼 ' + t('dirtyLabel'), tb.x + tb.w / 2, tb.y - 8);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawCounterQueue(ctx) {
    const c = this.layout.counter;
    this.roundRect(ctx, c.x, c.y, c.w, c.h, 8, COLORS.counter, '#145a32', 3);
    this.roundRect(ctx, c.x + 6, c.y + 10, c.w - 12, 18, 4, '#1e8449');
    for (let i = 0; i < Math.min(c.burgers, 8); i++) {
      this.drawBurger(ctx, c.x + c.w / 2, c.y + c.h - 22 - i * 14, 0.7);
    }
    if (c.burgers > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(c.burgers), c.x + c.w / 2, c.y + 24);
    }
  }

  drawFocusGlow(ctx) {
    const focus = this.getFocusStation();
    if (!focus) return;
    const o = focus.obj;
    const pulse = 0.35 + Math.sin(this.time * 6) * 0.15;
    ctx.save();
    ctx.shadowColor = focus.color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = focus.color;
    ctx.globalAlpha = pulse + 0.4;
    ctx.lineWidth = 4;
    this._pathRound(ctx, o.x - 6, o.y - 6, o.w + 12, o.h + 12, 12);
    ctx.stroke();
    ctx.restore();
  }

  drawTutorialMark(ctx) {
    const tgt = this.tutorialTarget();
    if (!tgt) return;
    const cx = tgt.x + (tgt.w || 0) / 2;
    const cy = tgt.y + (tgt.h || 0) / 2;
    const pulse = 1 + Math.sin(this.time * 4.5) * 0.12;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,229,102,0.85)';
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 54 * pulse, 38 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const bob = Math.sin(this.time * 5.2) * 7;
    const ay = cy - 56 + bob;
    ctx.fillStyle = '#ffe566';
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, ay + 22);
    ctx.lineTo(cx - 16, ay);
    ctx.lineTo(cx + 16, ay);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawInteractPrompt(ctx) {
    const focus = this.getFocusStation();
    if (!focus) return;
    const o = focus.obj;
    const x = o.x + o.w / 2;
    const y = o.y + o.h + 18;
    const label = t('promptInteract');
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    const w = Math.max(72, ctx.measureText(label).width + 22);
    const pulse = 1 + Math.sin(this.time * 7) * 0.04;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    this.roundRect(ctx, -w / 2, -12, w, 24, 12, 'rgba(10,6,4,0.82)', '#ffe566', 2);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 5);
    ctx.restore();
  }

  drawCustomers(ctx) {
    for (const c of this.customers) {
      const sitting = c.state === 'eating';
      const leaving = c.state === 'leave';
      ctx.globalAlpha = leaving ? 0.7 : 1;
      this.drawCharacter(ctx, {
        x: c.x, y: c.y,
        shirt: c.shirt,
        skin: c.skin,
        hair: c.hair,
        r: c.shape === 3 ? 13 : 16,
        facing: c.facing || 1,
        hat: 'none',
        shape: c.shape,
        bob: (c.state === 'toTable' || c.state === 'leave') ? Math.sin(this.time * 10 + c.x) * 1.4 : 0,
        sitting,
      });
      ctx.globalAlpha = 1;
    }
    for (const c of this.customers) {
      if (c.state === 'queue') {
        this.drawOrderBubble(ctx, c.x, c.y - 28, c.patience / 28);
      } else if (c.state === 'toTable') {
        this.drawOrderBubble(ctx, c.x, c.y - 28, 1, true);
      }
    }
  }

  drawOrderBubble(ctx, x, y, patience, served = false) {
    const w = 36;
    const h = 28;
    this.roundRect(ctx, x - w / 2, y - h, w, h, 8, '#fff', '#d0d0d0', 1);
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + 6);
    ctx.fill();
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(served ? '😋' : '🍔', x, y - 8);
    if (!served) {
      const pw = 28;
      ctx.fillStyle = '#333';
      this.roundRect(ctx, x - pw / 2, y - h - 7, pw, 5, 2, '#333');
      ctx.fillStyle = patienceColor(patience);
      this.roundRect(ctx, x - pw / 2, y - h - 7, pw * clamp(patience, 0, 1), 5, 2, patienceColor(patience));
    }
  }

  drawWorkers(ctx) {
    for (const w of this.workers) {
      this.drawCharacter(ctx, {
        x: w.x, y: w.y,
        shirt: w.color,
        skin: '#f1c27d',
        hair: '#3a2a1a',
        r: 15,
        facing: w.facing || 1,
        hat: w.type === 'cleaner' ? 'cap' : 'bow',
        shape: 0,
        bob: Math.sin((w.walk || 0)) * 1.2,
      });
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.type === 'waiter' ? '👔' : '🧹', w.x, w.y - 30);
      if (w.carrying > 0) {
        for (let i = 0; i < w.carrying; i++) {
          this.drawBurger(ctx, w.x, w.y - 36 - i * 10, 0.5);
        }
      }
    }
  }

  drawPlayer(ctx) {
    const p = this.player;
    this.drawCharacter(ctx, {
      x: p.x, y: p.y,
      shirt: COLORS.coat,
      skin: '#f1c27d',
      hair: '#3a2a1a',
      r: 18,
      facing: p.facing,
      hat: 'chef',
      shape: 0,
      bob: Math.sin(p.walk) * 1.5,
      scarf: true,
    });
    let stack = 0;
    for (let i = 0; i < p.patties; i++) {
      ctx.fillStyle = COLORS.pattyCooked;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 38 - stack * 8, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a2508';
      ctx.lineWidth = 1;
      ctx.stroke();
      stack++;
    }
    for (let i = 0; i < p.burgers; i++) {
      this.drawBurger(ctx, p.x, p.y - 38 - stack * 10, 0.55);
      stack++;
    }
  }

  drawCharacter(ctx, opt) {
    const {
      x, y, shirt, skin, hair = '#3a2a1a', r = 16,
      facing = 1, hat = 'none', shape = 0, bob = 0, sitting = false, scarf = false,
    } = opt;
    ctx.save();
    ctx.translate(x, y + (sitting ? 7 : 0));
    ctx.scale(facing, 1);

    let bodyW = r * 0.95;
    let bodyH = r * 1.2;
    let headR = r * 0.52;
    if (shape === 1) { bodyW = r * 0.7; bodyH = r * 1.5; }
    if (shape === 2) { bodyW = r * 1.28; bodyH = r * 1.02; }
    if (shape === 3) { bodyW = r * 0.72; bodyH = r * 0.88; headR = r * 0.48; }
    if (sitting) bodyH *= 0.62;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.82, bodyW * 0.8, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!sitting) {
      ctx.fillStyle = '#2c3e50';
      this.roundRect(ctx, -bodyW * 0.42, r * 0.22 + bob * 0.3, bodyW * 0.3, r * 0.5, 4, '#2c3e50');
      this.roundRect(ctx, bodyW * 0.1, r * 0.22 - bob * 0.3, bodyW * 0.3, r * 0.5, 4, '#2c3e50');
    }

    this.roundRect(ctx, -bodyW / 2, -bodyH * 0.32 + bob, bodyW, bodyH * 0.72, 7, shirt);
    if (scarf) {
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(-bodyW * 0.22, -bodyH * 0.32 + bob, bodyW * 0.44, 5);
    }

    // arms
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(-bodyW * 0.55, -bodyH * 0.02 + bob, 4, 7, 0.2, 0, Math.PI * 2);
    ctx.ellipse(bodyW * 0.55, -bodyH * 0.02 + bob, 4, 7, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.48 + bob, headR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.54 + bob, headR * 0.95, Math.PI * 1.05, -0.05);
    ctx.fill();

    ctx.fillStyle = '#2c1810';
    ctx.beginPath();
    ctx.arc(-headR * 0.32, -bodyH * 0.5 + bob, 1.7, 0, Math.PI * 2);
    ctx.arc(headR * 0.32, -bodyH * 0.5 + bob, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,130,130,0.35)';
    ctx.beginPath();
    ctx.ellipse(-headR * 0.5, -bodyH * 0.4 + bob, 2.3, 1.2, 0, 0, Math.PI * 2);
    ctx.ellipse(headR * 0.5, -bodyH * 0.4 + bob, 2.3, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -bodyH * 0.38 + bob, 3.1, 0.2, Math.PI - 0.2);
    ctx.stroke();

    if (hat === 'chef') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-headR * 0.9, -bodyH * 0.48 - headR + bob, headR * 1.8, 6);
      ctx.beginPath();
      ctx.ellipse(0, -bodyH * 0.48 - headR - 7 + bob, headR * 0.88, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(-headR * 0.9, -bodyH * 0.48 - headR + 4 + bob, headR * 1.8, 3);
    } else if (hat === 'cap') {
      ctx.fillStyle = '#8e44ad';
      ctx.beginPath();
      ctx.ellipse(0, -bodyH * 0.55 - headR * 0.25 + bob, headR * 0.95, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(0, -bodyH * 0.58 - headR * 0.15 + bob, headR * 1.1, 4);
    } else if (hat === 'bow') {
      ctx.fillStyle = '#145a32';
      ctx.beginPath();
      ctx.moveTo(-5, -bodyH * 0.3 + bob);
      ctx.lineTo(0, -bodyH * 0.26 + bob);
      ctx.lineTo(-5, -bodyH * 0.22 + bob);
      ctx.moveTo(5, -bodyH * 0.3 + bob);
      ctx.lineTo(0, -bodyH * 0.26 + bob);
      ctx.lineTo(5, -bodyH * 0.22 + bob);
      ctx.fill();
    }
    ctx.restore();
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
      ctx.save();
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.font = 'bold 18px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  _pathRound(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  roundRect(ctx, x, y, w, h, r, fill, stroke, lw) {
    this._pathRound(ctx, x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  }
}
