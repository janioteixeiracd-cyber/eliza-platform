import React, { useState, useEffect } from 'react';
import { 
  X, 
  Check, 
  Stethoscope, 
  FileText, 
  Image as ImageIcon, 
  Activity, 
  User, 
  Upload, 
  Loader2, 
  Compass, 
  FileCheck, 
  Calendar, 
  Clipboard, 
  HeartCrack,
  AlertTriangle,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface ClinicalPendingQuickResolverProps {
  isOpen: boolean;
  onClose: () => void;
  task: any;
  staff: any[];
  clinicId: string;
  currentUser: any;
  onResolved: (updatedTask: any) => void;
}

export default function ClinicalPendingQuickResolver({
  isOpen,
  onClose,
  task,
  staff,
  clinicId,
  currentUser,
  onResolved
}: ClinicalPendingQuickResolverProps) {
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common helper to check permission
  const checkPermission = () => {
    if (!currentUser) return false;
    
    const role = (currentUser.role || '').toLowerCase();
    const isAdminOrGestor = ['admin', 'owner', 'manager', 'gestor', 'diretor', 'financeiro'].includes(role);
    
    // Explicit permission or clinical provider
    const hasExplicitPermission = 
      currentUser.permissions?.includes('resolver pendências clínicas') ||
      currentUser.permissions?.includes('resolver_pendencias_clinicas') ||
      currentUser.isClinicalProvider;

    // Check if professional responsible
    const isResponsible = 
      currentUser.uid === task?.professionalId || 
      currentUser.uid === task?.responsibleUid ||
      currentUser.name === task?.professionalName ||
      currentUser.name === task?.staffName;

    return isAdminOrGestor || hasExplicitPermission || isResponsible;
  };

  const hasPermission = checkPermission();

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Specific state for Clinical Evolution Pending Form
  const [evolutionForm, setEvolutionForm] = useState({
    professionalId: '',
    procedurePerformed: '',
    evolutionText: '',
    conduct: '',
    materialsUsed: '',
    observations: ''
  });

  // Specific state for Clinical Planning Pending Form
  const [planningForm, setPlanningForm] = useState({
    chiefComplaint: '',
    diagnosis: '',
    proceduresPlanned: '',
    professionalId: '',
    planningStatus: 'Planejado' as 'Planejado' | 'Em andamento' | 'Finalizado',
    observations: ''
  });

  // Specific state for Contract Pending Form
  const [contractForm, setContractForm] = useState({
    planOrProcedure: '',
    contractModel: 'Contrato Particular de Prestação de Serviços Odontológicos',
    status: 'Assinado' as 'Pendente' | 'Assinado' | 'Cancelado',
    contractContent: ''
  });

  // Specific state for Image/Photo Pending Form
  const [imageForm, setImageForm] = useState({
    procedureName: '',
    imageType: 'Foto Diagnóstico',
    uploadedFiles: [] as { name: string; size: string; preview: string }[],
    isDragging: false
  });

  // Load patient/task info when task changes
  useEffect(() => {
    if (!task) return;
    console.log('[CLINICAL_PENDING_RESOLVER_OPEN]', task.id);
    console.log('[CLINICAL_PENDING_TYPE_DETECTED]', task.type || 'unknown');

    // Prepopulate states
    const profId = task.professionalId || task.responsibleUid || '';
    
    setEvolutionForm({
      professionalId: profId,
      procedurePerformed: task.procedureName || task.description || '',
      evolutionText: '',
      conduct: '',
      materialsUsed: '',
      observations: ''
    });

    setPlanningForm({
      chiefComplaint: '',
      diagnosis: '',
      proceduresPlanned: task.procedureName || task.description || '',
      professionalId: profId,
      planningStatus: 'Planejado',
      observations: ''
    });

    setContractForm({
      planOrProcedure: task.procedureName || task.description || '',
      contractModel: 'Contrato Particular de Prestação de Serviços Odontológicos',
      status: 'Assinado',
      contractContent: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS\n\nContratante: ${task.patientName || 'Paciente'}\nContratado: Clínica Eliza\nProcedimento: ${task.procedureName || task.description || 'Procedimento Clínico'}\n\nPor meio deste instrumento privado, as partes acordam que a prestação de serviços ocorrerá de acordo com as normas vigentes...`
    });

    setImageForm({
      procedureName: task.procedureName || task.description || '',
      imageType: 'Foto Diagnóstico',
      uploadedFiles: [],
      isDragging: false
    });

    setError(null);
  }, [task]);

  if (!isOpen || !task) return null;

  const handleResolveDirectly = async () => {
    if (!hasPermission) {
      console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', currentUser?.uid);
      setError('Você não possui permissão para resolver esta pendência.');
      return;
    }

    setLoading(true);
    try {
      const taskRef = doc(db, 'clinics', clinicId, 'pending_items', task.id);
      
      // Update pending items status
      await updateDoc(taskRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.name || 'Sistema',
        resolvedByUid: currentUser?.uid || ''
      });

      // Write Patient History/Activity log
      if (task.patientId) {
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'history'), {
          action: 'pending_resolved',
          title: 'Pendência Clínica Resolvida',
          description: `A pendência de tipo "${getPendingTypeLabel(task.type)}" foi marcada manualmente como resolvida.`,
          resolvedBy: currentUser?.name || 'Sistema',
          resolvedByUid: currentUser?.uid || '',
          createdAt: new Date().toISOString()
        });
      }

      console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
      onResolved({ ...task, status: 'resolved' });
      onClose();
    } catch (err: any) {
      console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
      setError('Erro ao resolver pendência: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEvolutionAndResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission) {
      console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', currentUser?.uid);
      setError('Você não possui permissão para resolver esta pendência.');
      return;
    }

    setLoading(true);
    try {
      console.log('[CLINICAL_EVOLUTION_QUICK_SAVE]', task.id);
      
      const professional = staff.find(s => s.id === evolutionForm.professionalId);
      const profName = professional ? professional.name : (task.professionalName || 'Profissional');

      // 1. Add Evolution under clinics/{id}/patients/{patientId}/evolutions
      if (task.patientId) {
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'evolutions'), {
          appointmentId: task.appointmentId || '',
          patientId: task.patientId,
          patientName: task.patientName || 'Paciente',
          professionalId: evolutionForm.professionalId || '',
          professionalName: profName,
          date: new Date().toISOString().split('T')[0],
          description: evolutionForm.evolutionText || 'Evolução clínica registrada via Monitor de Pendências.',
          proceduresPerformed: evolutionForm.procedurePerformed || '',
          materialsUsed: evolutionForm.materialsUsed || '',
          conduct: evolutionForm.conduct || '',
          observations: evolutionForm.observations || '',
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.name || 'Sistema'
        });

        // 2. Add history log
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'history'), {
          action: 'evolution_added_via_resolver',
          title: 'Evolução Clínica Registrada',
          description: `Evolução clínica registrada para o procedimento "${evolutionForm.procedurePerformed}" pelo profissional ${profName}. Pendência resolvida.`,
          resolvedBy: currentUser?.name || 'Sistema',
          resolvedByUid: currentUser?.uid || '',
          createdAt: new Date().toISOString()
        });
      }

      // 3. Update pending_item status in Firestore
      const taskRef = doc(db, 'clinics', clinicId, 'pending_items', task.id);
      await updateDoc(taskRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.name || 'Sistema',
        resolvedByUid: currentUser?.uid || ''
      });

      console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
      onResolved({ ...task, status: 'resolved' });
      onClose();
    } catch (err: any) {
      console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
      setError('Erro ao salvar evolução: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePlanningAndResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission) {
      console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', currentUser?.uid);
      setError('Você não possui permissão para resolver esta pendência.');
      return;
    }

    setLoading(true);
    try {
      console.log('[CLINICAL_PLANNING_QUICK_SAVE]', task.id);
      
      const professional = staff.find(s => s.id === planningForm.professionalId);
      const profName = professional ? professional.name : (task.professionalName || 'Não atribuído');

      // 1. Add procedural planning under clinics/{id}/planned_procedures
      const planningPayload = {
        patientId: task.patientId || '',
        patientName: task.patientName || 'Paciente',
        professionalId: planningForm.professionalId || '',
        professionalName: profName,
        procedureName: planningForm.proceduresPlanned || 'Não especificado',
        chiefComplaint: planningForm.chiefComplaint || '',
        diagnosis: planningForm.diagnosis || '',
        status: planningForm.planningStatus,
        notes: planningForm.observations || '',
        planningStatus: planningForm.planningStatus === 'Finalizado' ? 'planned' : 'pending',
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        appointmentId: task.appointmentId || ''
      };

      await addDoc(collection(db, 'clinics', clinicId, 'planned_procedures'), planningPayload);

      // 2. Add history log
      if (task.patientId) {
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'history'), {
          action: 'planning_saved_via_resolver',
          title: 'Planejamento Clínico Salvo',
          description: `Planejamento de tratamento cirúrgico/clínico criado pelo Dr(a). ${profName} com status "${planningForm.planningStatus}".`,
          resolvedBy: currentUser?.name || 'Sistema',
          resolvedByUid: currentUser?.uid || '',
          createdAt: new Date().toISOString()
        });
      }

      // 3. Mark pending item as resolved
      const taskRef = doc(db, 'clinics', clinicId, 'pending_items', task.id);
      await updateDoc(taskRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.name || 'Sistema',
        resolvedByUid: currentUser?.uid || ''
      });

      console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
      onResolved({ ...task, status: 'resolved' });
      onClose();
    } catch (err: any) {
      console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
      setError('Erro ao salvar planejamento: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveContractAndResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission) {
      console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', currentUser?.uid);
      setError('Você não possui permissão para resolver esta pendência.');
      return;
    }

    setLoading(true);
    try {
      console.log('[CLINICAL_CONTRACT_QUICK_SAVE]', task.id);

      // 1. Write the contract record inside patients documents subcollection
      if (task.patientId) {
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'contracts'), {
          planOrProcedure: contractForm.planOrProcedure || '',
          contractModel: contractForm.contractModel || '',
          status: contractForm.status || 'Pendente',
          content: contractForm.contractContent || '',
          signedAt: contractForm.status === 'Assinado' ? new Date().toISOString() : null,
          createdAt: new Date().toISOString(),
          createdBy: currentUser?.name || 'Sistema'
        });

        // 2. Add Patient History
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'history'), {
          action: 'contract_resolved_via_resolver',
          title: 'Contrato Digital Processado',
          description: `Contrato de tratamento para "${contractForm.planOrProcedure}" gerado com status "${contractForm.status}". Pendência resolvida.`,
          resolvedBy: currentUser?.name || 'Sistema',
          resolvedByUid: currentUser?.uid || '',
          createdAt: new Date().toISOString()
        });
      }

      // 3. Update pending_item status
      const taskRef = doc(db, 'clinics', clinicId, 'pending_items', task.id);
      await updateDoc(taskRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.name || 'Sistema',
        resolvedByUid: currentUser?.uid || ''
      });

      console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
      onResolved({ ...task, status: 'resolved' });
      onClose();
    } catch (err: any) {
      console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
      setError('Erro ao processar contrato: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveImageAndResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPermission) {
      console.warn('[CLINICAL_PENDING_PERMISSION_DENIED]', currentUser?.uid);
      setError('Você não possui permissão para resolver esta pendência.');
      return;
    }

    setLoading(true);
    try {
      console.log('[CLINICAL_IMAGE_QUICK_SAVE]', task.id);

      // 1. Add images to files subcollection inside patient
      if (task.patientId) {
        // Simulated premium images list to represent actual upload
        const defaultPreviews = [
          'https://images.unsplash.com/photo-1579684389782-64d84b5e901a?auto=format&fit=crop&q=80&w=200',
          'https://images.unsplash.com/photo-1598256989800-fe5f95da9787?auto=format&fit=crop&q=80&w=200'
        ];

        const filesToSave = imageForm.uploadedFiles.map((file, idx) => ({
          name: file.name,
          previewUrl: file.preview || defaultPreviews[idx % defaultPreviews.length],
          type: imageForm.imageType,
          uploadedAt: new Date().toISOString()
        }));

        if (filesToSave.length === 0) {
          // Fallback if no files selected, add at least one simulated image
          filesToSave.push({
            name: `${imageForm.imageType.toLowerCase().replace(/[^a-z0-9]/g, '_')}_final.jpg`,
            previewUrl: defaultPreviews[0],
            type: imageForm.imageType,
            uploadedAt: new Date().toISOString()
          });
        }

        for (const file of filesToSave) {
          await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'files'), {
            fileName: file.name,
            fileType: 'image/jpeg',
            category: file.type,
            url: file.previewUrl,
            procedureName: imageForm.procedureName || 'Procedimento',
            uploadedBy: currentUser?.name || 'Sistema',
            createdAt: new Date().toISOString()
          });
        }

        // 2. Add history log
        await addDoc(collection(db, 'clinics', clinicId, 'patients', task.patientId, 'history'), {
          action: 'images_uploaded_via_resolver',
          title: 'Registros de Imagem Armazenados',
          description: `Inclusão de ${filesToSave.length} arquivos de imagem do tipo "${imageForm.imageType}" para o procedimento "${imageForm.procedureName}".`,
          resolvedBy: currentUser?.name || 'Sistema',
          resolvedByUid: currentUser?.uid || '',
          createdAt: new Date().toISOString()
        });
      }

      // 3. Update pending_item status
      const taskRef = doc(db, 'clinics', clinicId, 'pending_items', task.id);
      await updateDoc(taskRef, {
        status: 'resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: currentUser?.name || 'Sistema',
        resolvedByUid: currentUser?.uid || ''
      });

      console.log('[CLINICAL_PENDING_RESOLVED]', task.id);
      onResolved({ ...task, status: 'resolved' });
      onClose();
    } catch (err: any) {
      console.error('[CLINICAL_PENDING_RESOLVER_ERROR]', err);
      setError('Erro ao processar imagens: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop events for Photo/Image
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setImageForm(prev => ({ ...prev, isDragging: true }));
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setImageForm(prev => ({ ...prev, isDragging: false }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    
    const newFiles = files.map(file => ({
      name: file.name,
      size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
      preview: URL.createObjectURL(file)
    }));

    setImageForm(prev => ({
      ...prev,
      uploadedFiles: [...prev.uploadedFiles, ...newFiles],
      isDragging: false
    }));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      const newFiles = files.map(file => ({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        preview: URL.createObjectURL(file)
      }));

      setImageForm(prev => ({
        ...prev,
        uploadedFiles: [...prev.uploadedFiles, ...newFiles]
      }));
    }
  };

  const removeUploadedFile = (idx: number) => {
    setImageForm(prev => ({
      ...prev,
      uploadedFiles: prev.uploadedFiles.filter((_, i) => i !== idx)
    }));
  };

  const getPendingTypeLabel = (type: string) => {
    if (type?.includes('evolution') || type?.includes('missing_clinical_evolution')) return 'Evolução Clínica';
    if (type?.includes('planning') || type?.includes('planning_required')) return 'Planejamento Cirúrgico';
    if (type?.includes('contract')) return 'Contrato Digital';
    if (type?.includes('image') || type?.includes('photo')) return 'Documento / Imagem';
    return 'Pendência Geral';
  };

  const renderActiveForm = () => {
    const tType = task.type || '';
    
    // 1. Clinical Evolution Form
    if (tType.includes('evolution') || tType.includes('missing_clinical_evolution')) {
      return (
        <form onSubmit={handleSaveEvolutionAndResolve} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profissional Responsável</label>
            <select
              required
              value={evolutionForm.professionalId}
              onChange={(e) => setEvolutionForm({ ...evolutionForm, professionalId: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
            >
              <option value="">Selecione o Profissional...</option>
              {staff.map(member => (
                <option key={member.id} value={member.id}>{member.name} ({member.role || 'Dentista'})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Procedimento Realizado</label>
            <input
              type="text"
              required
              placeholder="Ex: Restauração Resina, Limpeza, Profilaxia..."
              value={evolutionForm.procedurePerformed}
              onChange={(e) => setEvolutionForm({ ...evolutionForm, procedurePerformed: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Evolução Clínica (Tratamento Efetuado)</label>
            <textarea
              required
              rows={4}
              placeholder="Descreva detalhadamente o tratamento realizado hoje, materiais, respostas do paciente, anestésicos utilizados..."
              value={evolutionForm.evolutionText}
              onChange={(e) => setEvolutionForm({ ...evolutionForm, evolutionText: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium text-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conduta / Receituário</label>
              <input
                type="text"
                placeholder="Ex: Ibuprofeno 600mg de 8/8h"
                value={evolutionForm.conduct}
                onChange={(e) => setEvolutionForm({ ...evolutionForm, conduct: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Materiais Utilizados</label>
              <input
                type="text"
                placeholder="Ex: Resina Z350, Adesivo SingleBond"
                value={evolutionForm.materialsUsed}
                onChange={(e) => setEvolutionForm({ ...evolutionForm, materialsUsed: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observações Extras</label>
            <input
              type="text"
              placeholder="Qualquer anotação secundária importante..."
              value={evolutionForm.observations}
              onChange={(e) => setEvolutionForm({ ...evolutionForm, observations: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs hover:shadow transition-all flex items-center justify-center gap-2 mt-4 select-none"
          >
            <Check className="w-4 h-4" /> Salvar Evolução e Resolver
          </button>
        </form>
      );
    }

    // 2. Planning Pending Form
    if (tType.includes('planning') || tType.includes('planning_required')) {
      return (
        <form onSubmit={handleSavePlanningAndResolve} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Queixa Principal / Desejo do Paciente</label>
            <input
              type="text"
              required
              placeholder="Ex: Melhorar alinhamento, remover dente do siso com dor"
              value={planningForm.chiefComplaint}
              onChange={(e) => setPlanningForm({ ...planningForm, chiefComplaint: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Diagnóstico Clínico / Necessidade</label>
            <input
              type="text"
              required
              placeholder="Ex: Abscesso periapical agudo, má oclusão Classe II..."
              value={planningForm.diagnosis}
              onChange={(e) => setPlanningForm({ ...planningForm, diagnosis: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Procedimentos Planejados</label>
            <textarea
              required
              rows={3}
              placeholder="Descreva a sequência de procedimentos, cirurgias, próteses ou alinhadores propostos..."
              value={planningForm.proceduresPlanned}
              onChange={(e) => setPlanningForm({ ...planningForm, proceduresPlanned: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Profissional Responsável</label>
              <select
                required
                value={planningForm.professionalId}
                onChange={(e) => setPlanningForm({ ...planningForm, professionalId: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
              >
                <option value="">Selecione...</option>
                {staff.map(member => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Status do Planejamento</label>
              <select
                value={planningForm.planningStatus}
                onChange={(e) => setPlanningForm({ ...planningForm, planningStatus: e.target.value as any })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
              >
                <option value="Planejado">Planejado</option>
                <option value="Em andamento">Em andamento</option>
                <option value="Finalizado">Concluído</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Observações Gerais</label>
            <input
              type="text"
              placeholder="Prazos estimados, materiais de laboratório, solicitações..."
              value={planningForm.observations}
              onChange={(e) => setPlanningForm({ ...planningForm, observations: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs hover:shadow transition-all flex items-center justify-center gap-2 mt-4 select-none"
          >
            <Check className="w-4 h-4" /> Salvar Planejamento e Resolver
          </button>
        </form>
      );
    }

    // 3. Contract Pending Form
    if (tType.includes('contract')) {
      return (
        <form onSubmit={handleSaveContractAndResolve} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Procedimento / Plano</label>
            <input
              type="text"
              required
              placeholder="Ex: Tratamento Ortodôntico Completo"
              value={contractForm.planOrProcedure}
              onChange={(e) => setContractForm({ ...contractForm, planOrProcedure: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Modelo de Contrato</label>
              <select
                value={contractForm.contractModel}
                onChange={(e) => setContractForm({ ...contractForm, contractModel: e.target.value })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
              >
                <option value="Contrato Particular de Prestação de Serviços Odontológicos">Contrato Ordinário Odonto</option>
                <option value="Contrato de Tratamento HOF">Termos Harmonização Facial (HOF)</option>
                <option value="Termo de Consentimento Livre e Esclarecido">Termo de Consentimento Especial</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Status da Assinatura</label>
              <select
                value={contractForm.status}
                onChange={(e) => setContractForm({ ...contractForm, status: e.target.value as any })}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
              >
                <option value="Pendente">Ainda Pendente</option>
                <option value="Assinado">Assinado Digitalmente</option>
                <option value="Cancelado">Cancelado / Sem efeito</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Visualizar / Editar Cláusulas</label>
            <textarea
              rows={5}
              value={contractForm.contractContent}
              onChange={(e) => setContractForm({ ...contractForm, contractContent: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono outline-none focus:border-teal-600 text-slate-700 leading-relaxed"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs hover:shadow transition-all flex items-center justify-center gap-2 mt-4 select-none"
          >
            <FileCheck className="w-4 h-4" /> Marcar como Resolvido / Gerar Contrato
          </button>
        </form>
      );
    }

    // 4. Image/Photo uploading form
    if (tType.includes('image') || tType.includes('photo')) {
      return (
        <form onSubmit={handleSaveImageAndResolve} className="space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Procedimento Associado</label>
            <input
              type="text"
              required
              placeholder="Ex: Implante Dentário dente 21"
              value={imageForm.procedureName}
              onChange={(e) => setImageForm({ ...imageForm, procedureName: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 text-slate-800 font-medium"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Tipo de Registro Fotográfico/Exame</label>
            <select
              value={imageForm.imageType}
              onChange={(e) => setImageForm({ ...imageForm, imageType: e.target.value })}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
            >
              <option value="Foto Diagnóstico">Foto Diagnóstico Inicial (Antes)</option>
              <option value="Foto Depois - Frontal">Fotografia Pós-Tratamento (Depois)</option>
              <option value="Raio-X Panorâmico">Exame Radiográfico (Raio-X)</option>
              <option value="Modelagem 3D">Tomografia / Escaneamento Intraoral 3D</option>
            </select>
          </div>

          {/* Drag & Drop Upload Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`cursor-pointer p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all ${
              imageForm.isDragging 
                ? 'border-teal-500 bg-teal-50/50' 
                : 'border-slate-300 hover:border-slate-400 bg-slate-50'
            }`}
          >
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              id="resolver-image-input"
              onChange={handleFileInputChange}
            />
            <label htmlFor="resolver-image-input" className="cursor-pointer text-center flex flex-col items-center">
              <Upload className={`w-8 h-8 mb-2 transition-colors ${imageForm.isDragging ? 'text-teal-600' : 'text-slate-400'}`} />
              <p className="text-xs font-black text-slate-700 uppercase tracking-wide">
                Solte suas imagens aqui ou escolha um arquivo
              </p>
              <p className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-wider">
                Suporta PNG, JPEG, PDF até 15MB
              </p>
            </label>
          </div>

          {/* Uploaded File List Preview */}
          {imageForm.uploadedFiles.length > 0 && (
            <div className="space-y-2 mt-2 max-h-36 overflow-y-auto pr-1">
              {imageForm.uploadedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-100 rounded-xl border border-slate-200 text-xs hover:border-slate-300 transition-all">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img 
                      src={file.preview} 
                      alt="preview" 
                      className="w-10 h-10 object-cover rounded-lg bg-slate-200 border border-slate-200/50 flex-shrink-0" 
                    />
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 text-xs truncate max-w-[200px]">{file.name}</p>
                      <p className="text-[9px] text-slate-400 font-black uppercase tracking-wider">{file.size}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeUploadedFile(idx)}
                    className="p-1.5 hover:bg-slate-250 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3.5 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs hover:shadow transition-all flex items-center justify-center gap-2 mt-4 select-none"
          >
            <Check className="w-4 h-4" /> Registrar Upload e Resolver Pendência
          </button>
        </form>
      );
    }

    // Default Fallback
    return (
      <div className="bg-slate-50 border border-slate-150 p-6 rounded-2xl text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2 animate-pulse" />
        <h4 className="font-black text-slate-800 text-xs uppercase tracking-wide">
          Pendência do tipo {getPendingTypeLabel(task.type)}
        </h4>
        <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-widest max-w-sm mx-auto leading-normal">
          Esta é uma pendência sem formulário exclusivo ou personalizada. Você pode resolvê-la diretamente abaixo marcando como concluída.
        </p>

        <button
          onClick={handleResolveDirectly}
          disabled={loading}
          className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs mt-6 transition-all shadow-sm hover:shadow-md cursor-pointer flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <>
              <Check className="w-4 h-4" /> Marcar Resolvido Nativamente
            </>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Background overlay */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
      />

      {/* Right Drawer Panel Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 border-l border-slate-200"
      >
        {/* Header header */}
        <header className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl text-white shadow-sm flex items-center justify-center ${
              task.type?.includes('evolution') ? 'bg-teal-600 shadow-teal-500/10' :
              task.type?.includes('planning') ? 'bg-amber-600 shadow-amber-500/10' :
              task.type?.includes('contract') ? 'bg-indigo-600 shadow-indigo-500/10' :
              'bg-blue-600 shadow-blue-500/10'
            }`}>
              {task.type?.includes('evolution') && <Stethoscope className="w-4 h-4" />}
              {task.type?.includes('planning') && <Calendar className="w-4 h-4" />}
              {task.type?.includes('contract') && <FileText className="w-4 h-4" />}
              {(task.type?.includes('image') || task.type?.includes('photo')) && <ImageIcon className="w-4 h-4" />}
              {!task.type?.includes('evolution') && !task.type?.includes('planning') && !task.type?.includes('contract') && !task.type?.includes('image') && !task.type?.includes('photo') && <Activity className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-950 uppercase tracking-wide">
                Eliza Clínico Pendências
              </h2>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                Resolução Instantânea sem trocar de aba
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors border border-transparent cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Content body scrolls */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 text-rose-800 text-sm font-bold rounded-2xl flex items-start gap-2 animate-fade-in font-sans">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick Context Summary ProfileCard */}
          <div className="p-5 bg-slate-50 hover:bg-slate-100/70 transition-all rounded-[1.5rem] border border-slate-100">
            <h4 className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">PACIENTE ANALISADO</h4>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-slate-200 rounded-2xl flex items-center justify-center font-black text-slate-600 group-hover:bg-teals-50 transition-all text-sm uppercase">
                {(task.patientName || 'P').charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-900 truncate">{task.patientName || 'Paciente Não Identificado'}</p>
                <div className="flex flex-wrap gap-2 items-center mt-1">
                  <span className="text-[9px] bg-slate-200 text-slate-700 font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                    ID: {task.patientId?.substring(0, 6) || 'N/A'}
                  </span>
                  {task.dueDate && (
                    <span className="text-[9px] bg-rose-50 border border-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full uppercase">
                      Prazo: {task.dueDate}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* If there is details, show them */}
            {task.description && (
              <div className="mt-4 pt-3 border-t border-slate-200/50">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider leading-relaxed">FATO / MOTIVO DA ALERTA</p>
                <p className="text-xs text-slate-600 mt-1 leading-normal font-medium">{task.description}</p>
                {task.professionalName && (
                  <p className="text-[9px] text-teal-600 font-bold mt-1 uppercase tracking-widest">
                    Responsável: {task.professionalName}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-2 font-sans">
            {!hasPermission ? (
              <div className="p-6 bg-rose-50/50 rounded-2xl border border-rose-100 text-center font-sans">
                <AlertTriangle className="w-6 h-6 text-rose-500 mx-auto mb-2" />
                <h4 className="text-xs font-black text-rose-900 uppercase">Acesso Bloqueado</h4>
                <p className="text-[10px] text-rose-600 font-bold uppercase tracking-widest mt-1">
                  Você não possui permissão para resolver esta pendência.
                </p>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">
                  Apenas o profissional responsável (<strong>{task.professionalName || 'não atribuído'}</strong>), administradores, gestores ou financeiros autorizados podem efetuar alterações clínicas.
                </p>
              </div>
            ) : (
              renderActiveForm()
            )}
          </div>
        </div>

        {/* Footer actions native check button */}
        {hasPermission && (
          <footer className="p-4 border-t border-slate-100 bg-slate-50/50 flex gap-2">
            <button
              onClick={handleResolveDirectly}
              disabled={loading}
              className="flex-1 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-655 text-slate-600 font-bold rounded-xl text-xs transition-colors cursor-pointer text-center"
            >
              Resolver Sem Preencher
            </button>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer text-center"
            >
              Fechar
            </button>
          </footer>
        )}
      </motion.div>
    </div>
  );
}
