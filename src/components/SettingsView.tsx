import React, { useState, useEffect } from "react";
import {
  Settings,
  Users,
  Shield,
  CreditCard,
  FileText,
  FolderTree,
  Building2,
  Clock,
  MapPin,
  Plus,
  Mail,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Stethoscope,
  Briefcase,
  Database,
  Lock,
  AlertTriangle,
  RotateCcw,
  Loader2,
  Trash2,
  CheckCircle,
  Search,
  Edit3,
  Eye,
  EyeOff,
  Activity,
  Smartphone,
  Sparkles,
  ArrowLeft,
  Pill,
  UploadCloud,
  Globe,
  Instagram,
  Palette,
  Type,
  Undo,
  DollarSign,
  GraduationCap,
} from "lucide-react";
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  setDoc,
  getDoc,
  doc,
  serverTimestamp,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../lib/firebase";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import {
  DEFAULT_TREATMENT_CATALOG,
  TreatmentCatalogItem,
  TREATMENT_CATEGORIES,
} from "../data/treatmentCatalog";
import DataImportView from "./DataImportView";
import FirebaseDiagnosis from "./FirebaseDiagnosis";
import { AdminService, ResetProgress } from "../services/adminService";
import WhatsAppSettings from "./WhatsAppSettings";
import ElizaInternaSettings from "./ElizaInternaSettings";
import ElizaTrainingSettings from "./ElizaTrainingSettings";
import ElizaAISettings from "./ElizaAISettings";
import { InviteService } from "../services/inviteService";

type SettingsTab =
  | "clinic"
  | "team"
  | "plans"
  | "treatments"
  | "anamnesis"
  | "contract"
  | "prescription"
  | "categories"
  | "cashier"
  | "import"
  | "diagnosis"
  | "whatsapp"
  | "eliza_interna"
  | "eliza_training"
  | "education_settings"
  | "eliza_ai"
  | "admin";

