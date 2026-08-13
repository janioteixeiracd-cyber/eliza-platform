import React, { useState } from 'react';
import { 
  Plus, 
  Users, 
  Award, 
  Trash2, 
  Edit3, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Mail, 
  Phone, 
  Key, 
  X,
  Lock,
  LockOpen
} from 'lucide-react';

interface StudentManagerProps {
  students: any[];
  courses: any[];
  onSaveStudent: (student: any) => Promise<void>;
  onDeleteStudent: (studentId: string) => Promise<void>;
  onRecreateStudentAccess?: (student: any) => Promise<void>;
}

export default function StudentManager({
  students,
  courses,
  onSaveStudent,
  onDeleteStudent,
  onRecreateStudentAccess
}: StudentManagerProps) {
  
  const [selectedStudent, setSelectedStudent] = useState<any | null>(null);
  const [isStudentModalOpen, setIsStudentModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any | null>(null);

  const initStudentForm = (s: any = null) => {
    let defaultTempPassword = '';
    if (!s) {
      const randomDigits = Math.floor(10000 + Math.random() * 90000);
      defaultTempPassword = `Eliza${randomDigits}@`;
    }
    setEditingStudent(s ? { ...s } : {
      name: '',
      cpf: '',
      councilNumber: '',
      profession: 'Dentista',
      phone: '',
      email: '',
      courseId: courses[0]?.id || '',
      batchName: 'Turma A',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), // +30 days
      status: 'ativo',
      tempPassword: defaultTempPassword,
      
      // Permissions
      permViewSchedule: true,
      permViewPatients: true,
      permEditPatientRecords: false,
      permAttachPhotos: true,
      permWriteEvolution: false,
      permViewMaterials: true,
      permViewPlannedProcedures: true,
      permDownloadCertificate: false,
      permAccessAfterEnd: false,
      accessExpirationDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) // +60 days
    });
    setIsStudentModalOpen(true);
  };

  const handleSaveStudentForm = async () => {
    if (!editingStudent.name) return;
    await onSaveStudent(editingStudent);
    setIsStudentModalOpen(false);
    setEditingStudent(null);
  };

  return (
    <div className="space-y-6">
      
      {/* Title bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Alunos & Profissionais Cadastrados</h2>
          <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Controles Individuais de Permissões e Acesso Exclusivo por Expiração</p>
        </div>
        
        <button 
          onClick={() => initStudentForm()}
          className="px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white pb-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer shadow-md select-none mt-1 sm:mt-0"
        >
          <Plus className="w-4 h-4" /> Novo Aluno
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Split Left: List */}
        <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left">
          <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-4 border-b border-slate-50 pb-3 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-teal-605" /> LISTAGEM DE ALUNOS
          </h3>

          {students.length === 0 ? (
            <p className="text-center text-slate-400 italic text-xs py-10">Nenhum aluno matriculado ainda.</p>
          ) : (
            <div className="divide-y divide-slate-100 pr-1 overflow-y-auto max-h-[50vh] custom-scrollbar">
              {students.map(student => {
                const courseName = courses.find(c => c.id === student.courseId)?.name || 'Outro curso';
                const today = new Date().toISOString().slice(0, 10);
                const isAccessExpired = student.accessExpirationDate && student.accessExpirationDate < today && !student.permAccessAfterEnd;

                return (
                  <div 
                    key={student.id}
                    onClick={() => setSelectedStudent(student)}
                    className={`py-4 hover:bg-slate-50/50 rounded-xl px-2 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      selectedStudent?.id === student.id ? 'bg-slate-50/70 border border-slate-100' : ''
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                          student.status === 'ativo' ? 'bg-emerald-50 text-emerald-800' :
                          student.status === 'concluído' ? 'bg-purple-50 text-purple-800' : 'bg-slate-150 text-slate-600'
                        }`}>
                          {student.status}
                        </span>
                        
                        {isAccessExpired ? (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[8px] bg-rose-50 text-rose-800 font-bold uppercase">
                            <Lock className="w-3 h-3" /> Expirado
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[8px] bg-slate-100 text-slate-700 font-bold uppercase">
                            <LockOpen className="w-3 h-3" /> Liberado
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">{student.name}</h4>
                      <p className="text-[10px] text-slate-450 mt-1 font-semibold">Conselho: <span className="font-bold text-slate-705">{student.councilNumber || "Não informado"} ({student.profession})</span></p>
                      <p className="text-[10px] text-slate-400">{courseName} | <span className="font-bold">{student.batchName}</span></p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); if (confirm('Remover aluno e bloquear acessos acadêmicos?')) onDeleteStudent(student.id); }}
                        className="p-2 hover:bg-rose-50 text-rose-500 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Split Right: Selected Student detailed permissions */}
        <div className="lg:col-span-5 bg-white p-6 sm:p-8 rounded-[2rem] border border-slate-200 text-left">
          {selectedStudent ? (
            <div className="space-y-6">
              <div className="border-b border-slate-105 pb-4 mb-4">
                <span className="text-[9px] font-black text-teal-605 uppercase tracking-widest block">PERMISSÕES DO ALUNO</span>
                <h3 className="text-md font-black text-slate-800 mt-1 uppercase">{selectedStudent.name}</h3>
                <p className="text-[11px] text-slate-400 mt-1">Contato: {selectedStudent.email} | {selectedStudent.phone}</p>
                <div className="mt-3 p-3 bg-slate-50 border border-slate-205 rounded-xl text-[10.5px] font-bold text-slate-700">
                  <p>Início Acesso: {selectedStudent.startDate}</p>
                  <p className="mt-1">Expiração do Painel: <span className="text-slate-900 font-extrabold">{selectedStudent.accessExpirationDate || "Não definida"}</span></p>
                </div>
              </div>

              {/* Permissions list checkboxes disabled for display */}
              <div className="space-y-3">
                {[
                  { key: 'permViewSchedule', label: 'Ver Agenda do Curso' },
                  { key: 'permViewPatients', label: 'Ver Pacientes do Curso' },
                  { key: 'permEditPatientRecords', label: 'Editar Prontuário dos Pacientes' },
                  { key: 'permAttachPhotos', label: 'Anexar Fotos e Mídia' },
                  { key: 'permWriteEvolution', label: 'Escrever Evolução de Prática' },
                  { key: 'permViewMaterials', label: 'Ver Materiais Didáticos' },
                  { key: 'permViewPlannedProcedures', label: 'Ver Fila de Atendimento Prático' },
                  { key: 'permDownloadCertificate', label: 'Liberado Download do Certificado' },
                  { key: 'permAccessAfterEnd', label: 'Manter Acesso Vitalício (Sem Expiração)' }
                ].map(perm => (
                  <div key={perm.key} className="flex gap-2.5 items-center">
                    <input 
                      type="checkbox"
                      checked={!!selectedStudent[perm.key]}
                      disabled
                      className="w-4 h-4 text-teal-600 border-slate-350 rounded cursor-not-allowed opacity-80"
                    />
                    <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">{perm.label}</span>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
                <button 
                  onClick={() => initStudentForm(selectedStudent)}
                  className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  <Edit3 className="w-4 h-4" /> Alterar Permissões
                </button>

                {onRecreateStudentAccess && (
                  <button 
                    onClick={() => {
                      if (confirm(`Recriar/sincronizar acesso definitivo para ${selectedStudent.name} (${selectedStudent.email})?`)) {
                        onRecreateStudentAccess(selectedStudent);
                      }
                    }}
                    className="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Key className="w-4 h-4" /> Recriar Acesso do Aluno
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center text-slate-400 py-16">
              <Users className="w-10 h-10 text-slate-200 mb-2" />
              <p className="text-xs italic text-center px-6">Selecione um aluno da listagem à esquerda para configurar e auditar as permissões de acesso, certificados e prontuário.</p>
            </div>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────── */}
      {/* Student Modal */}
      {isStudentModalOpen && editingStudent && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-[2rem] border border-slate-200 w-full max-w-lg shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
            <header className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-sm font-black text-slate-905 tracking-tight uppercase flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-605" />
                {editingStudent.id ? 'Ajustar Permissões & Dados Aluno' : 'Cadastrar Aluno no Módulo'}
              </h3>
              <button onClick={() => { setIsStudentModalOpen(false); setEditingStudent(null); }} className="text-slate-400 hover:text-slate-600 border-none bg-transparent">
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Nome do Aluno / Profissional</label>
                <input 
                  type="text"
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({...editingStudent, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  placeholder="Ex: Dra. Ana Julia"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">CPF</label>
                  <input 
                    type="text"
                    value={editingStudent.cpf}
                    onChange={(e) => setEditingStudent({...editingStudent, cpf: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Nº do Conselho (CRO/CRM)</label>
                  <input 
                    type="text"
                    value={editingStudent.councilNumber}
                    onChange={(e) => setEditingStudent({...editingStudent, councilNumber: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                    placeholder="Ex: CRO-SP 12345"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Profissão</label>
                  <input 
                    type="text"
                    value={editingStudent.profession}
                    onChange={(e) => setEditingStudent({...editingStudent, profession: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Status Geral</label>
                  <select 
                    value={editingStudent.status}
                    onChange={(e) => setEditingStudent({...editingStudent, status: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  >
                    <option value="ativo">Ativo</option>
                    <option value="inativo">Inativo / Trancado</option>
                    <option value="concluído">Concluído</option>
                    <option value="suspenso">Suspenso</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">WhatsApp</label>
                  <input 
                    type="text"
                    value={editingStudent.phone}
                    onChange={(e) => setEditingStudent({...editingStudent, phone: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">E-mail</label>
                  <input 
                    type="email"
                    value={editingStudent.email}
                    onChange={(e) => setEditingStudent({...editingStudent, email: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100">
                <label className="text-[9px] font-black text-indigo-700 uppercase pl-0.5 block">Senha Provisória de Acesso</label>
                <input 
                  type="text"
                  value={editingStudent.tempPassword || ''}
                  onChange={(e) => setEditingStudent({...editingStudent, tempPassword: e.target.value})}
                  className="w-full px-4 py-2.5 bg-white border border-indigo-200 rounded-xl text-xs font-extrabold outline-none focus:ring-2 focus:ring-indigo-500/20 text-indigo-950"
                  placeholder="Defina uma senha provisória"
                />
                <p className="text-[8.5px] text-slate-405 font-bold uppercase tracking-wide mt-1 leading-normal">
                  Esta senha será salva para o login inicial do aluno. Ao acessar, ele receberá a notificação para trocá-la por uma senha definitiva.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Vincular a Curso</label>
                  <select 
                    value={editingStudent.courseId}
                    onChange={(e) => setEditingStudent({...editingStudent, courseId: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                  >
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Identificação Turma</label>
                  <input 
                    type="text"
                    value={editingStudent.batchName}
                    onChange={(e) => setEditingStudent({...editingStudent, batchName: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Início Acesso</label>
                  <input 
                    type="date"
                    value={editingStudent.startDate}
                    onChange={(e) => setEditingStudent({...editingStudent, startDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5">Fim Acesso</label>
                  <input 
                    type="date"
                    value={editingStudent.endDate}
                    onChange={(e) => setEditingStudent({...editingStudent, endDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase pl-0.5 text-orange-600">Bloqueio Geral Em</label>
                  <input 
                    type="date"
                    value={editingStudent.accessExpirationDate}
                    onChange={(e) => setEditingStudent({...editingStudent, accessExpirationDate: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-205 rounded-xl text-xs font-semibold outline-none"
                  />
                </div>
              </div>

              {/* Checkbox controls inside modal form */}
              <div className="bg-slate-100 p-4 rounded-2xl space-y-3">
                <span className="text-[8.5px] font-black text-slate-500 uppercase tracking-widest block border-b border-slate-200 pb-1 mb-2">Painel de Privilégios no Dashboard Simulado</span>
                {[
                  { key: 'permViewSchedule', label: 'Visualizar Calendário de Aulas' },
                  { key: 'permViewPatients', label: 'Visualizar Fichas de Pacientes' },
                  { key: 'permEditPatientRecords', label: 'Editar Prontuário Clínico' },
                  { key: 'permAttachPhotos', label: 'Anexar Mídia & Fotos Clínica' },
                  { key: 'permWriteEvolution', label: 'Evoluir Procedimentos na Aula' },
                  { key: 'permViewMaterials', label: 'Baixar e Acessar Materiais Didáticos' },
                  { key: 'permViewPlannedProcedures', label: 'Ver Fila de Procedimentos Práticos' },
                  { key: 'permDownloadCertificate', label: 'Liberado Emissão de Certificado Final' },
                  { key: 'permAccessAfterEnd', label: 'Liberar Acesso mesmo após Expiração' }
                ].map(p => (
                  <div key={p.key} className="flex gap-2.5 items-center">
                    <input 
                      type="checkbox"
                      id={`edit-perm-${p.key}`}
                      checked={!!editingStudent[p.key]}
                      onChange={(e) => setEditingStudent({...editingStudent, [p.key]: e.target.checked})}
                      className="w-4 h-4 text-teal-655 focus:ring-teal-500 rounded border-slate-300 cursor-pointer"
                    />
                    <label htmlFor={`edit-perm-${p.key}`} className="text-[10px] font-bold text-slate-700 tracking-tight cursor-pointer select-none">{p.label}</label>
                  </div>
                ))}
              </div>
            </div>

            <footer className="p-6 border-t border-slate-100 flex gap-3 shrink-0">
              <button 
                onClick={() => { setIsStudentModalOpen(false); setEditingStudent(null); }}
                className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveStudentForm}
                className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 shadow-lg transition-all"
              >
                Salvar Privilégios
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
