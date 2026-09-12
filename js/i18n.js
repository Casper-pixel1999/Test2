/** RU / EN strings for Бургерная */
const STRINGS = {
  ru: {
    loading: 'Загрузка…',
    cash: '💰',
    shop: 'Улучшения',
    close: 'Закрыть',
    pause: 'Пауза',
    pauseHint: 'Игра на паузе',
    hintCook: 'Подойди к оранжевому ГРИЛЮ — котлеты начнут жариться',
    hintPick: 'Забери готовые котлеты с гриля',
    hintStack: 'Отнеси котлеты на жёлтый стол СБОРКИ',
    hintServe: 'Отнеси бургеры на зелёную СТОЙКУ',
    hintWait: 'Клиент ест у стола. Потом убери грязную посуду',
    hintClean: 'Подойди к грязному столу и убери тарелки',
    hintUpgrade: 'Открой магазин 🛒 и улучши ресторан',
    hintIdle: 'Готовь → собирай → подавай → убирай',
    buy: 'Купить',
    owned: 'Куплено',
    max: 'Макс.',
    speed: 'Скорость',
    speedDesc: 'Бегай быстрее',
    capacity: 'Вместимость',
    capacityDesc: 'Больше котлет и бургеров',
    profit: 'Прибыль',
    profitDesc: 'Больше денег за заказ',
    grillSpeed: 'Скорость гриля',
    grillSpeedDesc: 'Котлеты готовятся быстрее',
    table: 'Стол',
    tableDesc: 'Новый стол для клиентов',
    waiter: 'Официант',
    waiterDesc: 'Сам относит бургеры на стойку',
    cleaner: 'Уборщик',
    cleanerDesc: 'Сам убирает грязные столы',
    reward: 'x2 монеты',
    rewardOk: 'Двойная прибыль 60 сек!',
    rewardFail: 'Реклама недоступна',
    lvl: 'ур.',
    step: 'Шаг',
    zoneGrill: 'ГРИЛЬ',
    zonePrep: 'СБОРКА',
    zoneCounter: 'ВЫДАЧА',
    zoneTables: 'ЗАЛ',
    zoneTrash: 'МУСОР',
    promptInteract: 'E / нажми',
    dirtyLabel: 'ГРЯЗНО!',
    readyLabel: 'ГОТОВО',
  },
  en: {
    loading: 'Loading…',
    cash: '💰',
    shop: 'Upgrades',
    close: 'Close',
    pause: 'Pause',
    pauseHint: 'Game paused',
    hintCook: 'Walk to the orange GRILL — patties start cooking',
    hintPick: 'Pick up the cooked patties from the grill',
    hintStack: 'Take patties to the yellow ASSEMBLY table',
    hintServe: 'Deliver burgers to the green COUNTER',
    hintWait: 'The customer is eating. Then clear the dirty table',
    hintClean: 'Walk to the dirty table and clear the plates',
    hintUpgrade: 'Open the 🛒 shop and upgrade',
    hintIdle: 'Cook → assemble → serve → clean',
    buy: 'Buy',
    owned: 'Owned',
    max: 'Max',
    speed: 'Speed',
    speedDesc: 'Move faster',
    capacity: 'Capacity',
    capacityDesc: 'Carry more patties & burgers',
    profit: 'Profit',
    profitDesc: 'More cash per order',
    grillSpeed: 'Grill speed',
    grillSpeedDesc: 'Patties cook faster',
    table: 'Table',
    tableDesc: 'New customer table',
    waiter: 'Waiter',
    waiterDesc: 'Auto-delivers burgers to counter',
    cleaner: 'Cleaner',
    cleanerDesc: 'Auto-clears dirty tables',
    reward: 'x2 cash',
    rewardOk: 'Double profit for 60s!',
    rewardFail: 'Ad unavailable',
    lvl: 'lv.',
    step: 'Step',
    zoneGrill: 'GRILL',
    zonePrep: 'ASSEMBLY',
    zoneCounter: 'SERVE',
    zoneTables: 'TABLES',
    zoneTrash: 'TRASH',
    promptInteract: 'E / tap',
    dirtyLabel: 'DIRTY!',
    readyLabel: 'READY',
  },
};

let lang = 'ru';

export function setLang(code) {
  lang = code && String(code).toLowerCase().startsWith('en') ? 'en' : 'ru';
  return lang;
}

export function getLang() {
  return lang;
}

export function t(key) {
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ru[key] || key;
}

export function applyStaticUI() {
  const shopTitle = document.getElementById('shopTitle');
  const btnClose = document.getElementById('btnCloseShop');
  const pauseTitle = document.getElementById('pauseTitle');
  const pauseHint = document.getElementById('pauseHint');
  const loadText = document.getElementById('loadText');
  const btnLang = document.getElementById('btnLang');
  if (shopTitle) shopTitle.textContent = t('shop');
  if (btnClose) btnClose.textContent = t('close');
  if (pauseTitle) pauseTitle.textContent = t('pause');
  if (pauseHint) pauseHint.textContent = t('pauseHint');
  if (loadText) loadText.textContent = t('loading');
  if (btnLang) btnLang.textContent = lang.toUpperCase();
}
