import './style.css';
import { initYandex, loadingReady, detectLang, gameplayStop, gameplayStart } from './yandex';
import { setLang, applyStaticUI, t, getLang } from './i18n';
import { Game } from './game/Game';

const loadBar = document.getElementById('loadBar');
const loadText = document.getElementById('loadText');
const loading = document.getElementById('loading');

function setProgress(p: number, text?: string) {
  if (loadBar) loadBar.style.width = `${Math.floor(p * 100)}%`;
  if (text && loadText) loadText.textContent = text;
}

async function boot() {
  const blockCtx = (e: Event) => e.preventDefault();
  document.addEventListener('contextmenu', blockCtx);
  document.addEventListener('selectstart', blockCtx);
  document.getElementById('app')?.addEventListener('contextmenu', blockCtx);

  setProgress(0.15, 'SDK…');
  const { mocked } = await initYandex();
  const lang = detectLang(navigator.language || 'ru');
  setLang(lang);
  applyStaticUI();
  setProgress(0.35, t('loading'));

  await new Promise((r) => setTimeout(r, 50));
  setProgress(0.55, t('loading'));

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas);

  document.getElementById('btnShop')?.addEventListener('click', () => {
    applyStaticUI();
    game.openShop();
  });
  document.getElementById('btnCloseShop')?.addEventListener('click', () => game.closeShop());
  document.getElementById('btnReward')?.addEventListener('click', () => game.onReward());
  document.getElementById('btnMute')?.addEventListener('click', () => game.toggleMute());
  document.getElementById('btnLang')?.addEventListener('click', () => {
    const next = setLang(getLang() === 'ru' ? 'en' : 'ru');
    applyStaticUI();
    document.getElementById('btnLang')!.textContent = next.toUpperCase();
    game.world.refreshLabels();
    game.refreshShop();
    game.updateHUD();
  });

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
  await new Promise((r) => setTimeout(r, 100));

  loading?.classList.add('hidden');
  document.getElementById('hud')?.classList.remove('hidden');
  document.getElementById('joystick')?.classList.remove('hidden');

  loadingReady();
  game.start();

  if (mocked) console.info('[Бургерная] YaGames mocked locally');
  (window as any).__burgerGame = game;
}

boot().catch((e) => {
  console.error(e);
  if (loadText) loadText.textContent = String(e);
});
