import React from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, MapPin, Phone, Mail, FileText, ArrowLeft, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CompanyInfoView() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-100 via-slate-50 to-white text-left font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-xl w-full bg-white p-8 sm:p-12 rounded-[2.5rem] shadow-2xl border border-slate-200/60 relative overflow-hidden flex flex-col gap-8"
      >
        {/* Visual Premium Frame */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-teal-500 to-emerald-500" />
        
        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="px-3.5 py-1.5 bg-teal-550/10 border border-teal-500/20 text-teal-700 rounded-full text-[9px] font-black uppercase tracking-widest leading-none inline-flex items-center gap-1.5 shadow-sm">
              <ShieldCheck className="w-3.5 h-3.5" /> Verificado Pela ELIZA
            </span>
            <button 
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-600 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1 bg-transparent border-none cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight uppercase font-sans mt-2">
            Informações da Empresa
          </h1>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-normal">
            Dados para Verificações Empresariais e Credenciais da Plataforma
          </p>
        </div>

        {/* Content body */}
        <div className="space-y-6 divide-y divide-slate-105">
          {/* Platform name */}
          <div className="pt-2">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Plataforma</h2>
            <p className="text-sm font-black text-slate-800 uppercase tracking-normal">ELIZA Dental Platform</p>
          </div>

          {/* Legal Operator */}
          <div className="pt-5 space-y-1">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-slate-500" /> Razão Social / Operador
            </h2>
            <p className="text-sm font-bold text-slate-800">JANIO TEIXEIRA DA SILVA JUNIOR LTDA</p>
          </div>

          {/* CNPJ */}
          <div className="pt-5 space-y-1">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-500" /> Inscrição CNPJ
            </h2>
            <p className="text-sm font-mono font-black text-slate-800">37.421.772/0002-98</p>
          </div>

          {/* Address */}
          <div className="pt-5 space-y-2">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-500" /> Sede Oficial
            </h2>
            <div className="text-xs font-semibold text-slate-705 leading-relaxed space-y-0.5">
              <p>Avenida Padre José Daniel, 94</p>
              <p>Centro</p>
              <p>Vicentina – MS</p>
              <p className="font-mono font-bold text-slate-800">CEP 79710-000</p>
            </div>
          </div>

          {/* Contacts */}
          <div className="pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Phone className="w-3.5 h-3.5 text-slate-500" /> Telefone
              </h2>
              <p className="text-xs font-semibold text-slate-850">(67) 99633-0065</p>
            </div>
            <div className="space-y-1">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-slate-500" /> E-mail de Contato
              </h2>
              <p className="text-xs font-semibold text-slate-850">admin@elizaclinic.com.br</p>
            </div>
          </div>
        </div>

        {/* Footer info lock */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[9px] font-bold text-slate-405 uppercase tracking-wider">
          <span>© {new Date().getFullYear()} ELIZA Platform</span>
          <span>Todos os direitos reservados</span>
        </div>
      </motion.div>
    </div>
  );
}
