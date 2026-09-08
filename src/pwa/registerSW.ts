import { pwaEvents } from './pwaEvents';

// Guards a single automatic reload when a new service worker takes control,
// so a stray extra 'controllerchange' event (some browsers fire it more
// than once in edge cases) can never trigger a reload loop.
let reloaded = false;

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  // Android/desktop Chrome: capture the native install prompt instead of
  // letting the browser show its own mini-infobar, so InstallElizaButton
  // can trigger it from a branded in-app entry point.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pwaEvents.setDeferredPrompt(event);
  });

  window.addEventListener('appinstalled', () => {
    pwaEvents.setInstalled(true);
    pwaEvents.clearDeferredPrompt();
  });

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;
  if (isStandalone) pwaEvents.setInstalled(true);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // A worker may already be sitting in 'waiting' from a previous visit
      // (e.g. this tab was opened right after a deploy landed).
      if (registration.waiting) {
        pwaEvents.setUpdateAvailable(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // A previous SW already controlled this page, so this is a
            // genuine update (not the very first install) — safe to
            // activate automatically since no clinical data ever lives in
            // the SW cache, only static assets and pre-visited HTML shells.
            pwaEvents.setUpdateAvailable(newWorker);
          }
        });
      });
    }).catch((err) => {
      console.error('[PWA] Service worker registration failed:', err);
    });

    let controllerChanged = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controllerChanged || reloaded) return;
      controllerChanged = true;
      reloaded = true;
      window.location.reload();
    });
  });
}
