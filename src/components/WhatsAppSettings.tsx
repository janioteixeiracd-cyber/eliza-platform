import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Smartphone, CheckCircle, XCircle, AlertTriangle, RefreshCw, Copy, ShieldCheck, Play, Send, Check, X } from 'lucide-react';

interface WhatsAppIntegration {
  status: 'conectado' | 'não conectado' | 'erro';
  provider: 'meta' | 'twilio';
  phoneNumberId: string;
  wabaId: string;
  businessName: string;
  displayPhoneNumber: string;
  verifyToken: string;
  accessTokenSecretName: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioWhatsAppNumber: string;
  aiEnabled: boolean;
  humanApprovalRequired: boolean;
  webhookUrl: string;
  createdAt?: any;
  updatedAt?: any;
}

const TWILIO_SANDBOX_NUMBER = '+14155238886';

interface IntegrationLog {
  id: string;
  type: string;
  action: string;
  status: 'success' | 'error';
  message: string;
  createdAt: any;
}

export default function WhatsAppSettings() {
  const { clinic } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhoneNumberInput, setTestPhoneNumberInput] = useState('');

  // Form State
  const [status, setStatus] = useState<WhatsAppIntegration['status']>('não conectado');
  const [provider, setProvider] = useState<WhatsAppIntegration['provider']>('meta');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [accessToken, setAccessToken] = useState(''); // Access token saved
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioWhatsAppNumber, setTwilioWhatsAppNumber] = useState(TWILIO_SANDBOX_NUMBER);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [humanApprovalRequired, setHumanApprovalRequired] = useState(true);

  // Multi-number configurations (Part 5)
  const [apiNumber, setApiNumber] = useState('');
  const [legacyClinicNumber, setLegacyClinicNumber] = useState('');
  const [defaultSendMode, setDefaultSendMode] = useState<'eliza_api' | 'open_whatsapp'>('eliza_api');
  const [allowOpenExternalWhatsApp, setAllowOpenExternalWhatsApp] = useState(true);

  // Logs State
  const [logs, setLogs] = useState<IntegrationLog[]>([]);

  // Webhook URL generator
  const webhookUrl = window.location.origin + '/api/whatsapp/webhook';

  useEffect(() => {
    if (!clinic) return;

    setLoading(true);

    // 1. Fetch current integration info
    const integrationRef = doc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');
    const unsubIntegration = onSnapshot(integrationRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as WhatsAppIntegration;
        setStatus(data.status || 'não conectado');
        setProvider(data.provider === 'twilio' ? 'twilio' : 'meta');
        setPhoneNumberId(data.phoneNumberId || '');
        setWabaId(data.wabaId || '');
        setBusinessName(data.businessName || '');
        setDisplayPhoneNumber(data.displayPhoneNumber || '');
        setVerifyToken(data.verifyToken || '');
        setAccessToken(data.accessTokenSecretName ? '••••••••••••••••••••••••••••••••' : ''); // Show masked if exists
        setTwilioAccountSid(data.twilioAccountSid || '');
        setTwilioAuthToken(data.twilioAuthToken ? '••••••••••••••••••••••••••••••••' : '');
        setTwilioWhatsAppNumber(data.twilioWhatsAppNumber || TWILIO_SANDBOX_NUMBER);
        setAiEnabled(data.aiEnabled !== false);
        setHumanApprovalRequired(data.humanApprovalRequired !== false);
      } else {
        setStatus('não conectado');
        // Set a random verify token initially for convenience
        setVerifyToken(Math.random().toString(36).substring(2, 10).toUpperCase());
      }
      setLoading(false);
    });

    // 2. Fetch logs in real-time
    const logsQuery = query(
      collection(db, 'clinics', clinic.id, 'integration_logs'),
      orderBy('createdAt', 'desc'),
      limit(25)
    );
    const unsubLogs = onSnapshot(logsQuery, (snap) => {
      const logsList: IntegrationLog[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as IntegrationLog));
      setLogs(logsList);
    });

    // 3. Fetch multi-number configurations
    const configRef = doc(db, 'clinics', clinic.id, 'whatsapp_settings', 'config');
    const unsubConfig = onSnapshot(configRef, (configSnap) => {
      if (configSnap.exists()) {
        const data = configSnap.data();
        setApiNumber(data.apiNumber || '');
        setLegacyClinicNumber(data.legacyClinicNumber || '');
        setDefaultSendMode(data.defaultSendMode || 'eliza_api');
        setAllowOpenExternalWhatsApp(data.allowOpenExternalWhatsApp !== false);
      }
    });

    return () => {
      unsubIntegration();
      unsubLogs();
      unsubConfig();
    };
  }, [clinic]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic) return;
    setSaving(true);
    setTestResult(null);

    try {
      const integrationRef = doc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');
      
      // Keep or update access token. If user didn't modify masked dots, use old token
      let tokenToSave = accessToken;
      const isMasked = accessToken.includes('••••');
      let twilioTokenToSave = twilioAuthToken;
      const isTwilioTokenMasked = twilioAuthToken.includes('••••');

      let existingData: any = {};
      if (isMasked || isTwilioTokenMasked) {
        const snap = await getDoc(integrationRef);
        existingData = snap.data() || {};
        if (isMasked) tokenToSave = existingData.accessTokenSecretName || '';
        if (isTwilioTokenMasked) twilioTokenToSave = existingData.twilioAuthToken || '';
      }

      const isConnected = provider === 'twilio'
        ? !!(twilioAccountSid && twilioTokenToSave && twilioWhatsAppNumber)
        : !!(phoneNumberId && wabaId && tokenToSave);

      const payload: WhatsAppIntegration = {
        status: isConnected ? 'conectado' : 'não conectado',
        provider,
        phoneNumberId,
        wabaId,
        businessName,
        displayPhoneNumber,
        verifyToken,
        accessTokenSecretName: tokenToSave,
        twilioAccountSid,
        twilioAuthToken: twilioTokenToSave,
        twilioWhatsAppNumber,
        aiEnabled,
        humanApprovalRequired,
        webhookUrl,
        updatedAt: serverTimestamp()
      };

      if (!existingData.createdAt) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(integrationRef, payload, { merge: true });

      // Save multi-number configuration (Part 5)
      const configRef = doc(db, 'clinics', clinic.id, 'whatsapp_settings', 'config');
      await setDoc(configRef, {
        apiNumber,
        legacyClinicNumber,
        defaultSendMode,
        allowOpenExternalWhatsApp,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Add audit log
      await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
        type: 'whatsapp',
        action: 'save_config',
        status: 'success',
        message: 'Configurações de integração atualizadas e salvas pela equipe.',
        createdAt: serverTimestamp()
      });

    } catch (err: any) {
      console.error("[WhatsApp] Error saving config:", err);
      alert('Erro ao salvar configurações: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!clinic) return;
    if (!confirm('Deseja realmente desconectar e limpar os dados de integração com WhatsApp Cloud API?')) return;

    setSaving(true);
    setTestResult(null);
    try {
      const integrationRef = doc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');
      await deleteDoc(integrationRef);

      // Reset form variables
      setPhoneNumberId('');
      setWabaId('');
      setBusinessName('');
      setDisplayPhoneNumber('');
      setAccessToken('');
      setTwilioAccountSid('');
      setTwilioAuthToken('');
      setTwilioWhatsAppNumber(TWILIO_SANDBOX_NUMBER);
      setVerifyToken(Math.random().toString(36).substring(2, 10).toUpperCase());
      setStatus('não conectado');

      // Add audit log
      await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
        type: 'whatsapp',
        action: 'disconnect',
        status: 'success',
        message: 'A integração com WhatsApp foi desativada e desconectada manualmente.',
        createdAt: serverTimestamp()
      });

    } catch (err: any) {
      console.error("[WhatsApp] Error disconnecting:", err);
      alert('Erro ao desconectar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestSend = () => {
    if (!clinic) return;
    if (provider === 'twilio' ? !twilioWhatsAppNumber : !phoneNumberId) return;
    setTestPhoneNumberInput('');
    setIsTestModalOpen(true);
    setTestResult(null);
  };

  const submitTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !testPhoneNumberInput.trim()) return;
    if (provider === 'twilio' ? !twilioWhatsAppNumber : !phoneNumberId) return;

    const testPhone = testPhoneNumberInput.trim();
    setTestSending(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          conversationId: testPhone,
          text: `Olá! Este é um teste oficial de conexão da sua clínica via ELIZA AI (provedor: ${provider === 'twilio' ? 'Twilio' : 'Meta WhatsApp Cloud API'}). Integração ativa e segura! 🚀`
        })
      });

      const resData = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: 'Mensagem de teste enviada com sucesso! Verifique o telefone.' });
        setIsTestModalOpen(false);
        
        await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
          type: 'whatsapp',
          action: 'test_send',
          status: 'success',
          message: `Envio de teste efetuado com sucesso para ${testPhone}.`,
          createdAt: serverTimestamp()
        });
      } else {
        setTestResult({ success: false, message: `Falha no envio: ${resData.error || 'Erro desconhecido'}` });
        
        await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
          type: 'whatsapp',
          action: 'test_send',
          status: 'error',
          message: `Falha operacional no envio de teste para ${testPhone}: ${resData.error || 'Erro interno'}`,
          createdAt: serverTimestamp()
        });
      }
    } catch (err: any) {
      console.error("[WhatsApp Test] Error:", err);
      setTestResult({ success: false, message: 'Erro ao tentar enviar: ' + err.message });
    } finally {
      setTestSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400 font-sans">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-2" />
        Carregando configurações do WhatsApp...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 sm:space-y-8">
      
      {/* Intro Header */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-600" />
            Integração Oficial com WhatsApp Cloud API
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Conecte sua conta oficial empresarial do Meta Business Suite para receber e responder pacientes de forma 100% legalizada e escalável.
          </p>
        </div>
        
        <div className="flex items-center gap-2 shrink-0">
          {status === 'conectado' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
              <CheckCircle className="w-3.5 h-3.5" />
              Conectado
            </span>
          ) : status === 'erro' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-100">
              <AlertTriangle className="w-3.5 h-3.5" />
              Erro Conexão
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-600">
              <XCircle className="w-3.5 h-3.5" />
              Não Conectado
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Settings Form */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-3">Dados Operacionais</h4>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Provedor de Envio</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setProvider('meta')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${provider === 'meta' ? 'bg-teal-600 border-teal-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  Meta (WhatsApp Cloud API)
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('twilio')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${provider === 'twilio' ? 'bg-teal-600 border-teal-600 text-white' : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'}`}
                >
                  Twilio
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Nome de Exibição da Clínica</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Ex: Clínica Portella Sorrisos"
                required
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
              />
            </div>

            {provider === 'meta' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Número Conectado (Com DDI)</label>
                    <input
                      type="text"
                      value={displayPhoneNumber}
                      onChange={(e) => setDisplayPhoneNumber(e.target.value)}
                      placeholder="Ex: 5511999999999"
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Phone Number ID</label>
                    <input
                      type="text"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      placeholder="Obtido no painel de desenvolvedor Meta"
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">WhatsApp Business Account ID (WABA)</label>
                    <input
                      type="text"
                      value={wabaId}
                      onChange={(e) => setWabaId(e.target.value)}
                      placeholder="Obtido no painel do Meta"
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Access Token Meta / Permanent Token</label>
                  <input
                    type="text"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="Insira o Token de Acesso Permanente gerado na Meta"
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="bg-teal-50 border border-teal-100 p-4 rounded-2xl text-[11px] text-teal-800 leading-relaxed">
                  <strong>Sandbox do Twilio:</strong> use o número <span className="font-mono font-bold">{TWILIO_SANDBOX_NUMBER}</span> pra testar sem aprovação da Meta. Cada pessoa que for receber mensagem precisa mandar, uma única vez, <span className="font-mono font-bold">"join &lt;código&gt;"</span> pra esse número pelo WhatsApp dela — o código aparece no console do Twilio (Messaging → Try it out → Send a WhatsApp message). Quando tiver um número de produção aprovado, é só trocar aqui.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Account SID</label>
                    <input
                      type="text"
                      value={twilioAccountSid}
                      onChange={(e) => setTwilioAccountSid(e.target.value)}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Número do WhatsApp (Twilio)</label>
                    <input
                      type="text"
                      value={twilioWhatsAppNumber}
                      onChange={(e) => setTwilioWhatsAppNumber(e.target.value)}
                      placeholder={TWILIO_SANDBOX_NUMBER}
                      required
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Auth Token</label>
                  <input
                    type="text"
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    placeholder="Insira o Auth Token do console do Twilio"
                    required
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                  />
                </div>
              </>
            )}

            {provider === 'meta' ? (
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Segurança do Webhook (Verify Token)</span>
                  <span className="font-mono text-xs text-slate-600 font-bold bg-white px-2.5 py-1 border border-slate-150 rounded">{verifyToken}</span>
                </div>
                <p className="text-[9px] text-slate-400 font-bold max-w-sm md:text-right leading-relaxed">
                  Este token é gerado aleatoriamente e deve ser copiado para o painel da Meta ao configurar o Webhook para autenticar a conexão.
                </p>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl mt-6">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Segurança do Webhook (Twilio)</span>
                <p className="text-[9px] text-slate-400 font-bold leading-relaxed">
                  O Twilio não usa verify token — cada mensagem recebida vem assinada com o Auth Token acima (cabeçalho X-Twilio-Signature), validado automaticamente no servidor. Não precisa configurar nada extra além da URL do webhook abaixo.
                </p>
              </div>
            )}

            {/* Multi-números & Encaminhamento de Ficha */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Multi-números & Comportamento de Ficha</h5>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Número Oficial API WhatsApp (DDI + DDD)</label>
                  <input 
                    type="text" 
                    value={apiNumber}
                    onChange={(e) => setApiNumber(e.target.value)}
                    placeholder="Ex: 5511999999999"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Número Conectado Legado / Antigo (DDI + DDD)</label>
                  <input 
                    type="text" 
                    value={legacyClinicNumber}
                    onChange={(e) => setLegacyClinicNumber(e.target.value)}
                    placeholder="Ex: 5511988888888"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                  />
                </div>

                <div className="space-y-1 col-span-1 md:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Canal de Envio Padrão na Ficha</label>
                  <select
                    value={defaultSendMode}
                    onChange={(e) => setDefaultSendMode(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans"
                  >
                    <option value="eliza_api">Enviar pela ELIZA (Cloud API)</option>
                    <option value="open_whatsapp">Abrir WhatsApp Legado da Clínica (wa.me)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-start gap-3 pt-2">
                <input 
                  type="checkbox"
                  id="allowOpenExternalWhatsApp"
                  checked={allowOpenExternalWhatsApp}
                  onChange={(e) => setAllowOpenExternalWhatsApp(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer mt-0.5"
                />
                <div>
                  <label htmlFor="allowOpenExternalWhatsApp" className="text-xs font-bold text-slate-800 cursor-pointer">Permitir escolher abrir no WhatsApp externo da clínica na ficha</label>
                  <p className="text-[10px] text-slate-400 leading-tight">Se marcado, os usuários poderão escolher entre Enviar pela ELIZA ou abrir no WhatsApp Web externo.</p>
                </div>
              </div>
            </div>

            {/* AI Settings inside configuration */}
            <div className="pt-4 border-t border-slate-100 space-y-4">
              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Automação de IA (Elisa)</h5>
              
              <div className="flex items-start gap-3">
                <input 
                  type="checkbox"
                  id="aiEnabled"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer mt-0.5"
                />
                <div>
                  <label htmlFor="aiEnabled" className="text-xs font-bold text-slate-800 cursor-pointer">Ativar Assistência de IA da ELIZA nas conversas</label>
                  <p className="text-[10px] text-slate-400 leading-tight">Quando habilitada, a IA analisa mensagens recebidas e prescreve sugestões de ação.</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <input 
                  type="checkbox"
                  id="humanApprovalRequired"
                  checked={humanApprovalRequired}
                  onChange={(e) => setHumanApprovalRequired(e.target.checked)}
                  className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer mt-0.5"
                />
                <div>
                  <label htmlFor="humanApprovalRequired" className="text-xs font-bold text-slate-800 cursor-pointer">Homologação manual de respostas recomendadas (Modo Seguro)</label>
                  <p className="text-[10px] text-slate-400 leading-tight">Garante que a ELIZA nunca envie respostas ao WhatsApp sem o clique de aprovação de um funcionário humano no painel.</p>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="pt-5 border-t border-slate-100 flex items-center justify-between gap-4">
              {status === 'conectado' && (
                <button 
                  type="button"
                  onClick={handleDisconnect}
                  className="px-4 py-2 text-xs font-black bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100 rounded-xl transition-all uppercase tracking-wider"
                >
                  Desconectar
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button 
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 text-xs font-black text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-lg shadow-teal-600/10 disabled:opacity-50 transition-all uppercase tracking-wider"
                >
                  {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Salvar Parâmetros
                </button>
              </div>
            </div>

          </form>

          {/* Test Component Card */}
          {status === 'conectado' && (
            <div className="bg-emerald-50/20 border border-emerald-100 p-6 rounded-3xl space-y-4 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-800">
                <Smartphone className="w-5 h-5 text-emerald-600" />
                <h4 className="text-xs font-black uppercase tracking-wider">Testador de Comunicação</h4>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Envie uma mensagem instantânea do sistema WhatsApp Cloud API diretamente para um número qualquer de testes cadastrado.
              </p>
              
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestSend}
                  disabled={testSending}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all uppercase tracking-wider shadow-sm shadow-emerald-600/15"
                >
                  {testSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Testar Envio Instantâneo
                </button>
              </div>

              {testResult && (
                <div className={`p-4 rounded-xl text-xs border ${
                  testResult.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-55 text-rose-800 border-rose-200'
                }`}>
                  {testResult.message}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Info Right Rails */}
        <div className="space-y-6">
          
          {/* Meta Endpoints info panel */}
          <div className="bg-slate-900 text-slate-100 p-6 rounded-3xl space-y-4 shadow-xl">
            <h4 className="text-xs font-black uppercase tracking-wider text-teal-400 border-b border-slate-800 pb-2.5">Endereço Webhook Oficial</h4>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Copie a URL de webhook abaixo e configure-a nas configurações de WhatsApp do desenvolvedor Meta do seu aplicativo para ativar a escuta e reflexo instantâneo de mensagens.
            </p>

            <div className="bg-slate-800/85 p-3 border border-slate-700/50 rounded-xl space-y-2 relative">
              <span className="text-[8px] font-black uppercase text-teal-500 tracking-wider">Callback URL</span>
              <p className="font-mono text-[9px] text-slate-200 break-all select-all font-semibold leading-normal">{webhookUrl}</p>
              <button 
                onClick={copyWebhookUrl} 
                className="absolute top-2.5 right-2 text-slate-400 hover:text-white p-1 rounded"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div className="space-y-1">
              <span className="text-[8px] font-black uppercase text-teal-500 tracking-wider block">Campos a Assinar (Webhook Fields)</span>
              <div className="text-[9px] font-mono font-bold bg-slate-800/50 p-2 border border-slate-700/30 rounded text-slate-300">
                - messages
              </div>
            </div>
            
            <div className="text-[10px] text-slate-400 leading-relaxed pt-2">
              <strong className="text-white">Instruções Meta:</strong> Use a validação hub.challange e utilize o seu Verify Token exposto no formulário da esquerda.
            </div>
          </div>

          {/* Real-time Integration logs */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Logs de Integração</h4>
              <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Histórico Recente</span>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
              {logs.length === 0 ? (
                <p className="text-[10px] text-slate-400 font-bold text-center py-6">Nenhum log operacional gerado ainda.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="font-black text-slate-600 uppercase tracking-tight">{log.action || 'Sincronização'}</span>
                      <span className={`px-1.5 py-0.5 rounded uppercase font-black tracking-widest text-[7px] ${
                        log.status === 'success' ? 'bg-emerald-55 text-emerald-700' : 'bg-rose-55 text-rose-700'
                      }`}>
                        {log.status === 'success' ? 'OK' : 'FALHA'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-600 leading-relaxed font-medium">{log.message}</p>
                    <span className="text-[8px] text-slate-400 block font-mono">
                      {log.createdAt ? new Date(log.createdAt.toDate ? log.createdAt.toDate() : log.createdAt).toLocaleString('pt-BR') : 'Agora'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </div>

      {isTestModalOpen && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl w-full max-w-md overflow-hidden relative">
            
            {/* Ambient pattern */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
            
            {/* Header */}
            <div className="p-6 pb-0 flex items-start justify-between">
              <div className="flex gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100/50">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                    Número de Teste
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    WhatsApp Cloud API
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsTestModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-150 transition-all flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={submitTestSend} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase text-slate-400 block tracking-widest">
                  Número de Telefone Destinatário
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 5511999999999"
                  value={testPhoneNumberInput}
                  onChange={(e) => setTestPhoneNumberInput(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-mono"
                />
                <p className="text-[10px] text-slate-400 leading-normal pl-0.5">
                  Informe o número completo contendo o código do país (DDI 55 para o Brasil), DDD (2 dígitos) e o número do celular.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-550 border border-slate-200/60 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={testSending}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-1.5"
                >
                  {testSending ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Enviar Mensagem
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
