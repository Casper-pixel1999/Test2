import { t } from '../i18n';
import { gameplayStart, gameplayStop, cloudSave, showRewarded, showFullscreen } from '../yandex';
import { World3D } from './World3D';

const SAVE_KEY = 'burger_rush_save_v1';
const SKINS = ['#f1c27d', '#ffdeb4', '#e0ac69', '#c68642', '#8d5524'];

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function dist(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function patienceColor(p: number) {
  const t = clamp(p, 0, 1);
  if (t > 0.5) {
    const k = (t - 0.5) * 2;
    return `rgb(${Math.round(241 - 80 * k)},${Math.round(196 + 20 * k)},${Math.round(15 + 20 * k)})`;
  }
  const k = t * 2;
  return `rgb(231,${Math.round(76 + 120 * k)},60)`;
}

interface GrillSlot { progress: number; state: 'empty' | 'cooking' | 'ready' }
interface Prep { patties: number; burgers: number }
interface Counter { burgers: number }
interface Player {
  x: number; z: number;
  vx: number; vz: number;
  patties: number; burgers: number; dirty: number;
  facing: number; walk: number;
}
interface StationSolid { x: number; z: number; hw: number; hd: number }
interface InteractPad { x: number; z: number; r: number }
interface Worker {
  type: 'waiter' | 'cleaner';
  x: number; z: number;
  carrying: number; task: any;
  facing: number; walk: number;
}
interface Customer {
  x: number; z: number;
  state: 'queue' | 'toTable' | 'eating' | 'leave';
  patience: number; order: number;
  shirt: string; skin: string; hair: string; shape: number;
  table: any; eatTime: number; facing: number;
}
interface FloatText {
  text: string; x: number; z: number; y: number;
  life: number; color: string; el: HTMLDivElement;
}

export class Game {
  world: World3D;
  paused = false;
  running = false;
  time = 0;
  dt = 0;
  lastTs = 0;
  doubleProfitUntil = 0;
  tutorialStep = 0;
  floatTexts: FloatText[] = [];
  keys: Record<string, boolean> = Object.create(null);
  joy = { x: 0, y: 0, active: false };
  shopOpen = false;

  state = this.defaultState();
  layout!: {
    grill: { x: number; z: number; r: number; slots: GrillSlot[]; interact: InteractPad; solid: StationSolid };
    prep: Prep & { x: number; z: number; r: number; interact: InteractPad; solid: StationSolid };
    counter: Counter & { x: number; z: number; r: number; interact: InteractPad; solid: StationSolid };
    trash: { x: number; z: number; r: number; interact: InteractPad; solid: StationSolid };
  };
  solids: StationSolid[] = [];
  customers: Customer[] = [];
  workers: Worker[] = [];
  spawnTimer = 0;
  hintKey = 'hintCook';
  player!: Player;
  _saveTimer = 0;
  _lastFsAt = -999;
  _cloudTimer = 0;
  bubbleEls = new Map<Customer, HTMLDivElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World3D(canvas);
    this.buildLayout();
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
    // Furniture center vs interact pad in front (player stands at pad, not inside mesh)
    this.layout = {
      grill: {
        x: -6, z: -2.5, r: 1.6,
        slots: [
          { progress: 0, state: 'empty' },
          { progress: 0, state: 'empty' },
          { progress: 0, state: 'empty' },
        ],
        interact: { x: -6, z: -0.85, r: 1.35 },
        solid: { x: -6, z: -2.5, hw: 1.35, hd: 0.95 },
      },
      prep: {
        x: -6, z: 0.9, r: 1.5, patties: 0, burgers: 0,
        interact: { x: -6, z: 2.35, r: 1.25 },
        solid: { x: -6, z: 0.9, hw: 1.2, hd: 0.85 },
      },
      counter: {
        x: -2.2, z: 0.2, r: 1.8, burgers: 0,
        interact: { x: -2.2, z: 1.85, r: 1.35 },
        solid: { x: -2.2, z: 0.2, hw: 1.5, hd: 0.7 },
      },
      trash: {
        x: -7.2, z: 4.2, r: 1.2,
        interact: { x: -7.2, z: 3.2, r: 1.1 },
        solid: { x: -7.2, z: 4.2, hw: 0.7, hd: 0.7 },
      },
    };
    this.solids = [
      this.layout.grill.solid,
      this.layout.prep.solid,
      this.layout.counter.solid,
      this.layout.trash.solid,
      // tables as mild solids so you walk around them
      { x: 1.2, z: 2.6, hw: 0.85, hd: 0.85 },
      { x: 3.6, z: 2.6, hw: 0.85, hd: 0.85 },
      { x: 6.0, z: 2.6, hw: 0.85, hd: 0.85 },
      { x: 1.2, z: 4.6, hw: 0.85, hd: 0.85 },
      { x: 3.6, z: 4.6, hw: 0.85, hd: 0.85 },
    ];
  }

  playerSpeed() { return 4.2 + this.state.speedLv * 0.55; }
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
    this.world.tables.forEach((tb, i) => {
      tb.unlocked = i < this.state.tablesUnlocked;
    });
    this.workers = [];
    if (this.state.hasWaiter) {
      this.workers.push({
        type: 'waiter', x: -4, z: 0, carrying: 0, task: null, facing: 1, walk: 0,
      });
    }
    if (this.state.hasCleaner) {
      this.workers.push({
        type: 'cleaner', x: 1, z: 3.5, carrying: 0, task: null, facing: 1, walk: 0,
      });
    }
    this.world.syncTables();
    this.world.syncWorkers(this.workers);
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
      x: -4.5, z: 0, vx: 0, vz: 0, patties: 0, burgers: 0, dirty: 0, facing: 1, walk: 0,
    };
    this.world.createPlayer();
    this.world.setPlayerPose(this.player.x, this.player.z, this.player.facing, 0, false);
    this.running = true;
    this.paused = false;
    this.lastTs = performance.now();
    gameplayStart();
    requestAnimationFrame((ts) => this.loop(ts));
    this.updateHUD();
    this.refreshShop();
  }

  setPaused(p: boolean) {
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
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        this.tryInteract();
      }
      if (e.code === 'Escape' && this.shopOpen) this.closeShop();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const canvas = this.world.renderer.domElement;
    canvas.addEventListener('pointerdown', () => {
      if (this.shopOpen) return;
      this.tryInteract();
    });

    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    if (!base || !knob) return;
    const maxR = 36;
    let pid: number | null = null;
    const setKnob = (dx: number, dy: number) => {
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

  loop(ts: number) {
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

  update(dt: number) {
    this.updatePlayer(dt);
    this.updateGrill(dt);
    this.updateCustomers(dt);
    this.updateWorkers(dt);
    this.updateTutorial();
    this.world.updateSmoke(dt);
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
      f.y += 1.2 * dt;
      f.life -= dt;
      if (f.life <= 0) {
        f.el.remove();
        this.floatTexts.splice(i, 1);
      }
    }
    this.updateHUD();
    this.syncWorld();
  }

  updatePlayer(dt: number) {
    let mx = this.joy.x;
    let mz = this.joy.y;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
    const len = Math.hypot(mx, mz);
    const sp = this.playerSpeed();
    let tx = 0;
    let tz = 0;
    if (len > 0.05) {
      tx = (mx / len) * sp;
      tz = (mz / len) * sp;
      if (Math.abs(mx) > 0.05) this.player.facing = mx >= 0 ? 1 : -1;
    }
    // Smooth accel / friction (arcade-idle feel)
    const accel = len > 0.05 ? 18 : 22;
    this.player.vx = lerp(this.player.vx, tx, clamp(accel * dt, 0, 1));
    this.player.vz = lerp(this.player.vz, tz, clamp(accel * dt, 0, 1));
    if (Math.hypot(this.player.vx, this.player.vz) < 0.05) {
      this.player.vx = 0;
      this.player.vz = 0;
    }
    const moving = Math.hypot(this.player.vx, this.player.vz) > 0.08;
    if (moving) this.player.walk += dt * (10 + Math.hypot(this.player.vx, this.player.vz));
    else this.player.walk *= 0.88;

    // Separate axis collision so you slide along counters instead of entering them
    this.player.x = clamp(this.player.x + this.player.vx * dt, -8.8, 8.8);
    this.resolveSolids('x');
    this.player.z = clamp(this.player.z + this.player.vz * dt, -5.2, 5.2);
    this.resolveSolids('z');

    this.world.setPlayerPose(this.player.x, this.player.z, this.player.facing, this.player.walk, moving);
    this.world.followCamera(this.player.x, this.player.z, dt);
    this.autoInteract(dt);
  }

  resolveSolids(axis: 'x' | 'z') {
    const pr = 0.38;
    for (const s of this.solids) {
      const dx = this.player.x - s.x;
      const dz = this.player.z - s.z;
      const ox = s.hw + pr - Math.abs(dx);
      const oz = s.hd + pr - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (axis === 'x' && ox < oz) {
          this.player.x += dx > 0 ? ox : -ox;
          this.player.vx = 0;
        } else if (axis === 'z' && oz <= ox) {
          this.player.z += dz > 0 ? oz : -oz;
          this.player.vz = 0;
        }
      }
    }
  }

  nearPad(pad: InteractPad, padExtra = 0) {
    return dist(this.player, pad) < pad.r + padExtra;
  }

  near(obj: { x: number; z: number; r?: number }, pad = 0) {
    return dist(this.player, obj) < (obj.r ?? 1.4) + pad;
  }

  getFocusStation(): { x: number; z: number; kind: string; color: number } | null {
    const list: { x: number; z: number; r: number; kind: string; color: number }[] = [
      { ...this.layout.grill.interact, kind: 'grill', color: 0xff6b35 },
      { ...this.layout.prep.interact, kind: 'prep', color: 0xf1c40f },
      { ...this.layout.counter.interact, kind: 'counter', color: 0x2ecc71 },
    ];
    for (const tb of this.world.tables) {
      if (tb.unlocked && tb.dirty) {
        // stand in front of table (slightly toward kitchen / -z)
        list.push({ x: tb.x, z: tb.z - 0.95, r: 1.15, kind: 'table', color: 0xe67e22 });
      }
    }
    let best: typeof list[0] | null = null;
    let bestD = 1e9;
    for (const s of list) {
      if (dist(this.player, s) > s.r) continue;
      const d = dist(this.player, s);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (!best) return null;
    if (best.kind === 'prep' && this.player.patties <= 0 && this.layout.prep.burgers <= 0) return null;
    if (best.kind === 'counter' && this.player.burgers <= 0) return null;
    return best;
  }

  autoInteract(_dt: number) {
    const g = this.layout.grill;
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    if (this.nearPad(g.interact)) {
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
          this.float('+🍖', this.player.x, this.player.z);
          if (this.tutorialStep <= 1) this.tutorialStep = 2;
        }
      }
    }
    if (this.nearPad(prep.interact)) {
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
        this.float('+🍔', this.player.x, this.player.z);
        if (this.tutorialStep <= 2) this.tutorialStep = 3;
      }
    }
    if (this.nearPad(counter.interact) && this.player.burgers > 0) {
      counter.burgers += this.player.burgers;
      this.player.burgers = 0;
      this.float('→ 🍽️', this.player.x, this.player.z);
      if (this.tutorialStep <= 3) this.tutorialStep = 4;
    }
    for (const tb of this.world.tables) {
      if (!tb.unlocked || !tb.dirty) continue;
      if (dist(this.player, { x: tb.x, z: tb.z - 0.95 }) < 1.15) {
        tb.dirty = false;
        this.state.cash += 3;
        this.float('+$3', tb.x, tb.z, '#2ecc71');
        if (this.tutorialStep <= 4) {
          this.tutorialStep = 5;
          this.state.tutorialDone = true;
        }
      }
    }
  }

  tryInteract() { this.autoInteract(0); }

  updateGrill(dt: number) {
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

  updateCustomers(dt: number) {
    this.spawnTimer -= dt;
    const unlocked = this.world.tables.filter((tb) => tb.unlocked);
    const waiting = this.customers.filter((c) => c.state === 'queue').length;
    const maxQueue = Math.min(4, 1 + Math.floor(this.state.tablesUnlocked / 2));
    if (this.spawnTimer <= 0 && waiting < maxQueue) {
      this.spawnTimer = Math.max(1.5, 4.5 - this.state.tablesUnlocked * 0.25);
      this.customers.push({
        x: -0.6, z: 5.5, state: 'queue',
        patience: 28, order: 1,
        shirt: `hsl(${(Math.random() * 360) | 0},62%,56%)`,
        skin: SKINS[(Math.random() * SKINS.length) | 0],
        hair: `hsl(${(Math.random() * 40 + 8) | 0},38%,${(18 + Math.random() * 22) | 0}%)`,
        shape: (Math.random() * 4) | 0,
        table: null, eatTime: 0, facing: -1,
      });
    }
    const queued = this.customers.filter((c) => c.state === 'queue');
    queued.forEach((c, i) => {
      const spot = this.world.queueSpots[Math.min(i, this.world.queueSpots.length - 1)];
      c.x = lerp(c.x, spot.x, 1 - Math.pow(0.001, dt));
      c.z = lerp(c.z, spot.z, 1 - Math.pow(0.001, dt));
      c.patience -= dt * 0.15;
    });
    const counter = this.layout.counter;
    if (counter.burgers > 0 && queued.length) {
      const c = queued[0];
      const spot0 = this.world.queueSpots[0];
      if (dist(c, spot0) < 0.6) {
        counter.burgers--;
        const free = unlocked.find((tb) => !tb.customer && !tb.dirty);
        if (free) {
          c.state = 'toTable';
          c.table = free;
          free.customer = c;
          const pay = this.orderPay();
          this.state.cash += pay;
          this.state.totalServed++;
          this.float(`+$${pay}`, free.x, free.z, '#f1c40f');
        } else {
          counter.burgers++;
        }
      }
    }
    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i];
      if (c.state === 'toTable' && c.table) {
        const tx = c.table.x;
        const tz = c.table.z + 0.35;
        const d = Math.hypot(tx - c.x, tz - c.z);
        if (d < 0.15) {
          c.x = tx; c.z = tz;
          c.state = 'eating';
          c.eatTime = 4 + Math.random() * 2;
        } else {
          c.facing = tx >= c.x ? 1 : -1;
          c.x += ((tx - c.x) / d) * 3.2 * dt;
          c.z += ((tz - c.z) / d) * 3.2 * dt;
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
        c.z += 4.0 * dt;
        c.x += 1.2 * dt;
        c.facing = 1;
        if (c.z > 7) {
          this.removeBubble(c);
          this.customers.splice(i, 1);
        }
      } else if (c.state === 'queue' && c.patience <= 0) {
        c.state = 'leave';
      }
    }
  }

  updateWorkers(dt: number) {
    for (const w of this.workers) {
      if (w.type === 'waiter') this.updateWaiter(w, dt);
      if (w.type === 'cleaner') this.updateCleaner(w, dt);
    }
  }

  updateWaiter(w: Worker, dt: number) {
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    const cap = 2 + Math.floor(this.state.capLv / 2);
    if (w.carrying <= 0) {
      this.moveEntity(w, prep.x, prep.z, 3.0, dt);
      if (dist(w, prep) < 0.7) {
        while (prep.patties > 0 && prep.burgers < 20) {
          prep.patties--;
          prep.burgers++;
        }
        const take = Math.min(cap, prep.burgers);
        prep.burgers -= take;
        w.carrying = take;
      }
    } else {
      this.moveEntity(w, counter.x, counter.z, 3.0, dt);
      if (dist(w, counter) < 0.7) {
        counter.burgers += w.carrying;
        w.carrying = 0;
      }
    }
  }

  updateCleaner(w: Worker, dt: number) {
    const dirty = this.world.tables.find((tb) => tb.unlocked && tb.dirty);
    if (!dirty) {
      this.moveEntity(w, 1, 3.5, 2.5, dt);
      return;
    }
    this.moveEntity(w, dirty.x, dirty.z, 2.8, dt);
    if (dist(w, dirty) < 0.7) {
      dirty.dirty = false;
      this.state.cash += 2;
    }
  }

  moveEntity(e: { x: number; z: number; facing: number; walk: number }, tx: number, tz: number, speed: number, dt: number) {
    const d = Math.hypot(tx - e.x, tz - e.z) || 1;
    if (d < 0.1) { e.walk = 0; return; }
    e.facing = tx >= e.x ? 1 : -1;
    e.walk = (e.walk || 0) + dt * 10;
    e.x += ((tx - e.x) / d) * speed * dt;
    e.z += ((tz - e.z) / d) * speed * dt;
  }

  tutorialTarget(): { x: number; z: number } | null {
    if (this.state.tutorialDone || this.tutorialStep >= 5) return null;
    if (this.tutorialStep <= 1) return this.layout.grill.interact;
    if (this.tutorialStep === 2) return this.layout.prep.interact;
    if (this.tutorialStep === 3) return this.layout.counter.interact;
    if (this.tutorialStep === 4) {
      const tb = this.world.tables.find((t) => t.dirty);
      return tb ? { x: tb.x, z: tb.z - 0.95 } : null;
    }
    return null;
  }

  updateTutorial() {
    const arrow = document.getElementById('tutorialArrow');
    if (this.state.tutorialDone || this.tutorialStep >= 5) {
      this.hintKey = this.world.tables.some((tb) => tb.dirty) ? 'hintClean' : 'hintIdle';
      arrow?.classList.add('hidden');
      return;
    }
    const keys = ['hintCook', 'hintPick', 'hintStack', 'hintServe', 'hintClean'];
    this.hintKey = keys[Math.min(this.tutorialStep, keys.length - 1)];
    if (this.tutorialStep === 4 && !this.world.tables.some((tb) => tb.dirty)) {
      this.hintKey = 'hintWait';
    }
    // 3D arrow used instead of DOM
    arrow?.classList.add('hidden');
  }

  float(text: string, x: number, z: number, color = '#fff') {
    const layer = document.getElementById('floatLayer');
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    layer.appendChild(el);
    this.floatTexts.push({ text, x, z, y: 1.6, life: 1.15, color, el });
  }

  removeBubble(c: Customer) {
    const el = this.bubbleEls.get(c);
    if (el) { el.remove(); this.bubbleEls.delete(c); }
  }

  syncBubbles() {
    const host = document.getElementById('bubbles');
    if (!host) return;
    const alive = new Set(this.customers.filter((c) => c.state === 'queue' || c.state === 'toTable'));
    for (const [c, el] of this.bubbleEls) {
      if (!alive.has(c)) { el.remove(); this.bubbleEls.delete(c); }
    }
    for (const c of alive) {
      let el = this.bubbleEls.get(c);
      if (!el) {
        el = document.createElement('div');
        el.className = 'order-bubble';
        el.innerHTML = `<span class="ico">🍔</span><div class="patience"><i></i></div>`;
        host.appendChild(el);
        this.bubbleEls.set(c, el);
      }
      const ico = el.querySelector('.ico');
      if (ico) ico.textContent = c.state === 'toTable' ? '😋' : '🍔';
      const bar = el.querySelector('.patience > i') as HTMLElement | null;
      if (bar) {
        const p = clamp(c.patience / 28, 0, 1);
        bar.style.width = `${p * 100}%`;
        bar.style.background = patienceColor(p);
        (el.querySelector('.patience') as HTMLElement).style.display =
          c.state === 'queue' ? 'block' : 'none';
      }
      const scr = this.world.worldToScreen(c.x, 1.9, c.z);
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y}px`;
      el.style.display = scr.visible ? 'block' : 'none';
    }
  }

  syncWorld() {
    this.world.syncGrill(this.layout.grill.slots, this.grillCookTime(), this.time);
    this.world.syncPrep(this.layout.prep.patties, this.layout.prep.burgers);
    this.world.syncCounter(this.layout.counter.burgers);
    this.world.syncTables();
    this.world.syncCustomers(this.customers, this.time);
    this.world.syncWorkers(this.workers);
    this.world.updatePlayerStack(this.player.patties, this.player.burgers);

    const focus = this.getFocusStation();
    if (focus) this.world.setFocus(focus.x, focus.z, focus.color);
    else this.world.setFocus(0, 0, null);

    const tgt = this.tutorialTarget();
    if (tgt) this.world.setTutorialTarget(tgt.x, tgt.z, this.time);
    else this.world.setTutorialTarget(null, null, this.time);

    this.syncBubbles();

    // float texts
    for (const f of this.floatTexts) {
      const scr = this.world.worldToScreen(f.x, f.y, f.z);
      f.el.style.left = `${scr.x}px`;
      f.el.style.top = `${scr.y}px`;
      f.el.style.opacity = String(clamp(f.life, 0, 1));
    }
  }

  draw() {
    this.world.render(this.time);
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
      { id: 'table', icon: '🪑', name: t('table'), desc: t('tableDesc'), level: s.tablesUnlocked, max: this.world.tables.length, cost: Math.floor(80 * Math.pow(1.45, s.tablesUnlocked - 1)), buy: () => { s.tablesUnlocked++; this.applyUnlocks(); } },
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
      row.querySelector('button')!.addEventListener('click', () => {
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
      this.float(t('rewardOk'), this.player.x, this.player.z, '#f1c40f');
    } else {
      this.float(t('rewardFail'), this.player.x, this.player.z, '#e74c3c');
    }
  }
}
