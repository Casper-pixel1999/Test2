/** UX_BP_CANON + GAMEPLAY_DESIGN_V3_BP_ALIGNED §11 — exact costs/XP */

export type PadKind =
  | 'table' | 'grill' | 'counter' | 'expand_hr' | 'expand_player'
  | 'expand_street' | 'drive_thru' | 'grill2' | 'expand_storage'
  | 'expand_restroom' | 'cashier_desk' | 'open_wing_b';

export interface BuildPadDef {
  id: string;
  kind: PadKind;
  x: number;
  z: number;
  cost: number;
  xp: number;
  requires: string[];
  minLevel: number;
  tableIndex?: number;
  labelKey: string;
}

export interface MissionDef {
  id: string;
  target: number;
  reward: number;
  xp: number;
  kind: 'serve' | 'clean' | 'earn' | 'build' | 'hire';
  labelKey: string;
}

export const MAP = { minX: -15.5, maxX: 15.5, minZ: -11, maxZ: 6 };

/** restLv cum XP: 1:0 2:40 3:90 4:150 5:230 6:330 7:450 8:590 9:760 10:950 */
export const XP_CUM = [0, 40, 90, 150, 230, 330, 450, 590, 760, 950];

export function levelFromXp(xp: number): number {
  let lv = 1;
  for (let i = 1; i < XP_CUM.length; i++) {
    if (xp >= XP_CUM[i]) lv = i + 1;
    else break;
  }
  return Math.min(10, lv);
}

export function xpProgress(xp: number) {
  const level = levelFromXp(xp);
  const cur = XP_CUM[level - 1] ?? 0;
  const next = level >= 10 ? cur + 200 : (XP_CUM[level] ?? cur + 200);
  const into = Math.max(0, xp - cur);
  const need = Math.max(1, next - cur);
  return { level, into, need, pct: Math.min(1, into / need) };
}

export function unlocksForLevel(lv: number) {
  return {
    hr: lv >= 2, playerUp: lv >= 2, street: lv >= 3, grill2: lv >= 4,
    storage: lv >= 4, cheese: lv >= 5, cashier: lv >= 5, restroom: lv >= 6,
    doubleMenu: lv >= 7, wingB: lv >= 8,
  };
}

