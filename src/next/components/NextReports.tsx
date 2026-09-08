import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart3, TrendingUp, TrendingDown, Users, Percent, Wallet, CalendarX,
  Loader2, RefreshCw, Sparkles, AlertTriangle, Download, CheckCircle2, Lightbulb
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { normalizeFinancialEntry } from '../../utils/financialHelpers';

interface AppointmentLite { date?: string; status?: string; }
interface CommissionRecordLite {
  id: string;
  professionalName: string;
  patientName: string | null;
  description: string;
  baseAmount: number;
  commissionAmount: number;
  status: string;
  createdAt?: any;
}

type ReportTab = 'dashboard' | 'professionals';
type Period = 'month' | 'last3' | 'all';

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

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NextReports() {
  const { clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [activeTab, setActiveTab] = useState<ReportTab>('dashboard');
  const [period, setPeriod] = useState<Period>('month');
  const [appointments, setAppointments] = useState<AppointmentLite[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<CommissionRecordLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [professionalFilter, setProfessionalFilter] = useState('all');

  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ summary: string; opportunities: string[]; risks: string[] } | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!clinic?.id) return;
      setLoading(true);
      try {
        const [apptsSnap, finSnap, commSnap] = await Promise.all([
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'appointments'), limit(2000)), 'appointments', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'financial_entries'), limit(3000)), 'financial_entries', { addAuditLog }),
          secureGetDocs(query(collection(db, 'clinics', clinic.id, 'commission_records'), limit(500)), 'commission_records', { addAuditLog }),
        ]);

        setAppointments(apptsSnap.docs.map(d => { const data: any = d.data(); return { date: data.date, status: data.status }; }));
        const normalized: any[] = [];
        finSnap.forEach(d => { const n = normalizeFinancialEntry({ id: d.id, ...d.data() }); if (n) normalized.push(n); });
        setEntries(normalized);
        setCommissions(commSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));

        addAuditLog({ collection: 'reports', action: 'QUERY', status: 'SUCCESS', details: 'Relatórios leram agenda, financeiro e comissões reais desta clínica.' });
      } catch (err) {
        console.error('Failed to load reports data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  const now = new Date();
  const inPeriod = (d: Date | null) => {
    if (!d) return false;
    if (period === 'all') return true;
    if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'last3') {
      const cutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      return d >= cutoff;
    }
    return true;
  };

  const kpis = useMemo(() => {
    const apptsInPeriod = appointments.filter(a => inPeriod(toDate(a.date)));
    const total = apptsInPeriod.length;
    const finalizados = apptsInPeriod.filter(a => a.status === 'finalizado').length;
    const cancelados = apptsInPeriod.filter(a => a.status === 'cancelado').length;
    const faltas = apptsInPeriod.filter(a => a.status === 'faltou').length;
    const base = total - cancelados;
    const conversionRate = base > 0 ? (finalizados / base) * 100 : 0;
    const absenceRate = total > 0 ? (faltas / total) * 100 : 0;

    const incomeInPeriod = entries.filter(e => e.type === 'income' && e.status !== 'cancelled' && inPeriod(toDate(e.paidAt) || toDate(e.dueDate)) && (e.status === 'paid' || e.status === 'partial'));
    const revenue = incomeInPeriod.reduce((sum, e) => sum + e.paidAmount, 0);
    const avgTicket = incomeInPeriod.length > 0 ? revenue / incomeInPeriod.length : 0;

    return { total, finalizados, conversionRate, absenceRate, revenue, avgTicket, count: incomeInPeriod.length };
  }, [appointments, entries, period]);

  const monthlyTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    entries.forEach(e => {
      if (e.type !== 'income' || (e.status !== 'paid' && e.status !== 'partial')) return;
      const d = toDate(e.paidAt) || toDate(e.dueDate);
      if (!d) return;
      const key = monthKey(d);
      buckets.set(key, (buckets.get(key) || 0) + e.paidAmount);
    });
    const months: { key: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(d);
      months.push({ key, label: d.toLocaleDateString('pt-BR', { month: 'short' }), value: buckets.get(key) || 0 });
    }
    const curr = months[months.length - 1].value;
    const prev = months[months.length - 2]?.value || 0;
    const delta = prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0);
    return { months, delta };
  }, [entries]);

  const categoryMix = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach(e => {
      if (e.type !== 'income' || (e.status !== 'paid' && e.status !== 'partial')) return;
      const d = toDate(e.paidAt) || toDate(e.dueDate);
      if (!inPeriod(d)) return;
      map.set(e.category || 'Geral', (map.get(e.category || 'Geral') || 0) + e.paidAmount);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [entries, period]);

  const professionals = useMemo(() => Array.from(new Set(commissions.map(c => c.professionalName))).sort(), [commissions]);

  const filteredCommissions = useMemo(() => {
    return commissions.filter(c => {
      const d = toDate(c.createdAt);
      if (!inPeriod(d)) return false;
      if (professionalFilter !== 'all' && c.professionalName !== professionalFilter) return false;
      return true;
    });
  }, [commissions, period, professionalFilter]);

  const productionByProfessional = useMemo(() => {
    const map = new Map<string, { professionalName: string; count: number; baseTotal: number; commissionTotal: number }>();
    filteredCommissions.forEach(c => {
      const curr = map.get(c.professionalName) || { professionalName: c.professionalName, count: 0, baseTotal: 0, commissionTotal: 0 };
      curr.count++;
      curr.baseTotal += c.baseAmount;
      curr.commissionTotal += c.commissionAmount;
      map.set(c.professionalName, curr);
    });
    return Array.from(map.values()).sort((a, b) => b.baseTotal - a.baseTotal);
  }, [filteredCommissions]);

  async function handleGenerateAiAnalysis() {
    setAiAnalyzing(true);
    setAiError(null);
    setAiResult(null);
    try {
      const categoryLines = categoryMix.map(([cat, val]) => `${cat}: ${formatCurrency(val)}`).join(', ') || 'sem dados de categoria no período';
      const prompt = `Você é a Eliza, analista de performance de uma clínica odontológica. Use SOMENTE os dados reais abaixo — nunca invente números.

Período analisado: ${period === 'month' ? 'este mês' : period === 'last3' ? 'últimos 3 meses' : 'todo o histórico'}
- Faturamento: ${formatCurrency(kpis.revenue)} (${kpis.count} recebimento(s))
- Ticket médio: ${formatCurrency(kpis.avgTicket)}
- Taxa de conversão de agendamentos: ${kpis.conversionRate.toFixed(1)}%
- Taxa de ausência (faltas): ${kpis.absenceRate.toFixed(1)}%
- Variação de faturamento vs mês anterior: ${monthlyTrend.delta.toFixed(1)}%
- Mix de faturamento por categoria: ${categoryLines}

Responda ESTRITAMENTE em JSON válido, sem markdown: {"summary":"resumo em 2-4 frases citando os números reais","opportunities":["oportunidade concreta 1"],"risks":["risco concreto 1"]}`;

      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        taskType: 'reports_analysis',
        clinicId: clinic?.id,
      });

      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente novamente.');
      const parsed = JSON.parse(jsonMatch[0]);
      setAiResult({
        summary: String(parsed.summary || ''),
        opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.map(String) : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      });
      addAuditLog({ collection: 'reports', action: 'WRITE', status: 'SUCCESS', details: 'Análise de performance (IA real) gerada a partir dos dados reais do período.' });
    } catch (err: any) {
      setAiError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setAiAnalyzing(false);
    }
  }

  function handleExportDashboard() {
    const rows: (string | number)[][] = [
      ['Indicador', 'Valor'],
      ['Faturamento', kpis.revenue.toFixed(2)],
      ['Ticket médio', kpis.avgTicket.toFixed(2)],
      ['Taxa de conversão (%)', kpis.conversionRate.toFixed(1)],
      ['Taxa de ausência (%)', kpis.absenceRate.toFixed(1)],
      ['Variação vs mês anterior (%)', monthlyTrend.delta.toFixed(1)],
      [],
      ['Categoria', 'Faturamento'],
      ...categoryMix.map(([cat, val]) => [cat, val.toFixed(2)]),
    ];
    downloadCsv(`relatorio-dashboard-${toDateInputValue(now)}.csv`, rows);
  }

  function handleExportProfessionals() {
    const rows: (string | number)[][] = [
      ['Profissional', 'Lançamentos', 'Produção', 'Comissão'],
      ...productionByProfessional.map(p => [p.professionalName, p.count, p.baseTotal.toFixed(2), p.commissionTotal.toFixed(2)]),
    ];
    downloadCsv(`relatorio-profissionais-${toDateInputValue(now)}.csv`, rows);
  }

  const maxTrendValue = Math.max(...monthlyTrend.months.map(m => m.value), 1);
  const maxCategoryValue = categoryMix.length > 0 ? categoryMix[0][1] : 1;

  return (
    <div className="space-y-6 max-w-6xl font-sans pb-24">
      <div className="relative overflow-hidden bg-gradient-to-br from-next-bg-card to-next-bg-deep border border-next-border rounded-next-2xl p-6 md:p-8 shadow-next-glass">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative space-y-3 z-10">
          <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
            <BarChart3 className="w-3.5 h-3.5 text-next-purple-neon" />
            <span>RELATÓRIOS</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">Performance da Clínica</h1>
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
            Indicadores calculados em tempo real a partir da agenda, do financeiro e das comissões reais desta clínica — sem tendências fixas no código.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveTab('dashboard')} className={`px-3 py-2 rounded-lg text-[11px] font-bold ${activeTab === 'dashboard' ? 'next-brand-gradient-bg text-white' : 'bg-slate-900/60 text-slate-400 border border-next-border'}`}>Dashboard de Performance</button>
          <button onClick={() => setActiveTab('professionals')} className={`px-3 py-2 rounded-lg text-[11px] font-bold ${activeTab === 'professionals' ? 'next-brand-gradient-bg text-white' : 'bg-slate-900/60 text-slate-400 border border-next-border'}`}>Produção por Profissional</button>
        </div>
        <div className="flex items-center gap-2">
          {(['month', 'last3', 'all'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1.5 rounded text-[11px] font-mono font-bold border ${period === p ? 'bg-next-purple-neon/15 border-next-purple-neon/40 text-next-purple-light' : 'bg-slate-900 border-next-border text-slate-500'}`}>
              {p === 'month' ? 'ESTE MÊS' : p === 'last3' ? 'ÚLTIMOS 3 MESES' : 'TUDO'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 font-mono text-xs text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />Carregando dados reais...</div>
      ) : activeTab === 'dashboard' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="next-glass-panel rounded-next-xl p-5">
              <span className="text-[10px] font-mono text-slate-500 font-bold uppercase flex items-center gap-1"><Wallet className="w-3 h-3" /> Faturamento</span>
              <h3 className="text-xl font-extrabold text-slate-100 font-mono mt-1">{formatCurrency(kpis.revenue)}</h3>
            </div>
            <div className="next-glass-panel rounded-next-xl p-5">
              <span className="text-[10px] font-mono text-slate-500 font-bold uppercase flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Ticket Médio</span>
              <h3 className="text-xl font-extrabold text-slate-100 font-mono mt-1">{formatCurrency(kpis.avgTicket)}</h3>
            </div>
            <div className="next-glass-panel rounded-next-xl p-5">
              <span className="text-[10px] font-mono text-slate-500 font-bold uppercase flex items-center gap-1"><Percent className="w-3 h-3" /> Conversão de Agenda</span>
              <h3 className="text-xl font-extrabold text-slate-100 font-mono mt-1">{kpis.conversionRate.toFixed(1)}%</h3>
            </div>
            <div className="next-glass-panel rounded-next-xl p-5">
              <span className="text-[10px] font-mono text-next-red-alert font-bold uppercase flex items-center gap-1"><CalendarX className="w-3 h-3" /> Taxa de Ausência</span>
              <h3 className="text-xl font-extrabold text-next-red-alert font-mono mt-1">{kpis.absenceRate.toFixed(1)}%</h3>
            </div>
          </div>

          <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-200">Faturamento — últimos 6 meses</h4>
              <span className={`text-[11px] font-mono font-bold flex items-center gap-1 ${monthlyTrend.delta >= 0 ? 'text-next-green-success' : 'text-next-red-alert'}`}>
                {monthlyTrend.delta >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {monthlyTrend.delta >= 0 ? '+' : ''}{monthlyTrend.delta.toFixed(1)}% vs mês anterior
              </span>
            </div>
            <div className="flex items-end gap-3 h-32">
              {monthlyTrend.months.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center gap-1.5">
                  <div className="w-full bg-slate-900 rounded-t-lg overflow-hidden flex items-end" style={{ height: '96px' }}>
                    <div className="w-full next-brand-gradient-bg rounded-t-lg transition-all" style={{ height: `${(m.value / maxTrendValue) * 100}%` }} />
                  </div>
                  <span className="text-[9.5px] text-slate-500 font-mono capitalize">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-slate-200">Mix de faturamento por categoria</h4>
            {categoryMix.length === 0 ? (
              <p className="text-[11px] text-slate-500">Nenhum recebimento registrado neste período.</p>
            ) : (
              <div className="space-y-2">
                {categoryMix.map(([cat, val]) => (
                  <div key={cat} className="space-y-1">
                    <div className="flex justify-between text-[11px] font-mono text-slate-400">
                      <span>{cat}</span>
                      <span className="text-slate-300 font-semibold">{formatCurrency(val)}</span>
                    </div>
                    <div className="w-full bg-slate-950 rounded-full h-1.5 border border-next-border/40 overflow-hidden">
                      <div className="bg-next-purple-neon h-full rounded-full" style={{ width: `${(val / maxCategoryValue) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Sparkles className="w-4 h-4 text-next-purple-neon" /> Análise da Eliza</h4>
              <button onClick={handleExportDashboard} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 border border-next-border text-slate-300 font-bold text-[10.5px] rounded-lg">
                <Download className="w-3 h-3" /> Exportar CSV
              </button>
            </div>
            <button
              onClick={handleGenerateAiAnalysis}
              disabled={aiAnalyzing}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50"
            >
              {aiAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{aiAnalyzing ? 'Analisando com a Eliza...' : 'Gerar análise com a Eliza (IA real)'}</span>
            </button>
            <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> IA real (OpenAI com fallback Gemini). Sem chave configurada, o erro aparece de verdade.</p>
            {aiError && <p className="text-[11px] text-next-red-alert">{aiError}</p>}
            {aiResult && (
              <div className="space-y-2.5 pt-2 border-t border-next-border">
                <p className="text-[11.5px] text-slate-300">{aiResult.summary}</p>
                {aiResult.opportunities.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono text-next-green-success uppercase flex items-center gap-1"><Lightbulb className="w-2.5 h-2.5" /> Oportunidades</span>
                    {aiResult.opportunities.map((o, i) => <p key={i} className="text-[10.5px] text-slate-300">• {o}</p>)}
                  </div>
                )}
                {aiResult.risks.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono text-next-red-alert uppercase flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Riscos</span>
                    {aiResult.risks.map((r, i) => <p key={i} className="text-[10.5px] text-slate-300">• {r}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <select value={professionalFilter} onChange={(e) => setProfessionalFilter(e.target.value)} className="bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2">
              <option value="all">Todos os profissionais</option>
              {professionals.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={handleExportProfessionals} className="inline-flex items-center gap-1.5 px-2.5 py-2 bg-slate-800 border border-next-border text-slate-300 font-bold text-[10.5px] rounded-lg">
              <Download className="w-3 h-3" /> Exportar CSV
            </button>
          </div>

          {productionByProfessional.length === 0 ? (
            <div className="next-glass-panel rounded-next-2xl p-10 text-center">
              <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Nenhuma comissão lançada neste período. Produção por profissional é calculada a partir dos registros reais da aba Comissões (Financeiro).</p>
            </div>
          ) : (
            <div className="space-y-2">
              {productionByProfessional.map(p => (
                <div key={p.professionalName} className="next-glass-panel rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-200">{p.professionalName}</p>
                      <p className="text-[10.5px] text-slate-500">{p.count} lançamento(s)</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono font-bold text-slate-200">{formatCurrency(p.baseTotal)}</p>
                      <p className="text-[10.5px] text-next-purple-light font-mono">comissão: {formatCurrency(p.commissionTotal)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-900 border border-next-border/60 rounded-xl p-4 flex items-start gap-3 text-[11px] text-slate-500 leading-relaxed font-mono">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <span>
          Somente leitura — nenhum dado é gravado aqui. Os indicadores vêm de agenda, financial_entries e commission_records reais desta clínica.
        </span>
      </div>
    </div>
  );
}

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