export default function SettingsView() {
  const { clinic, user, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("clinic");
  const [mobileView, setMobileView] = useState<"menu" | "content">("menu");
  const [staff, setStaff] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [cashiers, setCashiers] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [treatmentCatalog, setTreatmentCatalog] = useState<
    TreatmentCatalogItem[]
  >([]);
  const [isTreatmentModalOpen, setIsTreatmentModalOpen] = useState(false);
  const [targetTreatment, setTargetTreatment] =
    useState<Partial<TreatmentCatalogItem> | null>(null);
  const [treatmentSearch, setTreatmentSearch] = useState("");
  const [selectedCatalogCategory, setSelectedCatalogCategory] =
    useState<string>("Todas");

  const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [isAddPlanModalOpen, setIsAddPlanModalOpen] = useState(false);
  const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
  const [isAdminResetModalOpen, setIsAdminResetModalOpen] = useState(false);

  const [newStaff, setNewStaff] = useState({
    name: "",
    email: "",
    role: "dentist",
    phone: "",
    isAdmin: false,
    password: "",
    isClinicalProvider: true,
  });
  const [newPlan, setNewPlan] = useState({ name: "", type: "particular" });
  const [newCategory, setNewCategory] = useState({
    group: "Administrativo",
    name: "",
  });

  // Admin Reset State
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetProgress, setResetProgress] = useState<ResetProgress[]>([]);
  const [isResetting, setIsResetting] = useState(false);
  const [resetFinished, setResetFinished] = useState(false);

  const [clinicData, setClinicData] = useState<any>({
    name: "ELIZA Odontologia Digital",
    fantasyName: "",
    companyName: "",
    cnpj: "45.678.901/0001-23",
    ownerName: "",
    technicalDirector: "",
    technicalDirectorCouncilNumber: "",
    phone: "",
    whatsapp: "",
    email: "",
    website: "",
    instagram: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    address: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP",

    // Document configuration & visual identity
    documentName: "",
    institutionalFooter: "",
    defaultObservationText: "",
    textSignature: "",
    logoBase64: "",
    primaryColor: "#0f172a",
    secondaryColor: "#0d9488",
    fontPreference: "Inter",
    customHeader: "",
    customFooter: "",

    hours: {
      weekday: "08:00 - 18:00",
      saturday: "08:00 - 12:00",
    },
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateContent, setTemplateContent] = useState("");

  // AI Branding Scanner States
  const [isParsingBrand, setIsParsingBrand] = useState(false);
  const [detectedBrandResult, setDetectedBrandResult] = useState<any | null>(
    null,
  );
  const [confirmedAIFields, setConfirmedAIFields] = useState<
    Record<string, boolean>
  >({});

  const [isCreatingStaff, setIsCreatingStaff] = useState(false);

  useEffect(() => {
    if (activeTab === "clinic") {
      console.log("[CLINIC_PROFILE_OPENED]");
    }
  }, [activeTab]);

  useEffect(() => {
    if (!clinic) return;

    // Listeners for various settings
    const unsubStaff = onSnapshot(
      query(collection(db, "clinics", clinic.id, "team_members")),
      (snap) => setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/team_members`,
        ),
    );
    const unsubInvites = onSnapshot(
      query(collection(db, "clinics", clinic.id, "invites")),
      (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/invites`,
        ),
    );
    const unsubPlans = onSnapshot(
      query(collection(db, "clinics", clinic.id, "dentalPlans")),
      (snap) => setPlans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/dentalPlans`,
        ),
    );
    const unsubCats = onSnapshot(
      query(collection(db, "clinics", clinic.id, "financialCategories")),
      (snap) =>
        setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/financialCategories`,
        ),
    );
    const unsubCash = onSnapshot(
      query(collection(db, "clinics", clinic.id, "cashiers")),
      (snap) => setCashiers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/cashiers`,
        ),
    );
    const unsubTemplates = onSnapshot(
      query(collection(db, "clinics", clinic.id, "templates")),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
        setTemplates(list);
        if (list.length > 0 && !selectedTemplateId) {
          setSelectedTemplateId(list[0].id);
          setTemplateContent(list[0].content || "");
        }
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/templates`,
        ),
    );

    // Load Clinic Settings
    const unsubClinic = onSnapshot(
      doc(db, "clinics", clinic.id),
      (snap) => {
        if (snap.exists()) setClinicData(snap.data() as any);
      },
      (err) =>
        handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}`),
    );

    const unsubCatalog = onSnapshot(
      query(collection(db, "clinics", clinic.id, "treatment_catalog")),
      (snap) => {
        const dbProcedures = snap.docs.map((doc) => ({
          id: doc.id,
          name: doc.data().name || "",
          category: doc.data().category || "",
          subcategory: doc.data().subcategory || "",
          defaultPrice: Number(doc.data().defaultPrice) || 0,
          baseValue: Number(doc.data().defaultPrice) || 0,
          description: doc.data().description || "",
          estimatedDuration: Number(doc.data().estimatedDuration) || 0,
          requiresFaces: !!doc.data().requiresFaces,
          requiresRegion: !!doc.data().requiresRegion,
          active: doc.data().active !== false,
          createdAt: doc.data().createdAt,
          updatedAt: doc.data().updatedAt,
          createdBy: doc.data().createdBy,
        }));

        const merged = [
          ...dbProcedures,
          ...DEFAULT_TREATMENT_CATALOG.filter(
            (def) =>
              !dbProcedures.some(
                (dbProc) =>
                  dbProc.name.toLowerCase() === def.name.toLowerCase(),
              ),
          ),
        ];
        setTreatmentCatalog(merged);
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `clinics/${clinic.id}/treatment_catalog`,
        ),
    );

    return () => {
      unsubStaff();
      unsubInvites();
      unsubPlans();
      unsubCats();
      unsubCash();
      unsubTemplates();
      unsubClinic();
      unsubCatalog();
    };
  }, [selectedTemplateId, clinic]);

  const handleAddStaff = async () => {
    if (!newStaff.email || !newStaff.name || !clinic) return;

    console.log("[TEAM_CREATE_START]", {
      email: newStaff.email,
      name: newStaff.name,
      role: newStaff.role,
      isClinicalProvider: newStaff.isClinicalProvider,
      timestamp: new Date().toISOString(),
    });

    setIsCreatingStaff(true);
    try {
      if (!InviteService) {
        console.error(
          "[INVITE_SERVICE_LOAD_ERROR] InviteService is undefined in static imports.",
        );
        alert(
          "Não foi possível carregar o serviço de convite. Atualize a página e tente novamente.",
        );
        return;
      }
      console.log("[INVITE_SERVICE_LOADED]");

      // If password provided, create directly. Otherwise, send invite (existing logic).
      // The user wants admin to provide a temporary password.
      if (newStaff.password) {
        const result = await InviteService.createStaffMember(clinic.id, {
          email: newStaff.email,
          name: newStaff.name,
          role: newStaff.role,
          password: newStaff.password,
          isClinicalProvider: newStaff.isClinicalProvider,
        });

        if (result && result.uid) {
          const isClinFallVal = [
            "dentist",
            "dentist_gp",
            "especialista",
            "professional",
            "clinical_professional",
            "doctor",
            "dentista",
            "odontologista",
            "médico",
          ].includes(newStaff.role?.toLowerCase() || "");
          // Create matching team_members document instantly
          await setDoc(
            doc(db, "clinics", clinic.id, "team_members", result.uid),
            {
              id: result.uid,
              uid: result.uid,
              name: newStaff.name,
              displayName: newStaff.name,
              email: newStaff.email.toLowerCase(),
              role: newStaff.role,
              active: true,
              isClinicalProvider:
                newStaff.isClinicalProvider !== undefined
                  ? newStaff.isClinicalProvider
                  : isClinFallVal,
              isProfessional: isClinFallVal,
              isCommissionable: false,
              defaultCommissionPercent: 0,
              financial: {
                commissionPercent: 0,
                commissionEnabled: false,
                receiveFinancialSummary: false,
              },
              attendance: {
                isProfessional: isClinFallVal,
              },
              marketing: {
                enabled: false,
              },
              secretary: {
                enabled: false,
              },
              created_at: serverTimestamp(),
              updated_at: serverTimestamp(),
            },
          );
        }

        console.log("[TEAM_CREATE_SUCCESS]", {
          email: newStaff.email,
          uid: result ? result.uid : null,
        });

        if (result.isNewUser) {
          alert("Nova conta ELIZA criada e vinculada com sucesso!");
        } else {
          alert(
            "Usuário ELIZA existente encontrado e vinculado à sua clínica!",
          );
        }
      } else {
        // Fallback to invite link if no password
        const inviteId = Math.random().toString(36).substring(2, 15);
        await setDoc(doc(db, "clinics", clinic.id, "invites", inviteId), {
          email: (newStaff.email || "").toLowerCase(),
          name: newStaff.name,
          role: newStaff.role,
          clinicId: clinic.id,
          clinicName: clinic.name,
          clinicSlug: clinic.slug,
          isClinicalProvider: newStaff.isClinicalProvider,
          status: "pending",
          token: inviteId,
          invitedByUid: clinic.ownerId,
          createdAt: serverTimestamp(),
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        });
        console.log("[TEAM_CREATE_SUCCESS] Invite token created:", inviteId);
        alert("Convite enviado com sucesso!");
      }

      setIsAddStaffModalOpen(false);
      setNewStaff({
        name: "",
        email: "",
        role: "dentist",
        phone: "",
        isAdmin: false,
        password: "",
        isClinicalProvider: true,
      });
    } catch (err: any) {
      console.error("[TEAM_CREATE_ERROR]", err.message);
      alert("Erro ao criar funcionário: " + err.message);
    } finally {
      setIsCreatingStaff(false);
    }
  };

  const handleRemoveStaff = async (staffId: string) => {
    if (
      !clinic ||
      !window.confirm("Deseja realmente remover este membro da equipe?")
    )
      return;
    const path = `clinics/${clinic.id}/members/${staffId}`;
    try {
      await deleteDoc(doc(db, "clinics", clinic.id, "members", staffId));
      try {
        await deleteDoc(doc(db, "clinics", clinic.id, "team_members", staffId));
      } catch (teamErr) {
        console.warn("[Settings] Error deleting from team_members:", teamErr);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleSaveMember = async () => {
    if (!clinic || !editingMember) return;
    try {
      console.log(
        "[TEAM_MEMBER_SAVE_ATTEMPT] Attempting to save team member:",
        editingMember.id,
      );
      console.log(
        "[FOLHA_COLABORADOR_CONFIGURADA] Configured member ID: " +
          editingMember.id,
      );

      const mergedRole =
        editingMember.role ||
        editingMember.cargo ||
        editingMember.função ||
        "colaborador";
      const mergedIsClinical = !!(
        editingMember.isClinicalProvider ??
        editingMember.agendaEnabled ??
        editingMember.isProfessional
      );
      const mergedSalary = Number(
        editingMember.salaryFixed ?? editingMember.salary ?? 0,
      );
      const mergedSalaryPayDay = Number(
        editingMember.salaryPayDay ?? editingMember.salaryPaymentDay ?? 5,
      );
      const mergedCommissionEnabled = !!(
        editingMember.commissionEnabled ??
        editingMember.receivesCommission ??
        editingMember.isCommissionable ??
        editingMember.commissionEligible
      );
      const mergedCommissionPercent = Number(
        editingMember.commissionPercent ??
          editingMember.percentage ??
          editingMember.commissionPercentage ??
          editingMember.defaultCommissionPercent ??
          30,
      );
      const mergedCommissionPayDay = Number(
        editingMember.commissionPayDay ??
          editingMember.commissionPaymentDay ??
          10,
      );
      const mergedProfessionalType =
        editingMember.professionalType ?? editingMember.tipoProfissional ?? "";

      const mergedAtendimentoClinicoAtivo = editingMember.atendimentoClinicoAtivo !== undefined 
        ? !!editingMember.atendimentoClinicoAtivo 
        : true;
      const mergedAgendaLiberada = editingMember.agendaLiberada !== undefined 
        ? !!editingMember.agendaLiberada 
        : true;
      const mergedCommissionEligible = editingMember.commissionEligible !== undefined 
        ? !!editingMember.commissionEligible 
        : mergedCommissionEnabled;
      const mergedCommissionRequiresAdminApproval = editingMember.commissionRequiresAdminApproval !== undefined 
        ? !!editingMember.commissionRequiresAdminApproval 
        : true;

      const mergedAccessFinancial =
        editingMember.accessFinancial !== undefined
          ? !!editingMember.accessFinancial
          : true;
      const mergedAllowFinancialModify = !!(
        editingMember.allowFinancialModify ??
        editingMember.canEditFinancial ??
        editingMember.canDeleteFinancial
      );

      if (editingMember.customPermissionsLocked) {
        console.log(
          "[TEAM_MEMBER_PERMISSION_DEFAULT_SKIPPED] Custom permissions are locked for user:",
          editingMember.id,
        );
      }

      const payload: any = {
        name: editingMember.name || "",
        displayName: editingMember.name || "",
        email: editingMember.email || "",
        phone: editingMember.phone || "",
        role: mergedRole,
        cargo: mergedRole,
        função: mergedRole,
        active: editingMember.active !== false,
        isClinicalProvider: mergedIsClinical,
        agendaEnabled: mergedIsClinical,
        isProfessional: mergedIsClinical,
        customPermissionsLocked: true,

        // finance
        salary: mergedSalary,
        salaryFixed: mergedSalary,
        salaryPayDay: mergedSalaryPayDay,
        salaryPaymentDay: mergedSalaryPayDay,
        commissionEnabled: mergedCommissionEnabled,
        receivesCommission: mergedCommissionEnabled,
        isCommissionable: mergedCommissionEnabled,
        commissionPercent: mergedCommissionPercent,
        percentage: mergedCommissionPercent,
        commissionPercentage: mergedCommissionPercent,
        commissionPayDay: mergedCommissionPayDay,
        commissionPaymentDay: mergedCommissionPayDay,
        professionalType: mergedProfessionalType,
        tipoProfissional: mergedProfessionalType,

        // ELIZA Commission Motor additions
        atendimentoClinicoAtivo: mergedAtendimentoClinicoAtivo,
        agendaLiberada: mergedAgendaLiberada,
        commissionEligible: mergedCommissionEligible,
        commissionRequiresAdminApproval: mergedCommissionRequiresAdminApproval,
        defaultCommissionPercent: mergedCommissionPercent,

        // Access Flags
        accessFinancial: mergedAccessFinancial,
        canManageFinancial: mergedAccessFinancial,
        canCloseCash: mergedAccessFinancial,

        allowFinancialModify: mergedAllowFinancialModify,
        canEditFinancial: mergedAllowFinancialModify,
        canDeleteFinancial: mergedAllowFinancialModify,

        accessInventory: editingMember.accessInventory !== false,
        accessCRM: editingMember.accessCRM !== false,
        accessSettings: editingMember.accessSettings !== false,
        accessReports: editingMember.accessReports !== false,
        accessCourses: editingMember.accessCourses !== false,
        courseRole: editingMember.courseRole || "professor",

        financial: {
          salary: mergedSalary,
          salaryFixed: mergedSalary,
          salaryPayDay: mergedSalaryPayDay,
          salaryPaymentDay: mergedSalaryPayDay,
          commissionEnabled: mergedCommissionEnabled,
          receivesCommission: mergedCommissionEnabled,
          commissionPercent: mergedCommissionPercent,
          percentage: mergedCommissionPercent,
          commissionPercentage: mergedCommissionPercent,
          commissionPayDay: mergedCommissionPayDay,
          commissionPaymentDay: mergedCommissionPayDay,
          professionalType: mergedProfessionalType,
          tipoProfissional: mergedProfessionalType,
          receiveFinancialSummary:
            !!editingMember.financial?.receiveFinancialSummary,
          atendimentoClinicoAtivo: mergedAtendimentoClinicoAtivo,
          agendaLiberada: mergedAgendaLiberada,
          commissionEligible: mergedCommissionEligible,
          commissionRequiresAdminApproval: mergedCommissionRequiresAdminApproval,
          defaultCommissionPercent: mergedCommissionPercent,
        },
        updated_at: serverTimestamp(),
      };

      console.log("[TEAM_MEMBER_SAVE_PAYLOAD] Payload to save:", payload);

      // 1. Update in members collection
      await updateDoc(
        doc(db, "clinics", clinic.id, "members", editingMember.id),
        payload,
      );

      // 2. Update in team_members collection
      const teamMRef = doc(
        db,
        "clinics",
        clinic.id,
        "team_members",
        editingMember.id,
      );
      const teamMDoc = await getDoc(teamMRef);

      if (!teamMDoc.exists()) {
        payload.attendance = {
          isProfessional: mergedIsClinical,
        };
        payload.marketing = { enabled: false };
        payload.secretary = { enabled: false };
        payload.created_at = serverTimestamp();
        await setDoc(teamMRef, payload);
      } else {
        await updateDoc(teamMRef, payload);
      }

      console.log(
        "[TEAM_MEMBER_ROLE_PERSISTED] Role updated to:",
        mergedRole,
        "for member:",
        editingMember.id,
      );
      console.log(
        "[TEAM_MEMBER_SAVE_SUCCESS] Successfully updated custom member data in database!",
      );

      alert("Integrante da equipe atualizado com sucesso!");
      setEditingMember(null);
    } catch (err: any) {
      console.error(
        "[TEAM_MEMBER_SAVE_ERROR] Error updating member:",
        err.message,
      );
      alert("Erro ao atualizar integrante: " + err.message);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!clinic || !window.confirm("Deseja realmente cancelar este convite?"))
      return;
    const path = `clinics/${clinic.id}/invites/${inviteId}`;
    try {
      await deleteDoc(doc(db, "clinics", clinic.id, "invites", inviteId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleDeleteItem = async (collectionName: string, id: string) => {
    if (!clinic || !window.confirm("Tem certeza que deseja excluir este item?"))
      return;
    const path = `clinics/${clinic.id}/${collectionName}/${id}`;
    try {
      await deleteDoc(doc(db, "clinics", clinic.id, collectionName, id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const runBrandAnalysis = async (file: File) => {
    setIsParsingBrand(true);
    console.log("[BRAND_ANALYSIS_STARTED]");
    try {
      const base64Complete = await fileToBase64(file);
      const commaIndex = base64Complete.indexOf(",");
      const mimeType = base64Complete.substring(5, base64Complete.indexOf(";"));
      const base64Data = base64Complete.substring(commaIndex + 1);

      const contents = [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            },
            {
              text: `Você é a inteligência artificial ELIZA, especializada em detecção de marca e identidade corporativa para clínicas de alta performance de Harmonização Facial, Odontologia e Estética. Analise esta imagem ou documento de marca para extrair todos os metadados possíveis da clínica. Retorne um JSON estrito no formato abaixo, sem formatações adicionais ou marcações de markdown externas ao JSON. NUNCA invente dados fiscais (como CNPJ ou CPF). Se não encontrar, deixe como string vazia.
JSON Schema:
{
  "name": "Nome Fantasia ou comercial",
  "companyName": "Razão Social da clínica",
  "cnpj": "CNPJ detectado formatado",
  "ownerName": "Nome do proprietário ou diretor",
  "technicalDirector": "Nome do Responsável Técnico",
  "technicalDirectorCouncilNumber": "CRO/CRM do Responsável Técnico",
  "phone": "Telefone principal",
  "whatsapp": "WhatsApp principal",
  "email": "E-mail de contato principal",
  "website": "Site oficial",
  "instagram": "Instagram de contato",
  "cep": "CEP detectado",
  "street": "Rua ou Avenida do endereço",
  "number": "Número",
  "complement": "Complemento",
  "neighborhood": "Bairro",
  "city": "Cidade",
  "state": "Estado em sigla de duas letras (ex: SP)",
  "primaryColor": "Sugestão de cor primária em Hexadecimal que combine com esse material (ex: #1a202c)",
  "secondaryColor": "Sugestão de cor secundária em Hexadecimal (ex: #319795)",
  "fontPreference": "Indicação de fonte preferencial (um dentre 'Inter', 'Space Grotesk', 'Playfair Display', 'Fira Code', 'system-ui')",
  "documentName": "Nome personalizado que deve aparecer nos cabeçalhos dos documentos",
  "institutionalFooter": "Rodapé institucional sugerido",
  "textSignature": "Texto padrão para fechamento de assinatura (ex: 'Atenciosamente, Equipe ELIZA')"
}`,
            },
          ],
        },
      ];

      const response = await fetch("/api/ai/generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          contents: contents,
          config: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(
          resData.error || "Erro ao processar imagem pela ELIZA IA.",
        );
      }

      let parsedResult: any = {};
      try {
        const textToParse = resData.text || "";
        const cleanJson = textToParse
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();
        parsedResult = JSON.parse(cleanJson);
      } catch (parseErr) {
        console.error("[BRAND_PARSE_ERROR]", parseErr);
        throw new Error(
          "Não foi possível decodificar as informações retornadas pela ELIZA IA. Certifique-se de que a imagem contém textos legíveis.",
        );
      }

      setDetectedBrandResult(parsedResult);
      console.log("[BRAND_ANALYSIS_COMPLETED]");
      console.log("[BRAND_DATA_DETECTED]", parsedResult);
    } catch (err: any) {
      console.error("[BRAND_AI_ERROR]", err);
      alert("Falha ao analisar marca com IA: " + err.message);
    } finally {
      setIsParsingBrand(false);
    }
  };

  const handleSaveClinicData = async () => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}`;
    try {
      await setDoc(
        doc(db, "clinics", clinic.id),
        {
          ...clinicData,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      console.log("[CLINIC_PROFILE_SAVED]", { clinicId: clinic.id });
      alert("Dados da clínica atualizados!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplateId || !clinic) return;
    const path = `clinics/${clinic.id}/templates/${selectedTemplateId}`;
    try {
      await setDoc(
        doc(db, "clinics", clinic.id, "templates", selectedTemplateId),
        {
          content: templateContent,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      alert("Template salvo!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleInitializeDefaultContracts = async () => {
    if (!clinic) return;
    const confirmSeed = window.confirm(
      "Deseja inicializar o banco de dados de modelos de contrato com os 8 modelos estéticos oficiais da ELIZA IA? (Toxina Botulínica, Preenchimento Facial, Bioestimuladores de colágeno, Fios de PDO, Rinomodelação, Lipo de papada, Plano Full Face e Odontologia geral)",
    );
    if (!confirmSeed) return;
    try {
      const { DEFAULT_CONTRACT_TEMPLATES } =
        await import("../data/defaultContractTemplates");
      const templatesRef = collection(db, "clinics", clinic.id, "templates");
      for (const t of DEFAULT_CONTRACT_TEMPLATES) {
        await addDoc(templatesRef, {
          name: t.name,
          type: "contract",
          content: t.defaultContent,
          createdAt: serverTimestamp(),
        });
      }
      alert(
        "Os 8 Modelos de Contratos da ELIZA foram inicializados com pleno sucesso!",
      );
    } catch (err: any) {
      console.error(err);
      alert("Falha ao inicializar modelos: " + err.message);
    }
  };

  const handleInitializeDefaultPrescriptions = async () => {
    if (!clinic) return;
    const confirmSeed = window.confirm(
      "Deseja inicializar o banco de dados de modelos de receitário com os 4 modelos estéticos oficiais da ELIZA IA? (Pós-Toxina, Pós-Preenchimento, Pós-Bioestimulador/Fios e Preventivo de Herpes)",
    );
    if (!confirmSeed) return;
    try {
      const { DEFAULT_PRESCRIPTION_TEMPLATES } =
        await import("../data/defaultPrescriptionTemplates");
      const templatesRef = collection(db, "clinics", clinic.id, "templates");
      for (const t of DEFAULT_PRESCRIPTION_TEMPLATES) {
        await addDoc(templatesRef, {
          name: t.name,
          type: "prescription",
          content: t.defaultContent,
          createdAt: serverTimestamp(),
        });
      }
      alert(
        "Os 4 Modelos de Receituários Inteligentes da ELIZA foram inicializados com pleno sucesso!",
      );
    } catch (err: any) {
      console.error(err);
      alert("Falha ao inicializar modelos: " + err.message);
    }
  };

  const insertTag = (tag: string) => {
    const textarea = document.getElementById(
      "template-content",
    ) as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = templateContent;
    const before = text.substring(0, start);
    const after = text.substring(end);

    setTemplateContent(before + tag + after);

    // Return focus
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  const handleAddTemplate = async (type: string) => {
    if (!clinic) return;
    const name = prompt("Nome do novo modelo:");
    if (!name) return;
    const path = `clinics/${clinic.id}/templates`;
    try {
      const docRef = await addDoc(
        collection(db, "clinics", clinic.id, "templates"),
        {
          name,
          type,
          content: "",
          createdAt: serverTimestamp(),
        },
      );
      setSelectedTemplateId(docRef.id);
      setTemplateContent("");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleAddPlan = async () => {
    if (!newPlan.name || !clinic) return;
    const path = `clinics/${clinic.id}/dentalPlans`;
    try {
      await addDoc(collection(db, "clinics", clinic.id, "dentalPlans"), {
        ...newPlan,
        createdAt: serverTimestamp(),
      });
      setIsAddPlanModalOpen(false);
      setNewPlan({ name: "", type: "particular" });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.name || !clinic) return;
    const path = `clinics/${clinic.id}/financialCategories`;
    try {
      await addDoc(
        collection(db, "clinics", clinic.id, "financialCategories"),
        {
          ...newCategory,
          createdAt: serverTimestamp(),
        },
      );
      setIsAddCategoryModalOpen(false);
      setNewCategory({ ...newCategory, name: "" });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleAddCashier = async (name: string, balance: number) => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/cashiers`;
    try {
      await addDoc(collection(db, "clinics", clinic.id, "cashiers"), {
        name,
        balance,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleSaveTreatment = async () => {
    if (
      !clinic ||
      !targetTreatment ||
      !targetTreatment.name ||
      !targetTreatment.category
    )
      return;
    const id = targetTreatment.id || `treat-${Date.now()}`;
    const path = `clinics/${clinic.id}/treatment_catalog/${id}`;

    try {
      await setDoc(
        doc(db, "clinics", clinic.id, "treatment_catalog", id),
        {
          name: targetTreatment.name,
          category: targetTreatment.category,
          subcategory: targetTreatment.subcategory || "",
          defaultPrice: Number(targetTreatment.defaultPrice) || 0,
          description: targetTreatment.description || "",
          estimatedDuration: Number(targetTreatment.estimatedDuration) || 0,
          requiresFaces: !!targetTreatment.requiresFaces,
          requiresRegion: !!targetTreatment.requiresRegion,
          active: targetTreatment.active !== false,
          updatedAt: serverTimestamp(),
          ...(targetTreatment.id
            ? {}
            : { createdAt: serverTimestamp(), createdBy: user?.uid }),
        },
        { merge: true },
      );

      setIsTreatmentModalOpen(false);
      setTargetTreatment(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleToggleTreatmentActive = async (item: TreatmentCatalogItem) => {
    if (!clinic) return;
    const path = `clinics/${clinic.id}/treatment_catalog/${item.id}`;
    try {
      await setDoc(
        doc(db, "clinics", clinic.id, "treatment_catalog", item.id),
        {
          name: item.name,
          category: item.category,
          subcategory: item.subcategory || "",
          defaultPrice: item.defaultPrice,
          description: item.description || "",
          estimatedDuration: item.estimatedDuration || 0,
          requiresFaces: !!item.requiresFaces,
          requiresRegion: !!item.requiresRegion,
          active: !item.active,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleResetPatientBase = async () => {
    if (!clinic || resetConfirmation !== "CONFIRMAR RESET") return;

    setIsResetting(true);
    setResetFinished(false);

    try {
      const result = await AdminService.resetPatientBase(
        clinic.id,
        (progress) => {
          setResetProgress(progress);
        },
      );

      if (result.success) {
        setResetFinished(true);
      }
    } catch (err) {
      console.error("Reset failed:", err);
    } finally {
      setIsResetting(false);
    }
  };

  const isOwner = clinic && user && clinic.ownerId === user.uid;

  const tabs = [
    { id: "clinic", label: "Clínica", icon: Building2 },
    { id: "team", label: "Equipe", icon: Users },
    { id: "plans", label: "Planos", icon: ShieldCheck },
    { id: "treatments", label: "Tratamentos", icon: Stethoscope },
    { id: "anamnesis", label: "Anamnese", icon: FileText },
    { id: "contract", label: "Contratos", icon: FileText },
    { id: "prescription", label: "Receituários", icon: Pill },
    { id: "categories", label: "Categorias", icon: FolderTree },
    { id: "cashier", label: "Caixas", icon: Briefcase },
    { id: "import", label: "Importar", icon: Database },
    { id: "diagnosis", label: "Diagnóstico", icon: ShieldCheck },
    { id: "whatsapp", label: "WhatsApp", icon: Smartphone },
    { id: "eliza_interna", label: "ELIZA Interna", icon: Sparkles },
    { id: "eliza_training", label: "Treinamento da ELIZA", icon: Sparkles },
    { id: "education_settings", label: "ELIZA Education", icon: GraduationCap },
    { id: "eliza_ai", label: "IA ELIZA", icon: Sparkles },
    ...(isOwner ? [{ id: "admin", label: "Administração", icon: Lock }] : []),
  ];

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      <header className="px-4 sm:px-8 py-4 sm:py-6 bg-white border-b border-slate-200 shrink-0">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          {mobileView === "content" && (
            <button
              onClick={() => setMobileView("menu")}
              className="lg:hidden p-1.5 -ml-1 mr-1 hover:bg-slate-100 rounded-lg text-slate-600 flex items-center justify-center transition-all cursor-pointer border border-slate-200 bg-slate-55"
              title="Voltar"
              id="settings-back-button-header"
            >
              <ArrowLeft className="w-4 h-4 text-teal-600" />
            </button>
          )}
          <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600 shrink-0" />
          <span>Configurações do Sistema</span>
        </h2>
        <p className="text-[10px] sm:text-xs text-slate-500 font-medium">
          Personalize sua clínica, equipe e fluxos operacionais.
        </p>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <aside
          className={`${mobileView === "menu" ? "block w-full" : "hidden"} lg:block lg:w-64 bg-white lg:border-r border-slate-200 p-4 sm:p-6 space-y-1.5 overflow-y-auto h-full`}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as SettingsTab);
                setMobileView("content");
              }}
              className={`w-full flex items-center justify-between lg:justify-start gap-3 px-5 py-4 lg:px-4 lg:py-3 rounded-2xl text-xs lg:text-[11px] font-bold uppercase tracking-widest transition-all ${
                activeTab === tab.id
                  ? "bg-teal-50 text-teal-700 shadow-xs border border-teal-100/55 lg:border-none"
                  : "text-slate-500 bg-slate-50/50 lg:bg-transparent hover:bg-slate-50 lg:hover:bg-slate-50 hover:text-slate-700"
              } border border-slate-100/70 lg:border-none`}
            >
              <div className="flex items-center gap-3">
                <tab.icon className="w-4 h-4 text-teal-600/80 shrink-0" />
                <span>{tab.label}</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 lg:hidden" />
            </button>
          ))}
        </aside>

        {/* Main Settings Area */}
        <main
          className={`flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10 custom-scrollbar ${mobileView === "content" ? "block" : "hidden"} lg:block`}
        >
          {/* Back Button Bar for Mobile */}
          {mobileView === "content" && (
            <div className="lg:hidden mb-6 flex items-center">
              <button
                onClick={() => setMobileView("menu")}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold uppercase tracking-widest rounded-xl border border-slate-200 shadow-sm transition-all active:scale-95 cursor-pointer"
                id="settings-back-button-content"
              >
                <ArrowLeft className="w-4 h-4 text-teal-600" />
                <span>Voltar para o Menu</span>
              </button>
            </div>
          )}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl"
            >
              {activeTab === "clinic" && (
                <div className="space-y-8">
                  {/* Bloco 1: Scanner de Identidade Visual Inteligente com ELIZA IA */}
                  <section className="bg-gradient-to-br from-teal-500/5 to-slate-500/5 p-6 sm:p-8 rounded-[2rem] border border-teal-100 shadow-sm space-y-6">
                    <div className="flex items-start sm:items-center gap-2.5">
                      <Sparkles className="w-5 h-5 text-teal-600 animate-pulse shrink-0" />
                      <div>
                        <h3 className="text-xs sm:text-sm font-black text-slate-900 uppercase tracking-wider">
                          Detector Inteligente de Identidade da Clínica (ELIZA
                          IA)
                        </h3>
                        <p className="text-[10px] sm:text-[11px] text-slate-500 font-bold uppercase">
                          Faça upload do seu logotipo ou papel timbrado e a
                          ELIZA irá preencher os dados cadastrais e o visual!
                        </p>
                      </div>
                    </div>

                    <div className="border border-dashed border-teal-200 hover:border-teal-400 bg-white/75 p-6 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer relative transition-all group">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            await runBrandAnalysis(file);
                          }
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        disabled={isParsingBrand}
                      />
                      <UploadCloud className="w-8 h-8 text-teal-600 mb-3 group-hover:scale-110 transition-transform" />
                      <span className="text-xs font-bold text-slate-700">
                        Arraste seu logotipo/documento ou clique para carregar
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase mt-1">
                        Formato: PNG, JPG, WEBP ou PDF clínico
                      </span>
                    </div>

                    {isParsingBrand && (
                      <div className="bg-white/80 border border-teal-100 p-5 rounded-2xl flex items-center justify-center gap-4 shadow-sm">
                        <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
                        <div className="text-left">
                          <span className="text-xs font-black text-slate-800 uppercase tracking-widest block animate-pulse">
                            Escaneando Documento com ELIZA IA...
                          </span>
                          <span className="text-[10px] text-slate-500 font-bold uppercase block">
                            Estamos lendo as cores, logotipo e termos
                            institucionais.
                          </span>
                        </div>
                      </div>
                    )}

                    {detectedBrandResult && (
                      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/80 space-y-5 shadow-inner">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                          <span className="text-xs font-black text-teal-800 uppercase tracking-widest flex items-center gap-1">
                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                            Análise de Identidade Visual Concluída
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmedAIFields({});
                              setDetectedBrandResult(null);
                            }}
                            className="text-[10px] text-rose-500 font-black uppercase tracking-widest hover:underline"
                          >
                            Limpar Análise
                          </button>
                        </div>

                        <p className="text-[10px] text-slate-500 font-bold leading-normal uppercase">
                          Selecione quais os dados detectados você deseja
                          importar para a sua ficha corporativa. Dica: Os dados
                          existentes não serão perdidos a menos que você marque
                          e confirme a alteração.
                        </p>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs font-medium text-slate-700 min-w-[500px]">
                            <thead>
                              <tr className="border-b border-slate-150 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                                <th className="pb-2.5">Ficha Cadastro</th>
                                <th className="pb-2.5">Informação Detectada</th>
                                <th className="pb-2.5 text-right">
                                  Confirmar Importação?
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                { key: "name", label: "Nome da Clínica" },
                                { key: "companyName", label: "Razão Social" },
                                { key: "cnpj", label: "CNPJ / CPF" },
                                { key: "ownerName", label: "Proprietário" },
                                {
                                  key: "technicalDirector",
                                  label: "Diretor Técnico",
                                },
                                {
                                  key: "technicalDirectorCouncilNumber",
                                  label: "Registro CRO/CRM",
                                },
                                { key: "phone", label: "Telefone" },
                                { key: "whatsapp", label: "WhatsApp" },
                                { key: "email", label: "E-mail" },
                                { key: "website", label: "Site Oficial" },
                                { key: "instagram", label: "Instagram" },
                                { key: "cep", label: "CEP" },
                                { key: "street", label: "Rua / Endereço" },
                                { key: "city", label: "Cidade" },
                                { key: "state", label: "UF" },
                                {
                                  key: "primaryColor",
                                  label: "Cor Primária (Hex)",
                                },
                                {
                                  key: "secondaryColor",
                                  label: "Cor Secundária (Hex)",
                                },
                                { key: "fontPreference", label: "Tipografia" },
                                {
                                  key: "documentName",
                                  label: "Nome Documentos",
                                },
                                {
                                  key: "institutionalFooter",
                                  label: "Rodapé Institucional",
                                },
                                {
                                  key: "textSignature",
                                  label: "Assinatura Padrão",
                                },
                              ].map((row) => {
                                const detectedValue =
                                  detectedBrandResult[row.key];
                                const originalValue = clinicData[row.key] || "";
                                if (!detectedValue) return null;

                                const isConfirmed =
                                  confirmedAIFields[row.key] !== false;

                                return (
                                  <tr
                                    key={row.key}
                                    className="border-b border-slate-100/75 hover:bg-slate-50/50"
                                  >
                                    <td className="py-3 font-bold text-slate-900 text-[11px] uppercase tracking-wider">
                                      {row.label}
                                    </td>
                                    <td className="py-3">
                                      <div className="flex flex-col">
                                        <span className="text-xs font-black text-teal-700">
                                          {String(detectedValue)}
                                        </span>
                                        {originalValue && (
                                          <span className="text-[10px] text-slate-400 font-semibold">
                                            Atual: {String(originalValue)}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-3 text-right">
                                      <input
                                        type="checkbox"
                                        checked={isConfirmed}
                                        onChange={(e) => {
                                          setConfirmedAIFields({
                                            ...confirmedAIFields,
                                            [row.key]: e.target.checked,
                                          });
                                        }}
                                        className="w-4 h-4 text-teal-650 rounded cursor-pointer"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div className="pt-3 flex gap-3 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const updatedData = { ...clinicData };
                              Object.entries(detectedBrandResult).forEach(
                                ([k, v]) => {
                                  if (confirmedAIFields[k] !== false && v) {
                                    updatedData[k] = v;
                                  }
                                },
                              );
                              if (
                                detectedBrandResult.street ||
                                detectedBrandResult.city
                              ) {
                                updatedData.address = `${updatedData.street || ""}, ${updatedData.number || ""}${updatedData.complement ? " - " + updatedData.complement : ""} - ${updatedData.neighborhood || ""}, ${updatedData.city || ""} - ${updatedData.state || ""}`;
                              }
                              setClinicData(updatedData);
                              setDetectedBrandResult(null);
                              setConfirmedAIFields({});
                              console.log("[BRAND_DATA_APPLIED]", updatedData);
                              alert(
                                "Identidade de marca e cadastro preenchidos! Por favor, revise os dados abaixo e clique em 'Salvar Todas as Alterações' no rodapé para consolidar.",
                              );
                            }}
                            className="bg-teal-650 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm"
                          >
                            Aplicar Informações Confirmadas
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Bloco 2: Dados Gerais */}
                  <section className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-sm font-black text-slate-900 border-b border-slate-105 pb-4 uppercase tracking-wider">
                      Dados Gerais da Clínica
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Nome Fantasia / Comercial
                        </label>
                        <input
                          value={clinicData.name || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              name: e.target.value,
                              fantasyName: e.target.value,
                            })
                          }
                          placeholder="Ex: ELIZA Odontologia e Estética"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Razão Social
                        </label>
                        <input
                          value={clinicData.companyName || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              companyName: e.target.value,
                            })
                          }
                          placeholder="Ex: Teixeira & Associados Ltda"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          CNPJ ou CPF do Proprietário
                        </label>
                        <input
                          value={clinicData.cnpj || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              cnpj: e.target.value,
                            })
                          }
                          placeholder="Ex: 45.678.901/0001-23"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Nome do Proprietário
                        </label>
                        <input
                          value={clinicData.ownerName || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              ownerName: e.target.value,
                            })
                          }
                          placeholder="Ex: Dr. Juninho Teixeira"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Responsável Técnico (RT)
                        </label>
                        <input
                          value={clinicData.technicalDirector || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              technicalDirector: e.target.value,
                            })
                          }
                          placeholder="Ex: Dr. Juliano Técnico"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Registro CRO/CRM do R.T.
                        </label>
                        <input
                          value={
                            clinicData.technicalDirectorCouncilNumber || ""
                          }
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              technicalDirectorCouncilNumber: e.target.value,
                            })
                          }
                          placeholder="Ex: CRO-SP 123456"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          CRO Geral da Clínica
                        </label>
                        <input
                          value={clinicData.croProfessional || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              croProfessional: e.target.value,
                            })
                          }
                          placeholder="Ex: CRO-CL 98765"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold"
                        />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100 mt-6 space-y-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id="allowStaffEditFinancial"
                          checked={
                            !!(clinicData as any).allowStaffEditFinancial
                          }
                          onChange={async (e) => {
                            const newVal = e.target.checked;
                            setClinicData({
                              ...clinicData,
                              allowStaffEditFinancial: newVal,
                            } as any);
                            if (clinic) {
                              try {
                                await setDoc(
                                  doc(db, "clinics", clinic.id),
                                  {
                                    allowStaffEditFinancial: newVal,
                                    updatedAt: serverTimestamp(),
                                  },
                                  { merge: true },
                                );
                              } catch (err) {
                                console.error(
                                  "[Settings] Error saving allowStaffEditFinancial:",
                                  err,
                                );
                              }
                            }
                          }}
                          className="w-4 h-4 text-teal-650 rounded border-slate-350 focus:ring-teal-555 cursor-pointer mt-0.5"
                        />
                        <div>
                          <label
                            htmlFor="allowStaffEditFinancial"
                            className="text-xs font-bold text-slate-800 cursor-pointer select-none"
                          >
                            Permitir que a equipe edite e apague lançamentos
                            financeiros
                          </label>
                          <p className="text-[10px] text-slate-400 font-bold tracking-tight mt-0.5 leading-relaxed">
                            Se desativado, apenas o administrador principal, o
                            dono da clínica e membros individualmente
                            autorizados poderão alterar ou excluir lançamentos
                            financeiros consolidados.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 pt-4 border-t border-slate-100">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            id="saturdayUtilitarian"
                            checked={!!(clinicData as any).saturdayUtilitarian}
                            onChange={async (e) => {
                              const newVal = e.target.checked;
                              setClinicData({
                                ...clinicData,
                                saturdayUtilitarian: newVal,
                              } as any);
                              if (clinic) {
                                try {
                                  await setDoc(
                                    doc(db, "clinics", clinic.id),
                                    {
                                      saturdayUtilitarian: newVal,
                                      updatedAt: serverTimestamp(),
                                    },
                                    { merge: true },
                                  );
                                } catch (err) {
                                  console.error(
                                    "[Settings] Error saving saturdayUtilitarian:",
                                    err,
                                  );
                                }
                              }
                            }}
                            className="w-4 h-4 text-teal-650 rounded border-slate-350 focus:ring-teal-555 cursor-pointer mt-0.5"
                          />
                          <div>
                            <label
                              htmlFor="saturdayUtilitarian"
                              className="text-xs font-bold text-slate-800 cursor-pointer select-none"
                            >
                              Exibir Sábado na Agenda
                            </label>
                            <p className="text-[10px] text-slate-400 font-bold tracking-tight mt-0.5 leading-relaxed">
                              Ative para exibir sempre o sábado na agenda semanal da clínica. Se desativado, a agenda principal focará em dias úteis, ocultando o sábado quando não houver consultas dadas ou cursos no dia.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3 pt-4 border-t border-slate-100">
                          <input
                            type="checkbox"
                            id="sundayUtilitarian"
                            checked={!!(clinicData as any).sundayUtilitarian}
                            onChange={async (e) => {
                              const newVal = e.target.checked;
                              setClinicData({
                                ...clinicData,
                                sundayUtilitarian: newVal,
                              } as any);
                              if (clinic) {
                                try {
                                  await setDoc(
                                    doc(db, "clinics", clinic.id),
                                    {
                                      sundayUtilitarian: newVal,
                                      updatedAt: serverTimestamp(),
                                    },
                                    { merge: true },
                                  );
                                } catch (err) {
                                  console.error(
                                    "[Settings] Error saving sundayUtilitarian:",
                                    err,
                                  );
                                }
                              }
                            }}
                            className="w-4 h-4 text-teal-650 rounded border-slate-350 focus:ring-teal-555 cursor-pointer mt-0.5"
                          />
                          <div>
                            <label
                              htmlFor="sundayUtilitarian"
                              className="text-xs font-bold text-slate-800 cursor-pointer select-none"
                            >
                              Exibir Domingo na Agenda
                            </label>
                            <p className="text-[10px] text-slate-400 font-bold tracking-tight mt-0.5 leading-relaxed">
                              Ative para exibir sempre o domingo na agenda semanal da clínica. Se desativado, a agenda principal focará em dias úteis, ocultando o domingo quando não houver consultas dadas ou cursos no dia.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Bloco 3: Endereço Detalhado */}
                  <section className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-sm font-black text-slate-900 border-b border-slate-100 pb-4 uppercase tracking-wider">
                      Endereço Completo
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          CEP
                        </label>
                        <input
                          value={clinicData.cep || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              cep: e.target.value,
                            })
                          }
                          placeholder="Ex: 01310-100"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                        />
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Rua / Avenida
                        </label>
                        <input
                          value={clinicData.street || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              street: e.target.value,
                            })
                          }
                          placeholder="Ex: Avenida Paulista"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Número
                        </label>
                        <input
                          value={clinicData.number || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              number: e.target.value,
                            })
                          }
                          placeholder="Ex: 1000"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Complemento
                        </label>
                        <input
                          value={clinicData.complement || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              complement: e.target.value,
                            })
                          }
                          placeholder="Ex: Conjunto 152"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Bairro
                        </label>
                        <input
                          value={clinicData.neighborhood || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              neighborhood: e.target.value,
                            })
                          }
                          placeholder="Ex: Bela Vista"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Cidade / Estado
                        </label>
                        <div className="flex gap-2">
                          <input
                            value={clinicData.city || ""}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                city: e.target.value,
                              })
                            }
                            placeholder="Cidade"
                            className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                          />
                          <input
                            value={clinicData.state || ""}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                state: e.target.value.toUpperCase(),
                              })
                            }
                            placeholder="UF"
                            className="w-12 px-2 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-center outline-none focus:border-teal-600 font-mono font-bold uppercase animate-none"
                            maxLength={2}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5 animate-none">
                        Endereço Unificado (Como aparece no sistema)
                      </label>
                      <div className="relative">
                        <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={clinicData.address || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              address: e.target.value,
                            })
                          }
                          className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const composed = `${clinicData.street || ""}, ${clinicData.number || ""}${clinicData.complement ? " - " + clinicData.complement : ""} - ${clinicData.neighborhood || ""}, ${clinicData.city || ""} - ${clinicData.state || ""}`;
                          setClinicData({ ...clinicData, address: composed });
                        }}
                        className="text-[10px] text-teal-605 font-bold uppercase tracking-wider hover:underline flex items-center gap-1 mt-1.5"
                      >
                        <Undo className="w-3.5 h-3.5" /> Atualizar endereço com
                        os campos acima
                      </button>
                    </div>
                  </section>

                  {/* Bloco 4: Canais de Contato */}
                  <section className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-sm font-black text-slate-900 border-b border-slate-100 pb-4 uppercase tracking-wider">
                      Canais de Contato
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Telefone Principal
                        </label>
                        <input
                          value={clinicData.phone || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              phone: e.target.value,
                            })
                          }
                          placeholder="Ex: (11) 3456-7890"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          WhatsApp Clínico
                        </label>
                        <input
                          value={clinicData.whatsapp || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              whatsapp: e.target.value,
                            })
                          }
                          placeholder="Ex: (11) 98765-4321"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-semibold text-emerald-700 animate-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          E-mail de Contato
                        </label>
                        <input
                          value={clinicData.email || ""}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              email: e.target.value,
                            })
                          }
                          placeholder="Ex: contato@suaclinica.com"
                          className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Website
                        </label>
                        <div className="relative">
                          <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            value={clinicData.website || ""}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                website: e.target.value,
                              })
                            }
                            placeholder="Ex: www.suaclinica.com"
                            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Instagram
                        </label>
                        <div className="relative">
                          <Instagram className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            value={clinicData.instagram || ""}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                instagram: e.target.value,
                              })
                            }
                            placeholder="Ex: @clinicateixeira"
                            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium text-pink-700 font-sans"
                          />
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Bloco 5: Personalização para Documentos Impressos */}
                  <section className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                    <h3 className="text-sm font-black text-slate-900 border-b border-slate-100 pb-4 uppercase tracking-wider">
                      Identidade Visual e Layout Impressos
                    </h3>

                    <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block pl-0.5">
                        Logotipo Clínico (Logomarca)
                      </label>
                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {clinicData.logoBase64 ? (
                          <div className="relative w-28 h-28 border border-slate-200 rounded-2xl overflow-hidden bg-slate-50 flex items-center justify-center p-2">
                            <img
                              src={clinicData.logoBase64}
                              alt="Logo"
                              className="max-w-full max-h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setClinicData({ ...clinicData, logoBase64: "" })
                              }
                              className="absolute top-1.5 right-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full p-1 shadow transition-all active:scale-95"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="w-28 h-28 border border-dashed border-slate-250 rounded-2xl bg-slate-55 flex flex-col items-center justify-center text-slate-400 text-xs text-center p-3">
                            <UploadCloud className="w-6 h-6 text-slate-350 mb-1" />
                            <span className="text-[9px] font-bold uppercase tracking-wider font-sans">
                              Sem Logo
                            </span>
                          </div>
                        )}
                        <div className="flex-1 space-y-2 w-full">
                          <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/50 text-center relative hover:bg-slate-50/10 transition-all cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const base64 = await fileToBase64(file);
                                  setClinicData({
                                    ...clinicData,
                                    logoBase64: base64,
                                  });
                                }
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <span className="text-[10px] font-black text-teal-700 uppercase tracking-wider block">
                              Adicionar Imagem do Logotipo
                            </span>
                            <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">
                              Tamanho ideal: 400x400px com fundo transparente
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Cor Primária (Hex)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={clinicData.primaryColor || "#0f172a"}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                primaryColor: e.target.value,
                              })
                            }
                            className="w-10 h-10 border border-slate-200 rounded-xl cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={clinicData.primaryColor || "#0f172a"}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                primaryColor: e.target.value,
                              })
                            }
                            className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none uppercase font-bold"
                            maxLength={7}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Cor Secundária (Hex)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            value={clinicData.secondaryColor || "#0d9488"}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                secondaryColor: e.target.value,
                              })
                            }
                            className="w-10 h-10 border border-slate-200 rounded-xl cursor-pointer shrink-0"
                          />
                          <input
                            type="text"
                            value={clinicData.secondaryColor || "#0d9488"}
                            onChange={(e) =>
                              setClinicData({
                                ...clinicData,
                                secondaryColor: e.target.value,
                              })
                            }
                            className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none uppercase font-bold"
                            maxLength={7}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                          Tipografia Preferencial
                        </label>
                        <select
                          value={clinicData.fontPreference || "Inter"}
                          onChange={(e) =>
                            setClinicData({
                              ...clinicData,
                              fontPreference: e.target.value,
                            })
                          }
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
                        >
                          <option value="Inter">Inter (Sans, Moderna)</option>
                          <option value="Space Grotesk">
                            Space Grotesk (Tech, Marcante)
                          </option>
                          <option value="Playfair Display">
                            Playfair Display (Serif, Luxuosa)
                          </option>
                          <option value="Fira Code">
                            Fira Code (Developer, Brutalista)
                          </option>
                          <option value="system-ui">
                            Padrão Sistema (Suave, Flexível)
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                        Nome de Exibição nos Documentos
                      </label>
                      <input
                        value={clinicData.documentName || ""}
                        onChange={(e) =>
                          setClinicData({
                            ...clinicData,
                            documentName: e.target.value,
                          })
                        }
                        placeholder="Ex: Dr. Juninho Teixeira | Reabilitação Oral & Estética HOF"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                        Rodapé Institucional nos Impressos
                      </label>
                      <input
                        value={clinicData.institutionalFooter || ""}
                        onChange={(e) =>
                          setClinicData({
                            ...clinicData,
                            institutionalFooter: e.target.value,
                          })
                        }
                        placeholder="Ex: Responsável Técnico: Dr Juninho Teixeira CRO-SP 1234 - Clinica Teixeira Ltda"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                        Assinatura Textual Padrão (Fim dos Relatórios)
                      </label>
                      <input
                        value={clinicData.textSignature || ""}
                        onChange={(e) =>
                          setClinicData({
                            ...clinicData,
                            textSignature: e.target.value,
                          })
                        }
                        placeholder="Ex: Cordialmente, Equipe Teixeira Odontologia"
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-0.5">
                        Observação Padrão de Receitas e Documentos
                      </label>
                      <textarea
                        value={clinicData.defaultObservationText || ""}
                        onChange={(e) =>
                          setClinicData({
                            ...clinicData,
                            defaultObservationText: e.target.value,
                          })
                        }
                        rows={3}
                        placeholder="Ex: Em caso de dor extrema ou desconforto após o procedimento, procure o serviço de emergência imediatamente."
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none"
                      />
                    </div>
                  </section>

                  {/* Bloco 6: Horário de Funcionamento */}
                  <section className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm shadow-slate-100/50">
                    <div className="flex items-center justify-between mb-6 border-b border-slate-50 pb-4">
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                        Horário de Funcionamento
                      </h3>
                      <Clock className="w-4 h-4 text-teal-650" />
                    </div>
                    <div className="space-y-3">
                      {["Segunda a Sexta", "Sábado"].map((day) => (
                        <div
                          key={day}
                          className="flex items-center justify-between py-3 border-b border-slate-50"
                        >
                          <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">
                            {day}
                          </span>
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] outline-none"
                              defaultValue="08:00"
                            />
                            <span className="text-slate-300">-</span>
                            <input
                              type="time"
                              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] outline-none"
                              defaultValue="18:00"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveClinicData}
                      className="bg-slate-900 text-white px-8 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl"
                    >
                      Salvar Todas as Alterações
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "team" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                      Gestão de Equipe
                    </h3>
                    <button
                      onClick={() => setIsAddStaffModalOpen(true)}
                      className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-teal-600/20"
                    >
                      <Plus className="w-4 h-4" /> Adicionar Profissional
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {staff.map((member) => (
                      <div
                        key={member.id}
                        onClick={() => {
                          console.log(
                            "[TEAM_MEMBER_LOAD] Loading member for editing:",
                            member.id,
                            member,
                          );
                          setEditingMember({
                            ...member,
                            role:
                              member.role ??
                              member.cargo ??
                              member.função ??
                              "colaborador",
                            cargo:
                              member.role ??
                              member.cargo ??
                              member.função ??
                              "colaborador",
                            função:
                              member.role ??
                              member.cargo ??
                              member.função ??
                              "colaborador",
                            isClinicalProvider:
                              member.isClinicalProvider ??
                              member.agendaEnabled ??
                              member.isProfessional ??
                              false,

                            salaryFixed:
                              member.salaryFixed ??
                              member.salary ??
                              member.financial?.salaryFixed ??
                              member.financial?.salary ??
                              0,
                            salaryPayDay:
                              member.salaryPayDay ??
                              member.salaryPaymentDay ??
                              member.financial?.salaryPayDay ??
                              member.financial?.salaryPaymentDay ??
                              5,

                            commissionEnabled:
                              member.commissionEnabled ??
                              member.receivesCommission ??
                              member.isCommissionable ??
                              member.financial?.commissionEnabled ??
                              false,
                            commissionPercent:
                              member.commissionPercent ??
                              member.percentage ??
                              member.financial?.commissionPercent ??
                              member.financial?.commissionPercent ??
                              member.financial?.commissionPercentage ??
                              30,
                            commissionPayDay:
                              member.commissionPayDay ??
                              member.commissionPaymentDay ??
                              member.financial?.commissionPayDay ??
                              member.financial?.commissionPaymentDay ??
                              10,

                            professionalType:
                              member.professionalType ??
                              member.tipoProfissional ??
                              member.financial?.professionalType ??
                              member.financial?.tipoProfissional ??
                              "",

                            accessFinancial:
                              member.accessFinancial !== undefined
                                ? !!member.accessFinancial
                                : member.canManageFinancial !== undefined
                                  ? !!member.canManageFinancial
                                  : member.canCloseCash !== undefined
                                    ? !!member.canCloseCash
                                    : true,
                            allowFinancialModify: !!(
                              member.allowFinancialModify ??
                              member.canEditFinancial ??
                              member.canDeleteFinancial ??
                              false
                            ),

                            accessInventory: member.accessInventory !== false,
                            accessCRM: member.accessCRM !== false,
                            accessSettings: member.accessSettings !== false,
                            accessReports: member.accessReports !== false,
                            accessCourses: member.accessCourses !== false,
                            courseRole: member.courseRole || "professor",
                            customPermissionsLocked:
                              member.customPermissionsLocked ?? true,
                          });
                        }}
                        className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4 group hover:border-teal-350 hover:bg-slate-50/30 transition-all cursor-pointer relative"
                      >
                        <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center font-black text-slate-400 group-hover:bg-teal-600 group-hover:text-white transition-all uppercase">
                          {(member.name || member.email || "U").charAt(0)}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <h4 className="text-sm font-bold text-slate-900 tracking-tight truncate flex items-center gap-1.5">
                            {member.name || "Usuário"}
                            <Edit3 className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </h4>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">
                            {member.role || "Membro"}
                          </p>
                          <div
                            className="flex items-center gap-1.5 mt-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={
                                member.isClinicalProvider ??
                                [
                                  "dentist",
                                  "dentist_gp",
                                  "especialista",
                                  "professional",
                                  "clinical_professional",
                                  "doctor",
                                  "dentista",
                                  "odontologista",
                                  "médico",
                                ].includes(member.role?.toLowerCase() || "")
                              }
                              onChange={async (e) => {
                                const newVal = e.target.checked;
                                try {
                                  // 1. Update in team_members
                                  await updateDoc(
                                    doc(
                                      db,
                                      "clinics",
                                      clinic.id,
                                      "team_members",
                                      member.id,
                                    ),
                                    {
                                      isClinicalProvider: newVal,
                                      "attendance.isProfessional": newVal,
                                      isProfessional: newVal,
                                      updated_at: serverTimestamp(),
                                    },
                                  );
                                  // 2. Sync to members (optional but good for auth)
                                  try {
                                    await updateDoc(
                                      doc(
                                        db,
                                        "clinics",
                                        clinic.id,
                                        "members",
                                        member.id,
                                      ),
                                      { isClinicalProvider: newVal },
                                    );
                                  } catch (errMembers) {
                                    console.warn(
                                      "[Settings] Sync to /members skipped or failed:",
                                      errMembers,
                                    );
                                  }
                                } catch (err: any) {
                                  console.error(
                                    "[Settings] Error updating provider mode:",
                                    err.message,
                                  );
                                  alert("Erro ao alterar: " + err.message);
                                }
                              }}
                              id={`clinical-provider-${member.id}`}
                              className="w-3.5 h-3.5 text-teal-600 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
                            />
                            <label
                              htmlFor={`clinical-provider-${member.id}`}
                              className="text-[9px] font-bold text-slate-500 uppercase tracking-wide cursor-pointer select-none"
                            >
                              Atende na Agenda
                            </label>
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveStaff(member.id);
                            }}
                            className="p-2 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-xl transition-all"
                            title="Remover Membro"
                          >
                            <Plus className="w-4 h-4 rotate-45" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {invites.map((invite) => (
                      <div
                        key={invite.id}
                        className="bg-white p-6 rounded-3xl border border-slate-200 border-dashed shadow-sm flex items-center gap-4 group hover:border-amber-200 transition-all relative"
                      >
                        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center font-black text-amber-400 transition-all uppercase">
                          {(invite.name || invite.email).charAt(0)}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <h4 className="text-sm font-bold text-slate-600 tracking-tight truncate">
                            {invite.name || invite.email}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">
                              {invite.role}
                            </p>
                            <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">
                              CONVITE
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              const url = `${window.location.origin}/accept-invite?token=${invite.token}&cid=${clinic?.id}`;
                              navigator.clipboard.writeText(url);
                              alert(
                                "Link de convite copiado para a área de transferência!",
                              );
                            }}
                            className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-teal-600 transition-all"
                            title="Copiar Link"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleCancelInvite(invite.id)}
                            className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
                            title="Cancelar Convite"
                          >
                            <Plus className="w-4 h-4 rotate-45" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {staff.length === 0 && invites.length === 0 && (
                      <div className="col-span-1 md:col-span-2 py-12 text-center border-2 border-dashed border-slate-100 rounded-[2rem]">
                        <Users className="w-8 h-8 text-slate-200 mx-auto mb-3" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          Nenhum membro na equipe ainda
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "plans" && (
                <div className="space-y-6">
                  <h3 className="text-sm font-bold text-slate-900 border-b border-slate-50 pb-4">
                    Convênios e Planos Aceitos
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-3xl border-2 border-teal-600 shadow-xl flex flex-col items-center justify-center text-center gap-4 relative">
                      <div className="absolute top-4 right-4 bg-teal-600 text-white p-1 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                      </div>
                      <ShieldCheck className="w-8 h-8 text-teal-600" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                        Particular
                      </span>
                    </div>
                    {plans.map((plan) => (
                      <div
                        key={plan.id}
                        className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center gap-4 hover:border-teal-200 transition-colors cursor-pointer group relative"
                      >
                        <Shield className="w-8 h-8 text-slate-200 group-hover:text-teal-400 transition-all" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600">
                          {plan.name}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem("dentalPlans", plan.id);
                          }}
                          className="absolute top-4 right-4 p-2 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-xl transition-all"
                        >
                          <Plus className="w-4 h-4 rotate-45" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setIsAddPlanModalOpen(true)}
                      className="aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center text-slate-300 hover:bg-white hover:text-teal-600 hover:border-teal-200 transition-all"
                    >
                      <Plus className="w-6 h-6 mb-2" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">
                        Novo Convênio
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "categories" && (
                <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                      Categorias Financeiras
                    </h3>
                    <button
                      onClick={() => setIsAddCategoryModalOpen(true)}
                      className="text-teal-600 font-bold text-[10px] uppercase tracking-widest hover:underline"
                    >
                      + Criar Categoria
                    </button>
                  </div>
                  <div className="space-y-3">
                    {["Custos Clínicos", "Administrativo", "Pessoal"].map(
                      (group) => (
                        <div
                          key={group}
                          className="p-5 bg-slate-50/50 rounded-2xl border border-slate-100"
                        >
                          <h4 className="text-[10px] font-black text-teal-600 uppercase tracking-[0.2em] mb-4">
                            {group}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {categories
                              .filter((c) => c.group === group)
                              .map((i) => (
                                <div key={i.id} className="group relative">
                                  <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-600 shadow-sm flex items-center gap-2 pr-10">
                                    {i.name}
                                  </span>
                                  <button
                                    onClick={() =>
                                      handleDeleteItem(
                                        "financialCategories",
                                        i.id,
                                      )
                                    }
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-lg transition-all"
                                  >
                                    <Plus className="w-3 h-3 rotate-45" />
                                  </button>
                                </div>
                              ))}
                            <button
                              onClick={() => {
                                setNewCategory({ ...newCategory, group });
                                setIsAddCategoryModalOpen(true);
                              }}
                              className="px-3 py-1.5 border border-dashed border-slate-300 rounded-xl text-[10px] font-bold text-slate-400 hover:text-teal-600 transition-all"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

              {["anamnesis", "contract", "prescription"].includes(
                activeTab,
              ) && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-4">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                          {activeTab === "anamnesis"
                            ? "Templates de Anamnese"
                            : activeTab === "prescription"
                              ? "Templates de Receituários"
                              : "Templates de Documentos"}
                        </h3>
                        <p className="text-[10px] text-slate-500 font-medium">
                          Gerencie seus modelos para agilizar o atendimento.
                        </p>
                      </div>
                      <select
                        value={selectedTemplateId || ""}
                        onChange={(e) => {
                          const tid = e.target.value;
                          setSelectedTemplateId(tid);
                          const t = templates.find((item) => item.id === tid);
                          setTemplateContent(t?.content || "");
                        }}
                        className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-bold uppercase outline-none"
                      >
                        <option value="">Selecione um template</option>
                        {templates
                          .filter((t) => t.type === activeTab)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddTemplate(activeTab)}
                        className="bg-white border border-slate-200 text-slate-600 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
                      >
                        + Novo Template
                      </button>
                      {selectedTemplateId && (
                        <>
                          <button
                            onClick={() =>
                              handleDeleteItem("templates", selectedTemplateId)
                            }
                            className="bg-rose-50 text-rose-600 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-rose-100 transition-all"
                          >
                            Excluir
                          </button>
                          <button
                            onClick={handleSaveTemplate}
                            className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-slate-900/20"
                          >
                            Salvar
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {selectedTemplateId && (
                    <div className="space-y-4">
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                            Tags Rápidas
                          </label>
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                            Clique para inserir na posição do cursor
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(["contract", "prescription"].includes(activeTab)
                            ? [
                                {
                                  label: "Nome do Paciente",
                                  tag: "{{nomePaciente}}",
                                },
                                {
                                  label: "CPF do Paciente",
                                  tag: "{{cpfPaciente}}",
                                },
                                {
                                  label: "Telefone do Paciente",
                                  tag: "{{telefonePaciente}}",
                                },
                                {
                                  label: "Data Nascimento",
                                  tag: "{{dataNascimento}}",
                                },
                                {
                                  label: "Procedimentos Aprovados",
                                  tag: "{{procedimentosAprovados}}",
                                },
                                { label: "Valor Total", tag: "{{valorTotal}}" },
                                {
                                  label: "Forma de Pagamento",
                                  tag: "{{formaPagamento}}",
                                },
                                {
                                  label: "Profissional Responsável",
                                  tag: "{{profissionalResponsavel}}",
                                },
                                {
                                  label: "CRO do Profissional",
                                  tag: "{{croProfissional}}",
                                },
                                {
                                  label: "Nome da Clínica",
                                  tag: "{{nomeClinica}}",
                                },
                                {
                                  label: "CNPJ da Clínica",
                                  tag: "{{cnpjClinica}}",
                                },
                                { label: "Data Atual", tag: "{{dataAtual}}" },
                              ]
                            : [
                                { label: "Paciente", tag: "{paciente_nome}" },
                                { label: "Data", tag: "{data_atual}" },
                                { label: "Clínica", tag: "{clinica_nome}" },
                                {
                                  label: "Endereço Clínica",
                                  tag: "{clinica_endereco}",
                                },
                                { label: "Cidade/UF", tag: "{clinica_local}" },
                                {
                                  label: "Profissional",
                                  tag: "{profissional_nome}",
                                },
                                {
                                  label: "Assinatura",
                                  tag: "{assinatura_logo}",
                                },
                              ]
                          ).map((tag) => (
                            <button
                              key={tag.tag}
                              onClick={() => insertTag(tag.tag)}
                              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[9px] font-bold text-slate-650 hover:border-teal-200 hover:text-teal-600 shadow-sm transition-all text-left"
                            >
                              {tag.label}:{" "}
                              <span className="text-teal-600 font-mono text-[8px] bg-teal-50 px-1 py-0.5 rounded ml-1">
                                {tag.tag}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden min-h-[500px] flex flex-col">
                        <textarea
                          id="template-content"
                          value={templateContent}
                          onChange={(e) => setTemplateContent(e.target.value)}
                          className="flex-1 p-10 text-sm font-medium text-slate-700 outline-none resize-none leading-relaxed font-serif"
                          placeholder="Comece a escrever seu modelo aqui..."
                        />
                      </div>
                    </div>
                  )}
                  {!selectedTemplateId && (
                    <div className="py-20 text-center border-2 border-dashed border-slate-105 rounded-[3rem] flex flex-col items-center justify-center gap-4">
                      <FileText className="w-10 h-10 text-slate-200 mx-auto" />
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Selecione um template para começar a editar
                      </p>
                      {activeTab === "contract" && (
                        <button
                          onClick={handleInitializeDefaultContracts}
                          type="button"
                          className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/20 active:scale-95 transition-all cursor-pointer"
                        >
                          Inicializar Modelos da ELIZA
                        </button>
                      )}
                      {activeTab === "prescription" && (
                        <button
                          onClick={handleInitializeDefaultPrescriptions}
                          type="button"
                          className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/20 active:scale-95 transition-all cursor-pointer"
                        >
                          Inicializar Modelos de Receituários Inteligentes
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "cashier" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest">
                      Contas e Caixas
                    </h3>
                    <button className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-teal-600/20">
                      <Plus className="w-4 h-4" /> Novo Caixa
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {cashiers.map((c) => (
                      <div
                        key={c.id}
                        className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-teal-200 transition-all relative"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-teal-50 group-hover:text-teal-600 transition-all">
                            <Briefcase className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 tracking-tight">
                              {c.name}
                            </h4>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                              Saldo Atual
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">
                            R$ {c.balance.toLocaleString()}
                          </p>
                          <div className="flex items-center gap-1 text-[9px] font-bold text-teal-600 uppercase tracking-tighter mt-1">
                            <CheckCircle2 className="w-3 h-3" /> Conta Ativa
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteItem("cashiers", c.id)}
                          className="absolute top-4 right-4 p-2 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded-xl transition-all"
                        >
                          <Plus className="w-4 h-4 rotate-45" />
                        </button>
                      </div>
                    ))}
                    {cashiers.length === 0 && (
                      <div className="col-span-2 py-20 text-center bg-white rounded-3xl border-2 border-dashed border-slate-100">
                        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                          Nenhum caixa configurado
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "treatments" && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                        Catálogo de Tratamentos
                      </h3>
                      <p className="text-[10px] text-slate-500 font-medium">
                        Cadastre e configure todos os procedimentos oferecidos
                        pela clínica.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setTargetTreatment({
                          name: "",
                          category: "Harmonização Facial",
                          subcategory: "",
                          defaultPrice: 0,
                          description: "",
                          estimatedDuration: 30,
                          requiresFaces: false,
                          requiresRegion: false,
                          active: true,
                        });
                        setIsTreatmentModalOpen(true);
                      }}
                      className="bg-teal-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg shadow-teal-600/20 max-w-fit"
                    >
                      <Plus className="w-4 h-4" /> Novo Tratamento
                    </button>
                  </div>

                  {/* Search and Category filters */}
                  <div className="flex flex-col gap-4 bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm col-span-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                      <input
                        type="text"
                        placeholder="Buscar tratamento pelo nome ou descrição..."
                        value={treatmentSearch}
                        onChange={(e) => setTreatmentSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs outline-none focus:border-teal-600 font-medium text-slate-700"
                      />
                    </div>

                    <div className="flex flex-wrap gap-1.5 border-t border-slate-50 pt-4">
                      {["Todas", ...TREATMENT_CATEGORIES].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setSelectedCatalogCategory(cat)}
                          className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
                            selectedCatalogCategory === cat
                              ? "bg-teal-600 text-white shadow-sm"
                              : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Treatments Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {treatmentCatalog
                      .filter((item) => {
                        const matchesSearch =
                          item.name
                            .toLowerCase()
                            .includes(treatmentSearch.toLowerCase()) ||
                          item.description
                            .toLowerCase()
                            .includes(treatmentSearch.toLowerCase());
                        const matchesCategory =
                          selectedCatalogCategory === "Todas" ||
                          item.category === selectedCatalogCategory;
                        return matchesSearch && matchesCategory;
                      })
                      .map((item) => (
                        <div
                          key={item.id}
                          className={`bg-white p-6 rounded-3xl border transition-all shadow-sm flex flex-col justify-between relative group ${
                            item.active
                              ? "border-slate-200 hover:border-teal-200"
                              : "border-slate-100 opacity-60"
                          }`}
                        >
                          <div>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex flex-wrap gap-1 items-center">
                                <span className="text-[8px] bg-slate-50 border border-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                  {item.category}
                                </span>
                                {item.subcategory && (
                                  <span className="text-[8px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                    {item.subcategory}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() =>
                                    handleToggleTreatmentActive(item)
                                  }
                                  className={`p-1.5 rounded-lg transition-all ${
                                    item.active
                                      ? "text-teal-600 hover:bg-teal-50"
                                      : "text-slate-400 hover:bg-slate-100"
                                  }`}
                                  title={
                                    item.active
                                      ? "Ativo. Clique para inativar."
                                      : "Inativo. Clique para ativar."
                                  }
                                >
                                  {item.active ? (
                                    <Eye className="w-4 h-4" />
                                  ) : (
                                    <EyeOff className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    setTargetTreatment(item);
                                    setIsTreatmentModalOpen(true);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-slate-50 rounded-lg transition-all"
                                  title="Editar tratamento"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            <h4 className="text-sm font-black text-slate-900 tracking-tight mt-3 leading-snug">
                              {item.name}
                            </h4>
                            <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed line-clamp-2">
                              {item.description || "Sem descrição cadastrada."}
                            </p>
                          </div>

                          <div className="flex items-center justify-between border-t border-slate-50 pt-4 mt-4">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                                Valor Padrão
                              </span>
                              <span className="text-sm font-black text-slate-900 leading-none mt-1">
                                R${" "}
                                {item.defaultPrice.toLocaleString("pt-BR", {
                                  minimumFractionDigits: 2,
                                })}
                              </span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                                Tempo Estimado
                              </span>
                              <span className="text-xs font-bold text-slate-600 mt-1">
                                {item.estimatedDuration || 30} min
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}

                    {treatmentCatalog.filter((item) => {
                      const matchesSearch =
                        item.name
                          .toLowerCase()
                          .includes(treatmentSearch.toLowerCase()) ||
                        item.description
                          .toLowerCase()
                          .includes(treatmentSearch.toLowerCase());
                      const matchesCategory =
                        selectedCatalogCategory === "Todas" ||
                        item.category === selectedCatalogCategory;
                      return matchesSearch && matchesCategory;
                    }).length === 0 && (
                      <div className="col-span-1 md:col-span-2 py-16 text-center bg-white rounded-[2rem] border border-dashed border-slate-200">
                        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-3 animate-pulse" />
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                          Nenhum tratamento localizado
                        </p>
                        <p className="text-[10px] text-slate-300 font-medium mt-1">
                          Experimente buscar outro termo ou mude o filtro de
                          categoria.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "import" && (
                <div className="h-[calc(100vh-250px)]">
                  <DataImportView />
                </div>
              )}

              {activeTab === "diagnosis" && <FirebaseDiagnosis />}

              {activeTab === "whatsapp" && <WhatsAppSettings />}

              {activeTab === "eliza_interna" && clinic && (
                <ElizaInternaSettings clinic={clinic} />
              )}

              {activeTab === "eliza_training" && clinic && (
                <ElizaTrainingSettings clinic={clinic} />
              )}

              {activeTab === "eliza_ai" && clinic && (
                <ElizaAISettings clinic={clinic} />
              )}

              {activeTab === "education_settings" && clinic && (
                <div className="space-y-8 text-left">
                  <header className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 tracking-tight uppercase">
                        ELIZA Education - Configurações
                      </h3>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 italic">
                        Controlador do Módulo Acadêmico Premium
                      </p>
                    </div>
                    <GraduationCap className="w-6 h-6 text-slate-200" />
                  </header>

                  <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-150">
                      <div className="space-y-1">
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest">
                          Ativar Painel de Cursos (ELIZA Education)
                        </h4>
                        <p className="text-xs text-slate-400 font-medium max-w-lg leading-relaxed">
                          Habilita a aba lateral "Cursos / ELIZA Education" para
                          planejar cursos, cadastrar alunos, organizar
                          consentimentos de pacientes-modelo e comissões
                          acadêmicas.
                        </p>
                      </div>

                      <input
                        type="checkbox"
                        checked={clinicData.enableEducationPanel ?? false}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setClinicData({
                            ...clinicData,
                            enableEducationPanel: val,
                          });
                        }}
                        className="w-10 h-6 bg-slate-200 rounded-full cursor-pointer appearance-none checked:bg-teal-600 relative transition-all before:content-[''] before:absolute before:w-4 before:h-4 before:bg-white before:rounded-full before:top-1 before:left-1 checked:before:translate-x-4 before:transition-all shrink-0"
                      />
                    </div>

                    <div className="p-4 rounded-xl bg-teal-50/10 border border-teal-100 text-teal-800 text-xs font-semibold leading-relaxed">
                      👉 <span className="font-bold">Nota de Integração:</span>{" "}
                      Quando ativado, os profissionais com perfil de
                      Administrador ou Proprietário passam a ter permissão
                      irrestrita. Para habilitar acesso a secretárias ou
                      professores adicionais, configure os toggles individuais
                      na ficha de cada colaborador na aba{" "}
                      <strong>Membros</strong>.
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex justify-end">
                      <button
                        onClick={handleSaveClinicData}
                        className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-md transition-all active:scale-[0.98]"
                      >
                        Salvar Configurações
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === "admin" && isOwner && (
                <div className="space-y-8">
                  <header className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 tracking-tight uppercase">
                        Administração e Segurança
                      </h3>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 italic">
                        Restrito a: Propietários da Clínica
                      </p>
                    </div>
                    <Lock className="w-6 h-6 text-slate-200" />
                  </header>

                  <section className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                    <div className="flex items-start gap-6">
                      <div className="w-14 h-14 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-7 h-7" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-black text-rose-900 uppercase tracking-widest mb-2">
                          Ações Perigosas
                        </h4>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed mb-6">
                          Estas ações apagam dados permanentemente. Use com
                          cautela absoluta. Recomenda-se exportar orçamentos e
                          relatórios antes de prosseguir.
                        </p>

                        <div className="p-8 bg-rose-50/30 rounded-[2rem] border border-rose-100 border-dashed">
                          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                            <div>
                              <h5 className="text-[11px] font-black text-rose-900 uppercase tracking-widest flex items-center gap-2">
                                <Trash2 className="w-4 h-4" /> Resetar Base de
                                Pacientes
                              </h5>
                              <p className="text-[10px] text-rose-600 font-bold mt-1 opacity-70">
                                Apaga pacientes, revisões de importação e lotes
                                de importação desta clínica.
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setResetConfirmation("");
                                setResetProgress([]);
                                setResetFinished(false);
                                setIsAdminResetModalOpen(true);
                              }}
                              className="px-6 py-3 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-rose-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                            >
                              Executar Reset
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="bg-slate-900 p-10 rounded-[2.5rem] text-white space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                        <CheckCircle className="w-6 h-6 text-teal-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest">
                          Auditoria de Segurança
                        </h4>
                        <p className="text-[10px] text-slate-400 font-medium">
                          Log de eventos administrativos críticos da unidade.
                        </p>
                      </div>
                    </div>
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 font-mono text-[9px] text-slate-300">
                      [2026-05-08 03:57] UNIT_AUDIT: System Diagnosis accessed
                      by owner
                      <br />
                      [2026-05-08 03:50] AUTH_SYNC: Multi-database references
                      cleaned
                      <br />
                      [2026-05-08 03:45] SYSTEM: FireBase Rules deployed for
                      (default)
                    </div>

                    <div className="pt-6 border-t border-slate-100 mt-6">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id="allowStaffEditFinancial"
                          checked={
                            !!(clinicData as any).allowStaffEditFinancial
                          }
                          onChange={async (e) => {
                            const newVal = e.target.checked;
                            setClinicData({
                              ...clinicData,
                              allowStaffEditFinancial: newVal,
                            } as any);
                            if (clinic) {
                              try {
                                await setDoc(
                                  doc(db, "clinics", clinic.id),
                                  {
                                    allowStaffEditFinancial: newVal,
                                    updatedAt: serverTimestamp(),
                                  },
                                  { merge: true },
                                );
                              } catch (err) {
                                console.error(
                                  "[Settings] Error saving allowStaffEditFinancial:",
                                  err,
                                );
                              }
                            }
                          }}
                          className="w-4 h-4 text-teal-600 rounded border-slate-350 focus:ring-teal-500 cursor-pointer mt-0.5"
                        />
                        <div>
                          <label
                            htmlFor="allowStaffEditFinancial"
                            className="text-xs font-bold text-slate-800 cursor-pointer select-none"
                          >
                            Permitir que a equipe edite e apague lançamentos
                            financeiros
                          </label>
                          <p className="text-[10px] text-slate-400 font-bold tracking-tight mt-0.5 leading-relaxed">
                            Se desativado, apenas o administrador principal, o
                            dono da clínica e membros individualmente
                            autorizados poderão alterar ou excluir lançamentos
                            financeiros consolidados.
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Modal: Admin Reset Base */}
      <AnimatePresence>
        {isAdminResetModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isResetting && setIsAdminResetModalOpen(false)}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-xl bg-white rounded-[3rem] shadow-2xl p-12 overflow-hidden"
            >
              <div className="space-y-8">
                <div className="flex items-center gap-4 text-rose-600">
                  <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center">
                    <RotateCcw
                      className={`w-7 h-7 ${isResetting ? "animate-spin" : ""}`}
                    />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black tracking-tight text-slate-900">
                      Resetar Base de Pacientes
                    </h3>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-600 italic">
                      Operação Irreversível
                    </p>
                  </div>
                </div>

                {!resetFinished ? (
                  <>
                    <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl space-y-4">
                      <p className="text-xs text-rose-900 font-bold leading-relaxed">
                        Esta ação removerá permanentemente os seguintes dados da
                        clínica{" "}
                        <span className="underline decoration-rose-300 underline-offset-4">
                          {clinic?.name}
                        </span>
                        :
                      </p>
                      <ul className="grid grid-cols-1 gap-2">
                        {[
                          "Toda a base de pacientes (Fichas)",
                          "Dados auxiliares para médicos e recepcionistas",
                          "Documentos de revisão de importação pendentes",
                          "Histórico de lotes de importação executados",
                        ].map((item, idx) => (
                          <li
                            key={idx}
                            className="flex items-center gap-3 text-[10px] text-rose-700 font-black uppercase tracking-tight"
                          >
                            <span className="w-1.5 h-1.5 bg-rose-400 rounded-full shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                      <div className="pt-2 border-t border-rose-200/50">
                        <p className="text-[10px] text-rose-600 font-medium italic">
                          * Membros da equipe, finanças puras (fluxo de caixa) e
                          configurações da clínica NÃO serão afetados.
                        </p>
                      </div>
                    </div>

                    {!isResetting ? (
                      <div className="space-y-6">
                        <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center block">
                            Digite{" "}
                            <span className="text-slate-900">
                              CONFIRMAR RESET
                            </span>{" "}
                            para prosseguir
                          </label>
                          <input
                            value={resetConfirmation}
                            onChange={(e) =>
                              setResetConfirmation(e.target.value.toUpperCase())
                            }
                            className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-200 rounded-[1.5rem] text-center font-black text-lg tracking-widest outline-none focus:border-rose-600 focus:bg-white transition-all text-slate-900"
                            placeholder="--- ---"
                            autoFocus
                          />
                        </div>

                        <div className="flex gap-4">
                          <button
                            onClick={() => setIsAdminResetModalOpen(false)}
                            className="flex-1 py-4 bg-slate-100 text-slate-400 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                          >
                            Abortar
                          </button>
                          <button
                            disabled={resetConfirmation !== "CONFIRMAR RESET"}
                            onClick={handleResetPatientBase}
                            className="flex-1 py-4 bg-rose-600 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest shadow-xl shadow-rose-600/20 disabled:opacity-30 disabled:scale-100 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                          >
                            <Trash2 className="w-4 h-4" /> Iniciar Limpeza
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        <div className="space-y-3">
                          {resetProgress.map((p, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100"
                            >
                              <div className="flex items-center gap-3">
                                {p.status === "processing" ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                                ) : p.status === "completed" ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                ) : p.status === "error" ? (
                                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                                ) : (
                                  <Clock className="w-4 h-4 text-slate-300" />
                                )}
                                <span
                                  className={`text-[10px] font-black uppercase tracking-widest ${p.status === "processing" ? "text-teal-600" : "text-slate-400"}`}
                                >
                                  {p.collection}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-900 font-bold">
                                {p.count} IDs
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-rose-600"
                            animate={{
                              width: `${(resetProgress.filter((p) => p.status === "completed").length / resetProgress.length) * 100}%`,
                            }}
                          />
                        </div>
                        <p className="text-center text-[10px] font-black uppercase tracking-widest text-rose-600 animate-pulse">
                          EXECUTANDO DELEÇÃO EM LOTE...
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-8 text-center pb-4">
                    <div className="w-24 h-24 bg-emerald-50 text-emerald-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-sm">
                      <CheckCircle2 className="w-12 h-12" />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-slate-900 tracking-tight">
                        Limpeza Concluída!
                      </h4>
                      <p className="text-sm text-slate-500 font-medium leading-relaxed mt-3">
                        A base de pacientes e o fluxo de importação foram
                        resetados com sucesso.
                        <br />A unidade está pronta para uma nova importação
                        limpa.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setIsAdminResetModalOpen(false);
                        window.location.reload();
                      }}
                      className="w-full py-4 bg-slate-900 text-white rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest shadow-xl"
                    >
                      Voltar ao Painel
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Staff */}
      <AnimatePresence>
        {isAddStaffModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddStaffModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Users className="w-5 h-5 text-teal-600" /> Convidar para Equipe
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Nome Completo
                  </label>
                  <input
                    value={newStaff.name || ""}
                    onChange={(e) =>
                      setNewStaff({ ...newStaff, name: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    placeholder="Nome do colega"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    E-mail de Trabalho
                  </label>
                  <input
                    value={newStaff.email || ""}
                    onChange={(e) =>
                      setNewStaff({ ...newStaff, email: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    placeholder="exemplo@dentista.com"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Senha Temporária
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      value={newStaff.password || ""}
                      onChange={(e) =>
                        setNewStaff({ ...newStaff, password: e.target.value })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                      placeholder="Mínimo 6 caracteres"
                    />
                    <Lock className="w-3 h-3 text-slate-300 absolute right-4 top-1/2 -translate-y-1/2" />
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium italic mt-1">
                    * Se preenchida, cria a conta imediatamente. Se vazia, envia
                    convite por link.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Cargo / Função
                    </label>
                    <select
                      value={newStaff.role || "Dentista"}
                      onChange={(e) =>
                        setNewStaff({
                          ...newStaff,
                          role: e.target.value as any,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none font-medium"
                    >
                      <option value="Dentista">Dentista</option>
                      <option value="Médico">Médico</option>
                      <option value="Secretária">Secretária</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Marketing">Marketing</option>
                      <option value="Comercial">Comercial</option>
                      <option value="Auxiliar">Auxiliar</option>
                      <option value="Coordenador">Coordenador</option>
                      <option value="Gestor">Gestor</option>
                      <option value="Recepção">Recepção</option>
                      <option value="Estagiário">Estagiário</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Permissões
                    </label>
                    <div className="flex items-center h-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                      <input
                        type="checkbox"
                        checked={newStaff.isAdmin}
                        onChange={(e) =>
                          setNewStaff({
                            ...newStaff,
                            isAdmin: e.target.checked,
                          })
                        }
                        className="w-4 h-4 text-teal-600 rounded border-slate-300 mr-2"
                      />
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">
                        Administrador
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center px-4 py-3 bg-teal-50/50 border border-teal-100 rounded-2xl">
                  <input
                    type="checkbox"
                    checked={newStaff.isClinicalProvider}
                    onChange={(e) =>
                      setNewStaff({
                        ...newStaff,
                        isClinicalProvider: e.target.checked,
                      })
                    }
                    className="w-4 h-4 text-teal-600 rounded border-slate-350 mr-2 focus:ring-teal-500"
                  />
                  <div>
                    <p className="text-[10px] font-black uppercase text-teal-850 tracking-wider">
                      Atendimento Clínico
                    </p>
                    <p className="text-[9px] text-teal-600 font-bold leading-normal">
                      Este profissional atende pacientes e aparece na agenda
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  disabled={isCreatingStaff}
                  onClick={() => setIsAddStaffModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  disabled={
                    isCreatingStaff || !newStaff.email || !newStaff.name
                  }
                  onClick={handleAddStaff}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isCreatingStaff ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />{" "}
                      Processando...
                    </>
                  ) : newStaff.password ? (
                    "Criar Usuário"
                  ) : (
                    "Enviar Convite"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Plan */}
      <AnimatePresence>
        {isAddPlanModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddPlanModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-teal-600" /> Novo Convênio
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Nome do Plano
                  </label>
                  <input
                    value={newPlan.name}
                    onChange={(e) =>
                      setNewPlan({ ...newPlan, name: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    placeholder="Ex: Bradesco Dental"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Tipo de Acordo
                  </label>
                  <select
                    value={newPlan.type}
                    onChange={(e) =>
                      setNewPlan({ ...newPlan, type: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
                  >
                    <option value="particular">Particular com Desconto</option>
                    <option value="convenio">Convênio Bruto</option>
                    <option value="social">Social / Filantropia</option>
                  </select>
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setIsAddPlanModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddPlan}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20"
                >
                  Cadastrar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Category */}
      <AnimatePresence>
        {isAddCategoryModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddCategoryModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10"
            >
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-teal-600" /> Nova Categoria
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Grupo Financeiro
                  </label>
                  <select
                    value={newCategory.group}
                    onChange={(e) =>
                      setNewCategory({ ...newCategory, group: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none"
                  >
                    <option value="Custos Clínicos">Custos Clínicos</option>
                    <option value="Administrativo">Administrativo</option>
                    <option value="Pessoal">Pessoal</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Nome da Categoria
                  </label>
                  <input
                    value={newCategory.name}
                    onChange={(e) =>
                      setNewCategory({ ...newCategory, name: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                    placeholder="Ex: Insumos de Cirurgia"
                  />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setIsAddCategoryModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddCategory}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20"
                >
                  Criar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add/Edit Treatment */}
      <AnimatePresence>
        {isTreatmentModalOpen && targetTreatment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsTreatmentModalOpen(false);
                setTargetTreatment(null);
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-8 lg:p-10 overflow-y-auto max-h-[90vh]"
            >
              <h3 className="text-lg lg:text-xl font-bold text-slate-900 mb-6 flex items-center gap-2 border-b border-slate-50 pb-4">
                <Stethoscope className="w-5 h-5 text-teal-600" />
                {targetTreatment.id ? "Editar Tratamento" : "Novo Tratamento"}
              </h3>

              <div className="space-y-4">
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    Nome do Tratamento / Procedimento
                  </label>
                  <input
                    value={targetTreatment.name || ""}
                    onChange={(e) =>
                      setTargetTreatment({
                        ...targetTreatment,
                        name: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium animate-none"
                    placeholder="Ex: Toxina Botulínica"
                  />
                </div>

                {/* Category and Subcategory in grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Categoria
                    </label>
                    <select
                      value={targetTreatment.category || ""}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          category: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    >
                      {TREATMENT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Subcategoria (Opcional)
                    </label>
                    <input
                      value={targetTreatment.subcategory || ""}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          subcategory: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      placeholder="Ex: Ácido Hialurônico"
                    />
                  </div>
                </div>

                {/* Price and Duration in grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Valor Padrão (R$)
                    </label>
                    <input
                      type="number"
                      value={targetTreatment.defaultPrice || 0}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          defaultPrice: Number(e.target.value),
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-teal-600"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Tempo Estimado (minutos)
                    </label>
                    <input
                      type="number"
                      value={targetTreatment.estimatedDuration || 30}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          estimatedDuration: Number(e.target.value),
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      placeholder="30"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                    Descrição detalhada
                  </label>
                  <textarea
                    value={targetTreatment.description || ""}
                    onChange={(e) =>
                      setTargetTreatment({
                        ...targetTreatment,
                        description: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium h-20 resize-none"
                    placeholder="Descrição curta do tratamento para apoio na confecção de propostas..."
                  />
                </div>

                {/* Checkboxes: Requires Region, Requires Faces, Active */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="requiresFaces"
                      checked={!!targetTreatment.requiresFaces}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          requiresFaces: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                    />
                    <label
                      htmlFor="requiresFaces"
                      className="text-[10px] font-bold text-slate-600 uppercase tracking-wider cursor-pointer select-none"
                    >
                      Requer Faces (O / M / D / V / L)
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="requiresRegion"
                      checked={!!targetTreatment.requiresRegion}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          requiresRegion: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                    />
                    <label
                      htmlFor="requiresRegion"
                      className="text-[10px] font-bold text-slate-600 uppercase tracking-wider cursor-pointer select-none"
                    >
                      Requer Dente / Região
                    </label>
                  </div>

                  <div className="flex items-center gap-3 border-t border-slate-200/60 pt-2.5">
                    <input
                      type="checkbox"
                      id="active"
                      checked={targetTreatment.active !== false}
                      onChange={(e) =>
                        setTargetTreatment({
                          ...targetTreatment,
                          active: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                    />
                    <label
                      htmlFor="active"
                      className="text-[10px] font-bold text-slate-600 uppercase tracking-wider cursor-pointer select-none"
                    >
                      Ativo no Catálogo
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => {
                    setIsTreatmentModalOpen(false);
                    setTargetTreatment(null);
                  }}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveTreatment}
                  disabled={!targetTreatment.name}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 active:scale-[0.98] disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Edit Staff Member */}
      <AnimatePresence>
        {editingMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingMember(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-8 lg:p-10 overflow-y-auto max-h-[90vh]"
            >
              <h3 className="text-lg lg:text-xl font-bold text-slate-900 mb-6 flex items-center gap-2 border-b border-slate-50 pb-4 border-slate-100">
                <Users className="w-5 h-5 text-teal-600" />
                Editar Integrante da Equipe
              </h3>

              <div className="space-y-4">
                {/* Nome Completo */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Nome Completo
                  </label>
                  <input
                    value={editingMember.name || ""}
                    onChange={(e) =>
                      setEditingMember({
                        ...editingMember,
                        name: e.target.value,
                      })
                    }
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    placeholder="Nome do profissional"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1 opacity-85">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    E-mail de Acesso (Não editável)
                  </label>
                  <input
                    value={editingMember.email || ""}
                    disabled
                    className="w-full px-4 py-2.5 bg-slate-100 border border-slate-200 text-slate-500 rounded-xl text-xs outline-none font-medium cursor-not-allowed"
                  />
                </div>

                {/* Cargo/Função e Telefone no grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Cargo principal / Função
                    </label>
                    <select
                      value={editingMember.role || ""}
                      onChange={(e) =>
                        setEditingMember({
                          ...editingMember,
                          role: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    >
                      <option value="Dentista">Dentista</option>
                      <option value="Médico">Médico</option>
                      <option value="Secretária">Secretária</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Marketing">Marketing</option>
                      <option value="Comercial">Comercial</option>
                      <option value="Auxiliar">Auxiliar</option>
                      <option value="Coordenador">Coordenador</option>
                      <option value="Gestor">Gestor</option>
                      <option value="Recepção">Recepção</option>
                      <option value="Estagiário">Estagiário</option>
                      <option value="Outro">Outro</option>
                      {/* Backwards compatibility fallback values */}
                      <option value="dentist">
                        Dentista Clínico G. (Legado)
                      </option>
                      <option value="especialista">
                        Dentista Especialista (Legado)
                      </option>
                      <option value="receptionist">
                        Secretária / Recepção (Legado)
                      </option>
                      <option value="admin">
                        Administrador Geral (Legado)
                      </option>
                      <option value="assistant">
                        Auxiliar de Consultório (ASB) (Legado)
                      </option>
                      <option value="finance">
                        Gerente Financeiro (Legado)
                      </option>
                      <option value="colaborador">
                        Colaborador / Outros (Legado)
                      </option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Celular (WhatsApp)
                    </label>
                    <input
                      value={editingMember.phone || ""}
                      onChange={(e) =>
                        setEditingMember({
                          ...editingMember,
                          phone: e.target.value,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                      placeholder="Ex: (11) 99999-9999"
                    />
                  </div>
                </div>

                {/* Agenda */}
                <div className="p-4 bg-teal-50/45 rounded-2xl border border-teal-100/70 space-y-1 mt-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="editIsClinicalProvider"
                      checked={!!editingMember.isClinicalProvider}
                      onChange={(e) =>
                        setEditingMember({
                          ...editingMember,
                          isClinicalProvider: e.target.checked,
                        })
                      }
                      className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                    />
                    <label
                      htmlFor="editIsClinicalProvider"
                      className="text-[10px] font-bold text-slate-700 uppercase tracking-wider cursor-pointer select-none"
                    >
                      Atende na Agenda
                    </label>
                  </div>
                  <p className="text-[9px] text-slate-400 font-medium leading-relaxed pl-7">
                    Habilitando, este profissional aparecerá como filtro na
                    agenda da clínica e poderá receber agendamentos de pacientes
                    diretamente.
                  </p>
                </div>

                {/* Financeiro e Folha ELIZA */}
                <div className="p-5 bg-teal-50/10 rounded-2xl border border-teal-150/50 space-y-4 mt-3">
                  <h4 className="text-[10px] font-black text-teal-700 uppercase tracking-[0.15em] border-b border-teal-150 pb-2 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-teal-650" />{" "}
                    Configuração Financeira & Folha
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">
                        Salário Fixo (R$)
                      </label>
                      <input
                        type="number"
                        value={editingMember.salaryFixed ?? ""}
                        onChange={(e) =>
                          setEditingMember({
                            ...editingMember,
                            salaryFixed: Number(e.target.value),
                          })
                        }
                        placeholder="Ex: 3500"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase">
                        Dia de Pgto (Salário)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={editingMember.salaryPayDay ?? ""}
                        onChange={(e) =>
                          setEditingMember({
                            ...editingMember,
                            salaryPayDay: Number(e.target.value),
                          })
                        }
                        placeholder="Dia, ex: 5"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 items-center py-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="commissionEnabled"
                        checked={!!editingMember.commissionEnabled}
                        onChange={(e) =>
                          setEditingMember({
                            ...editingMember,
                            commissionEnabled: e.target.checked,
                          })
                        }
                        className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                      />
                      <label
                        htmlFor="commissionEnabled"
                        className="text-[10px] font-bold text-slate-700 uppercase cursor-pointer select-none"
                      >
                        Recebe comissão?
                      </label>
                    </div>
                  </div>

                   {editingMember.commissionEnabled && (
                    <div className="space-y-4 pt-1">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase">
                            Comissão Padrão (%)
                          </label>
                          <input
                            type="number"
                            value={editingMember.commissionPercent ?? ""}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                commissionPercent: Number(e.target.value),
                                commissionEligible: true,
                              })
                            }
                            placeholder="Ex: 30"
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase">
                            Dia Pgto (Comissão)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={editingMember.commissionPayDay ?? ""}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                commissionPayDay: Number(e.target.value),
                              })
                            }
                            placeholder="Dia, ex: 10"
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-bold text-slate-800"
                          />
                        </div>
                      </div>

                      <div className="p-4 bg-slate-55 rounded-2xl border border-slate-150 space-y-3">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-200 pb-1.5 mb-1">Configurações Avançadas de Comissão</p>
                        
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="atendimentoClinicoAtivo"
                            checked={editingMember.atendimentoClinicoAtivo !== false}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                atendimentoClinicoAtivo: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                          />
                          <label htmlFor="atendimentoClinicoAtivo" className="text-[9px] font-bold text-slate-700 uppercase cursor-pointer select-none">
                            Atendimento Clínico Ativo
                          </label>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="agendaLiberada"
                            checked={editingMember.agendaLiberada !== false}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                agendaLiberada: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                          />
                          <label htmlFor="agendaLiberada" className="text-[9px] font-bold text-slate-700 uppercase cursor-pointer select-none">
                            Agenda Liberada p/ Marcações
                          </label>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="commissionEligible"
                            checked={editingMember.commissionEligible !== false}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                commissionEligible: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                          />
                          <label htmlFor="commissionEligible" className="text-[9px] font-bold text-slate-700 uppercase cursor-pointer select-none">
                            Elegível para Comissão
                          </label>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="commissionRequiresAdminApproval"
                            checked={editingMember.commissionRequiresAdminApproval !== false}
                            onChange={(e) =>
                              setEditingMember({
                                ...editingMember,
                                commissionRequiresAdminApproval: e.target.checked,
                              })
                            }
                            className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer"
                          />
                          <label htmlFor="commissionRequiresAdminApproval" className="text-[9px] font-bold text-slate-700 uppercase cursor-pointer select-none">
                            Requer Aprovação do Admin
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase">
                      Tipo de Profissional
                    </label>
                    <select
                      value={editingMember.professionalType || ""}
                      onChange={(e) =>
                        setEditingMember({
                          ...editingMember,
                          professionalType: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600 font-medium"
                    >
                      <option value="">Selecione o tipo...</option>
                      <option value="Dentista">Dentista</option>
                      <option value="Harmonizador">Harmonizador</option>
                      <option value="ASB">ASB</option>
                      <option value="Recepção">Recepção</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Marketing">Marketing</option>
                      <option value="Administrativo">Administrativo</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                </div>

                {/* Additional access functions/Privileges */}
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-150 space-y-3 mt-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-slate-200 pb-2 border-slate-200">
                    Atividades & Funções Habilitadas
                  </h4>

                  <div className="space-y-2.5 pt-1">
                    {[
                      {
                        key: "accessFinancial",
                        label: "Efetuar Fechamentos e Financeiro",
                        desc: "Permite conciliação bancária, fluxo de caixa e relatórios financeiros.",
                      },
                      {
                        key: "allowFinancialModify",
                        label: "Permitir Editar e Apagar Financeiro",
                        desc: "Concede direito de alterar ou excluir lançamentos financeiros consolidando do ERP.",
                      },
                      {
                        key: "accessCRM",
                        label: "Gestão de Vendas (CRM)",
                        desc: "Concede acesso à captação de leads, propostas e orçamento de novos pacientes.",
                      },
                      {
                        key: "accessInventory",
                        label: "Mapeamento de Estoque",
                        desc: "Permite acompanhar de perto o inventário e insumos da clínica.",
                      },
                      {
                        key: "accessSettings",
                        label: "Ajustes das Configurações Gerais",
                        desc: "Autoriza alterar regras administrativas, taxas, convênios e modelos.",
                      },
                      {
                        key: "accessReports",
                        label: "Gerar Relatórios Executivos",
                        desc: "Acesso a painéis gerenciais consolidando dados de faturamento global.",
                      },
                      {
                        key: "accessCourses",
                        label: "Acesso ao Painel de Cursos (ELIZA Education)",
                        desc: "Autoriza professor, coordenador ou secretária a planejar aulas e turmas.",
                      },
                    ].map((perm) => (
                      <div key={perm.key} className="flex gap-3">
                        <input
                          type="checkbox"
                          id={`perm-${perm.key}`}
                          checked={editingMember[perm.key] !== false}
                          onChange={(e) =>
                            setEditingMember({
                              ...editingMember,
                              [perm.key]: e.target.checked,
                            })
                          }
                          className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500 cursor-pointer shrink-0 mt-0.5"
                        />
                        <div>
                          <label
                            htmlFor={`perm-${perm.key}`}
                            className="text-[10px] font-bold text-slate-700 uppercase tracking-widest cursor-pointer select-none block"
                          >
                            {perm.label}
                          </label>
                          <p className="text-[9px] text-slate-400 font-medium leading-tight mt-0.5">
                            {perm.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {editingMember.accessCourses !== false && (
                    <div className="pt-3 border-t border-slate-250 text-left space-y-1">
                      <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">
                        Nível de Acesso Acadêmico
                      </label>
                      <select
                        value={editingMember.courseRole || "professor"}
                        onChange={(e) =>
                          setEditingMember({
                            ...editingMember,
                            courseRole: e.target.value,
                          })
                        }
                        className="w-full p-2 bg-white border border-slate-205 rounded-xl text-[10.5px] font-bold text-slate-705 outline-none font-sans cursor-pointer"
                      >
                        <option value="administrador">
                          Administrador do Curso
                        </option>
                        <option value="professor">
                          Professor / Orientador
                        </option>
                        <option value="auxiliar">Auxiliar / Monitor</option>
                        <option value="aluno">Aluno / Residente</option>
                        <option value="somente_visualizacao">
                          Somente Visualização
                        </option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setEditingMember(null)}
                  className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-[#a1a1aa] hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveMember}
                  disabled={!editingMember.name}
                  className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20 active:scale-[0.98] disabled:opacity-50 font-black"
                >
                  Salvar Mudanças
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
