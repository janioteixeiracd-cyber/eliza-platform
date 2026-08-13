import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, serverTimestamp, arrayUnion, onSnapshot, addDoc, limit, orderBy } from 'firebase/firestore';
import { db, auth, IS_STUDIO_PREVIEW, logQuery, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  ArrowLeft,
  Briefcase,
  Stethoscope, 
  Search, 
  Plus, 
  FileText, 
  Activity, 
  History, 
  ChevronLeft,
  ChevronRight, 
  User, 
  FileCheck, 
  ArrowRight,
  ClipboardList,
  Calendar,
  CalendarDays,
  MoreVertical,
  DollarSign,
  Image as ImageIcon,
  FileDigit,
  Trash2,
  CheckCircle,
  Clock,
  MapPin,
  Smartphone,
  Mail,
  ShieldCheck,
  CreditCard,
  Printer,
  Edit2,
  Upload,
  Download,
  Database,
  AlertCircle,
  MessageCircle,
  X,
  Sparkles,
  Zap,
  RefreshCw,
  AlertTriangle,
  Brain,
  Pill
} from 'lucide-react';
import PatientMigrationWizard from './PatientMigrationWizard';
import FacialPlanningView from './FacialPlanningView';
import AnamnesisIntelligenceView from './AnamnesisIntelligenceView';
import { DEFAULT_CONTRACT_TEMPLATES } from '../data/defaultContractTemplates';
import { DEFAULT_PRESCRIPTION_TEMPLATES } from '../data/defaultPrescriptionTemplates';
import { DEFAULT_TREATMENT_CATALOG, TreatmentCatalogItem, TREATMENT_CATEGORIES } from '../data/treatmentCatalog';

// Types (derived from blueprint)
interface Patient {
  id: string;
  name: string;
  cpf?: string;
  birthDate?: string;
  phone: string;
  email?: string;
  address?: string;
  lastVisit?: string;
  clinicId?: string;
  _isLegacy?: boolean;
}

interface QuotationItem {
  description: string;
  value: number;
  status: 'pending' | 'approved';
  quantity?: number;
  observation?: string;
  tooth?: string;
  region?: string;
  faces?: string[];
}

interface Quotation {
  id: string;
  title: string;
  items: QuotationItem[];
  status: 'draft' | 'approved' | 'rejected';
  totalValue: number;
  createdAt: any;
  responsible?: string;
  paymentMethod?: string;
  installments?: number;
}

interface TreatmentEvolution {
  text: string;
  date: any;
  updatedAt?: string;
}

interface Treatment {
  id: string;
  quotationId?: string;
  description: string;
  professional: string;
  professionalId?: string | null;
  amount?: number;
  status: 'active' | 'completed';
  evolutions: TreatmentEvolution[];
  completedAt?: string;
  procedureValue?: number;
  commissionPercent?: number;
  commissionEligible?: boolean;
  treatmentStatus?: 'Planejado' | 'Iniciado' | 'Em andamento' | 'Finalizado' | 'Cancelado';
}

interface Drug {
  id: string;
  name: string;
  defaultDosage: string;
}

interface FinancialRecord {
  id: string;
  description: string;
  method: string;
  value: number;
  status: 'received' | 'pending' | 'partial' | 'cancelled' | 'cancelado' | 'paid';
  date: any;
  paidAmount?: number;
  remainingAmount?: number;
}

interface MedicalDocument {
  id: string;
  title: string;
  type: 'receita' | 'atestado' | 'laudo' | 'contrato';
  content: string;
  createdAt: any;
  status?: string;
  totalValue?: number;
  paymentMethod?: string;
  pdfUrl?: string;
  clinicDetails?: {
    professionalName?: string;
    professionalCro?: string;
    name?: string;
    cnpj?: string;
  };
  patientDetails?: {
    name?: string;
    cpf?: string;
    rg?: string;
    phone?: string;
    birthDate?: string;
  };
  quoteId?: string;
  quoteTitle?: string;
}

interface PatientImage {
  id: string;
  title: string;
  url: string;
  category: string;
  description?: string;
  date: any;
}

type RecordTab = 'summary' | 'quotations' | 'treatments' | 'anamnesis' | 'files' | 'documents' | 'financial' | 'notes' | 'aesthetic' | 'facial_planning';

interface MedicalRecordViewProps {
  preSelectedId?: string | null;
  onSelectPatient?: (id: string | null) => void;
  onSchedulePatient?: (id: string) => void;
  onNavigateToChat?: (id: string) => void;
}

