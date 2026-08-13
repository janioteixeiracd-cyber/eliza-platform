import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageCircle, 
  Plus, 
  Search, 
  Filter, 
  MoreHorizontal, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Archive, 
  Pin, 
  Paperclip, 
  MessageSquare,
  User,
  Calendar,
  Tag,
  ArrowRight,
  TrendingUp,
  X,
  UserCheck,
  Building2,
  Trash2,
  Phone,
  Mail,
  MoreVertical
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  Timestamp,
  deleteDoc,
  getDocs
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Types
type Sector = 'recepcao' | 'financeiro' | 'dentistas' | 'estoque' | 'pacientes' | 'agenda' | 'gestao' | 'outro';
type Priority = 'baixa' | 'media' | 'alta' | 'urgente';
type Status = 'pendente' | 'em_andamento' | 'resolvido' | 'arquivado';

interface InternalNote {
  id: string;
  title: string;
  message: string;
  sector: Sector;
  priority: Priority;
  status: Status;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  created_by_id: string;
  created_by_name: string;
  created_by_role: string | null;
  patient_id: string | null;
  patient_name: string | null;
  due_date: string | null;
  reminder_date: string | null;
  tags: string[];
  attachments: string[];
  is_pinned: boolean;
  is_private: boolean;
  resolved_at: any | null;
  resolved_by_id: string | null;
  resolved_by_name: string | null;
  createdAt: any;
  updatedAt: any;
}

const SECTORS: { value: Sector; label: string; color: string }[] = [
  { value: 'recepcao', label: 'Recepção', color: 'bg-blue-100 text-blue-700' },
  { value: 'financeiro', label: 'Financeiro', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'dentistas', label: 'Dentistas', color: 'bg-purple-100 text-purple-700' },
  { value: 'agenda', label: 'Agenda', color: 'bg-amber-100 text-amber-700' },
  { value: 'estoque', label: 'Estoque', color: 'bg-slate-100 text-slate-700' },
  { value: 'pacientes', label: 'Pacientes', color: 'bg-teal-100 text-teal-700' },
  { value: 'gestao', label: 'Gestão', color: 'bg-rose-100 text-rose-700' },
  { value: 'outro', label: 'Outro', color: 'bg-gray-100 text-gray-700' },
];

const PRIORITIES: { value: Priority; label: string; color: string; ring: string }[] = [
  { value: 'baixa', label: 'Baixa', color: 'bg-slate-100 text-slate-600', ring: 'ring-slate-200' },
  { value: 'media', label: 'Média', color: 'bg-blue-100 text-blue-600', ring: 'ring-blue-100' },
  { value: 'alta', label: 'Alta', color: 'bg-orange-100 text-orange-600', ring: 'ring-orange-100' },
  { value: 'urgente', label: 'Urgente', color: 'bg-red-100 text-red-600', ring: 'ring-red-100' },
];

const STATUSES: { value: Status; label: string; icon: any }[] = [
  { value: 'pendente', label: 'Pendente', icon: Clock },
  { value: 'em_andamento', label: 'Em Andamento', icon: TrendingUp },
  { value: 'resolvido', label: 'Resolvido', icon: CheckCircle2 },
  { value: 'arquivado', label: 'Arquivado', icon: Archive },
];

