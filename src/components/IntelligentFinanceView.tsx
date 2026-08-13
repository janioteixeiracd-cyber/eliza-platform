import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  AlertCircle, 
  Settings, 
  PieChart, 
  Calendar,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Brain,
  Plus
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import CommissionsView from './finance/CommissionsView';
import PayablesView from './finance/PayablesView';
import OverdueReceivablesView from './finance/OverdueReceivablesView';
import AIPlanningView from './finance/AIPlanningView';
import CommissionSettingsView from './finance/CommissionSettingsView';

type Tab = 'commissions' | 'payables' | 'overdue' | 'planning' | 'settings';

export default function IntelligentFinanceView() {
  const [activeTab, setActiveTab] = useState<Tab>('planning');
  const { clinic } = useAuth();

  useEffect(() => {
    console.log("[FINANCEIRO_INTELIGENTE_MOBILE_RENDER] Rendering Intelligent Finance view");
    console.log("[FINANCEIRO_INTELIGENTE_LAYOUT_SAFE] Mobile friendly layout initialized with tab:", activeTab);
  }, [activeTab]);

  const tabs = [
    { id: 'planning', label: 'Planejamento IA', icon: Brain, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { id: 'commissions', label: 'Comissões', icon: Users, color: 'text-teal-600', bg: 'bg-teal-50' },
    { id: 'payables', label: 'Contas a Pagar', icon: ArrowDownRight, color: 'text-rose-600', bg: 'bg-rose-50' },
    { id: 'overdue', label: 'Inadimplência', icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50' },
    { id: 'settings', label: 'Configurações', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-50' },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="min-h-[5rem] md:h-24 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between p-4 md:px-8 gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 shrink-0">
            <TrendingUp className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h1 className="text-sm md:text-xl font-black text-slate-900 tracking-tight leading-tight">Financeiro Inteligente</h1>
            <p className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Gestão de Comissões & Planejamento</p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center bg-slate-100 p-1 md:p-1.5 rounded-2xl gap-1 overflow-x-auto max-w-full w-full md:w-auto custom-scrollbar whitespace-nowrap scrollbar-none shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`
                flex items-center gap-2 px-3 py-2 md:px-4 md:py-2.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all shrink-0
                ${activeTab === tab.id 
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' 
                  : 'text-slate-500 hover:text-slate-700'}
              `}
            >
              <tab.icon className={`w-3.5 h-3.5 md:w-4 md:h-4 ${activeTab === tab.id ? tab.color : 'text-slate-400'}`} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-7xl mx-auto p-4 md:p-8 pb-32 md:pb-16">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              {activeTab === 'commissions' && <CommissionsView />}
              {activeTab === 'payables' && <PayablesView />}
              {activeTab === 'overdue' && <OverdueReceivablesView />}
              {activeTab === 'planning' && <AIPlanningView />}
              {activeTab === 'settings' && <CommissionSettingsView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
