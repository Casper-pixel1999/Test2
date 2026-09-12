# Бургерная (Burger Rush) — Three.js

Аркадно-idle игра про бургерный ресторан для **Яндекс Игр**.

Движок: **Three.js + Vite + TypeScript**. Изометрическая 3D-сцена (low-poly), без копирования IP Burger Please.

Цикл: гриль → котлеты → сборка бургеров → стойка → уборка столов → касса → улучшения / найм.

## Быстрый старт

```bash
cd burger-rush
npm install
npm run dev
```

Откройте URL Vite (обычно http://localhost:5173). Локально `/sdk.js` — заглушка; YaGames эмулируется.

## Сборка для Яндекс Игр

```bash
npm run build
cd dist && zip -r ../burger-rush-yandex.zip .
```

В консоли загрузите ZIP. Точка входа: `index.html`. Пути относительные (`base: './'`). На платформе Яндекс подставляет свой `/sdk.js`.

## Управление

- **Движение:** WASD / стрелки / виртуальный джойстик
- **Взаимодействие:** автоматически у станций; Space / E / tap
- **Магазин:** 🛒 — скорость, вместимость, прибыль, гриль, столы, официант, уборщик
- **Реклама:** 🎬 x2 — двойная прибыль 60 сек

## Yandex SDK

| Хук | Где |
|-----|-----|
| `/sdk.js` | `index.html` + `public/sdk.js` (локальная заглушка) |
| `YaGames.init` | `src/yandex.ts` |
| `LoadingAPI.ready` | `src/main.ts` |
| `GameplayAPI.start/stop` | пауза, магазин, реклама, visibility |
| `game_api_pause/resume` | `yandex.ts` → оверлей |
| `environment.i18n.lang` | RU/EN |
| Rewarded / fullscreen | кнопка x2; interstitial при закрытии магазина (~90 с) |
| `player.setData` + `localStorage` | сохранения |

## Структура

```
index.html
public/sdk.js
src/
  main.ts
  style.css
  i18n.ts
  yandex.ts
  game/
    Game.ts      # геймплей
    World3D.ts   # сцена Three.js
    meshes.ts    # low-poly меши
legacy/          # предыдущая canvas-версия
```

## Что нового vs canvas

- Перспективная изометрическая камера, цветные зоны пола
- Low-poly станции, столы, повар, клиенты, стопка над головой
- Тени, тёплый свет кухни, дым с гриля
- HTML-пузыри заказов и полированный HUD

## Известные ограничения

- Один уровень / одна комната (как в v1)
- Процедурные меши без внешних 3D-ассетов
- Нет звука / музыки
- Простая ИИ официанта и уборщика

## Лицензия

Оригинальный код и процедурные ассеты — для публикации владельцем репозитория на Яндекс Играх.
