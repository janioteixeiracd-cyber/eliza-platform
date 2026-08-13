import React from "react";
import { 
  Sparkles, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  HelpCircle, 
  Calendar,
  ShieldAlert,
  Brain,
  RefreshCw,
  BarChart4
} from "lucide-react";
import { motion } from "motion/react";
import { ElizaStructuredResponse } from "../services/ElizaAIService";

interface ElizaPremiumCardProps {
  analysis: ElizaStructuredResponse | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
}

export default function ElizaPremiumCard({ analysis, isLoading, error, onRetry }: ElizaPremiumCardProps) {
  
  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-slate-950 to-slate-900 text-white rounded-[2rem] p-8 relative overflow-hidden shadow-2xl border border-slate-800/60 max-w-full">
        {/* Decorative ambient glowing grids */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-teal-500/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-amber-500/5 rounded-full blur-[60px] pointer-events-none" />

        <div className="relative flex flex-col items-center justify-center py-10 text-center">
          <div className="relative mb-6">
            <div className="w-16 h-16 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin flex items-center justify-center"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Brain className="w-6 h-6 text-teal-400 animate-pulse" />
            </div>
          </div>
          <h4 className="text-base font-bold text-slate-100 mb-1.5 tracking-tight">Sincronizando com a mente da ELIZA...</h4>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            Acelerando redes neurais para correlacionar finanças, estoques, desvios e histórico de agendamentos.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-slate-950 to-slate-900 border border-rose-500/20 text-white rounded-[2rem] p-8 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-48 h-48 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col items-center justify-center py-6 text-center">
          <div className="w-12 h-12 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-2xl flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-rose-400 animate-bounce" />
          </div>
          <h4 className="text-sm font-bold text-slate-100 mb-2">Interrupção no Fluxo de Inteligência</h4>
          <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-6">
            {error || "A ELIZA AI não conseguiu acessar o serviço de inteligência agora. Verifique a configuração da API."}
          </p>
          
          {onRetry && (
            <button 
              onClick={onRetry}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-600/20"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Tentar Novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const getRiskBadgeStyles = (level: string) => {
    switch (level) {
      case "Alto":
        return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
      case "Médio":
        return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
      default:
        return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-slate-950 hover:bg-slate-900/95 transition-all duration-300 text-white rounded-[2rem] p-6 lg:p-8 relative overflow-hidden shadow-2xl border border-slate-800/70"
    >
      {/* Glow Effects */}
      <div className="absolute top-0 right-0 w-[350px] h-[350px] bg-teal-500/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-amber-500/5 rounded-full blur-[80px] pointer-events-none" />

      {/* Header with Title & Badge */}
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-2xl">
            <Sparkles className="w-5 h-5 text-teal-400 animate-pulse" />
          </div>
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest text-teal-400 bg-teal-950 px-2 py-0.5 rounded border border-teal-500/20">MIND ENGINE</span>
            <h4 className="text-base font-bold text-slate-100 tracking-tight flex items-center gap-1.5 mt-0.5">
              Análise Inteligente da ELIZA
            </h4>
          </div>
        </div>

        {/* Confidence & Risk Badges */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end mr-2">
            <span className="text-[7px] font-bold text-slate-500 uppercase tracking-wider">Confiança IA</span>
            <span className="text-xs font-black text-slate-300">{(analysis.confidence * 100).toFixed(0)}%</span>
            <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
              <div 
                className="h-full bg-teal-400 rounded-full" 
                style={{ width: `${analysis.confidence * 100}%` }}
              />
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            <span className="text-[7px] font-bold text-slate-500 uppercase tracking-wider">Risco Identificado</span>
            <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider mt-0.5 ${getRiskBadgeStyles(analysis.riskLevel)}`}>
              {analysis.riskLevel}
            </span>
          </div>
        </div>
      </div>

      {/* Structured Content Grid */}
      <div className="relative space-y-6">
        
        {/* Summary Executive */}
        <div className="space-y-1.5">
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
            Resumo e Diagnóstico Operacional
          </p>
          <p className="text-xs font-medium text-slate-300 leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">
            {analysis.summary}
          </p>
        </div>

        {/* Discrepancy Analysis Details */}
        {analysis.discrepancyAnalysis && (
          <div className="space-y-1.5">
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
              <BarChart4 className="w-3.5 h-3.5 text-amber-400" />
              Análise de Inconsistências & Padrões
            </p>
            <p className="text-xs text-slate-300 leading-relaxed font-normal whitespace-pre-wrap">
              {analysis.discrepancyAnalysis}
            </p>
          </div>
        )}

        {/* Two Columns: Possible Causes vs. Recommendations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          
          {/* Causes Column */}
          {analysis.possibleCauses && analysis.possibleCauses.length > 0 && (
            <div className="space-y-2 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <h5 className="text-[9px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                Causas Prováveis
              </h5>
              <ul className="space-y-2">
                {analysis.possibleCauses.map((cause, i) => (
                  <li key={i} className="flex gap-2 items-start text-xs text-slate-300 leading-relaxed font-semibold">
                    <span className="w-1.5 h-1.5 bg-amber-450 rounded-full mt-1.5 shrink-0 bg-amber-400" />
                    <span>{cause}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations Column */}
          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div className="space-y-2 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
              <h5 className="text-[9px] font-black text-teal-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
                Recomendações Práticas
              </h5>
              <ul className="space-y-2">
                {analysis.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 items-start text-xs text-slate-300 leading-relaxed font-semibold">
                    <span className="w-1.5 h-1.5 bg-teal-450 rounded-full mt-1.5 shrink-0 bg-teal-450 bg-teal-400" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>

      </div>

      {/* Footer Meta Timestamp */}
      <div className="relative mt-6 pt-4 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span>Gerado em: {analysis.generatedAt || new Date().toLocaleString()}</span>
        </div>
        <div>
          <span>ELIZA ANALYTICS © {new Date().getFullYear()}</span>
        </div>
      </div>

    </motion.div>
  );
}
