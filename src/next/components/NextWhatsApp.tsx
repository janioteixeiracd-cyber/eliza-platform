import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Lock,
  RefreshCw,
  Phone,
  Sliders,
  AlertTriangle,
  ExternalLink,
  CalendarClock,
  Wallet,
  UserX
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { normalizeFinancialEntry } from '../../utils/financialHelpers';

interface PatientLite { id: string; name: string; phone?: string; }
interface AppointmentLite { patientName: string; patientId?: string; date?: string; time?: string; treatment?: string; status?: string; }

type SignalCategory = 'confirmacao' | 'cobranca' | 'recall';

interface Signal {
  id: string;
  category: SignalCategory;
  patientId: string | null;
  patientName: string;
  phone?: string;
  detail: string;
  amount?: number;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  try {
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v?.seconds !== undefined) return new Date(v.seconds * 1000);
    const match = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function formatCurrency(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function waLink(phone?: string, text?: string): string | null {
  const clean = (phone || '').replace(/\D/g, '');
  if (!clean) return null;
  const number = clean.startsWith('55') ? clean : `55${clean}`;
  const base = `https://wa.me/${number}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

const CATEGORY_META: Record<SignalCategory, { label: string; icon: any; classes: string }> = {
  confirmacao: { label: 'Confirmação Pendente', icon: CalendarClock, classes: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  cobranca: { label: 'Cobrança em Aberto', icon: Wallet, classes: 'bg-next-red-alert/10 text-next-red-alert border-next-red-alert/20' },
  recall: { label: 'Retorno Recomendado', icon: UserX, classes: 'bg-next-purple-neon/10 text-next-purple-light border-next-purple-neon/20' },
};

export default function NextWhatsApp() {
  const { clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [appointments, setAppointments] = useState<AppointmentLite[]>([]);
  const [financialByPatient, setFinancialByPatient] = useState<Map<string, { name: string; amount: number }>>(new Map());
  const [loading, setLoading] = useState(true);

  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | SignalCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [draftText, setDraftText] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!clinic?.id) return;
      setLoading(true);
      try {
        const [patientsSnap, apptsSnap, finSnap] = await Promise.all([
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'patients'), limit(300)), 'patients', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'appointments'), limit(300)), 'appointments', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'financial_entries'), limit(300)), 'financial_entries', { addAuditLog }),
        ]);

        setPatients(patientsSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || 'Sem nome', phone: (d.data() as any).phone })));
        setAppointments(apptsSnap.docs.map(d => {
          const data: any = d.data();
          return { patientName: data.patientName || '', patientId: data.patientId, date: data.date, time: data.time, treatment: data.treatment, status: data.status };
        }));

        const now = new Date();
        const finMap = new Map<string, { name: string; amount: number }>();
        finSnap.forEach(d => {
          const n = normalizeFinancialEntry({ id: d.id, ...d.data() });
          if (!n || n.type !== 'income' || (n.status !== 'pending' && n.status !== 'partial') || !n.patientId) return;
          const dueD = toDate(n.dueDate);
          if (dueD && dueD < now && dueD.toDateString() !== now.toDateString()) {
            const existing = finMap.get(n.patientId) || { name: n.patientName || 'Paciente', amount: 0 };
            existing.amount += n.pendingAmount;
            finMap.set(n.patientId, existing);
          }
        });
        setFinancialByPatient(finMap);

        addAuditLog({
          collection: 'whatsapp_signals',
          action: 'QUERY',
          status: 'SUCCESS',
          details: 'Central de Comunicação mapeou pendências reais de agenda e financeiro.'
        });
      } catch (err) {
        console.error('Failed to load WhatsApp signals:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  const signals = useMemo<Signal[]>(() => {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const result: Signal[] = [];

    function findPatient(name: string, id?: string): PatientLite | undefined {
      if (id) { const byId = patients.find(p => p.id === id); if (byId) return byId; }
      return patients.find(p => p.name === name);
    }

    // Confirmação pendente
    appointments.forEach((a, idx) => {
      const d = toDate(a.date);
      if (a.status === 'pendente' && d && d >= now && d <= in7d) {
        const p = findPatient(a.patientName, a.patientId);
        result.push({
          id: `conf-${idx}`,
          category: 'confirmacao',
          patientId: p?.id || null,
          patientName: a.patientName,
          phone: p?.phone,
          detail: `${d.toLocaleDateString('pt-BR')} às ${a.time || '—'}${a.treatment ? ` · ${a.treatment}` : ''}`,
        });
      }
    });

    // Cobrança em aberto
    financialByPatient.forEach((info, patientId) => {
      const p = findPatient(info.name, patientId);
      result.push({
        id: `cob-${patientId}`,
        category: 'cobranca',
        patientId,
        patientName: info.name,
        phone: p?.phone,
        detail: `${formatCurrency(info.amount)} vencido(s)`,
        amount: info.amount,
      });
    });

    // Recall (sem retorno há +90 dias e sem agendamento futuro)
    const lastApptByPatient = new Map<string, Date>();
    const upcomingByPatient = new Set<string>();
    appointments.forEach(a => {
      const d = toDate(a.date);
      if (!d) return;
      if (d <= now) {
        const prev = lastApptByPatient.get(a.patientName);
        if (!prev || d > prev) lastApptByPatient.set(a.patientName, d);
      } else {
        upcomingByPatient.add(a.patientName);
      }
    });
    lastApptByPatient.forEach((d, name) => {
      if (upcomingByPatient.has(name)) return;
      const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (days > 90) {
        const p = findPatient(name);
        result.push({
          id: `recall-${name}`,
          category: 'recall',
          patientId: p?.id || null,
          patientName: name,
          phone: p?.phone,
          detail: `Última consulta há ${days} dias`,
        });
      }
    });

    return result;
  }, [appointments, financialByPatient, patients]);

  const selectedSignal = signals.find(s => s.id === selectedSignalId) || null;

  function handleSelectSignal(s: Signal) {
    setSelectedSignalId(s.id);
    setDraftText('');
    setDraftError(null);
  }

  async function handleGenerateDraft() {
    if (!selectedSignal) return;
    setDraftLoading(true);
    setDraftError(null);
    try {
      const catLabel = CATEGORY_META[selectedSignal.category].label;
      const prompt = `Você é a Eliza, assistente de relacionamento de uma clínica odontológica. Escreva uma mensagem curta de WhatsApp (2-4 frases, tom acolhedor e profissional, em português) para o paciente real abaixo.

Paciente: ${selectedSignal.patientName}
Motivo do contato: ${catLabel}
Detalhe real: ${selectedSignal.detail}

Responda ESTRITAMENTE em JSON válido, sem markdown: {"message":"texto da mensagem pronto para enviar"}`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'whatsapp_draft',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed = JSON.parse(jsonMatch[0]);
      setDraftText(String(parsed.message || ''));
      addAuditLog({ collection: 'whatsapp_signals', action: 'WRITE', status: 'SUCCESS', details: `Rascunho de mensagem (IA real) gerado para "${selectedSignal.patientName}".` });
    } catch (err: any) {
      setDraftError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setDraftLoading(false);
    }
  }

  const filteredSignals = signals.filter(s => {
    const matchesSearch = s.patientName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'all' ? true : s.category === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const counts = {
    confirmacao: signals.filter(s => s.category === 'confirmacao').length,
    cobranca: signals.filter(s => s.category === 'cobranca').length,
    recall: signals.filter(s => s.category === 'recall').length,
  };

  const link = selectedSignal ? waLink(selectedSignal.phone, draftText) : null;

  return (
    <div className="space-y-8 max-w-5xl font-sans pb-24">

      {/* 1. HERO HEADER */}
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6 z-10">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-emerald-400 text-[10.5px] font-mono tracking-wider">
              <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              <span>COMUNICAÇÃO INTELIGENTE</span>
            </div>

            <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">
              Central de Comunicação
            </h1>

            <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
              Pendências reais de agenda e financeiro desta clínica, com rascunho de mensagem gerado pela Eliza e
              envio pelo seu próprio WhatsApp — nada é disparado automaticamente.
            </p>
          </div>

          <div className="bg-slate-900/80 border border-next-border rounded-next-xl p-4 flex-shrink-0 flex flex-col space-y-1.5 md:min-w-[195px]">
            <span className="text-[10px] font-mono text-slate-500 font-bold uppercase">Status</span>
            <div className="flex items-center gap-1.5 text-next-green-success font-semibold text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-next-green-success animate-pulse" />
              <span>Pendências reais</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight font-mono">
              O envio acontece no seu WhatsApp — você revisa e aperta enviar.
            </p>
          </div>
        </div>
      </div>

      {/* 2. REAL COUNTERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {(Object.keys(CATEGORY_META) as SignalCategory[]).map(cat => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          return (
            <div
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`bg-next-bg-card border rounded-next-xl p-5 shadow-next-glass relative overflow-hidden group transition-all cursor-pointer ${
                activeFilter === cat ? 'border-next-purple-neon ring-1 ring-next-purple-neon/20' : 'border-next-border hover:border-next-border-glow'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-slate-500 font-bold uppercase tracking-wider">{meta.label}</span>
                  <h3 className="text-2xl font-extrabold text-slate-100 tracking-tight font-mono">{counts[cat]}</h3>
                </div>
                <span className={`p-2 rounded-lg text-xs font-mono font-bold border ${meta.classes}`}>
                  <Icon className="w-4 h-4" />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. BENTO: LIST vs DETAIL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

        <div className="lg:col-span-5 bg-next-bg-card border border-next-border rounded-next-2xl p-4 md:p-5 shadow-next-glass space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Pendências</h3>
              {activeFilter !== 'all' && (
                <button onClick={() => setActiveFilter('all')} className="text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors">
                  Limpar Filtros
                </button>
              )}
            </div>

            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                type="text"
                placeholder="Pesquisar paciente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-950 border border-next-border rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon w-full"
                style={{ minHeight: '38px' }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setActiveFilter('all')} className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-all ${activeFilter === 'all' ? 'bg-next-purple-neon/20 border border-next-purple-neon/40 text-next-purple-light' : 'bg-slate-950/60 border border-next-border text-slate-500 hover:text-slate-300'}`}>Todos</button>
            {(Object.keys(CATEGORY_META) as SignalCategory[]).map(cat => (
              <button key={cat} onClick={() => setActiveFilter(cat)} className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-all ${activeFilter === cat ? 'bg-next-purple-neon/20 border border-next-purple-neon/40 text-next-purple-light' : 'bg-slate-950/60 border border-next-border text-slate-500 hover:text-slate-300'}`}>{CATEGORY_META[cat].label}</button>
            ))}
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {loading ? (
              <div className="text-center py-12 font-mono text-xs text-slate-500 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto text-next-purple-neon" />
                <span>Lendo agenda e financeiro reais...</span>
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="border border-dashed border-next-border bg-slate-950/40 rounded-next-xl p-6 text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-next-border flex items-center justify-center text-slate-600 mx-auto">
                  <Sliders className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-slate-300">Nenhuma pendência encontrada</h4>
                  <p className="text-[10.5px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                    Nenhum paciente real desta clínica se encaixa neste filtro no momento.
                  </p>
                </div>
              </div>
            ) : (
              filteredSignals.map((s) => {
                const meta = CATEGORY_META[s.category];
                const Icon = meta.icon;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSignal(s)}
                    className={`p-3 rounded-next-xl transition-all border cursor-pointer ${
                      selectedSignalId === s.id ? 'bg-slate-900 border-next-purple-neon/60 shadow-next-glow-purple' : 'bg-slate-950/40 border-next-border/60 hover:border-next-border-glow'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-950 border border-next-border flex items-center justify-center text-[11px] font-bold font-mono text-next-purple-light flex-shrink-0">
                        {s.patientName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <h4 className="text-xs font-bold text-slate-200 truncate">{s.patientName}</h4>
                        <p className="text-[10.5px] text-slate-400 line-clamp-1">{s.detail}</p>
                        <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${meta.classes}`}>
                          <Icon className="w-2.5 h-2.5" /> {meta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          {selectedSignal ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-next-bg-card border border-next-border rounded-next-2xl p-5 md:p-6 shadow-next-glass space-y-5 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-48 h-48 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />

              <div className="flex justify-between items-center border-b border-next-border pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-950 border border-next-border flex items-center justify-center text-xs font-bold text-next-purple-light font-mono">
                    {selectedSignal.patientName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{selectedSignal.patientName}</h3>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                      <span>{selectedSignal.phone || 'sem telefone cadastrado'}</span>
                    </div>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border ${CATEGORY_META[selectedSignal.category].classes}`}>
                  {CATEGORY_META[selectedSignal.category].label}
                </span>
              </div>

              <div className="bg-slate-950/60 border border-next-border rounded-lg p-3 text-xs text-slate-300">
                {selectedSignal.detail}
              </div>

              <div className="bg-slate-950 rounded-xl border border-next-border p-4 space-y-3 relative">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-next-purple-light font-mono uppercase">
                  <Sparkles className="w-3.5 h-3.5 text-next-purple-neon" />
                  <span>Rascunho da Eliza (IA real)</span>
                </div>

                <button
                  onClick={handleGenerateDraft}
                  disabled={draftLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 bg-slate-800 border border-next-purple-neon/40 text-next-purple-light font-bold text-xs rounded-xl disabled:opacity-50"
                >
                  {draftLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{draftLoading ? 'Gerando rascunho...' : 'Gerar rascunho com a Eliza'}</span>
                </button>
                <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> IA real (OpenAI com fallback Gemini). Sem chave configurada, o erro aparece de verdade.</p>
                {draftError && <p className="text-[11px] text-next-red-alert">{draftError}</p>}

                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Gere um rascunho acima ou escreva sua própria mensagem..."
                  className="w-full bg-slate-900 border border-next-border rounded-lg p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-next-purple-neon leading-relaxed font-sans min-h-[90px]"
                />

                <div className="flex items-center gap-3 pt-1 justify-between">
                  <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-500" />
                    Você envia — nada é disparado por aqui
                  </span>

                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all min-h-[38px]"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Abrir no WhatsApp</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-[10.5px] text-slate-500 font-mono">Sem telefone cadastrado</span>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="bg-slate-900/30 border border-dashed border-next-border rounded-next-2xl p-12 text-center text-slate-500 text-xs leading-normal">
              <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <span>Selecione uma pendência ao lado para gerar um rascunho e abrir no WhatsApp.</span>
            </div>
          )}
        </div>

      </div>

      <div className="bg-slate-900 border border-next-border/60 rounded-xl p-4 flex items-start gap-3 text-[11px] text-slate-500 leading-relaxed font-mono">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <span>
          As pendências acima vêm de dados reais (agenda e financeiro desta clínica). O envio de mensagens depende de uma integração de mensageria própria (Twilio ou WhatsApp Cloud API) — por enquanto, o botão abre o WhatsApp Web/app com o texto pronto, e você decide se envia.
        </span>
      </div>

    </div>
  );
}
