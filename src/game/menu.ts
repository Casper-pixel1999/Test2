/** Бургерная recipe / order types — GAMEPLAY_DESIGN_V2_RECIPES */
export type BurgerKind = 'classic' | 'cheese' | 'double';

export type BurgerCounts = { classic: number; cheese: number; double: number };

export interface MenuItem {
  id: BurgerKind;
  icon: string;
  nameKey: string;
  patties: number;
  /** Base pay before profitMult; classic onboarding overrides to 15 */
  pay: number;
  /** Extra assemble time in prep zone (seconds) */
  assembleSec: number;
  /** Added to patience max */
  patienceBonus: number;
  needsCheese: boolean;
}

export const MENU: Record<BurgerKind, MenuItem> = {
  classic: {
    id: 'classic',
    icon: '🍔',
    nameKey: 'menuClassic',
    patties: 1,
    pay: 12,
    assembleSec: 0,
    patienceBonus: 0,
    needsCheese: false,
  },
  cheese: {
    id: 'cheese',
    icon: '🧀🍔',
    nameKey: 'menuCheese',
    patties: 1,
    pay: 18,
    assembleSec: 0.35,
    patienceBonus: 2,
    needsCheese: true,
  },
  double: {
    id: 'double',
    icon: '🍔🍔',
    nameKey: 'menuDouble',
    patties: 2,
    pay: 24,
    assembleSec: 0.55,
    patienceBonus: 4,
    needsCheese: false,
  },
};

export const MENU_ORDER: BurgerKind[] = ['classic', 'cheese', 'double'];

export function emptyBurgers(): BurgerCounts {
  return { classic: 0, cheese: 0, double: 0 };
}

export function burgerSum(b: BurgerCounts): number {
  return (b.classic | 0) + (b.cheese | 0) + (b.double | 0);
}

export function migrateBurgers(raw: unknown): BurgerCounts {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      classic: Math.max(0, Number(o.classic) || 0),
      cheese: Math.max(0, Number(o.cheese) || 0),
      double: Math.max(0, Number(o.double) || 0),
    };
  }
  const n = Math.max(0, Number(raw) || 0);
  return { classic: n, cheese: 0, double: 0 };
}

export function menuItem(kind: BurgerKind): MenuItem {
  return MENU[kind] || MENU.classic;
}

export function cheeseUnlocked(totalServed: number, hasCheese: boolean): boolean {
  return hasCheese || totalServed >= 5;
}

export function doubleUnlocked(totalServed: number, hasDoubleMenu: boolean): boolean {
  return hasDoubleMenu || totalServed >= 12;
}

/** Training / pre-unlock: 100% classic. After cheese: 60/40. After double: 45/35/20. */
export function pickOrderKind(
  totalServed: number,
  tutorialDone: boolean,
  hasCheese: boolean,
  hasDoubleMenu: boolean,
): BurgerKind {
  if (!tutorialDone || totalServed < 3) return 'classic';
  const cheeseOk = cheeseUnlocked(totalServed, hasCheese);
  const doubleOk = doubleUnlocked(totalServed, hasDoubleMenu);
  if (!cheeseOk) return 'classic';
  const r = Math.random();
  if (doubleOk) {
    if (r < 0.45) return 'classic';
    if (r < 0.45 + 0.35) return 'cheese';
    return 'double';
  }
  return r < 0.6 ? 'classic' : 'cheese';
}

/** Expand counts top→bottom for stack meshes (FIFO oldest first visually at bottom) */
export function burgersToStack(b: BurgerCounts, max = 12): BurgerKind[] {
  const out: BurgerKind[] = [];
  for (const k of MENU_ORDER) {
    for (let i = 0; i < (b[k] | 0) && out.length < max; i++) out.push(k);
  }
  return out;
}

/** Take one burger of kind if present; returns true if taken */
export function takeBurger(b: BurgerCounts, kind: BurgerKind): boolean {
  if ((b[kind] | 0) <= 0) return false;
  b[kind]--;
  return true;
}

/** FIFO take any one burger (waiter): classic → cheese → double order of preference by count presence, oldest type order */
export function takeAnyBurgerFifo(b: BurgerCounts): BurgerKind | null {
  for (const k of MENU_ORDER) {
    if ((b[k] | 0) > 0) {
      b[k]--;
      return k;
    }
  }
  return null;
}

export function addBurger(b: BurgerCounts, kind: BurgerKind, n = 1) {
  b[kind] = (b[kind] | 0) + n;
}
