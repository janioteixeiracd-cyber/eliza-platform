import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Home, History, Receipt, CalendarPlus, Star, LogOut, Calendar, Clock,
  Loader2, CheckCircle2, MessageCircle, Send, ImageIcon, Activity, X,
  ClipboardList, ArrowLeft, ArrowRight, Sparkles,
} from 'lucide-react';
import { usePatientPortal } from './PatientPortalContext';
import InstallElizaButton from '../pwa/InstallElizaButton';

type Tab = 'home' | 'history' | 'quotations' | 'requests' | 'review' | 'anamnesis';

function formatDate(v: any): string {
  if (!v) return '—';
  try {
    const s = typeof v === 'string' ? v : (v?._seconds ? new Date(v._seconds * 1000).toISOString() : String(v));
    const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR');
  } catch { return '—'; }
}

function formatCurrency(v: number): string {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PatientPortalShell() {
  const { session, apiFetch, logout } = usePatientPortal();
  const [tab, setTab] = useState<Tab>('home');

  return (
    <div className="flex flex-col" style={{ background: '#07050c', height: 'var(--app-vh, 100dvh)' }}>
      <header
        className="flex-shrink-0 bg-slate-950/90 backdrop-blur-md border-b border-next-border px-5 py-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest truncate">{session?.clinicName || 'Portal do Paciente'}</p>
          <h1 className="text-sm font-bold text-slate-100 truncate">Olá, {(session?.patientName || '').split(' ')[0] || 'paciente'}</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <InstallElizaButton showLabel={false} title="Instalar app" className="w-9 h-9 rounded-xl bg-slate-900 border border-next-border text-next-purple-light hover:bg-next-purple-neon/15 flex items-center justify-center" />
          <button onClick={logout} title="Sair" className="w-9 h-9 rounded-xl bg-slate-900 border border-next-border text-slate-400 hover:text-next-red-alert flex items-center justify-center">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto max-w-lg w-full mx-auto p-5">
        {tab === 'home' && <HomeTab apiFetch={apiFetch} onNavigate={setTab} />}
        {tab === 'history' && <HistoryTab apiFetch={apiFetch} />}
        {tab === 'quotations' && <QuotationsTab apiFetch={apiFetch} />}
        {tab === 'requests' && <RequestsTab apiFetch={apiFetch} />}
        {tab === 'review' && <ReviewTab apiFetch={apiFetch} />}
        {tab === 'anamnesis' && <AnamnesisTab apiFetch={apiFetch} onDone={() => setTab('home')} />}
      </main>

      <nav
        className="flex-shrink-0 bg-slate-950/95 backdrop-blur-md border-t border-next-border flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {([
          { id: 'home', label: 'Início', icon: Home },
          { id: 'history', label: 'Histórico', icon: History },
          { id: 'quotations', label: 'Orçamentos', icon: Receipt },
          { id: 'requests', label: 'Solicitar', icon: CalendarPlus },
          { id: 'review', label: 'Avaliar', icon: Star },
        ] as { id: Tab; label: string; icon: any }[]).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[9.5px] font-bold uppercase tracking-wide ${active ? 'text-next-purple-light' : 'text-slate-500'}`}
              style={{ minHeight: '56px' }}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// --- HOME ------------------------------------------------------------

function HomeTab({ apiFetch, onNavigate }: { apiFetch: (p: string, o?: RequestInit) => Promise<any>; onNavigate: (t: Tab) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/home').then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [apiFetch]);

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-4">
      <ProfilePhotoPanel apiFetch={apiFetch} photoUrl={data?.photoUrl || null} patientName={data?.patientName || ''} onUploaded={(url) => setData((prev: any) => ({ ...prev, photoUrl: url }))} />

      <button
        onClick={() => onNavigate('anamnesis')}
        className={`w-full text-left rounded-next-2xl p-5 flex items-center gap-4 transition-colors ${data?.anamnesisSubmitted ? 'next-glass-panel hover:border-next-purple-neon/40' : 'next-brand-gradient-bg shadow-next-glow-purple'}`}
      >
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${data?.anamnesisSubmitted ? 'bg-next-purple-neon/15 text-next-purple-light' : 'bg-white/15 text-white'}`}>
          <ClipboardList className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-black ${data?.anamnesisSubmitted ? 'text-slate-200' : 'text-white'}`}>{data?.anamnesisSubmitted ? 'Anamnese enviada' : 'Preencher anamnese'}</p>
          <p className={`text-[10.5px] mt-0.5 ${data?.anamnesisSubmitted ? 'text-slate-500' : 'text-white/80'}`}>
            {data?.anamnesisSubmitted ? 'Você pode atualizar suas respostas a qualquer momento.' : 'Conte sua queixa principal e os procedimentos de interesse antes da consulta.'}
          </p>
        </div>
        <ArrowRight className={`w-4 h-4 flex-shrink-0 ${data?.anamnesisSubmitted ? 'text-slate-500' : 'text-white'}`} />
      </button>

      <div className="next-glass-panel rounded-next-2xl p-5">
        <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Próximo atendimento</p>
        {data?.nextAppointment ? (
          <div>
            <p className="text-lg font-black text-slate-100">{formatDate(data.nextAppointment.date)} {data.nextAppointment.time ? `às ${data.nextAppointment.time}` : ''}</p>
            <p className="text-xs text-slate-400 mt-1">{data.nextAppointment.treatment || 'Consulta'}{data.nextAppointment.dentistName ? ` · ${data.nextAppointment.dentistName}` : ''}</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Nenhum atendimento agendado no momento.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate('requests')} className="next-glass-panel rounded-next-xl p-4 text-left hover:border-next-purple-neon/40 transition-colors">
          <CalendarPlus className="w-5 h-5 text-next-purple-neon mb-2" />
          <p className="text-xs font-bold text-slate-200">Solicitar horário</p>
        </button>
        <button onClick={() => onNavigate('history')} className="next-glass-panel rounded-next-xl p-4 text-left hover:border-next-purple-neon/40 transition-colors">
          <History className="w-5 h-5 text-next-purple-neon mb-2" />
          <p className="text-xs font-bold text-slate-200">Meu histórico</p>
        </button>
        <button onClick={() => onNavigate('quotations')} className="next-glass-panel rounded-next-xl p-4 text-left hover:border-next-purple-neon/40 transition-colors">
          <Receipt className="w-5 h-5 text-next-purple-neon mb-2" />
          <p className="text-xs font-bold text-slate-200">Meus orçamentos</p>
        </button>
        <button onClick={() => onNavigate('review')} className="next-glass-panel rounded-next-xl p-4 text-left hover:border-next-purple-neon/40 transition-colors">
          <Star className="w-5 h-5 text-next-purple-neon mb-2" />
          <p className="text-xs font-bold text-slate-200">Avaliar atendimento</p>
        </button>
      </div>

      <PortalMessagesPanel apiFetch={apiFetch} hasUnread={!!data?.hasUnreadPortalMessages} />

      {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
    </div>
  );
}

// --- MINHA FOTO ------------------------------------------------------

function ProfilePhotoPanel({ apiFetch, photoUrl, patientName, onUploaded }: { apiFetch: (p: string, o?: RequestInit) => Promise<any>; photoUrl: string | null; patientName: string; onUploaded: (url: string) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) { setError('Foto muito grande — escolha uma imagem menor que 500KB.'); return; }
    setUploading(true);
    setError(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const photoBase64 = reader.result as string;
        await apiFetch('/profile-photo', { method: 'POST', body: JSON.stringify({ photoBase64 }) });
        onUploaded(photoBase64);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="next-glass-panel rounded-next-2xl p-4 flex items-center gap-3">
      {photoUrl ? (
        <img src={photoUrl} alt={patientName} className="w-14 h-14 rounded-2xl object-cover flex-shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-2xl bg-next-purple-neon/20 text-next-purple-light flex items-center justify-center font-black text-xl uppercase flex-shrink-0">
          {(patientName || '?').charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-200">Minha foto</p>
        <p className="text-[10.5px] text-slate-500 mt-0.5">Aparece pra equipe da clínica no seu prontuário e na agenda.</p>
        {error && <p className="text-[10px] text-next-red-alert mt-1">{error}</p>}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 px-2.5 py-1.5 rounded-lg flex-shrink-0 disabled:opacity-60">
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (photoUrl ? 'Trocar' : 'Adicionar')}
      </button>
    </div>
  );
}

// --- MENSAGENS (chat real com a clínica, com resposta automática da IA) ---

interface PortalMessage { id: string; text: string; sender: 'patient' | 'staff' | 'ai'; createdAt: string | null; }

function PortalMessagesPanel({ apiFetch, hasUnread }: { apiFetch: (p: string, o?: RequestInit) => Promise<any>; hasUnread: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(hasUnread);

  useEffect(() => setUnread(hasUnread), [hasUnread]);

  const load = useCallback(() => {
    return apiFetch('/messages').then((d) => setMessages(d.messages || [])).catch((e) => setError(e.message));
  }, [apiFetch]);

  // Near-real-time: the patient side has no Firebase account (deliberately —
  // see the REST-only session architecture), so it can't use onSnapshot.
  // Short polling while the panel is open is the honest equivalent.
  useEffect(() => {
    if (!open) return;
    setUnread(false);
    setLoadingThread(true);
    load().finally(() => setLoadingThread(false));
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [open, load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setText('');
    try {
      await apiFetch('/messages', { method: 'POST', body: JSON.stringify({ text: value }) });
      await load();
      // A second pass shortly after catches the AI auto-reply, which is
      // written a beat after the send request already returned.
      setTimeout(load, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="next-glass-panel rounded-next-2xl p-5">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-next-purple-neon" /> Falar com a clínica
          {unread && <span className="w-1.5 h-1.5 rounded-full bg-next-red-alert" />}
        </span>
        <span className="text-slate-500 text-lg">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {loadingThread && messages.length === 0 ? (
              <p className="text-[10.5px] text-slate-500 text-center py-4 flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando conversa...</p>
            ) : messages.length === 0 ? (
              <p className="text-[10.5px] text-slate-500 text-center py-4">Nenhuma mensagem ainda. Envie a primeira!</p>
            ) : messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'patient' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-[11px] leading-relaxed ${
                  m.sender === 'patient' ? 'next-brand-gradient-bg text-white'
                    : m.sender === 'ai' ? 'bg-next-purple-neon/10 text-slate-200 border border-next-purple-neon/25'
                    : 'bg-slate-800 text-slate-200'
                }`}>
                  {m.sender === 'ai' && <p className="text-[8.5px] font-black uppercase text-next-purple-light mb-0.5">Eliza (IA)</p>}
                  {m.sender === 'staff' && <p className="text-[8.5px] font-black uppercase text-slate-400 mb-0.5">Clínica</p>}
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={send} className="flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Escreva sua mensagem..." className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 resize-none" />
            <button type="submit" disabled={sending || !text.trim()} className="w-10 h-10 flex-shrink-0 inline-flex items-center justify-center next-brand-gradient-bg text-white rounded-xl disabled:opacity-60">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </form>
          {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

// --- ANAMNESE ------------------------------------------------------------

const HEALTH_QUESTIONS: { name: keyof AnamnesisAnswers; label: string }[] = [
  { name: 'medicalTreatment', label: 'Você está em tratamento médico atualmente?' },
  { name: 'allergies', label: 'Você tem alguma alergia (medicamento, material, etc.)?' },
  { name: 'medications', label: 'Você toma alguma medicação contínua?' },
  { name: 'conditions', label: 'Você tem diabetes, problema cardíaco ou outra condição de saúde?' },
  { name: 'healingIssues', label: 'Você tem dificuldade de cicatrização?' },
  { name: 'hemorrhage', label: 'Você já teve sangramento excessivo em algum procedimento?' },
  { name: 'habits', label: 'Você fuma ou consome álcool?' },
];

interface AnamnesisAnswers {
  medicalTreatment: string; allergies: string; medications: string; conditions: string;
  healingIssues: string; hemorrhage: string; habits: string;
}

function AnamnesisTab({ apiFetch, onDone }: { apiFetch: (p: string, o?: RequestInit) => Promise<any>; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [missingBasicInfo, setMissingBasicInfo] = useState<{ birthDate: boolean; email: boolean }>({ birthDate: false, email: false });
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [proceduresOfInterest, setProceduresOfInterest] = useState('');
  const [answers, setAnswers] = useState<AnamnesisAnswers>({
    medicalTreatment: '', allergies: '', medications: '', conditions: '', healingIssues: '', hemorrhage: '', habits: '',
  });
  const [birthDate, setBirthDate] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    apiFetch('/home').then((d) => setMissingBasicInfo(d.missingBasicInfo || { birthDate: false, email: false })).catch(() => {}).finally(() => setLoading(false));
  }, [apiFetch]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chiefComplaint.trim()) { setError('Conte pra gente qual o motivo da sua consulta.'); return; }
    setSubmitting(true); setError(null);
    try {
      await apiFetch('/anamnesis', {
        method: 'POST',
        body: JSON.stringify({
          chiefComplaint: chiefComplaint.trim(),
          proceduresOfInterest: proceduresOfInterest.trim(),
          ...answers,
          birthDate: birthDate || undefined,
          email: email || undefined,
        }),
      });
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <CenterLoader />;

  if (sent) {
    return (
      <div className="next-glass-panel rounded-next-2xl p-8 text-center space-y-2">
        <CheckCircle2 className="w-8 h-8 text-next-green-success mx-auto" />
        <p className="text-sm font-bold text-slate-200">Anamnese enviada</p>
        <p className="text-xs text-slate-500">Obrigado! A equipe já vai revisar suas respostas antes da sua consulta.</p>
        <button onClick={onDone} className="text-[11px] text-next-purple-light font-bold mt-2">Voltar ao início</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={onDone} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Voltar</button>
      <h2 className="text-sm font-bold text-slate-200">Anamnese</h2>
      <p className="text-[10.5px] text-slate-500">Essas informações ajudam a equipe a se preparar melhor para o seu atendimento.</p>

      <form onSubmit={submit} className="space-y-4">
        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Qual o motivo da sua consulta? (queixa principal)</label>
            <textarea value={chiefComplaint} onChange={(e) => setChiefComplaint(e.target.value)} rows={2} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Procedimentos de interesse (opcional)</label>
            <textarea value={proceduresOfInterest} onChange={(e) => setProceduresOfInterest(e.target.value)} rows={2} placeholder="Ex: clareamento, harmonização facial..." className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
          </div>
        </div>

        {(missingBasicInfo.birthDate || missingBasicInfo.email) && (
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <p className="text-[10px] font-mono text-slate-500 uppercase">Informações básicas</p>
            {missingBasicInfo.birthDate && (
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">Data de nascimento</label>
                <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
              </div>
            )}
            {missingBasicInfo.email && (
              <div>
                <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
              </div>
            )}
          </div>
        )}

        <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
          <p className="text-[10px] font-mono text-slate-500 uppercase">Saúde</p>
          {HEALTH_QUESTIONS.map((q) => (
            <div key={q.name}>
              <label className="text-xs text-slate-300">{q.label}</label>
              <input
                value={answers[q.name]}
                onChange={(e) => setAnswers((v) => ({ ...v, [q.name]: e.target.value }))}
                placeholder="Não / Sim, e..."
                className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
        <button type="submit" disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
          {submitting ? 'Enviando...' : 'Enviar anamnese'}
        </button>
      </form>
    </div>
  );
}

// --- HISTÓRICO ---------------------------------------------------------

function HistoryTab({ apiFetch }: { apiFetch: (p: string, o?: RequestInit) => Promise<any> }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/history').then((d) => setItems(d.history || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [apiFetch]);

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-200">Meu histórico</h2>
      {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum registro liberado pela clínica ainda.</p>
      ) : items.map((item, idx) => (
        <div key={idx} className="next-glass-panel rounded-next-xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatDate(item.date)}</span>
            {item.professional && <span className="text-[10px] text-next-purple-light">{item.professional}</span>}
          </div>
          {item.type === 'image' ? (
            <div className="flex items-center gap-3">
              {item.url && <img src={item.url} alt={item.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />}
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" /> {item.title}</p>
                {item.category && <p className="text-[10.5px] text-slate-500">{item.category}</p>}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-next-purple-neon flex-shrink-0" /> {item.procedure || 'Procedimento'}</p>
              {item.notes && <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{item.notes}</p>}
              {item.postOpInstructions && (
                <div className="mt-2 bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-lg p-2.5">
                  <p className="text-[9.5px] font-black uppercase text-next-purple-light flex items-center gap-1 mb-1"><Sparkles className="w-3 h-3" /> Instruções pós-operatório</p>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{item.postOpInstructions}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- ORÇAMENTOS ----------------------------------------------------------

function QuotationsTab({ apiFetch }: { apiFetch: (p: string, o?: RequestInit) => Promise<any> }) {
  const [loading, setLoading] = useState(true);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneActions, setDoneActions] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/quotations').then((d) => setQuotations(d.quotations || [])).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const act = async (quotationId: string, action: 'interest' | 'talk' | 'schedule') => {
    setBusyId(`${quotationId}:${action}`);
    try {
      await apiFetch('/requests/quotation-interest', { method: 'POST', body: JSON.stringify({ quotationId, action }) });
      setDoneActions((prev) => ({ ...prev, [quotationId]: action }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <CenterLoader />;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-200">Meus orçamentos</h2>
      {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
      {quotations.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum orçamento disponível no momento.</p>
      ) : quotations.map((q) => (
        <div key={q.id} className="next-glass-panel rounded-next-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-200">{q.title}</p>
            <span className="text-sm font-black text-next-purple-light">{formatCurrency(q.totalValue)}</span>
          </div>
          <div className="space-y-1">
            {(q.items || []).map((it: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-[11px] text-slate-400">
                <span>{it.quantity > 1 ? `${it.quantity}x ` : ''}{it.description}</span>
                <span>{formatCurrency(it.value)}</span>
              </div>
            ))}
          </div>
          {doneActions[q.id] ? (
            <p className="text-[11px] text-next-green-success flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> A clínica foi avisada — vai te responder em breve.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => act(q.id, 'interest')} disabled={!!busyId} className="text-[10.5px] font-bold text-next-green-success bg-next-green-success/10 border border-next-green-success/25 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
                {busyId === `${q.id}:interest` ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Tenho interesse'}
              </button>
              <button onClick={() => act(q.id, 'talk')} disabled={!!busyId} className="text-[10.5px] font-bold text-next-ia-blue bg-next-ia-blue/10 border border-next-ia-blue/25 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
                {busyId === `${q.id}:talk` ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Quero conversar'}
              </button>
              <button onClick={() => act(q.id, 'schedule')} disabled={!!busyId} className="text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/10 border border-next-purple-neon/25 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
                {busyId === `${q.id}:schedule` ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Solicitar agendamento'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// --- SOLICITAR (horário / retorno) -------------------------------------

function RequestsTab({ apiFetch }: { apiFetch: (p: string, o?: RequestInit) => Promise<any> }) {
  const [mode, setMode] = useState<'schedule' | 'return'>('schedule');
  const [reason, setReason] = useState('');
  const [preferredDays, setPreferredDays] = useState('');
  const [period, setPeriod] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      if (mode === 'schedule') {
        if (!reason.trim()) { setError('Informe o motivo ou procedimento.'); setSubmitting(false); return; }
        await apiFetch('/requests/schedule', { method: 'POST', body: JSON.stringify({ reason: reason.trim(), preferredDays, period, notes }) });
      } else {
        await apiFetch('/requests/return', { method: 'POST', body: JSON.stringify({ notes }) });
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="next-glass-panel rounded-next-2xl p-8 text-center space-y-2">
        <CheckCircle2 className="w-8 h-8 text-next-green-success mx-auto" />
        <p className="text-sm font-bold text-slate-200">Solicitação enviada</p>
        <p className="text-xs text-slate-500">A equipe vai confirmar o horário e falar com você em breve.</p>
        <button onClick={() => { setSent(false); setReason(''); setPreferredDays(''); setPeriod(''); setNotes(''); }} className="text-[11px] text-next-purple-light font-bold mt-2">Fazer outra solicitação</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-200">Solicitar horário</h2>
      <div className="flex gap-1 bg-slate-900/60 border border-next-border rounded-xl p-1">
        <button onClick={() => setMode('schedule')} className={`flex-1 py-2 rounded-lg text-[11px] font-bold ${mode === 'schedule' ? 'next-brand-gradient-bg text-white' : 'text-slate-400'}`}>Novo horário</button>
        <button onClick={() => setMode('return')} className={`flex-1 py-2 rounded-lg text-[11px] font-bold ${mode === 'return' ? 'next-brand-gradient-bg text-white' : 'text-slate-400'}`}>Retorno</button>
      </div>
      <p className="text-[10.5px] text-slate-500 flex items-center gap-1.5"><Clock className="w-3 h-3 flex-shrink-0" /> Isto não agenda automaticamente — a equipe confirma o melhor horário com você.</p>

      <form onSubmit={submit} className="next-glass-panel rounded-next-2xl p-5 space-y-3">
        {mode === 'schedule' && (
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Motivo / procedimento</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
          </div>
        )}
        {mode === 'schedule' && (
          <>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Dias preferidos</label>
              <input value={preferredDays} onChange={(e) => setPreferredDays(e.target.value)} placeholder="Ex: segunda ou quarta" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Período</label>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                <option value="">Sem preferência</option>
                <option value="Manhã">Manhã</option>
                <option value="Tarde">Tarde</option>
                <option value="Noite">Noite</option>
              </select>
            </div>
          </>
        )}
        <div>
          <label className="text-[10px] font-mono text-slate-500 uppercase">Observação (opcional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
        </div>
        {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
        <button type="submit" disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
          {submitting ? 'Enviando...' : 'Enviar solicitação'}
        </button>
      </form>
    </div>
  );
}

// --- AVALIAR -------------------------------------------------------------

function ReviewTab({ apiFetch }: { apiFetch: (p: string, o?: RequestInit) => Promise<any> }) {
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<string[]>([]);

  useEffect(() => {
    apiFetch('/appointments')
      .then((d) => setAppointments((d.appointments || []).filter((a: any) => a.status === 'finalizado')))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !stars) return;
    setSubmitting(true); setError(null);
    try {
      await apiFetch('/reviews', { method: 'POST', body: JSON.stringify({ appointmentId: selected.id, stars, comment: comment.trim() }) });
      setSentIds((prev) => [...prev, selected.id]);
      setSelected(null); setStars(0); setComment('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <CenterLoader />;

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"><X className="w-3 h-3" /> Cancelar</button>
        <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-200">{selected.treatment || 'Atendimento'}</p>
            <p className="text-[11px] text-slate-500">{formatDate(selected.date)}{selected.dentistName ? ` · ${selected.dentistName}` : ''}</p>
          </div>
          <div className="flex items-center gap-1.5 justify-center py-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setStars(n)}>
                <Star className={`w-8 h-8 ${n <= stars ? 'text-amber-400 fill-amber-400' : 'text-slate-700'}`} />
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Conte como foi sua experiência (opcional)..." className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5" />
            {error && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{error}</p>}
            <button type="submit" disabled={submitting || !stars} className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
              {submitting ? 'Enviando...' : 'Enviar avaliação'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const pending = appointments.filter((a) => !sentIds.includes(a.id));

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-bold text-slate-200">Avaliar atendimento</h2>
      {error && <p className="text-[11px] text-next-red-alert">{error}</p>}
      {pending.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhum atendimento concluído disponível para avaliação no momento.</p>
      ) : pending.map((a) => (
        <button key={a.id} onClick={() => setSelected(a)} className="w-full next-glass-panel rounded-next-xl p-4 text-left flex items-center justify-between hover:border-next-purple-neon/40 transition-colors">
          <div>
            <p className="text-xs font-bold text-slate-200">{a.treatment || 'Atendimento'}</p>
            <p className="text-[10.5px] text-slate-500">{formatDate(a.date)}{a.dentistName ? ` · ${a.dentistName}` : ''}</p>
          </div>
          <Star className="w-4 h-4 text-slate-600 flex-shrink-0" />
        </button>
      ))}
    </div>
  );
}

function CenterLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 text-next-purple-neon animate-spin" />
    </div>
  );
}
