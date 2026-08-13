import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { Zap, MessageSquare, AlertCircle, RefreshCw, CheckCircle, HelpCircle } from 'lucide-react';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function PlatformIntegrations() {
  const { clinics, isLoading } = useAdmin();
  const [selectedClinic, setSelectedClinic] = useState<any | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Form states
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNum, setPhoneNum] = useState('');
  const [status, setStatus] = useState('disconnected');
  const [webhookUrl, setWebhookUrl] = useState('');

  const handleSaveIntegration = async () => {
    if (!selectedClinic) return;
    setIsUpdating(true);
    try {
      const ref = doc(db, 'clinics', selectedClinic.id);
      const payload = {
        whatsappPhoneNumberId: phoneId || null,
        whatsappBusinessAccountId: wabaId || null,
        whatsappConnectedNumber: phoneNum || null,
        whatsappStatus: status,
        whatsappWebhook: webhookUrl || null,
        updatedAt: serverTimestamp()
      };
      await updateDoc(ref, payload);
      setSelectedClinic(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="p-8 space-y-8">
      <header>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Integrações de WhatsApp</h2>
        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Conectividade Meta Cloud API e logs de Webhook por clínica</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Integrations Table */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Gateways e Tokens WhatsApp</h3>
            <MessageSquare className="w-5 h-5 text-teal-600" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Clínica', 'ID do Telefone', 'WABA ID', 'Status WA', 'Webhook'].map(h => (
                    <th key={h} className="px-6 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clinics.map(c => (
                  <tr 
                    key={c.id} 
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer group"
                    onClick={() => {
                      setSelectedClinic(c);
                      setPhoneId(c.whatsappPhoneNumberId || '');
                      setWabaId(c.whatsappBusinessAccountId || '');
                      setPhoneNum(c.whatsappConnectedNumber || '');
                      setStatus(c.whatsappStatus || 'disconnected');
                      setWebhookUrl(c.whatsappWebhook || '');
                    }}
                  >
                    <td className="px-6 py-4">
                      <p className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-teal-600 transition-colors">{c.name}</p>
                      <p className="text-[10px] text-slate-600 font-medium">{c.whatsappConnectedNumber || 'Nenhum número salvo'}</p>
                    </td>
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-500">{c.whatsappPhoneNumberId || 'Não config.'}</td>
                    <td className="px-6 py-4 font-mono text-[10px] text-slate-500">{c.whatsappBusinessAccountId || 'Não config.'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${
                          c.whatsappStatus === 'connected' || c.whatsappStatus === 'active' ? 'bg-emerald-500' : 'bg-slate-300'
                        }`} />
                        <span className="text-[9px] font-black uppercase tracking-widest">
                          {c.whatsappStatus === 'connected' || c.whatsappStatus === 'active' ? 'Ativo' : 'Offline'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[10px] font-mono text-slate-400 truncate max-w-[120px]">{c.whatsappWebhook || 'Nenhum'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Integration Details & Setup Form */}
        {selectedClinic ? (
          <div className="bg-slate-900 rounded-[2.5rem] text-white p-8 space-y-6 flex flex-col justify-between shadow-2xl border border-slate-800 animate-in fade-in duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <Zap className="w-6 h-6 text-amber-400" />
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest bg-amber-500/10 border border-amber-500/20 text-amber-500 px-3 py-1 rounded-lg">Setup Meta API</span>
              </div>
              <div>
                <h3 className="text-md font-black uppercase tracking-tight text-white">{selectedClinic.name}</h3>
                <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">Editar Chaves de Comunicação</p>
              </div>

              <div className="space-y-3 pt-4">
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Status da API</label>
                  <select 
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-[10px] font-bold text-white uppercase outline-none focus:border-teal-500 transition-all cursor-pointer"
                  >
                    <option value="disconnected">OFFLINE / DESCONECTADO</option>
                    <option value="connected">CONECTADO / OPERACIONAL</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Phone Number ID</label>
                  <input 
                    value={phoneId}
                    onChange={(e) => setPhoneId(e.target.value)}
                    placeholder="EX: 10459283020..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-teal-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">WABA ID</label>
                  <input 
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="EX: 84930283010..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-teal-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Número de WhatsApp Conectado</label>
                  <input 
                    value={phoneNum}
                    onChange={(e) => setPhoneNum(e.target.value)}
                    placeholder="EX: +55 (11) 99999-9999"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-[10px] font-bold text-white outline-none focus:border-teal-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase tracking-widest text-slate-400">Webhook URL</label>
                  <input 
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="EX: https://api.elisa.com.br/webhook"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-[10px] font-mono text-white outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-slate-800">
              <button 
                onClick={() => setSelectedClinic(null)}
                className="flex-1 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveIntegration}
                disabled={isUpdating}
                className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
              >
                {isUpdating ? 'Salvando...' : 'Salvar Gateway'}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-[2.5rem] p-8 text-center flex flex-col items-center justify-center space-y-4 text-slate-400 min-h-[350px]">
            <HelpCircle className="w-12 h-12 stroke-1 opacity-60 text-teal-400" />
            <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">
              Clique em uma clínica na lista para gerenciar os detalhes de conectividade WhatsApp Business Cloud API.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
