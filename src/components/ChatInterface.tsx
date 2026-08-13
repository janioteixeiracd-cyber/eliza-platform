import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { getElisaResponse } from '../services/geminiService';
import { 
  Send, 
  UserRoundIcon, 
  Calendar, 
  Stethoscope, 
  MessageSquare, 
  Phone, 
  Info, 
  CheckCircle, 
  Smartphone, 
  BrainCircuit, 
  Clock, 
  AlertTriangle, 
  Check, 
  RefreshCw, 
  Sliders, 
  Lock, 
  Activity, 
  Plus, 
  CheckSquare, 
  Cpu,
  Search,
  X,
  ChevronLeft,
  Sparkles
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  addDoc
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  whatsappMessageId?: string;
  sentBy?: string;
  status?: string;
  errorCode?: string | number | null;
  errorMessage?: string | null;
  metaResponse?: any;
  metaStatus?: number | null;
  waId?: string | null;
}

interface WhatsAppConversation {
  id: string; // Patient phone number
  patientId: string;
  patientName: string;
  patientPhone: string;
  matchedPatient?: boolean;
  status: 'aguardando' | 'atendimento' | 'finalizado';
  lastMessage: string;
  lastMessageAt: any;
  unreadCount: number;
  assignedTo: string;
  aiEnabled: boolean;
  source: string;
  priority?: 'high' | 'normal' | 'low' | string | null;
  isPriority?: boolean;
}

interface IntegrationLog {
  id: string;
  type: string;
  action: string;
  status: 'success' | 'error';
  message: string;
  createdAt: any;
}

