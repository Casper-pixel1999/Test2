# Бургерная v3.1 BP-aligned

Canon: `GAMEPLAY_DESIGN_V3_BP_ALIGNED.md` §11 + `UX_BP_CANON.md`.

## Playable loop (first 3–5 min)
1. Stand on **table_1** pad (FREE) → table appears
2. Stand on **grill_1** ($40) → pay while standing
3. Stand on **counter_1** ($50)
4. Cook → assemble → serve → clean; coins on floor after meal
5. Buy **table_2**; restaurant XP bar fills; missions reward cash
6. At restLv 2: **expand_hr** / **expand_player** pads unlock rooms

## No timed day fail
Endless session. Missions replace win/lose shifts.

## Run
```bash
cd burger-rush && npm install && npm run dev
```

## Key files
- `src/game/progress.ts` — pads/XP/missions/hire
- `src/game/save.ts` — migrate v1→v3
- `src/game/Game.ts` — pad buy, XP, HR/Player, missions
- `src/game/World3D.ts` — ~24×16 map, pads, barriers
- `src/i18n.ts` — UX canon keys
