import { initYandex, loadingReady, detectLang, gameplayStop, gameplayStart } from './yandex.js';
import { setLang, applyStaticUI, t } from './i18n.js';
import { Game } from './game.js';

const loadBar = document.getElementById('loadBar');
const loadText = document.getElementById('loadText');
const loading = document.getElementById('loading');

function setProgress(p, text) {
  if (loadBar) loadBar.style.width = `${Math.floor(p * 100)}%`;
  if (text && loadText) loadText.textContent = text;
}

async function boot() {

  // Yandex Games: no browser context menu / text selection in play area
  const blockCtx = (e) => e.preventDefault();
  document.addEventListener('contextmenu', blockCtx);
  document.addEventListener('selectstart', blockCtx);
  document.getElementById('app')?.addEventListener('contextmenu', blockCtx);

  setProgress(0.15, 'SDK…');
  const { mocked } = await initYandex();
  const lang = detectLang(navigator.language || 'ru');
  setLang(lang);
  applyStaticUI();
  setProgress(0.4, t('loading'));

  await new Promise((r) => setTimeout(r, 200));
  setProgress(0.7, t('loading'));

  const canvas = document.getElementById('game');
  const game = new Game(canvas);

  // UI buttons
  document.getElementById('btnShop')?.addEventListener('click', () => {
    applyStaticUI();
    game.openShop();
  });
  document.getElementById('btnCloseShop')?.addEventListener('click', () => game.closeShop());
  document.getElementById('btnReward')?.addEventListener('click', () => game.onReward());
  document.getElementById('btnLang')?.addEventListener('click', () => {
    const next = setLang(getOpposite(getCurrent()));
    applyStaticUI();
    document.getElementById('btnLang').textContent = next.toUpperCase();
    game.refreshShop();
    game.updateHUD();
  });

  function getCurrent() {
    return document.getElementById('btnLang')?.textContent?.toLowerCase() === 'en' ? 'en' : 'ru';
  }
  function getOpposite(l) {
    return l === 'ru' ? 'en' : 'ru';
  }

  // Pause / visibility
  window.addEventListener('yg-pause', () => game.setPaused(true));
  window.addEventListener('yg-resume', () => game.setPaused(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.setPaused(true);
      gameplayStop();
    } else {
      game.setPaused(false);
      gameplayStart();
    }
  });

  setProgress(1, t('loading'));
  await new Promise((r) => setTimeout(r, 150));

  loading?.classList.add('hidden');
  document.getElementById('hud')?.classList.remove('hidden');
  document.getElementById('joystick')?.classList.remove('hidden');

  loadingReady();
  game.start();

  if (mocked) console.info('[Бургерная] YaGames mocked locally');
  window.__burgerGame = game;
}

boot().catch((e) => {
  console.error(e);
  if (loadText) loadText.textContent = String(e);
});