export default function MedicalRecordView({ preSelectedId, onSelectPatient, onSchedulePatient, onNavigateToChat }: MedicalRecordViewProps) {
  const { clinic, user, profile, isPlatformAdmin } = useAuth();
  const isNina = profile?.name?.toLowerCase().includes('nina') || profile?.email?.toLowerCase().includes('nina') || user?.displayName?.toLowerCase().includes('nina') || user?.email?.toLowerCase().includes('nina');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(preSelectedId || null);
  const [activeTab, setActiveTab] = useState<RecordTab>(() => {
    const saved = localStorage.getItem('medical-record-active-tab');
    if (saved) {
      localStorage.removeItem('medical-record-active-tab');
      return saved as RecordTab;
    }
    return 'summary';
  });
  const [showMoreData, setShowMoreData] = useState(false);
  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (preSelectedId) {
      setSelectedPatientId(preSelectedId);
    }
  }, [preSelectedId]);

  const handleSelect = (id: string | null) => {
    setSelectedPatientId(id);
    onSelectPatient?.(id);
  };
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [patientData, setPatientData] = useState<Patient | null>(null);

  const loadPatients = async () => {
    if (!clinic) return;
    setLoading(true);
    
    try {
      const limitCount = IS_STUDIO_PREVIEW ? 300 : 1000;
      const patientsRef = collection(db, 'clinics', clinic.id, 'patients');
      
      logQuery('MedicalRecordView', 'patients', 'all', limitCount);
      const q = query(patientsRef, orderBy('name'), limit(limitCount));

      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any), _isLegacy: false } as Patient));
      setPatients(items);
      setQuotaExceeded(false);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/patients`);
      if (err.message?.includes('Quota exceeded') || err.code === 'resource-exhausted') {
        setQuotaExceeded(true);
      }
    } finally {
      setLoading(false);
    }
  };

  // Initial load and search trigger
  useEffect(() => {
    loadPatients();
  }, [clinic]);

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [financialRecords, setFinancialRecords] = useState<FinancialRecord[]>([]);
  const [importedFinancial, setImportedFinancial] = useState<any[]>([]);
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [anamnesis, setAnamnesis] = useState<any>(null);
  const [patientNotes, setPatientNotes] = useState<any[]>([]);
  const [patientAesthetics, setPatientAesthetics] = useState<any[]>([]);
  const [clinicTemplates, setClinicTemplates] = useState<any[]>([]);
  const [patientAppointments, setPatientAppointments] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  const getPatientPathStr = (pId: string | null) => {
    if (!pId || !clinic) return '';
    const isLegacy = patientData?.id === pId ? patientData._isLegacy : patients.find(p => p.id === pId)?._isLegacy;
    return isLegacy ? `patients/${pId}` : `clinics/${clinic.id}/patients/${pId}`;
  };

  // Load team members
  useEffect(() => {
    if (!clinic) return;
    const unsub = onSnapshot(collection(db, 'clinics', clinic.id, 'team_members'), (snap) => {
      setTeamMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("[MEDICAL_RECORD_VIEW] Error fetching team members:", error);
    });
    return () => unsub();
  }, [clinic]);

  // Load clinic templates
  useEffect(() => {
    if (!clinic) return;
    const unsub = onSnapshot(collection(db, 'clinics', clinic.id, 'templates'), (snap) => {
      setClinicTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `clinics/${clinic.id}/templates`);
    });
    return () => unsub();
  }, [clinic]);

  // Load sub-data (quotations, treatments, etc.) when patient changes
  useEffect(() => {
    if (!selectedPatientId || !clinic) {
      setQuotations([]);
      setTreatments([]);
      setFinancialRecords([]);
      setDocuments([]);
      setImages([]);
      setAnamnesis(null);
      setPatientAesthetics([]);
      return;
    }

    const isLegacy = patientData?.id === selectedPatientId ? patientData._isLegacy : patients.find(p => p.id === selectedPatientId)?._isLegacy;
    const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
    const dataLimit = IS_STUDIO_PREVIEW ? 20 : 50;

    // Load Quotations
    logQuery('MedicalRecordView', 'quotations', { patientId: selectedPatientId }, dataLimit);
    const unsubQ = onSnapshot(query(collection(db, patientBasePath, 'quotations'), limit(dataLimit)), (snapshot) => {
      setQuotations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${patientBasePath}/quotations`);
    });

    // Load Treatments
    logQuery('MedicalRecordView', 'treatments', { patientId: selectedPatientId }, dataLimit);
    const unsubT = onSnapshot(query(collection(db, patientBasePath, 'treatments'), limit(dataLimit)), (snapshot) => {
      setTreatments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${patientBasePath}/treatments`);
    });

    // Load Financial (Consolidated solely to clinics/{clinicId}/financial_entries)
    const unsubF = () => {};

    // Load Consolidated Financial Entries
    logQuery('MedicalRecordView', 'financial_entries', { patientId: selectedPatientId }, 100);
    const qImportedPath = `clinics/${clinic.id}/financial_entries`;
    const qImported = query(
      collection(db, qImportedPath),
      where('patient_id', '==', selectedPatientId),
      limit(100)
    );
    const unsubImported = onSnapshot(qImported, (snapshot) => {
      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      console.log("[PATIENT_FINANCE_LOAD] source: financial_entries only");
      console.log("[PATIENT_FINANCE_LOAD] entries:", entries);
      setImportedFinancial(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, qImportedPath);
    });

    // Load Documents
    const unsubD = onSnapshot(collection(db, patientBasePath, 'documents'), (snapshot) => {
      setDocuments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${patientBasePath}/documents`);
    });

    // Load Anamnesis
    const currentAnamnesisPath = `${patientBasePath}/anamnesis/current`;
    const unsubA = onSnapshot(doc(db, patientBasePath, 'anamnesis', 'current'), (snapshot) => {
      if (snapshot.exists()) {
        setAnamnesis(snapshot.data());
      } else {
        setAnamnesis(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, currentAnamnesisPath);
    });

    // Load Images
    const unsubI = onSnapshot(collection(db, patientBasePath, 'images'), (snapshot) => {
      setImages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `${patientBasePath}/images`);
    });

    // Load Patient Notes
    const notesPath = `clinics/${clinic.id}/internal_notes`;
    const qNotes = query(
      collection(db, notesPath),
      where('patient_id', '==', selectedPatientId),
      orderBy('createdAt', 'desc')
    );
    const unsubNotes = onSnapshot(qNotes, (snapshot) => {
      setPatientNotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, notesPath);
    });

    // Load Patient Aesthetic HOF Procedures and Recalls
    const aestheticPath = `clinics/${clinic.id}/aesthetic_procedures`;
    const qAesthetic = query(
      collection(db, aestheticPath),
      where('patientId', '==', selectedPatientId)
    );
    const unsubAesthetic = onSnapshot(qAesthetic, (snapshot) => {
      setPatientAesthetics(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      console.error("[MedicalRecord] Error load patient aesthetics:", error);
    });

    // Load Patient Appointments (Histórico de Agendamento)
    const appointmentsPath = `clinics/${clinic.id}/appointments`;
    const qAppointments = query(
      collection(db, appointmentsPath),
      where('patientId', '==', selectedPatientId)
    );
    const unsubAppointments = onSnapshot(qAppointments, (snapshot) => {
      const apts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      // Sort appointments by date & time desc
      apts.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        const timeA = a.time || '';
        const timeB = b.time || '';
        return timeB.localeCompare(timeA);
      });
      setPatientAppointments(apts);
    }, (error) => {
      console.error("[MedicalRecord] Error loading patient appointments:", error);
    });

    return () => {
      unsubQ(); unsubT(); unsubF(); unsubD(); unsubI(); unsubA(); unsubImported(); unsubNotes(); unsubAesthetic(); unsubAppointments();
    };
  }, [selectedPatientId, clinic, patients, patientData]);

  useEffect(() => {
    if (!selectedPatientId || !clinic) {
      setPatientData(null);
      return;
    }

    const isLegacy = patients.find(p => p.id === selectedPatientId)?._isLegacy;
    const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;

    const unsub = onSnapshot(doc(db, patientBasePath), (docSnap) => {
      if (docSnap.exists()) {
        setPatientData({ id: docSnap.id, ...docSnap.data(), _isLegacy: !!isLegacy } as Patient);
      } else {
        if (isLegacy === undefined) {
          const fallbackPath = `patients/${selectedPatientId}`;
          const unsubFallback = onSnapshot(doc(db, fallbackPath), (fallbackSnap) => {
            if (fallbackSnap.exists()) {
              setPatientData({ id: fallbackSnap.id, ...fallbackSnap.data(), _isLegacy: true } as Patient);
            }
          });
          return () => unsubFallback();
        }
      }
    }, (error) => {
      console.error("[MEDICAL_RECORD_VIEW] Error fetching active patient details:", error);
    });

    return () => unsub();
  }, [selectedPatientId, clinic, patients]);

  const filteredPatients = patients;

  const selectedPatient = patientData || patients.find(r => r.id === selectedPatientId);

  // New Modals State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMigrationWizardOpen, setIsMigrationWizardOpen] = useState(false);
  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);
  const [isEvolutionModalOpen, setIsEvolutionModalOpen] = useState(false);
  const [editingEvolutionIndex, setEditingEvolutionIndex] = useState<number | null>(null);
  const [isFinancialModalOpen, setIsFinancialModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isPlanningModalOpen, setIsPlanningModalOpen] = useState(false);

  // WhatsApp Integration states (Part 1 & 5)
  const [isWhatsAppMenuOpen, setIsWhatsAppMenuOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [whatsAppActiveTab, setWhatsAppActiveTab] = useState<'menu' | 'send' | 'history' | 'link'>('menu');
  const [whatsAppMsgText, setWhatsAppMsgText] = useState('');
  const [isSendingWhatsAppMsg, setIsSendingWhatsAppMsg] = useState(false);
  const [whatsAppSendStatus, setWhatsAppSendStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [waSettings, setWaSettings] = useState<any>(null);
  const [waIntegration, setWaIntegration] = useState<any>(null);
  const [isMaisDropdownOpen, setIsMaisDropdownOpen] = useState(false);
  const [waConvoHistory, setWaConvoHistory] = useState<any[]>([]);
  const [isLoadingConvoHistory, setIsLoadingConvoHistory] = useState(false);
  const [planningForm, setPlanningForm] = useState({
    professionalId: '',
    date: new Date().toISOString().split('T')[0],
    time: '09:05',
    chair: 'Cadeira 1',
    procedureCategory: 'Toxina Botulínica',
    procedureName: '',
    expectedValue: 0,
    expectedPaymentMethod: 'Pix',
    materials: [] as string[],
    notes: '',
    status: 'Planejado' as 'Planejado' | 'Sala preparada' | 'Paciente chegou' | 'Em atendimento' | 'Realizado' | 'Não realizado' | 'Reagendado'
  });
  const [selectedEntriesToPay, setSelectedEntriesToPay] = useState<any[]>([]);
  const [receiptForm, setReceiptForm] = useState({
    amountPaidNow: 0,
    paymentMethod: 'Pix',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
    receivedByName: ''
  });
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});

  // States for Direct Completed Procedure and Active Treatment Finalization
  const [isAddHistoryModalOpen, setIsAddHistoryModalOpen] = useState(false);
  const [historyForm, setHistoryForm] = useState({
    description: '',
    professionalId: '',
    amount: '',
    completedAt: new Date().toISOString().split('T')[0],
    evolutionText: '',
    paymentMethod: 'Pix'
  });

  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [selectedFinalizeTreatmentId, setSelectedFinalizeTreatmentId] = useState<string | null>(null);
  const [finalizeForm, setFinalizeForm] = useState({
    professionalId: '',
    amount: '',
    completedAt: new Date().toISOString().split('T')[0],
    paymentMethod: 'Pix'
  });

  const [isEditingTreatmentModalOpen, setIsEditingTreatmentModalOpen] = useState(false);
  const [editingTreatment, setEditingTreatment] = useState<any | null>(null);
  const [editTreatmentForm, setEditTreatmentForm] = useState({
    professionalId: '',
    professionalName: '',
    procedureName: '',
    procedureValue: 0,
    commissionPercent: 30,
    commissionEligible: true,
    treatmentStatus: 'Iniciado' as 'Planejado' | 'Iniciado' | 'Em andamento' | 'Finalizado' | 'Cancelado'
  });

  const handleSaveEditTreatment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !clinic || !editingTreatment) return;

    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      const selectedMember = staff.find(m => m.id === editTreatmentForm.professionalId);
      const professionalName = selectedMember ? selectedMember.name : '';
      const isCompleted = editTreatmentForm.treatmentStatus === 'Finalizado';
      
      const treatmentRef = doc(db, patientBasePath, 'treatments', editingTreatment.id);
      
      const updatePayload: any = {
        description: editTreatmentForm.procedureName,
        procedureName: editTreatmentForm.procedureName,
        amount: Number(editTreatmentForm.procedureValue),
        procedureValue: Number(editTreatmentForm.procedureValue),
        professional: professionalName || null,
        professionalName: professionalName || null,
        professionalId: editTreatmentForm.professionalId || null,
        commissionPercent: Number(editTreatmentForm.commissionPercent),
        commissionEligible: !!editTreatmentForm.commissionEligible,
        treatmentStatus: editTreatmentForm.treatmentStatus,
        status: isCompleted ? 'completed' : 'active'
      };

      if (isCompleted && !editingTreatment.completedAt) {
        updatePayload.completedAt = new Date().toISOString().split('T')[0];
      } else if (!isCompleted) {
        updatePayload.completedAt = null;
      }

      await updateDoc(treatmentRef, updatePayload);
      setIsEditingTreatmentModalOpen(false);
      setEditingTreatment(null);
    } catch (err) {
      if (err instanceof Error) {
        console.error("[TREATMENT_EDIT_ERROR]", err);
        alert("Erro ao salvar alterações no procedimento: " + err.message);
      }
    }
  };

  // States for Improved "Ver detalhes" Financial Entry Modal
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedDetailsEntry, setSelectedDetailsEntry] = useState<any | null>(null);
  const [isDetailsEditing, setIsDetailsEditing] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    type: 'receita', // receita / despesa
    status: 'pendente', // pago, parcial, pendente, cancelado
    category: '',
    subcategory: '',
    description: '',
    patientName: '',
    patientId: '',
    professionalName: '',
    grossAmount: 0,
    discount: 0,
    additions: 0,
    paymentMethod: 'Pix',
    installments: 1,
    dueDate: '',
    paymentDate: '',
    notes: '',
    createdByName: '',
    createdAt: '',
    updatedAt: '',
    updatedByName: ''
  });
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.displayName && !receiptForm.receivedByName) {
      setReceiptForm(prev => ({ ...prev, receivedByName: user.displayName || '' }));
    }
  }, [user, receiptForm.receivedByName]);

  useEffect(() => {
    if (!clinic?.id) return;
    const configRef = doc(db, 'clinics', clinic.id, 'whatsapp_settings', 'config');
    const unsubConfig = onSnapshot(configRef, (snap) => {
      if (snap.exists()) {
        setWaSettings(snap.data());
      } else {
        setWaSettings({
          defaultSendMode: 'eliza_api',
          allowOpenExternalWhatsApp: true
        });
      }
    });

    const integrationRef = doc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');
    const unsubIntegration = onSnapshot(integrationRef, (snap) => {
      if (snap.exists()) {
        setWaIntegration(snap.data());
      } else {
        setWaIntegration(null);
      }
    });

    return () => {
      unsubConfig();
      unsubIntegration();
    };
  }, [clinic?.id]);

  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isPrescriptionGeneratorOpen, setIsPrescriptionGeneratorOpen] = useState(false);
  const [prescriptionForm, setPrescriptionForm] = useState({
    patientName: '',
    patientCpf: '',
    patientBirthDate: '',
    professionalName: '',
    date: '',
    status: 'active' as 'active' | 'dispensed' | 'cancelled' | 'archived',
    templateId: '',
    recipeType: 'comum' as 'comum' | 'especial'
  });
  const [prescriptionText, setPrescriptionText] = useState('');
  const [prescriptionAIAnalysis, setPrescriptionAIAnalysis] = useState('');
  const [isAnalyzingPrescription, setIsAnalyzingPrescription] = useState(false);
  const [documentSubTab, setDocumentSubTab] = useState<'prescriptions' | 'contracts'>('prescriptions');
  const [isContractGeneratorOpen, setIsContractGeneratorOpen] = useState(false);
  const [isCompilingContract, setIsCompilingContract] = useState(false);
  const [selectedQuotationForContract, setSelectedQuotationForContract] = useState<Quotation | null>(null);
  const [contractText, setContractText] = useState('');
  const [contractUseAI, setContractUseAI] = useState(true);
  const [contractFormData, setContractFormData] = useState({
    patientName: '',
    patientCpf: '',
    patientRg: '',
    patientBirthDate: '',
    patientPhone: '',
    patientAddress: '',
    clinicName: '',
    clinicCnpj: '',
    professionalName: '',
    professionalCro: '',
    paymentMethod: 'Pix / Dinheiro com 10% de desconto',
    templateId: 'toxina_botulinica'
  });
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isAnamnesisModalOpen, setIsAnamnesisModalOpen] = useState(false);
  const [selectedTreatmentId, setSelectedTreatmentId] = useState<string | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [procedures, setProcedures] = useState<TreatmentCatalogItem[]>([]);
  const [procedureSearch, setProcedureSearch] = useState('');
  const [procedureCategory, setProcedureCategory] = useState('Todas');
  const [isNewTreatmentModalOpen, setIsNewTreatmentModalOpen] = useState(false);
  const [patientReturnRequests, setPatientReturnRequests] = useState<any[]>([]);
  const [isReturnRequestModalOpen, setIsReturnRequestModalOpen] = useState(false);
  const [completedTreatmentForReturn, setCompletedTreatmentForReturn] = useState<any | null>(null);
  
  const [returnRequestForm, setReturnRequestForm] = useState({
    treatmentName: '',
    professionalId: '',
    returnType: 'Revisão pós-procedimento',
    suggestedDeadline: '15 dias',
    customDate: '',
    observation: '',
    priority: 'Normal'
  });

  // Load patient return requests
  useEffect(() => {
    if (!clinic || !selectedPatientId) return;
    const q = query(
      collection(db, 'clinics', clinic.id, 'return_requests'),
      where('patientId', '==', selectedPatientId)
    );
    const unsub = onSnapshot(q, (snap) => {
      setPatientReturnRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading patient return requests:", error);
    });
    return () => unsub();
  }, [clinic, selectedPatientId]);

  const handleOpenReturnRequestManual = (treatmentDescription = "") => {
    if (!selectedPatient) return;
    const loggedInId = user?.uid || '';
    const initialProfId = staff.some(m => m.id === loggedInId) ? loggedInId : (staff[0]?.id || '');

    setReturnRequestForm({
      treatmentName: treatmentDescription,
      professionalId: initialProfId,
      returnType: 'Revisão pós-procedimento',
      suggestedDeadline: '15 dias',
      customDate: '',
      observation: '',
      priority: 'Normal'
    });
    setIsReturnRequestModalOpen(true);
  };
  const [newQuickTreatment, setNewQuickTreatment] = useState({
    name: '',
    category: 'Harmonização Facial',
    subcategory: '',
    defaultPrice: 0,
    description: ''
  });

  useEffect(() => {
    if (!clinic) return;
    const unsubCatalog = onSnapshot(collection(db, 'clinics', clinic.id, 'treatment_catalog'), (snap) => {
      const dbProcedures = snap.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || '',
        category: doc.data().category || '',
        subcategory: doc.data().subcategory || '',
        defaultPrice: Number(doc.data().defaultPrice) || 0,
        baseValue: Number(doc.data().defaultPrice) || 0,
        description: doc.data().description || '',
        estimatedDuration: Number(doc.data().estimatedDuration) || 0,
        requiresFaces: !!doc.data().requiresFaces,
        requiresRegion: !!doc.data().requiresRegion,
        active: doc.data().active !== false,
        createdAt: doc.data().createdAt,
        updatedAt: doc.data().updatedAt,
        createdBy: doc.data().createdBy
      }));

      const merged = [
        ...dbProcedures,
        ...DEFAULT_TREATMENT_CATALOG.filter(def => 
          !dbProcedures.some(dbProc => dbProc.name.toLowerCase() === def.name.toLowerCase())
        )
      ];
      setProcedures(merged);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `clinics/${clinic.id}/treatment_catalog`);
    });
    return () => unsubCatalog();
  }, [clinic]);

  useEffect(() => {
    if (!clinic) return;
    const unsubStaff = onSnapshot(collection(db, 'clinics', clinic.id, 'members'), (snapshot) => {
      setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `clinics/${clinic.id}/members`);
    });
    return () => unsubStaff();
  }, [clinic]);

  // Form State for Evolution
  const [evolutionText, setEvolutionText] = useState('');

  // Form State for Payment
  const [paymentForm, setPaymentForm] = useState({
    description: '',
    value: 0,
    method: 'PIX',
    status: 'received' as 'received' | 'pending'
  });

  // Form State for Document
  const [documentForm, setDocumentForm] = useState({
    title: '',
    type: 'receita' as 'receita' | 'atestado' | 'laudo',
    content: ''
  });

  // Form State for Quotation
  const [quotationForm, setQuotationForm] = useState({
    title: '',
    responsible: '',
    items: [] as { description: string, value: number, quantity?: number, observation?: string, tooth?: string, region?: string, faces?: string[], status?: 'pending' | 'approved' }[],
    paymentMethod: 'PIX',
    installments: 1
  });

  const [currentProcedure, setCurrentProcedure] = useState({
    procedureId: '',
    value: 0,
    quantity: 1,
    observation: '',
    tooth: '',
    region: '',
    faces: [] as string[]
  });

  const [imageForm, setImageForm] = useState({
    title: '',
    category: 'Foto Clínica',
    description: ''
  });

  const [selectedFileBase64, setSelectedFileBase64] = useState<string | null>(null);

  // Update Quotation Items
  const addProcedureToQuotation = () => {
    const procedure = procedures.find(p => p.id === currentProcedure.procedureId);
    if (!procedure) return;

    let details = [];
    if (currentProcedure.tooth) details.push(`Dente ${currentProcedure.tooth}`);
    if (currentProcedure.region) details.push(`Região ${currentProcedure.region}`);
    if (currentProcedure.faces && currentProcedure.faces.length > 0) details.push(`Faces: ${currentProcedure.faces.join(', ')}`);
    if (currentProcedure.observation) details.push(`Obs: ${currentProcedure.observation}`);

    const extraStr = details.length > 0 ? ` (${details.join(' | ')})` : '';
    const description = `${procedure.name}${extraStr}`;

    setQuotationForm(prev => ({
      ...prev,
      items: [...prev.items, { 
        description, 
        value: Number(currentProcedure.value) || 0,
        quantity: Number(currentProcedure.quantity) || 1,
        observation: currentProcedure.observation || '',
        tooth: currentProcedure.tooth || '',
        region: currentProcedure.region || '',
        faces: currentProcedure.faces || []
      }]
    }));

    setCurrentProcedure({ procedureId: '', value: 0, quantity: 1, observation: '', tooth: '', region: '', faces: [] });
  };

  const handleSavePlanning = async () => {
    if (!clinic || !selectedPatient) return;
    try {
      const selectedProf = staff.find((s: any) => s.id === planningForm.professionalId);
      const payload = {
        patientId: selectedPatientId,
        patientName: selectedPatient.name || 'Paciente sem nome',
        professionalId: planningForm.professionalId || 'not-assigned',
        professionalName: selectedProf?.name || 'Sem atribuição',
        date: planningForm.date,
        time: planningForm.time,
        chair: planningForm.chair,
        procedureCategory: planningForm.procedureCategory,
        procedureName: planningForm.procedureName || planningForm.procedureCategory,
        expectedValue: Number(planningForm.expectedValue) || 0,
        expectedPaymentMethod: planningForm.expectedPaymentMethod,
        materialList: planningForm.materials,
        status: planningForm.status,
        notes: planningForm.notes,
        realizedValue: planningForm.status === 'Realizado' ? (Number(planningForm.expectedValue) || 0) : 0,
        realizedAt: planningForm.status === 'Realizado' ? new Date().toISOString() : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await addDoc(collection(db, 'clinics', clinic.id, 'planned_procedures'), payload);
      setIsPlanningModalOpen(false);
      setPlanningForm({
        professionalId: '',
        date: new Date().toISOString().split('T')[0],
        time: '09:00',
        chair: 'Cadeira 1',
        procedureCategory: 'Toxina Botulínica',
        procedureName: '',
        expectedValue: 0,
        expectedPaymentMethod: 'Pix',
        materials: [],
        notes: '',
        status: 'Planejado'
      });
      alert('Procedimento adicionado ao planejamento com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar planejamento: ' + err.message);
    }
    setProcedureSearch('');
  };

  const handleSaveQuotation = async () => {
    if (!selectedPatientId || quotationForm.items.length === 0 || !clinic) return;
    
    const newQId = editingQuotationId || `q-${Date.now()}`;
    const totalValue = quotationForm.items.reduce((acc, item) => acc + (Number(item.value) * (Number(item.quantity) || 1)), 0);
    
    const existingQ = editingQuotationId ? quotations.find(q => q.id === editingQuotationId) : null;

    // Explicitly fallback to prevent any undefined fields from throwing Firebase setDoc crashes.
    const newQData = {
      title: quotationForm.title || 'Plano de Tratamento',
      responsible: quotationForm.responsible || '',
      items: (quotationForm.items || []).map(item => ({
        description: item.description || '',
        value: Number(item.value) || 0,
        quantity: Number(item.quantity) || 1,
        observation: item.observation || '',
        tooth: item.tooth || '',
        region: item.region || '',
        faces: item.faces || [],
        status: item.status || 'pending'
      })),
      status: existingQ ? (existingQ.status || 'draft') : 'draft',
      totalValue,
      paymentMethod: quotationForm.paymentMethod || 'PIX',
      installments: Number(quotationForm.installments) || 1,
      createdAt: existingQ ? (existingQ.createdAt || serverTimestamp()) : serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const isLegacy = patientData?.id === selectedPatientId ? patientData._isLegacy : patients.find(p => p.id === selectedPatientId)?._isLegacy;
    const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;

    try {
      await setDoc(doc(db, patientBasePath, 'quotations', newQId), newQData);
      setIsQuotationModalOpen(false);
      setEditingQuotationId(null);
      setQuotationForm({ title: '', responsible: '', items: [], paymentMethod: 'PIX', installments: 1 });
      alert("Orçamento salvo com sucesso!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/quotations/${newQId}`);
    }
  };

  const handleEditQuotation = (q: Quotation) => {
    setEditingQuotationId(q.id);
    setQuotationForm({
      title: q.title || '',
      responsible: q.responsible || '',
      items: q.items || [],
      paymentMethod: q.paymentMethod || 'PIX',
      installments: q.installments || 1
    });
    setIsQuotationModalOpen(true);
  };

  const handleSaveQuickTreatment = async () => {
    if (!clinic || !newQuickTreatment.name.trim()) return;
    try {
      const collectionRef = collection(db, 'clinics', clinic.id, 'treatment_catalog');
      const docData = {
        name: newQuickTreatment.name.trim(),
        category: newQuickTreatment.category,
        subcategory: newQuickTreatment.subcategory.trim() || '',
        defaultPrice: Number(newQuickTreatment.defaultPrice) || 0,
        description: newQuickTreatment.description.trim() || '',
        estimatedDuration: 30, // Default 30 min
        requiresFaces: false,
        requiresRegion: false,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: auth.currentUser?.uid || ''
      };

      const docRef = await addDoc(collectionRef, docData);
      
      // Auto-select this newly created procedure for current procedure state
      setCurrentProcedure({
        procedureId: docRef.id,
        value: docData.defaultPrice,
        quantity: 1,
        observation: '',
        tooth: '',
        region: '',
        faces: []
      });

      setIsNewTreatmentModalOpen(false);
      setNewQuickTreatment({
        name: '',
        category: 'Harmonização Facial',
        subcategory: '',
        defaultPrice: 0,
        description: ''
      });
    } catch (err) {
      console.error("Error creating quick treatment:", err);
    }
  };

  const handleSaveEvolution = async () => {
    if (!selectedPatientId || !selectedTreatmentId || !evolutionText || !clinic) return;
    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      const treatmentRef = doc(db, patientBasePath, 'treatments', selectedTreatmentId);

      if (editingEvolutionIndex !== null) {
        // We are editing an existing evolution! Update in-memory copy of array and save back
        const originalTreatment = treatments.find(t => t.id === selectedTreatmentId);
        if (!originalTreatment) throw new Error("Procedimento não encontrado");

        const updatedEvolutions = [...(originalTreatment.evolutions || [])];
        if (updatedEvolutions[editingEvolutionIndex]) {
          updatedEvolutions[editingEvolutionIndex] = {
            ...updatedEvolutions[editingEvolutionIndex],
            text: evolutionText,
            updatedAt: new Date().toISOString()
          };
        }

        await updateDoc(treatmentRef, {
          evolutions: updatedEvolutions
        });
        alert("Evolução editada com sucesso!");
      } else {
        // We are creating a new one
        await updateDoc(treatmentRef, {
          evolutions: arrayUnion({ text: evolutionText, date: new Date().toISOString() })
        });
      }

      setIsEvolutionModalOpen(false);
      setEvolutionText('');
      setEditingEvolutionIndex(null);

      // Auto-resolve pending elements
      try {
        const { ClinicalEvolutionMonitorService } = await import('../services/ClinicalEvolutionMonitorService');
        await ClinicalEvolutionMonitorService.resolveEvolutionsForPatient(clinic.id, selectedPatientId);
      } catch (svcErr) {
        console.error("[MedicalRecord] Auto-resolving pending items failed:", svcErr);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${patientBasePath}/treatments/${selectedTreatmentId}`);
    }
  };

  const handleEditEvolutionClick = (treatmentId: string, index: number, currentText: string) => {
    setSelectedTreatmentId(treatmentId);
    setEditingEvolutionIndex(index);
    setEvolutionText(currentText);
    setIsEvolutionModalOpen(true);
  };

  const handleFinalizeTreatment = (treatmentId: string) => {
    const treat = treatments.find(t => t.id === treatmentId);
    setSelectedFinalizeTreatmentId(treatmentId);

    const clinicalRoles = [
      "dentist", "dentist_gp", "cirurgiao_dentista", "cirurgião dentista",
      "especialista", "professional", "clinical_professional", "doctor",
      "dentista", "odontologista", "clinico"
    ];
    const clinicalStaff = staff.filter((member) => {
      if (member.active === false || member.status === "inactive") return false;
      if (member.isClinicalProvider === true || member.isClinical === true || member.providesCare === true || member.provides_care === true || member.agendaLiberada === true || member.calendarEnabled === true) {
        return true;
      }
      const role = (member.role || "").toLowerCase().trim();
      return clinicalRoles.includes(role);
    });

    const loggedInId = profile?.uid || user?.uid || '';
    const isLogClinician = clinicalStaff.some(m => m.id === loggedInId);
    const defaultProfId = isLogClinician 
      ? loggedInId 
      : (treat?.professionalId || clinicalStaff.find(m => m.name === treat?.professional)?.id || '');

    setFinalizeForm({
      professionalId: defaultProfId,
      amount: treat?.amount ? String(treat.amount) : '0',
      completedAt: new Date().toISOString().split('T')[0],
      paymentMethod: 'Baixa Clínica'
    });
    setIsFinalizeModalOpen(true);
  };

  const handleSaveFinalizeActive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !clinic || !selectedFinalizeTreatmentId) return;

    const patientBasePath = getPatientPathStr(selectedPatientId);

    const treat = treatments.find(t => t.id === selectedFinalizeTreatmentId);
    if (!treat) return;

    try {
      const selectedMember = staff.find(m => m.id === finalizeForm.professionalId);
      const professionalName = selectedMember ? selectedMember.name : (treat.professional || "Não especificado");
      const numAmount = treat.amount || 0;

      const treatmentRef = doc(db, patientBasePath, 'treatments', selectedFinalizeTreatmentId);
      await updateDoc(treatmentRef, {
        status: 'completed',
        completedAt: finalizeForm.completedAt,
        amount: numAmount,
        professional: professionalName,
        professionalId: finalizeForm.professionalId || null
      });

      setIsFinalizeModalOpen(false);
      setSelectedFinalizeTreatmentId(null);
      setCompletedTreatmentForReturn({
        id: treat.id,
        description: treat.description,
        professionalId: finalizeForm.professionalId || null,
        professionalName: professionalName
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `${patientBasePath}/treatments/${selectedFinalizeTreatmentId}`);
    }
  };

  const handleSaveReturnRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic || !selectedPatientId || !selectedPatient) return;

    try {
      const selectedMember = staff.find(m => m.id === returnRequestForm.professionalId);
      const professionalName = selectedMember ? selectedMember.name : "Não atribuído";
      
      const reqId = `req-${Date.now()}`;
      
      // Calculate targetDate (prazo sugerido) for alerts
      let targetDate = new Date();
      if (returnRequestForm.suggestedDeadline === '7 dias') targetDate.setDate(targetDate.getDate() + 7);
      else if (returnRequestForm.suggestedDeadline === '15 dias') targetDate.setDate(targetDate.getDate() + 15);
      else if (returnRequestForm.suggestedDeadline === '30 dias') targetDate.setDate(targetDate.getDate() + 30);
      else if (returnRequestForm.suggestedDeadline === '90 dias') targetDate.setDate(targetDate.getDate() + 90);
      else if (returnRequestForm.suggestedDeadline === '120 dias') targetDate.setDate(targetDate.getDate() + 120);
      else if (returnRequestForm.suggestedDeadline === '150 dias') targetDate.setDate(targetDate.getDate() + 150);
      else if (returnRequestForm.suggestedDeadline === '180 dias') targetDate.setDate(targetDate.getDate() + 180);
      else if (returnRequestForm.suggestedDeadline === 'Data personalizada' && returnRequestForm.customDate) {
        targetDate = new Date(returnRequestForm.customDate);
      } else {
        targetDate.setDate(targetDate.getDate() + 15); // Fallback
      }

      const requestPayload = {
        id: reqId,
        patientId: selectedPatientId,
        patientName: selectedPatient.name || "Paciente sem nome",
        patientPhone: selectedPatient.phone || "",
        treatmentName: returnRequestForm.treatmentName || "Revisão Geral",
        professionalId: returnRequestForm.professionalId || "not-assigned",
        professionalName: professionalName,
        returnType: returnRequestForm.returnType,
        suggestedDeadline: returnRequestForm.suggestedDeadline,
        customDate: returnRequestForm.customDate || null,
        targetDate: targetDate.toISOString(),
        observation: returnRequestForm.observation || "",
        priority: returnRequestForm.priority || "Normal",
        status: 'Pendente',
        createdAt: new Date().toISOString(),
        createdBy: profile?.name || user?.email || 'Profissional',
        overdueAlerted: false
      };

      await setDoc(doc(db, 'clinics', clinic.id, 'return_requests', reqId), requestPayload);
      
      console.log(`[RETORNO_SOLICITADO] Successful return requested for patient ${selectedPatientId}`);
      
      // Save log to automation_logs mapping
      try {
        await addDoc(collection(db, 'clinics', clinic.id, 'automation_logs'), {
          type: 'return_request_created',
          message: `[RETORNO_SOLICITADO] Profissional ${profile?.name || user?.email} solicitou retorno de ${returnRequestForm.returnType} para o paciente ${selectedPatient.name}.`,
          requestId: reqId,
          patientId: selectedPatientId,
          createdAt: serverTimestamp()
        });
      } catch (logErr) {
        console.warn("Could not save log to automation_logs:", logErr);
      }

      setIsReturnRequestModalOpen(false);
      setCompletedTreatmentForReturn(null);
      alert("Solicitação de retorno enviada para a recepção com sucesso!");

    } catch (err: any) {
      console.error("[RETORNO_ERRO] Failed to save return request:", err);
      alert("Erro ao salvar solicitação de retorno: " + err.message);
    }
  };

  const handleAddDirectHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !clinic) return;
    if (!historyForm.description) {
      alert("Por favor, preencha a descrição do procedimento.");
      return;
    }

    const patientBasePath = getPatientPathStr(selectedPatientId);

    try {
      const treatmentId = `hist-${Date.now()}`;
      const treatmentRef = doc(db, patientBasePath, 'treatments', treatmentId);

      const selectedMember = teamMembers.find(m => m.id === historyForm.professionalId);
      const professionalName = selectedMember ? selectedMember.name : (historyForm.professionalId || "Não especificado");
      const numAmount = parseFloat(historyForm.amount) || 0;

      const treatmentData: any = {
        id: treatmentId,
        description: historyForm.description,
        professional: professionalName,
        professionalId: historyForm.professionalId || null,
        amount: numAmount,
        status: 'completed',
        completedAt: historyForm.completedAt,
        createdAt: new Date().toISOString()
      };

      if (historyForm.evolutionText) {
        treatmentData.evolutions = [{
          text: historyForm.evolutionText,
          date: historyForm.completedAt
        }];
      } else {
        treatmentData.evolutions = [];
      }

      await setDoc(treatmentRef, treatmentData);

      alert("Procedimento histórico lançado com sucesso!");
      setIsAddHistoryModalOpen(false);
      setHistoryForm({
        description: '',
        professionalId: '',
        amount: '',
        completedAt: new Date().toISOString().split('T')[0],
        evolutionText: '',
        paymentMethod: 'Pix'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/treatments`);
    }
  };

  const handleSavePayment = async () => {
    if (!selectedPatientId || !paymentForm.description || !paymentForm.value || !clinic) return;
    const pId = `pay-${Date.now()}`;
    const patient = patients.find(p => p.id === selectedPatientId);
    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      // 1. Record in patient subcollection (keep for legacy compatibility)
      await setDoc(doc(db, patientBasePath, 'financial', pId), {
        ...paymentForm,
        date: serverTimestamp()
      });

      // 2. Record in global clinic transactions collection
      await addDoc(collection(db, 'clinics', clinic.id, 'transactions'), {
        description: `${paymentForm.description} - ${patient?.name || 'Paciente'}`,
        amount: paymentForm.value,
        type: 'income',
        status: paymentForm.status === 'received' ? 'paid' : 'pending',
        category: 'Clínico',
        date: serverTimestamp(),
        patientId: selectedPatientId,
        paymentId: pId
      });

      // 3. Record in clinics/{clinicId}/financial_entries (our main single source of truth for display)
      const competenceMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const docData = {
        patientId: selectedPatientId,
        patient_id: selectedPatientId,
        patientName: patient?.name || 'Paciente',
        patient_name: patient?.name || 'Paciente',
        description: paymentForm.description,
        type: 'income',
        category: 'Clínico',
        amount: Number(paymentForm.value) || 0,
        value: Number(paymentForm.value) || 0,
        paidAmount: paymentForm.status === 'received' ? (Number(paymentForm.value) || 0) : 0,
        paid_amount: paymentForm.status === 'received' ? (Number(paymentForm.value) || 0) : 0,
        pendingAmount: paymentForm.status === 'received' ? 0 : (Number(paymentForm.value) || 0),
        remainingAmount: paymentForm.status === 'received' ? 0 : (Number(paymentForm.value) || 0),
        remaining_amount: paymentForm.status === 'received' ? 0 : (Number(paymentForm.value) || 0),
        status: paymentForm.status === 'received' ? 'paid' : 'pending',
        paymentMethod: paymentForm.method || 'PIX',
        payment_method: paymentForm.method || 'PIX',
        date: new Date().toISOString(),
        dueDate: new Date().toISOString(),
        due_date: new Date().toISOString(),
        competence_month: competenceMonth,
        createdAt: serverTimestamp(),
        created_at: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updated_at: serverTimestamp(),
        createdBy: user?.uid || 'system',
        receivedBy: paymentForm.status === 'received' ? (user?.uid || '') : '',
        receivedByName: paymentForm.status === 'received' ? (user?.displayName || 'Equipe') : ''
      };

      await setDoc(doc(db, 'clinics', clinic.id, 'financial_entries', pId), docData);

      if (paymentForm.status === 'received') {
        try {
          const { generateCommissionsForEntry } = await import('../services/financeService');
          await generateCommissionsForEntry(clinic.id, {
            id: pId,
            ...docData,
            status: 'paid'
          });
        } catch (commErr) {
          console.error("Error auto-generating commission in direct payment save:", commErr);
        }
      }

      setIsFinancialModalOpen(false);
      setPaymentForm({ description: '', value: 0, method: 'PIX', status: 'received' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/financial/${pId}`);
    }
  };

  const detectDuplicatePatientFinancialEntries = async (patientId: string) => {
    if (!clinic || !patientId) return;
    console.log(`[PATIENT_FINANCE_CLEANUP] scanning duplicates for patient ID: ${patientId}`);
    try {
      const q = query(
        collection(db, 'clinics', clinic.id, 'financial_entries'),
        where('patient_id', '==', patientId)
      );
      const snap = await getDocs(q);
      const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      
      const duplicatesToDelete: any[] = [];
      const seenKeys = new Set<string>();

      entries.forEach(entry => {
        if (entry.archived === true) return;
        const totalAmount = Number(entry.amount) || entry.value || 0;
        const normalizedDesc = (entry.description || '').toLowerCase().trim();
        const dateStr = entry.date ? entry.date.substring(0, 10) : '';
        const key = `${entry.patient_id || entry.patientId}_${normalizedDesc}_${totalAmount}_${dateStr}`;
        
        if (seenKeys.has(key)) {
          duplicatesToDelete.push(entry);
        } else {
          seenKeys.add(key);
        }
      });

      console.log(`[PATIENT_FINANCE_CLEANUP] found ${duplicatesToDelete.length} duplicates to delete.`);

      let deletedCount = 0;
      for (const entry of duplicatesToDelete) {
        console.log(`[PATIENT_FINANCE_CLEANUP] deleting duplicate entry ID: ${entry.id} with details: ${entry.description}`);
        await deleteDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entry.id));
        deletedCount++;
      }

      if (deletedCount > 0) {
        alert(`Limpeza concluída! ${deletedCount} lançamentos duplicados foram removidos do histórico.`);
      } else {
        alert("Nenhuma duplicidade retroativa detectada para este paciente.");
      }
    } catch (err) {
      console.error("[PATIENT_FINANCE_CLEANUP_ERROR]", err);
      alert("Erro ao executar limpeza de duplicidades: " + (err as Error).message);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!selectedPatientId || !clinic || selectedEntriesToPay.length === 0) return;

    const amountPaidNow = Number(receiptForm.amountPaidNow);
    const totalPending = selectedEntriesToPay.reduce((acc, e) => acc + e.remainingAmount, 0);

    if (amountPaidNow > totalPending) {
      setReceiptError("O valor recebido não pode ser maior que o valor pendente.");
      return;
    }

    setReceiptError(null);

    const patientBasePath = getPatientPathStr(selectedPatientId);

    let outstandingPaid = amountPaidNow;

    try {
      for (const entry of selectedEntriesToPay) {
        if (outstandingPaid <= 0) break;

        const allocation = Math.min(entry.remainingAmount, outstandingPaid);
        outstandingPaid -= allocation;

        const newPaidAmount = (entry.paidAmount || 0) + allocation;
        const newRemainingAmount = entry.value - newPaidAmount;
        const newStatus = newRemainingAmount <= 0 ? 'paid' : 'partial';

        // 1. Create a record in clinics/{clinicId}/patients/{patientId}/payments/{paymentId}
        const paymentId = `pay-rec-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const paymentPath = `${patientBasePath}/payments/${paymentId}`;

        console.log("[PAYMENT_SAVE] patientId:", selectedPatientId);
        console.log("[PAYMENT_SAVE] path payment:", paymentPath);
        console.log("[PAYMENT_SAVE] amountPaid:", allocation);
        console.log("[PAYMENT_SAVE] method:", receiptForm.paymentMethod);

        const paymentData = {
          patientId: selectedPatientId,
          financialEntryId: entry.id,
          treatmentId: entry.raw.treatmentId || entry.raw.treatment_id || null,
          quotationId: entry.raw.quotationId || entry.raw.quotation_id || null,
          description: entry.description || 'Recebimento de tratamento',
          amountPaid: allocation,
          paymentMethod: receiptForm.paymentMethod,
          paymentDate: receiptForm.paymentDate,
          notes: receiptForm.notes || '',
          receivedBy: user?.uid || '',
          receivedByName: receiptForm.receivedByName || user?.displayName || 'Equipe',
          createdAt: serverTimestamp(),
          clinicId: clinic.id
        };

        await setDoc(doc(db, patientBasePath, 'payments', paymentId), paymentData);

        // 2 & 3. Split entries: full payment goes to a paid record, partial splits into paid and opens a new remaining entry
        const receivedByUserId = user?.uid || '';
        const receivedByUserName = receiptForm.receivedByName || user?.displayName || 'Equipe';

        if (newRemainingAmount <= 0) {
          // Full payment of the remaining amount - update existing original entry to fully paid
          const entryPath = `clinics/${clinic.id}/financial_entries/${entry.id}`;
          console.log("[PAYMENT_UPDATE] updating financial entry (full payment):", entry.id);

          await updateDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entry.id), {
            status: 'paid',
            paidAmount: entry.value,
            paid_amount: entry.value,
            pendingAmount: 0,
            remainingAmount: 0,
            remaining_amount: 0,
            paidAt: serverTimestamp(),
            paymentMethod: receiptForm.paymentMethod,
            payment_method: receiptForm.paymentMethod,
            receivedBy: receivedByUserId,
            receivedByName: receivedByUserName,
            updatedAt: serverTimestamp(),
            updated_at: serverTimestamp(),
            updated_by: receivedByUserId
          });

          // Run commission generation
          try {
            const { generateCommissionsForEntry } = await import('../services/financeService');
            await generateCommissionsForEntry(clinic.id, {
              id: entry.id,
              type: 'receita',
              patientId: selectedPatientId,
              patientName: entry.raw.patientName || entry.raw.patient_name || patients.find(p => p.id === selectedPatientId)?.name || 'Paciente',
              patient_name: entry.raw.patientName || entry.raw.patient_name || patients.find(p => p.id === selectedPatientId)?.name || 'Paciente',
              description: entry.description,
              category: entry.category || 'Geral',
              amount: entry.value,
              value: entry.value,
              status: 'paid',
              paymentMethod: receiptForm.paymentMethod,
              procedure_responsible_id: entry.raw.procedure_responsible_id || entry.raw.professionalId || null,
            });
          } catch (commErr) {
            console.error("Error generating commission on receipt:", commErr);
          }

          // Also update patient subcollection 'financial' if it exists
          try {
            await updateDoc(doc(db, patientBasePath, 'financial', entry.id), {
              paidAmount: entry.value,
              remainingAmount: 0,
              status: 'paid',
              paymentMethod: receiptForm.paymentMethod,
              lastPaymentAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              receivedBy: receivedByUserId,
              receivedByName: receivedByUserName
            });
          } catch (subErr) {
            // If it doesn't exist, ignore
          }
        } else {
          // Partial receipt! Create a new fully paid entry for the received amount, and update the existing entry to represent the remaining pending amount
          const newEntryRef = doc(collection(db, 'clinics', clinic.id, 'financial_entries'));
          const newEntryId = newEntryRef.id;

          const paidEntryData = {
            type: 'receita',
            category: entry.category || 'Geral',
            patientId: selectedPatientId,
            patient_id: selectedPatientId,
            patientName: entry.raw.patientName || entry.raw.patient_name || patients.find(p => p.id === selectedPatientId)?.name || 'Paciente',
            patient_name: entry.raw.patientName || entry.raw.patient_name || patients.find(p => p.id === selectedPatientId)?.name || 'Paciente',
            description: `${entry.description} - Recebimento`,
            amount: allocation,
            value: allocation,
            paidAmount: allocation,
            paid_amount: allocation,
            pendingAmount: 0,
            remainingAmount: 0,
            remaining_amount: 0,
            status: 'paid',
            dueDate: receiptForm.paymentDate,
            due_date: receiptForm.paymentDate,
            paidAt: serverTimestamp(),
            paymentMethod: receiptForm.paymentMethod,
            payment_method: receiptForm.paymentMethod,
            receivedBy: receivedByUserId,
            receivedByName: receivedByUserName,
            createdAt: serverTimestamp(),
            created_at: serverTimestamp(),
            createdBy: user?.displayName || 'ELIZA AI',
            treatmentId: entry.raw.treatmentId || entry.raw.treatment_id || null,
            quotationId: entry.raw.quotationId || entry.raw.quotation_id || null,
            notes: receiptForm.notes || ''
          };

          // Save the paid receipt/entry
          await setDoc(newEntryRef, paidEntryData);

          // Run commission generation
          try {
            const { generateCommissionsForEntry } = await import('../services/financeService');
            await generateCommissionsForEntry(clinic.id, {
              id: newEntryId,
              ...paidEntryData,
              procedure_responsible_id: entry.raw.procedure_responsible_id || entry.raw.professionalId || null,
            });
          } catch (commErr) {
            console.error("Error generating commission on partial receipt:", commErr);
          }

          // Save the paid receipt/entry to patient subcollection
          try {
            await setDoc(doc(db, patientBasePath, 'financial', newEntryId), {
              description: `${entry.description} - Recebimento`,
              value: allocation,
              amount: allocation,
              paidAmount: allocation,
              remainingAmount: 0,
              status: 'paid',
              category: entry.category || 'Geral',
              date: receiptForm.paymentDate,
              dueDate: receiptForm.paymentDate,
              paymentMethod: receiptForm.paymentMethod,
              notes: receiptForm.notes || '',
              receivedBy: receivedByUserId,
              receivedByName: receivedByUserName,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.error("Error creating patient subcollection financial paid entry:", e);
          }

          // Update the original entry with the remaining pending amount
          await updateDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entry.id), {
            amount: newRemainingAmount,
            value: newRemainingAmount,
            paidAmount: 0,
            paid_amount: 0,
            pendingAmount: newRemainingAmount,
            remainingAmount: newRemainingAmount,
            remaining_amount: newRemainingAmount,
            status: 'pendente',
            updatedAt: serverTimestamp(),
            updated_at: serverTimestamp(),
            updated_by: receivedByUserId
          });

          // Also update the original entry in patient's subcollection
          try {
            await updateDoc(doc(db, patientBasePath, 'financial', entry.id), {
              amount: newRemainingAmount,
              value: newRemainingAmount,
              paidAmount: 0,
              remainingAmount: newRemainingAmount,
              status: 'pendente',
              updatedAt: serverTimestamp()
            });
          } catch (e) {
            console.error("Error updating patient subcollection original entry:", e);
          }
        }
      }

      // Reset states
      setSelectedRowIds({});
      setIsReceiptModalOpen(false);
      setReceiptForm({
        amountPaidNow: 0,
        paymentMethod: 'Pix',
        paymentDate: new Date().toISOString().split('T')[0],
        notes: '',
        receivedByName: user?.displayName || ''
      });
      alert('Recebimento registrado com sucesso!');
    } catch (err) {
      console.error("[PAYMENT_SAVE] Error saving receipt:", err);
      alert('Erro ao registrar recebimento: ' + (err as Error).message);
    }
  };

  const handleOpenDetails = (entry: any) => {
    console.log("[FINANCE_DETAILS] entry:", entry);
    setSelectedDetailsEntry(entry);
    
    // Extract values with sensible defaults
    const raw = entry.raw || {};
    
    // Type mapping: receita or despesa
    let mappedType = 'receita';
    if (raw.type === 'expense' || raw.type === 'despesa' || entry.category?.toLowerCase() === 'despesa' || (entry.type && entry.type === 'despesa')) {
      mappedType = 'despesa';
    }
    
    // Status mapping: pago, pendente, vencido, cancelado, parcial
    let mappedStatus = 'pendente';
    const rawStatus = (raw.status || entry.status || '').toLowerCase();
    if (rawStatus === 'paid' || rawStatus === 'received' || rawStatus === 'pago' || rawStatus === 'confirmado') {
      mappedStatus = 'pago';
    } else if (rawStatus === 'cancelled' || rawStatus === 'cancelado') {
      mappedStatus = 'cancelado';
    } else if (rawStatus === 'vencido' || rawStatus === 'overdue') {
      mappedStatus = 'vencido';
    } else if (rawStatus === 'parcial' || rawStatus === 'partial' || rawStatus === 'recebido parcialmente') {
      mappedStatus = 'parcial';
    }
    
    // Professional mapping
    const profName = raw.professional_name || raw.professionalName || raw.receivedByName || entry.professionalName || raw.receivedBy || '';
    
    // Dates formatting: date fields can be timestamps or strings
    const formatDate = (dateValue: any) => {
      if (!dateValue) return '';
      if (typeof dateValue.toDate === 'function') {
        return dateValue.toDate().toISOString().split('T')[0];
      }
      try {
        const d = new Date(dateValue);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      } catch (e) {}
      return String(dateValue).split('T')[0] || '';
    };

    const dueDateStr = formatDate(raw.dueDate || raw.due_date || entry.date || raw.date);
    const paymentDateStr = formatDate(raw.paymentDate || raw.payment_date || raw.lastPaymentAt || (mappedStatus === 'pago' ? (raw.date || entry.date) : ''));
    const createdAtStr = formatDate(raw.createdAt || raw.created_at || raw.date || entry.date || new Date());
    const updatedAtStr = formatDate(raw.updatedAt || raw.updated_at || raw.date || entry.date || new Date());

    setDetailsForm({
      type: mappedType,
      status: mappedStatus as any,
      category: raw.category || entry.category || (entry.isImported ? 'Importado' : 'Sistema'),
      subcategory: raw.subcategory || raw.sub_category || '',
      description: raw.description || entry.description || '',
      patientName: raw.patient_name || raw.patientName || entry.patientName || patients.find(p => p.id === selectedPatientId)?.name || 'Paciente',
      patientId: raw.patient_id || raw.patientId || selectedPatientId || '',
      professionalName: profName,
      grossAmount: Number(raw.grossAmount || raw.gross_amount || raw.value || entry.value || 0),
      discount: Number(raw.discount || 0),
      additions: Number(raw.additions || raw.increase || raw.interest || 0),
      paymentMethod: raw.paymentMethod || raw.payment_method || raw.method || entry.method || 'Pix',
      installments: Number(raw.installments || raw.parcelas || 1),
      dueDate: dueDateStr,
      paymentDate: paymentDateStr,
      notes: raw.notes || raw.remarks || raw.observations || raw.description || '',
      createdByName: raw.createdByName || raw.created_by_name || entry.createdByName || 'Profissional',
      createdAt: createdAtStr,
      updatedAt: updatedAtStr,
      updatedByName: raw.updatedByName || raw.updated_by_name || ''
    });
    
    setIsDetailsEditing(false);
    setIsDeleteConfirmOpen(false);
    setDetailsError(null);
    setIsDetailsModalOpen(true);
  };

  const handleSaveDetails = async () => {
    if (!selectedDetailsEntry || !clinic) return;

    if (!detailsForm.description.trim()) {
      setDetailsError("A descrição é obrigatória.");
      return;
    }
    if (Number(detailsForm.grossAmount) <= 0) {
      setDetailsError("O valor é obrigatório.");
      return;
    }
    const finalVal = Number(detailsForm.grossAmount) - Number(detailsForm.discount) + Number(detailsForm.additions);
    if (finalVal < 0) {
      setDetailsError("O valor final não pode ser negativo.");
      return;
    }
    if (detailsForm.status === 'pago' && !detailsForm.paymentDate) {
      setDetailsError("A data de pagamento é obrigatória para lançamentos com status Pago.");
      return;
    }

    setDetailsError(null);
    const entryId = selectedDetailsEntry.id;

    if (selectedDetailsEntry.isImported) {
      const refPath = `clinics/${clinic.id}/financial_entries/${entryId}`;
      console.log("[FINANCE_UPDATE] path:", refPath);
      
      const updateData: any = {
        type: detailsForm.type, // 'receita' or 'despesa'
        status: detailsForm.status, // 'pago' / 'pendente' / 'vencido' / 'cancelado' (or maps)
        category: detailsForm.category,
        subcategory: detailsForm.subcategory,
        description: detailsForm.description,
        patient_id: detailsForm.patientId || null,
        patientId: detailsForm.patientId || null,
        patient_name: detailsForm.patientName,
        patientName: detailsForm.patientName,
        professional_name: detailsForm.professionalName,
        professionalName: detailsForm.professionalName,
        gross_amount: Number(detailsForm.grossAmount),
        grossAmount: Number(detailsForm.grossAmount),
        discount: Number(detailsForm.discount),
        additions: Number(detailsForm.additions),
        amount: finalVal,
        value: finalVal,
        payment_method: detailsForm.paymentMethod,
        paymentMethod: detailsForm.paymentMethod,
        installments: Number(detailsForm.installments),
        due_date: detailsForm.dueDate || null,
        dueDate: detailsForm.dueDate || null,
        date: detailsForm.dueDate || null,
        payment_date: detailsForm.status === 'pago' ? detailsForm.paymentDate : null,
        paymentDate: detailsForm.status === 'pago' ? detailsForm.paymentDate : null,
        paidAt: detailsForm.status === 'pago' ? detailsForm.paymentDate : null,
        notes: detailsForm.notes,
        updatedAt: serverTimestamp(),
        updated_at: serverTimestamp(),
        updatedBy: user?.uid || null
      };

      try {
        await updateDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entryId), updateData);

        if (detailsForm.status === 'pago') {
          try {
            const { generateCommissionsForEntry } = await import('../services/financeService');
            await generateCommissionsForEntry(clinic.id, {
              id: entryId,
              ...updateData,
              type: detailsForm.type,
              amount: finalVal,
              value: finalVal,
              paymentMethod: detailsForm.paymentMethod,
            });
          } catch (commErr) {
            console.error("Error generating commission on details update:", commErr);
          }
        }

        alert('Lançamento alterado com sucesso!');
        setIsDetailsModalOpen(false);
      } catch (err: any) {
        console.error("[FINANCE_UPDATE_ERROR]", err);
        handleFirestoreError(err, OperationType.UPDATE, refPath);
      }
    } else {
      const patientBasePath = getPatientPathStr(selectedPatientId);
      const refPath = `${patientBasePath}/financial/${entryId}`;
      console.log("[FINANCE_UPDATE] path:", refPath);

      const updateData: any = {
        description: detailsForm.description,
        value: finalVal,
        grossAmount: Number(detailsForm.grossAmount),
        discount: Number(detailsForm.discount),
        additions: Number(detailsForm.additions),
        method: detailsForm.paymentMethod,
        paymentMethod: detailsForm.paymentMethod,
        category: detailsForm.category,
        subcategory: detailsForm.subcategory,
        professionalName: detailsForm.professionalName,
        status: detailsForm.status === 'pago' ? 'received' : 'pending',
        installments: Number(detailsForm.installments),
        dueDate: detailsForm.dueDate || null,
        paymentDate: detailsForm.status === 'pago' ? detailsForm.paymentDate : null,
        notes: detailsForm.notes,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || null,
        type: detailsForm.type === 'despesa' ? 'expense' : 'income'
      };

      try {
        await updateDoc(doc(db, patientBasePath, 'financial', entryId), updateData);

        // Sync to global clinics/{clinicId}/financial_entries as well!
        try {
          const globalEntryRef = doc(db, 'clinics', clinic.id, 'financial_entries', entryId);
          await updateDoc(globalEntryRef, {
            description: detailsForm.description,
            amount: finalVal,
            value: finalVal,
            payment_method: detailsForm.paymentMethod,
            paymentMethod: detailsForm.paymentMethod,
            category: detailsForm.category,
            subcategory: detailsForm.subcategory,
            professional_name: detailsForm.professionalName,
            professionalName: detailsForm.professionalName,
            status: detailsForm.status === 'pago' ? 'paid' : 'pending',
            paidAmount: detailsForm.status === 'pago' ? finalVal : 0,
            pendingAmount: detailsForm.status === 'pago' ? 0 : finalVal,
            remainingAmount: detailsForm.status === 'pago' ? 0 : finalVal,
            dueDate: detailsForm.dueDate || null,
            paymentDate: detailsForm.status === 'pago' ? detailsForm.paymentDate : null,
            notes: detailsForm.notes,
            updatedAt: serverTimestamp()
          });
        } catch (globalErr) {
          console.log("[FINANCE_UPDATE] Note: global entry not updated:", globalErr);
        }

        if (detailsForm.status === 'pago') {
          try {
            const { generateCommissionsForEntry } = await import('../services/financeService');
            await generateCommissionsForEntry(clinic.id, {
              id: entryId,
              description: detailsForm.description,
              type: detailsForm.type === 'despesa' ? 'expense' : 'income',
              category: detailsForm.category,
              amount: finalVal,
              value: finalVal,
              status: 'paid',
              paymentMethod: detailsForm.paymentMethod,
              procedure_responsible_id: selectedDetailsEntry.raw?.procedure_responsible_id || selectedDetailsEntry.raw?.professionalId || null,
            });
          } catch (commErr) {
            console.error("Error generating commission on manual details update:", commErr);
          }
        }

        // Update corresponding transaction if existing
        const transColl = collection(db, 'clinics', clinic.id, 'transactions');
        const q = query(transColl, where('patientId', '==', selectedPatientId));
        const transSnapshot = await getDocs(q);
        
        const matchDoc = transSnapshot.docs.find(d => {
          const dData = d.data();
          return dData.paymentId === entryId || d.id === entryId;
        });

        if (matchDoc) {
          console.log("[FINANCE_UPDATE] updating linked transaction path:", `clinics/${clinic.id}/transactions/${matchDoc.id}`);
          await updateDoc(doc(db, 'clinics', clinic.id, 'transactions', matchDoc.id), {
            description: `${detailsForm.description} - ${detailsForm.patientName}`,
            amount: finalVal,
            type: detailsForm.type === 'despesa' ? 'expense' : 'income',
            status: detailsForm.status === 'pago' ? 'paid' : 'pending',
            category: detailsForm.category,
            method: detailsForm.paymentMethod,
            paymentMethod: detailsForm.paymentMethod,
            updatedAt: serverTimestamp()
          });
        }

        alert('Lançamento alterado com sucesso!');
        setIsDetailsModalOpen(false);
      } catch (err: any) {
        console.error("[FINANCE_UPDATE_ERROR]", err);
        handleFirestoreError(err, OperationType.UPDATE, refPath);
      }
    }
  };

  const handleCancelPayment = async (entryId: string) => {
    if (!entryId || !clinic) return;
    if (!confirm('Deseja realmente cancelar o lançamento deste pagamento e reabri-lo? O valor pago ficará como pendente.')) return;

    try {
      const entryRef = doc(db, 'clinics', clinic.id, 'financial_entries', entryId);
      const entrySnap = await getDoc(entryRef);
      if (!entrySnap.exists()) {
        alert("Lançamento não encontrado.");
        return;
      }
      const entryData = entrySnap.data();
      const totalVal = Number(entryData.value) || Number(entryData.amount) || 0;

      // Update in global clinics/{id}/financial_entries
      await updateDoc(entryRef, {
        status: 'pending',
        paidAmount: 0,
        paid_amount: 0,
        pendingAmount: totalVal,
        remainingAmount: totalVal,
        remaining_amount: totalVal,
        paidAt: null,
        paymentDate: null,
        payment_date: null,
        paymentMethod: 'não informado',
        payment_method: 'não informado',
        updatedAt: serverTimestamp()
      });

      // Update in patient's local subcollection 'financial' if it exists
      const patientBasePath = getPatientPathStr(selectedPatientId);
      try {
        await updateDoc(doc(db, patientBasePath, 'financial', entryId), {
          status: 'pending',
          paidAmount: 0,
          remainingAmount: totalVal,
          paymentDate: null,
          updatedAt: serverTimestamp()
        });
      } catch (e) {
        // Safe skip if doesn't exist in local subcollection
      }

      // Also look for matching transaction document and update it to pending
      const transColl = collection(db, 'clinics', clinic.id, 'transactions');
      const q = query(transColl, where('patientId', '==', selectedPatientId));
      const transSnapshot = await getDocs(q);
      const matchDoc = transSnapshot.docs.find(d => {
        const dData = d.data();
        return dData.paymentId === entryId || d.id === entryId;
      });

      if (matchDoc) {
        await updateDoc(doc(db, 'clinics', clinic.id, 'transactions', matchDoc.id), {
          status: 'pending',
          amount: totalVal,
          updatedAt: serverTimestamp()
        });
      }

      alert('Pagamento cancelado e lançamento reaberto com sucesso!');
      setIsDetailsModalOpen(false);
    } catch (err: any) {
      console.error("[CANCEL_PAYMENT_ERROR]", err);
      alert('Erro ao cancelar pagamento: ' + err.message);
    }
  };

  const handleDeleteEntry = async () => {
    if (!selectedDetailsEntry || !clinic) return;
    const entryId = selectedDetailsEntry.id;
    
    if (selectedDetailsEntry.isImported) {
      const refPath = `clinics/${clinic.id}/financial_entries/${entryId}`;
      console.log("[FINANCE_DELETE] path:", refPath);
      try {
        await deleteDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entryId));
        alert('Lançamento excluído com sucesso.');
        setIsDetailsModalOpen(false);
      } catch (err: any) {
        console.error("[FINANCE_DELETE_ERROR]", err);
        handleFirestoreError(err, OperationType.DELETE, refPath);
      }
    } else {
      const patientBasePath = getPatientPathStr(selectedPatientId);
      const refPath = `${patientBasePath}/financial/${entryId}`;
      console.log("[FINANCE_DELETE] path:", refPath);
      try {
        await deleteDoc(doc(db, patientBasePath, 'financial', entryId));
        
        // Also look for matching transaction document in clinics/{clinicId}/transactions and delete it
        const transColl = collection(db, 'clinics', clinic.id, 'transactions');
        const q = query(transColl, where('patientId', '==', selectedPatientId));
        const transSnapshot = await getDocs(q);
        
        const matchDoc = transSnapshot.docs.find(d => {
          const dData = d.data();
          return dData.paymentId === entryId || d.id === entryId;
        });

        if (matchDoc) {
          console.log("[FINANCE_DELETE] deleting linked transaction path:", `clinics/${clinic.id}/transactions/${matchDoc.id}`);
          await deleteDoc(doc(db, 'clinics', clinic.id, 'transactions', matchDoc.id));
        }

        alert('Lançamento excluído com sucesso.');
        setIsDetailsModalOpen(false);
      } catch (err: any) {
        console.error("[FINANCE_DELETE_ERROR]", err);
        handleFirestoreError(err, OperationType.DELETE, refPath);
      }
    }
  };

  const handleSaveDocument = async () => {
    if (!selectedPatientId || !documentForm.title || !documentForm.content || !clinic) return;
    const dId = `doc-${Date.now()}`;
    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      await setDoc(doc(db, patientBasePath, 'documents', dId), {
        ...documentForm,
        createdAt: serverTimestamp()
      });
      setIsDocumentModalOpen(false);
      setDocumentForm({ title: '', type: 'receita', content: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/documents/${dId}`);
    }
  };

  const getCompiledPrescriptionText = (templateId: string, formData: typeof prescriptionForm) => {
    console.log('[TEMPL_RECEITUARIO_SELECIONADO]', templateId);
    
    let baseTemplate = clinicTemplates.find(t => t.id === templateId) || DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === templateId);
    if (!baseTemplate) {
      baseTemplate = DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === 'pos_toxina') || DEFAULT_PRESCRIPTION_TEMPLATES[0];
    }

    let content = baseTemplate.content || (baseTemplate as any).defaultContent || '';
    if (!content.trim() && DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === templateId)) {
      content = DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === templateId)?.defaultContent || '';
    }

    const replacements: Record<string, string> = {
      '{{nomePaciente}}': formData.patientName,
      '{{cpfPaciente}}': formData.patientCpf,
      '{{dataNascimento}}': formData.patientBirthDate,
      '{{profissionalResponsavel}}': formData.professionalName,
      '{{nomeClinica}}': clinic?.name || 'ELIZA HOF Clinic',
      '{{dataAtual}}': formData.date
    };

    console.log('[VARIAVEIS_RECEITUARIO]', replacements);

    Object.entries(replacements).forEach(([tag, val]) => {
      content = content.replaceAll(tag, val);
    });

    return content;
  };

  const handleOpenPrescriptionGenerator = (templateId?: string) => {
    console.log('[RECEITUARIO_ABERTO]', { selectedPatientId });
    const patient = patients.find(p => p.id === selectedPatientId);
    const tid = templateId || 'pos_toxina';

    // Find latest appointment and its staff member
    let aptStaffName = '';
    if (patientAppointments && patientAppointments.length > 0) {
      const latestApt = patientAppointments[0];
      const staffMember = staff.find(s => s.id === latestApt.staffId);
      aptStaffName = staffMember?.name || latestApt.professional || '';
    }

    const initialFormData = {
      patientName: patient?.name || '',
      patientCpf: (patient as any)?.cpf || '',
      patientBirthDate: (patient as any)?.birthDate || (patient as any)?.birth_date || '',
      professionalName: aptStaffName || user?.displayName || 'Dr. Clínico Responsável',
      date: new Date().toLocaleDateString('pt-BR'),
      status: 'active' as const,
      templateId: tid,
      recipeType: 'comum' as 'comum' | 'especial'
    };

    setPrescriptionForm(initialFormData);
    setPrescriptionAIAnalysis('');
    
    const preCompiled = getCompiledPrescriptionText(tid, initialFormData);
    setPrescriptionText(preCompiled);
    setIsPrescriptionGeneratorOpen(true);
  };

  const handleAnalyzePrescription = async () => {
    if (!selectedPatientId || !prescriptionText) return;
    setIsAnalyzingPrescription(true);
    setPrescriptionAIAnalysis('');
    
    try {
      const patient = patients.find(p => p.id === selectedPatientId);
      const anamnesisNotes = anamnesis?.content || 'Nenhum registro de alergias ou histórico clínico dermo-funcional cadastrado.';
      
      console.log('[RECEITUARIO_SUGEST_IA] Iniciando análise de segurança clínica...');

      const aiPrompt = `Você é a ELIZA IA, o cérebro clínico de inteligência artificial de suporte e decisão HOF.
Analise a seguinte prescrição médica/odontológica emitida para o paciente ${patient?.name || ''} e confira se há qualquer risco à saúde dele.

PRESCRIÇÃO ATUAL:
"""
${prescriptionText}
"""

ANAMNESE DO PACIENTE (ALERGIAS & HISTÓRICO MÉDICO):
"""
${anamnesisNotes}
"""

INSTRUÇÃO PARA A ANÁLISE CLÍNICA DA ELIZA:
1. Revise se os medicamentos receitados possuem reações cruzadas ou interações prejudiciais entre si.
2. IMPORTANTÍSSIMO: Cruze os fármacos receitados com as ALERGIAS e históricos listados na anamnese do paciente para verificar contraindicações graves.
3. Se o paciente for portador de alguma doença (como hipertensão, diabetes, infecções ativas, herpes recorrente, amamentação ou gravidez) ou uso de imunossupressores, emita os alertas devidos da HOF para a substância prescrita.
4. Caso encontre riscos ou inconformidades, mostre alertas vermelhos claros e visíveis (🚨 ALERTAS DE SEGURANÇA).
5. Caso a prescrição esteja perfeitamente segura levando em consideração a anamnese, dê um parecer verde positivo parabenizando a prudência clínica (✅ PRESCRIÇÃO SEGURA).
6. Explique brevemente o mecanismo de cada alerta ou tranquilize o profissional.

Formate seu retorno em formato elegante estruturado em Markdown para exibição em painel clínico. Mantenha um tom profissional, ético, preciso e acolhedor de apoio à decisão clínica.`;

      const response = await fetch('/api/ai/generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          config: { temperature: 0.3 }
        })
      });

      const resData = await response.json();
      if (response.ok && resData.text) {
        setPrescriptionAIAnalysis(resData.text);
        console.log('[RECEITUARIO_SUGEST_IA] Análise concluída com sucesso!');
      } else {
        throw new Error(resData.error || 'Erro ao consultar ELIZA IA');
      }
    } catch (err: any) {
      console.error('[RECEITUARIO_ERRO]', err);
      setPrescriptionAIAnalysis(`⚠️ **Erro de Análise Clínica:** Não foi possível contactar os servidores da ELIZA IA para o cruzamento farmacológico. Revise a posologia manualmente.`);
    } finally {
      setIsAnalyzingPrescription(false);
    }
  };

  const handleSavePrescription = async () => {
    if (!selectedPatientId || !prescriptionText || !clinic) return;
    const patientBasePath = getPatientPathStr(selectedPatientId);
    const dId = `doc-${Date.now()}`;
    
    try {
      const docData = {
        title: prescriptionForm.templateId 
          ? (clinicTemplates.find(t => t.id === prescriptionForm.templateId)?.name || DEFAULT_PRESCRIPTION_TEMPLATES.find(t => t.id === prescriptionForm.templateId)?.name || 'Receituário Inteligente')
          : 'Receituário Inteligente',
        type: 'receita',
        content: prescriptionText,
        createdAt: serverTimestamp(),
        status: prescriptionForm.status,
        patientDetails: {
          name: prescriptionForm.patientName,
          cpf: prescriptionForm.patientCpf,
          birthDate: prescriptionForm.patientBirthDate
        },
        professionalName: prescriptionForm.professionalName,
        clinicalSafetyAlerts: prescriptionAIAnalysis || null
      };

      await setDoc(doc(db, patientBasePath, 'documents', dId), docData);
      console.log('[RECEITUARIO_SALVO]', { docId: dId, path: `${patientBasePath}/documents/${dId}` });
      alert('Receituário Inteligente salvo com sucesso no prontuário!');
      setIsPrescriptionGeneratorOpen(false);
    } catch (err: any) {
      console.error('[RECEITUARIO_ERRO]', err);
      alert('Erro ao salvar receituário inteligente: ' + err.message);
    }
  };

  const handleSaveAnamnesis = async (data: any) => {
    if (!selectedPatientId || !clinic) return;
    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      await setDoc(doc(db, patientBasePath, 'anamnesis', 'current'), {
        ...data,
        updatedAt: serverTimestamp()
      });
      setIsAnamnesisModalOpen(false);
      alert('Anamnese atualizada com sucesso!');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/anamnesis/current`);
    }
  };

  const handleSaveImage = async (title: string, category: string, customUrl?: string, description?: string) => {
    if (!selectedPatientId || !clinic) return;
    const iId = `img-${Date.now()}`;
    const patientBasePath = getPatientPathStr(selectedPatientId);
    try {
      await setDoc(doc(db, patientBasePath, 'images', iId), {
        title,
        category,
        description: description || '',
        url: customUrl || 'https://images.unsplash.com/photo-1606811841660-1b516b0d9f05?q=80&w=300&auto=format&fit=crop',
        date: serverTimestamp()
      });
      setIsImageModalOpen(false);
      setImageForm({ title: '', category: 'Foto Clínica', description: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/images/${iId}`);
    }
  };

  const handleLocalFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 800000) { // Approx 800KB to be safe with base64 overhead vs 1MB limit
        alert('O arquivo é muito grande. Por favor, utilize imagens menores que 800KB para garantir o armazenamento.');
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const desc = prompt('Deseja adicionar uma descrição para esta imagem?');
        handleSaveImage(file.name, 'Exame/Foto', base64String, desc || '');
      };
      reader.readAsDataURL(file);
    }
  };


  const applyTemplate = (template: any) => {
    if (!template || !selectedPatientId) return;
    const patient = patients.find(p => p.id === selectedPatientId);
    let content = template.content || '';
    
    // Replace tags
    const replacements: Record<string, string> = {
      '{paciente_nome}': patient?.name || '',
      '{paciente_cpf}': (patient as any)?.cpf || '',
      '{data_atual}': new Date().toLocaleDateString('pt-BR'),
      '{clinica_nome}': clinic?.name || '',
      '{clinica_endereco}': (clinic as any)?.address || '',
      '{profissional_nome}': user?.displayName || 'Dr(a). Profissional',
    };

    Object.entries(replacements).forEach(([tag, value]) => {
      content = content.replaceAll(tag, value);
    });

    setDocumentForm({
      ...documentForm,
      title: template.name,
      content: content
    });
  };

  const getCompiledContractText = (templateId: string, formData: typeof contractFormData, quotation: Quotation) => {
    console.log('[MODELO_CONTRATO_SELECIONADO]', templateId);
    
    let baseTemplate = clinicTemplates.find(t => t.id === templateId) || DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === templateId);
    if (!baseTemplate) {
      baseTemplate = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === 'full_face') || DEFAULT_CONTRACT_TEMPLATES[0];
    }

    let content = baseTemplate.content || (baseTemplate as any).defaultContent || '';
    if (!content.trim() && DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === templateId)) {
      content = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === templateId)?.defaultContent || '';
    }

    console.log('[CONTEUDO_MODELO_CARREGADO]', { name: baseTemplate.name, length: content.length });

    // Unify consent clauses
    const consentClauses: string[] = [];
    const lowerProcedures = quotation.items.map(i => i.description.toLowerCase());
    let matchedAny = false;

    DEFAULT_CONTRACT_TEMPLATES.forEach(t => {
      let match = false;
      if (t.id === 'toxina_botulinica' && lowerProcedures.some(p => p.includes('botox') || p.includes('toxina') || p.includes('botul'))) match = true;
      if (t.id === 'acido_hialuronico' && lowerProcedures.some(p => p.includes('preench') || p.includes('labial') || p.includes('ácido') || p.includes('hialur') || p.includes('gel') || p.includes('sulco') || p.includes('mento'))) match = true;
      if (t.id === 'bioestimulador' && lowerProcedures.some(p => p.includes('bioestimula') || p.includes('sculptra') || p.includes('radiesse') || p.includes('colágen') || p.includes('elleva'))) match = true;
      if (t.id === 'fios_pdo' && lowerProcedures.some(p => p.includes('fio') || p.includes('pdo') || p.includes('sustenta'))) match = true;
      if (t.id === 'rinomodelacao' && lowerProcedures.some(p => p.includes('rinomodel') || p.includes('nariz'))) match = true;
      if (t.id === 'lipo_papada' && lowerProcedures.some(p => p.includes('papada') || p.includes('lipo'))) match = true;
      if (t.id === 'full_face' && quotation.items.length > 1) match = true;
      if (t.id === 'odonto_geral' && lowerProcedures.some(p => p.includes('obtura') || p.includes('limpeza') || p.includes('restaura') || p.includes('canal') || p.includes('extra') || p.includes('siso') || p.includes('odonto'))) match = true;
      
      if (match) {
        consentClauses.push(t.consentClause);
        matchedAny = true;
      }
    });

    if (!matchedAny) {
      const parentConsent = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === 'odonto_geral')?.consentClause || '';
      if (parentConsent) consentClauses.push(parentConsent);
    }

    const combinedConsentText = consentClauses.join('\n\n');
    const pNames = quotation.items.map(item => `- ${item.description} (R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`).join('\n');
    const totalValStr = `R$ ${quotation.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const dateStr = new Date().toLocaleDateString('pt-BR');

    const replacements: Record<string, string> = {
      '{{nomePaciente}}': formData.patientName,
      '{{cpfPaciente}}': formData.patientCpf,
      '{{telefonePaciente}}': formData.patientPhone,
      '{{dataNascimento}}': formData.patientBirthDate,
      '{{procedimentosAprovados}}': pNames,
      '{{valorTotal}}': totalValStr,
      '{{formaPagamento}}': formData.paymentMethod,
      '{{profissionalResponsavel}}': formData.professionalName,
      '{{croProfissional}}': formData.professionalCro,
      '{{nomeClinica}}': formData.clinicName,
      '{{cnpjClinica}}': formData.clinicCnpj,
      '{{dataAtual}}': dateStr,
      '{{consentimentoProcedimentos}}': combinedConsentText
    };

    console.log('[VARIAVEIS_CONTRATO]', replacements);

    Object.entries(replacements).forEach(([tag, val]) => {
      content = content.replaceAll(tag, val);
    });

    console.log('[CONTRATO_COMPILADO]', { length: content.length });
    return content;
  };

  const handleOpenContractGenerator = (q: Quotation) => {
    console.log('[CONTRATO_MODAL_ABERTO]', { quotationId: q.id, patientId: selectedPatientId });
    setSelectedQuotationForContract(q);
    const patient = patients.find(p => p.id === selectedPatientId);
    
    // Find latest appointment and its staff member
    let aptStaffName = '';
    if (patientAppointments && patientAppointments.length > 0) {
      const latestApt = patientAppointments[0];
      const staffMember = staff.find(s => s.id === latestApt.staffId);
      aptStaffName = staffMember?.name || latestApt.professional || '';
    }

    // Auto-detect a suitable template based on approved procedures
    const lowerProcedures = q.items.map(item => item.description.toLowerCase());
    let templateId = 'toxina_botulinica'; // Default
    if (lowerProcedures.some(p => p.includes('botox') || p.includes('toxina') || p.includes('botul'))) templateId = 'toxina_botulinica';
    else if (lowerProcedures.some(p => p.includes('preench') || p.includes('labial') || p.includes('ácido') || p.includes('hialur') || p.includes('gel'))) templateId = 'acido_hialuronico';
    else if (lowerProcedures.some(p => p.includes('bioestimula') || p.includes('sculptra') || p.includes('radiesse') || p.includes('colágen') || p.includes('elleva'))) templateId = 'bioestimulador';
    else if (lowerProcedures.some(p => p.includes('fio') || p.includes('pdo'))) templateId = 'fios_pdo';
    else if (lowerProcedures.some(p => p.includes('rinomodel') || p.includes('nariz'))) templateId = 'rinomodelacao';
    else if (lowerProcedures.some(p => p.includes('papada') || p.includes('lipo'))) templateId = 'lipo_papada';
    else if (q.items.length > 1) templateId = 'full_face';
    else if (lowerProcedures.some(p => p.includes('obtura') || p.includes('limpeza') || p.includes('restaura') || p.includes('canal') || p.includes('extra') || p.includes('odonto'))) templateId = 'odonto_geral';

    const initialFormData = {
      patientName: patient?.name || '',
      patientCpf: (patient as any)?.cpf || '',
      patientRg: (patient as any)?.rg || '',
      patientBirthDate: (patient as any)?.birthDate || (patient as any)?.birth_date || '',
      patientPhone: patient?.phone || '',
      patientAddress: (patient as any)?.address || '',
      clinicName: clinic?.name || 'ELIZA HOF Clinic',
      clinicCnpj: (clinic as any)?.cnpj || '45.678.901/0001-23',
      professionalName: aptStaffName || user?.displayName || 'Dr. Clínico Responsável',
      professionalCro: (clinic as any)?.croProfessional || (clinic as any)?.responsibleProfessionalCro || '',
      paymentMethod: 'Pix / Dinheiro com 10% de desconto',
      templateId: templateId
    };

    setContractFormData(initialFormData);
    
    // Auto compile immediately on open
    const preCompiled = getCompiledContractText(templateId, initialFormData, q);
    setContractText(preCompiled);
    setContractUseAI(false); // Default to variables draft and allow toggle to AI
    setIsContractGeneratorOpen(true);
  };

  const handleCompileContract = async (useAI = false) => {
    if (!selectedPatientId || !selectedQuotationForContract) return;
    const patient = patients.find(p => p.id === selectedPatientId);
    if (!patient) return;

    setIsCompilingContract(true);
    try {
      if (useAI) {
        console.log("[ELIZA_IA] Gerando contrato combinado inteligente...");
        const pNames = selectedQuotationForContract.items.map(item => `- ${item.description} (R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`).join('\n');
        const totalValStr = `R$ ${selectedQuotationForContract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        const dateStr = new Date().toLocaleDateString('pt-BR');
        
        // Unify consent clauses
        const consentClauses: string[] = [];
        const lowerProcedures = selectedQuotationForContract.items.map(i => i.description.toLowerCase());
        let matchedAny = false;

        DEFAULT_CONTRACT_TEMPLATES.forEach(t => {
          let match = false;
          if (t.id === 'toxina_botulinica' && lowerProcedures.some(p => p.includes('botox') || p.includes('toxina') || p.includes('botul'))) match = true;
          if (t.id === 'acido_hialuronico' && lowerProcedures.some(p => p.includes('preench') || p.includes('labial') || p.includes('ácido') || p.includes('hialur') || p.includes('gel') || p.includes('sulco') || p.includes('mento'))) match = true;
          if (t.id === 'bioestimulador' && lowerProcedures.some(p => p.includes('bioestimula') || p.includes('sculptra') || p.includes('radiesse') || p.includes('colágen') || p.includes('elleva'))) match = true;
          if (t.id === 'fios_pdo' && lowerProcedures.some(p => p.includes('fio') || p.includes('pdo') || p.includes('sustenta'))) match = true;
          if (t.id === 'rinomodelacao' && lowerProcedures.some(p => p.includes('rinomodel') || p.includes('nariz'))) match = true;
          if (t.id === 'lipo_papada' && lowerProcedures.some(p => p.includes('papada') || p.includes('lipo'))) match = true;
          if (t.id === 'full_face' && selectedQuotationForContract.items.length > 1) match = true;
          if (t.id === 'odonto_geral' && lowerProcedures.some(p => p.includes('obtura') || p.includes('limpeza') || p.includes('restaura') || p.includes('canal') || p.includes('extra') || p.includes('siso') || p.includes('odonto'))) match = true;
          
          if (match) {
            consentClauses.push(t.consentClause);
            matchedAny = true;
          }
        });

        if (!matchedAny) {
          const parentConsent = DEFAULT_CONTRACT_TEMPLATES.find(t => t.id === 'odonto_geral')?.consentClause || '';
          if (parentConsent) consentClauses.push(parentConsent);
        }

        const combinedConsentText = consentClauses.join('\n\n');

        const aiPrompt = `Gere um contrato e termo de consentimento livre e esclarecido (TCLE) profissional em português brasileiro para o(a) paciente ${contractFormData.patientName}.
Gere um texto elegante e completo, com todos os termos jurídicos e técnicos adequados para os procedimentos acordados.

Informações recebidas:
- Nome do Paciente: ${contractFormData.patientName}
- CPF do Paciente: ${contractFormData.patientCpf}
- RG do Paciente: ${contractFormData.patientRg}
- Data de Nascimento: ${contractFormData.patientBirthDate}
- Telefone: ${contractFormData.patientPhone}
- Endereço: ${contractFormData.patientAddress}
- Clínica: ${contractFormData.clinicName}
- CNPJ da Clínica: ${contractFormData.clinicCnpj}
- Profissional Responsável: ${contractFormData.professionalName}
- CRO do Profissional: ${contractFormData.professionalCro}
- Procedimentos Aprovados:
${pNames}
- Valor Total: ${totalValStr}
- Forma de Pagamento: ${contractFormData.paymentMethod}
- Data de Aceite: ${dateStr}

Selecione e unifique cláusulas de consentimento técnico apropriadas com base nestas bases pré-aprovadas:
${combinedConsentText}

O documento gerado DEVE cobrir rigorosamente as seguintes seções estruturais:
A) Identificação das partes
B) Objeto do contrato
C) Plano de tratamento aprovado
D) Descrição técnica simplificada dos procedimentos e Termo de Consentimento
E) Declaração de alternativas terapêuticas explicadas
F) Declaração de oportunidade de sanar dúvidas
G) Riscos possíveis, intercorrências e limitações do tratamento
H) Cuidados pré e pós-procedimento
I) Condições financeiras detalhadas
J) Política de retorno, revisão e manutenção (15-21 dias para retoque)
K) Termo de Consentimento Livre e Esclarecido
L) Campo de assinatura do paciente (Nome)
M) Campo de assinatura do profissional (Nome, CRO)

