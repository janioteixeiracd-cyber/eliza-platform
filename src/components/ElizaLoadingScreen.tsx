import React from 'react';

const ECG_PATH = 'M0,50 L30,50 L40,40 L50,50 L58,75 L66,8 L74,65 L85,50 L105,38 L120,50 L150,50 ' +
  'L180,50 L190,40 L200,50 L208,75 L216,8 L224,65 L235,50 L255,38 L270,50 L300,50 ' +
  'L330,50 L340,40 L350,50 L358,75 L366,8 L374,65 L385,50 L405,38 L420,50 L450,50 ' +
  'L480,50 L490,40 L500,50 L508,75 L516,8 L524,65 L535,50 L555,38 L570,50 L600,50';

// Full-screen "Eliza is alive" loading gate — a heartbeat pulse behind the
// mark plus a scanning ECG trace, replacing the old generic spinner. Used
// anywhere the app needs to block on auth/data before it can render.
export default function ElizaLoadingScreen({ message = 'Carregando...' }: { message?: string }) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center gap-8 px-6" style={{ background: '#07050c' }}>
      <div className="relative flex items-center justify-center w-32 h-32">
        <div
          className="eliza-heartbeat-glow absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.55) 0%, transparent 70%)' }}
        />
        <img
          src="/brand/eliza-mark.png"
          alt="Eliza"
          className="eliza-heartbeat-mark relative w-16 h-16 object-contain drop-shadow-[0_0_18px_rgba(139,92,246,0.55)]"
        />
      </div>

      <svg viewBox="0 0 600 100" className="w-64 sm:w-80 h-auto" preserveAspectRatio="xMidYMid meet">
        <path d={ECG_PATH} fill="none" stroke="#221c2e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d={ECG_PATH}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={600}
          className="eliza-ecg-trace"
          style={{ filter: 'drop-shadow(0 0 6px rgba(139,92,246,0.9))' }}
        />
      </svg>

      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.25em] text-center">{message}</p>
    </div>
  );
}
