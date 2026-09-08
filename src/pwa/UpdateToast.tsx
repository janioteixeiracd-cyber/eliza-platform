import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { pwaEvents } from './pwaEvents';

// Mounted once at the app root (App.tsx), so it covers the legacy app,
// /next, and /portal alike. When a new deployed version is detected, this
// activates it automatically and reloads — safe to do without asking,
// since the service worker never caches clinical/API data, only static
// assets and previously-visited HTML shells. The toast exists purely so
// the reload doesn't feel like an unexplained glitch.
export default function UpdateToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return pwaEvents.subscribe(() => {
      if (pwaEvents.updateAvailable && !visible) {
        setVisible(true);
        pwaEvents.activateWaitingWorker();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 bg-slate-900 border border-next-purple-neon/40 text-slate-100 text-xs font-semibold px-4 py-2.5 rounded-full shadow-next-glow-purple"
      style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
    >
      <RefreshCw className="w-3.5 h-3.5 text-next-purple-light animate-spin" />
      Nova versão disponível — atualizando...
    </div>
  );
}