Retorne APENAS o contrato formatado em markdown estrito. Não insira considerações ou observações adicionais fora do contrato.`;

        const response = await fetch('/api/ai/generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: aiPrompt,
            config: { temperature: 0.2 }
          })
        });

        const resData = await response.json();
        if (response.ok && resData.text) {
          setContractText(resData.text);
          console.log('[CONTRATO_COMPILADO]', { useAI: true, length: resData.text.length });
        } else {
          throw new Error(resData.error || 'Erro ao consultar ELIZA IA');
        }
      } else {
        const text = getCompiledContractText(contractFormData.templateId, contractFormData, selectedQuotationForContract);
        setContractText(text);
      }
    } catch (err: any) {
      console.error('[CONTRATO_ERRO]', err);
      alert('Falha clínica de compilação: ' + err.message + '. Usando compilação de fallback por variáveis.');
      const fallback = getCompiledContractText(contractFormData.templateId, contractFormData, selectedQuotationForContract);
      setContractText(fallback);
    } finally {
      setIsCompilingContract(false);
    }
  };

  const handleSaveGeneratedContract = async (status: 'draft' | 'generated' | 'sent' | 'signed' | 'cancelled') => {
    if (!selectedPatientId || !selectedQuotationForContract || !clinic) return;
    const isLegacy = patientData?.id === selectedPatientId ? patientData._isLegacy : patients.find(p => p.id === selectedPatientId)?._isLegacy;
    const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
    
    try {
      const docData = {
        title: `Contrato de Tratamento HOF - Plano #${selectedQuotationForContract.id.slice(-5)}`,
        type: 'contrato',
        content: contractText,
        createdAt: serverTimestamp(),
        status: status,
        quoteId: selectedQuotationForContract.id,
        quoteTitle: selectedQuotationForContract.title,
        patientDetails: {
          name: contractFormData.patientName,
          cpf: contractFormData.patientCpf,
          rg: contractFormData.patientRg,
          phone: contractFormData.patientPhone,
          birthDate: contractFormData.patientBirthDate,
          address: contractFormData.patientAddress
        },
        clinicDetails: {
          name: contractFormData.clinicName,
          cnpj: contractFormData.clinicCnpj,
          professionalName: contractFormData.professionalName,
          professionalCro: contractFormData.professionalCro
        },
        paymentMethod: contractFormData.paymentMethod,
        totalValue: selectedQuotationForContract.totalValue
      };

      const docRef = await addDoc(collection(db, patientBasePath, 'documents'), docData);
      console.log('[CONTRATO_SALVO]', { docId: docRef.id, status, path: `${patientBasePath}/documents` });
      alert(`Contrato salvo como '${status.toUpperCase()}' no prontuário do paciente!`);
      setIsContractGeneratorOpen(false);
    } catch (err: any) {
      console.error('[CONTRATO_ERRO]', err);
      alert('Erro ao salvar contrato: ' + err.message);
    }
  };

  const handleUpdateContractStatus = async (contractId: string, newStatus: string) => {
    if (!selectedPatientId || !clinic) return;
    const isLegacy = patientData?.id === selectedPatientId ? patientData._isLegacy : patients.find(p => p.id === selectedPatientId)?._isLegacy;
    const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
    try {
      await updateDoc(doc(db, patientBasePath, 'documents', contractId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      alert(`Status do contrato atualizado com sucesso!`);
    } catch (err: any) {
      console.error(err);
      alert('Erro ao atualizar status: ' + err.message);
    }
  };

  const handleUploadSignedContract = async (contractId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedPatientId || !clinic || !event.target.files?.[0]) return;
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      const isLegacy = patientData?.id === selectedPatientId ? patientData._isLegacy : patients.find(p => p.id === selectedPatientId)?._isLegacy;
      const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
      try {
        await updateDoc(doc(db, patientBasePath, 'documents', contractId), {
          pdfUrl: base64Data, // Aligned with browser preview download
          status: 'signed',
          signedAt: serverTimestamp()
        });
        alert('Contrato assinado anexado e arquivado.');
      } catch (err: any) {
        console.error(err);
        alert('Erro ao anexar arquivo assinado: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePrintClinicalDocument = (
    text: string, 
    titleStr: string, 
    type: 'receita' | 'atestado' | 'contrato' | 'laudo',
    customPatient?: { name?: string; cpf?: string; birthDate?: string }
  ) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // Fetch latest clinic branding properties from context state
    const prColor = clinic?.primaryColor || '#0f172a';
    const scColor = clinic?.secondaryColor || '#0d9488';
    const fontPref = clinic?.fontPreference || 'Inter';
    const logoImg = clinic?.logoBase64 || '';
    const docHeaderName = clinic?.documentName || clinic?.name || 'Clínica de Harmonização e Estética';
    const instFooter = clinic?.privacyPolicyText || clinic?.institutionalFooter || '';
    const textSig = clinic?.textSignature || '';
    const clinAddress = clinic?.address || '';
    const clinPhone = clinic?.phone || '';
    const clinWhatsapp = clinic?.whatsapp || '';
    const clinEmail = clinic?.email || '';
    
    // Check if the recipe is a Special Control Recipe (Receita de Controle Especial)
    const formRecipeType = (prescriptionForm as any).recipeType || 'comum';
    const isEspecial = type === 'receita' && (formRecipeType === 'especial' || titleStr.toLowerCase().includes('especial') || text.toLowerCase().includes('controle especial'));

    // Format font face from google API based on fontPreferential chosen
    const fontFacesMap: Record<string, string> = {
      'Inter': "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;950&display=swap');",
      'Space Grotesk': "@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');",
      'Playfair Display': "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap');",
      'Fira Code': "@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;550;700&display=swap');",
    };
    const chosenImport = fontFacesMap[fontPref] || fontFacesMap['Inter'];

    // Map system-ui font stack
    const fontStackMap: Record<string, string> = {
      'Inter': "'Inter', sans-serif",
      'Space Grotesk': "'Space Grotesk', sans-serif",
      'Playfair Display': "'Playfair Display', serif",
      'Fira Code': "'Fira Code', monospace",
    };
    const chosenStack = fontStackMap[fontPref] || "system-ui, sans-serif";

    // Setup visual header logo element
    const logoBlock = logoImg 
      ? `<img src="${logoImg}" alt="Logo" class="clinic-logo" />` 
      : `<div class="clinic-placeholder-logo">
           <svg viewBox="0 0 24 24" width="28" height="28" stroke="${scColor}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
             <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
             <path d="M2 17l10 5 10-5"></path>
             <path d="M2 12l10 5 10-5"></path>
           </svg>
           <span class="placeholder-text" style="color: ${prColor};">ELIZA</span>
         </div>`;

    const patientNameVal = customPatient?.name || prescriptionForm.patientName || '';
    const patientCpfVal = customPatient?.cpf || prescriptionForm.patientCpf || '';
    const patientBirthVal = customPatient?.birthDate || prescriptionForm.patientBirthDate || '';

    let patientBox = '';
    if (patientNameVal) {
      patientBox = `
        <div class="patient-card">
          <div class="patient-field-col">
            <span class="field-title">Paciente</span>
            <span class="field-value">${patientNameVal}</span>
          </div>
          ${patientCpfVal ? `
          <div class="patient-field-col col-border">
            <span class="field-title">CPF</span>
            <span class="field-value">${patientCpfVal}</span>
          </div>
          ` : ''}
          ${patientBirthVal ? `
          <div class="patient-field-col col-border">
            <span class="field-title">Nascimento</span>
            <span class="field-value">${patientBirthVal}</span>
          </div>
          ` : ''}
        </div>
      `;
    }

    const documentTitleMap = {
      'receita': isEspecial ? 'RECEITA DE CONTROLE ESPECIAL' : 'RECEITUÁRIO CLÍNICO',
      'atestado': 'ATESTADO CLÍNICO',
      'contrato': 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
      'laudo': 'LAUDO CLÍNICO'
    };
    const displayDocTitle = documentTitleMap[type] || 'DOCUMENTO CLÍNICO';

    // Prepare complete HTML content based on whether it is a Special Control Recipe (Dual copy side-by-side)
    let printHTML = '';

    if (isEspecial) {
      // Special Control Recipe: 2 columns, side-by-side, forced 1 page, portrait layout
      printHTML = `
      <html>
        <head>
          <title>${titleStr}</title>
          <style>
            ${chosenImport}
            
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { 
              font-family: ${chosenStack}; 
              padding: 20px; 
              color: #1e293b; 
              background-color: #ffffff;
              width: 100%;
              max-width: 1080px;
              margin: 0 auto;
            }
            
            .special-capsule {
              display: flex;
              flex-direction: row;
              justify-content: space-between;
              align-items: stretch;
              width: 100%;
              gap: 24px;
            }
            
            .special-col {
              width: 49%;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              border: 1px solid #cbd5e1;
              border-radius: 14px;
              padding: 16px;
              background-color: #ffffff;
              position: relative;
              overflow: hidden;
            }
            
            .inner-divider {
              width: 1px;
              border-left: 2px dashed #94a3b8;
              align-self: stretch;
              margin: 0;
            }
            
            .col-watermark {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-45deg);
              font-size: 24px;
              font-weight: 950;
              color: rgba(226, 232, 240, 0.45);
              text-transform: uppercase;
              letter-spacing: 0.15em;
              pointer-events: none;
              white-space: nowrap;
              z-index: 1;
            }
            
            /* High-End Compact Header */
            header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 2px solid ${prColor};
              padding-bottom: 10px;
              margin-bottom: 15px;
              z-index: 2;
            }
            
            .header-info-side {
              text-align: right;
            }
            
            .clinic-logo {
              max-height: 48px;
              max-width: 140px;
              object-fit: contain;
            }
            
            .clinic-placeholder-logo {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            
            .placeholder-text {
              font-size: 14px;
              font-weight: 950;
              letter-spacing: 0.05em;
            }
            
            .clinic-header-name {
              font-weight: 900;
              font-size: 13px;
              color: ${prColor};
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 2px;
            }
            
            .clinic-header-subtitle {
              font-size: 9px;
              font-weight: 800;
              color: ${scColor};
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            
            .doc-heading {
              text-align: center;
              font-size: 12px;
              font-weight: 950;
              color: ${prColor};
              letter-spacing: 0.08em;
              text-transform: uppercase;
              margin: 10px 0;
              background-color: #f1f5f9;
              padding: 4px;
              border-radius: 6px;
              z-index: 2;
            }
            
            /* Patient Identification block */
            .patient-card {
              display: flex;
              gap: 12px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 10px 12px;
              margin-bottom: 15px;
              z-index: 2;
            }
            
            .patient-field-col {
              display: flex;
              flex-direction: column;
            }
            
            .col-border {
              border-left: 1px solid #cbd5e1;
              padding-left: 12px;
            }
            
            .field-title {
              font-size: 7.5px;
              font-weight: 900;
              color: #94a3b8;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 2px;
            }
            
            .field-value {
              font-size: 10px;
              font-weight: 800;
              color: #0f172a;
            }
            
            /* Content text */
            .document-main-body {
              text-align: justify;
              font-size: 11px;
              color: #334155;
              min-height: 180px;
              flex-grow: 1;
              white-space: pre-wrap;
              margin-bottom: 15px;
              z-index: 2;
              line-height: 1.45;
            }
            
            .regulatory-fields {
              margin-top: 10px;
              border-top: 1px solid #cbd5e1;
              padding-top: 8px;
              z-index: 2;
            }
            
            .reg-section {
              margin-bottom: 6px;
            }
            
            .reg-title {
              font-size: 8px;
              font-weight: 950;
              color: #475569;
              margin-bottom: 2px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            
            .reg-grid {
              font-size: 8px;
              color: #1e293b;
              line-height: 1.35;
            }
            
            /* Signature lock */
            .signature-wrapper {
              margin-top: 12px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              z-index: 2;
            }
            
            .signature-line {
              width: 180px;
              height: 1px;
              background-color: #94a3b8;
              margin-bottom: 6px;
            }
            
            .prof-name {
              font-size: 10.5px;
              font-weight: 800;
              color: #0f172a;
            }
            
            .prof-subtitle {
              font-size: 8px;
              color: #64748b;
              font-weight: 700;
              text-transform: uppercase;
              margin-top: 1px;
            }
            
            footer {
              margin-top: 12px;
              border-top: 1px solid #cbd5e1;
              padding-top: 8px;
              text-align: center;
              font-size: 7.5px;
              color: #64748b;
              font-weight: 600;
              z-index: 2;
            }
            
            .contact-row {
              margin-top: 2px;
              font-weight: 500;
            }
            
            @media print {
              @page {
                size: A4 portrait;
                margin: 5mm;
              }
              html, body {
                height: 98%;
                overflow: hidden;
              }
              body { 
                padding: 5px; 
              }
              .special-col {
                border: 1px solid #000 !important;
              }
              .inner-divider {
                border-left-color: #000 !important;
              }
            }
          </style>
        </head>
        <body class="special-body">
          <div class="special-capsule">
            
            <!-- 1ª VIA: RETENÇÃO DA FARMÁCIA -->
            <div class="special-col">
              <div class="col-watermark">1ª Via - Retenção Farmácia</div>
              
              <header>
                ${logoBlock}
                <div class="header-info-side">
                  <h2 class="clinic-header-name">${docHeaderName}</h2>
                  <div class="clinic-header-subtitle">Controle Especial</div>
                </div>
              </header>
              
              <h1 class="doc-heading">1ª Via - Retenção da Farmácia</h1>
              
              ${patientBox}
              
              <div class="document-main-body">${text}</div>
              
              <div class="regulatory-fields">
                <div class="reg-section">
                  <div class="reg-title">Identificação do Comprador</div>
                  <div class="reg-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                    <div style="grid-column: span 2;">Nome: _________________________________________________</div>
                    <div>RG: _________________________</div>
                    <div>O.E.: _______________________</div>
                    <div>CPF: ______________________</div>
                    <div>Tel: ________________________</div>
                    <div style="grid-column: span 2;">Endereço: ______________________________________________</div>
                  </div>
                </div>
                
                <div class="reg-section" style="margin-top: 8px; border-top: 1.5px dotted #94a3b8; padding-top: 6px;">
                  <div class="reg-title">Identificação do Fornecedor</div>
                  <div class="reg-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                    <div style="grid-column: span 2;">Assinatura do Farmacêutico: _________________________________</div>
                    <div>Data: ____/____/________</div>
                    <div>Quantidade: _______________</div>
                  </div>
                </div>
              </div>
              
              <div class="signature-wrapper">
                <div class="signature-line"></div>
                <div class="prof-name">${prescriptionForm.professionalName || textSig || user?.displayName || 'Dr(a). Responsável'}</div>
                <div class="prof-subtitle">${clinic?.technicalDirectorCouncilNumber || 'Cirurgião Dentista / Biomédico'}</div>
              </div>
              
              <footer>
                <div>${instFooter || clinic?.companyName || clinic?.name || 'Clínica Registrada ELIZA'}</div>
                <div class="contact-row">
                  ${clinAddress ? clinAddress : ''} 
                  ${clinPhone ? ' | Tel: ' + clinPhone : ''}
                </div>
              </footer>
            </div>
            
            <!-- CENTRAL CUTTING GUIDE LINE -->
            <div class="inner-divider"></div>
            
            <!-- 2ª VIA: ORIENTAÇÃO DO PACIENTE -->
            <div class="special-col">
              <div class="col-watermark">2ª Via - Paciente</div>
              
              <header>
                ${logoBlock}
                <div class="header-info-side">
                  <h2 class="clinic-header-name">${docHeaderName}</h2>
                  <div class="clinic-header-subtitle">Orientação Doc</div>
                </div>
              </header>
              
              <h1 class="doc-heading">2ª Via - Documento do Paciente</h1>
              
              ${patientBox}
              
              <div class="document-main-body">${text}</div>
              
              <div class="regulatory-fields">
                <div class="reg-section">
                  <div class="reg-title" style="color: ${scColor}; font-weight: 950;">Instruções ao Paciente</div>
                  <div class="reg-grid" style="color: #475569; font-size: 8.5px; line-height: 1.45;">
                    ${clinic?.defaultObservationText || 'Por favor, siga estritamente todas as orientações fornecidas pelo profissional de saúde. Não suspenda a aplicação de pomadas ou o uso de medicação oral sem prévia autorização clínico-odontológica.'}
                  </div>
                </div>
              </div>
              
              <div class="signature-wrapper" style="margin-top: 25px;">
                <div class="signature-line"></div>
                <div class="prof-name">${prescriptionForm.professionalName || textSig || user?.displayName || 'Dr(a). Responsável'}</div>
                <div class="prof-subtitle">${clinic?.technicalDirectorCouncilNumber || 'Cirurgião Dentista / Biomédico'}</div>
              </div>
              
              <footer>
                <div>${instFooter || clinic?.companyName || clinic?.name || 'Clínica Registrada ELIZA'}</div>
                <div class="contact-row">
                  ${clinAddress ? clinAddress : ''} 
                  ${clinPhone ? ' | Tel: ' + clinPhone : ''}
                </div>
              </footer>
            </div>
            
          </div>
          
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
      `;
    } else {
      // Common Recipe, Atestado, Contract or Laudo: Single column, focused on fitting 1 single sheet where possible
      const isComumReceita = type === 'receita';
      const isContractType = type === 'contrato';

      printHTML = `
      <html>
        <head>
          <title>${titleStr}</title>
          <style>
            ${chosenImport}
            
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { 
              font-family: ${chosenStack}; 
              padding: ${isContractType ? '40px' : '30px 45px'}; 
              color: #0f172a; 
              line-height: ${isContractType ? '1.6' : '1.55'}; 
              max-width: 800px; 
              margin: 0 auto; 
              background-color: #ffffff;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              min-height: ${isContractType ? 'auto' : '94vh'};
            }
            
            /* High-End Clinic Header */
            header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              border-bottom: 2.5px solid ${prColor};
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            
            .header-info-side {
              text-align: right;
            }
            
            .clinic-logo {
              max-height: 65px;
              max-width: 170px;
              object-fit: contain;
            }
            
            .clinic-placeholder-logo {
              display: flex;
              align-items: center;
              gap: 10px;
              background-color: #f8fafc;
              padding: 6px 12px;
              border-radius: 8px;
              border: 1px solid #cbd5e1;
            }
            
            .placeholder-text {
              font-size: 15px;
              font-weight: 900;
              letter-spacing: 0.05em;
              text-transform: uppercase;
            }
            
            .clinic-header-name {
              font-weight: 950;
              font-size: 16px;
              color: ${prColor};
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 4px;
            }
            
            .clinic-header-subtitle {
              font-size: 10px;
              font-weight: 800;
              color: ${scColor};
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            
            /* Document Info */
            .doc-heading {
              text-align: center;
              font-size: 16px;
              font-weight: 950;
              color: ${prColor};
              letter-spacing: 0.1em;
              text-transform: uppercase;
              margin: ${isContractType ? '15px 0 25px 0' : '22px 0'};
              border-bottom: ${isContractType ? 'none' : '1px solid #cbd5e1'};
              padding-bottom: ${isContractType ? '0px' : '10px'};
            }
            
            /* Patient Identification block */
            .patient-card {
              display: flex;
              gap: 20px;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 12px 18px;
              margin-bottom: ${isContractType ? '25px' : '30px'};
            }
            
            .patient-field-col {
              display: flex;
              flex-direction: column;
            }
            
            .col-border {
              border-left: 1px solid #cbd5e1;
              padding-left: 20px;
            }
            
            .field-title {
              font-size: 8px;
              font-weight: 900;
              color: #94a3b8;
              text-transform: uppercase;
              letter-spacing: 0.1em;
              margin-bottom: 3px;
            }
            
            .field-value {
              font-size: 11.5px;
              font-weight: 800;
              color: #0f172a;
            }
            
            /* Content text */
            .document-main-body {
              text-align: justify;
              font-size: 13.5px;
              color: #1e293b;
              flex-grow: 1;
              min-height: ${isContractType ? 'auto' : '280px'};
              white-space: pre-wrap;
              margin-bottom: 30px;
              line-height: 1.6;
            }
            
            ${isContractType ? `
            .document-main-body p {
              margin-bottom: 15px;
            }
            .document-main-body h2 {
              font-size: 14px;
              font-weight: 900;
              color: ${prColor};
              margin-top: 20px;
              margin-bottom: 10px;
              text-transform: uppercase;
            }
            ` : ''}
            
            /* Observations box if receita */
            .observations-container {
              background-color: #f0fdfa;
              border-left: 4.5px solid ${scColor};
              padding: 12px 18px;
              border-radius: 0 10px 10px 0;
              font-size: 10.5px;
              color: #0f766e;
              font-weight: 600;
              margin-bottom: 30px;
            }
            
            .observations-header {
              font-size: 8.5px;
              font-weight: 950;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              margin-bottom: 4px;
              color: ${scColor};
            }
            
            /* Signature lock */
            .signature-wrapper {
              margin-top: ${isContractType ? '50px' : '35px'};
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
            }
            
            .signature-line {
              width: 220px;
              height: 1.5px;
              background-color: #94a3b8;
              margin-bottom: 8px;
            }
            
            .prof-name {
              font-size: 12.5px;
              font-weight: 800;
              color: #0f172a;
            }
            
            .prof-subtitle {
              font-size: 9px;
              color: #64748b;
              font-weight: 700;
              text-transform: uppercase;
              margin-top: 2px;
            }
            
            /* double signature for contracts */
            .contract-signatures {
              display: flex;
              justify-content: space-between;
              margin-top: 50px;
              gap: 40px;
            }
            
            .contract-sig {
              flex: 1;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
            }
            
            /* Corporate Footer */
            footer {
              margin-top: 35px;
              border-top: 1px solid #cbd5e1;
              padding-top: 14px;
              text-align: center;
              font-size: 8.5px;
              color: #64748b;
              font-weight: 600;
              line-height: 1.5;
            }
            
            .contact-row {
              margin-top: 3px;
              font-weight: 500;
            }
            
            @media print {
              @page {
                size: A4 portrait;
                margin: 10mm;
              }
              ${!isContractType ? `
              html, body {
                height: 98%;
                overflow: hidden;
              }
              body {
                padding: 10px;
                min-height: 98vh;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
              }
              .document-main-body {
                min-height: 220px;
              }
              ` : `
              body {
                padding: 0;
              }
              `}
              .patient-card {
                background-color: transparent !important;
                border: 1px solid #cbd5e1 !important;
              }
              .observations-container {
                background-color: #fafafa !important;
                border-left-color: #000 !important;
                color: #333 !important;
              }
            }
          </style>
        </head>
        <body>
          <div>
            <header>
              ${logoBlock}
              <div class="header-info-side">
                <h2 class="clinic-header-name">${docHeaderName}</h2>
                <div class="clinic-header-subtitle">Estética Avançada & Harmonização</div>
              </div>
            </header>
            
            <h1 class="doc-heading">${displayDocTitle}</h1>
            
            ${patientBox}
            
            <div class="document-main-body">${text}</div>
            
            ${isComumReceita && (clinic?.defaultObservationText || clinic?.termsAccepted) ? `
              <div class="observations-container">
                <div class="observations-header">Instruções de Segurança e Cuidados</div>
                <div>${clinic?.defaultObservationText || 'Siga as orientações informadas acima.'}</div>
              </div>
            ` : ''}
          </div>
          
          <div>
            ${isContractType ? `
              <div class="contract-signatures">
                <div class="contract-sig">
                  <div class="signature-line" style="width: 100%;"></div>
                  <div class="prof-name" style="font-size: 11px;">CONTRATADA: ${docHeaderName}</div>
                  <div class="prof-subtitle" style="font-size: 8px;">CNPJ: ${clinic?.cnpj || 'Clínica Responsável'}</div>
                </div>
                <div class="contract-sig">
                  <div class="signature-line" style="width: 100%;"></div>
                  <div class="prof-name" style="font-size: 11px;">CONTRATANTE: ${patientNameVal}</div>
                  <div class="prof-subtitle" style="font-size: 8px;">CPF: ${patientCpfVal || 'Paciente'}</div>
                </div>
              </div>
            ` : `
              <div class="signature-wrapper">
                <div class="signature-line"></div>
                <div class="prof-name">${prescriptionForm.professionalName || textSig || user?.displayName || 'Dr(a). Responsável'}</div>
                <div class="prof-subtitle">${clinic?.technicalDirectorCouncilNumber || 'Cirurgião Dentista / Biomédico'}</div>
              </div>
            `}
            
            <footer>
              <div>${instFooter || clinic?.companyName || clinic?.name || 'Clínica Registrada ELIZA'}</div>
              <div class="contact-row">
                ${clinAddress ? clinAddress : ''} 
                ${clinPhone ? ' | Tel: ' + clinPhone : ''} 
                ${clinWhatsapp ? ' | WhatsApp: ' + clinWhatsapp : ''} 
                ${clinEmail ? ' | E-mail: ' + clinEmail : ''}
              </div>
            </footer>
          </div>
          
          <script>
            window.onload = function() { window.print(); };
          </script>
        </body>
      </html>
      `;
    }

    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  const handlePrintSpecificContract = (text: string, titleStr: string) => {
    handlePrintClinicalDocument(text, titleStr, 'contrato');
  };

  // Approval of a quotation and moving to treatments and financial in Firestore
  const approveQuotation = async (qId: string) => {
    if (!selectedPatientId || !clinic) return;
    const q = quotations.find(item => item.id === qId);
    if (!q) return;

    const totalValue = q.totalValue || 0;
    const installments = (q as any).installments || 1;
    const installmentValue = totalValue / installments;

    const patientBasePath = getPatientPathStr(selectedPatientId);

    try {
      // 1. Update quotation status in Firestore
      const qRef = doc(db, patientBasePath, 'quotations', qId);
      await updateDoc(qRef, { status: 'approved' });

      // 2. Create treatment from approved items
      for (const [idx, item] of q.items.entries()) {
        const tId = `t-${qId}-${idx}`;
        const tRef = doc(db, patientBasePath, 'treatments', tId);
        await setDoc(tRef, {
          quotationId: qId,
          description: item.description,
          amount: item.value || 0,
          professional: (q as any).responsible || 'Dr. Portella',
          professionalId: (q as any).responsibleId || null,
          status: 'active',
          evolutions: [{ text: 'Tratamento iniciado a partir de orçamento aprovado.', date: new Date().toISOString() }]
        });
      }

      // 3. Create financial records (installments)
      const patient = patients.find(p => p.id === selectedPatientId);
      for (let i = 1; i <= installments; i++) {
        const pId = `pay-${qId}-${i}`;
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + (i - 1));

        const rawPaymentMethod = (q as any).paymentMethod;
        const paymentMethodValue = (rawPaymentMethod && rawPaymentMethod !== 'SISTEMA') ? rawPaymentMethod : 'não informado';

        const financialData = {
          description: `Parcela ${i}/${installments} - ${q.title}`,
          value: installmentValue,
          method: paymentMethodValue,
          paymentMethod: paymentMethodValue,
          payment_method: paymentMethodValue,
          status: 'pending',
          date: dueDate.toISOString(),
          dueDate: dueDate.toISOString(),
          due_date: dueDate.toISOString(),
          quotationId: qId,
          installmentNumber: i,
          totalInstallments: installments
        };

        // Patient specific financial (keep for backward compatibility)
        await setDoc(doc(db, patientBasePath, 'financial', pId), financialData);

        // Required Logs from step 12:
        const duplicateKey = `${qId}-${i}-${selectedPatientId}`;
        console.log("[QUOTE_FINANCE_CREATE] quotationId:", qId);
        console.log("[QUOTE_FINANCE_CREATE] checking duplicate key:", duplicateKey);

        const checkQuery = query(
          collection(db, 'clinics', clinic.id, 'financial_entries'),
          where('quotationId', '==', qId),
          where('installmentNumber', '==', i),
          where('patientId', '==', selectedPatientId)
        );
        const dupCheckSnap = await getDocs(checkQuery);

        const competenceMonth = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}`;

        const financialEntryData = {
          source: "quotation",
          quotationId: qId,
          quotation_id: qId,
          patientId: selectedPatientId,
          patient_id: selectedPatientId,
          patientName: patient?.name || 'Paciente',
          patient_name: patient?.name || 'Paciente',
          description: `Parcela ${i}/${installments} - ${q.title}`,
          type: "income",
          category: "Clínico",
          amount: installmentValue,
          value: installmentValue,
          paidAmount: 0,
          paid_amount: 0,
          pendingAmount: installmentValue,
          remainingAmount: installmentValue,
          remaining_amount: installmentValue,
          status: "pending",
          paymentMethod: paymentMethodValue,
          payment_method: paymentMethodValue,
          installmentNumber: i,
          installment_number: i,
          totalInstallments: installments,
          dueDate: dueDate.toISOString(),
          due_date: dueDate.toISOString(),
          date: dueDate.toISOString(),
          competence_month: competenceMonth,
          createdAt: serverTimestamp(),
          created_at: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updated_at: serverTimestamp(),
          createdBy: user?.uid || 'system'
        };

        let entryId = pId;
        if (!dupCheckSnap.empty) {
          entryId = dupCheckSnap.docs[0].id;
          const entryPath = `clinics/${clinic.id}/financial_entries/${entryId}`;
          console.log("[QUOTE_FINANCE_CREATE] writing financial entry:", entryPath);
          await updateDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entryId), {
            ...financialEntryData,
            updatedAt: serverTimestamp(),
            updated_at: serverTimestamp()
          });
        } else {
          const entryPath = `clinics/${clinic.id}/financial_entries/${entryId}`;
          console.log("[QUOTE_FINANCE_CREATE] writing financial entry:", entryPath);
          await setDoc(doc(db, 'clinics', clinic.id, 'financial_entries', entryId), financialEntryData);
        }
      }

      // INTEGRACAO ELIZA: CRIAR COMISSAO COMERCIAL AUTOMATICA
      try {
        let patientType: 'novo' | 'reativado' | 'vip' | 'ativo' = 'novo';
        
        // Se houver historico de outros orcamentos aprovados ou tratamentos
        if (financialRecords.length > 0 || quotations.filter(item => item.status === 'approved' && item.id !== qId).length > 0) {
          const dates = [
            ...financialRecords.map(r => r.date),
            ...quotations.filter(item => item.status === 'approved' && item.id !== qId).map(item => (item as any).createdAt || (item as any).date)
          ].filter(Boolean).map(d => new Date(d).getTime());

          if (dates.length > 0) {
            const lastDate = Math.max(...dates);
            const diffDays = Math.round((new Date().getTime() - lastDate) / (1000 * 3600 * 24));
            if (diffDays > 365) {
              patientType = 'vip'; // Reativado VIP
            } else if (diffDays > 180) {
              patientType = 'reativado'; // Reativado
            } else {
              patientType = 'ativo'; // Ativo
            }
          }
        }

        // Buscar configuracoes de comissao da clinica
        const configRef = doc(db, 'clinics', clinic.id, 'commercial_commissions_settings', 'config');
        const configSnap = await getDoc(configRef);
        const conf = configSnap.exists() ? configSnap.data() : null;

        let commissionPercent = 5;
        if (patientType === 'novo') commissionPercent = conf?.novoPercent ?? 5;
        else if (patientType === 'reativado') commissionPercent = conf?.reativadoPercent ?? 3;
        else if (patientType === 'vip') commissionPercent = conf?.reativadoVipPercent ?? 5;
        else commissionPercent = 0; // Ativo sem comissao extra automatica

        const commissionValue = (totalValue * commissionPercent) / 100;

        // Atribuir responsavel original ou ELIZA se agendado por Recall
        const respId = (q as any).responsibleId || 'no_commission';
        const respName = (q as any).responsible || 'Sem Comissão';

        await setDoc(doc(db, 'clinics', clinic.id, 'commercial_sale_commissions', `comm-${qId}`), {
          id: `comm-${qId}`,
          patientId: selectedPatientId,
          patientName: patient?.name || 'Paciente',
          quotationId: qId,
          quotationTitle: q.title || 'Plano de Tratamento',
          value: totalValue,
          status: 'pending',
          type: patientType,
          responsibleId: respId,
          responsibleName: respName,
          leadSource: 'WhatsApp', // O admin podera classificar a origem precisa se necessario
          commissionPercent,
          commissionValue,
          date: new Date().toISOString(),
          observation: `Identificação automática da ELIZA: ${
            patientType === 'novo' ? 'Paciente Novo' : 
            patientType === 'vip' ? 'Paciente Reativado VIP' : 
            patientType === 'reativado' ? 'Paciente Reativado' : 'Paciente Ativo'
          }.`,
          createdAt: serverTimestamp()
        }, { merge: true });

        console.log(`[ELIZA CRM] Comissao comercial gerada para o orcamento aprovado: ${qId}`);
      } catch (crmErr) {
        console.error("[ELIZA CRM] Erro ao integrar comissao comercial automatica:", crmErr);
      }

      alert('Orçamento aprovado! Tratamentos e parcelas financeiras gerados com sucesso.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${patientBasePath}/quotations/${qId}`);
    }
  };

  const deleteQuotation = async (qId: string) => {
    if (!selectedPatientId || !clinic) return;
    if (!confirm('Deseja realmente apagar este orçamento? Todos os tratamentos cadastrados e lançamentos financeiros pendentes associados a ele também serão excluídos.')) return;

    const patientBasePath = getPatientPathStr(selectedPatientId);

    try {
      // 1. Delete associated treatments
      const treatmentsRef = collection(db, patientBasePath, 'treatments');
      const treatmentsSnap = await getDocs(query(treatmentsRef, where('quotationId', '==', qId)));
      for (const tDoc of treatmentsSnap.docs) {
        await deleteDoc(tDoc.ref);
      }

      // 2. Delete patient specific old financial entries (backward compatibility)
      const patientFinRef = collection(db, patientBasePath, 'financial');
      const patientFinSnap = await getDocs(query(patientFinRef, where('quotationId', '==', qId)));
      for (const pfDoc of patientFinSnap.docs) {
        await deleteDoc(pfDoc.ref);
      }

      // 3. Delete global financial entries (but keep those that are paid/partial for integrity, only delete pending ones)
      const globalFinRef = collection(db, 'clinics', clinic.id, 'financial_entries');
      const globalFinSnap = await getDocs(query(globalFinRef, where('quotationId', '==', qId)));
      for (const gDoc of globalFinSnap.docs) {
        const status = gDoc.data().status;
        if (status === 'pending' || status === 'vencido') {
          await deleteDoc(gDoc.ref);
        }
      }

      // 4. Finally delete the quotation document itself
      await deleteDoc(doc(db, patientBasePath, 'quotations', qId));
      alert('Orçamento e registros vinculados pendentes foram excluídos com sucesso!');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `${patientBasePath}/quotations/${qId}`);
    }
  };

  const isWhatsAppApiActive = waIntegration?.status === 'conectado' && waSettings?.defaultSendMode === 'eliza_api';

  const handleAddTodayEvolution = async () => {
    if (!selectedPatientId || !clinic) return;
    if (treatments.length > 0) {
      setSelectedTreatmentId(treatments[0].id);
      setIsEvolutionModalOpen(true);
    } else {
      const patientBasePath = getPatientPathStr(selectedPatientId);
      const newTreatmentId = `gen-treat-${Date.now()}`;
      const treatmentRef = doc(db, patientBasePath, 'treatments', newTreatmentId);
      try {
        await setDoc(treatmentRef, {
          id: newTreatmentId,
          description: 'Prontuário Clínico Geral',
          professional: profile?.name || user?.email || 'Cirurgião Dentista',
          status: 'active',
          evolutions: []
        });
        setSelectedTreatmentId(newTreatmentId);
        setIsEvolutionModalOpen(true);
      } catch (err: any) {
        alert("Falha ao inicializar prontuário: " + err.message);
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC] overflow-hidden font-sans">
      {quotaExceeded && (
        <div className="bg-rose-50 border-b border-rose-100 p-3 px-8 flex items-center gap-2">
          <div className="w-6 h-6 bg-rose-100 text-rose-600 rounded-lg flex items-center justify-center shrink-0">
             <Database className="w-3 h-3" />
          </div>
          <p className="text-[10px] font-bold text-rose-900 uppercase tracking-widest">
            Limite de leitura atingido (Quota exceeded). Alguns dados podem não carregar.
          </p>
        </div>
      )}
      {/* Main Patient Content */}
      <main className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {selectedPatientId ? (
            <motion.div 
              key={selectedPatientId}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col"
            >
              {/* Profile Header */}
              <header className="px-4 md:px-6 lg:px-8 py-3 bg-white border-b border-slate-200 shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3">
                  {/* Left Column: Avatar, Name, Status, Phone & action links/buttons */}
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => onSelectPatient?.(null)}
                      className="p-1 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-all shadow-sm shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
                        <h2 className="text-base md:text-lg font-black text-slate-900 tracking-tight truncate max-w-[150px] sm:max-w-xs md:max-w-none">
                          {selectedPatient?.name}
                        </h2>
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[8px] font-bold uppercase tracking-widest rounded border border-emerald-100 shrink-0">
                          Ativo
                        </span>
                      </div>
                      
                      {/* Subtitle with phone and click contacts directly */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-bold font-mono">
                        <span className="flex items-center gap-1">
                          <Smartphone className="w-3 h-3 text-teal-600" />
                          {selectedPatient?.phone}
                        </span>

                        <span className="text-slate-350">|</span>

                        {/* WhatsApp Destacado */}
                        <button
                          type="button"
                          onClick={() => setIsWhatsAppMenuOpen(true)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-[9px] font-extrabold uppercase tracking-widest flex items-center gap-1 active:scale-95 transition-all shadow-xs cursor-pointer"
                          title="Falar no WhatsApp"
                        >
                          <MessageCircle className="w-3 h-3 fill-white text-emerald-600" />
                          WhatsApp
                        </button>

                        {/* Botão Ligar */}
                        {selectedPatient?.phone && (
                          <a
                            href={`tel:${selectedPatient.phone.replace(/\s+/g, '')}`}
                            className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-950 rounded-full text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-all"
                            title="Ligar para o paciente"
                          >
                            📞 Ligar
                          </a>
                        )}

                        {/* Botão Editar pequeno */}
                        <button
                          type="button"
                          onClick={() => setIsEditModalOpen(true)}
                          className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-200 transition-all flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide cursor-pointer"
                          title="Editar Cadastro do Paciente"
                        >
                          <Edit2 className="w-2.5 h-2.5 text-slate-400" /> Editar
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Operational Buttons */}
                  <div className="flex flex-row items-center gap-1.5 md:gap-2 py-1 shrink-0 relative z-30 overflow-visible">
                    <button 
                      onClick={() => {
                        if (selectedPatientId && onSchedulePatient) {
                          onSchedulePatient(selectedPatientId);
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-bold text-[9px] md:text-[10px] uppercase tracking-wider hover:scale-98 active:scale-95 transition-all shadow-sm flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Calendar className="w-3 h-3 text-indigo-100" /> Agendar
                    </button>

                    <button 
                      onClick={() => {
                        if (staff && staff.length > 0) {
                          setPlanningForm(prev => ({ ...prev, professionalId: staff[0].id }));
                        }
                        setIsPlanningModalOpen(true);
                      }}
                      className="bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-bold text-[9px] md:text-[10px] uppercase tracking-wider hover:scale-98 active:scale-95 transition-all shadow-sm flex items-center gap-1 cursor-pointer shrink-0 border border-teal-500/15"
                    >
                      <CalendarDays className="w-3 h-3 text-teal-100" /> Planejar
                    </button>

                    <div className="relative shrink-0 overflow-visible z-40">
                      <button 
                        onClick={() => setIsMaisDropdownOpen(!isMaisDropdownOpen)}
                        className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 md:px-4 md:py-2 rounded-xl font-bold text-[9px] md:text-[10px] uppercase tracking-wider hover:scale-98 active:scale-95 transition-all flex items-center gap-1 cursor-pointer shadow-md select-none"
                      >
                        Mais <MoreVertical className="w-3 h-3 text-slate-400" />
                      </button>
                      
                      {/* Dropdown Menu */}
                      <AnimatePresence>
                        {isMaisDropdownOpen && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setIsMaisDropdownOpen(false)} />
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.95, y: 10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: 10 }}
                              className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 py-2.5 z-40 origin-top-right text-slate-700"
                            >
                              <button
                                onClick={() => {
                                  setIsMaisDropdownOpen(false);
                                  setIsMigrationWizardOpen(true);
                                }}
                                className="w-full text-left px-4 py-2.5 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-teal-500" /> Importar histórico antigo
                              </button>
                              
                              <button
                                onClick={() => {
                                  setIsMaisDropdownOpen(false);
                                  handleAddTodayEvolution();
                                }}
                                className="w-full text-left px-4 py-2.5 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer"
                              >
                                <Stethoscope className="w-3.5 h-3.5 text-rose-500" /> Adicionar evolução
                              </button>

                              <button
                                onClick={() => {
                                  setIsMaisDropdownOpen(false);
                                  setActiveTab('treatments');
                                }}
                                className="w-full text-left px-4 py-2.5 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer"
                              >
                                <Activity className="w-3.5 h-3.5 text-blue-500" /> Histórico Clínico
                              </button>
                              
                              <button
                                onClick={() => {
                                  setIsMaisDropdownOpen(false);
                                  setIsEditModalOpen(true);
                                }}
                                className="w-full text-left px-4 py-2.5 text-[10px] font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" /> Ações administrativas
                              </button>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Patient Navigation Tabs */}
                <nav className="flex gap-1 bg-slate-50 p-0.5 md:p-1 rounded-xl md:rounded-2xl border border-slate-200 overflow-x-auto no-scrollbar scroll-smooth">
                  {[
                    { id: 'summary', label: 'Dados', icon: User },
                    { id: 'anamnesis', label: 'Anamnese', icon: ClipboardList },
                    { id: 'facial_planning', label: 'Planejamento IA', icon: Brain },
                    { id: 'quotations', label: 'Orçamentos', icon: DollarSign },
                    { id: 'treatments', label: 'Tratamentos', icon: Activity },
                    { id: 'files', label: 'Imagens', icon: ImageIcon },
                    { id: 'documents', label: 'Documentos', icon: FileDigit },
                    { id: 'financial', label: 'Financeiro', icon: CreditCard },
                    { id: 'notes', label: 'Recados', icon: MessageCircle },
                    { id: 'aesthetic', label: 'Recall HOF', icon: Sparkles },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as RecordTab)}
                      className={`flex-none lg:flex-1 flex items-center justify-center gap-1 md:gap-1.5 px-3 lg:px-0 py-1.5 md:py-2 rounded-lg md:rounded-xl text-[8px] sm:text-[9.5px] lg:text-[10px] font-bold uppercase tracking-widest transition-all whitespace-nowrap cursor-pointer ${
                        activeTab === tab.id 
                        ? 'bg-white text-teal-600 shadow-sm' 
                        : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      <tab.icon className="w-3 h-3" />
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </header>

              {/* Tab Content Display */}
              <div className="flex-1 overflow-y-auto p-3 md:p-5 custom-scrollbar pb-24 md:pb-8 bg-slate-50/50">
                {activeTab === 'summary' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="space-y-8">
                      <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-6 border-b border-slate-50 pb-4 flex-wrap gap-2">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <User className="w-4 h-4 text-teal-600" /> Informações Detalhadas
                          </h3>
                          <button
                            onClick={() => handleOpenReturnRequestManual("Revisão Periódica / Check-up")}
                            className="text-[9px] bg-teal-600 hover:bg-teal-700 text-white font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <CalendarDays className="w-3.5 h-3.5" /> Solicitar Retorno
                          </button>
                        </div>
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Data de Nascimento</p>
                              <p className="text-sm font-semibold text-slate-900">{selectedPatient?.birthDate || 'Não informado'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Email</p>
                              <p className="text-sm font-semibold text-slate-900">{selectedPatient?.email || 'Nenhum email cadastrado'}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Endereço Completo</p>
                            <p className="text-sm font-semibold text-slate-900 flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-slate-300 mt-0.5" />
                              {selectedPatient?.address || 'Nenhum endereço cadastrado'}
                            </p>
                          </div>
                        </div>
                      </section>
                      
                      <section className="bg-slate-900 p-8 rounded-[2rem] text-white shadow-xl">
                        <h4 className="text-[10px] font-bold text-teal-400 uppercase tracking-widest mb-4">Notas Internas</h4>
                        <p className="text-sm italic opacity-70 leading-relaxed font-medium">
                          {anamnesis?.internalNotes || '"Paciente sem observações registradas."'}
                        </p>
                      </section>
                    </div>

                    <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Histórico de Agendamentos</h3>
                        <span className="text-[10px] font-bold text-teal-600 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-100/50">
                          {patientAppointments.length} {patientAppointments.length === 1 ? 'Item' : 'Itens'}
                        </span>
                      </div>

                      {patientAppointments.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-3xl p-10 text-center">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                            <Calendar className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-sm font-bold text-slate-900">Sem horários marcados</p>
                          <p className="text-xs text-slate-400 mt-1 font-medium">Deseja agendar uma nova consulta?</p>
                          <button 
                            onClick={() => {
                              if (selectedPatientId && onSchedulePatient) {
                                onSchedulePatient(selectedPatientId);
                              }
                            }}
                            className="mt-6 bg-teal-600 text-white px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-teal-700 transition-all"
                          >
                            Agendar Agora
                          </button>
                        </div>
                      ) : (
                        <div className="flex-1 overflow-y-auto max-h-[400px] pr-1 space-y-4">
                          {patientAppointments.map((apt) => {
                            const staffMember = staff.find(s => s.id === apt.staffId);
                            const staffName = staffMember?.name || apt.professional || 'Profissional';
                            
                            let formattedDate = apt.date;
                            try {
                              if (apt.date) {
                                const [year, month, day] = apt.date.split('-');
                                formattedDate = `${day}/${month}/${year}`;
                              }
                            } catch (_) {}

                            const st = apt.status?.toLowerCase();
                            const statusColor = 
                              st === 'confirmado' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              st === 'atendido' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' :
                              st === 'faltou' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                              st === 'cancelado' ? 'bg-slate-50 text-slate-500 border-slate-100' :
                              'bg-amber-50 text-amber-700 border-amber-100';

                            const statusLabel = 
                              st === 'confirmado' ? 'Confirmado' :
                              st === 'atendido' ? 'Atendido' :
                              st === 'faltou' ? 'Faltou' :
                              st === 'cancelado' ? 'Cancelado' :
                              'Agendado';

                            return (
                              <div key={apt.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    {formattedDate} {apt.time ? `às ${apt.time}` : ''}
                                  </span>
                                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusColor}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-600 font-medium">
                                  <p className="font-bold text-slate-700">{apt.procedure || 'Consulta'}</p>
                                  <p className="mt-0.5 text-slate-400">Com: <span className="font-semibold text-slate-500">{staffName}</span></p>
                                  {apt.notes && (
                                    <p className="mt-1.5 p-2 bg-white rounded-lg border border-slate-100 text-[11px] text-slate-500 font-normal italic">
                                      "{apt.notes}"
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <div className="pt-2">
                            <button 
                              onClick={() => {
                                if (selectedPatientId && onSchedulePatient) {
                                  onSchedulePatient(selectedPatientId);
                                }
                              }}
                              className="w-full bg-slate-900 text-white py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md shadow-slate-900/10"
                            >
                              Novo Agendamento
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'anamnesis' && clinic && patients.find(p => p.id === selectedPatientId) && (
                  <AnamnesisIntelligenceView 
                    patient={patients.find(p => p.id === selectedPatientId)!}
                    anamnesis={anamnesis}
                    clinic={clinic}
                    user={{}}
                    onNavigateToTab={(tabId) => setActiveTab(tabId as RecordTab)}
                  />
                )}

                {false && activeTab === 'anamnesis' && (
                  <div className="space-y-8">
                    <header className="flex justify-between items-center bg-white p-6 rounded-3xl border border-slate-200">
                       <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-600">
                           <ClipboardList className="w-6 h-6" />
                         </div>
                         <div>
                            <h3 className="text-base font-bold text-slate-900 tracking-tight">Anamnese & Histórico</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                               {anamnesis?.updatedAt ? `Última atualização: ${new Date(anamnesis.updatedAt.toDate()).toLocaleDateString()}` : 'Nenhum registro ativo'}
                            </p>
                         </div>
                       </div>
                       <div className="flex gap-2">
                         <select 
                          onChange={(e) => {
                            const t = clinicTemplates.find(item => item.id === e.target.value);
                            if (t && window.confirm('Deseja iniciar uma nova anamnese baseada neste template? Isto substituirá a atual.')) {
                              const patient = patients.find(p => p.id === selectedPatientId);
                              let content = t.content || '';
                              const replacements: Record<string, string> = {
                                '{paciente_nome}': patient?.name || '',
                                '{paciente_cpf}': (patient as any)?.cpf || '',
                                '{data_atual}': new Date().toLocaleDateString('pt-BR'),
                              };
                              Object.entries(replacements).forEach(([tag, value]) => {
                                content = content.replaceAll(tag, value);
                              });

                              setAnamnesis({
                                title: t.name,
                                content: content,
                                createdAt: new Date().toISOString()
                              });
                            }
                          }}
                          className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-bold uppercase outline-none shadow-sm"
                         >
                            <option value="">+ Usar Template</option>
                            {clinicTemplates.filter(t => t.type === 'anamnesis').map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                         </select>
                         {anamnesis && (
                           <button 
                            onClick={async () => {
                              if (!clinic || !selectedPatientId) return;
                              try {
                                await setDoc(doc(db, 'clinics', clinic.id, 'patients', selectedPatientId, 'anamnesis', 'current'), {
                                  ...anamnesis,
                                  updatedAt: serverTimestamp()
                                });
                                alert('Anamnese salva com sucesso!');
                              } catch (err) {
                                handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/patients/${selectedPatientId}/anamnesis/current`);
                              }
                            }}
                            className="bg-teal-600 text-white px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20"
                           >
                              Salvar
                           </button>
                         )}
                       </div>
                    </header>

                    <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
                       {anamnesis ? (
                         <div className="p-10 space-y-6 flex flex-col h-full">
                           <div className="pb-4 border-b border-slate-50">
                              <h4 className="text-xl font-black text-slate-800 tracking-tight">{anamnesis.title}</h4>
                           </div>
                           <textarea 
                             value={anamnesis.content || ''}
                             onChange={(e) => setAnamnesis({...anamnesis, content: e.target.value})}
                             className="flex-1 w-full text-base font-medium text-slate-700 outline-none resize-none font-serif leading-relaxed"
                             placeholder="Preencha as informações do paciente aqui..."
                           />
                         </div>
                       ) : (
                         <div className="flex-1 flex flex-col items-center justify-center p-20 text-center opacity-40">
                           <ClipboardList className="w-12 h-12 text-slate-200 mb-4" />
                           <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nenhuma anamnese ativa para este paciente</p>
                           <p className="text-[10px] text-slate-300 font-medium px-12 mt-2 leading-relaxed">Selecione um modelo de anamnese acima para começar.</p>
                         </div>
                        )}
                     </div>
                  </div>
                )}

                {activeTab === 'quotations' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center mb-4 bg-white/40 p-4 border border-slate-200/50 rounded-2xl">
                      <div>
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Orçamentos Ativos</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">Gerencie planos de tratamento propostos para o paciente</p>
                      </div>
                      <button 
                        onClick={() => {
                          setEditingQuotationId(null);
                          setQuotationForm({ title: '', responsible: '', items: [], paymentMethod: 'PIX', installments: 1 });
                          setIsQuotationModalOpen(true);
                        }}
                        className="bg-teal-600 text-white px-5 py-2 rounded-xl text-[10px] font-bold h-10 uppercase tracking-widest flex items-center gap-2 shadow-sm cursor-pointer"
                      >
                        <Plus className="w-4 h-4" /> Novo Orçamento
                      </button>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      {quotations.map(q => (
                        <div key={q.id} className="bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col overflow-hidden group hover:border-teal-100 transition-colors">
                          <div className="p-5 md:p-6 border-b border-slate-50 flex justify-between items-start gap-4">
                             <div>
                                <h4 className="text-sm font-bold text-slate-900 leading-snug">{q.title}</h4>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Ref: #{q.id.slice(-5)}</p>
                             </div>
                             <span className={`px-2.5 py-1 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${
                               q.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'
                             }`}>
                               {q.status === 'approved' ? 'Aprovado' : 'Aguardando'}
                             </span>
                          </div>

                          {/* Procedures List - Collapsible on mobile, always visible on desktop */}
                          <div className={`p-5 md:p-6 flex-1 space-y-3 ${expandedQuoteIds[q.id] ? 'block' : 'hidden md:block'}`}>
                             {q.items.map((item, idx) => (
                               <div key={idx} className="flex justify-between items-center text-xs border-b border-dashed border-slate-105 pb-2 last:border-b-0 last:pb-0">
                                  <span className="text-slate-600 font-medium">{item.description}</span>
                                  <span className="text-slate-900 font-bold font-sans">R$ {item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                               </div>
                             ))}
                          </div>

                          {/* Footer with destacados e botões */}
                          <div className="p-5 md:p-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                             <div className="text-base md:text-lg font-black text-slate-950 font-sans">
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block leading-none mb-1">Valor Total</span>
                                R$ {q.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                             </div>
                             <div className="flex flex-wrap items-center gap-2">
                                {/* Collapsible Toggle for mobile */}
                                <button 
                                  onClick={() => setExpandedQuoteIds(prev => ({ ...prev, [q.id]: !prev[q.id] }))}
                                  className="md:hidden text-[9px] font-black text-teal-600 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2 uppercase tracking-wider transition-all"
                                >
                                  {expandedQuoteIds[q.id] ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                                </button>
                                
                                {q.status !== 'approved' && (
                                  <>
                                    <button 
                                      onClick={() => handleEditQuotation(q)}
                                      className="bg-teal-600 text-white px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-teal-700 transition-all flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Edit2 className="w-3 h-3" /> Editar
                                    </button>
                                    <button 
                                      onClick={() => approveQuotation(q.id)}
                                      className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <CheckCircle className="w-3 h-3" /> Aprovar Plano
                                    </button>
                                  </>
                                )}
                                {q.status === 'approved' && (
                                  <button 
                                    onClick={() => handleOpenContractGenerator(q)}
                                    className="bg-teal-600 text-white px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-teal-700 transition-all flex items-center gap-1.5 shadow-md shadow-teal-600/10 active:scale-95 duration-100"
                                  >
                                    <FileText className="w-3.5 h-3.5" /> Gerar Contrato
                                  </button>
                                )}
                                <button className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-teal-600 transition-all">
                                   <Printer className="w-4 h-4" />
                                </button>
                                <button 
                                   onClick={() => deleteQuotation(q.id)}
                                   className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
                                   title="Excluir Orçamento"
                                >
                                   <Trash2 className="w-4 h-4" />
                                </button>
                             </div>
                          </div>
                        </div>
                      ))}
                      {quotations.length === 0 && (
                        <div className="col-span-full py-20 bg-slate-50 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-slate-300">
                            <ClipboardList className="w-12 h-12 mb-4" />
                            <p className="text-sm font-bold">Nenhum orçamento gerado</p>
                            <p className="text-xs">Crie um plano de tratamento para este paciente.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'treatments' && (() => {
                  const activeTreatments = treatments.filter(t => t.status !== 'completed');
                  const completedTreatments = treatments.filter(t => t.status === 'completed');

                  return (
                    <>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                      {/* Left Column: Procedimentos Ativos / Em andamento */}
                      <section className="space-y-6">
                         <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                           <Activity className="w-4 h-4 text-teal-600" /> Procedimentos em Andamento
                         </h3>
                         <div className="space-y-4">
                            {activeTreatments.map(t => (
                              <div key={t.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm relative group hover:border-teal-100 transition-all">
                                 <div className="absolute left-0 top-6 bottom-6 w-1 bg-teal-600 rounded-r-full"></div>
                                 <div className="flex justify-between items-start mb-4">
                                    <div>
                                       <h4 className="text-sm font-bold text-slate-900">{t.description}</h4>
                                       <div className="flex flex-wrap gap-2 items-center mt-1 select-none font-sans">
                                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                           {t.professional || "Sem profissional responsável"}
                                         </p>
                                         {t.procedureValue !== undefined && (
                                           <span className="text-[10px] text-teal-650 text-teal-600 font-bold">R$ {Number(t.procedureValue || t.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                         )}
                                         {t.commissionPercent !== undefined && (
                                           <span className="bg-teal-50 text-teal-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full">{t.commissionPercent}% comissão</span>
                                         )}
                                       </div>
                                    </div>
                                    <span className="text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded">Em Andamento</span>
                                 </div>
                                 <div className="space-y-3 pl-2">
                                    {t.evolutions && t.evolutions.length > 0 ? (
                                      t.evolutions.map((ev, i) => (
                                        <div key={i} className="flex justify-between items-start gap-4 p-2.5 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all group/evo">
                                           <div className="flex gap-4 items-start flex-1">
                                              <div className="w-px h-full bg-slate-100 mt-2"></div>
                                              <div>
                                                 <p className="text-[11px] text-slate-700 leading-relaxed font-medium">{ev.text}</p>
                                                 <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter mt-1">
                                                   {new Date(ev.date).toLocaleDateString('pt-BR')} {ev.updatedAt ? '(Editado)' : ''}
                                                 </p>
                                              </div>
                                           </div>
                                           <button 
                                             type="button"
                                             onClick={() => handleEditEvolutionClick(t.id, i, ev.text)}
                                             className="p-1 text-slate-400 hover:text-teal-600 rounded-lg hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer inline-flex md:opacity-0 group-hover/evo:opacity-100"
                                             title="Editar Evolução"
                                           >
                                              <Edit2 className="w-3.5 h-3.5" />
                                           </button>
                                        </div>
                                      ))
                                    ) : (
                                      <p className="text-xs text-slate-400 italic">Nenhuma evolução registrada para este procedimento.</p>
                                    )}
                                 </div>
                                 <div className="mt-6 pt-4 border-t border-slate-50 flex justify-between items-center">
                                    <button 
                                      onClick={() => {
                                        setSelectedTreatmentId(t.id);
                                         setEditingEvolutionIndex(null);
                                         setEvolutionText('');
                                        setIsEvolutionModalOpen(true);
                                      }}
                                      className="text-[10px] font-bold text-teal-600 hover:text-teal-700 uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                                    >
                                       <Plus className="w-3.5 h-3.5" /> Registrar Evolução
                                    </button>

                                    <button 
                                      onClick={() => handleFinalizeTreatment(t.id)}
                                      className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 px-4 py-2 rounded-2xl transition-all uppercase tracking-widest flex items-center gap-1.5 shadow-sm hover:shadow-md"
                                    >
                                       <CheckCircle className="w-3.5 h-3.5" /> Finalizado
                                    </button>
                                 </div>
                              </div>
                            ))}
                            {activeTreatments.length === 0 && (
                               <div className="py-12 bg-white rounded-3xl border border-slate-200 flex flex-col items-center justify-center text-slate-300">
                                  <Plus className="w-8 h-8 mb-2" />
                                  <p className="text-xs font-bold">Sem procedimentos ativos no momento.</p>
                               </div>
                            )}
                         </div>
                      </section>

                      {/* Right Column: Histórico de Tratamento (Completed procedures) */}
                      <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm h-fit sticky top-0 space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-50 pb-4">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <History className="w-4 h-4 text-emerald-600" /> Histórico de Tratamento
                          </h3>
                          <div className="flex items-center gap-2">
                             <button
                               onClick={() => {
                                 setHistoryForm({
                                   description: '',
                                   professionalId: '',
                                   amount: '',
                                   completedAt: new Date().toISOString().split('T')[0],
                                   evolutionText: '',
                                   paymentMethod: 'Pix'
                                 });
                                 setIsAddHistoryModalOpen(true);
                               }}
                               className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg border border-emerald-200 transition-all cursor-pointer flex items-center justify-center"
                               title="Adicionar Histórico Diretamente"
                             >
                               <Plus className="w-4 h-4" />
                             </button>
                             <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-0.5 rounded-full">
                               {completedTreatments.length} Concluído(s)
                             </span>
                          </div>
                        </div>

                        <div className="space-y-4 max-h-[550px] overflow-y-auto pr-1">
                          {completedTreatments.map(t => (
                            <div key={t.id} className="bg-slate-50/70 border border-slate-100 p-6 rounded-3xl relative hover:border-slate-200 transition-all">
                              <div className="absolute left-0 top-6 bottom-6 w-1 bg-slate-400 rounded-r-full"></div>
                              <div className="flex justify-between items-start mb-4">
                                <div>
                                  <h4 className="text-sm font-bold text-slate-700 line-through decoration-slate-300">{t.description}</h4>
                                  <div className="flex flex-wrap gap-2 items-center mt-1 select-none font-sans">
                                    <p className="text-[10px] text-slate-450 text-slate-500 font-bold uppercase tracking-widest">
                                      {t.professional || "Sem profissional responsável"}
                                    </p>
                                    {t.procedureValue !== undefined && (
                                      <span className="text-[10px] text-slate-500 font-bold">R$ {Number(t.procedureValue || t.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                    )}
                                    {t.commissionPercent !== undefined && (
                                      <span className="bg-slate-100 text-slate-600 text-[8px] font-bold px-1.5 py-0.5 rounded-full">{t.commissionPercent}% comissão</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] font-black uppercase tracking-[0.2em] px-2.5 py-1 bg-slate-100 text-slate-500 rounded border border-slate-200">Finalizado</span>
                                  <button
                                    onClick={() => {
                                      setEditingTreatment(t);
                                      setEditTreatmentForm({
                                        professionalId: t.professionalId || '',
                                        professionalName: t.professional || '',
                                        procedureName: t.description || '',
                                        procedureValue: t.procedureValue || t.amount || 0,
                                        commissionPercent: t.commissionPercent !== undefined ? t.commissionPercent : 30,
                                        commissionEligible: t.commissionEligible !== false,
                                        treatmentStatus: 'Finalizado'
                                      });
                                      setIsEditingTreatmentModalOpen(true);
                                    }}
                                    className="p-1 hover:bg-slate-200/50 text-slate-400 hover:text-teal-600 rounded-lg transition-all border border-transparent"
                                    title="Editar Procedimento"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-4 pl-3 border-l-2 border-slate-200/50 ml-1">
                                {t.evolutions && t.evolutions.length > 0 ? (
                                  t.evolutions.map((ev, i) => (
                                    <div key={i} className="relative flex justify-between items-start gap-4 p-2.5 rounded-2xl hover:bg-white border border-transparent hover:border-slate-100 transition-all group/evo">
                                      <div className="absolute left-[-18px] top-3.5 w-2.5 h-2.5 rounded-full bg-slate-300 border border-white"></div>
                                      <div className="flex-1 col">
                                        <p className="text-[11px] text-slate-605 text-slate-600 leading-relaxed font-medium">{ev.text}</p>
                                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter mt-1">
                                          {new Date(ev.date).toLocaleDateString('pt-BR')} {ev.updatedAt ? '(Editado)' : ''}
                                        </p>
                                      </div>
                                      <button 
                                        type="button"
                                        onClick={() => handleEditEvolutionClick(t.id, i, ev.text)}
                                        className="p-1 text-slate-400 hover:text-teal-600 rounded-lg hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer inline-flex md:opacity-0 group-hover/evo:opacity-100"
                                        title="Editar Evolução"
                                      >
                                         <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-xs text-slate-400 italic">Procedimento concluído sem evoluções registradas.</p>
                                )}
                              </div>
                              {t.completedAt && (
                                <div className="mt-4 pt-3 border-t border-slate-200/40 flex items-center gap-1.5 text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                                  <CheckCircle className="w-3 h-3 text-emerald-500" /> Concluído em: {new Date(t.completedAt).toLocaleDateString('pt-BR')}
                                </div>
                              )}
                            </div>
                          ))}
                          {completedTreatments.length === 0 && (
                             <div className="py-12 bg-slate-50/30 rounded-3xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-300 text-center">
                                <CheckCircle className="w-8 h-8 mb-2" />
                                <p className="text-xs font-bold text-slate-400">Nenhum procedimento finalizado ainda.</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">Finalize procedimentos em andamento para arquivá-los.</p>
                             </div>
                          )}
                        </div>
                     </section>
                    </div>

                    {/* Seção de Sinalizações de Retorno para Recepção */}
                    <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm mt-8 space-y-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-50 pb-4">
                        <div>
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Clock className="w-4 h-4 text-teal-605 animate-pulse" /> Sinalizações de Retorno para Recepção
                          </h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">Pendências de contato e agendamento pós-tratamento enviadas para a recepção</p>
                        </div>
                        
                        <button
                          onClick={() => handleOpenReturnRequestManual()}
                          className="text-[10px] bg-teal-600 hover:bg-teal-700 text-white font-bold uppercase tracking-widest px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer inline-flex self-start sm:self-center"
                        >
                          <CalendarDays className="w-3.5 h-3.5" /> Solicitar Novo Retorno
                        </button>
                      </div>

                      <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                        {patientReturnRequests && patientReturnRequests.length > 0 ? (
                          [...patientReturnRequests].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(req => {
                            const badgeStyle = 
                              req.status === 'Agendado' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              req.status === 'Pendente' ? 'bg-amber-50 text-amber-700 border-amber-100 animate-pulse' :
                              req.status === 'Em contato' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                              req.status === 'Paciente não respondeu' ? 'bg-pink-50 text-pink-700 border-pink-100' :
                              req.status === 'Recusou retorno' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                              'bg-slate-50 text-slate-700 border-slate-100';

                            const priorityStyle = req.priority === 'Alta' || req.priority === 'Urgente'
                              ? 'text-rose-650 bg-rose-50 border-rose-100'
                              : 'text-slate-500 bg-slate-50 border-slate-105';

                            return (
                              <div key={req.id} className="bg-slate-50/50 border border-slate-205 p-5 rounded-2xl relative hover:border-teal-100 transition-all">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                                  <div className="space-y-0.5">
                                    <p className="text-xs font-bold text-slate-800 flex flex-wrap items-center gap-1.5">
                                      Tipo de Retorno: <span className="font-semibold text-teal-600">{req.returnType}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-500 font-medium">
                                      Procedimento vinculado: <span className="font-semibold text-slate-700">{req.treatmentName || 'Não especificado'}</span>
                                    </p>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                    <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${badgeStyle}`}>
                                      {req.status}
                                    </span>
                                    <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${priorityStyle}`}>
                                      Prio: {req.priority}
                                    </span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-[10px] font-bold text-slate-500 bg-white p-3 rounded-xl border border-slate-100 shadow-2xs">
                                  <div>
                                    <span className="text-[8px] text-slate-400 uppercase tracking-widest block font-extrabold mb-0.5">Solicitado por</span>
                                    <span className="text-slate-800 font-bold">{req.createdBy || req.professionalName}</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-slate-400 uppercase tracking-widest block font-extrabold mb-0.5">Prazo de Retorno</span>
                                    <span className="text-teal-600 font-extrabold">{req.suggestedDeadline}</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-slate-400 uppercase tracking-widest block font-extrabold mb-0.5">Data limite para Alerta</span>
                                    <span className="text-slate-705 font-medium">{req.targetDate ? new Date(req.targetDate).toLocaleDateString('pt-BR') : 'Sem data limite'}</span>
                                  </div>
                                </div>
                                {req.observation && (
                                  <div className="text-[11px] text-slate-650 mt-3 leading-relaxed bg-amber-50/25 px-3 py-1.5 rounded-lg border border-dashed border-slate-150">
                                    <span className="font-bold text-slate-500 text-[9px] uppercase tracking-wider block mb-0.5">Observação do profissional:</span>
                                    {req.observation}
                                  </div>
                                )}
                                {req.scheduledAt && (
                                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-2 text-[9px] text-emerald-600 font-extrabold uppercase">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    Agendado com sucesso na recepção em: {new Date(req.scheduledAt).toLocaleDateString('pt-BR')} às {new Date(req.scheduledAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <div className="py-8 bg-slate-50/35 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-350 text-center">
                            <Clock className="w-7 h-7 mb-1.5 text-slate-300" />
                            <p className="text-xs font-bold text-slate-400">Nenhuma solicitação de retorno ativa.</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Caso queira antecipar ou fixar um re-agendamento pós-procedimento, clique em solicitar acima.</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </>
                  );
                })()}

                {activeTab === 'files' && (
                  <div className="space-y-8">
                     <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Galeria de Exames & Imagens</h3>
                        <div className="flex gap-3">
                           <input 
                             type="file" 
                             id="patient-image-upload" 
                             className="hidden" 
                             accept="image/*"
                             onChange={handleLocalFileUpload}
                           />
                           <label 
                             htmlFor="patient-image-upload"
                             className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 cursor-pointer hover:bg-slate-800 transition-all shadow-md"
                           >
                              <Upload className="w-4 h-4" /> Upload PC/Celular
                           </label>
                           <button 
                             onClick={() => setIsImageModalOpen(true)}
                             className="bg-white border border-slate-200 text-slate-600 px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-slate-50 transition-all"
                           >
                              <Plus className="w-4 h-4" /> Via Link
                           </button>
                        </div>
                     </div>
 
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {images.map(image => (
                           <div key={image.id} className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm flex flex-col group hover:border-teal-200 transition-all">
                              <div className="aspect-[4/3] relative overflow-hidden bg-slate-100">
                                 <img src={image.url} referrerPolicy="no-referrer" alt={image.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                 <div className="absolute top-4 left-4">
                                    <span className="px-3 py-1 bg-white/90 backdrop-blur shadow-sm rounded-lg text-[9px] font-black uppercase tracking-widest text-teal-600 border border-teal-100">
                                       {image.category}
                                    </span>
                                 </div>
                              </div>
                              <div className="p-6 space-y-3">
                                 <div className="flex justify-between items-start">
                                    <h4 className="text-sm font-bold text-slate-900 leading-tight">{image.title}</h4>
                                    <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap">
                                       {image.date ? new Date(image.date.toDate()).toLocaleDateString('pt-BR') : ''}
                                    </span>
                                 </div>
                                 {image.description && (
                                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                                       {image.description}
                                    </p>
                                 )}
                                 {!image.description && (
                                    <p className="text-[11px] text-slate-300 italic">Sem observações.</p>
                                 )}
                              </div>
                           </div>
                        ))}
                        <div 
                          onClick={() => setIsImageModalOpen(true)}
                          className="aspect-square border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center text-slate-300 hover:border-teal-200 hover:text-teal-600 transition-all cursor-pointer"
                        >
                           <Plus className="w-8 h-8 mb-2" />
                           <p className="text-[10px] font-bold uppercase tracking-tighter">Adicionar Foto</p>
                        </div>
                     </div>
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div className="space-y-6">
                    {/* Sub-Tabs switcher */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div className="flex gap-2 p-1 bg-slate-100/80 rounded-2xl">
                        <button
                          onClick={() => setDocumentSubTab('prescriptions')}
                          className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            documentSubTab === 'prescriptions'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-850'
                          }`}
                        >
                          Receitas & Atestados
                        </button>
                        <button
                          onClick={() => setDocumentSubTab('contracts')}
                          className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                            documentSubTab === 'contracts'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-850'
                          }`}
                        >
                          Contratos HOF & TCLE
                        </button>
                      </div>
                      
                      {documentSubTab === 'contracts' && (
                        <div className="flex items-center gap-2 bg-teal-50 border border-teal-100 px-4 py-2 rounded-2xl">
                          <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" />
                          <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">
                            Dossiê de Contratos Inteligentes
                          </span>
                        </div>
                      )}
                    </div>

                    {documentSubTab === 'prescriptions' ? (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                         <div className="lg:col-span-2 space-y-8">
                            <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                               <div className="flex items-center justify-between mb-8">
                                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                     <FileDigit className="w-4 h-4 text-teal-600" /> Histórico de Receituários & Atestados
                                  </h3>
                                  <button className="text-[10px] font-bold text-teal-600 uppercase tracking-widest hover:underline">Ver Todos</button>
                               </div>
                               <div className="space-y-4">
                                  {documents.filter(docItem => docItem.type !== 'contrato').map((docItem) => (
                                    <div key={docItem.id} className="p-5 flex justify-between items-center group hover:bg-slate-50 transition-all rounded-2xl border border-slate-50 hover:border-teal-100">
                                       <div className="flex items-center gap-4">
                                          <div className="p-3 bg-slate-50 rounded-xl text-slate-400 group-hover:text-teal-600">
                                             <FileText className="w-5 h-5" />
                                          </div>
                                          <div>
                                             <h4 className="text-sm font-bold text-slate-900">{docItem.title}</h4>
                                             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                               {docItem.createdAt ? new Date(docItem.createdAt.toDate()).toLocaleDateString() : ''}
                                             </p>
                                          </div>
                                       </div>
                                       <div className="flex gap-2">
                                          <button 
                                            onClick={() => handlePrintClinicalDocument(
                                              docItem.content, 
                                              docItem.title, 
                                              docItem.type || 'receita', 
                                              docItem.patientDetails ? { 
                                                name: docItem.patientDetails.name, 
                                                cpf: docItem.patientDetails.cpf, 
                                                birthDate: docItem.patientDetails.birthDate 
                                              } : undefined
                                            )} 
                                            className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-teal-600"
                                            title="Imprimir Documento"
                                          >
                                            <Printer className="w-4 h-4" />
                                          </button>
                                          <button onClick={() => deleteDoc(doc(db, `clinics/${clinic?.id}/patients/${selectedPatientId}/documents`, docItem.id))} className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                                       </div>
                                    </div>
                                  ))}
                                  {documents.filter(docItem => docItem.type !== 'contrato').length === 0 && (
                                    <p className="text-center py-10 text-slate-300 text-xs font-bold uppercase">Nenhum receituário ou atestado emitido</p>
                                  )}
                               </div>
                            </section>
     
                            <div className="grid grid-cols-2 gap-6">
                               <button 
                                 onClick={() => handleOpenPrescriptionGenerator('pos_toxina')}
                                 className="h-40 bg-slate-900 rounded-[2rem] text-white flex flex-col items-center justify-center gap-4 group hover:bg-slate-800 transition-all shadow-xl"
                               >
                                  <div className="p-4 bg-white/10 rounded-2xl group-hover:bg-teal-600 transition-all"><Printer className="w-6 h-6" /></div>
                                  <span className="text-[10px] font-bold uppercase tracking-widest">Gerar Receita</span>
                               </button>
                               <button 
                                 onClick={() => {
                                   setDocumentForm({...documentForm, type: 'atestado'});
                                   setIsDocumentModalOpen(true);
                                 }}
                                 className="h-40 bg-white border border-slate-200 rounded-[2rem] text-slate-900 flex flex-col items-center justify-center gap-4 group hover:border-teal-200 transition-all shadow-sm"
                               >
                                  <div className="p-4 bg-slate-50 rounded-2xl group-hover:bg-teal-50 text-slate-400 group-hover:text-teal-600 transition-all"><FileText className="w-6 h-6" /></div>
                                  <span className="text-[10px] font-bold uppercase tracking-widest">Novo Atestado</span>
                               </button>
                            </div>
                         </div>
    
                         <aside className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm h-fit">
                            <div className="flex items-center justify-between mb-8">
                               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Base de Posologia</h3>
                               <Plus className="w-4 h-4 text-slate-300 cursor-pointer hover:text-teal-600" />
                            </div>
                            <div className="space-y-6">
                               {drugs.map(drug => (
                                 <div key={drug.id} className="group cursor-pointer">
                                    <h4 className="text-[11px] font-bold text-slate-900 group-hover:text-teal-600 transition-colors uppercase tracking-tight">{drug.name}</h4>
                                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1">{drug.defaultDosage}</p>
                                    <div className="h-px bg-slate-50 mt-4"></div>
                                 </div>
                               ))}
                            </div>
                            <button className="w-full mt-8 text-[10px] font-bold text-slate-300 uppercase tracking-[0.2em] hover:text-teal-600 transition-colors">Ver Biblioteca Completa</button>
                         </aside>
                      </div>
                    ) : (
                      // Contracts views
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                         <div className="lg:col-span-2 space-y-8">
                            <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm">
                               <div className="flex items-center justify-between mb-8">
                                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                     <FileCheck className="w-4 h-4 text-teal-600" /> Contratos de Tratamento Ativos
                                  </h3>
                                  <span className="text-[9px] bg-slate-100 text-slate-600 px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                                    {documents.filter(docItem => docItem.type === 'contrato').length} Contratos
                                  </span>
                               </div>
                               
                               <div className="space-y-6">
                                  {documents.filter(docItem => docItem.type === 'contrato').map((docItem) => {
                                    const statusColors: Record<string, string> = {
                                      'draft': 'bg-slate-100 text-slate-600 border-slate-200',
                                      'generated': 'bg-blue-50 text-blue-700 border-blue-100',
                                      'sent': 'bg-indigo-50 text-indigo-700 border-indigo-100',
                                      'signed': 'bg-emerald-50 text-emerald-700 border-emerald-100',
                                      'cancelled': 'bg-rose-50 text-rose-700 border-rose-100'
                                    };
                                    
                                    const statusLabel: Record<string, string> = {
                                      'draft': 'Rascunho',
                                      'generated': 'Gerado',
                                      'sent': 'Enviado ao Paciente',
                                      'signed': 'Assinado',
                                      'cancelled': 'Cancelado'
                                    };

                                    return (
                                      <div key={docItem.id} className="p-6 border border-slate-200 hover:border-teal-200 hover:bg-slate-50/40 rounded-3xl transition-all space-y-4">
                                         <div className="flex justify-between items-start gap-4">
                                            <div className="flex items-center gap-3">
                                               <div className="p-3 bg-teal-50 rounded-2xl text-teal-600">
                                                  <FileText className="w-5 h-5" />
                                               </div>
                                               <div>
                                                  <h4 className="text-sm font-bold text-slate-900 leading-snug">{docItem.title}</h4>
                                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                                     <span className="text-[10px] text-slate-400 font-bold tracking-wider">
                                                       {docItem.createdAt ? new Date(docItem.createdAt.toDate()).toLocaleDateString() : 'Aguardando data'}
                                                     </span>
                                                     {docItem.totalValue && (
                                                       <span className="text-[9px] bg-slate-200/60 text-slate-700 px-2.5 py-0.5 rounded-full font-bold">
                                                         R$ {docItem.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                       </span>
                                                     )}
                                                  </div>
                                               </div>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border ${statusColors[docItem.status || 'draft']}`}>
                                              {statusLabel[docItem.status || 'draft']}
                                            </span>
                                         </div>

                                         {/* Contract Metadata Info */}
                                         <div className="grid grid-cols-2 gap-4 py-3 border-y border-dashed border-slate-100 text-[10px] text-slate-650">
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase text-[9px] block">Responsável Clínico</span>
                                              {docItem.clinicDetails?.professionalName || 'Não especificado'} (CRO: {docItem.clinicDetails?.professionalCro || 'N/A'})
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase text-[9px] block">Condições de Pagamento</span>
                                              {docItem.paymentMethod || 'Não especificado'}
                                            </div>
                                         </div>

                                         {/* Actions panel */}
                                         <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                            <div className="flex items-center gap-2">
                                               <span className="text-[9px] font-bold uppercase text-slate-400">Mudar Status:</span>
                                               <select 
                                                 value={docItem.status || 'draft'}
                                                 onChange={(e) => handleUpdateContractStatus(docItem.id, e.target.value)}
                                                 className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 outline-none hover:border-teal-300 pointer"
                                               >
                                                 <option value="draft">Rascunho</option>
                                                 <option value="generated">Gerado</option>
                                                 <option value="sent">Enviado</option>
                                                 <option value="signed">Assinado</option>
                                                 <option value="cancelled">Cancelado</option>
                                               </select>
                                            </div>

                                            <div className="flex items-center gap-2">
                                               <button 
                                                 onClick={() => handlePrintSpecificContract(docItem.content, docItem.title)}
                                                 className="p-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-100 hover:text-slate-900 transition-all flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider"
                                                 title="Imprimir Contrato"
                                               >
                                                 <Printer className="w-3.5 h-3.5" /> Imprimir
                                               </button>

                                               {/* Upload signed document manual flow */}
                                               <label className="p-2 border border-slate-200 text-teal-600 rounded-xl hover:bg-teal-50 cursor-pointer transition-all flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider">
                                                 <Upload className="w-3.5 h-3.5" /> Anexar Assinado
                                                 <input 
                                                    type="file" 
                                                    accept="application/pdf,image/*" 
                                                    className="hidden" 
                                                    onChange={(e) => handleUploadSignedContract(docItem.id, e)} 
                                                 />
                                               </label>

                                               {docItem.pdfUrl && (
                                                 <a 
                                                   href={docItem.pdfUrl}
                                                   download={`${docItem.title.replace(/\s+/g, '_')}_assinado.pdf`}
                                                   className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 hover:shadow-lg transition-all flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider"
                                                   title="Baixar Contrato Assinado"
                                                 >
                                                   <Download className="w-3.5 h-3.5" /> Baixar
                                                 </a>
                                               )}

                                               <button 
                                                 onClick={() => deleteDoc(doc(db, `clinics/${clinic?.id}/patients/${selectedPatientId}/documents`, docItem.id))}
                                                 className="p-2 border border-rose-100 text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                                 title="Excluir Contrato"
                                               >
                                                 <Trash2 className="w-3.5 h-3.5" />
                                               </button>
                                            </div>
                                         </div>
                                      </div>
                                    );
                                  })}
                                  {documents.filter(docItem => docItem.type === 'contrato').length === 0 && (
                                    <div className="py-12 text-center bg-slate-50 border border-dashed border-slate-205 rounded-3xl flex flex-col items-center justify-center gap-2">
                                       <FileDigit className="w-8 h-8 text-slate-300" />
                                       <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nenhum contrato gerado para este paciente</p>
                                       <p className="text-[10px] text-slate-405 leading-relaxed max-w-sm">
                                         Acesse a aba <strong>"Orçamentos"</strong>, selecione um plano aprovado e clique em <strong>"Gerar Contrato"</strong> para compilar o termo.
                                       </p>
                                    </div>
                                  )}
                               </div>
                            </section>
                         </div>

                         <aside className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm h-fit space-y-6">
                            <div>
                               <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Contratos Inteligentes ELIZA IA</h3>
                               <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                  ELIZA unifica automaticamente termos técnicos e jurídicos detalhando riscos, intercorrências, limitações e as cláusulas específicas de cada procedimento.
                               </p>
                            </div>
                            <div className="space-y-4 text-[10px] text-slate-600 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                               <span className="font-bold uppercase tracking-wide text-slate-400">Variáveis Disponíveis</span>
                               <ul className="space-y-1.5 list-disc pl-3 leading-loose font-mono text-[8px]">
                                 <li><strong className="text-slate-800">&#123;&#123;nomePaciente&#125;&#125;</strong>: Nome completo do paciente</li>
                                 <li><strong className="text-slate-800">&#123;&#123;cpfPaciente&#125;&#125;</strong>: CPF do paciente</li>
                                 <li><strong className="text-slate-800">&#123;&#123;telefonePaciente&#125;&#125;</strong>: Celular principal</li>
                                 <li><strong className="text-slate-800">&#123;&#123;procedimentosAprovados&#125;&#125;</strong>: Lista de técnicas com valor</li>
                                 <li><strong className="text-slate-800">&#123;&#123;valorTotal&#125;&#125;</strong>: Montante final aprovado</li>
                                 <li><strong className="text-slate-800">&#123;&#123;formaPagamento&#125;&#125;</strong>: Condições de faturamento</li>
                                 <li><strong className="text-slate-800">&#123;&#123;croProfissional&#125;&#125;</strong>: Registro do RT logado</li>
                               </ul>
                            </div>
                            
                            <div className="bg-teal-50 border border-teal-100 p-5 rounded-3xl space-y-2">
                               <span className="text-[10px] font-black uppercase text-teal-850 tracking-wider flex items-center gap-1.5">
                                 <Sparkles className="w-3.5 h-3.5 text-teal-600" /> Assinatura Eletrônica
                               </span>
                               <p className="text-[10px] text-teal-700/80 leading-relaxed font-semibold">
                                 Para o fluxo físico provisório, você pode exportar em PDF, imprimir para assinatura física e fazer upload do escaneado com o botão "Anexar Assinado".
                               </p>
                            </div>
                         </aside>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'financial' && (() => {
                  const mappedEntries = importedFinancial
                    .filter(f => f.archived !== true)
                    .map(f => {
                      const totalAmount = Number(f.amount) || f.value || 0;
                      const paidAmount = f.paidAmount !== undefined ? (Number(f.paidAmount) || 0) : (f.status === 'pago' || f.status === 'paid' ? totalAmount : f.paid_amount || 0);
                      const remainingAmount = f.remainingAmount !== undefined ? (Number(f.remainingAmount) || 0) : (f.status === 'pago' || f.status === 'paid' ? 0 : (f.remaining_amount !== undefined ? Number(f.remaining_amount) : totalAmount));
                      
                      let unifiedStatus: 'pago' | 'parcial' | 'pendente' | 'cancelado' = 'pendente';
                      if (f.status === 'pago' || f.status === 'paid' || remainingAmount <= 0) {
                        unifiedStatus = 'pago';
                      } else if (f.status === 'parcial' || f.status === 'partial' || (paidAmount > 0 && remainingAmount > 0)) {
                        unifiedStatus = 'parcial';
                      } else if (f.status === 'cancelado' || f.status === 'cancelled') {
                        unifiedStatus = 'cancelado';
                      }
                      
                      return {
                        id: f.id,
                        date: f.date || '',
                        description: f.description,
                        category: f.category || 'Importado',
                        method: f.payment_method || '---',
                        value: totalAmount,
                        paidAmount,
                        remainingAmount,
                        status: unifiedStatus,
                        isImported: true,
                        raw: f
                      };
                    }).sort((a, b) => b.date.localeCompare(a.date));

                  const totalEmAberto = mappedEntries.filter(e => e.status !== 'pago' && e.status !== 'cancelado').reduce((acc, e) => acc + e.remainingAmount, 0);
                  const totalRecebido = mappedEntries.filter(e => e.status !== 'cancelado').reduce((acc, e) => acc + e.paidAmount, 0);
                  const totalParcialRecebido = mappedEntries.filter(e => e.status === 'parcial').reduce((acc, e) => acc + e.paidAmount, 0);
                  const totalParcialPendente = mappedEntries.filter(e => e.status === 'parcial').reduce((acc, e) => acc + e.remainingAmount, 0);
                  const quantParcelasPendentes = mappedEntries.filter(e => e.status === 'pendente' || e.status === 'parcial').length;

                  const selectedCount = Object.keys(selectedRowIds).length;
                  const hasSelected = selectedCount > 0;

                  const getRowStatusStyles = (status: 'pago' | 'parcial' | 'pendente' | 'cancelado') => {
                    switch (status) {
                      case 'pago':
                        return {
                          badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                          label: 'Recebido',
                          rowBg: 'hover:bg-slate-50/50'
                        };
                      case 'parcial':
                        return {
                          badge: 'bg-blue-50 text-blue-700 border border-blue-200',
                          label: 'Parcial',
                          rowBg: 'bg-blue-50/10 hover:bg-blue-50/20'
                        };
                      case 'cancelado':
                        return {
                          badge: 'bg-slate-100 text-slate-500 border border-slate-200',
                          label: 'Cancelado',
                          rowBg: 'hover:bg-slate-50/50 opacity-60'
                        };
                      default:
                        return {
                          badge: 'bg-amber-50 text-amber-700 border border-amber-200',
                          label: 'Pendente',
                          rowBg: 'bg-amber-50/10 hover:bg-amber-50/20'
                        };
                    }
                  };

                  return (
                    <div className="space-y-8">
                      {/* Resumo Financeiro Unificado */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                         <div className="bg-white p-5 rounded-3xl border border-slate-200">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total em Aberto</p>
                            <h4 className="text-xl font-black text-amber-600">
                              R$ {totalEmAberto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </h4>
                         </div>
                         <div className="bg-white p-5 rounded-3xl border border-slate-200">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Recebido</p>
                            <h4 className="text-xl font-black text-emerald-600">
                              R$ {totalRecebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </h4>
                         </div>
                         <div className="bg-white p-5 rounded-3xl border border-slate-200">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Parcial (Recebido)</p>
                            <h4 className="text-xl font-black text-blue-600">
                              R$ {totalParcialRecebido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              <span className="text-[9px] font-bold text-slate-400 block mt-0.5">
                                Pendente: R$ {totalParcialPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </h4>
                         </div>
                         <div className="bg-white p-5 rounded-3xl border border-slate-200">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 font-sans">Parcelas Pendentes</p>
                            <h4 className="text-xl font-black text-slate-900">
                              {quantParcelasPendentes}
                            </h4>
                         </div>
                      </div>

                      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                         <div className="p-8 border-b border-slate-50 flex flex-wrap gap-4 justify-between items-center bg-slate-50/50">
                            <div>
                               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Extrato Financeiro do Paciente</h3>
                               <p className="text-[10px] text-slate-400 font-medium mt-1 italic">Incluindo dados importados e lançamentos do sistema</p>
                            </div>
                            <div className="flex gap-2">
                               {hasSelected && (
                                 <button 
                                   onClick={() => {
                                     const selectedEntries = mappedEntries.filter(e => selectedRowIds[e.id]);
                                     console.log("[PAYMENT_MODAL] selected entries:", selectedEntries);
                                     setSelectedEntriesToPay(selectedEntries);
                                     const sumPending = selectedEntries.reduce((acc, e) => acc + e.remainingAmount, 0);
                                     setReceiptForm(prev => ({
                                       ...prev,
                                       amountPaidNow: sumPending,
                                       receivedByName: user?.displayName || ''
                                     }));
                                     setReceiptError(null);
                                     setIsReceiptModalOpen(true);
                                   }}
                                   className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                                 >
                                    <CheckCircle className="w-4 h-4" /> Receber Selecionados ({selectedCount})
                                 </button>
                               )}
                               <button 
                                 onClick={() => detectDuplicatePatientFinancialEntries(selectedPatientId)}
                                 className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                               >
                                  <Trash2 className="w-4 h-4" /> Desduplicar Histórico
                               </button>
                               <button 
                                 onClick={() => setIsFinancialModalOpen(true)}
                                 className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                               >
                                  <DollarSign className="w-4 h-4" /> Lançar Pagamento
                               </button>
                            </div>
                         </div>
                         <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-left">
                              <thead className="bg-slate-50">
                                <tr>
                                  <th className="p-6 w-12 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">
                                    <input 
                                      type="checkbox"
                                      checked={mappedEntries.length > 0 && mappedEntries.filter(e => e.status !== 'pago' && e.status !== 'cancelado').every(e => selectedRowIds[e.id])}
                                      onChange={(e) => {
                                        const check = e.target.checked;
                                        const newIds = { ...selectedRowIds };
                                        mappedEntries.forEach(entry => {
                                          if (entry.status !== 'pago' && entry.status !== 'cancelado') {
                                            if (check) {
                                              newIds[entry.id] = true;
                                            } else {
                                              delete newIds[entry.id];
                                            }
                                          }
                                        });
                                        setSelectedRowIds(newIds);
                                      }}
                                      className="rounded text-teal-600 focus:ring-teal-500 w-4 h-4 border-slate-300"
                                    />
                                  </th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Data</th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Descrição</th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Valores</th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest">Forma</th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                                  <th className="p-6 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Ações</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {mappedEntries.map((row) => {
                                  const styles = getRowStatusStyles(row.status);
                                  const isSelected = !!selectedRowIds[row.id];
                                  const isSelectable = row.status !== 'pago' && row.status !== 'cancelado';
                                  
                                  return (
                                    <tr key={row.id} className={`transition-colors ${styles.rowBg} ${isSelected ? 'bg-slate-50' : ''}`}>
                                      <td className="p-6 text-center">
                                        {isSelectable ? (
                                          <input 
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={(e) => {
                                              setSelectedRowIds(prev => {
                                                const next = { ...prev };
                                                if (e.target.checked) {
                                                  next[row.id] = true;
                                                } else {
                                                  delete next[row.id];
                                                }
                                                return next;
                                              });
                                            }}
                                            className="rounded text-teal-600 focus:ring-teal-500 w-4 h-4 border-slate-300"
                                          />
                                        ) : (
                                          <div className="w-4 h-4 mx-auto" />
                                        )}
                                      </td>
                                      <td className="p-6 text-[10px] font-bold text-slate-500">
                                        {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '---'}
                                      </td>
                                      <td className="p-6">
                                        <p className="text-xs font-bold text-slate-900">{row.description}</p>
                                        <div className="flex gap-1.5 mt-1">
                                          <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                            {row.category}
                                          </span>
                                          {row.isImported && (
                                            <span className="text-[8px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-sky-100">
                                              Importado
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="p-6">
                                        <div className="text-xs font-bold text-slate-900">Total: R$ {row.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                        <div className="text-[10px] text-slate-500 font-medium mt-0.5">Pago: R$ {row.paidAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                        <div className="text-[10px] font-bold text-amber-600 mt-0.5">Pendente: R$ {row.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                                      </td>
                                      <td className="p-6">
                                        <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[9px] font-black uppercase tracking-widest">
                                          {row.method}
                                        </span>
                                      </td>
                                      <td className="p-6 text-center">
                                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${styles.badge}`}>
                                          {styles.label}
                                        </span>
                                      </td>
                                      <td className="p-6 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          {isSelectable && (
                                            <button
                                              onClick={() => {
                                                console.log("[PAYMENT_MODAL] selected entries:", [row]);
                                                setSelectedEntriesToPay([row]);
                                                setReceiptForm(prev => ({
                                                  ...prev,
                                                  amountPaidNow: row.remainingAmount,
                                                  receivedByName: user?.displayName || ''
                                                }));
                                                setReceiptError(null);
                                                setIsReceiptModalOpen(true);
                                              }}
                                              className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[32px] px-3.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 shadow-sm"
                                            >
                                              <CheckCircle className="w-3 h-3" /> Receber
                                            </button>
                                          )}
                                          <button
                                            onClick={() => {
                                              handleOpenDetails(row);
                                            }}
                                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 min-h-[32px] px-3.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                                          >
                                            Ver detalhes
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {mappedEntries.length === 0 && (
                                  <tr>
                                    <td colSpan={7} className="p-20 text-center">
                                      <div className="flex flex-col items-center gap-2 opacity-30">
                                        <CreditCard className="w-12 h-12" />
                                        <p className="text-xs font-bold uppercase tracking-widest">Nenhum registro financeiro vinculado</p>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                          </table>
                         </div>

                          {/* Mobile Bento Ledger Cards */}
                          <div className="block md:hidden border-t border-slate-100 bg-white">
                            {mappedEntries.length === 0 ? (
                              <div className="py-16 text-center text-slate-350 flex flex-col items-center justify-center gap-2 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
                                <CreditCard className="w-10 h-10 opacity-35" />
                                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Nenhum registro financeiro</p>
                              </div>
                            ) : (
                              <div className="p-2 space-y-3">
                                {mappedEntries.map((row) => {
                                  const styles = getRowStatusStyles(row.status);
                                  const isSelected = !!selectedRowIds[row.id];
                                  const isSelectable = row.status !== 'pago' && row.status !== 'cancelado';
                                  
                                  return (
                                    <div 
                                      key={row.id} 
                                      className={`p-4 rounded-2xl border transition-all text-left ${
                                        isSelected 
                                          ? 'border-teal-200 bg-teal-50/10 ring-2 ring-teal-100/25' 
                                          : 'border-slate-100 bg-slate-50/5 hover:bg-slate-50/30'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          {isSelectable ? (
                                            <input 
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={(e) => {
                                                setSelectedRowIds(prev => {
                                                  const next = { ...prev };
                                                  if (e.target.checked) {
                                                    next[row.id] = true;
                                                  } else {
                                                    delete next[row.id];
                                                  }
                                                  return next;
                                                });
                                              }}
                                              className="rounded text-teal-600 focus:ring-teal-500 w-4 h-4 border-slate-350"
                                            />
                                          ) : (
                                            <div className="w-4 h-4" />
                                          )}
                                          <span className="text-[10px] font-bold text-slate-400">
                                            {row.date ? new Date(row.date).toLocaleDateString('pt-BR') : '---'}
                                          </span>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${styles.badge}`}>
                                          {styles.label}
                                        </span>
                                      </div>

                                      <div className="mt-2 text-left">
                                        <p className="text-xs font-bold text-slate-900 leading-snug">{row.description}</p>
                                        <div className="flex gap-1.5 mt-1 flex-wrap">
                                          <span className="text-[8px] bg-slate-100/85 text-slate-550 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                            {row.category}
                                          </span>
                                          {row.isImported && (
                                            <span className="text-[8px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-sky-100">
                                              Importado
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Highlighted Values Grid */}
                                      <div className="grid grid-cols-3 gap-1.5 mt-3 pt-3 border-t border-slate-100 font-sans">
                                        <div>
                                          <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Total</p>
                                          <p className="text-xs font-bold text-slate-900 leading-tight">R$ {row.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div>
                                          <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Pago</p>
                                          <p className="text-xs font-medium text-slate-600 leading-tight">R$ {row.paidAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                        <div>
                                          <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Pendente</p>
                                          <p className="text-xs font-black text-amber-600 leading-tight">R$ {row.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                      </div>

                                      {/* Methods & Actions Container */}
                                      <div className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-slate-100">
                                        <span className="px-2 py-0.5 bg-slate-105 text-slate-600 rounded text-[8px] font-black uppercase tracking-wider">
                                          {row.method}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          {isSelectable && (
                                            <button
                                              onClick={() => {
                                                setSelectedEntriesToPay([row]);
                                                setReceiptForm(prev => ({
                                                  ...prev,
                                                  amountPaidNow: row.remainingAmount,
                                                  receivedByName: user?.displayName || ''
                                                }));
                                                setReceiptError(null);
                                                setIsReceiptModalOpen(true);
                                              }}
                                              className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1 shadow-sm"
                                            >
                                              <CheckCircle className="w-3 h-3" /> Receber
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleOpenDetails(row)}
                                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
                                          >
                                            Ver detalhes
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                      </div>
                    </div>
                  );
                })()}

                {activeTab === 'notes' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-slate-200">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white">
                          <MessageCircle className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900 tracking-tight">Recados do Paciente</h3>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                            Comunicações internas vinculadas a este prontuário
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {patientNotes.map((note) => (
                        <div key={note.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col gap-4">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                note.priority === 'urgente' ? 'bg-rose-50 text-rose-600' :
                                note.priority === 'media' ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-600'
                              }`}>
                                {note.priority}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                                note.status === 'resolvido' ? 'bg-emerald-50 text-emerald-600' :
                                note.status === 'arquivado' ? 'bg-slate-50 text-slate-400' : 'bg-blue-50 text-blue-600'
                              }`}>
                                {note.status.replace('_', ' ')}
                              </span>
                              <h4 className="text-sm font-bold text-slate-900">{note.title}</h4>
                            </div>
                            <span className="text-[10px] text-slate-400 font-bold">
                              {note.createdAt ? new Date(note.createdAt.toDate()).toLocaleDateString('pt-BR') : ''}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 leading-relaxed">{note.message}</p>
                          <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center">
                                  <User className="w-3 h-3 text-slate-400" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">De: {note.created_by_name}</span>
                              </div>
                              {note.assigned_to_name && (
                                <div className="flex items-center gap-2">
                                  <ArrowRight className="w-3 h-3 text-slate-300" />
                                  <span className="text-[10px] font-bold text-teal-600 uppercase tracking-tight">Para: {note.assigned_to_name}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-lg font-bold text-slate-500">{note.sector}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {patientNotes.length === 0 && (
                        <div className="py-20 bg-white rounded-[2rem] border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-slate-300">
                          <MessageCircle className="w-12 h-12 mb-4" />
                          <p className="text-xs font-bold uppercase tracking-widest">Nenhum recado vinculado</p>
                          <p className="text-[10px] mt-1">Recados criados na Central de Recados com este paciente aparecerão aqui.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'aesthetic' && (
                  <div className="space-y-8">
                    {/* Header */}
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 to-slate-950 p-6 lg:p-8 rounded-[2.5rem] text-white border border-indigo-900 shadow-xl">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/30 border border-indigo-400/20 text-[9px] font-black uppercase tracking-widest text-indigo-300">
                            ELIZA Recall Inteligente HOF
                          </span>
                        </div>
                        <h3 className="text-xl font-bold tracking-tight mt-1">Acompanhamento Biológico e Clínico</h3>
                        <p className="text-xs text-indigo-200/90 leading-relaxed max-w-xl">
                          Ciclo de reapplication ativa, controle de durabilidade dos biomateriais e cronologia facial do paciente {selectedPatient?.name}.
                        </p>
                      </div>
                      
                      {/* Active Recall Score Card and Actions */}
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4 lg:self-center">
                          <div className="w-12 h-12 rounded-xl bg-indigo-600/30 text-indigo-300 flex items-center justify-center">
                            <Zap className="w-6 h-6 animate-pulse" />
                          </div>
                          <div>
                            <p className="text-[10px] text-indigo-300 font-bold uppercase tracking-widest">Score de Retorno</p>
                            <p className="text-lg font-black text-rose-350">
                              {(() => {
                                if (patientAesthetics.length === 0) return '50 / 100';
                                const overdueCount = patientAesthetics.filter(p => p.recallStatus === 'overdue').length;
                                const score = 50 + (overdueCount * 15);
                                return `${Math.min(score, 100)} / 100`;
                              })()}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleOpenReturnRequestManual("Recall HOF / Acompanhamento Biológico")}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-500 text-[10px] font-black uppercase tracking-widest px-4 py-3.5 rounded-2xl flex items-center gap-1.5 shadow-sm hover:shadow-md cursor-pointer transition-all self-stretch justify-center"
                        >
                          <CalendarDays className="w-4 h-4 text-indigo-200" /> Solicitar Retorno
                        </button>
                      </div>
                    </div>

                    {/* Resumo Clínico Inteligente */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {/* Last procedures specific metrics */}
                      <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 border-b border-slate-100 pb-3">
                          <Activity className="w-4 h-4 text-indigo-600" /> Resumo de Aplicação e Tempo
                        </h4>

                        <div className="space-y-4">
                          {[
                            { label: 'Toxina Botulínica (Botox)', type: 'Toxina Botulínica' },
                            { label: 'Preenchimento Malar/Labial', type: 'Preenchimento' },
                            { label: 'Bioestimulador de Colágeno', type: 'Bioestimulador' }
                          ].map((cat, i) => {
                            const latest = patientAesthetics
                              .filter(p => p.procedureType === cat.type)
                              .sort((a,b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())[0];
                            
                            const daysAgo = latest ? Math.floor((new Date().getTime() - new Date(latest.appliedAt).getTime()) / (1000 * 60 * 60 * 24)) : null;

                            return (
                              <div key={i} className="p-4 bg-slate-50 border border-slate-200/60 rounded-2xl flex items-center justify-between hover:bg-slate-100/50 transition-all">
                                <div>
                                  <span className="text-xs font-bold text-slate-800 block">{cat.label}</span>
                                  {latest ? (
                                    <div className="text-[10px] text-slate-500 mt-1 space-y-0.5">
                                      <p>Produto: <strong>{latest.productUsed}</strong> ({latest.brand})</p>
                                      <p>Região: <strong>{latest.area}</strong></p>
                                      <p className="text-xs font-semibold text-indigo-600 mt-1">Próxima manutenção: {new Date(latest.recommendedReturnDate).toLocaleDateString('pt-BR')}</p>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 italic block mt-1">Nenhum registro anterior</span>
                                  )}
                                </div>

                                {latest && daysAgo !== null && (
                                  <span className="text-[10px] font-black uppercase tracking-wide px-3 py-1 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100 text-right">
                                    {daysAgo} dias atrás
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Quick launch localized helper form */}
                      <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-4">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 border-b border-slate-100 pb-3">
                          <Plus className="w-4 h-4 text-emerald-600" /> Lançar Aplicação Rápida HOF
                        </h4>

                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          const type = data.get('procedureType') as string;
                          const appliedAt = data.get('appliedAt') as string;
                          const duration = Number(data.get('durationEstimateMonths') || 5);
                          const productUsed = data.get('productUsed') as string;
                          const brand = data.get('brand') as string;
                          const area = data.get('area') as string;
                          const notes = data.get('notes') as string;

                          const returnDateObj = new Date(appliedAt);
                          returnDateObj.setMonth(returnDateObj.getMonth() + duration);
                          const recommendedReturnDate = returnDateObj.toISOString().split('T')[0];

                          let recallStatus: any = 'active';
                          const today = new Date();
                          if (returnDateObj < today) recallStatus = 'overdue';
                          else {
                            const diff = Math.abs(returnDateObj.getTime() - today.getTime());
                            if (Math.ceil(diff / (1000 * 60 * 60 * 24)) <= 30) recallStatus = 'upcoming';
                          }

                          const newProced = {
                            patientId: selectedPatientId,
                            patientName: selectedPatient?.name || 'N/A',
                            procedureType: type,
                            category: 'Harmonização Facial',
                            productUsed: productUsed || 'N/A',
                            brand: brand || 'N/A',
                            area: area || 'Geral',
                            appliedAt,
                            professionalId: user?.uid || 'unknown',
                            professionalName: user?.displayName || 'Dra. Colaboradora',
                            durationEstimateMonths: duration,
                            recommendedReturnDate,
                            recallStatus,
                            notes,
                            createdAt: serverTimestamp(),
                            updatedAt: serverTimestamp()
                          };

                          try {
                            await addDoc(collection(db, 'clinics', clinic.id, 'aesthetic_procedures'), newProced);
                            e.currentTarget.reset();
                            alert("Sucesso! Procedimento lançado no Recall.");
                          } catch (err) {
                            console.error("Error creating procedural in-record:", err);
                          }
                        }} className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block tracking-wider">Procedimento</label>
                              <select name="procedureType" className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-200 bg-white rounded-xl focus:outline-none">
                                <option value="Toxina Botulínica">Toxina Botulínica</option>
                                <option value="Bioestimulador">Bioestimulador</option>
                                <option value="Preenchimento">Preenchimento</option>
                                <option value="Skinbooster">Skinbooster</option>
                                <option value="Fios PDO">Fios PDO</option>
                                <option value="Enzimas">Enzimas</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block tracking-wider">Durabilidade (Meses)</label>
                              <input type="number" name="durationEstimateMonths" defaultValue={5} className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-200 rounded-xl focus:outline-none text-slate-800" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block tracking-wider">Produto / Linha</label>
                              <input type="text" name="productUsed" placeholder="Botox, Jeuveau" className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none text-slate-800" />
                            </div>

                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block tracking-wider">Área Tratada</label>
                              <input type="text" name="area" placeholder="Olhos, Testa, Sulco" className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-none text-slate-800" />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] font-black text-slate-400 uppercase block tracking-wider">Data Aplicação</label>
                              <input type="date" name="appliedAt" defaultValue={new Date().toISOString().split('T')[0]} className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-200 rounded-xl focus:outline-none text-slate-800" />
                            </div>

                            <div className="flex items-end">
                              <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all">
                                Lançar Registro
                              </button>
                            </div>
                          </div>
                        </form>
                      </div>
                    </div>

                    {/* Timeline Estética Visual */}
                    <div className="bg-white p-6 lg:p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 border-b border-slate-100 pb-3">
                        <History className="w-4 h-4 text-indigo-600" /> Cronologia e Evolução HOF
                      </h4>

                      {patientAesthetics.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 text-xs">
                          Nenhum procedimento cronológico lançado para este paciente. Use o formulário acima para criar o histórico!
                        </div>
                      ) : (
                        <div className="relative pl-6 lg:pl-8 border-l border-slate-200 space-y-8 mt-4 ml-2 animate-feed">
                          {patientAesthetics
                            .sort((a,b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
                            .map((proc) => (
                              <div key={proc.id} className="relative">
                                {/* Bullet indicator */}
                                <span className="absolute -left-[30px] lg:-left-[38px] top-1.5 w-4 h-4 rounded-full border-4 border-white shadow-sm bg-indigo-600" />

                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-black text-slate-800">{proc.procedureType}</span>
                                      <span className="text-[9px] text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                                        {new Date(proc.appliedAt).toLocaleDateString('pt-BR')}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                      {/* Recall state */}
                                      <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                                        proc.recallStatus === 'overdue' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                        proc.recallStatus === 'upcoming' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                        proc.recallStatus === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                        'bg-slate-100 text-slate-500'
                                      }`}>
                                        {proc.recallStatus === 'overdue' ? 'Reaplicação Pendente' :
                                         proc.recallStatus === 'upcoming' ? 'Retorno Próximo' :
                                         proc.recallStatus === 'completed' ? 'Agendado' : 'Ativo'}
                                      </span>
                                    </div>
                                  </div>

                                  <p className="text-xs text-slate-600 font-medium">
                                    Produto: <strong className="text-slate-700">{proc.productUsed} ({proc.brand})</strong> na área <strong className="text-slate-750">{proc.area}</strong>.
                                  </p>

                                  {proc.notes && (
                                    <p className="text-[10px] text-slate-500 italic bg-slate-50 border border-slate-150 rounded-xl p-2.5 mt-1">
                                      Observação: {proc.notes}
                                    </p>
                                  )}

                                  <div className="text-[10px] text-slate-400 pt-1 flex items-center justify-between">
                                    <span>Profissional: {proc.professionalName}</span>
                                    <span className="text-indigo-600 font-semibold uppercase tracking-widest text-[8px]">Retorno Ideal: {new Date(proc.recommendedReturnDate).toLocaleDateString('pt-BR')}</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'facial_planning' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex-wrap gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-widest flex items-center gap-1.5">
                          <Brain className="w-4 h-4 text-teal-600" /> Painel de Planejamento de Harmonização
                        </h4>
                        <p className="text-[10px] text-slate-400">Atividades clínicas integradas de harmonização</p>
                      </div>
                      <button
                        onClick={() => handleOpenReturnRequestManual("Sinalização de Planejamento / Harmonização Facial")}
                        className="text-[10px] bg-teal-600 hover:bg-teal-700 text-white font-bold uppercase tracking-widest px-4 py-2.5 rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                      >
                        <CalendarDays className="w-3.5 h-3.5" /> Solicitar Retorno
                      </button>
                    </div>
                    <FacialPlanningView
                      patient={selectedPatient!}
                      anamnesis={anamnesis}
                      images={images}
                      clinic={clinic}
                      user={user}
                      onNavigateToTab={(tabId) => setActiveTab(tabId as RecordTab)}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="h-full flex items-center justify-center p-20 text-center">
               <div className="max-w-xs">
                  <div className="w-20 h-20 bg-slate-100 rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-slate-300">
                     <ClipboardList className="w-10 h-10" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Selecione um Paciente</h3>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">Utilize a barra lateral para buscar ou selecionar o prontuário completo de um paciente para visualização e edição.</p>
               </div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Patient Migration Wizard */}
      <PatientMigrationWizard 
        isOpen={isMigrationWizardOpen}
        onClose={() => setIsMigrationWizardOpen(false)}
        existingPatients={patients}
        onSuccess={(id) => {
          if (loadPatients) {
            loadPatients().then(() => {
              if (id) {
                handleSelect(id);
              }
            });
          } else if (id) {
            handleSelect(id);
          }
        }}
        preselectedPatientId={selectedPatientId}
      />

      {/* Modal: Adicionar Procedimento Histórico Direto */}
      <AnimatePresence>
        {isAddHistoryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddHistoryModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden z-10"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-600 font-sans" /> Lançar Procedimento Concluído
              </h3>
              
              <form onSubmit={handleAddDirectHistory} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição do Procedimento</label>
                  <input 
                    type="text" 
                    required
                    value={historyForm.description}
                    onChange={(e) => setHistoryForm({ ...historyForm, description: e.target.value })}
                    placeholder="Ex: Aplicação de Toxina Botulínica, Preenchimento Labial" 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-medium" 
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profissional Responsável</label>
                    <select
                      required
                      value={historyForm.professionalId}
                      onChange={(e) => setHistoryForm({ ...historyForm, professionalId: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold"
                    >
                      <option value="">Selecione o Profissional...</option>
                      {teamMembers.map(member => (
                        <option key={member.id} value={member.id}>{member.name} ({member.role})</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor do Procedimento (R$)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      value={historyForm.amount}
                      onChange={(e) => setHistoryForm({ ...historyForm, amount: e.target.value })}
                      placeholder="Ex: 1200.00" 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-mono font-bold" 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data de Conclusão</label>
                    <input 
                      type="date" 
                      required
                      value={historyForm.completedAt}
                      onChange={(e) => setHistoryForm({ ...historyForm, completedAt: e.target.value })}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-medium" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Forma de Recebimento</label>
                    <select
                      value={historyForm.paymentMethod}
                      onChange={(e) => setHistoryForm({ ...historyForm, paymentMethod: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold font-sans"
                    >
                      <option value="Pix">Pix</option>
                      <option value="Dinheiro">Dinheiro</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Transferência">Transferência Bancária</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1 font-sans">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Evolução Clínica / Detalhes (Opcional)</label>
                  <textarea 
                    rows={3}
                    value={historyForm.evolutionText}
                    onChange={(e) => setHistoryForm({ ...historyForm, evolutionText: e.target.value })}
                    placeholder="Descreva detalhes ou observações clínicas do procedimento realizado..." 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-medium resize-none text-slate-700 font-sans" 
                  />
                </div>

                <p className="text-[10px] text-slate-450 font-medium leading-normal italic font-sans">
                  * Ao salvar, o procedimento é movido diretamente para o histórico do paciente. Caso informe um valor maior que R$ 0,00, um recebimento será lançado no financeiro e as comissões do profissional serão calculadas automaticamente de acordo com as regras de comissionamento configuradas.
                </p>

                <div className="flex gap-3 pt-4 font-sans">
                  <button 
                    type="button" 
                    onClick={() => setIsAddHistoryModalOpen(false)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-widest rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/10"
                  >
                    Lançar Registro
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Editar Detalhes do Procedimento (Comissão, Responsável, Valor) */}
      <AnimatePresence>
        {isEditingTreatmentModalOpen && editingTreatment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               onClick={() => {
                 setIsEditingTreatmentModalOpen(false);
                 setEditingTreatment(null);
               }}
               className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: 20 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: 20 }}
               className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden z-10 font-sans"
            >
               <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                 <Edit2 className="w-5 h-5 text-teal-600" /> Editar Detalhes do Procedimento
               </h3>

               <form onSubmit={handleSaveEditTreatment} className="space-y-5">
                 <div className="space-y-1">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Nome do Procedimento</label>
                   <input
                     type="text"
                     required
                     value={editTreatmentForm.procedureName}
                     onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, procedureName: e.target.value })}
                     className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold"
                   />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Profissional Responsável</label>
                     <select
                       value={editTreatmentForm.professionalId}
                       onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, professionalId: e.target.value })}
                       className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold"
                     >
                       <option value="">Selecione o Profissional...</option>
                       {staff.map(member => (
                         <option key={member.id} value={member.id}>{member.name} ({member.role})</option>
                       ))}
                     </select>
                   </div>

                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Valor do Procedimento (R$)</label>
                     <input
                       type="number"
                       step="0.01"
                       required
                       value={editTreatmentForm.procedureValue}
                       onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, procedureValue: parseFloat(e.target.value) || 0 })}
                       className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                     />
                   </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Alíquota de Comissão (%)</label>
                     <input
                       type="number"
                       min="0"
                       max="100"
                       required
                       value={editTreatmentForm.commissionPercent}
                       onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, commissionPercent: parseInt(e.target.value) || 0 })}
                       className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                     />
                   </div>

                   <div className="space-y-1">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Status do Procedimento</label>
                     <select
                       value={editTreatmentForm.treatmentStatus}
                       onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, treatmentStatus: e.target.value as any })}
                       className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold"
                     >
                       <option value="Planejado">Planejado</option>
                       <option value="Iniciado">Iniciado</option>
                       <option value="Em andamento">Em andamento</option>
                       <option value="Finalizado">Finalizado</option>
                       <option value="Cancelado">Cancelado</option>
                     </select>
                   </div>
                 </div>

                 <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-800 tracking-tight block">Elegível para Comissão</span>
                      <span className="text-[10px] text-slate-400 font-medium">Se ativado, irá gerar comissão automática ao receber o pagamento.</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={editTreatmentForm.commissionEligible}
                        onChange={(e) => setEditTreatmentForm({ ...editTreatmentForm, commissionEligible: e.target.checked })}
                        className="sr-only peer" 
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-350 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                    </label>
                 </div>

                 <div className="flex gap-4 pt-4 border-t border-slate-100">
                   <button
                     type="button"
                     onClick={() => {
                       setIsEditingTreatmentModalOpen(false);
                       setEditingTreatment(null);
                     }}
                     className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-705 font-bold rounded-xl text-xs transition-colors cursor-pointer text-center text-slate-700"
                   >
                     Cancelar
                   </button>
                   <button
                     type="submit"
                     className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs transition-colors shadow-sm hover:shadow cursor-pointer text-center"
                   >
                     Salvar Mudanças
                   </button>
                 </div>
               </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Finalizar Tratamento Ativo */}
      <AnimatePresence>
        {isFinalizeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFinalizeModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden z-10"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" /> Finalizar Tratamento em Andamento
              </h3>
              
              <form onSubmit={handleSaveFinalizeActive} className="space-y-4">
                <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl mb-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-sans">Procedimento em Foco</h4>
                  <p className="text-sm font-bold text-slate-800 mt-1 font-sans">
                    {treatments.find(t => t.id === selectedFinalizeTreatmentId)?.description}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">Profissional Responsável</label>
                    <select
                      required
                      value={finalizeForm.professionalId}
                      onChange={(e) => setFinalizeForm({ ...finalizeForm, professionalId: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold font-sans"
                    >
                      <option value="">Selecione o Profissional...</option>
                      {(() => {
                        const clinicalRoles = [
                          "dentist", "dentist_gp", "cirurgiao_dentista", "cirurgião dentista",
                          "especialista", "professional", "clinical_professional", "doctor",
                          "dentista", "odontologista", "clinico"
                        ];
                        const clinicalStaff = staff.filter((member) => {
                          if (member.active === false || member.status === "inactive") return false;
                          if (member.isClinicalProvider === true || member.isClinical === true || member.providesCare === true || member.provides_care === true || member.agendaLiberada === true || member.calendarEnabled === true) {
                            return true;
                          }
                          const role = (member.role || "").toLowerCase().trim();
                          return clinicalRoles.includes(role);
                        });
                        return clinicalStaff.map(member => (
                          <option key={member.id} value={member.id}>{member.name} ({member.role || 'Clínico'})</option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div className="space-y-1 font-sans">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data de Conclusão</label>
                    <input 
                      type="date" 
                      required
                      value={finalizeForm.completedAt}
                      onChange={(e) => setFinalizeForm({ ...finalizeForm, completedAt: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-emerald-600 font-bold" 
                    />
                  </div>
                </div>

                <p className="text-[10px] text-slate-450 font-medium leading-normal italic font-sans font-sans">
                  * Ao finalizar o tratamento, o histórico será registrado permanentemente. Opcionalmente, um recebimento de valor será criado no financeiro para o profissional responsável.
                </p>

                <div className="flex gap-3 pt-4 font-sans font-sans">
                  <button 
                    type="button" 
                    onClick={() => {
                      setIsFinalizeModalOpen(false);
                      setSelectedFinalizeTreatmentId(null);
                    }}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-widest rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-emerald-600/10"
                  >
                    Finalizar Procedimento
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WhatsApp Modal for Patient (Part 1, 5) */}
      <AnimatePresence>
        {isWhatsAppModalOpen && selectedPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWhatsAppModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[550px] border border-slate-100"
            >
              {/* Sidebar/Menu */}
              <div className="w-full md:w-64 bg-slate-900 text-white p-6 md:p-8 flex flex-col justify-between shrink-0">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-teal-400">WhatsApp ELIZA</h3>
                    <p className="text-[10px] text-slate-400 font-medium mt-1 truncate">Paciente: {selectedPatient.name}</p>
                  </div>

                  <nav className="flex flex-row md:flex-col gap-2 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
                    <button
                      onClick={() => {
                        setWhatsAppActiveTab('send');
                        setWhatsAppSendStatus(null);
                      }}
                      className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-left transition-all shrink-0 cursor-pointer ${
                        whatsAppActiveTab === 'send' ? 'bg-teal-600 text-white shadow' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-755'
                      }`}
                    >
                      ✉️ Enviar via API
                    </button>
                    
                    <a
                      href={`https://wa.me/${selectedPatient.phone?.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-left transition-all shrink-0 bg-emerald-700 text-white hover:bg-emerald-600 flex items-center justify-between"
                    >
                      <span>↗️ Abrir WhatsApp Web</span>
                    </a>

                    <button
                      onClick={async () => {
                        setWhatsAppActiveTab('history');
                        setIsLoadingConvoHistory(true);
                        try {
                          const q = query(
                            collection(db, 'clinics', clinic.id, 'whatsapp_conversations'),
                            where('patientId', '==', selectedPatient.id),
                            orderBy('lastMessageAt', 'desc'),
                            limit(1)
                          );
                          const snap = await getDocs(q);
                          if (!snap.empty) {
                            const convoId = snap.docs[0].id;
                            const msgSnap = await getDocs(query(
                              collection(db, 'clinics', clinic.id, 'whatsapp_conversations', convoId, 'messages'),
                              orderBy('timestamp', 'asc'),
                              limit(30)
                            ));
                            setWaConvoHistory(msgSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                          } else {
                            setWaConvoHistory([]);
                          }
                        } catch (err) {
                          console.error(err);
                          setWaConvoHistory([]);
                        } finally {
                          setIsLoadingConvoHistory(false);
                        }
                      }}
                      className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-left transition-all shrink-0 cursor-pointer ${
                        whatsAppActiveTab === 'history' ? 'bg-teal-600 text-white shadow' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-755'
                      }`}
                    >
                      📜 Ver Histórico
                    </button>

                    <button
                      onClick={async () => {
                        setWhatsAppActiveTab('link');
                        setIsLoadingConvoHistory(true);
                        try {
                          const q = query(
                            collection(db, 'clinics', clinic.id, 'whatsapp_conversations'),
                            limit(15)
                          );
                          const snap = await getDocs(q);
                          const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                          setWaConvoHistory(list.filter((c: any) => !c.patientId || c.patientId !== selectedPatient.id));
                        } catch (err) {
                          console.error(err);
                          setWaConvoHistory([]);
                        } finally {
                          setIsLoadingConvoHistory(false);
                        }
                      }}
                      className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-left transition-all shrink-0 cursor-pointer ${
                        whatsAppActiveTab === 'link' ? 'bg-teal-600 text-white shadow' : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-755'
                      }`}
                    >
                      🔗 Vincular Conversa
                    </button>
                  </nav>
                </div>

                <button
                  onClick={() => setIsWhatsAppModalOpen(false)}
                  className="hidden md:block py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer mt-auto"
                >
                  Fechar Painel
                </button>
              </div>

              {/* Dynamic Panel Content */}
              <div className="flex-1 p-8 overflow-y-auto flex flex-col justify-between h-auto">
                <div className="space-y-6">
                  {whatsAppActiveTab === 'menu' && (
                    <div className="space-y-4">
                      <h4 className="text-base font-black uppercase tracking-tight text-slate-800">Selecione uma ação</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Escolha uma das funcionalidades integradas pelo assistente de Inteligência Artificial da ELIZA.
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                        <button
                          onClick={() => {
                            setWhatsAppActiveTab('send');
                            setWhatsAppSendStatus(null);
                          }}
                          className="p-6 bg-slate-50 hover:bg-teal-50 border border-slate-150 rounded-2xl text-left transition-all flex flex-col gap-2 group cursor-pointer"
                        >
                          <span className="text-lg font-bold text-slate-850">✉️ Enviar Mensagem</span>
                          <span className="text-[10px] text-slate-400 group-hover:text-slate-650">Enviar mensagem rápida via Cloud API oficial do WhatsApp</span>
                        </button>
                        
                        <a
                          href={`https://wa.me/${selectedPatient.phone?.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-6 bg-slate-50 hover:bg-emerald-50 border border-slate-150 rounded-2xl text-left transition-all flex flex-col gap-2 group cursor-pointer"
                        >
                          <span className="text-lg font-bold text-slate-855">↗️ Abrir WhatsApp Web</span>
                          <span className="text-[10px] text-slate-400 group-hover:text-slate-650">Abra link wa.me direto no navegador sem depender dos webhooks da API</span>
                        </a>
                      </div>
                    </div>
                  )}

                  {whatsAppActiveTab === 'send' && (
                    <div className="space-y-4">
                      <h4 className="text-base font-black uppercase tracking-tight text-slate-800">Enviar Mensagem pela ELIZA</h4>
                      <p className="text-xs text-slate-400 font-medium font-semibold">Escreva uma mensagem de evolução, aviso ou orçamento para enviar diretamente:</p>

                      <div className="pt-2">
                        <textarea
                          placeholder="Olá, como vai? Estou entrando em contato para passar seu orçamento da ELIZA..."
                          value={whatsAppMsgText}
                          onChange={(e) => setWhatsAppMsgText(e.target.value)}
                          className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 transition-all font-sans font-bold"
                        />
                      </div>

                      {whatsAppSendStatus && (
                        <div className={`p-4 rounded-xl border text-xs font-bold leading-normal ${
                          whatsAppSendStatus.success ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-rose-50 border-rose-100 text-rose-800'
                        }`}>
                          {whatsAppSendStatus.message}
                        </div>
                      )}
                    </div>
                  )}

                  {whatsAppActiveTab === 'history' && (
                    <div className="space-y-4">
                      <h4 className="text-base font-black uppercase tracking-tight text-slate-800">Histórico de Mensagens</h4>
                      <p className="text-xs text-slate-400 font-medium font-semibold">Exibindo os últimos logs de mensagens trocadas com o paciente do WhatsApp:</p>

                      <div className="border border-slate-150 rounded-2xl overflow-hidden max-h-72 overflow-y-auto p-4 bg-slate-50 space-y-3">
                        {isLoadingConvoHistory ? (
                          <p className="text-xs text-slate-450 animate-pulse text-center py-8 font-black uppercase tracking-wider">Carregando histórico...</p>
                        ) : waConvoHistory.length === 0 ? (
                          <div className="py-8 text-center text-slate-450">
                            <p className="text-xs font-black uppercase tracking-wider">Histórico limpo</p>
                            <p className="text-[10px] text-slate-400 mt-1 font-semibold">Nenhuma mensagem registrada via API para este paciente.</p>
                          </div>
                        ) : (
                          waConvoHistory.map((m: any) => (
                            <div key={m.id} className={`p-3.5 rounded-xl border max-w-[85%] text-xs ${
                              m.direction === 'outbound' ? 'bg-teal-50 border-teal-100 text-teal-900 self-end ml-auto' : 'bg-white border-slate-200 text-slate-850'
                            }`}>
                              <p className="font-semibold leading-relaxed">{m.text || m.content}</p>
                              <span className="text-[8px] font-bold opacity-60 mt-1 block text-right">
                                {m.timestamp ? new Date(m.timestamp.toDate ? m.timestamp.toDate() : m.timestamp).toLocaleString() : 'Recent'}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {whatsAppActiveTab === 'link' && (
                    <div className="space-y-4">
                      <h4 className="text-base font-black uppercase tracking-tight text-slate-800">Vincular Conversa Existente</h4>
                      <p className="text-xs text-slate-400 font-medium font-bold">Selecione uma conversa ativa do painel para vincular ao cadastro {selectedPatient.name}:</p>

                      <div className="border border-slate-150 rounded-2xl overflow-hidden max-h-72 overflow-y-auto p-4 bg-slate-50 space-y-2">
                        {isLoadingConvoHistory ? (
                          <p className="text-xs text-slate-450 animate-pulse text-center py-8 font-black">Pesquisando conversas...</p>
                        ) : waConvoHistory.length === 0 ? (
                          <p className="text-xs text-slate-450 text-center py-8 font-semibold">Nenhuma conversa pendente para vincular.</p>
                        ) : (
                          waConvoHistory.map((convo: any) => (
                            <div key={convo.id} className="bg-white border border-slate-150 rounded-xl p-3 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <span className="text-xs font-bold font-mono text-slate-800">+{convo.id}</span>
                                <p className="text-[10px] text-slate-400 truncate mt-0.5 font-medium">{convo.lastMessage || 'Sem mensagem...'}</p>
                              </div>
                              <button
                                onClick={async () => {
                                  if (confirm(`Deseja vincular o número +${convo.id} a este paciente?`)) {
                                    // link operation inline
                                    if (!clinic?.id || !selectedPatient) return;
                                    try {
                                      const convoRef = doc(db, 'clinics', clinic.id, 'whatsapp_conversations', convo.id);
                                      await updateDoc(convoRef, {
                                        patientId: selectedPatient.id,
                                        patientName: selectedPatient.name,
                                        patientPhone: selectedPatient.phone,
                                        matchedPatient: true
                                      });
                                      
                                      const normalizedPhone = convo.id;
                                      if (!selectedPatient.phone || selectedPatient.phone.replace(/\D/g, '') !== normalizedPhone) {
                                        const patientRef = doc(db, 'clinics', clinic.id, 'patients', selectedPatient.id);
                                        await updateDoc(patientRef, {
                                          phone: normalizedPhone
                                        });
                                      }
                                      
                                      alert("Conversa vinculada com sucesso!");
                                      setIsWhatsAppModalOpen(false);
                                    } catch (err: any) {
                                      alert("Erro ao vincular: " + err.message);
                                    }
                                  }
                                }}
                                className="px-3 py-1.5 bg-teal-650 hover:bg-teal-700 text-white font-black uppercase tracking-widest text-[8px] rounded-lg transition-all shadow-sm cursor-pointer"
                              >
                                Vincular
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-slate-100 flex items-center justify-between mt-6 shrink-0">
                  <button
                    onClick={() => setIsWhatsAppModalOpen(false)}
                    className="md:hidden px-4 py-2.5 bg-slate-100 hover:bg-slate-250 rounded-xl text-[10px] font-black uppercase text-slate-700 cursor-pointer text-xs"
                  >
                    Fechar
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    {whatsAppActiveTab === 'send' && (
                      <button
                        onClick={async () => {
                          if (!clinic?.id || !selectedPatient || !whatsAppMsgText.trim()) return;
                          setIsSendingWhatsAppMsg(true);
                          setWhatsAppSendStatus(null);
                          const normalizedPhone = (selectedPatient.phone || '').replace(/\D/g, '');
                          
                          try {
                            const response = await fetch('/api/whatsapp/send', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json'
                              },
                              body: JSON.stringify({
                                clinicId: clinic.id,
                                conversationId: normalizedPhone,
                                text: whatsAppMsgText
                              })
                            });
                            
                            const resData = await response.json();
                            if (!response.ok) {
                              throw new Error(resData.error || 'Erro ao enviar mensagem.');
                            }
                            
                            const convoRef = doc(db, 'clinics', clinic.id, 'whatsapp_conversations', normalizedPhone);
                            await setDoc(convoRef, {
                              patientId: selectedPatient.id,
                              patientName: selectedPatient.name,
                              patientPhone: selectedPatient.phone,
                              matchedPatient: true,
                              lastMessage: whatsAppMsgText,
                              lastMessageAt: serverTimestamp()
                            }, { merge: true });
                            
                            setWhatsAppSendStatus({ success: true, message: 'Mensagem enviada com sucesso!' });
                            setWhatsAppMsgText('');
                          } catch (err: any) {
                            console.error(err);
                            setWhatsAppSendStatus({ success: false, message: err.message || 'Falha no envio.' });
                          } finally {
                            setIsSendingWhatsAppMsg(false);
                          }
                        }}
                        disabled={isSendingWhatsAppMsg || !whatsAppMsgText.trim()}
                        className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-teal-600/10 cursor-pointer select-none flex items-center gap-2 text-xs font-bold"
                      >
                        {isSendingWhatsAppMsg && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        Disparar Mensagem API
                      </button>
                    )}
                  </div>
                </div>

              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WhatsApp Flow Selection Menu (Part 1) */}
      <AnimatePresence>
        {isWhatsAppMenuOpen && selectedPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWhatsAppMenuOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-white rounded-[2rem] shadow-2xl p-6 md:p-8 border border-slate-100 flex flex-col gap-5 z-10"
            >
              <div>
                <span className="text-[9px] bg-emerald-50 text-emerald-700 font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-widest">
                  Menu Híbrido WhatsApp
                </span>
                <h3 className="text-base font-black text-slate-900 mt-2">
                  Como deseja contatar o paciente?
                </h3>
                <p className="text-[11px] text-slate-500 font-medium leading-normal mt-1">
                  Paciente: <span className="font-bold text-slate-700">{selectedPatient.name}</span> ({selectedPatient.phone || 'Sem celular'})
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                {/* 1. External WhatsApp Web */}
                <button
                  onClick={() => {
                    const cleanPhone = selectedPatient.phone ? selectedPatient.phone.replace(/\D/g, '') : '';
                    window.open(`https://wa.me/${cleanPhone.startsWith('55') ? '' : '55'}${cleanPhone}`, '_blank', 'noreferrer,noopener');
                    setIsWhatsAppMenuOpen(false);
                  }}
                  className="w-full p-4 hover:bg-slate-50 border border-slate-200/80 rounded-2xl text-left transition-all active:scale-[0.99] flex items-start gap-3 group cursor-pointer"
                >
                  <span className="text-xl shrink-0 select-none">↗️</span>
                  <div>
                    <span className="block text-xs font-bold text-slate-800 group-hover:text-emerald-600 transition-colors">
                      Abrir WhatsApp Externo (wa.me)
                    </span>
                    <span className="block text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">
                      Recomendado. Abre nova aba direto no WhatsApp convencional com o telefone do paciente. Funciona sempre.
                    </span>
                  </div>
                </button>

                {/* 2. Enviar via ELIZA API */}
                <button
                  onClick={() => {
                    setWhatsAppActiveTab('send');
                    setWhatsAppSendStatus(null);
                    setIsWhatsAppModalOpen(true);
                    setIsWhatsAppMenuOpen(false);
                  }}
                  className="w-full p-4 hover:bg-slate-50 border border-slate-200/80 rounded-2xl text-left transition-all active:scale-[0.99] flex items-start gap-3 group cursor-pointer"
                >
                  <span className="text-xl shrink-0 select-none">✉️</span>
                  <div>
                    <span className="block text-xs font-bold text-slate-800 group-hover:text-teal-600 transition-colors">
                      Enviar pela ELIZA (Cloud API)
                    </span>
                    <span className="block text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">
                      Ativo somente se a integração estiver ativa. Abre o formulário simples para digitar e registrar na conversa.
                    </span>
                  </div>
                </button>

                {/* 3. Central de Atendimento CRM */}
                <button
                  onClick={() => {
                    if (selectedPatientId && onNavigateToChat) {
                      sessionStorage.setItem('eliza_pending_chat_patient_id', selectedPatientId);
                      if (selectedPatient.phone) {
                        sessionStorage.setItem('eliza_pending_chat_phone', selectedPatient.phone);
                      }
                      onNavigateToChat(selectedPatientId);
                    } else {
                      setWhatsAppActiveTab('history');
                      setIsWhatsAppModalOpen(true);
                    }
                    setIsWhatsAppMenuOpen(false);
                  }}
                  className="w-full p-4 hover:bg-slate-50 border border-slate-200/80 rounded-2xl text-left transition-all active:scale-[0.99] flex items-start gap-3 group cursor-pointer"
                >
                  <span className="text-xl shrink-0 select-none">📜</span>
                  <div>
                    <span className="block text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                      Ver Histórico na Central ELIZA
                    </span>
                    <span className="block text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">
                      Abre a Central de Atendimento de mensagens filtrada neste paciente para conferir ou responder chats em andamento.
                    </span>
                  </div>
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setIsWhatsAppMenuOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Editar Paciente */}
      <AnimatePresence>
        {isEditModalOpen && selectedPatient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-8 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-teal-600" /> Editar Cadastro
              </h3>
              
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const updatedData = {
                  name: formData.get('name') as string,
                  phone: formData.get('phone') as string,
                  email: formData.get('email') as string,
                  cpf: formData.get('cpf') as string,
                  address: formData.get('address') as string,
                  birthDate: formData.get('birthDate') as string,
                };
                try {
                  const isLegacy = selectedPatient?._isLegacy;
                  const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
                  await setDoc(doc(db, patientBasePath), updatedData, { merge: true });
                  await loadPatients();
                  setIsEditModalOpen(false);
                } catch (err) {
                  const isLegacy = selectedPatient?._isLegacy;
                  const patientBasePath = isLegacy ? `patients/${selectedPatientId}` : `clinics/${clinic.id}/patients/${selectedPatientId}`;
                  handleFirestoreError(err, OperationType.UPDATE, patientBasePath);
                }
              }} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome Completo</label>
                    <input name="name" defaultValue={selectedPatient.name} required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Celular / WhatsApp</label>
                    <input name="phone" defaultValue={selectedPatient.phone} required className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CPF</label>
                    <input name="cpf" defaultValue={selectedPatient.cpf} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data Nasc.</label>
                    <input name="birthDate" type="date" defaultValue={selectedPatient.birthDate} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</label>
                  <input name="email" defaultValue={selectedPatient.email} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Endereço</label>
                  <input name="address" defaultValue={selectedPatient.address} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                </div>

                <div className="pt-6 flex gap-3">
                  <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all">Salvar Alterações</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Novo Orçamento */}
      <AnimatePresence>
        {isQuotationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 lg:p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { setIsQuotationModalOpen(false); setIsMobileSummaryOpen(false); }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full h-full lg:max-w-4xl lg:h-[80vh] bg-white lg:rounded-[2.5rem] shadow-2xl flex flex-col lg:flex-row overflow-hidden"
            >
              {/* Left Side: Form */}
              <div className="flex-1 p-6 lg:p-10 overflow-y-auto custom-scrollbar pb-32 lg:pb-10">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-lg lg:text-xl font-bold text-slate-900 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-teal-600" /> {editingQuotationId ? 'Editar Orçamento Clínico' : 'Novo Orçamento Clínico'}
                  </h3>
                  <button onClick={() => setIsQuotationModalOpen(false)} className="lg:hidden p-2 text-slate-400">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Título do Orçamento</label>
                      <input 
                        value={quotationForm.title || ''} 
                        onChange={(e) => setQuotationForm({...quotationForm, title: e.target.value})}
                        placeholder="Ex: Reabilitação Posterior" 
                        className="w-full px-4 py-3 lg:py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável</label>
                      <select 
                        value={quotationForm.responsible || ''}
                        onChange={(e) => setQuotationForm({...quotationForm, responsible: e.target.value})}
                        className="w-full px-4 py-3 lg:py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      >
                        <option value="">Selecione um profissional</option>
                        {staff.map(s => <option key={s.id} value={s.name}>{s.name} ({s.role})</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="p-5 lg:p-6 bg-slate-50 rounded-[2rem] border border-slate-100 space-y-6">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adicionar Procedimento</h4>
                    
                    {!currentProcedure.procedureId ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Selecione o Procedimento</label>
                          <button
                            type="button"
                            onClick={() => {
                              setNewQuickTreatment({
                                name: procedureSearch,
                                category: 'Harmonização Facial',
                                subcategory: '',
                                defaultPrice: 0,
                                description: ''
                              });
                              setIsNewTreatmentModalOpen(true);
                            }}
                            className="text-[9px] font-black text-teal-600 hover:text-teal-700 uppercase tracking-wider flex items-center gap-1 active:scale-[0.98]"
                          >
                            + Novo tratamento
                          </button>
                        </div>

                        {/* Filter Search */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                          <input 
                            type="text"
                            placeholder="Buscar tratamento no catálogo..."
                            value={procedureSearch}
                            onChange={(e) => setProcedureSearch(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                          />
                        </div>

                        {/* Category filter pills */}
                        <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-3">
                          {['Todas', ...TREATMENT_CATEGORIES].map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setProcedureCategory(cat)}
                              className={`px-2.5 py-1 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                                procedureCategory === cat 
                                  ? 'bg-teal-600 text-white shadow-sm' 
                                  : 'bg-white border border-slate-150 text-slate-500 hover:bg-slate-50'
                              }`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>

                        {/* List area */}
                        <div className="max-h-48 overflow-y-auto space-y-1 custom-scrollbar bg-white p-2 border border-slate-100 rounded-2xl">
                          {procedures
                            .filter(item => {
                              if (!item.active) return false;
                              const matchesSearch = item.name.toLowerCase().includes(procedureSearch.toLowerCase()) || 
                                                    (item.description && item.description.toLowerCase().includes(procedureSearch.toLowerCase()));
                              const matchesCat = procedureCategory === 'Todas' || item.category === procedureCategory;
                              return matchesSearch && matchesCat;
                            })
                            .map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setCurrentProcedure({
                                    procedureId: item.id,
                                    value: item.defaultPrice,
                                    quantity: 1,
                                    observation: '',
                                    tooth: '',
                                    region: '',
                                    faces: []
                                  });
                                }}
                                className="w-full text-left p-2 hover:bg-slate-55 rounded-xl flex items-center justify-between border border-transparent hover:border-slate-100 transition-all group"
                              >
                                <div className="min-w-0 pr-2">
                                  <p className="text-xs font-bold text-slate-800 tracking-tight leading-none group-hover:text-teal-600 transition-colors">{item.name}</p>
                                  {item.subcategory && (
                                    <p className="text-[9px] text-slate-400 font-medium mt-1 leading-none">{item.category} • {item.subcategory}</p>
                                  )}
                                </div>
                                <span className="text-[9px] font-black text-slate-700 bg-slate-55 px-2 py-1 rounded-lg group-hover:bg-teal-50 group-hover:text-teal-600 transition-all shrink-0">
                                  R$ {item.defaultPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>
                              </button>
                            ))}

                          {procedures.filter(item => {
                            if (!item.active) return false;
                            const matchesSearch = item.name.toLowerCase().includes(procedureSearch.toLowerCase()) || 
                                                  (item.description && item.description.toLowerCase().includes(procedureSearch.toLowerCase()));
                            const matchesCat = procedureCategory === 'Todas' || item.category === procedureCategory;
                            return matchesSearch && matchesCat;
                          }).length === 0 && (
                            <div className="text-center py-6">
                              <p className="text-[9px] font-bold text-slate-300 uppercase tracking-wider">Nenhum procedimento encontrado</p>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewQuickTreatment({
                                    name: procedureSearch,
                                    category: procedureCategory === 'Todas' ? 'Harmonização Facial' : procedureCategory,
                                    subcategory: '',
                                    defaultPrice: 0,
                                    description: ''
                                  });
                                  setIsNewTreatmentModalOpen(true);
                                }}
                                className="text-[9px] font-black text-teal-600 hover:underline mt-1"
                              >
                                Cadastrar "+ {procedureSearch || 'Novo'}"
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {(() => {
                          const selectedProc = procedures.find(p => p.id === currentProcedure.procedureId);
                          if (!selectedProc) return null;
                          return (
                            <div className="space-y-4">
                              {/* Selected Info Card */}
                              <div className="p-4 bg-white border border-teal-100/65 rounded-xl flex items-center justify-between shadow-sm">
                                <div>
                                  <span className="text-[8px] font-extrabold text-teal-600 bg-teal-50 border border-teal-100/50 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                    {selectedProc.category}
                                  </span>
                                  <h5 className="text-xs font-bold text-slate-800 tracking-tight mt-1 leading-snug">{selectedProc.name}</h5>
                                  <p className="text-[9px] text-slate-400 font-medium">Preço Catálogo: R$ {selectedProc.defaultPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCurrentProcedure({ procedureId: '', value: 0, quantity: 1, observation: '', tooth: '', region: '', faces: [] })}
                                  className="text-[9px] font-bold text-rose-500 hover:text-rose-600 uppercase tracking-widest bg-rose-50 px-3 py-1.5 rounded-lg transition-all"
                                >
                                  Alterar / Limpar
                                </button>
                              </div>

                              {/* Inputs: Price & Quantity */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Valor Cobrado (R$)</label>
                                  <input 
                                    type="number"
                                    value={currentProcedure.value || 0}
                                    onChange={(e) => setCurrentProcedure({...currentProcedure, value: Number(e.target.value)})}
                                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600" 
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Quantidade</label>
                                  <div className="flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() => setCurrentProcedure({...currentProcedure, quantity: Math.max(1, currentProcedure.quantity - 1)})}
                                      className="px-3 py-2 bg-slate-50 hover:bg-slate-100 font-black text-slate-500 text-xs shrink-0 select-none transition-all"
                                    >
                                      -
                                    </button>
                                    <input 
                                      type="number"
                                      value={currentProcedure.quantity}
                                      onChange={(e) => setCurrentProcedure({...currentProcedure, quantity: Math.max(1, parseInt(e.target.value) || 1)})}
                                      className="w-full text-center text-xs font-bold bg-transparent outline-none py-1 h-full" 
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setCurrentProcedure({...currentProcedure, quantity: currentProcedure.quantity + 1})}
                                      className="px-3 py-2 bg-slate-50 hover:bg-slate-100 font-black text-slate-500 text-xs shrink-0 select-none transition-all"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Region Extra Parameters */}
                              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Dente (Opcional)</label>
                                  <select 
                                    value={currentProcedure.tooth || ''}
                                    onChange={(e) => setCurrentProcedure({...currentProcedure, tooth: e.target.value})}
                                    className="w-full px-4 py-2.5 bg-white border border-slate-205 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                                  >
                                    <option value="">Nenhum</option>
                                    {[11,12,13,14,15,16,17,18, 21,22,23,24,25,26,27,28, 31,32,33,34,35,36,37,38, 41,42,43,44,45,46,47,48].map(t => (
                                      <option key={t} value={t}>{t}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Região (Opcional)</label>
                                  <input 
                                    value={currentProcedure.region || ''}
                                    onChange={(e) => setCurrentProcedure({...currentProcedure, region: e.target.value})}
                                    placeholder="Ex: Quadrante 1"
                                    className="w-full px-4 py-2.5 bg-white border border-slate-205 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                                  />
                                </div>
                              </div>

                              {/* Faces list selection */}
                              <div className="space-y-1 border-t border-slate-100 pt-3">
                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Faces do Dente</label>
                                <div className="flex gap-1">
                                   {['O', 'M', 'D', 'V', 'L'].map(f => (
                                     <button 
                                       key={f}
                                       type="button"
                                       onClick={() => {
                                         const faces = currentProcedure.faces.includes(f) 
                                           ? currentProcedure.faces.filter(face => face !== f)
                                           : [...currentProcedure.faces, f];
                                         setCurrentProcedure({...currentProcedure, faces});
                                       }}
                                       className={`flex-1 h-9 rounded-lg text-[9px] font-bold flex items-center justify-center border transition-all ${
                                         currentProcedure.faces.includes(f) ? 'bg-teal-600 border-teal-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                                       }`}
                                     >
                                       {f}
                                     </button>
                                   ))}
                                </div>
                              </div>

                              {/* Additional Observations */}
                              <div className="space-y-1 border-t border-slate-100 pt-3">
                                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Observações deste Tratamento</label>
                                <input 
                                  value={currentProcedure.observation || ''}
                                  onChange={(e) => setCurrentProcedure({...currentProcedure, observation: e.target.value})}
                                  placeholder="Ex: Desconto de plano ou detalhe da resina..."
                                  className="w-full px-4 py-2.5 bg-white border border-slate-202 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <button 
                      onClick={addProcedureToQuotation}
                      disabled={!currentProcedure.procedureId || !currentProcedure.value}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-slate-900/20 active:scale-[0.98]"
                    >
                      <Plus className="w-4 h-4" /> Adicionar à Lista
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Summary Sticky Bar */}
              <div className="lg:hidden fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-100 flex items-center justify-between z-10 safe-area-inset-bottom">
                 <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                       {quotationForm.items.length} {quotationForm.items.length === 1 ? 'item' : 'itens'}
                    </span>
                    <span className="text-sm font-black text-slate-900 leading-none">
                       R$ {quotationForm.items.reduce((acc, i) => acc + (i.value * (i.quantity || 1)), 0).toLocaleString()}
                    </span>
                 </div>
                 <button 
                   onClick={() => setIsMobileSummaryOpen(true)}
                   className="bg-teal-600 text-white px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 active:scale-[0.98]"
                 >
                    Ver Resumo
                 </button>
              </div>

              {/* Desktop Summary Sidebar (Hidden on Mobile) */}
              <div className="hidden lg:flex lg:w-[320px] bg-slate-50 border-l border-slate-100 p-10 flex-col">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Resumo do Plano</h4>
                <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar font-sans">
                  {quotationForm.items.length === 0 ? (
                    <div className="h-40 border-2 border-dashed border-slate-100 rounded-3xl flex items-center justify-center text-center p-4">
                      <p className="text-[10px] text-slate-300 font-bold uppercase">Nenhum item adicionado</p>
                    </div>
                  ) : (
                    quotationForm.items.map((item, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 relative group">
                        <button 
                          onClick={() => setQuotationForm({...quotationForm, items: quotationForm.items.filter((_, i) => i !== idx)})}
                          className="absolute -top-2 -right-2 w-5 h-5 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border border-rose-100"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                        <p className="text-[10px] font-bold text-slate-900 leading-tight">{item.description}</p>
                        <div className="flex items-center justify-between mt-2.5">
                          <p className="text-[10px] font-medium text-slate-450 uppercase tracking-tighter">Qtd: {item.quantity || 1}</p>
                          <p className="text-[11px] font-black text-teal-600">
                            R$ {(item.value * (item.quantity || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="pt-6 border-t border-slate-100 mt-6">
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Total Estimado</span>
                    <span className="text-xl font-black text-slate-900">
                      R$ {quotationForm.items.reduce((acc, i) => acc + (i.value * (i.quantity || 1)), 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <button 
                      onClick={handleSaveQuotation}
                      disabled={quotationForm.items.length === 0}
                      className="w-full py-4 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircle className="w-4 h-4" /> Salvar Orçamento
                    </button>
                    <button 
                      onClick={() => setIsQuotationModalOpen(false)}
                      className="w-full py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Bottom Sheet Summary */}
              <AnimatePresence>
                {isMobileSummaryOpen && (
                  <>
                    <motion.div 
                      key="summary-backdrop"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setIsMobileSummaryOpen(false)}
                      className="lg:hidden absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-20"
                    />
                    <motion.div 
                      key="summary-sheet"
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      exit={{ y: '100%' }}
                      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                      className="lg:hidden absolute bottom-0 left-0 right-0 bg-white rounded-t-[2.5rem] shadow-2xl z-30 p-8 flex flex-col max-h-[75vh]"
                    >
                      <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-6" />
                      <div className="flex justify-between items-center mb-8">
                        <h4 className="text-lg font-black text-slate-900 tracking-tight">Resumo do orçamento</h4>
                        <button 
                          onClick={() => setIsMobileSummaryOpen(false)}
                          className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-4 mb-8 custom-scrollbar">
                        {quotationForm.items.length === 0 ? (
                          <div className="py-12 border-2 border-dashed border-slate-50 rounded-3xl flex flex-col items-center justify-center text-slate-300">
                             <ClipboardList className="w-8 h-8 mb-2" />
                             <p className="text-[10px] font-bold uppercase">Orçamento Vazio</p>
                          </div>
                        ) : (
                          quotationForm.items.map((item, idx) => (
                            <div key={idx} className="bg-slate-50 p-4 rounded-2xl flex justify-between items-center border border-slate-100">
                              <div className="flex-1 pr-4">
                                <p className="text-[10px] font-bold text-slate-900 leading-tight mb-1">{item.description}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Qtd: {item.quantity || 1}</span>
                                  <span className="text-xs font-black text-teal-600">R$ {(item.value * (item.quantity || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                              </div>
                              <button 
                                onClick={() => setQuotationForm({...quotationForm, items: quotationForm.items.filter((_, i) => i !== idx)})}
                                className="w-8 h-8 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center border border-rose-100 active:scale-90 transition-transform"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="space-y-4 pb-4">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total do Plano</span>
                          <span className="text-2xl font-black text-slate-900">
                             R$ {quotationForm.items.reduce((acc, i) => acc + (i.value * (i.quantity || 1)), 0).toLocaleString()}
                          </span>
                        </div>
                        <button 
                          onClick={() => {
                             handleSaveQuotation();
                             setIsMobileSummaryOpen(false);
                          }}
                          disabled={quotationForm.items.length === 0}
                          className="w-full py-5 bg-teal-600 text-white rounded-[1.5rem] text-xs font-bold uppercase tracking-[0.1em] shadow-xl shadow-teal-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                           Confirmar e Salvar Orçamento
                        </button>
                        <button 
                          onClick={() => {
                             setIsQuotationModalOpen(false);
                             setIsMobileSummaryOpen(false);
                          }}
                          className="w-full py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest"
                        >
                           Descartar Orçamento
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Rápido: Novo Tratamento */}
      <AnimatePresence>
        {isNewTreatmentModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsNewTreatmentModalOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 15 }} 
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl p-8 font-sans overflow-hidden z-[110]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" /> Cadastrar Novo Tratamento
                </h3>
                <button 
                  onClick={() => setIsNewTreatmentModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome do Tratamento</label>
                  <input 
                    type="text"
                    value={newQuickTreatment.name}
                    onChange={(e) => setNewQuickTreatment({...newQuickTreatment, name: e.target.value})}
                    placeholder="Ex: Botox - 3 Regiões"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                    <select
                      value={newQuickTreatment.category}
                      onChange={(e) => setNewQuickTreatment({...newQuickTreatment, category: e.target.value})}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    >
                      {TREATMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subcategoria (Opcional)</label>
                    <input 
                      type="text"
                      value={newQuickTreatment.subcategory}
                      onChange={(e) => setNewQuickTreatment({...newQuickTreatment, subcategory: e.target.value})}
                      placeholder="Ex: Toxina"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Padrão (R$)</label>
                  <input 
                    type="number"
                    value={newQuickTreatment.defaultPrice || 0}
                    onChange={(e) => setNewQuickTreatment({...newQuickTreatment, defaultPrice: Number(e.target.value)})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição</label>
                  <textarea 
                    value={newQuickTreatment.description}
                    onChange={(e) => setNewQuickTreatment({...newQuickTreatment, description: e.target.value})}
                    placeholder="Breve resumo dos materiais ou técnica..."
                    className="w-full h-20 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 resize-none font-medium"
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsNewTreatmentModalOpen(false)}
                    className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveQuickTreatment}
                    disabled={!newQuickTreatment.name.trim()}
                    className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-50 transition-all shadow-md shadow-teal-600/10"
                  >
                    Salvar e Selecionar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Registrar Evolução */}
      <AnimatePresence>
        {isEvolutionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsEvolutionModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5 text-teal-600" /> Registrar Evolução Clínica
              </h3>
              <textarea 
                value={evolutionText || ''}
                onChange={(e) => setEvolutionText(e.target.value)}
                placeholder="Descreva o que foi realizado nesta sessão..."
                className="w-full h-40 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 resize-none font-medium" 
              />
              <div className="mt-8 flex gap-3">
                <button onClick={() => setIsEvolutionModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleSaveEvolution} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Salvar Evolução</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Financeiro */}
      <AnimatePresence>
        {isFinancialModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFinancialModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-teal-600" /> Lançar Movimentação
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Descrição</label>
                  <input 
                    value={paymentForm.description || ''} 
                    onChange={(e) => setPaymentForm({...paymentForm, description: e.target.value})} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" 
                    placeholder="Ex: Pagamento Restauração" 
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor (R$)</label>
                    <input 
                      type="number" 
                      value={paymentForm.value || 0} 
                      onChange={(e) => setPaymentForm({...paymentForm, value: Number(e.target.value)})} 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Forma</label>
                    <select 
                      value={paymentForm.method || 'PIX'} 
                      onChange={(e) => setPaymentForm({...paymentForm, method: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
                    >
                      <option value="PIX">PIX</option>
                      <option value="Cartão">Cartão</option>
                      <option value="Dinheiro">Dinheiro</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
                  <div className="flex gap-2">
                    {['received', 'pending'].map((s) => (
                      <button key={s} onClick={() => setPaymentForm({...paymentForm, status: s as any})} className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all ${paymentForm.status === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}>
                        {s === 'received' ? 'Confirmado' : 'Aguardando'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button onClick={() => setIsFinancialModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleSavePayment} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg">Confirmar Lançamento</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Registrar Recebimento */}
      <AnimatePresence>
        {isReceiptModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsReceiptModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-y-auto max-h-[90vh]">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" /> Registrar recebimento
              </h3>
              
              {receiptError && (
                <div className="mb-4 p-4 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl flex items-center gap-2 border border-rose-100 animate-pulse">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{receiptError}</span>
                </div>
              )}

              <div className="space-y-4">
                {/* Paciente */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paciente</label>
                  <div className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 font-bold">
                    {patients.find(p => p.id === selectedPatientId)?.name || 'Paciente Não Identificado'}
                  </div>
                </div>

                {/* Procedimento/Tratamento Selecionado */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Procedimento/Tratamento Selecionado</label>
                  <div className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium max-h-24 overflow-y-auto">
                    {selectedEntriesToPay.map(e => (
                      <div key={e.id} className="flex justify-between py-1 border-b border-slate-100 last:border-0">
                        <span className="font-bold text-slate-800">{e.description}</span>
                        <span className="text-amber-600 font-bold">Pendente: R$ {e.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Valor Total Pendente */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Total Pendente</label>
                  <div className="w-full px-4 py-2.5 bg-amber-50/50 border border-amber-100 rounded-xl text-xs font-black text-amber-700 font-sans">
                    R$ {selectedEntriesToPay.reduce((acc, e) => acc + e.remainingAmount, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                {/* Valor Recebido Agora */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Recebido Agora</label>
                  <input 
                    type="number" 
                    step="0.01"
                    min="0.01"
                    value={receiptForm.amountPaidNow} 
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      const totalPending = selectedEntriesToPay.reduce((acc, entry) => acc + entry.remainingAmount, 0);
                      if (val > totalPending) {
                        setReceiptError("O valor recebido não pode ser maior que o valor pendente.");
                      } else {
                        setReceiptError(null);
                      }
                      setReceiptForm({ ...receiptForm, amountPaidNow: val });
                    }} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none text-emerald-700 focus:border-emerald-500 font-mono" 
                    placeholder="Digite o valor recebido"
                  />
                </div>

                {/* Forma de Pagamento */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                  <select 
                    value={receiptForm.paymentMethod} 
                    onChange={(e) => setReceiptForm({...receiptForm, paymentMethod: e.target.value})} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-500"
                  >
                    <option value="Pix">Pix</option>
                    <option value="Débito">Débito</option>
                    <option value="Crédito">Crédito</option>
                    <option value="Transferência">Transferência</option>
                    <option value="Dinheiro">Dinheiro</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>

                {/* Data de Recebimento */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data do recebimento</label>
                  <input 
                    type="date" 
                    value={receiptForm.paymentDate} 
                    onChange={(e) => setReceiptForm({...receiptForm, paymentDate: e.target.value})} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500" 
                  />
                </div>

                {/* Observação Opcional */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observação opcional</label>
                  <textarea 
                    value={receiptForm.notes} 
                    onChange={(e) => setReceiptForm({...receiptForm, notes: e.target.value})} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-500 h-20 resize-none font-medium" 
                    placeholder="Adicione notas ou observações do recebimento"
                  />
                </div>

                {/* Responsável pelo lançamento */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Responsável pelo Lançamento</label>
                  <input 
                    type="text" 
                    value={receiptForm.receivedByName} 
                    onChange={(e) => setReceiptForm({...receiptForm, receivedByName: e.target.value})} 
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-teal-500" 
                    placeholder="Nome do profissional responsável"
                  />
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  onClick={() => setIsReceiptModalOpen(false)} 
                  className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleConfirmReceipt} 
                  disabled={!receiptForm.amountPaidNow || Number(receiptForm.amountPaidNow) <= 0 || !!receiptError}
                  className={`flex-1 py-3 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg transition-all ${
                    !receiptForm.amountPaidNow || Number(receiptForm.amountPaidNow) <= 0 || !!receiptError
                      ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  Confirmar recebimento
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Detalhes Financeiros ("Ver detalhes") */}
      <AnimatePresence>
        {isDetailsModalOpen && selectedDetailsEntry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsDetailsModalOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />

            {/* Modal Body */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: 15 }} 
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-10 my-8 overflow-hidden flex flex-col max-h-[90vh] z-10"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-5 mb-6">
                <div>
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${
                    detailsForm.type === 'receita' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}>
                    {detailsForm.type === 'receita' ? 'Receita' : 'Despesa'}
                  </span>
                  <h3 className="text-xl font-bold text-slate-800 mt-2 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-indigo-600" /> 
                    {isDetailsEditing ? 'Editar Lançamento' : 'Visualizar Detalhes'}
                  </h3>
                </div>
                <button 
                  onClick={() => setIsDetailsModalOpen(false)} 
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Error messages if any */}
              {detailsError && (
                <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-xs text-rose-700 font-medium">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{detailsError}</span>
                </div>
              )}

              {/* Scrollable Form/View */}
              <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                
                {/* Delete Double Confirmation Section */}
                {isDeleteConfirmOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    className="p-5 bg-rose-50 border border-rose-200 rounded-2xl"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-bold text-rose-900">Confirmar Exclusão</h4>
                        <p className="text-xs text-rose-700 mt-1 leading-relaxed">
                          Você tem certeza que deseja excluir permanentemente este lançamento financeiro? Essa operação é irreversível e removerá também as transações associadas.
                        </p>
                        <div className="flex gap-2.5 mt-4">
                          <button 
                            type="button" 
                            onClick={() => setIsDeleteConfirmOpen(false)}
                            className="bg-white border border-rose-200 text-rose-700 hover:bg-rose-100/50 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
                          >
                            Cancelar
                          </button>
                          <button 
                            type="button" 
                            onClick={handleDeleteEntry}
                            className="bg-rose-600 hover:bg-rose-700 text-white shadow-md px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                          >
                            Excluir Definitivamente
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {isDetailsEditing ? (
                  /* EDITING MODE FORM */
                  <div className="space-y-4">
                    {/* Descrição */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Descrição *</label>
                      <input 
                        type="text"
                        value={detailsForm.description}
                        onChange={(e) => setDetailsForm({ ...detailsForm, description: e.target.value })}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800"
                        placeholder="Descrição do lançamento"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Tipo */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</label>
                        <select 
                          value={detailsForm.type}
                          onChange={(e) => setDetailsForm({ ...detailsForm, type: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="receita">Receita</option>
                          <option value="despesa">Despesa</option>
                        </select>
                      </div>

                      {/* Status */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</label>
                        <select 
                          value={detailsForm.status}
                          onChange={(e) => setDetailsForm({ ...detailsForm, status: e.target.value as any })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold"
                        >
                          <option value="pendente">Pendente</option>
                          <option value="pago">Pago</option>
                          <option value="vencido">Vencido</option>
                          <option value="cancelado">Cancelado</option>
                          <option value="parcial">Parcial</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Categoria */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categoria</label>
                        <input 
                          type="text"
                          value={detailsForm.category}
                          onChange={(e) => setDetailsForm({ ...detailsForm, category: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800"
                          placeholder="Ex: Tratamento, Material"
                        />
                      </div>

                      {/* Subcategoria */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Subcategoria</label>
                        <input 
                          type="text"
                          value={detailsForm.subcategory}
                          onChange={(e) => setDetailsForm({ ...detailsForm, subcategory: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800"
                          placeholder="Ex: Ortodontia, Limpeza"
                        />
                      </div>
                    </div>

                    {/* Paciente Relacionado & Profissional Responsável */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Paciente Relacionado</label>
                        <input 
                          type="text"
                          value={detailsForm.patientName}
                          onChange={(e) => setDetailsForm({ ...detailsForm, patientName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800"
                          placeholder="Nome do Paciente"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profissional Responsável</label>
                        <input 
                          type="text"
                          value={detailsForm.professionalName}
                          onChange={(e) => setDetailsForm({ ...detailsForm, professionalName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800"
                          placeholder="Responsável técnico"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      {/* Valor Bruto */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Bruto (R$) *</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={detailsForm.grossAmount}
                          onChange={(e) => setDetailsForm({ ...detailsForm, grossAmount: Number(e.target.value) })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-800 font-mono"
                        />
                      </div>

                      {/* Desconto */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desconto (R$)</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={detailsForm.discount}
                          onChange={(e) => setDetailsForm({ ...detailsForm, discount: Number(e.target.value) })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-800 font-mono"
                        />
                      </div>

                      {/* Acrescimo / Juros */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Acréscimos / Juros (R$)</label>
                        <input 
                          type="number"
                          step="0.01"
                          value={detailsForm.additions}
                          onChange={(e) => setDetailsForm({ ...detailsForm, additions: Number(e.target.value) })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-800 font-mono"
                        />
                      </div>
                    </div>

                    {/* Valor Final Calculado */}
                    <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex justify-between items-center">
                      <span className="text-xs font-bold text-indigo-900">VALOR FINAL</span>
                      <span className="text-sm font-black text-indigo-700 font-sans">
                        R$ {(Number(detailsForm.grossAmount) - Number(detailsForm.discount) + Number(detailsForm.additions)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Forma de Pagamento */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</label>
                        <select 
                          value={detailsForm.paymentMethod}
                          onChange={(e) => setDetailsForm({ ...detailsForm, paymentMethod: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-bold text-slate-800"
                        >
                          <option value="Pix">Pix</option>
                          <option value="Débito">Cartão de Débito</option>
                          <option value="Crédito">Cartão de Crédito</option>
                          <option value="Dinheiro">Dinheiro</option>
                          <option value="Transferência">TED / DOC / Transferência</option>
                          <option value="Boleto">Boleto Bancário</option>
                          <option value="Outro">Outro</option>
                        </select>
                      </div>

                      {/* Parcelas */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Parcelas / Repetições</label>
                        <input 
                          type="number"
                          min="1"
                          max="120"
                          value={detailsForm.installments}
                          onChange={(e) => setDetailsForm({ ...detailsForm, installments: parseInt(e.target.value) || 1 })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-semibold text-slate-800"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Vencimento */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Vencimento</label>
                        <input 
                          type="date"
                          value={detailsForm.dueDate}
                          onChange={(e) => setDetailsForm({ ...detailsForm, dueDate: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-semibold text-slate-850"
                        />
                      </div>

                      {/* Pagamento */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Pagamento</label>
                        <input 
                          type="date"
                          value={detailsForm.paymentDate}
                          disabled={detailsForm.status !== 'pago'}
                          onChange={(e) => setDetailsForm({ ...detailsForm, paymentDate: e.target.value })}
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-semibold text-slate-850 disabled:bg-slate-100 disabled:text-slate-400"
                        />
                      </div>
                    </div>

                    {/* Notas / Observacoes Internas */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Observações Internas</label>
                      <textarea 
                        value={detailsForm.notes}
                        onChange={(e) => setDetailsForm({ ...detailsForm, notes: e.target.value })}
                        rows={3}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 font-medium text-slate-800 resize-none"
                        placeholder="Insira detalhes adicionais sobre o pagamento, taxas extras, etc..."
                      />
                    </div>
                  </div>
                ) : (
                  /* READ-ONLY PREMIUM VISUALIZATION MODE */
                  <div className="space-y-6">
                    {/* Visual Card containing main info */}
                    <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Descrição do Lançamento</p>
                          <p className="text-sm font-black text-slate-800 mt-1 leading-snug">{detailsForm.description}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Paciente Relacionado</p>
                          <p className="text-xs font-bold text-slate-700 mt-1 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-indigo-500" /> {detailsForm.patientName}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Responsável Clínico</p>
                          <p className="text-xs font-semibold text-slate-700 mt-1 flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 text-slate-500" /> {detailsForm.professionalName || '---'}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status de Liquidação</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              detailsForm.status === 'pago' ? 'bg-emerald-100 text-emerald-800' :
                              detailsForm.status === 'parcial' ? 'bg-amber-100 text-amber-800' :
                              detailsForm.status === 'vencido' ? 'bg-rose-100 text-rose-800' :
                              detailsForm.status === 'cancelado' ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {detailsForm.status === 'pago' ? 'Pago' :
                               detailsForm.status === 'parcial' ? 'Aprovado Parcial' :
                               detailsForm.status === 'vencido' ? 'Vencido' :
                               detailsForm.status === 'cancelado' ? 'Cancelado' : 'Pendente'}
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Valor Final</p>
                          <div className="text-lg font-black text-slate-900 mt-1">
                            R$ {(Number(detailsForm.grossAmount) - Number(detailsForm.discount) + Number(detailsForm.additions)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[9px] text-slate-400 font-bold mt-1 uppercase tracking-wider">
                            Bruto: R$ {Number(detailsForm.grossAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} 
                            {detailsForm.discount > 0 && ` | Desc: R$ ${Number(detailsForm.discount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                            {detailsForm.additions > 0 && ` | Acrésc: R$ ${Number(detailsForm.additions).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Metadata & Secondary Parameters Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-2">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categoria</p>
                        <p className="text-xs font-bold text-slate-700 mt-1">{detailsForm.category}</p>
                        {detailsForm.subcategory && <p className="text-[10px] font-medium text-slate-500 mt-0.5">{detailsForm.subcategory}</p>}
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Forma de Pagamento</p>
                        <p className="text-xs font-bold text-slate-700 mt-1 flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-slate-400" /> {detailsForm.paymentMethod}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Parcelamento</p>
                        <p className="text-xs font-bold text-slate-700 mt-1">{detailsForm.installments}x parcela(s)</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Vencimento</p>
                        <p className="text-xs font-semibold text-slate-700 mt-1 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-rose-400" /> 
                          {detailsForm.dueDate ? new Date(detailsForm.dueDate + 'T00:00:00').toLocaleDateString('pt-BR') : '---'}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data de Recebimento</p>
                        <p className="text-xs font-semibold text-slate-700 mt-1 flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-emerald-400" /> 
                          {detailsForm.paymentDate ? new Date(detailsForm.paymentDate + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem pagamento'}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Origem</p>
                        <p className="text-[11px] font-bold text-indigo-700 mt-1 uppercase tracking-wider">
                          {selectedDetailsEntry.isImported ? 'Importação Planilha' : 'Lançamento Manual'}
                        </p>
                      </div>
                    </div>

                    {/* Dynamic notes rendering if text exists */}
                    {detailsForm.notes && (
                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100/50">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Observações Internas</p>
                        <p className="text-xs font-medium text-slate-600 mt-2 whitespace-pre-wrap leading-relaxed">
                          {detailsForm.notes}
                        </p>
                      </div>
                    )}

                    {/* Audit Logs Row */}
                    <div className="pt-4 border-t border-slate-100 flex flex-wrap gap-x-8 gap-y-2 text-[10px] text-slate-400 font-semibold font-mono">
                      {detailsForm.createdByName && (
                        <span>Criado por: <span className="text-slate-500 font-bold">{detailsForm.createdByName}</span> às {detailsForm.createdAt ? new Date(detailsForm.createdAt + 'T00:00:00').toLocaleDateString('pt-BR') : '---'}</span>
                      )}
                      {detailsForm.updatedByName && (
                        <span>Lançamento atualizado por: <span className="text-slate-500 font-bold">{detailsForm.updatedByName}</span> em {detailsForm.updatedAt ? new Date(detailsForm.updatedAt + 'T00:00:00').toLocaleDateString('pt-BR') : '---'}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Controls */}
              <div className="mt-8 pt-5 border-t border-slate-100 flex flex-wrap gap-3 items-center justify-between">
                <div>
                  {(isPlatformAdmin || profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'admin' || profile?.role === 'clinic_admin' || clinic?.ownerId === user?.uid || isNina) && !isDeleteConfirmOpen && (
                    <button 
                      type="button" 
                      onClick={() => {
                        setIsDeleteConfirmOpen(true);
                      }}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 font-black text-[10px] uppercase tracking-wider py-3.5 px-6 rounded-2xl transition-all"
                    >
                      Excluir Lançamento
                    </button>
                  )}
                </div>

                <div className="flex gap-3">
                  {isDetailsEditing ? (
                    <>
                      <button 
                        type="button" 
                        onClick={() => setIsDetailsEditing(false)}
                        className="border border-slate-200 hover:bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-wider py-3.5 px-6 rounded-2xl transition-all"
                      >
                        Cancelar
                      </button>
                      <button 
                        type="button" 
                        onClick={handleSaveDetails}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-wider py-3.5 px-6 rounded-2xl transition-all shadow-md shadow-indigo-600/10"
                      >
                        Salvar Alterações
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        type="button" 
                        onClick={() => setIsDetailsModalOpen(false)}
                        className="border border-slate-200 hover:bg-slate-50 text-slate-400 font-black text-[10px] uppercase tracking-wider py-3.5 px-6 rounded-2xl transition-all"
                      >
                        Fechar
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setIsDetailsEditing(true)}
                        className="bg-slate-900 hover:bg-slate-800 text-white font-black text-[10px] uppercase tracking-wider py-3.5 px-6 rounded-2xl transition-all shadow-md"
                      >
                        Editar Lançamento
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Receituário Inteligente ELIZA */}
      <AnimatePresence>
        {isPrescriptionGeneratorOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsPrescriptionGeneratorOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="relative w-full max-w-5xl bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-10 flex flex-col h-[90vh] md:h-[85vh] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-teal-50 rounded-2xl flex items-center justify-center text-teal-600">
                    <Pill className="w-5 h-5 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-base md:text-lg font-black text-slate-950 flex items-center gap-2">
                      Receituário Clínico Inteligente <span className="bg-teal-600 text-white text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">ELIZA IA</span>
                    </h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Suporte de segurança farmacológica com inteligência artificial</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsPrescriptionGeneratorOpen(false)}
                  className="p-2 hover:bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Grid content split */}
              <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-8 py-6">
                
                {/* Panel Esquerdo - Setup e IA */}
                <div className="lg:col-span-12 xl:col-span-5 flex flex-col overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                  
                  {/* Seletores de Configuração de Receita */}
                  <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 col-span-2 md:col-span-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.1em] block">
                        Modelo de Receita
                      </label>
                      <select
                        value={prescriptionForm.templateId}
                        onChange={(e) => {
                          const newTid = e.target.value;
                          const updatedForm = { ...prescriptionForm, templateId: newTid };
                          setPrescriptionForm(updatedForm);
                          const compiled = getCompiledPrescriptionText(newTid, updatedForm);
                          setPrescriptionText(compiled);
                        }}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none hover:border-teal-300 transition-colors cursor-pointer"
                      >
                        <option value="">Selecione um modelo...</option>
                        {clinicTemplates.filter(t => t.type === 'prescription').map(t => (
                          <option key={t.id} value={t.id}>{t.name} (Clínica)</option>
                        ))}
                        {DEFAULT_PRESCRIPTION_TEMPLATES.map(t => (
                          <option key={t.id} value={t.id}>{t.name} (Default ELIZA)</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2 col-span-2 md:col-span-1">
                      <label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.1em] block">
                        Tipo de Receita (Layout)
                      </label>
                      <select
                        value={prescriptionForm.recipeType || 'comum'}
                        onChange={(e) => {
                          const val = e.target.value as 'comum' | 'especial';
                          setPrescriptionForm({ ...prescriptionForm, recipeType: val });
                        }}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none hover:border-teal-300 transition-colors cursor-pointer"
                      >
                        <option value="comum">Receituário Simples / Comum</option>
                        <option value="especial">Receituário de Controle Especial (Anvisa)</option>
                      </select>
                    </div>
                  </div>

                  {/* Alerta de Profissional Responsável (Agenda) */}
                  {(() => {
                    let aptStaffName = '';
                    if (patientAppointments && patientAppointments.length > 0) {
                      const latestApt = patientAppointments[0];
                      const staffMember = staff.find(s => s.id === latestApt.staffId);
                      aptStaffName = staffMember?.name || latestApt.professional || '';
                    }
                    const isDifferent = aptStaffName && prescriptionForm.professionalName !== aptStaffName;
                    
                    if (isDifferent) {
                      return (
                        <div className="px-5 py-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-3xl flex flex-col gap-2">
                          <div className="flex gap-2 items-center">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">Responsável pela Agenda do Paciente</span>
                          </div>
                          <p className="text-[9.5px] font-semibold text-amber-700 uppercase leading-snug">
                            O profissional do último agendamento é <strong className="text-amber-950 font-black">{aptStaffName}</strong>. 
                            Você está gerando este documento como <strong className="text-amber-950 font-black">{prescriptionForm.professionalName || user?.displayName}</strong>.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              const updatedForm = { ...prescriptionForm, professionalName: aptStaffName };
                              setPrescriptionForm(updatedForm);
                              const compiled = getCompiledPrescriptionText(prescriptionForm.templateId, updatedForm);
                              setPrescriptionText(compiled);
                            }}
                            className="self-start text-[9px] font-black bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg uppercase tracking-wider transition-all mt-1 cursor-pointer"
                          >
                            Utilizar {aptStaffName} como Emitente
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Informações Gerais preenchidas */}
                  <div className="p-5 bg-white border border-slate-200 rounded-3xl space-y-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Dados de Identificação</span>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Paciente</label>
                        <input
                          type="text"
                          value={prescriptionForm.patientName}
                          onChange={(e) => setPrescriptionForm({ ...prescriptionForm, patientName: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-semibold outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">CPF</label>
                        <input
                          type="text"
                          value={prescriptionForm.patientCpf}
                          onChange={(e) => setPrescriptionForm({ ...prescriptionForm, patientCpf: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-semibold outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Profissional Emitente</label>
                        {(() => {
                          const staffNames = staff.map(s => s.name);
                          const hasMatch = staffNames.includes(prescriptionForm.professionalName) || prescriptionForm.professionalName === user?.displayName;
                          const selectValue = hasMatch ? prescriptionForm.professionalName : 'custom';
                          
                          return (
                            <div className="space-y-1">
                              <select
                                value={selectValue}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'custom') {
                                    setPrescriptionForm({ ...prescriptionForm, professionalName: '' });
                                  } else {
                                    const updatedForm = { ...prescriptionForm, professionalName: val };
                                    setPrescriptionForm(updatedForm);
                                    const compiled = getCompiledPrescriptionText(prescriptionForm.templateId, updatedForm);
                                    setPrescriptionText(compiled);
                                  }
                                }}
                                className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-semibold text-slate-700 outline-none cursor-pointer focus:border-teal-500"
                              >
                                {user?.displayName && (
                                  <option value={user.displayName}>{user.displayName} (Você)</option>
                                )}
                                {staff.map(s => (
                                  <option key={s.id} value={s.name}>{s.name} ({s.role || 'Staff'})</option>
                                ))}
                                <option value="custom">✍️ Profissional personalizado...</option>
                              </select>
                              
                              {selectValue === 'custom' && (
                                <input
                                  type="text"
                                  placeholder="Digite o nome do clínico"
                                  value={prescriptionForm.professionalName}
                                  onChange={(e) => {
                                    const updatedForm = { ...prescriptionForm, professionalName: e.target.value };
                                    setPrescriptionForm(updatedForm);
                                    const compiled = getCompiledPrescriptionText(prescriptionForm.templateId, updatedForm);
                                    setPrescriptionText(compiled);
                                  }}
                                  className="w-full px-3 py-2 bg-slate-50 border border-teal-300 rounded-lg text-xs font-semibold outline-none mt-1"
                                />
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Data</label>
                        <input
                          type="text"
                          value={prescriptionForm.date}
                          onChange={(e) => setPrescriptionForm({ ...prescriptionForm, date: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-xs font-semibold outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sugeridor de Fármacos / Pomadas */}
                  <div className="p-5 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Inserção Rápida de Medicamentos</span>
                    <div className="space-y-3">
                      <select
                        onChange={(e) => {
                          const valStr = e.target.value;
                          if (!valStr) return;
                          
                          // Find selected drug
                          const matchDrug = drugs.find(d => d.id === valStr);
                          if (matchDrug) {
                            console.log('[RECEITUARIO_FÁRMACO_INSERIDO]', matchDrug.name);
                            const appendText = `\n\n- ${matchDrug.name}\n  Posologia: ${matchDrug.defaultDosage}`;
                            setPrescriptionText(prev => prev + appendText);
                          }
                          // Reset select
                          e.target.value = '';
                        }}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none cursor-pointer"
                      >
                        <option value="">+ Selecionar medicamento...</option>
                        {drugs.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                      <p className="text-[9px] text-slate-400 font-bold leading-tight uppercase block">Insere o medicamento selecionado no final do campo de texto editável.</p>
                    </div>
                  </div>

                  {/* Painel do Assistente de Decisão Clínico ELIZA */}
                  <div className="p-5 bg-teal-900/5 hover:bg-teal-900/10 border border-teal-600/10 rounded-[2rem] flex flex-col space-y-4 transition-all shrink-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-teal-600 animate-pulse" />
                        <div>
                          <span className="text-[11px] font-black text-teal-950 uppercase tracking-widest block">Cruzamento de Segurança Clínico</span>
                          <span className="text-[9px] text-teal-600 font-bold uppercase tracking-wider block">Anamnese vs Fármacos</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleAnalyzePrescription}
                        disabled={isAnalyzingPrescription || !prescriptionText}
                        className="bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-md shadow-teal-600/20 active:scale-95 cursor-pointer"
                      >
                        {isAnalyzingPrescription ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        PERGUNTAR À ELIZA
                      </button>
                    </div>

                    {isAnalyzingPrescription ? (
                      <div className="py-6 flex flex-col items-center justify-center gap-2 text-center text-teal-900">
                        <RefreshCw className="w-6 h-6 text-teal-600 animate-spin" />
                        <span className="text-[10px] font-black text-teal-800 uppercase tracking-widest animate-pulse">ELIZA analisando prontuário e intercorrências...</span>
                      </div>
                    ) : prescriptionAIAnalysis ? (
                      <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 text-xs font-semibold leading-relaxed h-48 overflow-y-auto custom-scrollbar border border-teal-500/10">
                        <div className="flex items-center gap-1.5 mb-3">
                          <Brain className="w-3.5 h-3.5 text-teal-400 animate-pulse" />
                          <span className="text-[8px] bg-teal-500 text-white font-extrabold uppercase px-1.5 py-0.5 rounded tracking-widest leading-none">ELIZA IA COGNITIVE REPORT</span>
                        </div>
                        <div className="markdown-body font-sans text-xs prose prose-invert max-w-none">
                          {prescriptionAIAnalysis}
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center bg-white/50 border border-slate-100 rounded-2xl flex flex-col items-center justify-center gap-1 shrink-0">
                        <ShieldCheck className="w-8 h-8 text-slate-200" />
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Sem análises de risco pendentes</span>
                        <span className="text-[8px] text-slate-400 font-bold uppercase tracking-widest px-6 mt-1 text-center">Clique em "Perguntar à ELIZA" para cruzar com a anamnese.</span>
                      </div>
                    )}
                  </div>

                </div>

                {/* Panel Direito - Editor de Prescrição */}
                <div className="lg:col-span-12 xl:col-span-7 flex flex-col bg-slate-50 border border-slate-200/60 rounded-[2.2rem] overflow-hidden min-h-[300px]">
                  <div className="bg-white p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Editor e Pré-visualização</span>
                    
                    {/* Status da Prescrição */}
                    <div className="flex items-center gap-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Status:</label>
                      <select
                        value={prescriptionForm.status}
                        onChange={(e) => setPrescriptionForm({ ...prescriptionForm, status: e.target.value as any })}
                        className="px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-black uppercase outline-none text-slate-700"
                      >
                        <option value="active">🟢 Ativa</option>
                        <option value="dispensed">🔵 Dispensada</option>
                        <option value="cancelled">🔴 Cancelada</option>
                        <option value="archived">⚪ Arquivada</option>
                      </select>
                    </div>
                  </div>

                  {/* Textarea Principal */}
                  <textarea
                    value={prescriptionText}
                    onChange={(e) => setPrescriptionText(e.target.value)}
                    className="flex-1 p-6 md:p-8 text-xs font-semibold text-slate-850 outline-none resize-none font-serif leading-relaxed bg-white shadow-inner"
                    placeholder="Escreva a receita livremente aqui. Utilizar tags se desejar..."
                  />

                  {/* Visual Footer */}
                  <div className="bg-slate-50 p-4 border-t border-slate-200/60 flex items-center justify-between text-[9px] text-slate-400 font-bold uppercase tracking-widest shrink-0">
                    <span>{prescriptionText.length} Caracteres</span>
                    <span>Formatado para Prontuário Clínico</span>
                  </div>
                </div>

              </div>

              {/* Botões do Editor Receituário */}
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                <button 
                  onClick={() => setIsPrescriptionGeneratorOpen(false)} 
                  className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  Cancelar / Fechar
                </button>
                {prescriptionText && (
                  <button 
                    onClick={() => handlePrintClinicalDocument(prescriptionText, 'Receituário Clínico', 'receita')}
                    className="px-6 py-3 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-sm cursor-pointer animate-none"
                    type="button"
                  >
                    <Printer className="w-4 h-4 text-slate-500" /> Imprimir / Exportar PDF
                  </button>
                )}
                <button 
                  onClick={handleSavePrescription}
                  className="px-8 py-3 bg-teal-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <FileCheck className="w-4 h-4" /> Salvar no Prontuário
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Gerar Documento */}
      <AnimatePresence>
        {isDocumentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsDocumentModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl p-10 flex flex-col h-[70vh]">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <FileDigit className="w-5 h-5 text-teal-600" /> {documentForm.type === 'receita' ? 'Gerar Receituário' : 'Emitir Atestado'}
              </h3>
              <div className="space-y-4 flex-1 flex flex-col overflow-hidden">
                <div className="flex gap-4">
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Título do Documento</label>
                    <input 
                      value={documentForm.title || ''} 
                      onChange={(e) => setDocumentForm({...documentForm, title: e.target.value})} 
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" 
                      placeholder="Ex: Receituário Especial" 
                    />
                  </div>
                  <div className="w-48 space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Usar Template</label>
                    <select 
                      onChange={(e) => {
                        const t = clinicTemplates.find(item => item.id === e.target.value);
                        applyTemplate(t);
                      }}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none"
                    >
                      <option value="">Selecione...</option>
                      {clinicTemplates.filter(t => t.type === 'contract' || t.type === 'prescription').map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1 flex-1 flex flex-col">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Conteúdo</label>
                  <textarea 
                    value={documentForm.content || ''} 
                    onChange={(e) => setDocumentForm({...documentForm, content: e.target.value})} 
                    className="w-full flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none resize-none font-serif leading-relaxed" 
                    placeholder="Dê as instruções ou laudo aqui..." 
                  />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button type="button" onClick={() => setIsDocumentModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer">Cancelar</button>
                {documentForm.content && (
                  <button 
                    type="button" 
                    onClick={() => handlePrintClinicalDocument(documentForm.content, documentForm.title || 'Atestado Clínico', documentForm.type || 'atestado')} 
                    className="flex-1 py-3 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-450" /> Imprimir
                  </button>
                )}
                <button type="button" onClick={handleSaveDocument} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 cursor-pointer">Gerar e Salvar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isImageModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { setIsImageModalOpen(false); setSelectedFileBase64(null); }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-teal-600" /> Detalhes do Registro
              </h3>
              <div className="space-y-6">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome do Arquivo / Título</label>
                  <input 
                    value={imageForm.title || ''} 
                    onChange={(e) => setImageForm({...imageForm, title: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none" 
                    placeholder="Ex: Radiografia Panorâmica" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria</label>
                  <select 
                    value={imageForm.category || 'Radiografia'}
                    onChange={(e) => setImageForm({...imageForm, category: e.target.value})}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
                  >
                    <option value="Radiografia">Radiografia</option>
                    <option value="Foto Clínica">Foto Clínica</option>
                    <option value="Documento">Documento</option>
                    <option value="Outros">Outros</option>
                  </select>
                </div>
                <div className="space-y-1">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observação / Explicação</label>
                   <textarea 
                    value={imageForm.description || ''}
                    onChange={(e) => setImageForm({...imageForm, description: e.target.value})}
                    className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none resize-none" 
                    placeholder="Explique o que é esta imagem e por que está sendo anexada..."
                   />
                </div>
                
                <div className="space-y-1">
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Arquivo</label>
                   {!selectedFileBase64 ? (
                     <div className="h-32 border-2 border-dashed border-slate-100 rounded-3xl flex flex-col items-center justify-center text-slate-300 relative overflow-hidden">
                        <Upload className="w-8 h-8 mb-2" />
                        <p className="text-[10px] font-bold uppercase tracking-tighter text-center px-4">Arraste ou clique para selecionar</p>
                        <input 
                          type="file" 
                          accept="image/*"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 800000) {
                                alert('O arquivo é muito grande. Por favor, utilize imagens menores que 800KB.');
                                return;
                              }
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                setSelectedFileBase64(reader.result as string);
                                if (!imageForm.title) setImageForm(prev => ({...prev, title: file.name}));
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                     </div>
                   ) : (
                     <div className="relative rounded-3xl overflow-hidden border border-slate-200 group">
                        <img src={selectedFileBase64} className="w-full h-40 object-cover" alt="Preview" />
                        <button 
                          onClick={() => setSelectedFileBase64(null)}
                          className="absolute top-2 right-2 p-2 bg-white/90 backdrop-blur rounded-xl text-rose-600 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Plus className="w-4 h-4 rotate-45" />
                        </button>
                     </div>
                   )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button onClick={() => { setIsImageModalOpen(false); setSelectedFileBase64(null); }} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                  <button 
                    onClick={() => handleSaveImage(imageForm.title, imageForm.category, selectedFileBase64 || undefined, imageForm.description)}
                    disabled={!selectedFileBase64 || !imageForm.title}
                    className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 disabled:opacity-50 disabled:shadow-none"
                  >
                    Salvar Registro
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Modal: Adicionar ao Planejamento */}
      <AnimatePresence>
        {isPlanningModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsPlanningModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden max-h-[90vh] flex flex-col z-10">
              <h3 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-teal-600" /> Planejar Procedimento para {selectedPatient?.name}
              </h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-6">Cadastre este procedimento no cronograma semanal</p>
              
              <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar flex-1 pb-4 text-left">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profissional Responsável</label>
                  <select 
                    value={planningForm.professionalId} 
                    onChange={(e) => setPlanningForm(prev => ({ ...prev, professionalId: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600"
                  >
                    <option value="">Selecione o profissional...</option>
                    {staff.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</label>
                    <input 
                      type="date" 
                      value={planningForm.date} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Horário</label>
                    <input 
                      type="time" 
                      value={planningForm.time} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, time: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cadeira / Sala</label>
                    <input 
                      type="text" 
                      value={planningForm.chair} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, chair: e.target.value }))}
                      placeholder="Ex: Cadeira 1"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Categoria do Procedimento</label>
                    <select 
                      value={planningForm.procedureCategory} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, procedureCategory: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600"
                    >
                      {['Toxina Botulínica', 'Ácido Hialurônico (Preenchimento)', 'Fios de Sustentação / PDO', 'Cirurgia Oral', 'Implantes', 'Bichectomia', 'Lentes de Contato / Facetas', 'Ortodontia', 'Periodontia', 'Endodontia', 'Clínico Geral', 'Outro'].map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tratamento Especifico</label>
                  <input 
                    type="text" 
                    value={planningForm.procedureName} 
                    onChange={(e) => setPlanningForm(prev => ({ ...prev, procedureName: e.target.value }))}
                    placeholder="Ex: Botox - 3 Regiões"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor Previsto (R$)</label>
                    <input 
                      type="number" 
                      value={planningForm.expectedValue || ''} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, expectedValue: Number(e.target.value) }))}
                      placeholder="Ex: 1200"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Forma de Pagamento Prevista</label>
                    <select 
                      value={planningForm.expectedPaymentMethod} 
                      onChange={(e) => setPlanningForm(prev => ({ ...prev, expectedPaymentMethod: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600"
                    >
                      <option value="Pix">Pix</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Cartão de Débito">Cartão de Débito</option>
                      <option value="Boleto">Boleto</option>
                      <option value="Dinheiro">Dinheiro</option>
                    </select>
                  </div>
                </div>

                {/* Materials list selection */}
                <div className="space-y-2 border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Materiais e Insumos Críticos</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['toxina botulínica', 'ácido hialurônico', 'cânulas', 'fios', 'kits cirúrgicos', 'anestésico', 'implantes', 'biomateriais'].map((mat) => {
                      const isChecked = planningForm.materials.includes(mat);
                      return (
                        <button
                          key={mat}
                          onClick={() => {
                            if (isChecked) {
                              setPlanningForm(prev => ({ ...prev, materials: prev.materials.filter(m => m !== mat) }));
                            } else {
                              setPlanningForm(prev => ({ ...prev, materials: [...prev.materials, mat] }));
                            }
                          }}
                          className={`flex items-center gap-2 p-2 border rounded-xl text-left text-[10px] font-bold uppercase transition-all ${
                            isChecked 
                              ? 'bg-teal-50 border-teal-500 text-teal-700 font-extrabold' 
                              : 'bg-white border-slate-200 text-slate-500'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-white ${isChecked ? 'bg-teal-600 border-teal-600' : 'border-slate-300'}`}>
                            {isChecked && <CheckCircle className="w-2.5 h-2.5 stroke-[3.5]" />}
                          </span>
                          <span>{mat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observações Operacionais</label>
                  <textarea 
                    value={planningForm.notes} 
                    onChange={(e) => setPlanningForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Insumos adicionais, restrições do paciente, etc..."
                    rows={2} 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 resize-none font-semibold"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3 border-t border-slate-100 bg-white">
                <button onClick={() => setIsPlanningModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleSavePlanning} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Salvar Planejamento</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Modal: Editar Anamnese */}
      <AnimatePresence>
        {isAnamnesisModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAnamnesisModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl p-10 overflow-hidden max-h-[90vh] flex flex-col">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-teal-600" /> Atualizar Anamnese
              </h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const data: any = {};
                formData.forEach((value, key) => { data[key] = value; });
                handleSaveAnamnesis(data);
              }} className="space-y-6 overflow-y-auto pr-4 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { label: 'Tratamento Médico?', name: 'medicalTreatment' },
                    { label: 'Alergias?', name: 'allergies' },
                    { label: 'Medicação Contínua?', name: 'medications' },
                    { label: 'Condições (Diabetes/Cardíaco)?', name: 'conditions' },
                    { label: 'Cicatrizaçâo?', name: 'healingIssues' },
                    { label: 'Hemorragia?', name: 'hemorrhage' },
                    { label: 'Hábitos (Fumo/Álcool)?', name: 'habits' },
                  ].map((field) => (
                    <div key={field.name} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{field.label}</label>
                      <input name={field.name} defaultValue={anamnesis?.[field.name] || ''} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Notas Internas (Observações)</label>
                  <textarea name="internalNotes" defaultValue={anamnesis?.internalNotes || ''} className="w-full h-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 resize-none" />
                </div>
                <div className="pt-4 flex gap-3 sticky bottom-0 bg-white pb-2">
                  <button type="button" onClick={() => setIsAnamnesisModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Salvar Dados</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Gerador de Contratos HOF */}
      <AnimatePresence>
        {isContractGeneratorOpen && selectedQuotationForContract && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setIsContractGeneratorOpen(false)} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
            />
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="relative w-full max-w-6xl h-[90vh] bg-slate-50 rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden z-10"
            >
              {/* Header */}
              <div className="p-6 md:p-8 bg-white border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-teal-50 rounded-2xl text-teal-600">
                    <Sparkles className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 font-sans tracking-tight">
                      Assistente de Contratos da ELIZA IA
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                      Orçamento Vinculado: Plano #{selectedQuotationForContract.id.slice(-5)} — {selectedQuotationForContract.title}
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => setIsContractGeneratorOpen(false)}
                  className="p-3 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Grid content */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
                
                {/* Left Side: Form Inputs and compile controls */}
                <div className="lg:col-span-5 p-6 md:p-8 overflow-y-auto space-y-6 border-r border-slate-100 custom-scrollbar">
                  
                  {/* Select Template and AI toggle */}
                  <div className="p-5 bg-white rounded-3xl border border-slate-205 space-y-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.1em] block">
                      Modelo do Contrato / Termo
                    </span>
                    
                    <div className="space-y-3">
                      <select
                        value={contractFormData.templateId}
                        onChange={(e) => {
                          const newTid = e.target.value;
                          setContractFormData({ ...contractFormData, templateId: newTid });
                          if (selectedQuotationForContract) {
                            const preCompiled = getCompiledContractText(newTid, { ...contractFormData, templateId: newTid }, selectedQuotationForContract);
                            setContractText(preCompiled);
                          }
                          console.log('[MODELO_CONTRATO_SELECIONADO]', newTid);
                        }}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
                      >
                        <option value="">Selecione um modelo...</option>
                        {clinicTemplates.filter(t => t.type === 'contract').map(t => (
                          <option key={t.id} value={t.id}>{t.name} (Clínica)</option>
                        ))}
                        {DEFAULT_CONTRACT_TEMPLATES.map(t => (
                          <option key={t.id} value={t.id}>{t.name} (Default)</option>
                        ))}
                      </select>

                      {/* Glowing AI toggler */}
                      <div className="p-4 bg-teal-500/5 border border-teal-500/10 rounded-2xl flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <Brain className="w-4 h-4 text-teal-600" />
                          <div>
                            <span className="text-[10px] font-black text-teal-900 uppercase block tracking-wider">Unificar com a ELIZA IA?</span>
                            <span className="text-[9px] text-teal-600 font-semibold block leading-tight">Usa inteligência artificial para unificar os TCLEs dos procedimentos aceitos</span>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={contractUseAI}
                          onChange={(e) => setContractUseAI(e.target.checked)}
                          className="w-4 h-4 text-teal-600 border-teal-300 rounded outline-none cursor-pointer"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCompileContract(contractUseAI)}
                        disabled={isCompilingContract}
                        className="w-full bg-slate-900 text-white hover:bg-slate-800 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-slate-900/20 active:scale-95 shrink-0"
                      >
                        {isCompilingContract ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Compilando Contrato...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-teal-400" /> Compilar Contrato Completo
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Form fields: Patient Details */}
                  <div className="space-y-4">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.1em] block">
                      Dados Cadastrais do Paciente
                    </span>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Nome do Paciente</label>
                        <input
                          type="text"
                          value={contractFormData.patientName}
                          onChange={(e) => setContractFormData({ ...contractFormData, patientName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">CPF do Paciente</label>
                        <input
                          type="text"
                          value={contractFormData.patientCpf}
                          onChange={(e) => setContractFormData({ ...contractFormData, patientCpf: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">RG do Paciente</label>
                        <input
                          type="text"
                          value={contractFormData.patientRg}
                          onChange={(e) => setContractFormData({ ...contractFormData, patientRg: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Data Nascimento</label>
                        <input
                          type="text"
                          value={contractFormData.patientBirthDate}
                          onChange={(e) => setContractFormData({ ...contractFormData, patientBirthDate: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Celular/Telefone</label>
                        <input
                          type="text"
                          value={contractFormData.patientPhone}
                          onChange={(e) => setContractFormData({ ...contractFormData, patientPhone: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Profissional Responsável (RT)</label>
                        <input
                          type="text"
                          value={contractFormData.professionalName}
                          onChange={(e) => setContractFormData({ ...contractFormData, professionalName: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">CRO do Profissional</label>
                        <input
                          type="text"
                          value={contractFormData.professionalCro}
                          onChange={(e) => setContractFormData({ ...contractFormData, professionalCro: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Condição de Pagamento</label>
                        <input
                          type="text"
                          value={contractFormData.paymentMethod}
                          onChange={(e) => setContractFormData({ ...contractFormData, paymentMethod: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Endereço do Paciente</label>
                      <input
                        type="text"
                        value={contractFormData.patientAddress}
                        onChange={(e) => setContractFormData({ ...contractFormData, patientAddress: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Right Side: Legal Sheet Paper preview (Surgically elegant markdown textarea) */}
                <div className="lg:col-span-7 bg-slate-100 p-6 md:p-8 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.1em]">
                      Pré-visualização e Edição
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                      Texto livre do contrato — Edite se necessário
                    </span>
                  </div>

                  <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col">
                    <textarea
                      value={contractText}
                      onChange={(e) => setContractText(e.target.value)}
                      placeholder="Preencha as informações à esquerda e clique em 'Compilar Contrato Completo' para carregar a pré-visualização oficial..."
                      className="flex-1 p-8 md:p-12 text-xs font-medium font-serif leading-relaxed text-slate-800 bg-white border-none outline-none resize-none custom-scrollbar focus:ring-0"
                    />
                  </div>
                </div>
              </div>

              {/* Footer action bar */}
              <div className="p-6 md:p-8 bg-white border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsContractGeneratorOpen(false)}
                    className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-slate-50 transition-colors cursor-pointer animate-none"
                  >
                    Fechar
                  </button>
                  
                  {contractText && (
                    <button
                      type="button"
                      onClick={() => handlePrintSpecificContract(contractText, 'Contrato de Harmonização')}
                      className="px-6 py-3 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
                    >
                      <Printer className="w-4 h-4 text-slate-500" /> Imprimir / Exportar PDF
                    </button>
                  )}
                </div>

                {contractText && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveGeneratedContract('draft')}
                      className="px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                    >
                      Salvar Rascunho
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveGeneratedContract('generated')}
                      className="px-5 py-3 bg-indigo-55 hover:bg-indigo-100 text-indigo-700 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer"
                    >
                      Emitir Contrato
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveGeneratedContract('signed')}
                      className="px-6 py-3 bg-teal-600 hover:bg-teal-700 hover:shadow-teal-600/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-lg shadow-teal-600/5 active:scale-95 cursor-pointer"
                    >
                      <FileCheck className="w-4 h-4" /> Marcar como Assinado
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Deseja solicitar agendamento de retorno pós-tratamento? (Part 1 - Prontuário) */}
      <AnimatePresence>
        {completedTreatmentForReturn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCompletedTreatmentForReturn(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-8 z-10 text-center">
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-5 text-teal-600">
                <CalendarDays className="w-8 h-8 animate-bounce" />
              </div>
              <h3 className="text-lg font-extrabold text-slate-900 mb-2 font-sans">
                Procedimento Finalizado!
              </h3>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                Você acabou de finalizar <strong>{completedTreatmentForReturn.description}</strong> para o paciente <strong>{selectedPatient?.name}</strong>. Deseja solicitar agendamento de retorno para este paciente agora?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const desc = completedTreatmentForReturn.description;
                    setCompletedTreatmentForReturn(null);
                    handleOpenReturnRequestManual(desc);
                  }}
                  className="py-3.5 bg-teal-600 hover:bg-teal-700 hover:shadow-teal-650/15 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md"
                >
                  Sim, solicitar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompletedTreatmentForReturn(null);
                    alert("Procedimento finalizado e registrado com sucesso!");
                  }}
                  className="py-3.5 border border-slate-205 hover:bg-slate-50 text-slate-500 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  Não agora
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Solicitar Retorno do Paciente (Part 1 - Campos do Formulário) */}
      <AnimatePresence>
        {isReturnRequestModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsReturnRequestModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-8 md:p-10 z-10 flex flex-col max-h-[90vh] overflow-hidden">
              <div className="flex gap-3 items-center border-b border-slate-100 pb-5 mb-6">
                <div className="p-3 bg-teal-50 rounded-2xl text-teal-600">
                  <CalendarDays className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 font-sans tracking-tight">Solicitar Retorno do Paciente</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Sinalizações pós-tratamento para a recepção</p>
                </div>
              </div>

              <form onSubmit={handleSaveReturnRequest} className="space-y-4 overflow-y-auto pr-2 custom-scrollbar pb-2">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Paciente</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={selectedPatient?.name || ''}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Procedimento/Tratamento Vinculado</label>
                  <input
                    type="text"
                    required
                    value={returnRequestForm.treatmentName}
                    onChange={(e) => setReturnRequestForm({ ...returnRequestForm, treatmentName: e.target.value })}
                    placeholder="Ex: Aplicação de Hialurônico, Botox, Dreno..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Profissional Solicitante</label>
                    <select
                      required
                      value={returnRequestForm.professionalId}
                      onChange={(e) => setReturnRequestForm({...returnRequestForm, professionalId: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                    >
                      <option value="">Selecione o profissional...</option>
                      {staff.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Prioridade do Contato</label>
                    <select
                      required
                      value={returnRequestForm.priority}
                      onChange={(e) => setReturnRequestForm({...returnRequestForm, priority: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                    >
                      <option value="Baixa">Baixa</option>
                      <option value="Normal">Normal</option>
                      <option value="Alta">Alta (Destaque na Recepção)</option>
                      <option value="Urgente">Urgente (Imediato)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tipo de Retorno</label>
                    <select
                      required
                      value={returnRequestForm.returnType}
                      onChange={(e) => setReturnRequestForm({...returnRequestForm, returnType: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                    >
                      <option value="Revisão pós-procedimento">Revisão pós-procedimento</option>
                      <option value="Retorno fotográfico">Retorno fotográfico</option>
                      <option value="Remoção de pontos">Remoção de pontos</option>
                      <option value="Reavaliação clínica">Reavaliação clínica</option>
                      <option value="Manutenção">Manutenção</option>
                      <option value="Recall de botox">Recall de botox</option>
                      <option value="Recall de preenchimento">Recall de preenchimento</option>
                      <option value="Recall de bioestimulador">Recall de bioestimulador</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Prazo Sugerido</label>
                    <select
                      required
                      value={returnRequestForm.suggestedDeadline}
                      onChange={(e) => setReturnRequestForm({...returnRequestForm, suggestedDeadline: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                    >
                      <option value="7 dias">7 dias</option>
                      <option value="15 dias">15 dias</option>
                      <option value="30 dias">30 dias</option>
                      <option value="90 dias">30 dias - 3 meses</option>
                      <option value="120 dias">120 dias - 4 meses</option>
                      <option value="150 dias">150 dias - 5 meses</option>
                      <option value="180 dias">180 dias - 6 meses</option>
                      <option value="Data personalizada">Data personalizada</option>
                    </select>
                  </div>
                </div>

                {returnRequestForm.suggestedDeadline === 'Data personalizada' && (
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Selecione a Data Limite</label>
                    <input
                      type="date"
                      required
                      value={returnRequestForm.customDate}
                      onChange={(e) => setReturnRequestForm({ ...returnRequestForm, customDate: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:border-teal-600"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Observação do Profissional</label>
                  <textarea
                    value={returnRequestForm.observation}
                    onChange={(e) => setReturnRequestForm({ ...returnRequestForm, observation: e.target.value })}
                    placeholder="Especifique recomendações extras para o agendamento..."
                    className="w-full h-24 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs outline-none focus:border-teal-600 resize-none font-medium text-slate-800"
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsReturnRequestModalOpen(false)}
                    className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20"
                  >
                    Enviar Solicitação
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
