import { t, tf } from '../i18n';
import { gameplayStart, gameplayStop, cloudSave, cloudLoad, showRewarded, showFullscreen } from '../yandex';
import { World3D } from './World3D';
import { sfx } from './audio';
import {
  BurgerKind, BurgerCounts, MENU, MENU_ORDER, menuItem,
  emptyBurgers, burgerSum, migrateBurgers, pickOrderKind,
  cheeseUnlocked, doubleUnlocked, burgersToStack,
  takeBurger, takeAnyBurgerFifo, addBurger,
} from './menu';
import {
  BUILD_PADS, MISSIONS, START_CASH, HR_HIRE, MAP,
  levelFromXp, xpProgress, unlocksForLevel,
  playerUpCost, playerUpXp, PAY,
} from './progress';
import { MetaSave, loadLocal, saveLocal as persistSave, migrateSave } from './save';

const SKINS = ['#f1c27d', '#ffdeb4', '#e0ac69', '#c68642', '#8d5524'];
/** Fixed muted cloth palette (no rainbow HSL) */
const CLOTH = ['#6b7c6e', '#7a6b5d', '#5c6b7a', '#8b6b5c', '#6e5a6e', '#5a7068', '#7a5c4e', '#4a5c6a'];
const HAIR = ['#2a2218', '#3d2e22', '#4a3a28', '#1a1510', '#5c4030', '#2c2418'];

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function dist(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function patienceColor(p: number) {
  const t = clamp(p, 0, 1);
  // muted sage → amber → brick
  if (t > 0.5) {
    const k = (t - 0.5) * 2;
    return `rgb(${Math.round(90 + 110 * (1 - k))},${Math.round(143 - 20 * (1 - k))},${Math.round(107 - 40 * (1 - k))})`;
  }
  const k = t * 2;
  return `rgb(${Math.round(181 - 20 * k)},${Math.round(74 + 70 * k)},${Math.round(58 + 20 * k)})`;
}

interface GrillSlot { progress: number; state: 'empty' | 'cooking' | 'ready' }
interface Prep { patties: number; burgers: BurgerCounts; craft: null | { kind: BurgerKind; t: number; need: number } }
interface Counter { burgers: BurgerCounts }
interface Player {
  x: number; z: number;
  vx: number; vz: number;
  patties: number; burgers: BurgerCounts; dirty: number;
  facing: number; walk: number;
}
interface StationSolid { x: number; z: number; hw: number; hd: number }
interface InteractPad { x: number; z: number; r: number }
interface Worker {
  type: 'waiter' | 'cleaner';
  x: number; z: number;
  carrying: BurgerCounts; task: any;
  facing: number; walk: number;
}
type CustTrait = 'regular' | 'hurried' | 'vip';
interface Customer {
  x: number; z: number;
  state: 'queue' | 'toTable' | 'eating' | 'leave';
  patience: number; patienceMax: number;
  order: BurgerKind;
  trait: CustTrait;
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
  _padNeedToastAt = -999;

  // state set in constructor (MetaSave)
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
  _tutorialStepAt = 0;
  _stuckHintShown = false;
  _shopPointOnce = false;
  _pattiesAwayT = 0;
  _burgersAwayT = 0;
  _wrongTypeAwayT = 0;
  _lastSoftHintAt = -999;
  _softHintTarget: { x: number; z: number } | null = null;
  _softHintLife = 0;
  _approachFade = 0;
  _prevReady: boolean[] = [false, false, false];
  _activePadKind: string | null = null;
  _toastCheese = false;
  _toastDouble = false;
  _mismatchHint = false;
  _hrNear = 0;
  _pupNear = 0;
  _hrOpen = false;
  _pupOpen = false;
  _offlineCash = 0;
  state!: MetaSave;

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World3D(canvas);
    this.state = this.defaultState();
    this.buildLayout();
    this.bindInput();
  }

  defaultState(): MetaSave {
    return {
      version: 3,
      cash: START_CASH,
      restaurantXP: 0,
      builtPads: [],
      padPaid: {},
      openZones: ['kitchen', 'dining'],
      speedLv: 0, capLv: 0, profitLv: 0, grillLv: 0,
      tablesUnlocked: 0,
      hasWaiter: false, hasCleaner: false, hasCook: false, hasCashier: false,
      hasCheese: false, hasDoubleMenu: false,
      tutorialDone: false,
      totalServed: 0, totalCleaned: 0, sessionEarned: 0,
      buildsBought: 0, hiresBought: 0,
      missionIndex: 0, missionProgress: 0,
      seenCheeseToast: false, seenDoubleToast: false,
      lastSeenAt: Date.now(),
    };
  }

  hasPad(id: string) { return this.state.builtPads.includes(id); }
  restLevel() { return levelFromXp(this.state.restaurantXP); }
  coreReady() { return this.hasPad('table_1') && this.hasPad('grill_1') && this.hasPad('counter_1'); }

  buildLayout() {
    this.layout = {
      grill: {
        x: -8.0, z: -2.8, r: 1.6,
        slots: [
          { progress: 0, state: 'empty' },
          { progress: 0, state: 'empty' },
          { progress: 0, state: 'empty' },
        ],
        interact: { x: -8.0, z: -1.5, r: 1.35 },
        solid: { x: -8.0, z: -2.8, hw: 1.35, hd: 0.95 },
      },
      prep: {
        x: -8.0, z: 2.0, r: 1.5, patties: 0, burgers: emptyBurgers(), craft: null,
        interact: { x: -8.0, z: 3.1, r: 1.25 },
        solid: { x: -8.0, z: 2.0, hw: 1.2, hd: 0.85 },
      },
      counter: {
        x: -2.2, z: 0.0, r: 1.8, burgers: emptyBurgers(),
        interact: { x: -0.5, z: 0.0, r: 1.35 },
        solid: { x: -2.2, z: 0.0, hw: 1.5, hd: 0.7 },
      },
      trash: {
        x: -11.0, z: 4.5, r: 1.2,
        interact: { x: -11.0, z: 3.5, r: 1.1 },
        solid: { x: -11.0, z: 4.5, hw: 0.7, hd: 0.7 },
      },
    };
    this.solids = [
      this.layout.grill.solid,
      this.layout.prep.solid,
      this.layout.counter.solid,
      this.layout.trash.solid,
    ];
  }

  playerSpeed() { return 4.2 + this.state.speedLv * 0.55; }
  carryCap() { return 3 + this.state.capLv; }
  grillSlotCount() { return clamp(2 + Math.floor(this.state.grillLv / 2), 2, 3); }
  isTraining() { return !this.state.tutorialDone || this.state.totalServed < 3; }
  profitMult() {
    let m = 1 + this.state.profitLv * 0.25;
    if (this.time < this.doubleProfitUntil) m *= 2;
    return m;
  }
  grillCookTime() {
    const base = this.isTraining() ? 2.4 : 3.0;
    return Math.max(1.15, base - this.state.grillLv * 0.35);
  }
  orderPay(kind: BurgerKind) {
    let base = menuItem(kind).pay;
    if (kind === 'classic' && this.state.totalServed < 3) base = 15;
    return Math.floor(base * this.profitMult() * this.traitPayMult());
  }
  traitPayMult(trait?: CustTrait) {
    // used at pay time from customer
    return 1;
  }
  payForCustomer(c: Customer) {
    let base = PAY[c.order] ?? menuItem(c.order).pay;
    if (c.order === 'classic' && this.state.totalServed < 3) base = 15;
    let tm = 1;
    if (c.trait === 'vip') tm = 1.25;
    else if (c.trait === 'hurried') tm = 1.1;
    return Math.floor(base * this.profitMult() * tm);
  }
  patienceStart(kind: BurgerKind, trait: CustTrait) {
    let p = Math.max(22, 34 - 2 * Math.floor(this.state.totalServed / 5));
    p += menuItem(kind).patienceBonus;
    if (trait === 'hurried') p *= 0.65;
    else if (trait === 'vip') p *= 1.15;
    return p;
  }
  cheeseOk() {
    const u = unlocksForLevel(this.restLevel());
    return this.state.hasCheese || u.cheese || cheeseUnlocked(this.state.totalServed, this.state.hasCheese);
  }
  doubleOk() {
    const u = unlocksForLevel(this.restLevel());
    return this.state.hasDoubleMenu || u.doubleMenu || doubleUnlocked(this.state.totalServed, this.state.hasDoubleMenu);
  }

  load() {
    this.state = loadLocal();
    this.applyUnlocks();
    if (this.state.tutorialDone) this.tutorialStep = 5;
  }

  applyUnlocks() {
    this.applyBuilds();
    this.workers = [];
    if (this.state.hasWaiter) {
      this.workers.push({
        type: 'waiter', x: -4, z: 0, carrying: emptyBurgers(), task: null, facing: 1, walk: 0,
      });
    }
    if (this.state.hasCleaner) {
      this.workers.push({
        type: 'cleaner', x: 1, z: 3.5, carrying: emptyBurgers(), task: null, facing: 1, walk: 0,
      });
    }
    this.world.syncTables();
    this.world.syncWorkers(this.workers);
  }

  applyBuilds() {
    const built = new Set(this.state.builtPads);
    const hasGrill = built.has('grill_1') || built.has('grill_2');
    const hasCounter = built.has('counter_1');
    this.world.setStationBuilt('grill', hasGrill);
    this.world.setStationBuilt('prep', hasGrill);
    this.world.setStationBuilt('counter', hasCounter);
    this.world.setStationBuilt('trash', hasCounter);

    let tables = 0;
    for (const pad of BUILD_PADS) {
      if (pad.kind === 'table' && built.has(pad.id) && pad.tableIndex != null) {
        tables = Math.max(tables, pad.tableIndex + 1);
      }
    }
    this.state.tablesUnlocked = Math.max(this.state.tablesUnlocked, tables);
    this.world.tables.forEach((tb, i) => {
      tb.unlocked = i < this.state.tablesUnlocked;
      // reposition to pad coords if defined
      const pad = BUILD_PADS.find((x) => x.kind === 'table' && x.tableIndex === i);
      if (pad) {
        tb.x = pad.x; tb.z = pad.z;
        tb.mesh.position.set(pad.x, 0, pad.z);
      }
      tb.mesh.visible = tb.unlocked;
    });

    const zones = new Set(this.state.openZones);
    if (built.has('expand_hr')) zones.add('hr');
    if (built.has('expand_player')) zones.add('playerUp');
    if (built.has('expand_street')) zones.add('street');
    if (built.has('drive_thru')) zones.add('driveThru');
    if (built.has('expand_storage')) zones.add('storage');
    if (built.has('expand_restroom')) zones.add('restroom');
    if (built.has('open_wing_b')) zones.add('wingB');
    this.state.openZones = [...zones];
    this.world.setZoneOpen('hr', zones.has('hr'));
    this.world.setZoneOpen('playerUp', zones.has('playerUp'));
    this.world.setZoneOpen('street', zones.has('street'));
    this.world.setZoneOpen('driveThru', zones.has('driveThru'));
    this.world.setZoneOpen('storage', zones.has('storage'));
    this.world.setZoneOpen('restroom', zones.has('restroom'));
    this.world.setZoneOpen('wingB', zones.has('wingB'));
  }

  saveLocal() {
    persistSave(this.state);
  }

  async saveCloud() {
    await cloudSave({ ...this.state });
  }

  addXP(n: number) {
    const prev = this.restLevel();
    this.state.restaurantXP += n;
    const next = this.restLevel();
    if (next > prev) {
      this.showToast(tf('levelUpToast', { n: next }));
      sfx.play('buy');
      if (next >= 5 && !this.state.seenCheeseToast) {
        this.state.hasCheese = true;
        this.state.seenCheeseToast = true;
        this.showToast(t('unlockCheese'));
      }
      if (next >= 7 && !this.state.seenDoubleToast) {
        this.state.hasDoubleMenu = true;
        this.state.seenDoubleToast = true;
        this.showToast(t('unlockDouble'));
      }
    }
  }

  completePad(id: string) {
    if (this.hasPad(id)) return;
    const def = BUILD_PADS.find((p) => p.id === id);
    if (!def) return;
    this.state.builtPads.push(id);
    this.state.buildsBought++;
    this.state.padPaid[id] = def.cost;
    this.addXP(def.xp);
    this.bumpMission('build', 1);
    this.applyBuilds();
    sfx.play('buy');
    this.showToast(`${t(def.labelKey)} ✓`);
    if (id === 'expand_hr') this.showToast(t('pad_expand_hr'));
    if (id === 'expand_player') this.showToast(t('pad_expand_player'));
    if (id === 'table_1' && !this.state.tutorialDone) this.tutorialStep = Math.max(this.tutorialStep, 0);
    if (id === 'grill_1') this.tutorialStep = Math.max(this.tutorialStep, 0);
    this.saveLocal();
  }

  updateBuildPads(dt: number) {
    const lv = this.restLevel();
    const px = this.player?.x ?? 0;
    const pz = this.player?.z ?? 0;
    type Cand = { def: (typeof BUILD_PADS)[number]; idx: number; locked: boolean; paid: number; d: number };
    const candidates: Cand[] = [];
    BUILD_PADS.forEach((def, idx) => {
      if (this.hasPad(def.id)) return;
      if (!def.requires.every((r) => this.hasPad(r))) return;
      candidates.push({
        def,
        idx,
        locked: lv < def.minLevel,
        paid: this.state.padPaid[def.id] || 0,
        d: Math.hypot(def.x - px, def.z - pz),
      });
    });
    // Next ≤2 by BUILD_PADS order; tie → closer to player. Presentation only.
    candidates.sort((a, b) => a.idx - b.idx || a.d - b.d);
    const nextIds = new Set(candidates.slice(0, 2).map((c) => c.def.id));
    const vis: { id: string; x: number; z: number; label: string; cost: number; paid: number; locked: boolean; lockLv?: number; visible: boolean; dim?: boolean }[] = [];
    for (const c of candidates) {
      const def = c.def;
      const isNext = nextIds.has(def.id);
      if (!isNext) continue; // hide non-next (no ring/label/pay)
      vis.push({
        id: def.id, x: def.x, z: def.z,
        label: t(def.labelKey),
        cost: def.cost, paid: c.paid, locked: c.locked, lockLv: def.minLevel,
        visible: true,
      });
      // stand-to-pay only for next unlocked pads
      if (!c.locked && this.player && dist(this.player, def) < 1.15) {
        if (def.cost <= 0) {
          this.completePad(def.id);
        } else {
          const need = def.cost - c.paid;
          if (need > 0 && this.state.cash <= 0.05) {
            if (this.time - this._padNeedToastAt >= 8) {
              this._padNeedToastAt = this.time;
              this.showToast(tf('padNeedMore', { n: Math.ceil(need) }));
            }
          } else if (need > 0 && this.state.cash > 0) {
            const drain = Math.min(this.state.cash, need, Math.max(0.5, 28 * dt));
            this.state.cash -= drain;
            this.state.padPaid[def.id] = c.paid + drain;
            if (this.state.padPaid[def.id] >= def.cost - 0.05) {
              this.state.cash += this.state.padPaid[def.id] - def.cost;
              this.state.padPaid[def.id] = def.cost;
              this.completePad(def.id);
            }
          }
        }
      }
    }
    this.world.syncBuildPads(vis);

    // HR / Player room proximity open
    if (this.state.openZones.includes('hr') && this.player && dist(this.player, { x: -8.5, z: -7.0 }) < 1.4) {
      this._hrNear = (this._hrNear || 0) + dt;
      if (this._hrNear > 0.35 && !this._hrOpen) this.openHr();
    } else this._hrNear = 0;
    if (this.state.openZones.includes('playerUp') && this.player && dist(this.player, { x: -4.0, z: -7.0 }) < 1.4) {
      this._pupNear = (this._pupNear || 0) + dt;
      if (this._pupNear > 0.35 && !this._pupOpen) this.openPlayerUp();
    } else this._pupNear = 0;
  }

  bumpMission(kind: string, amount: number) {
    const m = MISSIONS[this.state.missionIndex % MISSIONS.length];
    if (!m || m.kind !== kind) {
      if (kind === 'earn') {
        // earn missions track sessionEarned separately via check
      }
      return;
    }
    this.state.missionProgress += amount;
    if (this.state.missionProgress >= m.target) {
      this.state.cash += m.reward;
      this.addXP(m.xp);
      this.showToast(tf('missionDone', { cash: m.reward }));
      this.state.missionIndex++;
      this.state.missionProgress = 0;
      sfx.play('pay');
    }
  }

  syncMissionEarn() {
    const m = MISSIONS[this.state.missionIndex % MISSIONS.length];
    if (m && m.kind === 'earn') {
      this.state.missionProgress = Math.min(m.target, Math.floor(this.state.sessionEarned));
      if (this.state.missionProgress >= m.target) {
        this.state.cash += m.reward;
        this.addXP(m.xp);
        this.showToast(tf('missionDone', { cash: m.reward }));
        this.state.missionIndex++;
        this.state.missionProgress = 0;
      }
    }
  }

  openHr() {
    if (this._hrOpen || this.shopOpen) return;
    this._hrOpen = true;
    gameplayStop();
    const list = document.getElementById('hrList');
    const modal = document.getElementById('hrModal');
    if (!list || !modal) return;
    list.innerHTML = '';
    const lv = this.restLevel();
    for (const [id, info] of Object.entries(HR_HIRE)) {
      const owned = (id === 'hire_waiter' && this.state.hasWaiter)
        || (id === 'hire_cleaner' && this.state.hasCleaner)
        || (id === 'hire_cook' && this.state.hasCook)
        || (id === 'hire_cashier' && this.state.hasCashier);
      const row = document.createElement('div');
      row.className = 'shop-item';
      const locked = lv < info.minLevel;
      const can = !owned && !locked && this.state.cash >= info.cost;
      row.innerHTML = `<div class="info"><div class="name">${t(info.key)}</div>
        <div class="desc">${locked ? tf('padLockedLv', { n: info.minLevel }) : '+15 XP'}</div></div>
        <button type="button" ${(!can || owned) ? 'disabled' : ''}>${owned ? t('owned') : '$' + info.cost}</button>`;
      row.querySelector('button')!.addEventListener('click', () => {
        if (owned || locked || this.state.cash < info.cost) return;
        this.state.cash -= info.cost;
        if (id === 'hire_waiter') this.state.hasWaiter = true;
        if (id === 'hire_cleaner') this.state.hasCleaner = true;
        if (id === 'hire_cook') this.state.hasCook = true;
        if (id === 'hire_cashier') this.state.hasCashier = true;
        this.state.hiresBought++;
        this.addXP(info.xp);
        this.bumpMission('hire', 1);
        this.applyUnlocks();
        this.saveLocal();
        this.openHr();
        this.updateHUD();
      });
      list.appendChild(row);
    }
    modal.classList.remove('hidden');
  }

  closeHr() {
    this._hrOpen = false;
    document.getElementById('hrModal')?.classList.add('hidden');
    if (!this.paused && !this.shopOpen) gameplayStart();
  }

  openPlayerUp() {
    if (this._pupOpen || this.shopOpen) return;
    this._pupOpen = true;
    gameplayStop();
    const list = document.getElementById('playerUpList');
    const modal = document.getElementById('playerUpModal');
    if (!list || !modal) return;
    list.innerHTML = '';
    const items: { key: string; lv: number; kind: 'move' | 'carry' | 'revenue'; buy: () => void }[] = [
      { key: 'up_move', lv: this.state.speedLv, kind: 'move', buy: () => { this.state.speedLv++; } },
      { key: 'up_carry', lv: this.state.capLv, kind: 'carry', buy: () => { this.state.capLv++; } },
      { key: 'up_revenue', lv: this.state.profitLv, kind: 'revenue', buy: () => { this.state.profitLv++; } },
    ];
    for (const it of items) {
      const maxed = it.lv >= 5;
      const cost = playerUpCost(it.kind, it.lv);
      const can = !maxed && this.state.cash >= cost;
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `<div class="info"><div class="name">${t(it.key)} (${it.lv}/5)</div></div>
        <button type="button" ${maxed || !can ? 'disabled' : ''}>${maxed ? t('max') : '$' + cost}</button>`;
      row.querySelector('button')!.addEventListener('click', () => {
        if (it.lv >= 5 || this.state.cash < cost) return;
        this.state.cash -= cost;
        it.buy();
        this.addXP(playerUpXp(it.lv + 1));
        sfx.play('buy');
        this.saveLocal();
        this.openPlayerUp();
        this.updateHUD();
      });
      list.appendChild(row);
    }
    modal.classList.remove('hidden');
  }

  closePlayerUp() {
    this._pupOpen = false;
    document.getElementById('playerUpModal')?.classList.add('hidden');
    if (!this.paused && !this.shopOpen) gameplayStart();
  }

  maybeOfflineEarn() {
    const last = this.state.lastSeenAt || Date.now();
    const awaySec = Math.min(8 * 3600, Math.max(0, (Date.now() - last) / 1000));
    if (awaySec < 90 || !this.coreReady()) return;
    const rate = 0.35 + this.restLevel() * 0.08 + (this.state.hasWaiter ? 0.15 : 0);
    this._offlineCash = Math.floor(awaySec / 60 * rate * 4);
    if (this._offlineCash < 5) return;
    const modal = document.getElementById('offlineModal');
    const body = document.getElementById('offlineBody');
    if (body) body.textContent = tf('offlineBody', { cash: this._offlineCash });
    modal?.classList.remove('hidden');
    this.setPaused(true);
  }

  claimOffline(mult: number) {
    const n = Math.floor((this._offlineCash || 0) * mult);
    this.state.cash += n;
    this.state.sessionEarned += n;
    this._offlineCash = 0;
    document.getElementById('offlineModal')?.classList.add('hidden');
    this.setPaused(false);
    this.updateHUD();
    this.saveLocal();
  }

  async start() {
    this.load();
    const cloud = await cloudLoad();
    if (cloud && typeof cloud === 'object') {
      this.state = migrateSave({ ...this.state, ...cloud, version: (cloud as any).version ?? this.state.version });
      this.applyUnlocks();
      if (this.state.tutorialDone) this.tutorialStep = 5;
    }
    this.player = {
      x: -4.5, z: 0.5, vx: 0, vz: 0,
      patties: 0, burgers: emptyBurgers(), dirty: 0, facing: 1, walk: 0,
    };
    this.world.createPlayer();
    this.world.setPlayerPose(this.player.x, this.player.z, this.player.facing, 0, false);
    this.applyBuilds();
    this.running = true;
    this.paused = false;
    this.spawnTimer = this.isTraining() ? 1.0 : 2.5;
    this._tutorialStepAt = 0;
    this.lastTs = performance.now();
    gameplayStart();
    requestAnimationFrame((ts) => this.loop(ts));
    this.updateHUD();
    this.refreshShop();
    this.syncMuteBtn();
    this.checkUnlockToasts();
    this.bindBpUi();
    this.maybeOfflineEarn();
    if (!this.coreReady()) this.hintKey = 'hintPad';
  }

  bindBpUi() {
    document.getElementById('btnCloseHr')?.addEventListener('click', () => this.closeHr());
    document.getElementById('btnClosePlayerUp')?.addEventListener('click', () => this.closePlayerUp());
    document.getElementById('offlineClaim')?.addEventListener('click', () => this.claimOffline(1));
    document.getElementById('offlineX2')?.addEventListener('click', async () => {
      this.setPaused(true);
      // setPaused early-returns if already paused — still force mute before rewarded
      sfx.setPauseMute(true);
      const ok = await showRewarded();
      this.claimOffline(ok ? 2 : 1);
    });
  }

  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    document.getElementById('pauseOverlay')?.classList.toggle('hidden', !p);
    sfx.setPauseMute(p);
    if (p) gameplayStop();
    else {
      this.lastTs = performance.now();
      gameplayStart();
    }
  }

  bindInput() {
    const unlockAudio = () => sfx.unlock();
    window.addEventListener('pointerdown', unlockAudio, { once: false });
    window.addEventListener('keydown', unlockAudio, { once: false });

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        this.tryInteract();
      }
      if (e.code === 'Escape' && this.shopOpen) this.closeShop();
      if (e.code === 'KeyM') this.toggleMute();
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

  toggleMute() {
    sfx.toggle();
    this.syncMuteBtn();
    sfx.play('click');
  }

  syncMuteBtn() {
    const btn = document.getElementById('btnMute');
    if (btn) btn.textContent = sfx.muted ? '🔇' : '🔊';
  }

  loop(ts: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (!this.paused && !this.shopOpen && !this._hrOpen && !this._pupOpen) {
      this.dt = dt;
      this.time += dt;
      this.update(dt);
    }
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt: number) {
    this.updatePlayer(dt);
    this.updateBuildPads(dt);
    const got = this.world.collectFloorCoinsNear(this.player.x, this.player.z);
    if (got > 0) {
      this.state.cash += got;
      this.state.sessionEarned += got;
      this.syncMissionEarn();
      this.float(`+$${got}`, this.player.x, this.player.z, '#c9a227');
      sfx.play('pay');
    }
    if (this.hasPad('grill_1')) this.updateGrill(dt);
    if (this.hasPad('grill_1')) this.updatePrepCraft(dt);
    if (this.coreReady()) this.updateCustomers(dt);
    this.updateWorkers(dt);
    this.updateTutorial();
    this.updateApproachPrompt();
    this.checkUnlockToasts();
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

    let nx = this.player.x + this.player.vx * dt;
    let nz = this.player.z + this.player.vz * dt;
    // map bounds; block locked wings roughly
    nx = clamp(nx, MAP.minX + 0.6, MAP.maxX - 0.6);
    nz = clamp(nz, MAP.minZ + 0.6, MAP.maxZ - 0.6);
    if (!this.state.openZones.includes('street') && !this.state.openZones.includes('hr') && !this.state.openZones.includes('playerUp')) {
      nz = Math.max(nz, -4.6);
    } else if (!this.state.openZones.includes('street') && nz < -5.0 && nx > -2 && nx < 8) {
      nz = Math.max(nz, -4.6);
    }
    this.player.x = nx;
    this.player.z = nz;

    this.world.setPlayerPose(this.player.x, this.player.z, this.player.facing, this.player.walk, moving);
    this.world.followCamera(this.player.x, this.player.z, dt);
    this.autoInteract(dt);
  }

  nearPad(pad: InteractPad, padExtra = 0) {
    return dist(this.player, pad) < pad.r + padExtra;
  }

  getFocusStation(): { x: number; z: number; kind: string; color: number } | null {
    const list: { x: number; z: number; r: number; kind: string; color: number }[] = [
      { ...this.layout.grill.interact, kind: 'grill', color: 0xb54a3a },
      { ...this.layout.prep.interact, kind: 'prep', color: 0xc9a227 },
      { ...this.layout.counter.interact, kind: 'counter', color: 0x5a8f6b },
    ];
    for (const tb of this.world.tables) {
      if (tb.unlocked && tb.dirty) {
        list.push({ x: tb.x, z: tb.z - 1.05, r: 1.2, kind: 'table', color: 0xa89070 });
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
    if (best.kind === 'prep' && this.player.patties <= 0 && burgerSum(this.layout.prep.burgers) <= 0 && !this.layout.prep.craft) return null;
    if (best.kind === 'counter' && burgerSum(this.player.burgers) <= 0) return null;
    return best;
  }

  inGrillZone() { return this.nearPad(this.layout.grill.interact); }
  inPrepZone() { return this.nearPad(this.layout.prep.interact); }
  inCounterZone() { return this.nearPad(this.layout.counter.interact); }
  inTrashZone() { return this.nearPad(this.layout.trash.interact); }
  inTableZone(tb: { x: number; z: number }) {
    return dist(this.player, { x: tb.x, z: tb.z - 1.05 }) < 1.2;
  }

  pickTrait(): CustTrait {
    if (this.isTraining()) return 'regular';
    const r = Math.random();
    if (this.state.totalServed >= 6 && r < 0.2) return 'vip';
    if (r < 0.35) return 'hurried';
    return 'regular';
  }

  /** Target recipe for prep: most impatient queued customer we can craft */
  targetCraftKind(): BurgerKind {
    const queued = this.customers
      .filter((c) => c.state === 'queue')
      .slice()
      .sort((a, b) => a.patience - b.patience);
    for (const c of queued) {
      if (this.canCraft(c.order)) return c.order;
    }
    return 'classic';
  }

  canCraft(kind: BurgerKind): boolean {
    const m = menuItem(kind);
    if (m.needsCheese && !this.cheeseOk()) return false;
    if (kind === 'double' && !this.doubleOk()) return false;
    if (kind === 'cheese' && !this.cheeseOk()) return false;
    return this.layout.prep.patties >= m.patties;
  }

  autoInteract(_dt: number) {
    const g = this.layout.grill;
    const prep = this.layout.prep;
    const counter = this.layout.counter;
    if (!this.hasPad('grill_1') && !this.hasPad('counter_1')) return;

    if (this.hasPad('grill_1') && this.inGrillZone()) {
      const slots = this.grillSlotCount();
      for (let i = 0; i < slots; i++) {
        const s = g.slots[i];
        if (s.state === 'empty') {
          s.state = 'cooking';
          s.progress = 0;
          break;
        }
      }
      for (let i = 0; i < slots; i++) {
        const s = g.slots[i];
        if (s.state === 'ready' && this.player.patties < this.carryCap()) {
          s.state = 'empty';
          s.progress = 0;
          this.player.patties++;
          this.float('+🍖', this.player.x, this.player.z);
          sfx.play('pick');
          if (this.tutorialStep <= 1) this.tutorialStep = 2;
        }
      }
    }

    if (this.hasPad('grill_1') && this.inPrepZone()) {
      if (this.player.patties > 0) {
        prep.patties += this.player.patties;
        this.player.patties = 0;
        sfx.play('assemble');
      }
      // take finished burgers into hands
      const room = this.carryCap() - burgerSum(this.player.burgers);
      if (room > 0 && burgerSum(prep.burgers) > 0) {
        let left = room;
        for (const k of MENU_ORDER) {
          while (left > 0 && prep.burgers[k] > 0) {
            prep.burgers[k]--;
            this.player.burgers[k]++;
            left--;
          }
        }
        this.float('+🍔', this.player.x, this.player.z);
        sfx.play('pick');
        if (this.tutorialStep <= 2) this.tutorialStep = 3;
      }
    }

    if (this.inCounterZone() && burgerSum(this.player.burgers) > 0) {
      for (const k of MENU_ORDER) {
        if (this.player.burgers[k] > 0) {
          counter.burgers[k] += this.player.burgers[k];
          this.player.burgers[k] = 0;
        }
      }
      this.float('→ 🍽️', this.player.x, this.player.z);
      sfx.play('serve');
      this.world.punchCounter();
      if (this.tutorialStep <= 3) this.tutorialStep = 4;
    }

    if (this.hasPad('counter_1') && this.inTrashZone() && (this.player.patties > 0 || burgerSum(this.player.burgers) > 0)) {
      this.player.patties = 0;
      this.player.burgers = emptyBurgers();
      this.float('🗑️', this.player.x, this.player.z, '#95a5a6');
    }

    for (const tb of this.world.tables) {
      if (!tb.unlocked || !tb.dirty) continue;
      if (this.inTableZone(tb)) {
        tb.dirty = false;
        this.state.cash += 3;
        this.state.sessionEarned += 3;
        this.state.totalCleaned++;
        this.bumpMission('clean', 1);
        this.float('+$3', tb.x, tb.z, '#5a8f6b');
        this.world.punchTableClean(tb);
        this.float('✨', tb.x, tb.z, '#c9a227');
        sfx.play('clean');
        if (this.tutorialStep <= 4) {
          this.tutorialStep = 5;
          this.state.tutorialDone = true;
          this._shopPointOnce = false;
        }
      }
    }
  }

  tryInteract() { this.autoInteract(0); }

  updatePrepCraft(dt: number) {
    const prep = this.layout.prep;
    if (!this.inPrepZone()) {
      // pause craft outside zone (same station feel as grill tutorial)
      return;
    }
    if (prep.craft) {
      prep.craft.t += dt;
      if (prep.craft.t >= prep.craft.need) {
        addBurger(prep.burgers, prep.craft.kind);
        this.float(menuItem(prep.craft.kind).icon, this.layout.prep.x, this.layout.prep.z, '#c9a227');
        sfx.play('assemble');
        prep.craft = null;
        if (this.tutorialStep <= 2) this.tutorialStep = 3;
      }
      return;
    }
    if (prep.patties <= 0) return;
    const kind = this.targetCraftKind();
    const m = menuItem(kind);
    if (!this.canCraft(kind)) {
      // fallback classic if possible
      if (kind !== 'classic' && this.canCraft('classic')) {
        prep.patties -= 1;
        if (menuItem('classic').assembleSec <= 0) {
          addBurger(prep.burgers, 'classic');
          sfx.play('assemble');
        } else {
          prep.craft = { kind: 'classic', t: 0, need: menuItem('classic').assembleSec };
        }
      }
      return;
    }
    prep.patties -= m.patties;
    if (m.assembleSec <= 0) {
      addBurger(prep.burgers, kind);
      sfx.play('assemble');
      if (this.tutorialStep <= 2) this.tutorialStep = 3;
    } else {
      prep.craft = { kind, t: 0, need: m.assembleSec };
    }
  }

  updateGrill(dt: number) {
    const inZone = this.inGrillZone();
    const done = this.state.tutorialDone;
    const cookAfk = !!this.state.hasCook;
    if (!done && !inZone && !cookAfk) return;
    const slots = this.grillSlotCount() + (this.hasPad('grill_2') ? 1 : 0);
    if (done || cookAfk) {
      for (let i = 0; i < Math.min(slots, this.layout.grill.slots.length); i++) {
        const s = this.layout.grill.slots[i];
        if (s.state === 'empty') {
          s.state = 'cooking';
          s.progress = 0;
          break;
        }
      }
    }
    const rate = ((done || cookAfk) && (inZone || cookAfk)) ? 1.35 : 1;
    const need = this.grillCookTime();
    this.layout.grill.slots.forEach((s, i) => {
      if (i >= slots) {
        // unused higher slots stay empty visually
        if (s.state !== 'empty') { s.state = 'empty'; s.progress = 0; }
        return;
      }
      if (s.state === 'cooking') {
        s.progress += dt * rate;
        if (s.progress >= need) {
          s.state = 'ready';
          s.progress = need;
          this.world.punchGrillReady(i);
          if (!this._prevReady[i]) {
            sfx.play('ready');
            this._prevReady[i] = true;
          }
          if (this.tutorialStep === 0) this.tutorialStep = 1;
        }
      } else if (s.state !== 'ready') {
        this._prevReady[i] = false;
      }
    });
  }

  updateCustomers(dt: number) {
    this.spawnTimer -= dt;
    const unlocked = this.world.tables.filter((tb) => tb.unlocked);
    const waiting = this.customers.filter((c) => c.state === 'queue').length;
    const maxQueue = Math.min(4, 1 + Math.floor(this.state.tablesUnlocked / 2));
    if (!this.coreReady() || unlocked.length < 1) return;
    if (this.spawnTimer <= 0 && waiting < maxQueue) {
      const baseGap = this.isTraining() ? 2.6 : 4.5;
      this.spawnTimer = Math.max(1.2, baseGap - this.state.tablesUnlocked * 0.25);
      const trait = this.pickTrait();
      const order = pickOrderKind(
        this.state.totalServed,
        this.state.tutorialDone || this.coreReady(),
        this.cheeseOk(),
        this.doubleOk(),
      );
      const pat = this.patienceStart(order, trait);
      const fromStreet = this.state.openZones.includes('street');
      const sx = fromStreet ? this.world.streetSpawn.x : -0.4;
      const sz = fromStreet ? this.world.streetSpawn.z : 5.2;
      this.customers.push({
        x: sx, z: sz, state: 'queue',
        patience: pat, patienceMax: pat, order, trait,
        shirt: CLOTH[(Math.random() * CLOTH.length) | 0],
        skin: SKINS[(Math.random() * SKINS.length) | 0],
        hair: HAIR[(Math.random() * HAIR.length) | 0],
        shape: (Math.random() * 4) | 0,
        table: null, eatTime: 0, facing: -1,
      });
    }
    const queued = this.customers.filter((c) => c.state === 'queue');
    queued.forEach((c, i) => {
      const spot = this.world.queueSpots[Math.min(i, this.world.queueSpots.length - 1)];
      c.x = lerp(c.x, spot.x, 1 - Math.pow(0.001, dt));
      c.z = lerp(c.z, spot.z, 1 - Math.pow(0.001, dt));
      c.patience -= dt;
    });
    const counter = this.layout.counter;
    if (queued.length) {
      const c = queued[0];
      const spot0 = this.world.queueSpots[0];
      const need = c.order;
      const hasMatch = (counter.burgers[need] | 0) > 0;
      if (hasMatch && dist(c, spot0) < 0.6) {
        const free = unlocked.find((tb) => !tb.customer && !tb.dirty);
        if (free) {
          takeBurger(counter.burgers, need);
          c.state = 'toTable';
          c.table = free;
          free.customer = c;
          const pay = this.payForCustomer(c);
          const tip = Math.floor(pay * (0.4 + Math.random() * 0.2));
          const instant = pay - tip;
          this.state.cash += instant;
          this.state.sessionEarned += pay;
          this.state.totalServed++;
          this.bumpMission('serve', 1);
          this.syncMissionEarn();
          (c as any)._tip = tip;
          this.float(`+$${instant}`, free.x, free.z, '#c9a227');
          this.float(menuItem(need).icon, free.x, free.z + 0.3, '#fff');
          sfx.play('pay');
          this.world.punchCounter();
          this._mismatchHint = false;
        }
      } else if (!hasMatch && burgerSum(counter.burgers) > 0) {
        // wrong types sitting — soft hint later
        this._mismatchHint = true;
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
            const tip = (c as any)._tip || Math.floor(menuItem(c.order).pay * 0.45);
            if (tip > 0) this.world.spawnFloorCoin(c.table.x + 0.35, c.table.z + 0.35, tip);
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
        sfx.play('angry');
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
    if (burgerSum(w.carrying) <= 0) {
      this.moveEntity(w, prep.x, prep.z, 3.0, dt);
      if (dist(w, prep) < 0.7) {
        // craft leftover patties into classic if idle stock
        while (prep.patties >= 1 && burgerSum(prep.burgers) < 20 && !prep.craft) {
          if (prep.patties >= 2 && this.doubleOk() && Math.random() < 0.2) {
            prep.patties -= 2;
            addBurger(prep.burgers, 'double');
          } else if (prep.patties >= 1 && this.cheeseOk() && Math.random() < 0.3) {
            prep.patties -= 1;
            addBurger(prep.burgers, 'cheese');
          } else {
            prep.patties -= 1;
            addBurger(prep.burgers, 'classic');
          }
        }
        let left = cap - burgerSum(w.carrying);
        while (left > 0) {
          const k = takeAnyBurgerFifo(prep.burgers);
          if (!k) break;
          addBurger(w.carrying, k);
          left--;
        }
      }
    } else {
      this.moveEntity(w, counter.x, counter.z, 3.0, dt);
      if (dist(w, counter) < 0.7) {
        for (const k of MENU_ORDER) {
          if (w.carrying[k] > 0) {
            counter.burgers[k] += w.carrying[k];
            w.carrying[k] = 0;
          }
        }
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
      this.state.sessionEarned += 2;
      this.state.totalCleaned++;
      this.bumpMission('clean', 1);
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
    if (!this.hasPad('table_1')) {
      const p = BUILD_PADS.find((x) => x.id === 'table_1')!;
      return { x: p.x, z: p.z };
    }
    if (!this.hasPad('grill_1')) {
      const p = BUILD_PADS.find((x) => x.id === 'grill_1')!;
      return { x: p.x, z: p.z };
    }
    if (!this.hasPad('counter_1')) {
      const p = BUILD_PADS.find((x) => x.id === 'counter_1')!;
      return { x: p.x, z: p.z };
    }
    if (this.tutorialStep <= 1) return this.layout.grill.interact;
    if (this.tutorialStep === 2) return this.layout.prep.interact;
    if (this.tutorialStep === 3) return this.layout.counter.interact;
    if (this.tutorialStep === 4) {
      const tb = this.world.tables.find((t) => t.dirty);
      return tb ? { x: tb.x, z: tb.z - 1.05 } : null;
    }
    return null;
  }

  updateTutorial() {
    const arrow = document.getElementById('tutorialArrow');
    arrow?.classList.add('hidden');

    if ((this as any)._lastTutStep !== this.tutorialStep) {
      (this as any)._lastTutStep = this.tutorialStep;
      this._tutorialStepAt = this.time;
      this._stuckHintShown = false;
    }

    if (this.state.tutorialDone || this.tutorialStep >= 5) {
      if (!this._shopPointOnce) {
        this._shopPointOnce = true;
        this.hintKey = 'hintUpgrade';
        document.getElementById('btnShop')?.classList.add('pulse-once');
        setTimeout(() => document.getElementById('btnShop')?.classList.remove('pulse-once'), 3500);
      } else if (this._softHintLife <= 0) {
        this.hintKey = this.world.tables.some((tb) => tb.dirty) ? 'hintClean' : 'hintIdle';
      }
      this.updateSoftChainHints();
      return;
    }

    if (!this.hasPad('table_1') || !this.hasPad('grill_1') || !this.hasPad('counter_1')) {
      this.hintKey = 'hintPad';
      return;
    }
    const keys = ['hintCook', 'hintPick', 'hintStack', 'hintServe', 'hintClean'];
    this.hintKey = keys[Math.min(this.tutorialStep, keys.length - 1)];
    if (this.tutorialStep === 4 && !this.world.tables.some((tb) => tb.dirty)) {
      this.hintKey = 'hintWait';
    }
    if (this.time - this._tutorialStepAt >= 20) {
      this.hintKey = 'goHere';
      this._stuckHintShown = true;
    }
  }

  updateSoftChainHints() {
    if (!this.state.tutorialDone) return;
    const dt = this.dt;
    if (this.player.patties > 0 && !this.inPrepZone()) this._pattiesAwayT += dt;
    else this._pattiesAwayT = 0;
    if (burgerSum(this.player.burgers) > 0 && !this.inCounterZone()) this._burgersAwayT += dt;
    else this._burgersAwayT = 0;

    // wrong type on counter while front customer waits
    const front = this.customers.find((c) => c.state === 'queue');
    if (front && this._mismatchHint && (this.layout.counter.burgers[front.order] | 0) <= 0) {
      this._wrongTypeAwayT += dt;
    } else {
      this._wrongTypeAwayT = 0;
    }

    if (this._softHintLife > 0) {
      this._softHintLife -= dt;
      if (this._softHintLife <= 0) this._softHintTarget = null;
    }

    if (this.time - this._lastSoftHintAt < 8) return;

    if (this._wrongTypeAwayT > 4 && front) {
      this.hintKey = 'hintNeedType';
      this._softHintTarget = { ...this.layout.prep.interact };
      this._softHintLife = 3.5;
      this._lastSoftHintAt = this.time;
      this._wrongTypeAwayT = 0;
    } else if (this._pattiesAwayT > 4) {
      this.hintKey = 'hintStack';
      this._softHintTarget = { ...this.layout.prep.interact };
      this._softHintLife = 3.5;
      this._lastSoftHintAt = this.time;
      this._pattiesAwayT = 0;
    } else if (this._burgersAwayT > 4) {
      this.hintKey = 'hintServe';
      this._softHintTarget = { ...this.layout.counter.interact };
      this._softHintLife = 3.5;
      this._lastSoftHintAt = this.time;
      this._burgersAwayT = 0;
    }
  }

  checkUnlockToasts() {
    if (this.cheeseOk() && !this.state.seenCheeseToast) {
      this.state.seenCheeseToast = true;
      this.state.hasCheese = true;
      this.showToast(t('toastCheese'));
      this.saveLocal();
    }
    if (this.doubleOk() && !this.state.seenDoubleToast) {
      this.state.seenDoubleToast = true;
      this.state.hasDoubleMenu = true;
      this.showToast(t('toastDouble'));
      this.saveLocal();
    }
  }

  showToast(text: string) {
    const host = document.getElementById('toastHost');
    if (!host) {
      this.float(text, this.player?.x ?? 0, this.player?.z ?? 0, '#d4a574');
      return;
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.classList.add('show'), 20);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3200);
    sfx.play('buy');
  }

  updateApproachPrompt() {
    const pads: { x: number; z: number; r: number; kind: string }[] = [
      { ...this.layout.grill.interact, kind: 'grill' },
      { ...this.layout.prep.interact, kind: 'prep' },
      { ...this.layout.counter.interact, kind: 'counter' },
    ];
    this.world.tables.forEach((tb, i) => {
      if (tb.unlocked && tb.dirty) {
        pads.push({ x: tb.x, z: tb.z - 1.05, r: 1.2, kind: `table-${i}` });
      }
    });
    let best: typeof pads[0] | null = null;
    let bestD = 1e9;
    for (const p of pads) {
      const d = dist(this.player, p);
      if (d < bestD) { best = p; bestD = d; }
    }
    this._activePadKind = null;
    let approach: { x: number; z: number } | null = null;
    if (best) {
      if (bestD < best.r) {
        this._activePadKind = best.kind;
        this._approachFade = Math.max(0, this._approachFade - this.dt / 0.25);
      } else if (bestD < best.r + 0.35) {
        approach = best;
        this._approachFade = Math.min(1, this._approachFade + this.dt / 0.4);
      } else {
        this._approachFade = Math.max(0, this._approachFade - this.dt / 0.35);
      }
    } else {
      this._approachFade = Math.max(0, this._approachFade - this.dt / 0.35);
    }
    this.world.setStationHighlight(this._activePadKind);
    if (approach && this._approachFade > 0.05) {
      this.world.setApproachHint(approach.x, approach.z, this._approachFade);
    } else {
      this.world.setApproachHint(null, null, 0);
    }
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
      if (ico) {
        if (c.state === 'toTable') ico.textContent = '😋';
        else ico.textContent = menuItem(c.order).icon;
      }
      const bar = el.querySelector('.patience > i') as HTMLElement | null;
      if (bar) {
        const p = clamp(c.patience / (c.patienceMax || 34), 0, 1);
        bar.style.width = `${p * 100}%`;
        bar.style.background = patienceColor(p);
        (el.querySelector('.patience') as HTMLElement).style.display =
          c.state === 'queue' ? 'block' : 'none';
      }
      el.classList.toggle('urgent', c.state === 'queue' && c.patience / c.patienceMax < 0.35);
      const scr = this.world.worldToScreen(c.x, 1.9, c.z);
      el.style.left = `${scr.x}px`;
      el.style.top = `${scr.y}px`;
      el.style.display = scr.visible ? 'block' : 'none';
    }
  }

  syncQueueCards() {
    const host = document.getElementById('orderQueue');
    if (!host) return;
    const queued = this.customers.filter((c) => c.state === 'queue').slice(0, 3);
    host.innerHTML = '';
    if (!queued.length) {
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    for (const c of queued) {
      const m = menuItem(c.order);
      const p = clamp(c.patience / (c.patienceMax || 34), 0, 1);
      const card = document.createElement('div');
      card.className = 'order-card' + (p < 0.35 ? ' urgent' : p < 0.6 ? ' warn' : '');
      const ings = m.id === 'double'
        ? '🍖🍖'
        : m.id === 'cheese'
          ? '🍖🧀'
          : '🍖';
      card.innerHTML = `
        <div class="oc-ico">${m.icon}</div>
        <div class="oc-body">
          <div class="oc-name">${t(m.nameKey)}</div>
          <div class="oc-ings">${ings}</div>
          <div class="oc-bar"><i style="width:${p * 100}%;background:${patienceColor(p)}"></i></div>
        </div>`;
      host.appendChild(card);
    }
  }

  syncWorld() {
    this.world.syncGrill(this.layout.grill.slots, this.grillCookTime(), this.time, this.dt);
    this.world.syncPrep(this.layout.prep.patties, burgersToStack(this.layout.prep.burgers));
    this.world.syncCounter(burgersToStack(this.layout.counter.burgers), this.dt);
    this.world.syncTables(this.dt);
    this.world.syncCustomers(this.customers, this.time);
    this.world.syncWorkers(this.workers.map((w) => ({
      ...w,
      carrying: burgerSum(w.carrying),
    })));
    this.world.updatePlayerStack(this.player.patties, burgersToStack(this.player.burgers));

    const focus = this.getFocusStation();
    if (focus) this.world.setFocus(focus.x, focus.z, focus.color);
    else this.world.setFocus(0, 0, null);

    this.world.updateInteractPads(this._activePadKind, this.time);

    const stuckPulse = !this.state.tutorialDone && this.time - this._tutorialStepAt >= 20;
    const tgt = this.tutorialTarget();
    if (tgt) {
      this.world.setTutorialTarget(tgt.x, tgt.z, this.time);
      if (stuckPulse) this.world.setFocus(tgt.x, tgt.z, 0xc9a227);
    } else {
      this.world.setTutorialTarget(null, null, this.time);
    }

    if (this._softHintTarget && this._softHintLife > 0) {
      this.world.setSoftHintTarget(this._softHintTarget.x, this._softHintTarget.z, this.time);
    } else {
      this.world.setSoftHintTarget(null, null, this.time);
    }

    this.syncBubbles();
    this.syncQueueCards();

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
    const menuStrip = document.getElementById('menuStrip');
    if (cash) {
      const bonus = this.time < this.doubleProfitUntil ? ' ✨x2' : '';
      cash.textContent = `${t('cash')} ${Math.floor(this.state.cash)}${bonus}`;
    }
    if (carry && this.player) {
      const cap = this.carryCap();
      const bsum = burgerSum(this.player.burgers);
      carry.textContent = `🍖 ${this.player.patties}/${cap}  ·  🍔 ${bsum}/${cap}`;
    }
    if (hint) {
      if (this.hintKey === 'hintNeedType') {
        const front = this.customers.find((c) => c.state === 'queue');
        const name = front ? t(menuItem(front.order).nameKey) : '';
        hint.textContent = t('hintNeedType').replace('{type}', name);
      } else {
        hint.textContent = t(this.hintKey);
      }
    }
    if (stepEl && banner) {
      const tutoring = !this.state.tutorialDone && this.tutorialStep < 5;
      stepEl.classList.toggle('hidden', !tutoring);
      banner.classList.toggle('idle', !tutoring);
      if (tutoring) stepEl.textContent = `${t('step')} ${this.tutorialStep + 1}/5`;
    }
    if (menuStrip) {
      const parts: string[] = [];
      for (const k of MENU_ORDER) {
        const unlocked = k === 'classic' || (k === 'cheese' && this.cheeseOk()) || (k === 'double' && this.doubleOk());
        const m = menuItem(k);
        parts.push(`<span class="ms-item${unlocked ? '' : ' locked'}" title="${t(m.nameKey)}">${m.icon} $${m.pay}</span>`);
      }
      menuStrip.innerHTML = parts.join('');
    }
    const xp = xpProgress(this.state.restaurantXP);
    const lvLabel = document.getElementById('restLvLabel');
    const xpLabel = document.getElementById('restXpLabel');
    const xpBar = document.getElementById('restXpBar');
    if (lvLabel) lvLabel.textContent = tf('hudRestLv', { n: xp.level });
    if (xpLabel) xpLabel.textContent = tf('hudXp', { into: Math.floor(xp.into), need: xp.need });
    if (xpBar) xpBar.style.width = `${Math.floor(xp.pct * 100)}%`;
    const m = MISSIONS[this.state.missionIndex % MISSIONS.length];
    const mt = document.getElementById('missionTitle');
    const mb = document.getElementById('missionBody');
    const mbar = document.getElementById('missionBar');
    if (mt) mt.textContent = t('missionTitle');
    if (m && mb) {
      const prog = m.kind === 'earn'
        ? Math.min(m.target, Math.floor(this.state.sessionEarned))
        : this.state.missionProgress;
      mb.textContent = `${t(m.labelKey)} (${prog}/${m.target})`;
      if (mbar) mbar.style.width = `${Math.floor(Math.min(1, prog / m.target) * 100)}%`;
    }
  }

  shopItems() {
    const s = this.state;
    const items: any[] = [
      { id: 'speed', icon: '👟', name: t('speed'), desc: t('speedDesc'), level: s.speedLv, max: 8, cost: Math.floor(40 * Math.pow(1.55, s.speedLv)), buy: () => { s.speedLv++; } },
      { id: 'cap', icon: '🎒', name: t('capacity'), desc: t('capacityDesc'), level: s.capLv, max: 6, cost: Math.floor(50 * Math.pow(1.6, s.capLv)), buy: () => { s.capLv++; } },
      { id: 'profit', icon: '💵', name: t('profit'), desc: t('profitDesc'), level: s.profitLv, max: 10, cost: Math.floor(60 * Math.pow(1.5, s.profitLv)), buy: () => { s.profitLv++; } },
      { id: 'grill', icon: '🔥', name: t('grillSpeed'), desc: t('grillSpeedDesc'), level: s.grillLv, max: 6, cost: Math.floor(45 * Math.pow(1.55, s.grillLv)), buy: () => { s.grillLv++; } },
      { id: 'table', icon: '🪑', name: t('table'), desc: t('tableDesc'), level: s.tablesUnlocked, max: this.world.tables.length, cost: Math.floor(80 * Math.pow(1.45, s.tablesUnlocked - 1)), buy: () => { s.tablesUnlocked++; this.applyUnlocks(); } },
      { id: 'waiter', icon: '👔', name: t('waiter'), desc: t('waiterDesc'), level: s.hasWaiter ? 1 : 0, max: 1, cost: 200, buy: () => { s.hasWaiter = true; this.applyUnlocks(); } },
      { id: 'cleaner', icon: '🧹', name: t('cleaner'), desc: t('cleanerDesc'), level: s.hasCleaner ? 1 : 0, max: 1, cost: 180, buy: () => { s.hasCleaner = true; this.applyUnlocks(); } },
    ];
    // one-shot recipe unlocks
    const cheeseOwned = this.cheeseOk();
    items.push({
      id: 'unlockCheese', icon: '🧀', name: t('unlockCheese'), desc: t('unlockCheeseDesc'),
      level: cheeseOwned ? 1 : 0, max: 1, cost: 40,
      buy: () => { s.hasCheese = true; this.checkUnlockToasts(); },
    });
    const doubleOwned = this.doubleOk();
    items.push({
      id: 'unlockDouble', icon: '🍔🍔', name: t('unlockDouble'), desc: t('unlockDoubleDesc'),
      level: doubleOwned ? 1 : 0, max: 1, cost: 90,
      buy: () => { s.hasDoubleMenu = true; this.checkUnlockToasts(); },
    });
    return items;
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
        sfx.play('buy');
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
    sfx.play('click');
    this.refreshShop();
    document.getElementById('shop')?.classList.remove('hidden');
  }

  async closeShop() {
    this.shopOpen = false;
    document.getElementById('shop')?.classList.add('hidden');
    if (!this.state.tutorialDone) {
      if (!this.paused) gameplayStart();
      return;
    }
    if (this.time - this._lastFsAt > 90) {
      this._lastFsAt = this.time;
      this.setPaused(true);
      await showFullscreen();
      this.setPaused(false);
    } else if (!this.paused) {
      gameplayStart();
    }
  }

  async onReward() {
    this.setPaused(true);
    const ok = await showRewarded();
    this.setPaused(false);
    if (ok) {
      this.doubleProfitUntil = this.time + 60;
      this.float(t('rewardOk'), this.player.x, this.player.z, '#c9a227');
      sfx.play('buy');
    } else {
      this.float(t('rewardFail'), this.player.x, this.player.z, '#e74c3c');
    }
  }
}
