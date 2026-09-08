import { useEffect, useState, useCallback } from 'react';
import { pwaEvents } from './pwaEvents';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
}

export type InstallCapability = 'native' | 'ios-manual' | 'installed' | 'unavailable';

// Single hook driving every "Instalar ELIZA" entry point across the app
// (legacy header, Next sidebar, Portal shell). Android/desktop Chrome gets
// the real native prompt; iOS Safari has no such API, so it gets a
// capability flag telling the caller to show manual
// Compartilhar → Adicionar à Tela de Início instructions instead.
export function useInstallPrompt() {
  const [, forceRender] = useState(0);

  useEffect(() => pwaEvents.subscribe(() => forceRender((n) => n + 1)), []);

  const capability: InstallCapability = pwaEvents.installed
    ? 'installed'
    : pwaEvents.deferredPrompt
    ? 'native'
    : isIos() && isSafari()
    ? 'ios-manual'
    : 'unavailable';

  const promptInstall = useCallback(async () => {
    const event = pwaEvents.deferredPrompt;
    if (!event) return;
    event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') pwaEvents.setInstalled(true);
    pwaEvents.clearDeferredPrompt();
  }, []);

  return { capability, promptInstall };
}
