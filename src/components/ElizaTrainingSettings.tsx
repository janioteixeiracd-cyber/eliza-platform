import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Save, 
  Building2, 
  MapPin, 
  Clock, 
  Users, 
  Stethoscope, 
  CheckCircle, 
  AlertTriangle, 
  MessageSquare, 
  Volume2, 
  ShieldAlert, 
  Eye, 
  Loader2,
  Lock
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface ElizaTrainingSettingsProps {
  clinic: {
    id: string;
    [key: string]: any;
  };
}

export default function ElizaTrainingSettings({ clinic }: ElizaTrainingSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // State for all training fields
  const [config, setConfig] = useState({
    clinicName: '',
    address: '',
    hours: '',
    professionals: '',
    procedures: '',
    confirmationPolicy: '',
    cancellationPolicy: '',
    welcomeMessage: '',
    confirmationMessage: '',
    followUpMessage: '',
    toneOfVoice: '',
    forbiddenResponses: '',
    operationalMode: 'sugestao' as 'sugestao' | 'semi_automatico' | 'automatico',
    humanApprovalRequired: true,
  });

  // Load config on mount
  useEffect(() => {
    if (!clinic?.id) return;

    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'clinics', clinic.id, 'eliza_training', 'config');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          setConfig(prev => ({
            ...prev,
            ...data,
            // Guard values to make sure everything has a fallback
            clinicName: data.clinicName || clinic.name || '',
            address: data.address || clinic.address || '',
            hours: data.hours || (clinic.hours ? `${clinic.hours.weekday} / ${clinic.hours.saturday}` : ''),
            operationalMode: data.operationalMode || 'sugestao'
          }));
        } else {
          // Initialize with default fallback values
          setConfig(prev => ({
            ...prev,
            clinicName: clinic.name || 'Minha Clínica',
            address: clinic.address || 'Endereço da Clínica',
            hours: clinic.hours ? `Seg-Sex: ${clinic.hours.weekday} | Sáb: ${clinic.hours.saturday}` : 'Seg-Sex: 08:00 - 18:00',
            welcomeMessage: 'Olá! Seja muito bem-vindo(a) à nossa clínica. Como posso ajudar você hoje?',
            confirmationMessage: 'Olá! Passando para confirmar seu horário amanhã às [HORA]. Podemos confirmar?',
            followUpMessage: 'Olá! Como você está se sentindo após o seu procedimento? Qualquer dúvida, estamos aqui.',
            toneOfVoice: 'Cordial, acolhedor, profissional, elegante, seguro, atencioso e persuasivo com moderação.',
            forbiddenResponses: 'Não prometer diagnósticos médicos, não prescrever tratamentos/medicamentos, não fechar valores de procedimentos complexos sem avaliação prévia.',
            operationalMode: 'sugestao',
            humanApprovalRequired: true
          }));
        }
      } catch (err) {
        console.error('[ELIZA_TRAINING] Error loading training config:', err);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [clinic?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    
    setSaveLoading(true);
    setSaveSuccess(false);
    try {
      const docRef = doc(db, 'clinics', clinic.id, 'eliza_training', 'config');
      await setDoc(docRef, {
        ...config,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[ELIZA_TRAINING] Error saving training config:', err);
      alert('Erro ao salvar as configurações de treinamento.');
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-2">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Carregando conhecimento de IA...</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      {/* Header Banner */}
      <section className="bg-slate-900 border border-slate-800 text-white rounded-[2rem] p-8 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-5 blur-sm">
          <Sparkles className="w-96 h-96 text-teal-400" />
        </div>
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-teal-500/20 to-teal-400/10 border border-teal-500/25 px-4 py-1.5 rounded-full text-xs font-semibold text-teal-400">
            <Sparkles className="w-3.5 h-3.5" /> Base de Conhecimento e Treinamento da ELIZA
          </div>
          <h3 className="text-2xl mt-2 font-bold tracking-tight">Treine sua Secretária Virtual</h3>
          <p className="text-xs text-slate-300 leading-relaxed font-semibold">
            Defina as regras de negócios, políticas, procedimentos e a voz da ELIZA. Quanto mais detalhado for o seu treinamento, mais humana e precisa será a interação dela com seus pacientes.
          </p>
        </div>
      </section>

      <form onSubmit={handleSave} className="space-y-8">
        
        {/* 1. Modo de Atendimento (STRENGHTEN PRINCIPLES) */}
        <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h4 className="text-sm font-bold text-slate-900">Modo de Operação da ELIZA</h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Determine o nível de autonomia da secretária virtual no WhatsApp</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Mode 1 */}
            <div 
              onClick={() => setConfig(prev => ({ ...prev, operationalMode: 'sugestao' }))}
              className={`p-5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all hover:shadow-md ${
                config.operationalMode === 'sugestao' 
                  ? 'border-teal-500 bg-teal-50/50 shadow-sm' 
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    config.operationalMode === 'sugestao' ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    Modo Sugestão
                  </span>
                  <input 
                    type="radio" 
                    name="operationalMode" 
                    checked={config.operationalMode === 'sugestao'} 
                    onChange={() => {}} 
                    className="accent-teal-600 focus:ring-0" 
                  />
                </div>
                <h5 className="text-xs font-bold text-slate-900">Co-Piloto (Recomendado)</h5>
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1.5">
                  A ELIZA gera sugestões de respostas inteligentes no painel, mas o envio real para o paciente precisa ser aprovado e clicado por um atendente.
                </p>
              </div>
            </div>

            {/* Mode 2 */}
            <div 
              onClick={() => setConfig(prev => ({ ...prev, operationalMode: 'semi_automatico' }))}
              className={`p-5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all hover:shadow-md ${
                config.operationalMode === 'semi_automatico' 
                  ? 'border-indigo-500 bg-indigo-50/50 shadow-sm' 
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    config.operationalMode === 'semi_automatico' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    Semi-automático
                  </span>
                  <input 
                    type="radio" 
                    name="operationalMode" 
                    checked={config.operationalMode === 'semi_automatico'} 
                    onChange={() => {}} 
                    className="accent-indigo-600 focus:ring-0" 
                  />
                </div>
                <h5 className="text-xs font-bold text-slate-900">IA Híbrida</h5>
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1.5">
                  A ELIZA responde dúvidas simples institucionalmente. Contudo, qualquer solicitação de agendamento, cancelamento ou valores é bloqueada e depende de aprovação humana.
                </p>
              </div>
            </div>

            {/* Mode 3 */}
            <div 
              onClick={() => setConfig(prev => ({ ...prev, operationalMode: 'automatico' }))}
              className={`p-5 rounded-2xl border cursor-pointer flex flex-col justify-between transition-all hover:shadow-md ${
                config.operationalMode === 'automatico' 
                  ? 'border-amber-500 bg-amber-50/50 shadow-sm' 
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    config.operationalMode === 'automatico' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    Automático
                  </span>
                  <input 
                    type="radio" 
                    name="operationalMode" 
                    checked={config.operationalMode === 'automatico'} 
                    onChange={() => {}} 
                    className="accent-amber-600 focus:ring-0" 
                  />
                </div>
                <h5 className="text-xs font-bold text-slate-900">Autonomia Total</h5>
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1.5">
                  A ELIZA responde dúvidas, agenda avaliações, faz follow-up e confirma consultas de maneira autônoma com base nas políticas da clínica.
                </p>
              </div>
            </div>

          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 flex items-start gap-3">
            <Lock className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={config.humanApprovalRequired}
                  onChange={(e) => setConfig(prev => ({ ...prev, humanApprovalRequired: e.target.checked }))}
                  className="accent-teal-600 focus:ring-0" 
                />
                <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wide">Aprovação humana obrigatória em casos de conflito ou queixas</span>
              </label>
              <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">Sempre que a IA identificar descontentamento ou queixas de pacientes, ela passará o controle imediatamente para a equipe.</p>
            </div>
          </div>
        </div>

        {/* 2. Informações Institucionais */}
        <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-600" /> Dado Geral do Consultório
            </h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Configure as informações físicas e de atendimento da clínica</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                Nome da Clínica
              </label>
              <input 
                type="text" 
                value={config.clinicName}
                onChange={(e) => setConfig(prev => ({ ...prev, clinicName: e.target.value }))}
                placeholder="Ex Nome Oficial da Clínica"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                Endereço Completo
              </label>
              <input 
                type="text" 
                value={config.address}
                onChange={(e) => setConfig(prev => ({ ...prev, address: e.target.value }))}
                placeholder="Rua, Número, Bairro, Cidade - Estado"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-1 md:col-span-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                Horários de Funcionamento
              </label>
              <input 
                type="text" 
                value={config.hours}
                onChange={(e) => setConfig(prev => ({ ...prev, hours: e.target.value }))}
                placeholder="Seg-Sex: 08h-18, Sáb: 08-12h"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1 md:col-span-1 border-l-0 md:border-l border-slate-100 md:pl-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                Profissionais / Especialidades
              </label>
              <textarea 
                value={config.professionals}
                onChange={(e) => setConfig(prev => ({ ...prev, professionals: e.target.value }))}
                placeholder="Ex Dr. João (Ortodontia), Drª. Priscila (HOF)..."
                rows={2}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 placeholder:text-slate-400"
              />
            </div>

            <div className="space-y-1 md:col-span-1 border-l-0 md:border-l border-slate-100 md:pl-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                Procedimentos Oferecidos
              </label>
              <textarea 
                value={config.procedures}
                onChange={(e) => setConfig(prev => ({ ...prev, procedures: e.target.value }))}
                placeholder="Ex Limpeza, Clareamento, Próteses, Botox..."
                rows={2}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>

        {/* 3. Voice and Guidelines */}
        <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-teal-600" /> Tom de Voz & Restrições (Personalidade)
            </h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Determine como a ELIZA deve conversar com os pacientes</p>
          </div>

          <div className="space-y-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tom de Voz da ELIZA</label>
                <span className="bg-teal-50 text-teal-700 text-[8px] font-bold px-1 rounded uppercase">Premium</span>
              </div>
              <textarea 
                value={config.toneOfVoice}
                onChange={(e) => setConfig(prev => ({ ...prev, toneOfVoice: e.target.value }))}
                placeholder="Humano, acolhedor, profissional, polido, empático, confiante. Termos chaves elegantes..."
                rows={3}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-red-500">Respostas Proibidas e Restrições</label>
                <span className="bg-red-50 text-red-700 text-[8px] font-bold px-1 rounded uppercase">Critério de Segurança</span>
              </div>
              <textarea 
                value={config.forbiddenResponses}
                onChange={(e) => setConfig(prev => ({ ...prev, forbiddenResponses: e.target.value }))}
                placeholder="Exemplo: Proibido passar custos cirúrgicos fechados sem raio-X; Proibido responder sobre receitas medicamentosas; Proibido fazer promessas de cura imediata."
                rows={3}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>
          </div>
        </div>

        {/* 4. Políticas da Clínica */}
        <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-teal-600" /> Políticas Internas e Acordos
            </h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">As regras cruciais para confirmações, faltas ou reagendamentos</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Política de Confirmação de Horários</label>
              <textarea 
                value={config.confirmationPolicy}
                onChange={(e) => setConfig(prev => ({ ...prev, confirmationPolicy: e.target.value }))}
                placeholder="Ex Confirmamos com 24 horas de antecedência. Caso não responda em 6 horas, o horário pode ser liberado para fila de espera."
                rows={3}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Política de Cancelamento / Reagendamento / Faltas</label>
              <textarea 
                value={config.cancellationPolicy}
                onChange={(e) => setConfig(prev => ({ ...prev, cancellationPolicy: e.target.value }))}
                placeholder="Ex Solicitar cancelamento em até 12 horas de antecedência sem cobrança de taxa operacional extra."
                rows={3}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>
          </div>
        </div>

        {/* 5. Mensagens Padrão / Modelos Base */}
        <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-600" /> Mensagens Padrão e Roteiro Base
            </h4>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Orientações de roteiro que a ELIZA usará para criar as respostas reais</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Roteiro de Boas-vindas (Novo Paciente)</label>
              <textarea 
                value={config.welcomeMessage}
                onChange={(e) => setConfig(prev => ({ ...prev, welcomeMessage: e.target.value }))}
                rows={2}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Roteiro de Confirmação de Consulta</label>
              <textarea 
                value={config.confirmationMessage}
                onChange={(e) => setConfig(prev => ({ ...prev, confirmationMessage: e.target.value }))}
                rows={2}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Roteiro de Pós-procedimento (Follow-Up diário)</label>
              <textarea 
                value={config.followUpMessage}
                onChange={(e) => setConfig(prev => ({ ...prev, followUpMessage: e.target.value }))}
                rows={2}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
              />
            </div>
          </div>
        </div>

        {/* Form Submission Button with success indicators */}
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
          {saveSuccess && (
            <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-fade-in-up">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              Treinamento salvo com sucesso!
            </div>
          )}

          <button 
            type="submit"
            disabled={saveLoading}
            className="bg-teal-600 hover:bg-teal-700 text-white px-8 py-4 rounded-3xl text-xs font-bold uppercase tracking-widest shadow-xl shadow-teal-600/30 flex items-center gap-2 select-none hover:scale-105 transition-all"
          >
            {saveLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Save className="w-4 h-4 text-white" />
            )}
            {saveLoading ? 'Salvando Treinamento...' : 'Salvar Treinamento'}
          </button>
        </div>

      </form>
    </div>
  );
}