export function ChatInterface() {
  const { clinic, user } = useAuth();
  
  // Real-time integration status
  const [integration, setIntegration] = useState<any | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<'conectado' | 'não conectado' | 'erro'>('não conectado');
  
  // Active Conversation Lists
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<WhatsAppConversation | null>(null);
  
  // Active Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messageSending, setMessageSending] = useState(false);
  
  // Automation Dashboard Modal
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [recentLogs, setRecentLogs] = useState<IntegrationLog[]>([]);
  
  // UI helper for manual token test sending inside modal
  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Vinculation & Multi-number configurations (Part 2, 3, 5)
  const [clinicPatients, setClinicPatients] = useState<any[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [centralView, setCentralView] = useState<'conversations' | 'patients'>('conversations');
  const [convoToLink, setConvoToLink] = useState<any | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'all' | 'unread' | 'linked' | 'unlinked' | 'waiting' | 'ai_suggested' | 'priority'>('all');
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);

  // Responsive mobile navigation
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showAIPanelSheet, setShowAIPanelSheet] = useState(false);

  // Subscribe to clinic patients list
  useEffect(() => {
    if (!clinic?.id) return;
    const unsubPatients = onSnapshot(collection(db, 'clinics', clinic.id, 'patients'), (snap) => {
      setClinicPatients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
      console.warn("Could not load patients list for chat linking. Using empty local state", err);
    });
    return unsubPatients;
  }, [clinic?.id]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSelectPatient = async (patient: any) => {
    if (!clinic) return;
    
    // 1. Extract patient clean phone number
    const rawPhone = patient.phone || patient.telefone || patient.whatsapp || patient.cellphone || patient.celular || patient.mobile || "";
    const cleanPhone = rawPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      alert("Este paciente não possui telefone válido cadastrado no sistema!");
      return;
    }
    
    // 2. Search if there is an existing conversation in conversations with this phone or patientId
    const existingConvo = conversations.find(c => {
      const cPhone = c.id ? c.id.replace(/\D/g, "") : "";
      return c.patientId === patient.id || cPhone === cleanPhone;
    });
    
    if (existingConvo) {
      setSelectedConvo(existingConvo);
      setCentralView('conversations');
      setMobileView('chat');
    } else {
      // Create a brand new conversation document in clinics/{clinicId}/whatsapp_conversations/{cleanPhone}
      try {
        const convoRef = doc(db, 'clinics', clinic.id, 'whatsapp_conversations', cleanPhone);
        const newConvo = {
          id: cleanPhone,
          patientId: patient.id,
          patientName: patient.name || "Paciente Sem Nome",
          patientPhone: cleanPhone,
          status: "aguardando",
          lastMessage: "Iniciando nova conversa pelo painel central...",
          lastMessageAt: new Date(),
          unreadCount: 0,
          assignedTo: "ai",
          aiEnabled: true,
          source: "manual",
          matchedPatient: true
        };
        await setDoc(convoRef, newConvo);
        
        setSelectedConvo(newConvo as any);
        setCentralView('conversations');
        setMobileView('chat');
      } catch (err: any) {
        console.error("Erro ao criar nova conversa do paciente:", err);
        alert("Erro ao iniciar conversa do paciente: " + err.message);
      }
    }
  };

  const linkConversationToPatient = async (convo: any, patient: any) => {
    if (!clinic) return;
    try {
      const convoRef = doc(db, 'clinics', clinic.id, 'whatsapp_conversations', convo.id);
      await updateDoc(convoRef, {
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: convo.id,
        matchedPatient: true
      });

      if (!patient.phone || patient.phone !== convo.id) {
        const patientRef = doc(db, 'clinics', clinic.id, 'patients', patient.id);
        await updateDoc(patientRef, {
          phone: convo.id
        });
      }

      await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
        type: 'whatsapp',
        action: 'link_patient',
        status: 'success',
        message: `Conversa ${convo.id} vinculada com sucesso ao paciente ${patient.name}.`,
        createdAt: serverTimestamp()
      });

      setConvoToLink(null);
      setPatientSearch('');
    } catch (err: any) {
      console.error("Error linking patient:", err);
      alert("Erro ao vincular paciente: " + err.message);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Diagnostic: Check if current clinic member document exists and log its status
  useEffect(() => {
    if (!clinic || !user) {
      console.log("[ELIZA_DIAGNOSES] Cannot perform clinic member document verification: clinic or user is missing", {
        clinicId: clinic?.id,
        uid: user?.uid
      });
      return;
    }
    const memberPath = `clinics/${clinic.id}/members/${user.uid}`;
    console.log("[ELIZA_DIAGNOSES] Verifying clinic member document:", {
      uid: user.uid,
      clinicId: clinic.id,
      path: memberPath,
      operation: "read"
    });
    
    getDoc(doc(db, 'clinics', clinic.id, 'members', user.uid))
      .then((memberSnap) => {
        if (memberSnap.exists()) {
          const mData = memberSnap.data();
          console.log("[ELIZA_DIAGNOSES] ✅ Clinic member document found! Content data:", mData);
          console.log("[ELIZA_DIAGNOSES] Values evaluation:", {
            active: mData.active,
            status: mData.status,
            role: mData.role,
            is_active_boolean: mData.active === true,
            is_active_string: mData.status === "active"
          });
        } else {
          console.log("[ELIZA_DIAGNOSES] ❌ Clinic member document DOES NOT EXIST:", memberPath);
        }
      })
      .catch((err) => {
        console.error("[ELIZA_DIAGNOSES] ❌ Failed reading clinic member document:", err);
      });
  }, [clinic, user]);

  // 1. Fetch WhatsApp Integration Status, Conversations, and recent logs in real-time
  useEffect(() => {
    if (!clinic) return;

    // A. Subscribe to integration document
    const integrationPath = `clinics/${clinic.id}/integrations/whatsapp`;
    console.log("[ELIZA_DIAGNOSES] Initializing onSnapshot listener:", {
      uid: user?.uid,
      clinicId: clinic.id,
      path: integrationPath,
      operation: "listen"
    });

    const intRef = doc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');
    const unsubIntegration = onSnapshot(intRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setIntegration(data);
        setIntegrationStatus(data.status || 'não conectado');
      } else {
        setIntegration(null);
        setIntegrationStatus('não conectado');
      }
    }, (error) => {
      console.error(`[ELIZA_DIAGNOSES] ❌ PERMISSION_DENIED or other error on path: ${integrationPath}`, {
        uid: user?.uid,
        clinicId: clinic.id,
        error: error.message || error
      });
    });

    // B. Subscribe to conversation threads
    const conversationsPath = `clinics/${clinic.id}/whatsapp_conversations`;
    console.log("[ELIZA_DIAGNOSES] Initializing onSnapshot listener:", {
      uid: user?.uid,
      clinicId: clinic.id,
      path: conversationsPath,
      operation: "listen"
    });

    const convoQuery = query(
      collection(db, 'clinics', clinic.id, 'whatsapp_conversations'),
      orderBy('lastMessageAt', 'desc')
    );
    const unsubConvos = onSnapshot(convoQuery, (snap) => {
      const list: WhatsAppConversation[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as WhatsAppConversation));
      setConversations(list);

      // Preserve currently selected conversation details updated, or fallback select the first
      setSelectedConvo(prev => {
        const pendingPatientId = sessionStorage.getItem('eliza_pending_chat_patient_id');
        const pendingPhone = sessionStorage.getItem('eliza_pending_chat_phone');
        if (pendingPatientId || pendingPhone) {
          const cleanPendingPhone = pendingPhone ? pendingPhone.replace(/\D/g, '') : '';
          const match = list.find(c => 
            (pendingPatientId && c.patientId === pendingPatientId) ||
            (c.patientPhone && c.patientPhone.replace(/\D/g, '') === cleanPendingPhone) ||
            (c.id && c.id.replace(/\D/g, '') === cleanPendingPhone)
          );
          if (match) {
            sessionStorage.removeItem('eliza_pending_chat_patient_id');
            sessionStorage.removeItem('eliza_pending_chat_phone');
            try {
              setMobileView('chat');
            } catch (e) {
              console.warn("Mobile view shift warning:", e);
            }
            return match;
          }
        }

        if (!prev) return list[0] || null;
        const updated = list.find(c => c.id === prev.id);
        return updated || list[0] || null;
      });
    }, (error) => {
      console.error(`[ELIZA_DIAGNOSES] ❌ PERMISSION_DENIED or other error on path: ${conversationsPath}`, {
        uid: user?.uid,
        clinicId: clinic.id,
        error: error.message || error
      });
    });

    // C. Subscribe to the 5 most recent integration logs for the dashboard
    const logsPath = `clinics/${clinic.id}/integration_logs`;
    console.log("[ELIZA_DIAGNOSES] Initializing onSnapshot listener:", {
      uid: user?.uid,
      clinicId: clinic.id,
      path: logsPath,
      operation: "listen"
    });

    const logQuery = query(
      collection(db, 'clinics', clinic.id, 'integration_logs'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );
    const unsubLogs = onSnapshot(logQuery, (snap) => {
      const logList: IntegrationLog[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as IntegrationLog));
      setRecentLogs(logList);
    }, (error) => {
      console.error(`[ELIZA_DIAGNOSES] ❌ PERMISSION_DENIED or other error on path: ${logsPath}`, {
        uid: user?.uid,
        clinicId: clinic.id,
        error: error.message || error
      });
    });

    return () => {
      unsubIntegration();
      unsubConvos();
      unsubLogs();
    };
  }, [clinic, user]);

  // 2. Load and subscribe to active conversation's messages
  useEffect(() => {
    if (!clinic) return;
    
    if (!selectedConvo) {
      if (conversations && conversations.length > 0) {
        setMessages([
          {
            id: 'convo_select_placeholder',
            role: 'assistant',
            content: 'Selecione uma conversa de WhatsApp na lista lateral para iniciar o atendimento.'
          }
        ]);
      } else {
        // If no active thread is selected, we provide the dummy ELIZA chat flow as trial/playground
        setMessages([
          {
            id: '1',
            role: 'assistant',
            content: 'Olá! Eu sou a Elisa AI. No momento seu WhatsApp ainda não tem conversas ativas ou está aguardando conexões. Você pode experimentar meu playground de atendimento digitando abaixo, ou configurar a API em Ajustes!'
          }
        ]);
      }
      return;
    }

    console.log("[CHAT SELECTED]", {
      conversationId: selectedConvo.id,
      patientName: selectedConvo.patientName || "Contato Sem Nome",
      patientPhone: selectedConvo.patientPhone || "Sem Telefone"
    });

    // Reset unread count upon viewing conversation
    if (selectedConvo.unreadCount > 0) {
      const convoDocRef = doc(db, 'clinics', clinic.id, 'whatsapp_conversations', selectedConvo.id);
      const convoUpdatePath = `clinics/${clinic.id}/whatsapp_conversations/${selectedConvo.id}`;
      console.log("[ELIZA_DIAGNOSES] Performing updateDoc write operation:", {
        uid: user?.uid,
        clinicId: clinic.id,
        path: convoUpdatePath,
        operation: "write"
      });
      updateDoc(convoDocRef, { unreadCount: 0 }).catch(err => {
        console.error(`[ELIZA_DIAGNOSES] ❌ Failed resetting unread count for path: ${convoUpdatePath}`, {
          uid: user?.uid,
          clinicId: clinic.id,
          error: err.message || err
        });
      });
    }

    // Subscribe to messages subcollection
    const messagesSubcollectionPath = `clinics/${clinic.id}/whatsapp_conversations/${selectedConvo.id}/messages`;
    console.log("[ELIZA_DIAGNOSES] Initializing onSnapshot listener:", {
      uid: user?.uid,
      clinicId: clinic.id,
      path: messagesSubcollectionPath,
      operation: "listen"
    });

    const msgQuery = query(
      collection(db, 'clinics', clinic.id, 'whatsapp_conversations', selectedConvo.id, 'messages'),
      limit(100)
    );

    const unsubMessages = onSnapshot(msgQuery, (snap) => {
      console.log("[CHAT MESSAGES LISTENER]", {
        path: messagesSubcollectionPath,
        messageCount: snap.size
      });

      const msgList = snap.docs.map(d => {
        const dData = d.data();
        let dateObj = new Date();
        const rawTime = dData.timestamp || dData.createdAt || dData.created_at;
        if (rawTime) {
          dateObj = rawTime.toDate ? rawTime.toDate() : new Date(rawTime);
        }
        
        // Resolve role based on direction or sender or role
        const isUser = dData.direction === 'inbound' || String(dData.role || "").toLowerCase() === 'user' || String(dData.direction || "").toLowerCase() === 'received';
        const role = isUser ? 'user' as const : 'assistant' as const;
        
        // Use fallbacks for message body text: text, body, content, message, textBody
        const content = dData.text || dData.body || dData.content || dData.message || dData.textBody || "";
        
        return {
          id: d.id,
          role,
          content,
          timestamp: dateObj,
          whatsappMessageId: dData.whatsappMessageId || null,
          sentBy: dData.sentBy || null,
          status: dData.status || null,
          errorCode: dData.errorCode || null,
          errorMessage: dData.errorMessage || null,
          metaResponse: dData.metaResponse || null,
          metaStatus: dData.metaStatus || null,
          waId: dData.waId || dData.metaResponse?.contacts?.[0]?.wa_id || null
        };
      });

      // Sort in memory by timestamp ascending to handle messages without timestamp gracefully
      msgList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      if (msgList.length === 0) {
        setMessages([
          {
            id: 'convo_created_no_messages',
            role: 'assistant',
            content: 'Conversa criada, mas ainda sem mensagens salvas no histórico.'
          }
        ]);
      } else {
        setMessages(msgList);
      }
      setTimeout(scrollToBottom, 80);
    }, (error) => {
      console.error("[CHAT MESSAGES ERROR]", {
        path: messagesSubcollectionPath,
        error: error.message || error
      });
      console.error(`[CHAT_INTERFACE_ONSNAPSHOT] Error subscribing to messages: ${error.message || error}`);
    });

    return () => {
      unsubMessages();
    };

  }, [clinic, selectedConvo?.id, user, conversations.length]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle message sending (hybrid: WhatsApp call or playground fallback)
  const handleSend = async () => {
    if (!input.trim() || isLoading || messageSending) return;

    if (!selectedConvo) {
      // PLAYGROUND MODE: Interactive simulation using Gemini
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: input.trim(),
        timestamp: new Date()
      };

      setMessages(prev => [...prev, userMessage]);
      setInput('');
      setIsLoading(true);

      try {
        const responseText = await getElisaResponse(
          [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          {
            appointments: 3,
            pendingTasks: 5,
            activeIssues: 2,
            lastClosingStatus: 'Concluído'
          }
        );
        
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: responseText,
          timestamp: new Date()
        }]);
      } catch (error) {
        console.error(error);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Desculpe, tive um probleminha em simular a resposta de Eliza no momento. Verifique as configurações de chave!'
        }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // REAL WHATSAPP OUTBOUND SENDER
    if (!clinic) return;
    const msgText = input.trim();
    setInput('');
    setMessageSending(true);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          conversationId: selectedConvo.id,
          text: msgText
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Erro na transmissão do servidor.');
      }
      // UI responds in real-time from the database snapshot subscription!
    } catch (err: any) {
      console.error("[ChatInterface] Send error:", err);
      // Display failure notice inside chat log visually
      setMessages(prev => [...prev, {
        id: 'err_' + Date.now(),
        role: 'assistant',
        content: `❌ Falha ao transmitir mensagem via WhatsApp Cloud API de Meta: ${err.message}. Verifique o token de acesso!`
      }]);
    } finally {
      setMessageSending(false);
    }
  };

  // Preset Template Quick actions
  const applyActionTemplate = (templateType: string) => {
    if (!selectedConvo) {
      alert("Selecione uma conversa ativa de WhatsApp na lista lateral antes de enviar sugestões!");
      return;
    }

    const patientNameRaw = selectedConvo.patientName || "Contato sem nome";
    const name = patientNameRaw.split(' ')[0] || "Paciente";
    let customText = '';

    if (templateType === 'confirm') {
      customText = `Olá, ${name}! Tudo bem? 😊 Confirmamos seu agendamento aqui na clínica para amanhã. Podemos contar com sua presença? Dr. Portella e equipe te aguardam!`;
    } else if (templateType === 'rescue') {
      customText = `Oi, ${name}! Sentimos sua falta. Faz um tempo que você não nos visita para reavaliar seu tratamento. Quer que eu veja algumas janelas disponíveis esta semana?`;
    } else if (templateType === 'pre_op') {
      customText = `Lembrete Importante para ${name} ⚠️: Lembramos que para sua avaliação cirúrgica amanhã é ideal manter 8 horas de jejum. Qualquer dúvida estamos à disposição!`;
    }

    setInput(customText);
  };

  const handleManualTestSendInsideModal = async () => {
    if (!clinic) return;
    if (!testPhone) {
      alert("Por favor, informe o número de teste!");
      return;
    }
    setTestSending(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          conversationId: testPhone.trim(),
          text: 'Olá! Conexão ativa e integrada. Você operacionalizou este envio diretamente do painel de controle ELIZA AI.'
        })
      });

      const resJson = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: 'Mensagem de teste disparada com êxito! Verifique o receptor.' });
      } else {
        setTestResult({ success: false, message: 'Erro: ' + (resJson.error || 'Falha desconhecida.') });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: 'Falha de requisição: ' + err.message });
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div className="w-full h-full bg-slate-50 flex flex-col overflow-hidden font-sans text-slate-800 border border-slate-200">
      
      {/* Header with real status lights */}
      <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-teal-600 rounded-2xl flex items-center justify-center text-white font-black text-xl ring-4 ring-teal-50">E</div>
          <div>
            <h1 className="text-sm font-black tracking-tight text-slate-900 leading-tight uppercase">Central de Atendimento</h1>
            <p className="text-[10px] text-teal-600 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-emerald-500"></span>
              ELIZA AI ativa
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowAutomationModal(true)}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/10 active:scale-95"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Painel Automation
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: Live conversations list */}
        <aside className={`w-full md:w-80 bg-white border-r border-slate-200 p-6 flex flex-col shrink-0 overflow-hidden ${
          mobileView === 'list' ? 'flex' : 'hidden md:flex'
        }`}>
          
          <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3 shrink-0">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Atendimento WhatsApp</h3>
            <span className="text-[8px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded tracking-wider uppercase font-mono">
              {centralView === 'conversations' ? `${conversations.length} Ativas` : `${clinicPatients.length} Pacientes`}
            </span>
          </div>

          {/* Conversas / Pacientes switcher tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl mb-4 shrink-0 border border-slate-200/50">
            <button
              onClick={() => setCentralView('conversations')}
              className={`flex-1 py-1.5 text-center text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                centralView === 'conversations'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Conversas
            </button>
            <button
              onClick={() => setCentralView('patients')}
              className={`flex-1 py-1.5 text-center text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                centralView === 'patients'
                  ? 'bg-white text-teal-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Pacientes
            </button>
          </div>

          {centralView === 'conversations' ? (
            <>
              {/* Subheader tabs for splitting conversations as horizontal chips (Part 12) */}
              <div className="flex gap-1.5 overflow-x-auto pb-3 mb-4 scrollbar-none shrink-0" style={{ WebkitOverflowScrolling: 'touch' }}>
                {[
                  { id: 'all', label: 'Todas', count: conversations.length },
                  { id: 'unread', label: 'Não Lidas', count: conversations.filter(c => c.unreadCount > 0).length },
                  { id: 'linked', label: 'Vinculados', count: conversations.filter(c => c.matchedPatient || c.patientId).length },
                  { id: 'unlinked', label: 'Sem Cadastro', count: conversations.filter(c => !c.matchedPatient && !c.patientId).length },
                  { id: 'waiting', label: 'Aguardando', count: conversations.filter(c => c.status === 'aguardando').length },
                  { id: 'ai_suggested', label: 'IA Sugeriu', count: conversations.filter(c => c.aiEnabled).length },
                  { id: 'priority', label: 'Prioridade', count: conversations.filter(c => c.priority === 'high' || c.isPriority === true).length },
                ].map(chip => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setSidebarTab(chip.id as any)}
                    className={`py-1.5 px-3 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap transition-all border shrink-0 ${
                      sidebarTab === chip.id 
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-600/10' 
                        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                  >
                    {chip.label} ({chip.count})
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                {conversations.length === 0 ? (
                  <div className="py-12 px-4 text-center border border-dashed border-slate-200 rounded-2xl space-y-3">
                    <MessageSquare className="w-8 h-8 text-slate-350 mx-auto animate-pulse" />
                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Aguardando Webhooks</p>
                    <p className="text-[9px] text-slate-400 leading-normal">
                      Suas interações e contatos oficiais do WhatsApp irão aparecer aqui de forma instantânea.
                    </p>
                  </div>
                ) : (() => {
                  const filteredList = conversations.filter((convo) => {
                    if (sidebarTab === 'all') return true;
                    if (sidebarTab === 'unread') return convo.unreadCount > 0;
                    if (sidebarTab === 'linked') return !!(convo.matchedPatient || convo.patientId);
                    if (sidebarTab === 'unlinked') return !(convo.matchedPatient || convo.patientId);
                    if (sidebarTab === 'waiting') return convo.status === 'aguardando';
                    if (sidebarTab === 'ai_suggested') return convo.aiEnabled;
                    if (sidebarTab === 'priority') return convo.priority === 'high' || convo.isPriority === true;
                    return true;
                  });

                  if (filteredList.length === 0) {
                    return (
                      <div className="py-8 px-4 text-center text-slate-400 border border-dashed border-slate-150 rounded-2xl">
                        <p className="text-[10px] font-black uppercase tracking-wider">Nenhuma conversa encontrada</p>
                      </div>
                    );
                  }

                  return filteredList.map((convo) => {
                    const isActive = selectedConvo && selectedConvo.id === convo.id;
                    const isLinkedConvo = !!(convo.matchedPatient || convo.patientId);
                    return (
                      <button
                        key={convo.id}
                        onClick={() => {
                          setSelectedConvo(convo);
                          setMobileView('chat');
                        }}
                        className={`w-full text-left p-3.5 rounded-2xl border transition-all flex flex-col gap-2 relative ${
                          isActive 
                            ? 'bg-teal-50/50 border-teal-200 shadow-sm ring-1 ring-teal-150' 
                            : 'bg-white border-slate-150 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-3 w-full">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 border ${
                            isLinkedConvo 
                              ? 'bg-teal-50 text-teal-600 border-teal-200' 
                              : 'bg-amber-50 text-amber-600 border-amber-200'
                          }`}>
                            {(convo.patientName || "?").substring(0, 1).toUpperCase()}
                          </div>

                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-black text-slate-800 truncate block">
                                {convo.patientName || "Contato não identificado"}
                              </span>
                              <span className="text-[8px] text-slate-400 font-bold whitespace-nowrap">
                                {convo.lastMessageAt ? new Date(convo.lastMessageAt.toDate ? convo.lastMessageAt.toDate() : convo.lastMessageAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : 'Agora'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-100 font-bold bg-amber-500/10 text-amber-700 px-1.5 py-0.5 rounded w-max mt-1 text-[8px] uppercase tracking-wider">
                              {!isLinkedConvo ? "Não Identificado" : "Paciente Ativo"}
                            </p>
                            <p className="text-[10px] text-slate-450 truncate mt-1 font-medium select-none">
                              {String(convo.lastMessage ?? "").trim() || 'Linha direta...'}
                            </p>
                          </div>
                        </div>

                        {!isLinkedConvo && (
                          <div className="w-full pt-2 border-t border-dashed border-slate-100 flex items-center justify-between mt-1">
                            <span className="text-[8px] font-mono font-bold text-slate-450">Tel: +{convo.id}</span>
                            <span 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setConvoToLink(convo); 
                              }} 
                              className="text-[8px] uppercase tracking-wider font-black text-teal-600 hover:text-teal-700 hover:underline cursor-pointer transition-all"
                            >
                              Vincular a Paciente
                            </span>
                          </div>
                        )}

                        {convo.unreadCount > 0 && (
                          <span className="absolute right-3.5 top-3.5 w-4.5 h-4.5 bg-emerald-500 rounded-full text-white text-[8px] font-black flex items-center justify-center shadow-md animate-bounce">
                            {convo.unreadCount}
                          </span>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="relative mb-4 shrink-0">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3.5 text-slate-450" />
                <input
                  type="text"
                  placeholder="Buscar por nome ou número..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold leading-none uppercase tracking-wide focus:outline-none focus:border-teal-500 focus:bg-white transition-all text-slate-700 placeholder-slate-450"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar pr-1">
                {(() => {
                  const filtered = clinicPatients.filter(p => {
                    const nameLower = (p.name || "").toLowerCase();
                    const phoneClean = (p.phone || p.telefone || p.whatsapp || p.cellphone || p.celular || p.mobile || "").replace(/\D/g, "");
                    const term = patientSearch.trim().toLowerCase();
                    
                    if (!term) return !!phoneClean; // only patients with a phone number
                    return (nameLower.includes(term) || phoneClean.includes(term)) && !!phoneClean;
                  }).slice(0, 30);

                  if (filtered.length === 0) {
                    return (
                      <div className="py-12 px-4 text-center border border-dashed border-slate-200 rounded-2xl">
                        <UserRoundIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-wider">Nenhum paciente encontrado</p>
                        <p className="text-[9px] text-slate-400 leading-normal mt-1">Busque pelo nome ou garanta que possui um número de telefone salvo.</p>
                      </div>
                    );
                  }

                  return filtered.map(p => {
                    const phoneRaw = p.phone || p.telefone || p.whatsapp || p.cellphone || p.celular || p.mobile || "";
                    const normalizedPhone = phoneRaw.replace(/\D/g, "");
                    return (
                      <button
                        key={p.id}
                        onClick={() => handleSelectPatient(p)}
                        className="w-full p-3.5 bg-white hover:bg-neutral-50 border border-slate-150 hover:border-teal-200 rounded-2xl flex items-center justify-between transition-all text-left shadow-sm group active:scale-[0.99]"
                      >
                        <div className="min-w-0 pr-3">
                          <span className="text-xs font-black text-slate-800 truncate block uppercase group-hover:text-teal-700">
                            {p.name || "Paciente sem nome"}
                          </span>
                          <span className="text-[9px] font-mono text-slate-400 font-bold block mt-1">
                            +{normalizedPhone}
                          </span>
                        </div>
                        <div className="w-7 h-7 bg-teal-50 text-teal-600 rounded-xl flex items-center justify-center shrink-0 border border-teal-100 group-hover:bg-teal-600 group-hover:text-white group-hover:border-teal-600 transition-all">
                          <MessageSquare className="w-3.5 h-3.5" />
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* Current Selection mini card overlay */}
          {selectedConvo && (() => {
            const patientNameSafe = selectedConvo.patientName || "Contato sem nome";
            const rawPhone = String(selectedConvo.patientPhone ?? "").trim();
            const formattedPhone = rawPhone 
              ? `(${rawPhone.slice(0, 2)}) ${rawPhone.slice(2, 4)} ${rawPhone.slice(4)}`
              : "Telefone não informado";
            return (
              <div className="mt-4 pt-4 border-t border-slate-150 space-y-3 shrink-0">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block">Paciente em Linha</span>
                <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 flex items-center gap-3">
                  <div className="w-8 h-8 bg-teal-50 rounded-full flex items-center justify-center border border-teal-150 text-teal-600">
                    <UserRoundIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 max-w-full">
                    <p className="text-xs font-black text-slate-900 truncate">{patientNameSafe}</p>
                    <p className="text-[9px] text-slate-450 font-mono">+{selectedConvo.id}</p>
                  </div>
                </div>
              </div>
            );
          })()}

        </aside>

        {/* Chat Area */}
        <div className={`flex-1 flex flex-col bg-slate-50 relative ${
          mobileView === 'chat' ? 'flex' : 'hidden md:flex'
        }`}>
          
          {selectedConvo && (
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 flex items-center justify-between z-10 w-full">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="md:hidden p-1.5 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-all shrink-0"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black border uppercase shrink-0 ${
                  !!(selectedConvo.matchedPatient || selectedConvo.patientId)
                    ? 'bg-teal-50 text-teal-600 border-teal-200' 
                    : 'bg-amber-50 text-amber-600 border-amber-200'
                }`}>
                  {(selectedConvo.patientName || "?").substring(0, 1)}
                </div>

                <div className="min-w-0">
                  <h4 className="text-xs font-black text-slate-800 flex items-center gap-2">
                    <span className="truncate block max-w-[120px] sm:max-w-none">{selectedConvo.patientName || "Contato não identificado"}</span>
                    {!(selectedConvo.matchedPatient || selectedConvo.patientId) ? (
                      <span className="bg-amber-50 text-amber-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide shrink-0">Sem Cadastro</span>
                    ) : (
                      <span className="bg-teal-50 text-teal-700 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wide shrink-0">Paciente Ativo</span>
                    )}
                  </h4>
                  <p className="text-[9px] text-slate-400 font-mono mt-0.5">+{selectedConvo.id}</p>
                </div>
              </div>

              <button 
                type="button"
                onClick={() => setShowAIPanelSheet(true)}
                className="xl:hidden flex items-center gap-1.5 px-3 py-1.5 border border-teal-200 bg-teal-50 text-teal-700 text-[9px] font-extrabold uppercase tracking-wider rounded-lg active:scale-95 transition-all cursor-pointer hover:bg-teal-100"
              >
                <Sparkles className="w-3.5 h-3.5 animate-pulse text-teal-500" />
                Sugestões AI
              </button>
            </div>
          )}
          
          {selectedConvo && !(selectedConvo.matchedPatient || selectedConvo.patientId) && (
            <div className="bg-amber-50 border-b border-amber-200/60 px-8 py-3.5 flex items-center justify-between gap-4 shrink-0 transition-colors z-10 animate-fade-in">
              <div className="flex items-center gap-2.5 text-amber-800 text-xs font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                <span>Esse contato ainda não está vinculado a um paciente cadastrado na clínica.</span>
              </div>
              <button
                onClick={() => setConvoToLink(selectedConvo)}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all select-none cursor-pointer shadow-sm shadow-amber-600/10 active:scale-95"
              >
                Vincular a Paciente
              </button>
            </div>
          )}
          
          <div className="flex-1 p-8 overflow-y-auto flex flex-col gap-6 custom-scrollbar bg-slate-50/55">
            <AnimatePresence initial={false}>
              {messages.map((message) => {
                const isSystemNotice = message.id.startsWith('err_');
                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={`flex gap-4 max-w-[85%] ${
                      isSystemNotice 
                        ? 'self-center w-full max-w-xl' 
                        : message.role === 'user' 
                          ? 'self-start' 
                          : 'self-end flex-row-reverse'
                    }`}
                  >
                    {!isSystemNotice && (
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 shadow-sm ${
                        message.role === 'user' ? 'bg-slate-900 text-white' : 'bg-teal-600 text-white'
                      }`}>
                        {message.role === 'user' ? 'P' : 'E'}
                      </div>
                    )}
                    
                    <div className={`p-4 rounded-2xl border ${
                      isSystemNotice
                        ? 'w-full bg-rose-50 text-rose-800 border-rose-100/50 text-xs text-center'
                        : message.role === 'user'
                          ? 'bg-white border-slate-200 rounded-tl-none shadow-sm text-slate-800'
                          : 'bg-teal-700 text-white border-teal-800 rounded-tr-none shadow-sm shadow-teal-700/5'
                    }`}>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap font-medium">
                        {String(message.content ?? "").trim() || "Mensagem sem texto"}
                      </p>
                      
                      {message.timestamp && !isSystemNotice && (
                        <div className="flex items-center justify-between mt-2 gap-2 select-none">
                          {message.role === 'assistant' && message.whatsappMessageId && (
                            <span className="text-[7.5px] font-mono bg-black/15 px-1.5 py-0.5 rounded-md max-w-[150px] truncate text-teal-100/90" title={`ID da Meta: ${message.whatsappMessageId}`}>
                              ID: {message.whatsappMessageId.replace("wamid.", "")}
                              {message.status && ` (${message.status.toUpperCase()})`}
                              {message.errorCode && ` [Erro: ${message.errorCode}]`}
                            </span>
                          )}
                          <span className={`block text-[8px] opacity-65 text-right ml-auto ${
                            message.role === 'user' ? 'text-slate-400' : 'text-teal-200'
                          }`}>
                            {message.timestamp.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}
                            {message.sentBy && ` • via ${message.sentBy}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          {/* Typing Box */}
          <div className="h-28 bg-white border-t border-slate-200 p-6 flex items-center gap-4 shrink-0">
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={selectedConvo ? `Enviar para ${selectedConvo.patientName || "Contato sem nome"}...` : "Configure o WhatsApp ou experimente digitar no playground..."}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl h-14 pl-6 pr-16 focus:ring-2 focus:ring-teal-500/10 focus:border-teal-600 outline-none transition-all text-xs font-semibold placeholder:text-slate-400 font-sans"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading || messageSending}
                className={`absolute right-2 h-10 w-10 flex items-center justify-center rounded-xl transition-all ${
                  input.trim() && !isLoading && !messageSending
                    ? 'bg-teal-600 text-white shadow-md hover:bg-teal-700 active:scale-95'
                    : 'bg-slate-100 text-slate-300'
                }`}
              >
                {messageSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4.5 h-4.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Quick Actions suggestions */}
        <aside className="hidden xl:flex w-72 bg-white border-l border-slate-200 p-6 flex-col gap-6 shrink-0">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Modelos Recomendados</h3>
              <Cpu className="w-4.5 h-4.5 text-teal-600" />
            </div>

            <div className="space-y-3">
              <button 
                onClick={() => applyActionTemplate('confirm')}
                className="w-full text-left text-xs p-4 border border-emerald-100 bg-emerald-50/50 rounded-2xl text-emerald-800 hover:bg-emerald-50 transition-colors font-bold flex items-center justify-between"
              >
                <span>Confirmar Consulta</span>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              </button>
              
              <button 
                onClick={() => applyActionTemplate('rescue')}
                className="w-full text-left text-xs p-4 border border-slate-150 bg-slate-50 rounded-2xl text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors font-bold flex items-center justify-between"
              >
                <span>Resgatar Paciente</span>
                <Clock className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button 
                onClick={() => applyActionTemplate('pre_op')}
                className="w-full text-left text-xs p-4 border border-slate-150 bg-slate-50 rounded-2xl text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors font-bold flex items-center justify-between"
              >
                <span>Lembrete Cirúrgico</span>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              </button>
            </div>
          </div>

          {/* Status Real da Meta diagnostic block */}
          <div className="border border-slate-200/60 bg-slate-50/55 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3.5">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Status Real da Meta</h4>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
            </div>

            {(() => {
              const lastOutbound = [...messages].reverse().find(m => m.role === 'assistant' && !m.id.startsWith('err_'));
              if (!lastOutbound) {
                return (
                  <p className="text-[10px] text-slate-400 font-semibold italic text-center py-3">
                    Nenhuma mensagem enviada nesta sessão para consulta.
                  </p>
                );
              }

              const isAccepted = !!(lastOutbound.whatsappMessageId && !lastOutbound.errorCode && lastOutbound.status !== 'failed');
              const isFailed = lastOutbound.status === 'failed' || !!lastOutbound.errorCode;
              const metaId = lastOutbound.whatsappMessageId || 'N/A';
              const waIdVal = lastOutbound.waId || 'N/A';
              const errCode = lastOutbound.errorCode || 'Nenhum';
              const httpCode = lastOutbound.metaStatus || 'N/A';

              return (
                <div className="space-y-2.5 text-[11px] font-semibold text-slate-700">
                  <div className="flex justify-between items-center py-1 border-b border-slate-100/50">
                    <span className="text-slate-400 font-black uppercase text-[8px] tracking-wider">Aceito (ACCEPTED)</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      isAccepted ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {isAccepted ? 'SIM' : 'NÃO'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-1 border-b border-slate-100/50">
                    <span className="text-slate-400 font-black uppercase text-[8px] tracking-wider">Falhado (FAILED)</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      isFailed ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {isFailed ? 'SIM' : 'NÃO'}
                    </span>
                  </div>

                  <div className="py-1 border-b border-slate-100/50 space-y-0.5">
                    <span className="text-slate-400 font-black uppercase text-[8px] tracking-wider block">MESSAGE_ID</span>
                    <span className="font-mono text-[9px] truncate block text-slate-600 bg-white border border-slate-100 p-1 rounded-lg" title={metaId}>
                      {metaId}
                    </span>
                  </div>

                  <div className="py-1 border-b border-slate-100/50 space-y-0.5">
                    <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider block">WA_ID</span>
                    <span className="font-mono text-[9px] truncate block text-slate-600 bg-white border border-slate-100 p-1 rounded-lg" title={waIdVal}>
                      {waIdVal}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-1 border-b border-slate-100/50">
                    <span className="text-slate-400 font-black uppercase text-[8px] tracking-wider">Status Recente</span>
                    <span className="font-mono text-[10px] uppercase font-black text-slate-800">
                      {lastOutbound.status || 'sent'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center py-1 border-b border-slate-100/50">
                    <span className="text-slate-450 font-black uppercase text-[8px] tracking-wider">Código de Erro</span>
                    <span className="font-mono text-[10px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-lg border border-rose-100/30">
                      {errCode}
                    </span>
                  </div>

                  {lastOutbound.errorMessage && (
                    <div className="p-2.5 bg-rose-50 border border-rose-100/50 rounded-xl text-[10px] text-rose-800 leading-normal font-semibold mt-1 font-mono">
                      {lastOutbound.errorMessage}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* AI Cognitive Insights Box */}
          <div className="p-6 bg-slate-900 rounded-[2rem] text-white shadow-xl relative overflow-hidden group border border-slate-850">
            <div className="absolute top-0 right-0 w-32 h-32 bg-teal-600/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-700"></div>
            <h4 className="text-[10px] font-black uppercase tracking-widest mb-4 opacity-60 text-teal-400">Sugestão de Resposta AI</h4>
            <div className="space-y-4">
              <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                <p className="text-[10px] font-black text-teal-400 uppercase mb-1 flex items-center gap-1"><BrainCircuit className="w-3.5 h-3.5 text-teal-400" /> Recomendação Comercial</p>
                <p className="text-xs font-semibold leading-normal">
                  {selectedConvo 
                    ? `Oferecer reavaliação de botox pós 5 meses para ${(selectedConvo.patientName || "Contato sem nome").split(' ')[0] || "Paciente"}` 
                    : 'Oferecer retoque preventivo'}
                </p>
              </div>
              <p className="text-[11px] opacity-75 leading-relaxed font-bold">
                A IA de ELIZA prescreve manter a aprovação humana ativa antes do disparo automático.
              </p>
            </div>
          </div>

          <div className="mt-auto border-t border-slate-100 pt-6">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-black uppercase tracking-widest">
              <span>Engajamento Técnico</span>
              <span className="text-teal-600">Alta Sinergia</span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2.5 overflow-hidden">
              <div className="bg-teal-500 h-full w-[95%]"></div>
            </div>
          </div>
        </aside>

        {/* Immersive AI Suggestions Drawer (Mobile/Tablet) */}
        <AnimatePresence>
          {showAIPanelSheet && (
            <div className="fixed inset-0 z-[250] flex items-end justify-center p-0 md:p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAIPanelSheet(false)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 220 }}
                className="relative w-full md:max-w-md bg-white rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl p-8 overflow-hidden max-h-[85vh] flex flex-col z-10"
              >
                {/* Grab handle for drawer */}
                <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-6 shrink-0 block md:hidden" />
                
                <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6 select-none">
                  <div>
                    <h3 className="text-sm font-black text-slate-800 tracking-wider flex items-center gap-1.5 uppercase">
                      <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" />
                      Sugestões ELIZA AI
                    </h3>
                    <p className="text-[9px] text-slate-400 font-bold uppercase mt-1 tracking-widest font-mono">Recomendações e insights de resposta</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAIPanelSheet(false)}
                    className="p-1 px-3 text-slate-500 hover:text-slate-850 hover:bg-slate-50 font-black text-[9px] uppercase tracking-wide border rounded-xl"
                  >
                    Fechar X
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">
                  
                  {/* Modelos Recomendados */}
                  <div className="space-y-3">
                    <span className="text-[8px] font-black text-slate-450 uppercase tracking-widest block">Ações Rápidas em Conversa</span>
                    <button 
                      type="button"
                      onClick={() => { applyActionTemplate('confirm'); setShowAIPanelSheet(false); }}
                      className="w-full text-left text-xs p-4 border border-emerald-100 bg-emerald-50/50 rounded-2xl text-emerald-800 hover:bg-emerald-50 transition-colors font-bold flex items-center justify-between"
                    >
                      <span>Confirmar Consulta</span>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    </button>
                    
                    <button 
                      type="button"
                      onClick={() => { applyActionTemplate('rescue'); setShowAIPanelSheet(false); }}
                      className="w-full text-left text-xs p-4 border border-slate-150 bg-slate-50 rounded-2xl text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors font-bold flex items-center justify-between"
                    >
                      <span>Resgatar Paciente</span>
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                    </button>

                    <button 
                      type="button"
                      onClick={() => { applyActionTemplate('pre_op'); setShowAIPanelSheet(false); }}
                      className="w-full text-left text-xs p-4 border border-slate-150 bg-slate-50 rounded-2xl text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-colors font-bold flex items-center justify-between"
                    >
                      <span>Lembrete Cirúrgico</span>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                    </button>
                  </div>

                  {/* AI Cognitive Insights Box */}
                  <div className="p-6 bg-slate-900 rounded-[2rem] text-white shadow-xl relative overflow-hidden">
                    <h4 className="text-[10px] font-black uppercase tracking-widest mb-4 opacity-60 text-teal-400">Sugestão de Resposta AI</h4>
                    <div className="space-y-4">
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
                        <p className="text-[10px] font-black text-teal-400 uppercase mb-1">Recomendação Comercial</p>
                        <p className="text-xs font-semibold leading-normal">
                          {selectedConvo 
                            ? `Oferecer reavaliação de botox pós 5 meses para ${(selectedConvo.patientName || "Contato sem nome").split(' ')[0] || "Paciente"}` 
                            : 'Oferecer retoque preventivo'}
                        </p>
                      </div>
                      <p className="text-[11px] opacity-75 leading-relaxed font-bold">
                        A IA de ELIZA prescreve manter a aprovação humana ativa antes do disparo automático.
                      </p>
                    </div>
                  </div>

                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>

      {/* WhatsApp Automation Dashboard Modal */}
      {showAutomationModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-[300] flex items-center justify-center p-6 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl w-full max-w-2xl p-8 shadow-2xl relative overflow-hidden font-sans"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500"></div>
            <button 
              onClick={() => setShowAutomationModal(false)}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 transition-colors font-black text-sm uppercase"
            >
              Fechar X
            </button>

            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase">WhatsApp Automation Hub</h3>
                <p className="text-xs text-slate-500 font-medium">Controle de sincronização instantânea de IA e Webhooks Meta.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Left Column: Integration parameters and direct test send */}
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Parâmetros Ativos</h4>
                  
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between border-b border-slate-150 pb-1.5">
                      <span className="text-slate-500">Status Conexão:</span>
                      <span className={`font-bold px-2 py-0.5 rounded text-[10px] uppercase ${
                        integrationStatus === 'conectado' ? 'bg-emerald-55 text-emerald-700' : 'bg-amber-55 text-amber-700'
                      }`}>
                        {integrationStatus}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-150 pb-1.5">
                      <span className="text-slate-500 font-medium">Phone Number ID:</span>
                      <span className="font-mono text-slate-700 text-[10px] break-all max-w-[150px] text-right truncate" title={integration?.phoneNumberId || 'Pendente'}>
                        {integration?.phoneNumberId || 'Não Cadastrado'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-150 pb-1.5">
                      <span className="text-slate-500 font-medium">Meta WABA ID:</span>
                      <span className="font-mono text-slate-700 text-[10px] break-all max-w-[150px] text-right truncate" title={integration?.wabaId || 'Pendente'}>
                        {integration?.wabaId || 'Não Cadastrado'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-b border-slate-155 pb-1.5">
                      <span className="text-slate-500 font-medium">Verify Token:</span>
                      <span className="font-mono text-slate-700 text-[10px] font-bold text-right">
                        {integration?.verifyToken || 'eliza_secret_token'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Webhook URL:</span>
                      <span className="font-mono text-slate-600 text-[9px] break-all max-w-[160px] text-right truncate" title={integration?.webhookUrl}>
                        {integration?.webhookUrl || '/api/whatsapp/webhook'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Direct Test Unit */}
                <div className="bg-emerald-50/20 border border-emerald-100 p-4 rounded-2xl space-y-3">
                  <span className="text-[9px] font-black text-emerald-800 uppercase tracking-wide block">Disparo de Teste Rápido</span>
                  
                  <div className="flex items-center gap-2">
                    <input 
                      type="text"
                      placeholder="Ex: 5511999999999"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-teal-500 transition-all font-mono"
                    />
                    <button
                      onClick={handleManualTestSendInsideModal}
                      disabled={testSending || !testPhone}
                      className="px-3.5 py-1.7 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-[10px] uppercase tracking-wider font-extrabold rounded-xl shrink-0 transition-colors"
                    >
                      {testSending ? 'Transmitindo...' : 'Disparar'}
                    </button>
                  </div>

                  {testResult && (
                    <p className={`text-[10px] leading-relaxed p-2 rounded-lg border ${
                      testResult.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-55 text-rose-800 border-rose-200'
                    }`}>
                      {testResult.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Right Column: Recent debug transaction logs */}
              <div className="space-y-3">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Histórico Operacional Recente</span>
                
                <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar">
                  {recentLogs.length === 0 ? (
                    <p className="text-[10px] text-slate-400 font-bold text-center py-12">Nenhum evento registrado ainda.</p>
                  ) : (
                    recentLogs.map((log) => (
                      <div key={log.id} className="p-2.5 bg-slate-50 border border-slate-150 rounded-xl text-[10px] space-y-0.5">
                        <div className="flex items-center justify-between text-[9px] font-bold">
                          <span className="text-slate-600 uppercase tracking-tight">{log.action || 'Fila'}</span>
                          <span className={log.status === 'success' ? 'text-emerald-600' : 'text-rose-600'}>
                            {log.status === 'success' ? 'SUCESSO' : 'ERRO'}
                          </span>
                        </div>
                        <p className="text-slate-600 leading-relaxed font-semibold">{log.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {integrationStatus !== 'conectado' && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <h5 className="text-xs font-black text-amber-900 uppercase">Atenção: Integração Inativa</h5>
                  <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
                    Seu sistema está operando em modo simulação playground. Para ativar a comunicação em tempo real via WhatsApp oficial, por favor configure os tokens e IDS de desenvolvedor Meta em: <strong className="text-amber-900">Ajustes &gt; WhatsApp</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-8 pt-5 border-t border-slate-100 text-right">
              <button 
                onClick={() => setShowAutomationModal(false)}
                className="px-6 py-3 bg-slate-900 text-white font-black hover:bg-slate-800 transition-colors uppercase tracking-widest text-[9.5px] rounded-xl"
              >
                Retornar ao Painel Chat
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Patient Linking Dialog Modal (Part 2) */}
      {convoToLink && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-xs">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden flex flex-col h-[520px] border border-slate-100"
          >
            <div className="bg-slate-900 text-white p-6 shrink-0 flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black uppercase tracking-widest text-teal-400 mb-1">Vincular Contato a Paciente</h4>
                <p className="text-[10px] text-slate-400 font-mono font-bold">Número: +{convoToLink.id}</p>
              </div>
              <button 
                onClick={() => { setConvoToLink(null); setPatientSearch(''); }}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 bg-slate-50 border-b border-slate-150 shrink-0">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Buscar paciente por nome, CPF ou Telefone..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 transition-all font-sans font-bold shadow-xs"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
              {(() => {
                const searchLower = patientSearch.toLowerCase().trim();
                const matched = clinicPatients.filter(p => {
                  if (!searchLower) return true;
                  return (
                    p.name?.toLowerCase().includes(searchLower) ||
                    p.cpf?.includes(searchLower) ||
                    (p.phone && p.phone.replace(/\D/g, '').includes(searchLower))
                  );
                });

                if (matched.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-wider">Nenhum paciente correspondente</p>
                      <p className="text-[9px] text-slate-400">Verifique a ortografia ou crie o cadastro do paciente primeiro em Pacientes.</p>
                    </div>
                  );
                }

                return matched.map(patient => (
                  <div key={patient.id} className="bg-slate-50 border border-slate-150 rounded-2xl p-4 flex items-center justify-between gap-4 hover:bg-slate-100/60 transition-all">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-800 truncate">{patient.name}</p>
                      <div className="flex items-center gap-3 text-[9px] text-slate-450 mt-1 font-mono font-bold">
                        {patient.cpf && <span>CPF: {patient.cpf}</span>}
                        {patient.phone && <span>Tel: {patient.phone}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => linkConversationToPatient(convoToLink, patient)}
                      className="px-3 py-1.5 bg-teal-650 hover:bg-teal-700 text-white text-[9.5px] font-black uppercase tracking-widest rounded-lg transition-all shadow-sm cursor-pointer select-none"
                    >
                      Vincular
                    </button>
                  </div>
                ));
              })()}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

class ChatErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ChatInterface rendering error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-slate-50 flex flex-col items-center justify-center p-8 border border-slate-200 rounded-3xl m-4 text-center font-sans space-y-4">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center border border-amber-150">
            <AlertTriangle className="w-8 h-8 text-amber-600 animate-bounce" />
          </div>
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-tight">Painel Indisponível Temporariamente</h2>
          <p className="text-xs text-slate-500 max-w-sm font-medium leading-relaxed">
            Ocorreu um erro ao carregar o chat ou as conversas do WhatsApp. Nós já registramos o ocorrido.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-slate-900 border border-slate-950 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95"
          >
            Recarregar Página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ChatInterfaceWithErrorBoundary() {
  return (
    <ChatErrorBoundary>
      <ChatInterface />
    </ChatErrorBoundary>
  );
}
