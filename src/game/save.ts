/** Save + migration v3.1 BP — UX_BP_CANON */

export interface MetaSave {
  version: number;
  cash: number;
  restaurantXP: number;
  builtPads: string[];
  padPaid: Record<string, number>;
  openZones: string[];
  speedLv: number;
  capLv: number;
  profitLv: number;
  grillLv: number;
  tablesUnlocked: number;
  hasWaiter: boolean;
  hasCleaner: boolean;
  hasCook: boolean;
  hasCashier: boolean;
  hasCheese: boolean;
  hasDoubleMenu: boolean;
  tutorialDone: boolean;
  totalServed: number;
  totalCleaned: number;
  sessionEarned: number;
  buildsBought: number;
  hiresBought: number;
  missionIndex: number;
  missionProgress: number;
  seenCheeseToast: boolean;
  seenDoubleToast: boolean;
  lastSeenAt: number;
}

export const SAVE_KEY = 'burger_rush_save_v3';
export const LEGACY_KEY = 'burger_rush_save_v1';

export function defaultMeta(): MetaSave {
  return {
    version: 3,
    cash: 100,
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

export function migrateSave(raw: unknown): MetaSave {
  const base = defaultMeta();
  if (!raw || typeof raw !== 'object') return base;
  const d = raw as Record<string, unknown>;

  if (d.version == null || Number(d.version) < 3) {
    base.cash = Math.max(100, Number(d.cash) || 0);
    base.speedLv = Number(d.speedLv) || 0;
    base.capLv = Number(d.capLv) || 0;
    base.profitLv = Number(d.profitLv) || 0;
    base.grillLv = Number(d.grillLv) || 0;
    base.hasWaiter = !!d.hasWaiter;
    base.hasCleaner = !!d.hasCleaner;
    base.hasCheese = !!d.hasCheese;
    base.hasDoubleMenu = !!d.hasDoubleMenu;
    base.tutorialDone = !!d.tutorialDone;
    base.totalServed = Number(d.totalServed) || 0;
    base.seenCheeseToast = !!d.seenCheeseToast;
    base.seenDoubleToast = !!d.seenDoubleToast;
    if (base.tutorialDone || base.totalServed > 0 || (Number(d.tablesUnlocked) || 0) > 0) {
      base.builtPads = ['table_1', 'grill_1', 'counter_1'];
      base.tablesUnlocked = Math.max(1, Number(d.tablesUnlocked) || 1);
      base.restaurantXP = 29; // 5+12+12
      if (base.tablesUnlocked >= 2) {
        base.builtPads.push('table_2');
        base.restaurantXP = 39;
      }
      base.openZones = ['kitchen', 'dining'];
    }
    return base;
  }

  const padPaidRaw = (d.padPaid && typeof d.padPaid === 'object') ? d.padPaid as Record<string, unknown> : {};
  const padPaid: Record<string, number> = {};
  for (const [k, v] of Object.entries(padPaidRaw)) padPaid[k] = Number(v) || 0;

  return {
    ...base,
    cash: Number(d.cash) || 0,
    restaurantXP: Number(d.restaurantXP) || 0,
    builtPads: Array.isArray(d.builtPads) ? (d.builtPads as unknown[]).map(String) : [],
    padPaid,
    openZones: Array.isArray(d.openZones) ? (d.openZones as unknown[]).map(String) : ['kitchen', 'dining'],
    speedLv: Number(d.speedLv) || 0,
    capLv: Number(d.capLv) || 0,
    profitLv: Number(d.profitLv) || 0,
    grillLv: Number(d.grillLv) || 0,
    tablesUnlocked: Number(d.tablesUnlocked) || 0,
    hasWaiter: !!d.hasWaiter,
    hasCleaner: !!d.hasCleaner,
    hasCook: !!d.hasCook,
    hasCashier: !!d.hasCashier,
    hasCheese: !!d.hasCheese,
    hasDoubleMenu: !!d.hasDoubleMenu,
    tutorialDone: !!d.tutorialDone,
    totalServed: Number(d.totalServed) || 0,
    totalCleaned: Number(d.totalCleaned) || 0,
    sessionEarned: Number(d.sessionEarned) || 0,
    buildsBought: Number(d.buildsBought) || 0,
    hiresBought: Number(d.hiresBought) || 0,
    missionIndex: Number(d.missionIndex) || 0,
    missionProgress: Number(d.missionProgress) || 0,
    seenCheeseToast: !!d.seenCheeseToast,
    seenDoubleToast: !!d.seenDoubleToast,
    lastSeenAt: Number(d.lastSeenAt) || Date.now(),
  };
}

export function loadLocal(): MetaSave {
  try {
    const v3 = localStorage.getItem(SAVE_KEY);
    if (v3) return migrateSave(JSON.parse(v3));
    const v1 = localStorage.getItem(LEGACY_KEY);
    if (v1) return migrateSave(JSON.parse(v1));
  } catch (_) {}
  return defaultMeta();
}

export function saveLocal(data: MetaSave) {
  try {
    data.lastSeenAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (_) {}
}

/** Cloud version is usable only at v3+ (BP save). Legacy/empty cloud must not migrate over local. */
export function cloudVersionOk(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const v = Number((raw as Record<string, unknown>).version);
  return Number.isFinite(v) && v >= 3;
}

/**
 * Merge cloud into local by lastSeenAt (newer wins).
 * Never wipe builtPads/padPaid with empty cloud data; skip legacy cloud entirely.
 */
export function mergeCloudSave(local: MetaSave, cloudRaw: unknown): MetaSave {
  if (!cloudVersionOk(cloudRaw)) return local;
  const cloud = migrateSave(cloudRaw);
  const localTs = Number(local.lastSeenAt) || 0;
  const cloudTs = Number(cloud.lastSeenAt) || 0;
  const newer = cloudTs >= localTs ? cloud : local;
  const older = cloudTs >= localTs ? local : cloud;
  const out: MetaSave = { ...newer };
  if ((!out.builtPads || out.builtPads.length === 0) && older.builtPads?.length) {
    out.builtPads = older.builtPads.slice();
  }
  const outPaidKeys = out.padPaid ? Object.keys(out.padPaid).length : 0;
  const olderPaidKeys = older.padPaid ? Object.keys(older.padPaid).length : 0;
  if (outPaidKeys === 0 && olderPaidKeys > 0) {
    out.padPaid = { ...older.padPaid };
  }
  return out;
}

