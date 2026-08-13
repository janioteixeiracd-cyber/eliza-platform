import React from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, ArrowLeft, Lock, FileText, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicyView() {
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
            <span className="px-3.5 py-1.5 bg-emerald-55 border border-emerald-500/20 text-emerald-700 rounded-full text-[9px] font-black uppercase tracking-widest leading-none inline-flex items-center gap-1.5 shadow-sm">
              <Lock className="w-3.5 h-3.5" /> Segurança Máxima (LGPD)
            </span>
            <button 
              onClick={() => navigate('/')}
              className="text-slate-400 hover:text-slate-600 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-1 bg-transparent border-none cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight uppercase font-sans mt-2">
            Política de Privacidade
          </h1>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-normal">
            Compromisso com o sigilo, integridade e proteção de dados clínicos do paciente
          </p>
        </div>

        {/* Actual Content in Markdown style styled with Tailwind */}
        <div className="space-y-6 text-xs text-slate-600 leading-relaxed max-h-[450px] overflow-y-auto pr-2 border-r border-slate-100">
          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">1. Introdução</h2>
            <p>
              A <strong>ELIZA Dental Platform</strong> (operada por JANIO TEIXEIRA DA SILVA JUNIOR LTDA) valoriza o sigilo, a transparência e a integridade de todas as informações inseridas na plataforma. Em conformidade com a Lei Geral de Proteção de Dados (LGPD - nº 13.709/18), nossa política estabelece diretrizes rigorosas para o tratamento de dados pessoais de pacientes, profissionais de saúde e parceiros integrados.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">2. Coleta e Classificação de Dados</h2>
            <p>
              Coletamos informações essenciais para a coordenação clínica, agendamento de consultas e gerenciamento financeiro de clínicas odontológicas, incluindo:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Dados de Identificação:</strong> Nome completo, CPF, RG, data de nascimento e gênero.</li>
              <li><strong>Dados Sensíveis de Saúde:</strong> Anamnese clínica, histórico médico detalhado, fotografias cirúrgicas para planejamento, modelos de consentimento, diagnósticos e registros de evolução.</li>
              <li><strong>Informações de Contato:</strong> Número do celular (para disparos ativos de agendamento no WhatsApp se integrado), e-mail e endereço.</li>
              <li><strong>Dados Financeiros:</strong> Lançamentos e fechamentos parciais de caixa relativos ao custo e ao pagamento de tratamentos contratados pelo paciente.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">3. Uso das Informações</h2>
            <p>
              Todos os dados são coletados e armazenados exclusivamente com o intuito de viabilizar atendimentos clínicos de alta qualidade, otimizar fluxos de recall pós-operatório (HOF), realizar validações de consentimentos odontológicos, gerar relatórios estatísticos confidenciais, e enviar alertas de compromisso via WhatsApp ou SMS.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">4. Sigilo Médico e Prontuários</h2>
            <p>
              Garantimos sigilo profissional irrestrito às informações do prontuário eletrônico. Nossos desenvolvedores e os sistemas executados na nuvem processam esses dados de formato seguro com privilégios restritos (role-based access) aos profissionais habilitados na própria clínica. Não vendemos, cedemos ou licenciamos qualquer registro clínico ou pessoal para terceiros.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">5. Armazenamento e Criptografia</h2>
            <p>
              Utilizamos infraestrutura em nuvem segura e criptografias avançadas para proteger seus dados contra interceptação ou acessos não autorizados. Os backups do banco de dados são gerenciados automaticamente e submetidos a validações periódicas de integridade e escopo.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black text-slate-800 uppercase tracking-widest">6. Seus Direitos (LGPD)</h2>
            <p>
              A qualquer momento, o titular dos dados ou profissional credenciado poderá solicitar a confirmação do tratamento, a correção de dados incompletos ou inexatos, a portabilidade das informações clínicas, ou a revogação de seu consentimento, diretamente por meio do canal administrativo do sistema.
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
