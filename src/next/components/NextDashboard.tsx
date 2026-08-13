import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  ShieldCheck,
  Layers,
  Database,
  Terminal,
  Gauge,
  LockIcon,
  HardDrive,
  CheckCircle2,
  Info
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function NextDashboard() {
  const { clinic } = useAuth();
  const { auditLogs } = useNextReadOnly();
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Load basic historical count to verify read performance
  useEffect(() => {
    async function loadStats() {
      if (!clinic?.id) return;
      try {
        setLoadingStats(true);
        const q = query(
          collection(db, 'clinics', clinic.id, 'patients'),
          limit(50) // safe read limit
        );
        // Note: we fetch and verify via secureGetDocs to record an audit log!
        const snap = await secureGetDocs(q, 'patients');
        setPatientCount(snap.size);
      } catch (e) {
        console.warn('Dashboard failed to retrieve sandbox statistics safely:', e);
      } finally {
        setLoadingStats(false);
      }
    }
    loadStats();
  }, [clinic?.id]);

  return (
    <div className="space-y-8 font-sans max-w-6xl">
      
      {/* Intro Hero with Architectural Shield */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-900/60 border border-slate-800 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full text-emerald-400 text-xs font-mono">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Operacional — gravação real ativa</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-100 tracking-tight">
            Arquitetura ELIZA NEXT 2.0
          </h2>
          <p className="text-slate-400 text-sm md:text-base max-w-2xl leading-relaxed">
            O NEXT roda no mesmo roteador isolado (<code className="text-slate-300">/next/*</code>) e na mesma
            base Firestore do app legado, sem colidir com ele. Diferente da fase inicial, os módulos
            (Agenda, Prontuário, Financeiro, Estoque, Painel Admin, Eliza Academy e Relatórios) já
            gravam dados reais — não é mais um sandbox somente-leitura.
          </p>
        </div>
        <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/20 flex-shrink-0">
          <Layers className="w-9 h-9" />
        </div>
      </div>

      {/* Connection & Security Telemetry Indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Write Status */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-slate-500">GRAVAÇÃO_REAL</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono text-emerald-400">ATIVA</p>
            <p className="text-xs text-slate-400 mt-1">Agenda, Prontuário, Financeiro, Estoque, Admin e Academy gravam de verdade.</p>
          </div>
        </div>

        {/* Database Target */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-slate-500">DATABASE_TARGET</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono text-slate-100 truncate">(default)</p>
            <p className="text-xs text-slate-400 mt-1">Lendo e gravando no mesmo Firestore do app legado.</p>
          </div>
        </div>

        {/* Read Telemetry */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-slate-500">LEITURAS_AUDITADAS</span>
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono text-slate-100">
              {loadingStats ? '...' : (patientCount !== null ? `${patientCount} pacs` : 'Indisponível')}
            </p>
            <p className="text-xs text-slate-400 mt-1">Pacientes lidos nesta clínica (com auditoria).</p>
          </div>
        </div>

        {/* Audited Logs */}
        <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-slate-500">AUDIT_EVENTS</span>
            <Terminal className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold font-mono text-slate-100">{auditLogs.length}</p>
            <p className="text-xs text-slate-400 mt-1">Operações registradas no Trail.</p>
          </div>
        </div>

      </div>

      {/* Sprint 1 Architectural Overview (Bento Box style) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Core Architecture Block */}
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-emerald-400" />
            <span>Arquitetura & Segurança</span>
          </h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Pilares que sustentam o NEXT hoje, com todos os módulos operacionais gravando dados reais.
          </p>

          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-400 text-xs font-mono font-bold mt-0.5">1</div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Roteador Isolado (/next/*)</h4>
                <p className="text-xs text-slate-400 mt-0.5">Roteamento autônomo. O aplicativo tradicional e o NEXT coexistem sem qualquer colisão de caminhos.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-400 text-xs font-mono font-bold mt-0.5">2</div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Camada de Leitura Auditada</h4>
                <p className="text-xs text-slate-400 mt-0.5">Leituras passam por `next-db` (`secureGetDoc`/`secureGetDocs`), que registra cada consulta no Audit Trail. Gravações usam o SDK do Firestore direto, protegidas pelas regras reais de segurança (`firestore.rules`).</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 bg-emerald-500/10 rounded-lg flex items-center justify-center text-emerald-400 text-xs font-mono font-bold mt-0.5">3</div>
              <div>
                <h4 className="text-sm font-semibold text-slate-200">Rastreabilidade (Audit Trail)</h4>
                <p className="text-xs text-slate-400 mt-0.5">Cada leitura ou consulta realizada dentro do NEXT gera telemetria em tempo real, visível na aba Audit Trail.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Security Rule Assurance & Policy Block */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <LockIcon className="w-5 h-5 text-amber-500" />
              <span>Garantias de Isolamento</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              O ecossistema ELIZA NEXT 2.0 foi desenhado de forma que o código legado nunca seja impactado.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Zero alteração na UI antiga</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Zero impacto em agendamentos</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Compartilha mesma Auth atual</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span>Rastreabilidade em tempo real</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 font-mono leading-normal">
              PROJETO: elisa-494703<br/>
              CONTEXTO: ai-studio-14f59fa8<br/>
              ESTADO: Operacional — gravação real ativa
            </p>
          </div>
        </div>

      </div>

      {/* Tech Warning Info Card */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex gap-3 text-sm text-blue-400">
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block mb-0.5">Nota Técnica</span>
          Este painel foi estruturado sem alterar uma única linha de código funcional do app legado. Todas as dependências e o motor de autenticação foram isolados no escopo do roteador de desenvolvimento.
        </div>
      </div>

    </div>
  );
}