export default function InternalNotesView() {
  const { clinic, profile, user } = useAuth();
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState<InternalNote | null>(null);
  
  // Filters
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('pendente');
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all');
  const [filterSector, setFilterSector] = useState<Sector | 'all'>('all');
  const [filterAssignee, setFilterAssignee] = useState<string | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [staffMembers, setStaffMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!clinic) return;
    const unsub = onSnapshot(collection(db, 'clinics', clinic.id, 'members'), (snap) => {
      setStaffMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [clinic]);

  useEffect(() => {
    if (!clinic) return;

    const notesRef = collection(db, 'clinics', clinic.id, 'internal_notes');
    // Fetch all notes (up to 150) under the clinic, sorted by creation date,
    // to perform robust status filtering on the client side, avoiding composite index errors.
    const q = query(notesRef, orderBy('createdAt', 'desc'), limit(150));

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as InternalNote));
      setNotes(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `clinics/${clinic.id}/internal_notes`);
      setLoading(false);
    });

    return () => unsub();
  }, [clinic]);

  const filteredNotes = notes.filter(n => {
    const matchesStatus = filterStatus === 'all' || n.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || n.priority === filterPriority;
    const matchesSector = filterSector === 'all' || n.sector === filterSector;
    const matchesAssignee = filterAssignee === 'all' || n.assigned_to_id === filterAssignee;
    const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         n.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         n.patient_name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesPriority && matchesSector && matchesAssignee && matchesSearch;
  });

  const stats = {
    today: notes.filter(n => {
      const date = n.createdAt?.toDate?.() || new Date();
      return format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
    }).length,
    pending: notes.filter(n => n.status === 'pendente').length,
    urgent: notes.filter(n => n.priority === 'urgente' && n.status !== 'resolvido').length,
    inProgress: notes.filter(n => n.status === 'em_andamento').length,
  };

  const handleUpdateStatus = async (noteId: string, newStatus: Status) => {
    if (!clinic) return;
    try {
      const updateData: any = { status: newStatus, updatedAt: serverTimestamp() };
      if (newStatus === 'resolvido') {
        updateData.resolved_at = serverTimestamp();
        updateData.resolved_by_id = user?.uid;
        updateData.resolved_by_name = profile?.name;
      }
      await updateDoc(doc(db, 'clinics', clinic.id, 'internal_notes', noteId), updateData);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clinics/${clinic.id}/internal_notes/${noteId}`);
    }
  };

  const handleTogglePin = async (note: InternalNote) => {
    if (!clinic) return;
    try {
      await updateDoc(doc(db, 'clinics', clinic.id, 'internal_notes', note.id), {
        is_pinned: !note.is_pinned,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clinics/${clinic.id}/internal_notes/${note.id}`);
    }
  };

  return (
    <div className="h-full flex flex-col pt-4">
      {/* Header */}
      <div className="px-8 mb-8">
        <div className="flex items-center justify-between gap-4 mb-2">
           <div>
             <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Central de Recados</h2>
             <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mt-0.5">Comunicação Interna da Clínica</p>
           </div>
           <button 
             onClick={() => setIsModalOpen(true)}
             className="flex items-center gap-2 bg-teal-600 text-white px-5 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
           >
             <Plus className="w-4 h-4" />
             Novo Recado
           </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <StatCard label="Recados de Hoje" value={stats.today} icon={Calendar} color="blue" />
          <StatCard label="Pendentes" value={stats.pending} icon={Clock} color="amber" />
          <StatCard label="Urgentes" value={stats.urgent} icon={AlertCircle} color="red" />
          <StatCard label="Em Andamento" value={stats.inProgress} icon={TrendingUp} color="teal" />
        </div>
      </div>

      {/* Filters Hub */}
      <div className="px-8 pb-4 border-b border-slate-200">
        <div className="flex flex-col lg:flex-row gap-4 items-center">
          {/* Search */}
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-teal-600 transition-colors" />
            <input 
              type="text" 
              placeholder="Buscar por título, mensagem ou paciente..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-4 py-3 text-xs font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all shadow-sm"
            />
          </div>

          {/* Type Selectors */}
          <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0 no-scrollbar">
            {STATUSES.map(s => (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                className={`
                  flex items-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all border
                  ${filterStatus === s.value 
                    ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/10' 
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}
                `}
              >
                <s.icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            ))}
            <button
               onClick={() => setFilterStatus('all')}
               className={`
                 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-all border
                 ${filterStatus === 'all' ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/10' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}
               `}
            >
              Todos
            </button>
          </div>
        </div>

        <div className="flex gap-3 mt-4 overflow-x-auto no-scrollbar">
          <select 
            value={filterPriority} 
            onChange={(e) => setFilterPriority(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 outline-none shadow-sm h-10"
          >
            <option value="all">Todas Prioridades</option>
            {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>

          <select 
            value={filterSector} 
            onChange={(e) => setFilterSector(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 outline-none shadow-sm h-10"
          >
            <option value="all">Todos Setores</option>
            {SECTORS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <select 
            value={filterAssignee} 
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 outline-none shadow-sm h-10"
          >
            <option value="all">Todos Responsáveis</option>
            {staffMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar bg-slate-50/50">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredNotes.map((note) => (
              <motion.div
                key={note.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`
                  bg-white rounded-[32px] border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all overflow-hidden flex flex-col h-full
                  ${note.is_pinned ? 'ring-2 ring-teal-500 ring-offset-2' : ''}
                `}
              >
                {/* Card Header */}
                <div className="p-6 pb-2 flex items-start justify-between">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${SECTORS.find(s => s.value === note.sector)?.color}`}>
                        {SECTORS.find(s => s.value === note.sector)?.label}
                      </span>
                      <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${PRIORITIES.find(p => p.value === note.priority)?.color}`}>
                        {PRIORITIES.find(p => p.value === note.priority)?.label}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 line-clamp-1">{note.title}</h3>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => handleTogglePin(note)}
                      className={`p-2 rounded-xl transition-colors ${note.is_pinned ? 'bg-teal-50 text-teal-600' : 'text-slate-300 hover:bg-slate-50 hover:text-slate-500'}`}
                    >
                      <Pin className={`w-4 h-4 ${note.is_pinned ? 'fill-current text-teal-600' : ''}`} />
                    </button>
                    <NoteActionsMenu 
                      note={note} 
                      onUpdateStatus={(s) => handleUpdateStatus(note.id, s)}
                      onView={() => { setSelectedNote(note); setIsDetailOpen(true); }}
                      onEdit={() => { setSelectedNote(note); setIsModalOpen(true); }}
                    />
                  </div>
                </div>

                {/* Body */}
                <div 
                  className="px-6 py-2 flex-1 cursor-pointer"
                  onClick={() => { setSelectedNote(note); setIsDetailOpen(true); }}
                >
                  <p className="text-xs text-slate-600 line-clamp-4 leading-relaxed font-medium">
                    {note.message}
                  </p>
                </div>

                {/* Patient / Footer */}
                <div className="p-6 pt-4 mt-auto">
                    {note.patient_name && (
                      <div className="flex items-center gap-2 mb-4 p-2.5 bg-slate-50 rounded-2xl border border-slate-100 shadow-inner">
                        <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center text-teal-600 shadow-sm">
                           <User className="w-3.5 h-3.5" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="text-[10px] font-bold text-slate-900 truncate">{note.patient_name}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">Paciente Vinculado</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-[10px] font-bold uppercase ring-2 ring-white ring-offset-0">
                          {note.created_by_name?.charAt(0)}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-900">{note.created_by_name}</p>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
                            {format(note.createdAt?.toDate?.() || new Date(), "HH:mm '·' d 'de' MMM", { locale: ptBR })}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                         {note.assigned_to_id && (
                            <div className="p-1 bg-teal-50 text-teal-600 rounded-lg" title={`Atribuído a: ${note.assigned_to_name}`}>
                               <UserCheck className="w-4 h-4" />
                            </div>
                         )}
                         <div className="text-[9px] font-bold uppercase px-2 py-1 bg-slate-100 text-slate-500 rounded-lg">
                           {STATUSES.find(s => s.value === note.status)?.label}
                         </div>
                      </div>
                    </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredNotes.length === 0 && !loading && (
            <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400 bg-white rounded-[40px] border border-dashed border-slate-200">
               <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-3xl flex items-center justify-center mb-4">
                  <MessageCircle className="w-8 h-8" />
               </div>
               <p className="text-sm font-bold">Nenhum recado encontrado</p>
               <p className="text-[10px] font-bold uppercase tracking-widest mt-2">Experimente ajustar os filtros ou criar um novo</p>
            </div>
          )}
        </div>
      </div>

      <InternalNoteModal 
        isOpen={isModalOpen} 
        onClose={() => { setIsModalOpen(false); setSelectedNote(null); }} 
        note={selectedNote}
      />

      <InternalNoteDetail
        isOpen={isDetailOpen}
        onClose={() => { setIsDetailOpen(false); setSelectedNote(null); }}
        note={selectedNote}
        onUpdateStatus={handleUpdateStatus}
      />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 shadow-blue-200/50',
    amber: 'bg-amber-50 text-amber-600 shadow-amber-200/50',
    red: 'bg-red-50 text-red-600 shadow-red-200/50',
    teal: 'bg-teal-50 text-teal-600 shadow-teal-200/50',
  };

  return (
    <div className="bg-white p-5 rounded-[28px] border border-slate-100 shadow-sm shadow-slate-200/20 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg ${colors[color]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <h4 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">{label}</h4>
        <p className="text-xl font-black text-slate-900 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function NoteActionsMenu({ note, onUpdateStatus, onView, onEdit }: { note: InternalNote, onUpdateStatus: (s: Status) => void, onView: () => void, onEdit: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const { clinic, user } = useAuth();

  const handleDelete = async () => {
    if (!clinic || !window.confirm('Tem certeza que deseja excluir permanentemente este recado?')) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'internal_notes', note.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `clinics/${clinic.id}/internal_notes/${note.id}`);
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all"
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 p-2 overflow-hidden"
            >
              <div className="space-y-1">
                <button 
                  onClick={() => { onView(); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <MessageSquare className="w-4 h-4 text-slate-400" /> Ver Detalhes / Comentar
                </button>
                <button 
                  onClick={() => { onEdit(); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4 text-slate-400" /> Editar Recado
                </button>
                
                <div className="h-px bg-slate-100 my-1 mx-2" />
                
                <p className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em] px-3 py-1.5">Mudar Status</p>
                {STATUSES.map(s => (
                  <button 
                    key={s.value}
                    disabled={note.status === s.value}
                    onClick={() => { onUpdateStatus(s.value); setIsOpen(false); }}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold rounded-xl transition-colors
                      ${note.status === s.value ? 'opacity-30 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'}
                    `}
                  >
                    <s.icon className={`w-4 h-4 ${note.status === s.value ? 'text-slate-300' : 'text-teal-600'}`} />
                    {s.label}
                  </button>
                ))}

                <div className="h-px bg-slate-100 my-1 mx-2" />
                <button 
                  onClick={() => { handleDelete(); setIsOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Excluir Permanentemente
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  note?: InternalNote | null;
}

function InternalNoteModal({ isOpen, onClose, note }: NoteModalProps) {
  const { clinic, profile, user } = useAuth();
  const [formData, setFormData] = useState<Partial<InternalNote>>({
    title: '',
    message: '',
    sector: 'recepcao',
    priority: 'media',
    status: 'pendente',
    assigned_to_id: null,
    assigned_to_name: null,
    patient_id: null,
    patient_name: null,
    tags: [],
    is_pinned: false,
    is_private: false
  });
  const [staff, setStaff] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  
  // Patient Search State
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState<any[]>([]);
  const [isSearchingPatients, setIsSearchingPatients] = useState(false);

  useEffect(() => {
    if (note) {
      setFormData(note);
    } else {
      setFormData({
        title: '',
        message: '',
        sector: 'recepcao',
        priority: 'media',
        status: 'pendente',
        tags: [],
        is_pinned: false,
        is_private: false
      });
    }
  }, [note, isOpen]);

  useEffect(() => {
    if (!clinic || !isOpen) return;
    const unsubStaff = onSnapshot(collection(db, 'clinics', clinic.id, 'members'), (snap) => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsubStaff();
  }, [clinic, isOpen]);

  const searchPatients = async (queryStr: string) => {
    if (!clinic || queryStr.length < 3) {
      setPatientResults([]);
      return;
    }
    setIsSearchingPatients(true);
    try {
      const q = query(
        collection(db, 'clinics', clinic.id, 'patients'), 
        where('name', '>=', queryStr), 
        where('name', '<=', queryStr + '\uf8ff'),
        limit(5)
      );
      const snap = await getDocs(q);
      setPatientResults(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingPatients(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !profile || !user) return;
    
    setIsSaving(true);
    const notesRef = collection(db, 'clinics', clinic.id, 'internal_notes');
    
    const finalData = {
      ...formData,
      updatedAt: serverTimestamp(),
    };

    if (!note) {
      finalData.createdAt = serverTimestamp();
      finalData.created_by_id = user.uid;
      finalData.created_by_name = profile.name;
      finalData.created_by_role = (profile as any).role || (clinic as any).role || 'Gestor';
    }

    try {
      if (note) {
        await updateDoc(doc(db, 'clinics', clinic.id, 'internal_notes', note.id), finalData);
      } else {
        await addDoc(notesRef, finalData);
      }
      // Trigger notification if assigned
      if (formData.assigned_to_id) {
        await addDoc(collection(db, 'clinics', clinic.id, 'notifications'), {
          title: 'Novo Recado Atribuído',
          message: `Você recebeu o recado: ${formData.title}`,
          type: 'note_assigned',
          read: false,
          userId: formData.assigned_to_id,
          link: 'notes',
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/internal_notes`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-2xl bg-white rounded-[40px] shadow-2xl overflow-hidden shadow-teal-900/10 flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">{note ? 'Editar' : 'Novo'} Recado</h3>
            <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mt-1">Prencha as informações abaixo</p>
          </div>
          <button onClick={onClose} className="p-3 bg-slate-50 text-slate-400 hover:text-slate-600 rounded-2xl transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Título do Recado</label>
              <input 
                required
                type="text" 
                placeholder="Ex: Paciente quer retorno"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Mensagem / Detalhes</label>
              <textarea 
                required
                placeholder="Descreva o recado detalhadamente..."
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                rows={4}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all resize-none"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Setor Relacionado</label>
                 <select 
                   value={formData.sector}
                   onChange={(e) => setFormData({ ...formData, sector: e.target.value as Sector })}
                   className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                 >
                   {SECTORS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                 </select>
               </div>
               <div>
                 <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Prioridade</label>
                 <select 
                   value={formData.priority}
                   onChange={(e) => setFormData({ ...formData, priority: e.target.value as Priority })}
                   className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                 >
                   {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                 </select>
               </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Atribuir a Responsável</label>
              <select 
                value={formData.assigned_to_id || ''}
                onChange={(e) => {
                  const s = staff.find(sm => sm.id === e.target.value);
                  setFormData({ ...formData, assigned_to_id: e.target.value || null, assigned_to_name: s ? s.name : null });
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
              >
                <option value="">Qualquer Pessoa / Nenhum</option>
                {staff.map(sm => <option key={sm.id} value={sm.id}>{sm.name}</option>)}
              </select>
            </div>

            {/* Patient Search */}
            <div className="relative">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Vincular Paciente (Opcional)</label>
              {formData.patient_id ? (
                <div className="flex items-center justify-between bg-teal-50 border border-teal-100 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-teal-600" />
                    <span className="text-sm font-bold text-teal-900">{formData.patient_name}</span>
                  </div>
                  <button 
                    type="button"
                    onClick={() => {
                        setFormData({ ...formData, patient_id: null, patient_name: null });
                        setPatientSearch('');
                    }}
                    className="p-1 text-teal-400 hover:text-teal-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Pesquisar paciente..."
                      value={patientSearch}
                      onChange={(e) => {
                        setPatientSearch(e.target.value);
                        searchPatients(e.target.value);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-12 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                    />
                    {isSearchingPatients && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-teal-600" />}
                  </div>
                  {patientResults.length > 0 && (
                    <div className="absolute z-10 bottom-full mb-1 w-full bg-white border border-slate-200 rounded-2xl shadow-xl p-2 max-h-48 overflow-y-auto">
                      {patientResults.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, patient_id: p.id, patient_name: p.name });
                            setPatientResults([]);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 rounded-xl flex items-center gap-3 group transition-colors"
                        >
                          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 font-bold text-xs group-hover:bg-teal-100 transition-colors">
                            {p.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900">{p.name}</p>
                            <p className="text-[10px] text-slate-400 font-medium">{p.cpf || p.phone}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2.5 px-1">Data Limite</label>
                  <input 
                    type="date"
                    value={formData.due_date || ''}
                    onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-900 focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                  />
                </div>
                <div className="flex items-center gap-6 pt-6">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="hidden"
                      checked={formData.is_pinned}
                      onChange={(e) => setFormData({ ...formData, is_pinned: e.target.checked })}
                    />
                    <div className={`w-10 h-6 rounded-full p-1 transition-all ${formData.is_pinned ? 'bg-teal-600' : 'bg-slate-200'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${formData.is_pinned ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 group-hover:text-teal-600 transition-colors">Fixar Topo</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="hidden"
                      checked={formData.is_private}
                      onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })}
                    />
                    <div className={`w-10 h-6 rounded-full p-1 transition-all ${formData.is_private ? 'bg-teal-600' : 'bg-slate-200'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-all ${formData.is_private ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 group-hover:text-teal-600 transition-colors">Privado</span>
                  </label>
                </div>
            </div>
          </div>
        </form>

        <div className="p-8 border-t border-slate-100 flex gap-4 shrink-0">
          <button 
            type="button"
            onClick={onClose}
            className="flex-1 py-4 bg-white text-slate-500 rounded-2xl font-bold text-xs uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-all"
          >
            Cancelar
          </button>
          <button 
            type="submit"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-[2] py-4 bg-teal-600 text-white rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl shadow-teal-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {note ? 'Salvar Alterações' : 'Criar Recado'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

interface DetailProps {
  isOpen: boolean;
  onClose: () => void;
  note: InternalNote | null;
  onUpdateStatus: (id: string, s: Status) => void;
}

function InternalNoteDetail({ isOpen, onClose, note, onUpdateStatus }: DetailProps) {
  const { clinic, profile, user } = useAuth();
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!clinic || !note || !isOpen) return;
    const commentsRef = collection(db, 'clinics', clinic.id, 'internal_notes', note.id, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [clinic, note, isOpen]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !note || !newComment.trim() || !profile || !user) return;
    
    setIsSending(true);
    try {
      const commentsRef = collection(db, 'clinics', clinic.id, 'internal_notes', note.id, 'comments');
      await addDoc(commentsRef, {
        message: newComment.trim(),
        created_by_id: user.uid,
        created_by_name: profile.name,
        createdAt: serverTimestamp()
      });
      setNewComment('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/internal_notes/${note.id}/comments`);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen || !note) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-end">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
      />
      <motion.div 
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col"
      >
        {/* Detail Header */}
        <div className="p-8 border-b border-slate-100 flex items-center justify-between">
           <div className="flex items-center gap-4">
              <button onClick={onClose} className="p-2 -ml-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                <X className="w-6 h-6" />
              </button>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">Detalhes do Recado</h3>
                <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mt-0.5">Histórico e Comentários</p>
              </div>
           </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30">
          <div className="p-8">
            {/* Note Info Card */}
            <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-8 mb-8">
               <div className="flex items-center gap-2 mb-6">
                 <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${SECTORS.find(s => s.value === note.sector)?.color}`}>
                    {SECTORS.find(s => s.value === note.sector)?.label}
                 </span>
                 <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${PRIORITIES.find(p => p.value === note.priority)?.color}`}>
                    {PRIORITIES.find(p => p.value === note.priority)?.label}
                 </span>
                 <span className="ml-auto text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    #{note.id.slice(-6)}
                 </span>
               </div>

               <h2 className="text-xl font-bold text-slate-900 mb-4">{note.title}</h2>
               <p className="text-sm text-slate-600 leading-relaxed font-medium mb-8 whitespace-pre-wrap">
                 {note.message}
               </p>

               <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-50">
                  <InfoItem icon={User} label="Criado por" value={note.created_by_name} subValue={note.created_by_role || 'Equipe'} />
                  <InfoItem icon={Calendar} label="Data" value={format(note.createdAt?.toDate?.() || new Date(), "d 'de' MMMM", { locale: ptBR })} subValue={format(note.createdAt?.toDate?.() || new Date(), "HH:mm")} />
                  {note.assigned_to_name && (
                    <InfoItem icon={UserCheck} label="Atribuído a" value={note.assigned_to_name} color="teal" />
                  )}
                  {note.patient_name && (
                    <InfoItem icon={User} label="Paciente" value={note.patient_name} color="blue" />
                  )}
               </div>

               {/* Quick Status Bar */}
               <div className="mt-8 flex gap-2">
                  <button 
                    onClick={() => onUpdateStatus(note.id, 'em_andamento')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${note.status === 'em_andamento' ? 'bg-teal-50 text-teal-600 border border-teal-100' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}
                  >
                    Em Andamento
                  </button>
                  <button 
                    onClick={() => onUpdateStatus(note.id, 'resolvido')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${note.status === 'resolvido' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-400 border border-slate-100 hover:bg-slate-100'}`}
                  >
                    Marcar Resolvido
                  </button>
               </div>
            </div>

            {/* Comments Section */}
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 px-4">Histórico de Comentários</h4>
            
            <div className="space-y-6 px-4 mb-20">
               {comments.map((comment) => (
                 <div key={comment.id} className="flex gap-4">
                   <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs shrink-0">
                     {comment.created_by_name?.charAt(0)}
                   </div>
                   <div className="flex-1">
                      <div className="bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-none shadow-sm">
                        <p className="text-xs text-slate-700 font-medium leading-relaxed">{comment.message}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-2 px-1">
                        <span className="text-[9px] font-bold text-slate-900">{comment.created_by_name}</span>
                        <span className="text-[9px] text-slate-300 font-bold">•</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase">
                          {format(comment.createdAt?.toDate?.() || new Date(), "HH:mm '·' d 'de' MMM", { locale: ptBR })}
                        </span>
                      </div>
                   </div>
                 </div>
               ))}

               {comments.length === 0 && (
                 <div className="py-12 flex flex-col items-center justify-center text-slate-300">
                    <MessageSquare className="w-10 h-10 mb-2 opacity-20" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">Nenhum comentário ainda</p>
                 </div>
               )}
            </div>
          </div>
        </div>

        {/* Comment Input */}
        <div className="p-6 bg-white border-t border-slate-100">
           <form onSubmit={handleSendComment} className="flex gap-3">
              <input 
                type="text" 
                placeholder="Escreva um comentário..." 
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3 text-xs font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all shadow-inner"
              />
              <button 
                disabled={isSending || !newComment.trim()}
                className="w-12 h-12 bg-teal-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-teal-600/20 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all"
              >
                {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
           </form>
        </div>
      </motion.div>
    </div>
  );
}

function InfoItem({ icon: Icon, label, value, subValue, color = 'slate' }: { icon: any, label: string, value: string, subValue?: string, color?: 'slate' | 'teal' | 'blue' }) {
  const colors = {
    slate: 'text-slate-400',
    teal: 'text-teal-500',
    blue: 'text-blue-500'
  };

  return (
    <div className="flex gap-3">
       <div className={`w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-4 h-4" />
       </div>
       <div className="overflow-hidden">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
          <p className="text-xs font-bold text-slate-900 truncate">{value}</p>
          {subValue && <p className="text-[9px] text-slate-400 font-medium truncate">{subValue}</p>}
       </div>
    </div>
  );
}

function Loader2(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function Send(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