/** Exact UX_BP_CANON pad table */
export const BUILD_PADS: BuildPadDef[] = [
  { id: 'table_1', kind: 'table', x: 2.5, z: 0.6, cost: 0, xp: 5, requires: [], minLevel: 1, tableIndex: 0, labelKey: 'pad_table_1' },
  { id: 'grill_1', kind: 'grill', x: -8.0, z: -2.8, cost: 40, xp: 12, requires: ['table_1'], minLevel: 1, labelKey: 'pad_grill_1' },
  { id: 'counter_1', kind: 'counter', x: -2.2, z: 0.0, cost: 50, xp: 12, requires: ['grill_1'], minLevel: 1, labelKey: 'pad_counter_1' },
  { id: 'table_2', kind: 'table', x: 5.9, z: 0.6, cost: 60, xp: 10, requires: ['counter_1'], minLevel: 1, tableIndex: 1, labelKey: 'pad_table_2' },
  { id: 'expand_hr', kind: 'expand_hr', x: -8.5, z: -4.5, cost: 110, xp: 20, requires: ['table_2'], minLevel: 2, labelKey: 'pad_expand_hr' },
  { id: 'expand_player', kind: 'expand_player', x: -5.5, z: -7.0, cost: 135, xp: 20, requires: ['expand_hr'], minLevel: 2, labelKey: 'pad_expand_player' },
  { id: 'table_3', kind: 'table', x: 9.3, z: 0.6, cost: 100, xp: 12, requires: ['expand_player'], minLevel: 2, tableIndex: 2, labelKey: 'pad_table_3' },
  { id: 'expand_street', kind: 'expand_street', x: 3.0, z: -4.5, cost: 170, xp: 28, requires: ['table_3'], minLevel: 3, labelKey: 'pad_expand_street' },
  { id: 'drive_thru', kind: 'drive_thru', x: 9.8, z: -6.2, cost: 240, xp: 34, requires: ['expand_street'], minLevel: 3, labelKey: 'pad_drive_thru' },
  { id: 'grill_2', kind: 'grill2', x: -8.0, z: -5.2, cost: 270, xp: 32, requires: ['grill_1'], minLevel: 4, labelKey: 'pad_grill_2' },
  { id: 'table_4', kind: 'table', x: 3.2, z: 4.3, cost: 160, xp: 14, requires: ['grill_2'], minLevel: 4, tableIndex: 3, labelKey: 'pad_table_4' },
  { id: 'expand_storage', kind: 'expand_storage', x: -10.8, z: -3.2, cost: 210, xp: 25, requires: ['counter_1'], minLevel: 4, labelKey: 'pad_expand_storage' },
  { id: 'expand_restroom', kind: 'expand_restroom', x: 0.5, z: -4.5, cost: 255, xp: 27, requires: ['expand_hr'], minLevel: 6, labelKey: 'pad_expand_restroom' },
  { id: 'table_5', kind: 'table', x: 6.8, z: 4.3, cost: 190, xp: 14, requires: ['expand_restroom'], minLevel: 6, tableIndex: 4, labelKey: 'pad_table_5' },
  { id: 'cashier_desk', kind: 'cashier_desk', x: -2.2, z: 2.8, cost: 340, xp: 38, requires: ['counter_1'], minLevel: 5, labelKey: 'pad_cashier_desk' },
  { id: 'open_wing_b', kind: 'open_wing_b', x: 10.5, z: 2.0, cost: 500, xp: 45, requires: ['table_5'], minLevel: 8, labelKey: 'pad_open_wing_b' },
];

export const MISSIONS: MissionDef[] = [
  { id: 'serve5', kind: 'serve', target: 5, reward: 30, xp: 5, labelKey: 'missionServe5' },
  { id: 'clean3', kind: 'clean', target: 3, reward: 25, xp: 5, labelKey: 'missionClean3' },
  { id: 'earn100', kind: 'earn', target: 100, reward: 40, xp: 8, labelKey: 'missionEarn100' },
  { id: 'build3', kind: 'build', target: 3, reward: 35, xp: 8, labelKey: 'missionBuild3' },
  { id: 'serve15', kind: 'serve', target: 15, reward: 65, xp: 12, labelKey: 'missionServe15' },
  { id: 'hire1', kind: 'hire', target: 1, reward: 55, xp: 10, labelKey: 'missionHire1' },
  { id: 'clean10', kind: 'clean', target: 10, reward: 60, xp: 12, labelKey: 'missionClean10' },
  { id: 'earn300', kind: 'earn', target: 300, reward: 110, xp: 14, labelKey: 'missionEarn300' },
];

export const START_CASH = 100;

export const HR_HIRE = {
  hire_cleaner: { cost: 150, xp: 15, minLevel: 2, key: 'hire_cleaner' },
  hire_waiter: { cost: 185, xp: 15, minLevel: 2, key: 'hire_waiter' },
  hire_cook: { cost: 230, xp: 15, minLevel: 3, key: 'hire_cook' },
  hire_cashier: { cost: 270, xp: 15, minLevel: 5, key: 'hire_cashier' },
} as const;

export function playerUpCost(kind: 'move' | 'carry' | 'revenue', lv: number) {
  const base = kind === 'move' ? 80 : kind === 'carry' ? 90 : 100;
  return Math.floor(base * Math.pow(1.35, Math.min(lv, 4)));
}

export function playerUpXp(boughtLevel: number) {
  return 6 + 2 * (boughtLevel - 1);
}

export const PAY = { classic: 14, cheese: 20, double: 28 };
