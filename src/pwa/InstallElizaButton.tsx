import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useInstallPrompt } from './useInstallPrompt';

// Shared iOS "how to install" modal — Safari has no beforeinstallprompt API,
// so this is the only way to guide the user through Adicionar à Tela de
// Início. Exported standalone so custom install entry points (e.g. the
// mobile floating banner in AppLayout.tsx) can trigger the same modal
// instead of duplicating it.
//
// Rendered via a portal straight onto document.body: this button lives
// inside headers that sit in flex/scroll containers across very different
// shells (Next admin, the Patient Portal's own flex-column layout, etc.).
// A fixed-position child normally ignores ancestor layout, but real iOS
// Safari has a known quirk where `position: fixed` inside a non-trivial
// ancestor chain can render offset/clipped right after a scroll — reported
// live as "abre cortado no topo da tela" on a real phone in the Portal do
// Paciente. Portaling to <body> removes the ancestor chain entirely so the
// overlay is always positioned against the true viewport.
export function IosInstallSteps({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-100">Instalar ELIZA no iPhone</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ol className="space-y-3 text-xs text-slate-300">
          <li className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-next-purple-neon/20 text-next-purple-light text-[10px] font-black flex items-center justify-center mt-0.5">1</span>
            <span className="flex items-center gap-1.5 flex-wrap">Toque no ícone de compartilhar <Share className="w-3.5 h-3.5 inline text-next-purple-light" /> na barra do Safari.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-next-purple-neon/20 text-next-purple-light text-[10px] font-black flex items-center justify-center mt-0.5">2</span>
            <span className="flex items-center gap-1.5 flex-wrap">Escolha <SquarePlus className="w-3.5 h-3.5 inline text-next-purple-light" /> "Adicionar à Tela de Início".</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-next-purple-neon/20 text-next-purple-light text-[10px] font-black flex items-center justify-center mt-0.5">3</span>
            <span>Confirme em "Adicionar" — o ícone da ELIZA aparece na sua tela inicial, abrindo como um app.</span>
          </li>
        </ol>
      </div>
    </div>,
    document.body
  );
}

interface InstallElizaButtonProps {
  variant?: 'compact' | 'full';
  showLabel?: boolean;
  title?: string;
  className?: string;
}

// Renders nothing once installed or on browsers with no install path at all
// (e.g. Firefox desktop) — never shows a dead-end button.
export default function InstallElizaButton({ variant = 'compact', showLabel = true, title, className = '' }: InstallElizaButtonProps) {
  const { capability, promptInstall } = useInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);

  if (capability === 'installed' || capability === 'unavailable') return null;

  const label = variant === 'full' ? 'Instalar ELIZA no dispositivo' : 'Instalar ELIZA';

  const handleClick = () => {
    if (capability === 'native') promptInstall();
    else setShowIosSteps(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={title || label}
        className={
          className ||
          'inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-3 py-1.5 rounded-lg hover:bg-next-purple-neon/25 transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5" /> {showLabel && label}
      </button>

      {showIosSteps && <IosInstallSteps onClose={() => setShowIosSteps(false)} />}
    </>
  );
}
