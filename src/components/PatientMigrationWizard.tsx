import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Upload, Sparkles, FileText, Trash2, Plus, 
  Loader2, AlertTriangle, ChevronRight, Coins, 
  User, Check, AlertCircle, Smartphone, Info
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { collection, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { PatientMigrationAIService, ExtractedPatientData } from '../services/PatientMigrationAIService';

interface PatientMigrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  existingPatients: any[]; // To perform client-side deduplication check
  onSuccess: (newPatientId?: string) => void; // Trigger reload of patients list
  preselectedPatientId?: string | null; // For "Importar histórico antigo" feature
}

export default function PatientMigrationWizard({
  isOpen,
  onClose,
  existingPatients,
  onSuccess,
  preselectedPatientId = null
}: PatientMigrationWizardProps) {
  const { clinic, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // States
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<Array<{ name: string; type: string; base64: string; size: number }>>([]);
  const [sourceSystem, setSourceSystem] = useState('sistema_antigo');
  const [customSource, setCustomSource] = useState('');
  const [initialName, setInitialName] = useState('');
  const [initialPhone, setInitialPhone] = useState('');
  const [userRemarks, setUserRemarks] = useState('');
  
  // AI Results
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [extractedData, setExtractedData] = useState<ExtractedPatientData | null>(null);
  const [activeTab, setActiveTab] = useState<'cadastro' | 'clinico' | 'financeiro' | 'alertas'>('cadastro');

  // Deduplication Modal State
  const [duplicateCheckOpen, setDuplicateCheckOpen] = useState(false);
  const [matchedPatients, setMatchedPatients] = useState<any[]>([]);
  const [targetPatientAction, setTargetPatientAction] = useState<{ type: 'create' | 'update'; targetId?: string } | null>(null);

  if (!isOpen) return null;

  // File Handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFiles(prev => [...prev, {
            name: file.name,
            type: file.type || 'image/png',
            size: file.size,
            base64: reader.result as string
          }]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      Array.from(e.dataTransfer.files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFiles(prev => [...prev, {
            name: file.name,
            type: file.type || 'image/png',
            size: file.size,
            base64: reader.result as string
          }]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Run AI analysis
  const handleAnalyze = async () => {
    if (!clinic) return;
    if (files.length === 0) {
      alert("Por favor, envie ao menos um print ou documento para continuar.");
      return;
    }

    setStep(2);
    setLoading(true);
    setLoadingStep(0);

    const stages = [
      "[PATIENT_MIGRATION] Enviando arquivos para ELIZA AI...",
      "[PATIENT_MIGRATION] Interpretando dados cadastrais (Nome, CPF, Contatos)...",
      "[PATIENT_MIGRATION] Estruturando evolução clínica e histórico de procedimentos...",
      "[PATIENT_MIGRATION] Consolidando lançamentos financeiros, parcelas e status de pagamentos...",
      "[PATIENT_MIGRATION] Gerando alertas e listando possíveis informações ausentes..."
    ];

    const interval = setInterval(() => {
      setLoadingStep(prev => (prev < stages.length - 1 ? prev + 1 : prev));
    }, 2800);

    try {
      // 3. Save temporary upload in Firestore clinics/{clinicId}/patient_migrations/{migrationId}
      const migrationsCol = collection(db, 'clinics', clinic.id, 'patient_migrations');
      const migrationDocRef = doc(migrationsCol);
      const mId = migrationDocRef.id;

      const metadataFiles = files.map(f => ({
        name: f.name,
        type: f.type,
        size: f.size
      }));

      const finalSource = sourceSystem === 'outro' ? customSource : sourceSystem;

      await setDoc(migrationDocRef, {
        status: "uploaded",
        sourceSystem: finalSource || "sistema_antigo",
        files: metadataFiles,
        createdBy: user?.uid || "unknown",
        createdAt: new Date().toISOString(),
        patientId: preselectedPatientId || null
      });

      // Step 12 Log standard:
      console.log("[PATIENT_MIGRATION] upload:", metadataFiles);

      // Call AI extraction service
      const response = await PatientMigrationAIService.analyzePatientMigration({
        clinicId: clinic.id,
        migrationId: mId,
        files: files,
        additionalNotes: `Informações adicionais informadas pelo usuário:
        - Nome sugerido: ${initialName}
        - Telefone sugerido: ${initialPhone}
        - Observação sobre origem: ${finalSource}
        - Anotações extras: ${userRemarks}`
      });

      // Merge manually provided info if the AI missed it
      if (initialName && !response.patient.name) response.patient.name = initialName;
      if (initialPhone && !response.patient.phone) response.patient.phone = initialPhone;

      clearInterval(interval);
      setExtractedData(response);
      setStep(3);
    } catch (err: any) {
      clearInterval(interval);
      alert(err.message || "Erro desconhecido ao processar migração.");
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  // Helper functions for updating state fields in step 3
  const updatePatientField = (field: string, value: string) => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      patient: {
        ...extractedData.patient,
        [field]: value
      }
    });
  };

  const updateClinicalItem = (index: number, field: string, value: string) => {
    if (!extractedData) return;
    const updated = [...extractedData.clinicalHistory];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedData({ ...extractedData, clinicalHistory: updated });
  };

  const addClinicalItem = () => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      clinicalHistory: [
        ...extractedData.clinicalHistory,
        {
          date: new Date().toISOString().substring(0, 10),
          type: 'Procedimento',
          description: '',
          professional: 'A revisar',
          products: '',
          notes: 'Adicionado manualmente na revisão',
          confidence: 'alta'
        }
      ]
    });
  };

  const removeClinicalItem = (index: number) => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      clinicalHistory: extractedData.clinicalHistory.filter((_, i) => i !== index)
    });
  };

  const updateFinancialItem = (index: number, field: string, value: any) => {
    if (!extractedData) return;
    const updated = [...extractedData.financialHistory];
    updated[index] = { ...updated[index], [field]: value };
    setExtractedData({ ...extractedData, financialHistory: updated });
  };

  const addFinancialItem = () => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      financialHistory: [
        ...extractedData.financialHistory,
        {
          date: new Date().toISOString().substring(0, 10),
          description: 'Valor Avulso',
          amount: 0,
          paidAmount: 0,
          pendingAmount: 0,
          status: 'pending',
          paymentMethod: 'Dinheiro',
          installments: 1,
          notes: 'Adicionado manualmente na revisão',
          confidence: 'alta'
        }
      ]
    });
  };

  const removeFinancialItem = (index: number) => {
    if (!extractedData) return;
    setExtractedData({
      ...extractedData,
      financialHistory: extractedData.financialHistory.filter((_, i) => i !== index)
    });
  };

  // Step 10: Deduplication check and save
  const handleSaveAttempt = () => {
    if (!extractedData) return;
    const nameInput = extractedData.patient.name?.trim().toLowerCase() || "";
    const phoneInput = extractedData.patient.phone?.replace(/\D/g, '') || "";
    const cpfInput = extractedData.patient.cpf?.replace(/\D/g, '') || "";
    const emailInput = extractedData.patient.email?.trim().toLowerCase() || "";

    // If preselected patient exists, always update that specific patient
    if (preselectedPatientId) {
      handleConfirmSave('update', preselectedPatientId);
      return;
    }

    // Check existing patient list for similarity
    const matches = existingPatients.filter(p => {
      const pName = p.name?.trim().toLowerCase() || "";
      const pPhone = p.phone?.replace(/\D/g, '') || "";
      const pCpf = p.cpf?.replace(/\D/g, '') || "";
      const pEmail = p.email?.trim().toLowerCase() || "";

      const nameMatch = nameInput && (pName.includes(nameInput) || nameInput.includes(pName));
      const phoneMatch = phoneInput && pPhone && (pPhone.includes(phoneInput) || phoneInput.includes(pPhone));
      const cpfMatch = cpfInput && pCpf && pCpf === cpfInput;
      const emailMatch = emailInput && pEmail && pEmail === emailInput;

      return nameMatch || phoneMatch || cpfMatch || emailMatch;
    });

    if (matches.length > 0) {
      setMatchedPatients(matches);
      setDuplicateCheckOpen(true);
    } else {
      // Safe to create new patient
      handleConfirmSave('create');
    }
  };

  // Step 7: Creation / Updates
  const handleConfirmSave = async (action: 'create' | 'update', targetId?: string) => {
    if (!clinic || !extractedData) return;
    setLoading(true);
    setDuplicateCheckOpen(false);

    try {
      let activePatientId = targetId || "";

      if (action === 'create') {
        // Create new patient
        const newPatientRef = doc(collection(db, 'clinics', clinic.id, 'patients'));
        activePatientId = newPatientRef.id;

        await setDoc(newPatientRef, {
          name: extractedData.patient.name || "Paciente Migrado",
          phone: extractedData.patient.phone || "",
          email: extractedData.patient.email || "",
          cpf: extractedData.patient.cpf || "",
          birthDate: extractedData.patient.birthDate || "",
          address: extractedData.patient.address || "",
          notes: extractedData.patient.notes || "",
          status: 'active',
          migrationSource: sourceSystem === 'outro' ? customSource : sourceSystem,
          createdAt: serverTimestamp()
        });
      } else if (action === 'update' && activePatientId) {
        // Update existing patient (only override non-empty retrieved values to prevent wiping existing data)
        const patientRef = doc(db, 'clinics', clinic.id, 'patients', activePatientId);
        
        const updateFields: any = {};
        if (extractedData.patient.name) updateFields.name = extractedData.patient.name;
        if (extractedData.patient.phone) updateFields.phone = extractedData.patient.phone;
        if (extractedData.patient.email) updateFields.email = extractedData.patient.email;
        if (extractedData.patient.cpf) updateFields.cpf = extractedData.patient.cpf;
        if (extractedData.patient.birthDate) updateFields.birthDate = extractedData.patient.birthDate;
        if (extractedData.patient.address) updateFields.address = extractedData.patient.address;
        if (extractedData.patient.notes) updateFields.notes = extractedData.patient.notes;
        
        await setDoc(patientRef, updateFields, { merge: true });
      }

      let activePatientName = "Paciente Migrado";
      if (action === 'create') {
        activePatientName = extractedData.patient.name || "Paciente Migrado";
      } else if (action === 'update' && activePatientId) {
        const found = existingPatients.find(p => p.id === activePatientId);
        activePatientName = found?.name || extractedData.patient.name || "Paciente Migrado";
      }

      const patientBasePath = `clinics/${clinic.id}/patients/${activePatientId}`;

      // Create clinicalHistory treatments in clinics/{clinicId}/patients/{patientId}/treatments/{treatmentId}
      for (const item of extractedData.clinicalHistory) {
        const treatmentRef = doc(collection(db, patientBasePath, 'treatments'));
        await setDoc(treatmentRef, {
          description: item.description || item.type,
          type: item.type || "Geral",
          professional: item.professional || "Sistema Anterior",
          date: item.date || new Date().toISOString().substring(0, 10),
          status: 'completed',
          notes: item.notes || "",
          products: item.products || "",
          migrated: true,
          evolutions: [
            {
              text: `[MIGRAÇÃO IA] Procedimento migrado do sistema anterior (${sourceSystem === 'outro' ? customSource : sourceSystem}). Confiança: ${item.confidence}. Detalhes: ${item.notes || 'Nenhum'}`,
              date: item.date || new Date().toISOString().substring(0, 10)
            }
          ]
        });
      }

      // Create financial entries in clinics/{clinicId}/financial_entries/{entryId}
      for (const item of extractedData.financialHistory) {
        const entryRef = doc(collection(db, 'clinics', clinic.id, 'financial_entries'));
        const docId = entryRef.id;
        const entryData = {
          type: 'receita', // Patients pay us
          category: 'Crescimento Clínico',
          patientId: activePatientId,
          patient_id: activePatientId,
          patientName: activePatientName,
          patient_name: activePatientName,
          description: item.description || "Lançamento Migrado",
          amount: item.amount || 0,
          value: item.amount || 0,
          paidAmount: item.paidAmount || 0,
          paid_amount: item.paidAmount || 0,
          pendingAmount: item.pendingAmount || 0,
          remainingAmount: item.pendingAmount || 0,
          remaining_amount: item.pendingAmount || 0,
          status: item.status === 'paid' ? 'pago' : item.status === 'partial' ? 'parcial' : 'pendente',
          dueDate: item.date || new Date().toISOString().substring(0, 10),
          due_date: item.date || new Date().toISOString().substring(0, 10),
          date: item.date || new Date().toISOString().substring(0, 10),
          paymentMethod: item.paymentMethod || "Desconhecido",
          payment_method: item.paymentMethod || "Desconhecido",
          installments: item.installments || 1,
          competence_month: (item.date || new Date().toISOString()).substring(0, 7),
          notes: `[MIGRAÇÃO IA] Lançamento importado. Confiança: ${item.confidence}. Notas: ${item.notes || 'Sem detalhes'}`,
          createdBy: user?.displayName || "ELIZA AI",
          createdAt: serverTimestamp(),
          created_at: serverTimestamp()
        };
        await setDoc(entryRef, entryData);

        // Also write to patient subcollection for dual-write compatibility
        try {
          const patFinRef = doc(db, patientBasePath, 'financial', docId);
          await setDoc(patFinRef, {
            description: item.description || "Lançamento Migrado",
            value: item.amount || 0,
            amount: item.amount || 0,
            status: item.status === 'paid' ? 'received' : 'pending',
            category: 'Crescimento Clínico',
            date: item.date || new Date().toISOString().substring(0, 10),
            migrated: true,
            notes: `[MIGRAÇÃO IA] Confiança: ${item.confidence}`
          });
        } catch (subErr) {
          console.error("[MIGRATION_SUBCOLLECTION_WRITE_ERR]", subErr);
        }
      }

      // Create migration note: clinics/{clinicId}/patients/{patientId}/notes/{noteId}
      const noteRef = doc(collection(db, patientBasePath, 'notes'));
      const formattedDate = new Date().toLocaleDateString('pt-BR');
      const userName = user?.displayName || user?.email || "Usuário";
      await setDoc(noteRef, {
        text: `Paciente migrado parcialmente por IA a partir de prints/documentos do sistema anterior. Dados revisados por ${userName} em ${formattedDate}.`,
        createdAt: serverTimestamp(),
        createdBy: userName,
        isMigrationFlag: true
      });

      // Step 12 Log complete:
      console.log("[PATIENT_MIGRATION] confirmed patient:", activePatientId);

      onSuccess(activePatientId);
      onClose();
    } catch (err: any) {
      alert("Erro ao salvar dados finais: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 md:p-6 backdrop-blur-sm overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-slate-50 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header bar */}
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-teal-50 text-teal-600 rounded-xl border border-teal-100/50">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-lg">Migração Inteligente por IA</h3>
              <p className="text-xs text-slate-400">Migre históricos, procedimentos e dados financeiros a partir de fotos e prints</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px]">
          
          {/* STEP 1: UPLOAD DESIGN */}
          {step === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Drag drop files panel */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                <div 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-teal-400 bg-white rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[250px] group"
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    multiple 
                    onChange={handleFileChange}
                    className="hidden" 
                    accept="image/*,application/pdf"
                  />
                  <div className="p-4 bg-teal-50 text-teal-600 rounded-2xl border border-teal-100 mb-4 group-hover:scale-105 transition-transform duration-300">
                    <Upload className="w-8 h-8" />
                  </div>
                  <h4 className="font-bold text-slate-800 mb-1.5 text-center">Solte os arquivos ou clique para buscar</h4>
                  <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed">
                    Arraste prints de telas de sistemas antigos, PDFs, fotos do prontuário ou histórico financeiro e clínico.
                  </p>
                </div>

                {/* Uploaded Files grid */}
                {files.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-4">
                    <h5 className="font-bold text-xs text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
                      <span>Arquivos para Migrar ({files.length})</span>
                      <button 
                        onClick={() => setFiles([])} 
                        className="text-[10px] text-red-500 hover:underline font-bold"
                      >
                        Limpar Todos
                      </button>
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {files.map((file, idx) => (
                        <div key={idx} className="bg-slate-50 border border-slate-100 rounded-xl p-3 relative group flex items-center gap-2">
                          <FileText className="w-5 h-5 text-teal-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-700 truncate">{file.name}</p>
                            <p className="text-[10px] text-slate-400">{(file.size / 1024).toFixed(0)} KB</p>
                          </div>
                          <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                            className="absolute -top-1.5 -right-1.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-full p-1 border border-white opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Patient metadata options panel */}
              <div className="lg:col-span-5 flex flex-col gap-5 bg-white border border-slate-200 rounded-2xl p-6">
                <div>
                  <h4 className="font-bold text-sm text-slate-800 mb-2 uppercase tracking-wide">Metadados da Migração</h4>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">Ajude a ELIZA a interpretar de forma ainda mais precisa informando dados adicionais.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Nome do Paciente (Opcional)</label>
                    <input 
                      type="text"
                      placeholder="Para garantir se a IA não ler perfeitamente"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:border-teal-500 outline-none"
                      value={initialName}
                      onChange={e => setInitialName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Telefone / WhatsApp (Opcional)</label>
                    <input 
                      type="text"
                      placeholder="Ex: (11) 99999-9999"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:border-teal-500 outline-none"
                      value={initialPhone}
                      onChange={e => setInitialPhone(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Qual o sistema de origem?</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:border-teal-500 outline-none"
                      value={sourceSystem}
                      onChange={e => setSourceSystem(e.target.value)}
                    >
                      <option value="sistema_antigo">Sistema Antigo Geral (OCR)</option>
                      <option value="Simples Dental">Simples Dental</option>
                      <option value="Dental Office">Dental Office</option>
                      <option value="Cliníca">Cliníca</option>
                      <option value="planilha">Planilha ou PDF estruturado</option>
                      <option value="outro">Outro (especificar abaixo)</option>
                    </select>
                  </div>

                  {sourceSystem === 'outro' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Especifique o sistema</label>
                      <input 
                        type="text"
                        placeholder="Nome do software anterior"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:border-teal-500 outline-none"
                        value={customSource}
                        onChange={e => setCustomSource(e.target.value)}
                      />
                    </motion.div>
                  )}

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Alguma observação crucial?</label>
                    <textarea 
                      placeholder="Ex: 'Algumas guias estão amassadas' ou 'Ignore o dente 18 do histórico'"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:border-teal-500 outline-none min-h-[70px]"
                      value={userRemarks}
                      onChange={e => setUserRemarks(e.target.value)}
                    />
                  </div>
                </div>

                <button 
                  onClick={handleAnalyze}
                  disabled={files.length === 0 || loading}
                  className="w-full bg-teal-600 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-teal-600/25 hover:bg-teal-700 transition-all flex items-center justify-center gap-2 mt-2 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                >
                  <Sparkles className="w-4 h-4" />
                  Iniciar Migração Inteligente
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PROCESSING LOGS SCREEN */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <Loader2 className="w-12 h-12 text-teal-600 animate-spin mb-6" />
              <h4 className="font-bold text-slate-800 text-lg mb-2">ELIZA está analisando seus documentos</h4>
              <p className="text-xs text-slate-400 text-center max-w-sm mb-10 leading-relaxed">
                Nossos motores de inteligência artificial estão realizando o OCR dos prints, identificando os registros de procedimentos e financeira. Isso pode levar alguns segundos.
              </p>

              {/* Dynamic Progress Indicator */}
              <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
                  <span>Progresso da Extração</span>
                  <span>{Math.round(((loadingStep + 1) / 5) * 100)}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-teal-600 transition-all duration-500"
                    style={{ width: `${((loadingStep + 1) / 5) * 100}%` }}
                  />
                </div>
                
                <div className="pt-2 text-[10px] font-mono text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-ping shrink-0" />
                    <span>
                      {loadingStep === 0 && "Enviando arquivos..."}
                      {loadingStep === 1 && "Processando OCR de dados cadastrais..."}
                      {loadingStep === 2 && "Extraindo evoluções e dentes de tratamentos..."}
                      {loadingStep === 3 && "Calculando valores financeiros estruturados..."}
                      {loadingStep === 4 && "Finalizando e gerando alertas importantes..."}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: REVISION SCREEN DESIGN */}
          {step === 3 && extractedData && (
            <div className="flex flex-col gap-6">
              
              {extractedData.confidence !== 'alta' && (
                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-3xl p-5 flex gap-3.5 items-start shadow-sm">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="text-[11px] font-black uppercase tracking-wider text-amber-800">Certeza de Leitura Parcial ou Limitada (IA ELIZA)</h5>
                    <p className="text-[10px] text-amber-700 font-bold leading-normal mt-1 uppercase">
                      Algumas datas, valores ou campos nos prints anexados estavam parcial ou inteiramente borrados, em formatos incomuns ou são difíceis de ler com 100% de precisão. Por favor, revise e edite atentamente os campos das tabelas abaixo antes de importar.
                    </p>
                  </div>
                </div>
              )}

              {/* Warnings and overview header */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-slate-500 text-xs font-semibold">Confiança Geral da Extração:</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold leading-5 uppercase tracking-wider ${
                      extractedData.confidence === 'alta' ? 'bg-green-100 text-green-700' :
                      extractedData.confidence === 'média' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700 animate-pulse'
                    }`}>
                      {extractedData.confidence} confiança
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Revise os dados antes de preencher a ficha permanente. Nada foi salvo ainda.</p>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => setStep(1)} 
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-bold text-xs transition-all"
                  >
                    Voltar e Substituir Arquivos
                  </button>
                  <button 
                    onClick={handleSaveAttempt} 
                    className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md shadow-teal-600/10 flex items-center gap-1.5 transition-all"
                  >
                    <Check className="w-4 h-4" />
                    Confirmar e Importar Ficha
                  </button>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex border-b border-slate-200 gap-1 overflow-x-auto">
                <button 
                  onClick={() => setActiveTab('cadastro')}
                  className={`px-5 py-3 font-bold text-xs uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-1.5 ${
                    activeTab === 'cadastro' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <User className="w-4 h-4" />
                  Dados Cadastrais
                </button>
                <button 
                  onClick={() => setActiveTab('clinico')}
                  className={`px-5 py-3 font-bold text-xs uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-1.5 ${
                    activeTab === 'clinico' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  Histórico Clínico ({extractedData.clinicalHistory.length})
                </button>
                <button 
                  onClick={() => setActiveTab('financeiro')}
                  className={`px-5 py-3 font-bold text-xs uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-1.5 ${
                    activeTab === 'financeiro' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Coins className="w-4 h-4" />
                  Histórico Financeiro ({extractedData.financialHistory.length})
                </button>
                <button 
                  onClick={() => setActiveTab('alertas')}
                  className={`px-5 py-3 font-bold text-xs uppercase tracking-wider border-b-2 transition-all shrink-0 flex items-center gap-1.5 ${
                    activeTab === 'alertas' ? 'border-teal-600 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  Alertas/Detecção ({extractedData.alerts.length + extractedData.missingInformation.length})
                </button>
              </div>

              {/* Tab Contents */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 min-h-[350px]">
                
                {/* 1. Cadastros Tab */}
                {activeTab === 'cadastro' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Nome Completo</label>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                          value={extractedData.patient.name || ''}
                          onChange={e => updatePatientField('name', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Telefone / WhatsApp</label>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                          value={extractedData.patient.phone || ''}
                          onChange={e => updatePatientField('phone', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">E-mail</label>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                          value={extractedData.patient.email || ''}
                          onChange={e => updatePatientField('email', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">CPF</label>
                          <input 
                            type="text" 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                            value={extractedData.patient.cpf || ''}
                            onChange={e => updatePatientField('cpf', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Data Nascimento</label>
                          <input 
                            type="text" 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                            placeholder="YYYY-MM-DD"
                            value={extractedData.patient.birthDate || ''}
                            onChange={e => updatePatientField('birthDate', e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Endereço Residencial</label>
                        <input 
                          type="text" 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none"
                          value={extractedData.patient.address || ''}
                          onChange={e => updatePatientField('address', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Anotações Livres</label>
                        <textarea 
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-teal-500 outline-none min-h-[60px]"
                          value={extractedData.patient.notes || ''}
                          onChange={e => updatePatientField('notes', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Clinico Tab */}
                {activeTab === 'clinico' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold text-slate-700 text-xs">Procedimentos Extraídos</h4>
                      <button 
                        onClick={addClinicalItem}
                        className="bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 border border-teal-100/50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar Procedimento Manual
                      </button>
                    </div>

                    {extractedData.clinicalHistory.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs">
                        Nenhum procedimento clínico identificado nos documentos.
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
                        {extractedData.clinicalHistory.map((item, idx) => (
                          <div 
                            key={idx} 
                            className={`border rounded-2xl p-4 bg-slate-50 flex flex-col md:flex-row gap-4 items-stretch justify-between relative ${
                              item.confidence === 'baixa' ? 'border-red-200 bg-red-50/20' : 'border-slate-200'
                            }`}
                          >
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 flex-1">
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Data</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.date}
                                  onChange={e => updateClinicalItem(idx, 'date', e.target.value)}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Especialidade/Tipo</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.type}
                                  onChange={e => updateClinicalItem(idx, 'type', e.target.value)}
                                />
                              </div>
                              <div className="col-span-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Descrição/Procedimento realizados</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500 font-semibold text-slate-800"
                                  value={item.description}
                                  onChange={e => updateClinicalItem(idx, 'description', e.target.value)}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Profissional</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.professional}
                                  onChange={e => updateClinicalItem(idx, 'professional', e.target.value)}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Produtos/Insumos</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.products || ''}
                                  onChange={e => updateClinicalItem(idx, 'products', e.target.value)}
                                />
                              </div>
                            </div>

                            <div className="flex flex-row md:flex-col items-center justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-4">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400">Confiança:</span>
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  item.confidence === 'alta' ? 'bg-green-100 text-green-700' :
                                  item.confidence === 'média' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700 animate-pulse'
                                }`}>
                                  {item.confidence}
                                </span>
                              </div>
                              
                              <button 
                                onClick={() => removeClinicalItem(idx)}
                                className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Financeiro Tab */}
                {activeTab === 'financeiro' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-bold text-slate-700 text-xs">Histórico de Cobranças/Pagamentos Extraídos</h4>
                      <button 
                        onClick={addFinancialItem}
                        className="bg-teal-50 hover:bg-teal-100 text-teal-700 font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 border border-teal-100/50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Adicionar Financeiro Manual
                      </button>
                    </div>

                    {extractedData.financialHistory.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400 text-xs">
                        Nenhum registro financeiro identificado nos documentos.
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1">
                        {extractedData.financialHistory.map((item, idx) => (
                          <div 
                            key={idx} 
                            className={`border rounded-2xl p-4 bg-slate-50 flex flex-col md:flex-row gap-4 items-stretch justify-between relative ${
                              item.confidence === 'baixa' ? 'border-red-200 bg-red-50/20' : 'border-slate-200'
                            }`}
                          >
                            <div className="grid grid-cols-2 md:grid-cols-9 gap-3 flex-1 lg:max-w-[85%]">
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Vencimento/Data</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.date}
                                  onChange={e => updateFinancialItem(idx, 'date', e.target.value)}
                                />
                              </div>
                              <div className="col-span-2">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Descrição/Parcelas</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500 font-semibold text-slate-800"
                                  value={item.description}
                                  onChange={e => updateFinancialItem(idx, 'description', e.target.value)}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Valor Total</label>
                                <input 
                                  type="number" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.amount}
                                  onChange={e => updateFinancialItem(idx, 'amount', Number(e.target.value))}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Valor Pago</label>
                                <input 
                                  type="number" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.paidAmount}
                                  onChange={e => updateFinancialItem(idx, 'paidAmount', Number(e.target.value))}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Em Aberto</label>
                                <input 
                                  type="number" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.pendingAmount}
                                  onChange={e => updateFinancialItem(idx, 'pendingAmount', Number(e.target.value))}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Forma Pgto</label>
                                <input 
                                  type="text" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.paymentMethod}
                                  onChange={e => updateFinancialItem(idx, 'paymentMethod', e.target.value)}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Parcelas</label>
                                <input 
                                  type="number" 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.installments}
                                  onChange={e => updateFinancialItem(idx, 'installments', Number(e.target.value))}
                                />
                              </div>
                              <div className="col-span-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase">Status</label>
                                <select 
                                  className="w-full bg-white border border-slate-200 rounded-lg px-1 py-1.5 text-xs outline-none focus:border-teal-500"
                                  value={item.status}
                                  onChange={e => updateFinancialItem(idx, 'status', e.target.value)}
                                >
                                  <option value="paid">Pago</option>
                                  <option value="pending">Aberto/Pendente</option>
                                  <option value="partial">Parcial</option>
                                </select>
                              </div>
                            </div>

                            <div className="flex flex-row md:flex-col items-center justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-4 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400">Confiança:</span>
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  item.confidence === 'alta' ? 'bg-green-100 text-green-700' :
                                  item.confidence === 'média' ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700 animate-pulse'
                                }`}>
                                  {item.confidence}
                                </span>
                              </div>
                              
                              <button 
                                onClick={() => removeFinancialItem(idx)}
                                className="text-red-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Alertas Tab */}
                {activeTab === 'alertas' && (
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5 text-red-600">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        Alertas Importantes Clinícos ou Financeiros
                      </h4>
                      {extractedData.alerts.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">Nenhum alerta crítico ou alergia encontrado nos documentos da migração.</p>
                      ) : (
                        <div className="space-y-2">
                          {extractedData.alerts.map((alertMessage, idx) => (
                            <div key={idx} className="bg-red-50 border border-red-200 text-red-800 text-xs px-4 py-3 rounded-xl flex items-start gap-2.5">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span className="font-medium">{alertMessage}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-100 pt-6">
                      <h4 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5 text-amber-600">
                        <Info className="w-5 h-5 shrink-0" />
                        Dados Faltantes Sugeridos a Coletar
                      </h4>
                      {extractedData.missingInformation.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">A ficha parece completa. Ótima leitura!</p>
                      ) : (
                        <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600 font-medium">
                          {extractedData.missingInformation.map((info, idx) => (
                            <li key={idx}>{info}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

        </div>
      </motion.div>

      {/* STEP 10: DUPLICATE ALERT MODAL POPUP */}
      <AnimatePresence>
        {duplicateCheckOpen && (
          <div className="fixed inset-0 bg-slate-950/70 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-lg p-8 shadow-2xl relative"
            >
              <div className="p-3 bg-amber-50 text-amber-600 rounded-full w-12 h-12 flex items-center justify-center border border-amber-100 mb-5">
                <AlertTriangle className="w-6 h-6" />
              </div>
              
              <h4 className="text-xl font-bold text-slate-900 mb-2">Possível Paciente Já Existente</h4>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                Identificamos paciente(s) na clínica com telefone, nome completo, CPF ou e-mail correspondente ou muito parecido com os dados lidos pela IA.
              </p>

              <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3 mb-6 max-h-[180px] overflow-y-auto">
                {matchedPatients.map((p, idx) => (
                  <div key={idx} className="border-b border-slate-100 last:border-0 pb-2.5 last:pb-0 text-xs">
                    <p className="font-bold text-slate-800">{p.name}</p>
                    <div className="text-slate-500 font-medium grid grid-cols-2 gap-x-4 mt-1">
                      <span>WhatsApp: {p.phone || 'N/A'}</span>
                      <span>E-mail: {p.email || 'N/A'}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {matchedPatients.map((p, idx) => (
                  <button 
                    key={idx}
                    onClick={() => handleConfirmSave('update', p.id)}
                    className="w-full bg-slate-100 hover:bg-teal-50 hover:text-teal-700 text-slate-700 font-bold py-3 px-4 rounded-xl text-xs transition-colors flex items-center justify-between border border-slate-200 hover:border-teal-200"
                  >
                    <span>Atualizar ficha de "{p.name}"</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ))}

                <button 
                  onClick={() => handleConfirmSave('create')}
                  className="w-full bg-teal-600 text-white font-bold py-3 px-4 rounded-xl text-xs shadow-md shadow-teal-600/10 hover:bg-teal-700 transition-colors"
                >
                  Criar Novo Paciente Mesmo Assim
                </button>

                <button 
                  onClick={() => setDuplicateCheckOpen(false)}
                  className="w-full bg-white text-slate-500 font-bold py-3 px-4 rounded-xl text-xs hover:bg-slate-50 transition-colors text-center"
                >
                  Cancelar e Voltar para Revisão
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
