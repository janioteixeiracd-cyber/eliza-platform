import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Sparkles, Check, Loader2, ExternalLink, ShieldCheck, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, auth } from '../lib/firebase';
import { PLAN_ROLE_LABELS, type PlanRole } from '../lib/planCapabilities';

interface Plan {
  id: string;
  name: string;
  planRole: PlanRole;
  regularPriceCents: number;
  founderPriceCents: number | null;
  description?: string;
  salesEnabled: boolean;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Cadastro → Checkout: renders once someone is authenticated but hasn't
// completed payment yet (AppLayout.tsx's new gate — see the comment there).
// No clinic exists at this point; the eventual clinic gets created only
// AFTER payment confirms, in OnboardingView, per the user's explicit choice
// of "cadastro → pagamento → só depois criação da clínica".
export default function CheckoutView() {
  const { user, signup, logout } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'platform_plans'), where('active', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Plan)).sort((a, b) => a.regularPriceCents - b.regularPriceCents);
      setPlans(list);
      setLoadingPlans(false);
      if (!selectedPlanId) {
        const firstSellable = list.find(p => p.salesEnabled);
        if (firstSellable) setSelectedPlanId(firstSellable.id);
      }
    }, () => setLoadingPlans(false));
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubscribe = async () => {
    if (!selectedPlanId) { setError('Escolha uma modalidade.'); return; }
    if (!phone.trim() || !cpfCnpj.trim()) { setError('Preencha telefone e CPF/CNPJ — o Asaas exige isso pra emitir a cobrança.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/checkout/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ planId: selectedPlanId, phone: phone.trim(), cpfCnpj: cpfCnpj.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.checkoutUrl) throw new Error(data.error || 'Falha ao iniciar o pagamento.');
      // New tab, not a full navigation — losing this tab would strand the
      // user away from the app while Asaas's checkout page loads. The
      // "aguardando confirmação" screen below (driven by signup.status via
      // onSnapshot) already assumed this and offers its own "Reabrir
      // pagamento" link, so this was the one missing piece.
      window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'Falha ao iniciar o pagamento.');
      setSubmitting(false);
    }
  };

  const isWaitingForPayment = signup?.status === 'payment_processing' && signup?.asaasCheckoutUrl;

  return (
    <div className="h-dvh overflow-y-auto bg-next-bg-deep flex items-center justify-center p-6 font-sans" style={{ background: 'var(--color-next-bg-deep)', height: 'var(--app-vh, 100dvh)' }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 65%)' }} />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/5 border border-next-border rounded-full mb-6">
            <Sparkles className="w-3.5 h-3.5 text-next-purple-neon" />
            <span className="text-[10px] font-bold text-next-purple-light uppercase tracking-widest">Contrate a ELIZA</span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight mb-1.5">Escolha sua modalidade</h2>
          <p className="text-slate-400 text-sm font-medium">Falta só o pagamento pra liberar a criação da sua clínica.</p>
        </div>

        {isWaitingForPayment ? (
          <div className="next-glass-panel rounded-next-2xl p-8 text-center space-y-5 max-w-md mx-auto">
            <Loader2 className="w-8 h-8 text-next-purple-neon animate-spin mx-auto" />
            <div>
              <h3 className="text-base font-black text-white">Aguardando confirmação do pagamento</h3>
              <p className="text-xs text-slate-400 mt-2">Assim que o Asaas confirmar, esta tela libera sozinha o próximo passo — não precisa recarregar.</p>
            </div>
            <a
              href={signup!.asaasCheckoutUrl!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 next-brand-gradient-bg text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-next-glow-purple"
            >
              <ExternalLink className="w-4 h-4" /> Reabrir pagamento
            </a>
            <button onClick={() => window.location.reload()} className="w-full flex items-center justify-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-300">
              <RefreshCw className="w-3.5 h-3.5" /> Já paguei, verificar novamente
            </button>
          </div>
        ) : (
          <div className="next-glass-panel rounded-next-2xl p-7 space-y-6">
            {loadingPlans ? (
              <div className="py-12 flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map(plan => {
                  const disabled = !plan.salesEnabled;
                  const selected = selectedPlanId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`text-left p-4 rounded-2xl border transition-all relative ${
                        disabled ? 'bg-slate-900/40 border-next-border opacity-50 cursor-not-allowed' :
                        selected ? 'bg-next-purple-neon/10 border-next-purple-neon shadow-next-glow-purple' : 'bg-slate-900 border-next-border hover:border-next-purple-neon/40'
                      }`}
                    >
                      {selected && !disabled && <Check className="w-4 h-4 text-next-purple-neon absolute top-3 right-3" />}
                      {disabled && <span className="absolute top-3 right-3 text-[8px] font-black uppercase text-amber-400">Em breve</span>}
                      <p className="text-xs font-black text-white uppercase tracking-tight">{PLAN_ROLE_LABELS[plan.planRole] || plan.name}</p>
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed h-8 overflow-hidden">{plan.description}</p>
                      {plan.founderPriceCents != null ? (
                        <div className="mt-2">
                          <p className="text-base font-black text-next-purple-light">{formatCents(plan.founderPriceCents)}<span className="text-[9px] text-slate-500 font-bold">/mês</span></p>
                          <p className="text-[9px] text-slate-500 line-through">{formatCents(plan.regularPriceCents)}/mês</p>
                        </div>
                      ) : (
                        <p className="text-base font-black text-white mt-2">{formatCents(plan.regularPriceCents)}<span className="text-[9px] text-slate-500 font-bold">/mês</span></p>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="text-[9.5px] text-slate-500 text-center">Valor de lançamento preservado por 12 meses se ainda houver vaga entre as 150 clínicas fundadoras — aplicado automaticamente no checkout.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-next-border">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Telefone / WhatsApp</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" className="w-full px-4 py-3 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">CPF ou CNPJ</label>
                <input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} placeholder="Necessário pro Asaas emitir a cobrança" className="w-full px-4 py-3 bg-slate-900 border border-next-border rounded-2xl text-sm font-semibold text-slate-100 outline-none focus:ring-2 focus:ring-next-purple-neon/25 focus:border-next-purple-neon transition-all" />
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 bg-next-red-alert/10 border border-next-red-alert/25 rounded-xl text-[10px] font-bold text-next-red-alert uppercase tracking-widest text-center">{error}</div>
            )}

            <button
              onClick={handleSubscribe}
              disabled={submitting || loadingPlans}
              className="w-full py-4 next-brand-gradient-bg text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-next-glow-purple hover:scale-[1.01] active:scale-[0.99] transition-transform disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? 'Preparando pagamento...' : 'Ir para o pagamento'}
            </button>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-slate-600">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Pagamento processado pelo Asaas</span>
        </div>

        <div className="mt-4 text-center">
          <button onClick={() => logout()} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-300">
            <LogOut className="w-3.5 h-3.5" /> Sair ({user?.email})
          </button>
        </div>
      </motion.div>
    </div>
  );
}
