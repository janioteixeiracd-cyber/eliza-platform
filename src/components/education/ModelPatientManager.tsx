import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  Users, 
  HeartPulse, 
  AlertCircle, 
  CheckCircle2, 
  FolderLock, 
  Check, 
  X, 
  UploadCloud, 
  FileText, 
  FileSignature, 
  Undo,
  HelpCircle,
  Clock
} from 'lucide-react';
import { collection, getDocs, query, doc, addDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface ModelPatientManagerProps {
  clinicId: string;
  patients: any[]; // education_patients
  courses: any[];
  modules: any[];
  onSavePatient: (patient: any) => Promise<void>;
  onDeletePatient: (patientId: string) => Promise<void>;
  isStudentMode: boolean;
  studentData?: any;
  onLogAction?: (log: any) => Promise<void>;
}

export default function ModelPatientManager({
  clinicId,
  patients,
  courses,
  modules,
  onSavePatient,
  onDeletePatient,
  isStudentMode,
  studentData,
  onLogAction
}: ModelPatientManagerProps) {
  
  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<any | null>(null);
  
  // States for importing existing patients
  const [clinicPatients, setClinicPatients] = useState<any[]>([]);
  const [searchClinicTerm, setSearchClinicTerm] = useState('');
  const [isImportDropdownOpen, setIsImportDropdownOpen] = useState(false);
  const [isLoadingClinicPatients, setIsLoadingClinicPatients] = useState(false);

  // States for Student Audit Logs
  const [patientLogs, setPatientLogs] = useState<any[]>([]);

  // Toggle active editing pane in Patient file
  const [activeFileTab, setActiveFileTab] = useState<'anamnese' | 'arquivos' | 'auditoria'>('anamnese');

  // Load clinic patients on demand (when user search starts)
  useEffect(() => {
    if (searchClinicTerm.length > 2 && clinicPatients.length === 0) {
      loadClinicPatients();
    }
  }, [searchClinicTerm]);

  // Load patient logs
  useEffect(() => {
    if (selectedPatient) {
      loadPatientLogs(selectedPatient.id);
    }
  }, [selectedPatient]);

  const loadClinicPatients = async () => {
    setIsLoadingClinicPatients(true);
    try {
      const snap = await getDocs(query(collection(db, 'clinics', clinicId, 'patients')));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setClinicPatients(list);
    } catch (err) {
      console.error("Error loading clinic patients:", err);
    } finally {
      setIsLoadingClinicPatients(false);
    }
  };

  const loadPatientLogs = async (pId: string) => {
    try {
      const snap = await getDocs(query(collection(db, 'clinics', clinicId, 'education_patient_logs')));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                        .filter((log: any) => log.patientId === pId);
      setPatientLogs(list.sort((a: any, b: any) => (b.date + b.time).localeCompare(a.date + a.time)));
    } catch (err) {
      console.error("Error loading patient logs:", err);
    }
  };

  const initPatientForm = (p: any = null) => {
    setEditingPatient(p ? { ...p } : {
      name: '',
      cpf: '',
      phone: '',
      birthDate: '',
      address: '',
      chiefComplaint: '',
      desiredProcedure: 'Toxina botulínica',
      courseId: courses[0]?.id || '',
      moduleId: '',
      status: 'interessado',
      medicalHistory: '',
      medications: '',
      allergies: '',
      contraindications: '',
      planning: '',
      postOpInstructions: '',
      imageConsentSigned: false,
      tcleSigned: false
    });
    setIsPatientModalOpen(true);
  };

  const handleImportClinicPatient = (origPat: any) => {
    // Fill the form with original details, linking it!
    setEditingPatient({
      patientClinicId: origPat.id,
      name: origPat.name || '',
      cpf: origPat.cpf || '',
      phone: origPat.phone || '',
      birthDate: origPat.birthDate || '',
      address: origPat.address || '',
      chiefComplaint: origPat.chiefComplaint || '',
      desiredProcedure: 'Toxina botulínica',
      courseId: courses[0]?.id || '',
      status: 'selecionado',
      medicalHistory: origPat.medicalHistory || '',
      medications: origPat.medications || '',
      allergies: origPat.allergies || '',
      contraindications: origPat.contraindications || '',
      planning: '',
      postOpInstructions: '',
      imageConsentSigned: false,
      tcleSigned: false
    });
    setIsImportDropdownOpen(false);
    setIsPatientModalOpen(true);
  };

  const handleSavePatientForm = async () => {
    if (!editingPatient.name) return;
    
    // Check duplication check if creating NEW patient (by CPF)
    if (!editingPatient.id) {
      const exists = patients.find(p => p.cpf === editingPatient.cpf && p.cpf);
      if (exists) {
        alert(`O paciente ${editingPatient.name} com este CPF já está cadastrado como paciente-modelo neste módulo!`);
        return;
      }
    }

    // Check if Aluno Mode is updating, create an Audit Log
    if (editingPatient.id && isStudentMode && studentData) {
      const original = patients.find(p => p.id === editingPatient.id);
      if (original) {
        // Track changed fields
        const fields = ['medicalHistory', 'medications', 'allergies', 'contraindications', 'planning', 'postOpInstructions', 'chiefComplaint'];
        for (const f of fields) {
          if (original[f] !== editingPatient[f]) {
            const today = new Date();
            const logPayload = {
              patientId: editingPatient.id,
              studentId: studentData.id || 'student',
              studentName: studentData.name || 'Aluno Teste',
              fieldName: f,
              oldValue: original[f] || 'Vazio',
              newValue: editingPatient[f] || 'Vazio',
              date: today.toLocaleDateString('pt-BR'),
              time: today.toLocaleTimeString('pt-BR'),
              revisedByProfessor: false
            };
            await addDoc(collection(db, 'clinics', clinicId, 'education_patient_logs'), logPayload);
          }
        }
      }
    }

    await onSavePatient(editingPatient);
    setIsPatientModalOpen(false);
    setEditingPatient(null);
    if (selectedPatient && selectedPatient.id === editingPatient.id) {
      // Refresh current details
      setSelectedPatient(null);
    }
  };

  const handleToggleRevisedLog = async (logId: string, currentVal: boolean) => {
    if (isStudentMode) return; // Only teacher/admin can revise logs
    try {
      const logRef = doc(db, 'clinics', clinicId, 'education_patient_logs', logId);
      const { updateDoc } = await import('firebase/firestore');
      await updateDoc(logRef, { revisedByProfessor: !currentVal });
      if (selectedPatient) {
        loadPatientLogs(selectedPatient.id);
      }
    } catch (err) {
      console.error("Error revising log:", err);
    }
  };

  // Search filtered clinic list
  const filteredClinicList = clinicPatients.filter(p => 
    (p.name || '').toLowerCase().includes(searchClinicTerm.toLowerCase()) ||
    (p.cpf || '').includes(searchClinicTerm)
  );

  return (
    <div className="space-y-6">
      
      {selectedPatient ? (
        <div className="space-y-6">
          
          {/* Header Bar */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
            <div>
              <button 
                onClick={() => setSelectedPatient(null)}
                className="inline-flex items-center gap-1.5 text-xs text-teal-605 font-bold uppercase tracking-widest cursor-pointer mb-2"
              >
                <Undo className="w-4 h-4" /> Voltar aos Pacientes-Modelo
              </button>
              <div className="flex items-center gap-2">
                <span className="p-1 px-2.5 text-[8px] bg-slate-100 text-slate-800 font-bold rounded uppercase">
                  Procedimento: {selectedPatient.desiredProcedure}
                </span>
                {selectedPatient.patientClinicId && (
                  <span className="text-[8px] font-black uppercase text-teal-600 bg-teal-50 border border-teal-100 p-1 px-2 rounded">
                    VINCULADO À CLÍNICA
                  </span>
                )}
              </div>
              <h2 className="text-xl font-black text-slate-800 uppercase mt-1">{selectedPatient.name}</h2>
              <p className="text-xs text-slate-400 mt-1">CPF: <span className="font-bold text-slate-700">{selectedPatient.cpf}</span> | Telefone: <span className="font-bold text-slate-700">{selectedPatient.phone}</span> | Status: <span className="font-black text-teal-605 uppercase">{selectedPatient.status}</span></p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => {
                  if (isStudentMode && !studentData?.permEditPatientRecords) {
                    alert("Você não tem permissão de aluno para editar fichas de paciente!");
                    return;
                  }
                  initPatientForm(selectedPatient);
                }}
                className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-slate-850 flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Edit3 className="w-4 h-4" /> Editar Ficha Geral
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Split A: Clinical File Navigator */}
            <div className="lg:col-span-8 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left space-y-6">
              
              {/* Tabs list inside medical history */}
              <div className="flex border-b border-slate-100 pb-3 gap-6">
                {[
                  { key: 'anamnese', label: 'Anamnese & Prontuário' },
                  { key: 'arquivos', label: 'Consentimentos e Mídia' },
                  { key: 'auditoria', label: 'Auditoria de Alterações' }
                ].map(tab => (
                  <button 
                    key={tab.key}
                    onClick={() => setActiveFileTab(tab.key as any)}
                    className={`pb-2 text-xs font-black uppercase tracking-widest outline-none border-b-2 transition-all cursor-pointer ${
                      activeFileTab === tab.key 
                        ? 'text-teal-655 border-teal-605' 
                        : 'text-slate-400 hover:text-slate-600 border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* TAB 1: Anamnese editor info */}
              {activeFileTab === 'anamnese' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">Queixa Principal</p>
                      <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl text-xs font-semibold text-slate-700 min-h-[50px]">
                        {selectedPatient.chiefComplaint || "Nenhuma queixa descrita."}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">Histórico Médico</p>
                      <div className="p-4 bg-slate-50 border border-slate-150 rounded-2xl text-xs font-semibold text-slate-700 min-h-[50px]">
                        {selectedPatient.medicalHistory || "Nenhum antecedente informado."}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-50 pt-4">
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-0.5">Uso de Medicamentos</p>
                      <p className="text-xs text-slate-700 font-bold bg-slate-50/50 p-3 rounded-xl border border-slate-100 min-h-[40px] uppercase">{selectedPatient.medications || "Vazio"}</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Alergias</p>
                      <p className="text-xs text-rose-755 font-bold bg-rose-50/20 p-3 rounded-xl border border-rose-100 min-h-[40px] uppercase">{selectedPatient.allergies || "Nenhuma"}</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Contraindicações</p>
                      <p className="text-xs text-amber-700 font-bold bg-amber-50/20 p-3 rounded-xl border border-amber-100 min-h-[40px] uppercase">{selectedPatient.contraindications || "Nenhuma"}</p>
                    </div>
                  </div>

                  <div className="border-t border-slate-150 pt-6 space-y-4">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">PLANEJAMENTO & ORIENTAÇÃO</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Planejamento do Procedimento Clínico</span>
                        <p className="p-4 bg-teal-50/15 border border-teal-100 rounded-2xl text-xs text-slate-800 leading-relaxed min-h-[60px] whitespace-pre-line">{selectedPatient.planning || "Sem planejamento cadastrado."}</p>
                      </div>
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Orientações de Pós-Procedimento</span>
                        <p className="p-4 bg-slate-50 border border-slate-150 rounded-2xl text-xs text-slate-700 leading-relaxed min-h-[60px] whitespace-pre-line">{selectedPatient.postOpInstructions || "Sem orientações cadastradas."}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Materials, Consent forms, TCLE */}
              {activeFileTab === 'arquivos' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Consentimento 1 */}
                    <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3 text-left">
                        <FileSignature className="w-5 h-5 text-teal-650" />
                        <div>
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">TERMO DE USO DE IMAGEM</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Uso acadêmico e fotos clínicas</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {selectedPatient.imageConsentSigned ? (
                          <span className="flex items-center gap-1 p-1 px-2.5 bg-emerald-50 text-emerald-800 rounded-md font-bold text-[9px] uppercase">
                            <Check className="w-3.5 h-3.5" /> Assinado
                          </span>
                        ) : (
                          <span className="p-1 px-2.5 bg-amber-50 text-amber-800 rounded-md font-bold text-[9px] uppercase">
                            Pendente
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Consentimento 2 */}
                    <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3 text-left">
                        <FileText className="w-5 h-5 text-teal-650" />
                        <div>
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">TCLE ESPECÍFICO</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Consentimento livre e esclarecido</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {selectedPatient.tcleSigned ? (
                          <span className="flex items-center gap-1 p-1 px-2.5 bg-emerald-50 text-emerald-800 rounded-md font-bold text-[9px] uppercase">
                            <Check className="w-3.5 h-3.5" /> Assinado
                          </span>
                        ) : (
                          <span className="p-1 px-2.5 bg-rose-50 text-rose-850 rounded-md font-bold text-[9px] uppercase">
                            Pendente
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Photo area */}
                  <div className="border border-dashed border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-3">
                    <UploadCloud className="w-8 h-8 text-slate-300" />
                    <p className="text-xs font-bold text-slate-700">Adicionar Fotos Antes / Depois do Tratamento</p>
                    <p className="text-[10px] text-slate-400 leading-normal max-w-sm">Use o aplicativo para registrar fotos pré e pós aplicação. Resumo acadêmico integrado no prontuário de paciente-modelo.</p>
                    <button className="px-4 py-2 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 cursor-pointer">
                      Anexar Mídia PDF/JPEG
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: Student edits auditoring logs */}
              {activeFileTab === 'auditoria' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                      <FolderLock className="w-4 h-4 text-slate-500" /> Histórico de Alterações Acadêmicas
                    </h4>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Log de Auditoria Clínica</span>
                  </div>

                  {patientLogs.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 italic py-8 border border-dashed border-slate-200 rounded-2xl">
                      Nenhuma alteração de prontuário registrada por alunos para este paciente.
                    </p>
                  ) : (
                    <div className="space-y-3 pr-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                      {patientLogs.map(log => {
                        const translateFields: Record<string, string> = {
                          medicalHistory: 'Histórico Médico',
                          medications: 'Uso de Medicamentos',
                          allergies: 'Alergias',
                          contraindications: 'Contraindicações',
                          planning: 'Planejamento Clínico',
                          postOpInstructions: 'Instruções de Pós',
                          chiefComplaint: 'Queixa Principal'
                        };

                        return (
                          <div key={log.id} className="p-4 rounded-xl border border-slate-150 bg-slate-50/45 text-left text-[11px] leading-relaxed relative flex justify-between items-start gap-4">
                            <div>
                              <div className="flex items-center gap-2 font-bold text-slate-400 text-[9px]">
                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                <span>{log.date} às {log.time}</span>
                                <span>•</span>
                                <span className="text-slate-500 uppercase">Campo: {translateFields[log.fieldName] || log.fieldName}</span>
                              </div>
                              <p className="font-bold text-slate-700 mt-1">Alterado por: <span className="text-teal-700">{log.studentName}</span></p>
                              
                              <div className="grid grid-cols-2 gap-4 mt-2 p-2 bg-white rounded-lg border border-slate-100 text-[10px]">
                                <div>
                                  <p className="font-bold text-slate-400 uppercase">Antes</p>
                                  <p className="text-slate-600 mt-0.5 line-clamp-2">{log.oldValue}</p>
                                </div>
                                <div className="border-l border-slate-100 pl-3">
                                  <p className="font-bold text-slate-450 uppercase">Novo Valor</p>
                                  <p className="text-slate-800 font-bold mt-0.5 line-clamp-2">{log.newValue}</p>
                                </div>
                              </div>
                            </div>

                            {/* Revision stamp */}
                            <button 
                              onClick={() => handleToggleRevisedLog(log.id, log.revisedByProfessor)}
                              disabled={isStudentMode}
                              className={`p-1.5 px-3 rounded-lg text-[9px] font-black uppercase tracking-widest cursor-pointer shrink-0 inline-flex items-center gap-1 ${
                                log.revisedByProfessor 
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' 
                                  : 'bg-rose-50 text-rose-800 border border-rose-100'
                              } disabled:opacity-80`}
                              title={isStudentMode ? "Revisão controlada pelo professor" : undefined}
                            >
                              {log.revisedByProfessor ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                              <span>{log.revisedByProfessor ? "Revisado" : "Revisar"}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Split B: Sidebar Quick Course info */}
            <div className="lg:col-span-4 space-y-6 text-left">
              <div className="bg-white p-6 rounded-[2rem] border border-slate-200">
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-3 mb-4">
                  CURSO VINCULADO
                </h4>

                <div className="space-y-4">
                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">Curso</p>
                    <p className="text-xs font-black text-slate-800 uppercase mt-1">
                      {courses.find(c => c.id === selectedPatient.courseId)?.name || "Curso não encontrado"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase font-mono">Aula Recomendada (Módulo)</p>
                    <p className="text-xs font-semibold text-slate-600 mt-1">
                      {modules.find(m => m.id === selectedPatient.moduleId)?.name || "Módulo Geral / Sem designação dedicada"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 text-left animate-fade-in">
          
          {/* Headline bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Pacientes-Modelo Cadastrados</h2>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Triagem de Prontuários e Seleção de Casos Acadêmicos</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Split 1: Left List */}
            <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 space-y-5">
              <div className="flex justify-between items-center border-b border-slate-50 pb-3">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-teal-605" /> FILTRAGEM DE MODELOS
                </h3>
                
                <button 
                  onClick={() => initPatientForm()}
                  className="px-3.5 py-1.5 bg-slate-950 text-white rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Novo Paciente
                </button>
              </div>

              {patients.length === 0 ? (
                <p className="text-center text-slate-400 italic text-xs py-10">Nenhum paciente cadastrado como modelo ainda.</p>
              ) : (
                <div className="divide-y divide-slate-100 pr-1 overflow-y-auto max-h-[500px] custom-scrollbar">
                  {patients.map(p => (
                    <div 
                      key={p.id}
                      onClick={() => setSelectedPatient(p)}
                      className="py-4 hover:bg-slate-50/55 rounded-xl px-2 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            p.status === 'atendido' ? 'bg-emerald-50 text-emerald-800' :
                            p.status === 'selecionado' ? 'bg-purple-50 text-purple-800' :
                            p.status === 'confirmado' ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {p.status}
                          </span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase">{p.phone}</span>
                        </div>
                        <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">{p.name}</h4>
                        <p className="text-[10px] text-slate-450 mt-1 font-semibold">Pretendido: <span className="font-bold text-slate-700">{p.desiredProcedure}</span></p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button 
                          onClick={(e) => { e.stopPropagation(); if (confirm('Remover paciente-modelo e seus vínculos acadêmicos?')) onDeletePatient(p.id); }}
                          className="p-2 hover:bg-rose-50 text-rose-500 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Split 2: Import from Clinical patients */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Box A: Search & Convert Database Patient */}
              <div className="bg-slate-900 text-white p-6 sm:p-8 rounded-[2rem] space-y-4 shadow-xl">
                <div>
                  <span className="p-1 px-2.5 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-md font-bold text-[8px] uppercase tracking-wider">
                    Não Duplicar Cadastros
                  </span>
                  <h3 className="text-sm font-black uppercase mt-2 tracking-wide">Buscar e Converter Paciente</h3>
                  <p className="text-[10px] text-slate-400 leading-normal font-semibold mt-1">Busque um paciente já existente na clínica geral e importe para o ambiente educacional mantendo o histórico unificado!</p>
                </div>

                <div className="space-y-2 relative">
                  <div className="flex items-center bg-white/10 rounded-xl px-3 border border-white/10">
                    <Search className="w-4 h-4 text-slate-400 shrink-0" />
                    <input 
                      type="text"
                      value={searchClinicTerm}
                      onChange={(e) => {
                        setSearchClinicTerm(e.target.value);
                        setIsImportDropdownOpen(e.target.value.length > 1);
                      }}
                      className="w-full bg-transparent border-none text-xs font-semibold py-2.5 outline-none pl-2 text-white placeholder-slate-500"
                      placeholder="Digite o nome ou CPF para buscar..."
                    />
                  </div>

                  {/* Dropdown matching results */}
                  {isImportDropdownOpen && (
                    <div className="absolute inset-x-0 top-11 bg-white border border-slate-200 rounded-2xl shadow-2xl z-50 overflow-hidden text-slate-800 text-left text-xs max-h-[220px] overflow-y-auto custom-scrollbar">
                      {isLoadingClinicPatients ? (
                        <p className="p-4 text-center text-slate-400 italic">Buscando banco...</p>
                      ) : filteredClinicList.length === 0 ? (
                        <p className="p-4 text-center text-slate-400 italic">Nenhum paciente clínico encontrado.</p>
                      ) : (
                        filteredClinicList.slice(0, 5).map(origPat => (
                          <div 
                            key={origPat.id}
                            onClick={() => handleImportClinicPatient(origPat)}
                            className="p-3.5 hover:bg-slate-50 transition-all cursor-pointer border-b border-slate-100 last:border-0"
                          >
                            <p className="font-bold text-slate-800 uppercase tracking-tight">{origPat.name}</p>
                            <p className="text-[10px] text-slate-400 font-semibold uppercase mt-0.5">CPF: {origPat.cpf || "Ausente"} | fone: {origPat.phone || "Não informado"}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────── */}
      {/* Patient Register Edit Modal */}
      {isPatientModalOpen && editingPatient && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-905 tracking-tight uppercase flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-teal-605" />
                {editingPatient.id ? 'Editar Cadastro de Paciente-Modelo' : 'Cadastrar Paciente-Modelo'}
              </h3>
              <button onClick={() => { setIsPatientModalOpen(false); setEditingPatient(null); }} className="text-slate-400 hover:text-slate-600 border-none bg-transparent">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Nome do Paciente</label>
                <input 
                  type="text"
                  value={editingPatient.name}
                  onChange={(e) => setEditingPatient({...editingPatient, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  placeholder="Ex: João da Silva"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">CPF (Chave Única)</label>
                  <input 
                    type="text"
                    value={editingPatient.cpf}
                    onChange={(e) => setEditingPatient({...editingPatient, cpf: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: 123.456.789-00"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">WhatsApp / telefone</label>
                  <input 
                    type="text"
                    value={editingPatient.phone}
                    onChange={(e) => setEditingPatient({...editingPatient, phone: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: (11) 98888-7777"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Data de Nascimento</label>
                  <input 
                    type="date"
                    value={editingPatient.birthDate}
                    onChange={(e) => setEditingPatient({...editingPatient, birthDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status Seleção</label>
                  <select 
                    value={editingPatient.status}
                    onChange={(e) => setEditingPatient({...editingPatient, status: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="interessado">Interessado</option>
                    <option value="selecionado">Selecionado</option>
                    <option value="confirmado">Confirmado</option>
                    <option value="atendido">Atendido</option>
                    <option value="desistiu">Desistiu</option>
                    <option value="contraindicado">Contraindicado</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Endereço Completo</label>
                <input 
                  type="text"
                  value={editingPatient.address}
                  onChange={(e) => setEditingPatient({...editingPatient, address: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Procedimento Clínico Desejado</label>
                  <input 
                    type="text"
                    value={editingPatient.desiredProcedure}
                    onChange={(e) => setEditingPatient({...editingPatient, desiredProcedure: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: Rinomodelação estruturada"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Vincular a Curso Acadêmico</label>
                  <select 
                    value={editingPatient.courseId}
                    onChange={(e) => {
                      const courseId = e.target.value;
                      setEditingPatient({...editingPatient, courseId, moduleId: ''});
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Vincular a Aula Específica (Módulo)</label>
                <select 
                  value={editingPatient.moduleId}
                  onChange={(e) => setEditingPatient({...editingPatient, moduleId: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                >
                  <option value="">-- Módulo Geral (Sem designação) --</option>
                  {modules.filter(m => m.courseId === editingPatient.courseId).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* Anamnese Clinical Questionnaire inside register */}
              <div className="bg-slate-100 p-4 rounded-2xl space-y-3">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block border-b border-slate-200 pb-1.5 mb-2">QUestionário e Anamnese Integrada</span>
                
                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold text-slate-500 uppercase">Histórico e Antecedentes Médicos</label>
                  <textarea 
                    value={editingPatient.medicalHistory || ''}
                    onChange={(e) => setEditingPatient({...editingPatient, medicalHistory: e.target.value})}
                    rows={2}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                    placeholder="Hipertensão, diabetes, cirurgias anteriores..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[8.5px] font-bold text-slate-500 uppercase">Uso medicamentos diários</label>
                    <input 
                      type="text"
                      value={editingPatient.medications || ''}
                      onChange={(e) => setEditingPatient({...editingPatient, medications: e.target.value})}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8.5px] font-bold text-slate-500 uppercase">Alergias relatadas</label>
                    <input 
                      type="text"
                      value={editingPatient.allergies || ''}
                      onChange={(e) => setEditingPatient({...editingPatient, allergies: e.target.value})}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-rose-200"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold text-slate-500 uppercase text-amber-600">Contraindicações Clínicas</label>
                  <input 
                    type="text"
                    value={editingPatient.contraindications || ''}
                    onChange={(e) => setEditingPatient({...editingPatient, contraindications: e.target.value})}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-amber-200"
                    placeholder="Gestação, preenchedor permanente prévio, etc."
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold text-slate-500 uppercase">Planejamento Detalhado da Sessão (Produtos & Volumes)</label>
                  <textarea 
                    value={editingPatient.planning || ''}
                    onChange={(e) => setEditingPatient({...editingPatient, planning: e.target.value})}
                    rows={2}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                    placeholder="Ex: Aplicação de 40U de toxina na região frontal, corrugador e prócerus."
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[8.5px] font-bold text-slate-500 uppercase">Orientações de Cuidados Pós-Atendimento</label>
                  <textarea 
                    value={editingPatient.postOpInstructions || ''}
                    onChange={(e) => setEditingPatient({...editingPatient, postOpInstructions: e.target.value})}
                    rows={1}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none"
                    placeholder="Não deitar por 4 horas, evitar atividade física intensa"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="flex gap-2.5 items-center">
                    <input 
                      type="checkbox"
                      id="edit-image-consent"
                      checked={!!editingPatient.imageConsentSigned}
                      onChange={(e) => setEditingPatient({...editingPatient, imageConsentSigned: e.target.checked})}
                      className="w-4 h-4 cursor-pointer text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                    />
                    <label htmlFor="edit-image-consent" className="text-[10px] font-bold text-slate-700 uppercase tracking-tight cursor-pointer select-none">Termo de Imagem Assinado</label>
                  </div>

                  <div className="flex gap-2.5 items-center">
                    <input 
                      type="checkbox"
                      id="edit-tcle"
                      checked={!!editingPatient.tcleSigned}
                      onChange={(e) => setEditingPatient({...editingPatient, tcleSigned: e.target.checked})}
                      className="w-4 h-4 cursor-pointer text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                    />
                    <label htmlFor="edit-tcle" className="text-[10px] font-bold text-slate-700 uppercase tracking-tight cursor-pointer select-none">TCLE Assinado</label>
                  </div>
                </div>
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsPatientModalOpen(false); setEditingPatient(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSavePatientForm}
                className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
              >
                Salvar Prontuário
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
