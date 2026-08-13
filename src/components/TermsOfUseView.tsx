import React from 'react';
import { motion } from 'motion/react';
import { FileText, ArrowLeft, CheckCircle, Scale } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsOfUseView() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center py-12 px-6 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-100 via-slate-50 to-white text-left font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-3xl w-full bg-white p-8 sm:p-12 rounded-[2.5rem] shadow-2xl border border-slate-200/60 relative overflow-hidden flex flex-col gap-8"
      >
        {/* Decorative border */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-teal-500 to-emerald-500" />

        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="px-3.5 py-1.5 bg-emerald-55 border border-emerald-55 text-teal-700 rounded-full text-[9px] font-black uppercase tracking-widest leading-none inline-flex items-center gap-1.5 shadow-sm">
              <Scale className="w-3.5 h-3.5" /> Termos Legais
            </span>
            <button 
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-600 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1 bg-transparent border-none cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight uppercase font-sans mt-2">
            Termos de Uso do Sistema
          </h1>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-normal">
            Termos e condições contratuais para licenciamento de uso do software ELIZA
          </p>
        </div>

        {/* Content Container */}
        <div className="space-y-6 text-xs text-slate-600 leading-relaxed max-h-[450px] overflow-y-auto pr-2 border-r border-slate-100">
          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">1. Aceitação dos Termos</h2>
            <p>
              Ao utilizar a plataforma <strong>ELIZA Dental Platform</strong>, você concorda expressamente em cumprir todos os termos descritos abaixo. Se você não concordar com qualquer termo ou condição, fica vedado o uso ou acesso continuado a qualquer módulo desta plataforma.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">2. Licenciamento de Uso do Software</h2>
            <p>
              A <strong>ELIZA Dental Platform</strong> concede ao licenciado e à sua equipe credenciada uma licença individual, revogável, não-exclusiva e de escopo restrito para utilizar o software para agendamento, prontuários de pacientes, fechamento de caixa, acadêmico (ELIZA Education) e ferramentas de relacionamento integradas.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">3. Uso de Mensageria e APIs de Terceiros</h2>
            <p>
              A integração da Elizabeth (ELIZA) com serviços externos, tais como a API do WhatsApp ou plataformas de processamento financeiro, requer conexão autorizada. A estabilidade das APIs externas é determinada pelos seus respectivos provedores. O uso inadequado da ferramenta de disparo automático para spam ou assédio de pacientes é de inteira responsabilidade civil e administrativa do licenciado.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">4. Responsabilidade Pelos Dados Clínicos</h2>
            <p>
              O cirurgião-dentista, profissional assistencial ou proprietário da clínica é o único responsável legal pela fidelidade e manutenção do prontuário médico de seus pacientes (conforme exigências do Conselho Federal de Odontologia). A plataforma atua de forma secundária como custodiadora técnica dos registros inseridos.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">5. Tarifas, Planos e Pagamentos</h2>
            <p>
              Os valores, limites de cota ativa de disparos, acesso acadêmico premium e taxas do sistema são regidos pelo plano de inscrição assinado correspondente. A omissão ou falta de pagamento ensejará suspensão temporária dos serviços após o período de carência legal aplicável.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">6. Limitação de Responsabilidade</h2>
            <p>
              Sob nenhuma circunstância a ELIZA (ou sua operadora legal JANIO TEIXEIRA DA SILVA JUNIOR LTDA) será responsabilizada por lucros cessantes, perdas financeiras ou danos imprevistos decorrentes da suspensão temporária do servidor para atualizações estruturais agendadas.
            </p>
          </section>
        </div>

        {/* Closing details */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between text-[9px] font-bold text-slate-405 uppercase tracking-wider gap-2">
          <span className="flex items-center gap-1 text-teal-650"><CheckCircle className="w-3.5 h-3.5 text-emerald-500 inline" /> Versão Atualizada: Junho, 2026</span>
          <span>© {new Date().getFullYear()} ELIZA Dental</span>
        </div>
      </motion.div>
    </div>
  );
}
