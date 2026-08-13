import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { ShieldAlert, CheckCircle2, AlertTriangle, Send, Activity, HelpCircle, Loader2 } from 'lucide-react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function PlatformSupport() {
  const { clinics, addClinicSupportNote, checkSystemHealth } = useAdmin();
  const [selectedClinicId, setSelectedClinicId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<any[] | null>(null);

  const handleSendNote = async () => {
    if (!selectedClinicId || !noteText.trim()) return;
    setIsSending(true);
    try {
      await addClinicSupportNote(selectedClinicId, noteText);
      setNoteText('');
      alert("Nota de suporte salva e auditada com sucesso!");
    } catch (e) {
      console.error(e);
      alert("Falha ao salvar nota de suporte.");
    } finally {
      setIsSending(false);
    }
  };

  const handleRunDiagnostics = async () => {
    if (!selectedClinicId) return;
    setDiagnosing(true);
    setDiagResults(null);
    const results: any[] = [];

    // 1. Real Firestore read of the clinic doc itself.
    try {
      const clinicSnap = await getDoc(doc(db, 'clinics', selectedClinicId));
      results.push({
        name: "Conectividade do Banco (leitura real)",
        status: clinicSnap.exists() ? "OK" : "Falha",
        desc: clinicSnap.exists() ? `Documento 'clinics/${selectedClinicId}' lido com sucesso agora mesmo.` : "Documento não encontrado.",
        type: clinicSnap.exists() ? "success" : "warning",
      });
    } catch (e: any) {
      results.push({ name: "Conectividade do Banco (leitura real)", status: "Falha", desc: e?.message || "Erro ao ler.", type: "warning" });
    }

    // 2. Real count of the members subcollection.
    try {
      const membersSnap = await getDocs(collection(db, 'clinics', selectedClinicId, 'members'));
      results.push({
        name: "Associações de Membros (contagem real)",
        status: "OK",
        desc: `${membersSnap.size} membro(s) encontrado(s) na subcoleção 'members'.`,
        type: "success",
      });
    } catch (e: any) {
      results.push({ name: "Associações de Membros (contagem real)", status: "Falha", desc: e?.message || "Erro ao consultar.", type: "warning" });
    }

    // 3. WhatsApp status — already real data loaded in context, just presented honestly.
    const selected = clinics.find(c => c.id === selectedClinicId);
    results.push({
      name: "Conexão WhatsApp Cloud API",
      status: selected?.whatsappStatus === 'connected' ? "OK" : "Aviso",
      desc: selected?.whatsappStatus === 'connected' ? "Campo whatsappStatus = 'connected' na clínica." : `Campo whatsappStatus = '${selected?.whatsappStatus || 'não configurado'}'.`,
      type: selected?.whatsappStatus === 'connected' ? "success" : "warning",
    });

    // 4. Real backend health check (same /api/health used on the dashboard).
    const health = await checkSystemHealth();
    results.push({
      name: "Backend / API (checagem real)",
      status: health.ok ? "OK" : "Falha",
      desc: health.ok && 'latencyMs' in health ? `Respondeu em ${health.latencyMs}ms.` : "Backend não respondeu ao /api/health.",
      type: health.ok ? "success" : "warning",
    });

    setDiagResults(results);
    setDiagnosing(false);
  };

  return (
    <div className="p-8 space-y-8">
      <header>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Portal de Suporte</h2>
        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Gerenciamento de notas técnicas, diagnóstico de integridade e auditoria</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left column: Write support note */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Criar Nota de Suporte</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ações auditadas sob o log '[SUPER_ADMIN_SUPPORT_ACCESS]'</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Selecione a Clínica Alvo</label>
              <select
                value={selectedClinicId}
                onChange={(e) => {
                  setSelectedClinicId(e.target.value);
                  setDiagResults(null);
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-[10px] font-bold text-slate-700 uppercase outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all cursor-pointer"
              >
                <option value="">-- SELECIONE UMA UNIDADE --</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Descrição Técnica / Notas de Suporte</label>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Insira notas de diagnóstico ou detalhes do atendimento de suporte para esta clínica..."
                rows={6}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-xs font-semibold text-slate-700 outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all resize-none"
              />
            </div>

            <button
              onClick={handleSendNote}
              disabled={isSending || !selectedClinicId || !noteText.trim()}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 transition-all disabled:opacity-50 shadow-lg shadow-slate-900/10"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Salvar Nota de Suporte
            </button>
          </div>
        </div>

        {/* Right column: Diagnostics check */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8 space-y-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Painel de Diagnóstico</h3>
              <Activity className="w-5 h-5 text-teal-600" />
            </div>

            {selectedClinicId ? (
              <div className="space-y-4">
                <button
                  onClick={handleRunDiagnostics}
                  disabled={diagnosing}
                  className="w-full py-3 bg-teal-50 hover:bg-teal-100 border border-teal-100 text-teal-700 rounded-2xl text-[9px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
                >
                  {diagnosing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                  Executar Diagnóstico Completo
                </button>

                {diagResults && (
                  <div className="space-y-3 pt-2">
                    {diagResults.map((res, i) => (
                      <div key={i} className="p-4 rounded-2xl border flex items-start gap-3 bg-slate-50 border-slate-100 animate-in slide-in-from-bottom-2 duration-300">
                        {res.type === 'success' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-black text-slate-900 uppercase">{res.name}</p>
                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${
                              res.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                            }`}>{res.status}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1">{res.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-20 text-center opacity-40 flex flex-col items-center justify-center space-y-4">
                <HelpCircle className="w-12 h-12 text-slate-400 stroke-1" />
                <p className="text-[10px] font-black uppercase tracking-widest">Selecione uma clínica para iniciar os diagnósticos em tempo real</p>
              </div>
            )}
          </div>

          <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 flex items-start gap-4">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-black text-amber-900 uppercase">Ambiente de Produção Ativo</p>
              <p className="text-[9px] text-amber-700 font-medium leading-relaxed mt-0.5">
                Não realize alterações destrutivas de dados. Modificações de plano e status de serviços devem ser documentadas com notas correspondentes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
