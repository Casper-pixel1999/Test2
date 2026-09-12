/**
 * Yandex Games SDK wrapper with local mock when YaGames is missing.
 */
let ysdk = null;
let player = null;
let gameplayActive = false;

export function getSdk() {
  return ysdk;
}

export async function initYandex() {
  try {
    if (typeof YaGames !== 'undefined') {
      ysdk = await YaGames.init();
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (_) {
        player = null;
      }
      ysdk.on('game_api_pause', () => {
        window.dispatchEvent(new CustomEvent('yg-pause'));
      });
      ysdk.on('game_api_resume', () => {
        window.dispatchEvent(new CustomEvent('yg-resume'));
      });
      return { ysdk, player, mocked: false };
    }
  } catch (e) {
    console.warn('YaGames init failed, using mock', e);
  }
  ysdk = createMockSdk();
  player = null;
  return { ysdk, player, mocked: true };
}

function createMockSdk() {
  return {
    environment: { i18n: { lang: navigator.language || 'ru' } },
    features: {
      LoadingAPI: { ready() { console.log('[mock] LoadingAPI.ready'); } },
      GameplayAPI: {
        start() { console.log('[mock] GameplayAPI.start'); },
        stop() { console.log('[mock] GameplayAPI.stop'); },
      },
    },
    adv: {
      showRewardedVideo({ callbacks }) {
        console.log('[mock] rewarded video');
        setTimeout(() => {
          callbacks && callbacks.onOpen && callbacks.onOpen();
          setTimeout(() => {
            callbacks && callbacks.onRewarded && callbacks.onRewarded();
            callbacks && callbacks.onClose && callbacks.onClose(true);
          }, 400);
        }, 200);
      },
    },
    getPlayer() {
      return Promise.resolve({
        setData(data) {
          localStorage.setItem('burger_rush_cloud', JSON.stringify(data));
          return Promise.resolve();
        },
        getData() {
          try {
            return Promise.resolve(JSON.parse(localStorage.getItem('burger_rush_cloud') || '{}'));
          } catch {
            return Promise.resolve({});
          }
        },
      });
    },
    on() {},
  };
}

export function loadingReady() {
  try {
    ysdk?.features?.LoadingAPI?.ready();
  } catch (_) {}
}

export function gameplayStart() {
  if (gameplayActive) return;
  gameplayActive = true;
  try {
    ysdk?.features?.GameplayAPI?.start();
  } catch (_) {}
}

export function gameplayStop() {
  if (!gameplayActive) return;
  gameplayActive = false;
  try {
    ysdk?.features?.GameplayAPI?.stop();
  } catch (_) {}
}

export function detectLang(fallback = 'ru') {
  try {
    const l = ysdk?.environment?.i18n?.lang;
    if (l) return l;
  } catch (_) {}
  return fallback;
}

export function showRewarded() {
  return new Promise((resolve) => {
    if (!ysdk?.adv?.showRewardedVideo) {
      resolve(false);
      return;
    }
    let rewarded = false;
    try {
      ysdk.adv.showRewardedVideo({
        callbacks: {
          onOpen() { gameplayStop(); },
          onRewarded() { rewarded = true; },
          onClose() {
            gameplayStart();
            resolve(rewarded);
          },
          onError() {
            gameplayStart();
            resolve(false);
          },
        },
      });
    } catch (_) {
      gameplayStart();
      resolve(false);
    }
  });
}

export async function cloudSave(data) {
  try {
    if (!player) {
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (_) {
        return;
      }
    }
    if (player?.setData) await player.setData(data, true);
  } catch (e) {
    console.warn('cloudSave', e);
  }
}

export async function cloudLoad() {
  try {
    if (!player) {
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (_) {
        return null;
      }
    }
    if (player?.getData) return await player.getData();
  } catch (e) {
    console.warn('cloudLoad', e);
  }
  return null;
}
