import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react';
import { useWhatsAppEmbeddedSignup } from '../hooks/useWhatsAppEmbeddedSignup';

interface WhatsAppEmbeddedSignupButtonProps {
  /** Gate de owner/admin — decidido pelo componente pai (mesmo padrão
   * `isAdmin` já usado no resto de NextAdmin.tsx), nunca decidido aqui
   * sozinho. Um não-admin nunca vê nem o botão nem nenhum estado deste
   * componente. */
  canConnect: boolean;
  /** Chamado quando o fluxo termina com sucesso — o pai usa isso pra
   * re-buscar o doc de integração real e atualizar o resto da tela
   * (nenhum dado de conexão é lido/gravado por este componente). */
  onConnected?: () => void;
}

const STATE_LABEL: Record<string, string> = {
  preparing: 'Preparando conexão…',
  awaiting_meta: 'Aguardando confirmação na Meta…',
  connecting: 'Conectando…',
};

export function WhatsAppEmbeddedSignupButton({ canConnect, onConnected }: WhatsAppEmbeddedSignupButtonProps) {
  const { snapshot, start, reset, isConfigured } = useWhatsAppEmbeddedSignup();
  const busy = snapshot.status === 'preparing' || snapshot.status === 'awaiting_meta' || snapshot.status === 'connecting';

  const onConnectedRef = React.useRef(onConnected);
  onConnectedRef.current = onConnected;
  const notifiedRef = React.useRef(false);
  React.useEffect(() => {
    if (snapshot.status === 'completed' && !notifiedRef.current) {
      notifiedRef.current = true;
      onConnectedRef.current?.();
    }
    if (snapshot.status !== 'completed') notifiedRef.current = false;
  }, [snapshot.status]);

  if (!canConnect) return null;

  return (
    <div className="rounded-xl border border-next-border bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-next-purple-neon" />
        <h4 className="text-xs font-bold text-slate-200">Conectar WhatsApp (Embedded Signup)</h4>
      </div>
      <p className="text-[11px] text-slate-500">
        Conecta o WhatsApp Business que a clínica já usa no celular, sem tirar o app do ar (modo Coexistence oficial da Meta) — nunca migra ou desregistra o número atual.
      </p>

      {!isConfigured ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-amber-200">Conexão indisponível neste ambiente (configuração ausente). Contate o time técnico.</p>
        </div>
      ) : snapshot.status === 'completed' ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11.5px] text-emerald-200">
            <p className="font-bold">WhatsApp conectado com sucesso.</p>
            {snapshot.displayPhoneNumber && <p className="text-emerald-300/80 mt-0.5">Número: {snapshot.displayPhoneNumber}</p>}
          </div>
        </div>
      ) : snapshot.status === 'error' ? (
        <div className="flex items-start gap-2 rounded-lg border border-next-red-alert/20 bg-next-red-alert/10 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-next-red-alert flex-shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-red-200">{snapshot.errorMessage || 'Não foi possível concluir a conexão.'}</p>
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy || !isConfigured}
        onClick={() => { if (snapshot.status === 'error' || snapshot.status === 'completed') reset(); start(); }}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold next-brand-gradient-bg text-white disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {STATE_LABEL[snapshot.status] || 'Processando…'}
          </>
        ) : !isConfigured ? (
          'Indisponível'
        ) : snapshot.status === 'completed' ? (
          'Conectar outro número'
        ) : snapshot.status === 'error' ? (
          'Tentar novamente'
        ) : (
          'Conectar WhatsApp'
        )}
      </button>
    </div>
  );
}
