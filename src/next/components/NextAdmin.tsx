import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings2, Building2, Users, UserCog, FileText, Wand2, Camera,
  Loader2, Save, Upload, Trash2, Check, X, AlertTriangle, ShieldAlert,
  Plus, Eye, EyeOff, Sparkles, RefreshCw, Lock, Landmark, GraduationCap, Pencil,
  Smartphone, CheckCircle2, XCircle, Copy, Send
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs, secureGetDoc } from '../services/next-db';
import { collection, query, doc as fsDoc, setDoc, updateDoc, deleteDoc, addDoc, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';
import { InviteService } from '../../services/inviteService';

interface MemberPermissionFlags {
  accessFinancial: boolean;
  allowFinancialModify: boolean;
  accessCRM: boolean;
  accessInventory: boolean;
  accessSettings: boolean;
  accessReports: boolean;
  accessCourses: boolean;
}

interface Member extends Partial<MemberPermissionFlags> {
  id: string;
  uid?: string;
  name: string;
  email?: string;
  role: string;
  active?: boolean;
  isClinicalProvider?: boolean;
  status?: string;
  createdAt?: any;
  courseRole?: string;
}

const PERMISSION_FIELDS: { key: keyof MemberPermissionFlags; label: string; desc: string }[] = [
  { key: 'accessFinancial', label: 'Financeiro', desc: 'Ver e efetuar fechamentos e lançamentos financeiros' },
  { key: 'allowFinancialModify', label: 'Editar Financeiro', desc: 'Permitir editar e apagar lançamentos financeiros' },
  { key: 'accessCRM', label: 'CRM / Comunicação', desc: 'Gestão de vendas e comunicação com pacientes' },
  { key: 'accessInventory', label: 'Estoque', desc: 'Ver e movimentar o estoque da clínica' },
  { key: 'accessSettings', label: 'Painel Admin', desc: 'Acessar configurações gerais da clínica' },
  { key: 'accessReports', label: 'Relatórios', desc: 'Gerar relatórios executivos' },
];

const COURSE_ROLE_OPTIONS = [
  { value: 'administrador', label: 'Administrador do Curso' },
  { value: 'professor', label: 'Professor / Orientador' },
  { value: 'auxiliar', label: 'Auxiliar / Monitor' },
  { value: 'somente_visualizacao', label: 'Somente Visualização' },
];

const DEFAULT_PERMISSIONS: MemberPermissionFlags = {
  accessFinancial: true, allowFinancialModify: true, accessCRM: true,
  accessInventory: true, accessSettings: false, accessReports: true, accessCourses: false,
};

type AdminTab = 'clinica' | 'equipe' | 'documentos' | 'identidade_ia' | 'integracoes';

interface ExtractedClinicFields {
  name?: string;
  companyName?: string;
  cnpj?: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  technicalDirectorCouncilNumber?: string;
}

const FIELD_LABELS: Record<keyof ExtractedClinicFields, string> = {
  name: 'Nome da clínica',
  companyName: 'Razão social',
  cnpj: 'CNPJ / CPF',
  address: 'Endereço',
  phone: 'Telefone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  technicalDirectorCouncilNumber: 'CRO/CRM do responsável técnico',
};

const ROLE_OPTIONS = ['Dentista', 'Médico', 'Secretária', 'Financeiro', 'Marketing', 'Comercial', 'Auxiliar', 'Coordenador', 'Gestor', 'Recepção', 'Estagiário', 'Outro'];

const TWILIO_SANDBOX_NUMBER = '+14155238886';

// Real security token sent to Meta's webhook config — uses the Web Crypto
// API (cryptographically secure) rather than Math.random(), which is not
// suitable for anything security-relevant.
function generateVerifyToken(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

// A real Firebase Auth account is created with this password — must not be
// a fixed, guessable default shared by every new team member.
function generateTempPassword(): string {
  return `Eliza${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

const TABS: { id: AdminTab; label: string; icon: any }[] = [
  { id: 'clinica', label: 'Clínica', icon: Building2 },
  { id: 'equipe', label: 'Equipe', icon: Users },
  { id: 'documentos', label: 'Documentos', icon: FileText },
  { id: 'identidade_ia', label: 'Identidade com IA', icon: Wand2 },
  { id: 'integracoes', label: 'WhatsApp', icon: Smartphone },
];

export default function NextAdmin() {
  const { clinic, user, profile } = useAuth();
  const { addAuditLog } = useNextReadOnly();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || clinic?.ownerId === user?.uid;

  const [activeTab, setActiveTab] = useState<AdminTab>('clinica');
  const [message, setMessage] = useState<string | null>(null);
  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  // --- Clínica ------------------------------------------------------
  const [clinicForm, setClinicForm] = useState({ name: '', companyName: '', cnpj: '', phone: '', whatsapp: '', email: '', address: '', logoBase64: '', academyEnabled: false });
  const [savingClinic, setSavingClinic] = useState(false);
  const [savingAcademyToggle, setSavingAcademyToggle] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // --- Documentos -----------------------------------------------------
  const [docsForm, setDocsForm] = useState({ technicalDirectorCouncilNumber: '', documentName: '', institutionalFooter: '', textSignature: '', defaultObservationText: '' });
  const [savingDocs, setSavingDocs] = useState(false);

  useEffect(() => {
    if (!clinic) return;
    setClinicForm({
      name: clinic.name || '', companyName: clinic.companyName || '', cnpj: clinic.cnpj || '',
      phone: clinic.phone || '', whatsapp: clinic.whatsapp || '', email: clinic.email || '',
      address: clinic.address || '', logoBase64: clinic.logoBase64 || '', academyEnabled: !!clinic.academyEnabled,
    });
    setDocsForm({
      technicalDirectorCouncilNumber: clinic.technicalDirectorCouncilNumber || '', documentName: clinic.documentName || '',
      institutionalFooter: clinic.institutionalFooter || '', textSignature: clinic.textSignature || '',
      defaultObservationText: clinic.defaultObservationText || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinic?.id]);

  const handleSaveClinic = async () => {
    if (!clinic?.id) return;
    setSavingClinic(true);
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id), {
        name: clinicForm.name.trim(), companyName: clinicForm.companyName.trim() || null, cnpj: clinicForm.cnpj.trim() || null,
        phone: clinicForm.phone.trim() || null, whatsapp: clinicForm.whatsapp.trim() || null, email: clinicForm.email.trim() || null,
        address: clinicForm.address.trim() || null, updatedAt: serverTimestamp(),
      }, { merge: true });
      addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: 'Dados cadastrais da clínica atualizados (escrita real).' });
      showMessage('Dados da clínica salvos de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingClinic(false);
    }
  };

  const handleToggleAcademy = async () => {
    if (!clinic?.id) return;
    const next = !clinicForm.academyEnabled;
    setSavingAcademyToggle(true);
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id), { academyEnabled: next, updatedAt: serverTimestamp() }, { merge: true });
      setClinicForm(v => ({ ...v, academyEnabled: next }));
      addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: `Eliza Academy ${next ? 'habilitado' : 'desabilitado'} para esta clínica (escrita real).` });
      showMessage(next ? 'Eliza Academy habilitado de verdade.' : 'Eliza Academy desabilitado.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingAcademyToggle(false);
    }
  };

  const handleLogoSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !clinic?.id) return;
    if (file.size > 800000) { showMessage('Logo muito grande — use uma imagem menor que 800KB.'); return; }
    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        await setDoc(fsDoc(db, 'clinics', clinic.id), { logoBase64: base64, updatedAt: serverTimestamp() }, { merge: true });
        setClinicForm(v => ({ ...v, logoBase64: base64 }));
        addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: 'Logo da clínica atualizada (escrita real).' });
        showMessage('Logo salva de verdade.');
      } catch (err: any) {
        showMessage(`Falha ao gravar logo: ${err?.message || err}`);
      } finally {
        setUploadingLogo(false);
        if (logoInputRef.current) logoInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveDocs = async () => {
    if (!clinic?.id) return;
    setSavingDocs(true);
    try {
      await setDoc(fsDoc(db, 'clinics', clinic.id), { ...docsForm, updatedAt: serverTimestamp() }, { merge: true });
      addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: 'Configurações de receituários e contratos atualizadas (escrita real).' });
      showMessage('Configurações de documentos salvas de verdade.');
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingDocs(false);
    }
  };

  // --- Equipe -----------------------------------------------------------

  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const fetchMembers = async () => {
    if (!clinic?.id) return;
    setLoadingMembers(true);
    try {
      const ref = collection(db, 'clinics', clinic.id, 'members');
      const snap = await secureGetDocs(query(ref), 'members', { addAuditLog });
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Member)));
    } catch (err) {
      console.warn('Failed to load real team members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };
  useEffect(() => { fetchMembers(); }, [clinic?.id]);

  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMember, setNewMember] = useState({ name: '', email: '', role: 'Dentista', password: generateTempPassword(), isClinicalProvider: true, isAdminRole: false, courseRole: 'professor', ...DEFAULT_PERMISSIONS });
  const [showPassword, setShowPassword] = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [createMemberError, setCreateMemberError] = useState<string | null>(null);
  const [lastCreatedCredentials, setLastCreatedCredentials] = useState<{ name: string; email: string; password: string } | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [pendingDeleteMemberId, setPendingDeleteMemberId] = useState<string | null>(null);

  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editMemberForm, setEditMemberForm] = useState({ role: '', isClinicalProvider: false, courseRole: 'professor', ...DEFAULT_PERMISSIONS });
  const [savingMemberPermissions, setSavingMemberPermissions] = useState(false);

  const openEditMember = (m: Member) => {
    setEditingMember(m);
    setEditMemberForm({
      role: m.role || '',
      isClinicalProvider: !!m.isClinicalProvider,
      courseRole: m.courseRole || 'professor',
      accessFinancial: m.accessFinancial !== false,
      allowFinancialModify: m.allowFinancialModify !== false,
      accessCRM: m.accessCRM !== false,
      accessInventory: m.accessInventory !== false,
      accessSettings: !!m.accessSettings,
      accessReports: m.accessReports !== false,
      accessCourses: !!m.accessCourses,
    });
  };

  const handleSaveMemberPermissions = async () => {
    if (!clinic?.id || !editingMember) return;
    setSavingMemberPermissions(true);
    try {
      const { role, isClinicalProvider, courseRole, ...perms } = editMemberForm;
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'members', editingMember.id), {
        role, isClinicalProvider, courseRole: perms.accessCourses ? courseRole : null, ...perms, updatedAt: serverTimestamp(),
      });
      setMembers(prev => prev.map(x => x.id === editingMember.id ? { ...x, role, isClinicalProvider, courseRole, ...perms } : x));
      addAuditLog({ collection: 'members', action: 'WRITE', status: 'SUCCESS', details: `Permissões de "${editingMember.name}" atualizadas (escrita real).` });
      showMessage('Permissões salvas de verdade.');
      setEditingMember(null);
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingMemberPermissions(false);
    }
  };

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    if (!newMember.name.trim() || !newMember.email.trim() || !newMember.password.trim()) {
      setCreateMemberError('Nome, e-mail e senha temporária são obrigatórios.');
      return;
    }
    if (newMember.password.trim().length < 6) {
      setCreateMemberError('A senha temporária precisa ter no mínimo 6 caracteres.');
      return;
    }
    setCreatingMember(true);
    setCreateMemberError(null);
    try {
      const role = newMember.isAdminRole ? 'admin' : newMember.role;
      const result = await InviteService.createStaffMember(clinic.id, {
        email: newMember.email.trim(), name: newMember.name.trim(), role,
        password: newMember.password.trim(), isClinicalProvider: newMember.isClinicalProvider,
      });
      if (result?.uid) {
        const { accessFinancial, allowFinancialModify, accessCRM, accessInventory, accessSettings, accessReports, accessCourses, courseRole } = newMember;
        await updateDoc(fsDoc(db, 'clinics', clinic.id, 'members', result.uid), {
          accessFinancial, allowFinancialModify, accessCRM, accessInventory, accessSettings, accessReports, accessCourses,
          courseRole: accessCourses ? courseRole : null,
        });
      }
      addAuditLog({ collection: 'members', action: 'WRITE', status: 'SUCCESS', details: `Login real criado para "${newMember.name.trim()}" (${role}) na equipe (escrita real).` });
      setLastCreatedCredentials({ name: newMember.name.trim(), email: newMember.email.trim(), password: newMember.password.trim() });
      setNewMember({ name: '', email: '', role: 'Dentista', password: generateTempPassword(), isClinicalProvider: true, isAdminRole: false, courseRole: 'professor', ...DEFAULT_PERMISSIONS });
      setIsAddMemberOpen(false);
      showMessage('Conta criada de verdade. Compartilhe a senha temporária com o profissional.');
      await fetchMembers();
    } catch (err: any) {
      setCreateMemberError(err?.message || 'Falha ao criar o membro da equipe.');
    } finally {
      setCreatingMember(false);
    }
  };

  const handleToggleMemberActive = async (m: Member) => {
    if (!clinic?.id) return;
    setUpdatingMemberId(m.id);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'members', m.id), { active: !m.active, updatedAt: serverTimestamp() });
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, active: !m.active } : x));
      addAuditLog({ collection: 'members', action: 'WRITE', status: 'SUCCESS', details: `Membro "${m.name}" ${!m.active ? 'ativado' : 'desativado'} (escrita real).` });
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setUpdatingMemberId(null);
    }
  };

  const handleDeleteMember = async (m: Member) => {
    if (!clinic?.id) return;
    setUpdatingMemberId(m.id);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'members', m.id));
      setMembers(prev => prev.filter(x => x.id !== m.id));
      addAuditLog({ collection: 'members', action: 'WRITE', status: 'SUCCESS', details: `Vínculo de "${m.name}" com a clínica removido (escrita real).` });
      showMessage(`"${m.name}" removido da equipe (o login continua existindo, só perde acesso a esta clínica).`);
    } catch (err: any) {
      showMessage(`Falha ao excluir: ${err?.message || err}`);
    } finally {
      setUpdatingMemberId(null);
      setPendingDeleteMemberId(null);
    }
  };

  // --- Integrações (WhatsApp) ----------------------------------------------

  const [waLoading, setWaLoading] = useState(true);
  const [waSaving, setWaSaving] = useState(false);
  const [waCopied, setWaCopied] = useState(false);
  const [waTestSending, setWaTestSending] = useState(false);
  const [waTestResult, setWaTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isWaTestModalOpen, setIsWaTestModalOpen] = useState(false);
  const [waTestPhoneInput, setWaTestPhoneInput] = useState('');

  const [waStatus, setWaStatus] = useState<'conectado' | 'não conectado' | 'erro'>('não conectado');
  const [waProvider, setWaProvider] = useState<'meta' | 'twilio'>('meta');
  const [waPhoneNumberId, setWaPhoneNumberId] = useState('');
  const [waWabaId, setWaWabaId] = useState('');
  const [waBusinessName, setWaBusinessName] = useState('');
  const [waDisplayPhoneNumber, setWaDisplayPhoneNumber] = useState('');
  const [waVerifyToken, setWaVerifyToken] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');
  const [waTwilioAccountSid, setWaTwilioAccountSid] = useState('');
  const [waTwilioAuthToken, setWaTwilioAuthToken] = useState('');
  const [waTwilioWhatsAppNumber, setWaTwilioWhatsAppNumber] = useState(TWILIO_SANDBOX_NUMBER);
  const [waAiEnabled, setWaAiEnabled] = useState(true);
  const [waHumanApprovalRequired, setWaHumanApprovalRequired] = useState(true);

  const [waApiNumber, setWaApiNumber] = useState('');
  const [waLegacyClinicNumber, setWaLegacyClinicNumber] = useState('');
  const [waDefaultSendMode, setWaDefaultSendMode] = useState<'eliza_api' | 'open_whatsapp'>('eliza_api');
  const [waAllowOpenExternalWhatsApp, setWaAllowOpenExternalWhatsApp] = useState(true);

  const [waLogs, setWaLogs] = useState<{ id: string; action: string; status: string; message: string; createdAt: any }[]>([]);

  const waWebhookUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/whatsapp/webhook';

  const fetchWhatsAppConfig = async () => {
    if (!clinic?.id) return;
    setWaLoading(true);
    try {
      const integrationSnap = await secureGetDoc(fsDoc(db, 'clinics', clinic.id, 'integrations', 'whatsapp'), { addAuditLog });
      if (integrationSnap.exists()) {
        const data: any = integrationSnap.data();
        setWaStatus(data.status || 'não conectado');
        setWaProvider(data.provider === 'twilio' ? 'twilio' : 'meta');
        setWaPhoneNumberId(data.phoneNumberId || '');
        setWaWabaId(data.wabaId || '');
        setWaBusinessName(data.businessName || '');
        setWaDisplayPhoneNumber(data.displayPhoneNumber || '');
        setWaVerifyToken(data.verifyToken || '');
        setWaAccessToken(data.accessTokenSecretName ? '••••••••••••••••••••••••••••••••' : '');
        setWaTwilioAccountSid(data.twilioAccountSid || '');
        setWaTwilioAuthToken(data.twilioAuthToken ? '••••••••••••••••••••••••••••••••' : '');
        setWaTwilioWhatsAppNumber(data.twilioWhatsAppNumber || TWILIO_SANDBOX_NUMBER);
        setWaAiEnabled(data.aiEnabled !== false);
        setWaHumanApprovalRequired(data.humanApprovalRequired !== false);
      } else {
        setWaStatus('não conectado');
        setWaVerifyToken(generateVerifyToken());
      }

      const configSnap = await secureGetDoc(fsDoc(db, 'clinics', clinic.id, 'whatsapp_settings', 'config'), { addAuditLog });
      if (configSnap.exists()) {
        const data: any = configSnap.data();
        setWaApiNumber(data.apiNumber || '');
        setWaLegacyClinicNumber(data.legacyClinicNumber || '');
        setWaDefaultSendMode(data.defaultSendMode || 'eliza_api');
        setWaAllowOpenExternalWhatsApp(data.allowOpenExternalWhatsApp !== false);
      }

      const logsSnap = await secureGetDocs(
        query(collection(db, 'clinics', clinic.id, 'integration_logs'), orderBy('createdAt', 'desc'), limit(25)),
        'integration_logs',
        { addAuditLog }
      );
      setWaLogs(logsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    } catch (err) {
      console.warn('Failed to load real WhatsApp integration config:', err);
    } finally {
      setWaLoading(false);
    }
  };
  useEffect(() => { fetchWhatsAppConfig(); }, [clinic?.id]);

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id) return;
    setWaSaving(true);
    setWaTestResult(null);
    try {
      const integrationRef = fsDoc(db, 'clinics', clinic.id, 'integrations', 'whatsapp');

      let tokenToSave = waAccessToken;
      const isMasked = waAccessToken.includes('••••');
      let twilioTokenToSave = waTwilioAuthToken;
      const isTwilioTokenMasked = waTwilioAuthToken.includes('••••');

      let existingData: any = {};
      if (isMasked || isTwilioTokenMasked) {
        const snap = await secureGetDoc(integrationRef, { addAuditLog });
        existingData = snap.data() || {};
        if (isMasked) tokenToSave = existingData.accessTokenSecretName || '';
        if (isTwilioTokenMasked) twilioTokenToSave = existingData.twilioAuthToken || '';
      }

      const isConnected = waProvider === 'twilio'
        ? !!(waTwilioAccountSid && twilioTokenToSave && waTwilioWhatsAppNumber)
        : !!(waPhoneNumberId && waWabaId && tokenToSave);

      const payload: any = {
        status: isConnected ? 'conectado' : 'não conectado',
        provider: waProvider,
        phoneNumberId: waPhoneNumberId,
        wabaId: waWabaId,
        businessName: waBusinessName,
        displayPhoneNumber: waDisplayPhoneNumber,
        verifyToken: waVerifyToken,
        accessTokenSecretName: tokenToSave,
        twilioAccountSid: waTwilioAccountSid,
        twilioAuthToken: twilioTokenToSave,
        twilioWhatsAppNumber: waTwilioWhatsAppNumber,
        aiEnabled: waAiEnabled,
        humanApprovalRequired: waHumanApprovalRequired,
        webhookUrl: waWebhookUrl,
        updatedAt: serverTimestamp(),
      };
      if (!existingData.createdAt) payload.createdAt = serverTimestamp();

      await setDoc(integrationRef, payload, { merge: true });

      await setDoc(fsDoc(db, 'clinics', clinic.id, 'whatsapp_settings', 'config'), {
        apiNumber: waApiNumber,
        legacyClinicNumber: waLegacyClinicNumber,
        defaultSendMode: waDefaultSendMode,
        allowOpenExternalWhatsApp: waAllowOpenExternalWhatsApp,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
        type: 'whatsapp', action: 'save_config', status: 'success',
        message: 'Configurações de integração atualizadas e salvas pela equipe.',
        createdAt: serverTimestamp(),
      });

      addAuditLog({ collection: 'integrations', action: 'WRITE', status: 'SUCCESS', details: `Integração WhatsApp (${waProvider === 'twilio' ? 'Twilio' : 'Meta'}) salva (escrita real).` });
      showMessage('Configurações de WhatsApp salvas de verdade.');
      await fetchWhatsAppConfig();
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setWaSaving(false);
    }
  };

  const handleDisconnectWhatsApp = async () => {
    if (!clinic?.id) return;
    setWaSaving(true);
    setWaTestResult(null);
    try {
      await deleteDoc(fsDoc(db, 'clinics', clinic.id, 'integrations', 'whatsapp'));
      setWaPhoneNumberId(''); setWaWabaId(''); setWaBusinessName(''); setWaDisplayPhoneNumber('');
      setWaAccessToken(''); setWaTwilioAccountSid(''); setWaTwilioAuthToken('');
      setWaTwilioWhatsAppNumber(TWILIO_SANDBOX_NUMBER);
      setWaVerifyToken(generateVerifyToken());
      setWaStatus('não conectado');

      await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
        type: 'whatsapp', action: 'disconnect', status: 'success',
        message: 'A integração com WhatsApp foi desativada e desconectada manualmente.',
        createdAt: serverTimestamp(),
      });
      addAuditLog({ collection: 'integrations', action: 'WRITE', status: 'SUCCESS', details: 'Integração WhatsApp desconectada (escrita real).' });
      showMessage('Integração de WhatsApp desconectada.');
      await fetchWhatsAppConfig();
    } catch (err: any) {
      showMessage(`Falha ao desconectar: ${err?.message || err}`);
    } finally {
      setWaSaving(false);
    }
  };

  const copyWaWebhookUrl = () => {
    navigator.clipboard.writeText(waWebhookUrl);
    setWaCopied(true);
    setTimeout(() => setWaCopied(false), 2000);
  };

  const handleWaTestSend = () => {
    if (!clinic) return;
    if (waProvider === 'twilio' ? !waTwilioWhatsAppNumber : !waPhoneNumberId) return;
    setWaTestPhoneInput('');
    setIsWaTestModalOpen(true);
    setWaTestResult(null);
  };

  const submitWaTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinic?.id || !waTestPhoneInput.trim()) return;
    if (waProvider === 'twilio' ? !waTwilioWhatsAppNumber : !waPhoneNumberId) return;

    const testPhone = waTestPhoneInput.trim();
    setWaTestSending(true);
    setWaTestResult(null);
    try {
      const response = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinicId: clinic.id,
          conversationId: testPhone,
          text: `Olá! Este é um teste oficial de conexão da sua clínica via ELIZA AI (provedor: ${waProvider === 'twilio' ? 'Twilio' : 'Meta WhatsApp Cloud API'}). Integração ativa e segura! 🚀`,
        }),
      });
      const resData = await response.json();
      if (response.ok) {
        setWaTestResult({ success: true, message: 'Mensagem de teste enviada com sucesso! Verifique o telefone.' });
        setIsWaTestModalOpen(false);
        await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
          type: 'whatsapp', action: 'test_send', status: 'success',
          message: `Envio de teste efetuado com sucesso para ${testPhone}.`,
          createdAt: serverTimestamp(),
        });
      } else {
        setWaTestResult({ success: false, message: `Falha no envio: ${resData.error || 'Erro desconhecido'}` });
        await addDoc(collection(db, 'clinics', clinic.id, 'integration_logs'), {
          type: 'whatsapp', action: 'test_send', status: 'error',
          message: `Falha operacional no envio de teste para ${testPhone}: ${resData.error || 'Erro interno'}`,
          createdAt: serverTimestamp(),
        });
      }
      await fetchWhatsAppConfig();
    } catch (err: any) {
      setWaTestResult({ success: false, message: 'Erro ao tentar enviar: ' + err.message });
    } finally {
      setWaTestSending(false);
    }
  };

  // --- Identidade com IA --------------------------------------------------

  const iaFileInputRef = useRef<HTMLInputElement>(null);
  const [iaLogoFile, setIaLogoFile] = useState<{ name: string; mimeType: string; dataUrl: string } | null>(null);
  const [iaExtracting, setIaExtracting] = useState(false);
  const [iaExtractError, setIaExtractError] = useState<string | null>(null);
  const [iaExtracted, setIaExtracted] = useState<ExtractedClinicFields | null>(null);
  const [iaConfirmedFields, setIaConfirmedFields] = useState<Partial<Record<keyof ExtractedClinicFields, boolean>>>({});
  const [iaEditedValues, setIaEditedValues] = useState<ExtractedClinicFields>({});
  const [applyingIa, setApplyingIa] = useState(false);

  const handleIaFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 900000) { showMessage('Imagem grande demais — use um arquivo menor que 900KB.'); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      setIaLogoFile({ name: file.name, mimeType: file.type || 'image/jpeg', dataUrl: reader.result as string });
      setIaExtracted(null);
      setIaExtractError(null);
    };
    reader.readAsDataURL(file);
    if (iaFileInputRef.current) iaFileInputRef.current.value = '';
  };

  const handleExtractIdentity = async () => {
    if (!iaLogoFile || !clinic?.id) return;
    setIaExtracting(true);
    setIaExtractError(null);
    setIaExtracted(null);
    try {
      const prompt = `Você é a Eliza, assistente administrativa de uma clínica odontológica/estética. Analise esta imagem (pode ser uma logomarca, cartão de visita ou papel timbrado) e extraia estritamente o que estiver visível nela.
Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, exatamente neste formato:
{"name":"","companyName":"","cnpj":"","address":"","phone":"","whatsapp":"","email":"","technicalDirectorCouncilNumber":""}
Deixe o campo como string vazia "" quando a informação não estiver legível ou não aparecer na imagem. NUNCA invente CNPJ, CPF, telefone, endereço, e-mail ou qualquer outro dado que não esteja realmente visível na imagem.`;
      const base64Data = iaLogoFile.dataUrl.split(',')[1];
      const ai = getGenAI();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: iaLogoFile.mimeType, data: base64Data } }] }],
        taskType: 'clinic_identity_extraction',
        clinicId: clinic.id,
      });
      const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente outra imagem.');
      const parsed = JSON.parse(jsonMatch[0]);
      const extracted: ExtractedClinicFields = {
        name: String(parsed.name || ''), companyName: String(parsed.companyName || ''), cnpj: String(parsed.cnpj || ''),
        address: String(parsed.address || ''), phone: String(parsed.phone || ''), whatsapp: String(parsed.whatsapp || ''),
        email: String(parsed.email || ''), technicalDirectorCouncilNumber: String(parsed.technicalDirectorCouncilNumber || ''),
      };
      setIaExtracted(extracted);
      setIaEditedValues(extracted);
      const confirmed: Partial<Record<keyof ExtractedClinicFields, boolean>> = {};
      (Object.keys(extracted) as (keyof ExtractedClinicFields)[]).forEach(k => { confirmed[k] = !!extracted[k]; });
      setIaConfirmedFields(confirmed);
      addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: 'Identidade da clínica analisada por IA real a partir de imagem enviada (aguardando confirmação campo a campo).' });
    } catch (err: any) {
      setIaExtractError(err?.message || 'Falha ao consultar a Eliza AI.');
    } finally {
      setIaExtracting(false);
    }
  };

  const handleApplyIaFields = async () => {
    if (!clinic?.id || !iaExtracted) return;
    setApplyingIa(true);
    try {
      const patch: Record<string, any> = { updatedAt: serverTimestamp() };
      (Object.keys(iaExtracted) as (keyof ExtractedClinicFields)[]).forEach(k => {
        if (iaConfirmedFields[k]) patch[k] = iaEditedValues[k] || '';
      });
      if (iaLogoFile) patch.logoBase64 = iaLogoFile.dataUrl;
      await setDoc(fsDoc(db, 'clinics', clinic.id), patch, { merge: true });
      setClinicForm(v => ({ ...v, ...patch, logoBase64: iaLogoFile ? iaLogoFile.dataUrl : v.logoBase64 }));
      addAuditLog({ collection: 'clinics', action: 'WRITE', status: 'SUCCESS', details: 'Campos confirmados da identidade da clínica aplicados via IA (escrita real).' });
      showMessage('Campos confirmados aplicados de verdade à clínica.');
      setIaExtracted(null);
      setIaLogoFile(null);
      setIaConfirmedFields({});
      setIaEditedValues({});
    } catch (err: any) {
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setApplyingIa(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto pb-16">
        <div className="next-glass-panel rounded-next-2xl p-10 text-center">
          <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-300">Acesso restrito</p>
          <p className="text-xs text-slate-500 mt-1">O Painel Admin só pode ser acessado por administradores ou pelo dono da clínica.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-16 space-y-6 font-sans">
      <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.14) 0%, transparent 70%)' }} />
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold tracking-tight next-brand-gradient-text flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-next-purple-neon" />
            Painel Admin
          </h1>
          <p className="text-slate-400 text-xs mt-1">Dados da clínica, equipe com login real, parâmetros de documentos e identidade visual — tudo aqui grava de verdade no Firestore.</p>
        </div>
      </div>

      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-xl p-3 text-xs text-next-green-success font-semibold">
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-1 bg-slate-900/60 border border-next-border rounded-xl p-1 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors ${activeTab === t.id ? 'next-brand-gradient-bg text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* CLÍNICA */}
      {activeTab === 'clinica' && (
        <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Building2 className="w-4 h-4 text-next-purple-neon" /> Dados Cadastrais da Clínica</h3>

          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-slate-900/60 border border-next-border flex items-center justify-center overflow-hidden flex-shrink-0">
              {clinicForm.logoBase64 ? <img src={clinicForm.logoBase64} alt="Logo" className="w-full h-full object-contain" /> : <Camera className="w-6 h-6 text-slate-600" />}
            </div>
            <div>
              <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoSelected} className="hidden" />
              <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-white next-brand-gradient-bg px-3 py-1.5 rounded-lg shadow-next-glow-purple disabled:opacity-60">
                {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                <span>{uploadingLogo ? 'Enviando...' : 'Enviar logo'}</span>
              </button>
              <p className="text-[10px] text-slate-600 mt-1">Máx. 800KB. Aparece nos contratos e receituários gerados.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Nome da clínica</label>
              <input value={clinicForm.name} onChange={(e) => setClinicForm(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Razão social</label>
              <input value={clinicForm.companyName} onChange={(e) => setClinicForm(v => ({ ...v, companyName: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">CNPJ / CPF</label>
              <input value={clinicForm.cnpj} onChange={(e) => setClinicForm(v => ({ ...v, cnpj: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Telefone</label>
              <input value={clinicForm.phone} onChange={(e) => setClinicForm(v => ({ ...v, phone: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">WhatsApp</label>
              <input value={clinicForm.whatsapp} onChange={(e) => setClinicForm(v => ({ ...v, whatsapp: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail</label>
              <input value={clinicForm.email} onChange={(e) => setClinicForm(v => ({ ...v, email: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] font-mono text-slate-500 uppercase">Endereço</label>
              <input value={clinicForm.address} onChange={(e) => setClinicForm(v => ({ ...v, address: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
          </div>

          <button onClick={handleSaveClinic} disabled={savingClinic} className="inline-flex items-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
            {savingClinic ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{savingClinic ? 'Gravando...' : 'Salvar dados reais da clínica'}</span>
          </button>
        </div>
      )}

      {activeTab === 'clinica' && (
        <div className="next-glass-panel rounded-next-2xl p-5">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-next-purple-neon/15 border border-next-purple-neon/25 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-next-purple-light" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-200">Eliza Academy</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Para clínicas que também ministram cursos, mentorias ou imersões — habilita o módulo de cursos, alunos e pacientes-modelo para esta clínica.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleToggleAcademy}
              disabled={savingAcademyToggle}
              className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors disabled:opacity-60 ${clinicForm.academyEnabled ? 'next-brand-gradient-bg' : 'bg-slate-800 border border-next-border'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${clinicForm.academyEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </label>
        </div>
      )}

      {/* EQUIPE */}
      {activeTab === 'equipe' && (
        <div className="space-y-4">
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Users className="w-4 h-4 text-next-purple-neon" /> Equipe ({members.length})</h3>
              <div className="flex items-center gap-2">
                <button onClick={fetchMembers} disabled={loadingMembers} className="p-2 bg-slate-900/70 border border-next-border rounded-lg text-slate-400 hover:text-slate-200 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingMembers ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={() => { setCreateMemberError(null); setIsAddMemberOpen(true); }} className="inline-flex items-center gap-1.5 px-3 py-2 next-brand-gradient-bg text-white font-bold text-[11px] rounded-lg shadow-next-glow-purple">
                  <Plus className="w-3.5 h-3.5" /> Adicionar membro
                </button>
              </div>
            </div>
            <p className="text-[10.5px] text-slate-500 flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" /> Só profissionais com "Atendimento Clínico" marcado aparecem para seleção na Agenda ao criar um atendimento.</p>

            {loadingMembers ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-next-purple-neon" /></div>
            ) : members.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">Nenhum membro de equipe cadastrado ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-900/40 border border-next-border rounded-lg p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center text-[11px] font-bold uppercase flex-shrink-0">{(m.name || '?').charAt(0)}</div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-200 truncate">{m.name} <span className="text-slate-500 font-normal">· {m.role}</span></p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {m.isClinicalProvider && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border bg-next-purple-neon/10 border-next-purple-neon/20 text-next-purple-light">Atende (Agenda)</span>}
                      {m.accessCourses && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border bg-next-ia-blue/10 border-next-ia-blue/20 text-next-ia-blue">Academy</span>}
                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md border ${m.active !== false ? 'bg-next-green-success/10 border-next-green-success/20 text-next-green-success' : 'bg-slate-800 border-next-border text-slate-500'}`}>{m.active !== false ? 'Ativo' : 'Inativo'}</span>
                      <button onClick={() => openEditMember(m)} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200" title="Editar permissões">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleToggleMemberActive(m)} disabled={updatingMemberId === m.id} className="p-1.5 rounded-lg bg-slate-800 border border-next-border text-slate-400 hover:text-slate-200 disabled:opacity-50">
                        {updatingMemberId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (m.active !== false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />)}
                      </button>
                      {pendingDeleteMemberId === m.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleDeleteMember(m)} disabled={updatingMemberId === m.id} className="text-[9px] font-bold text-white bg-next-red-alert px-1.5 py-1 rounded whitespace-nowrap">Confirmar</button>
                          <button onClick={() => setPendingDeleteMemberId(null)} className="text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <button onClick={() => setPendingDeleteMemberId(m.id)} className="p-1.5 rounded-lg bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {lastCreatedCredentials && (
            <div className="next-glass-panel rounded-next-2xl p-4 border-next-purple-neon/30 space-y-1.5">
              <p className="text-xs font-bold text-next-purple-light flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Credenciais de "{lastCreatedCredentials.name}" (conta real criada)</p>
              <p className="text-[11px] text-slate-300 font-mono">E-mail: {lastCreatedCredentials.email}</p>
              <p className="text-[11px] text-slate-300 font-mono">Senha temporária: {lastCreatedCredentials.password}</p>
              <p className="text-[10px] text-slate-500">Compartilhe com o profissional agora — esta senha não fica salva em texto simples em nenhum outro lugar do sistema.</p>
            </div>
          )}
        </div>
      )}

      {/* DOCUMENTOS */}
      {activeTab === 'documentos' && (
        <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><FileText className="w-4 h-4 text-next-purple-neon" /> Configurações de Receituários e Contratos</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase flex items-center gap-1"><Landmark className="w-3 h-3" /> CRO/CRM do responsável técnico</label>
              <input value={docsForm.technicalDirectorCouncilNumber} onChange={(e) => setDocsForm(v => ({ ...v, technicalDirectorCouncilNumber: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-slate-500 uppercase">Nome padrão do documento</label>
              <input value={docsForm.documentName} onChange={(e) => setDocsForm(v => ({ ...v, documentName: e.target.value }))} placeholder="Ex: Termo de Consentimento" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Rodapé institucional</label>
            <textarea value={docsForm.institutionalFooter} onChange={(e) => setDocsForm(v => ({ ...v, institutionalFooter: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Texto de assinatura</label>
            <textarea value={docsForm.textSignature} onChange={(e) => setDocsForm(v => ({ ...v, textSignature: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Observação padrão</label>
            <textarea value={docsForm.defaultObservationText} onChange={(e) => setDocsForm(v => ({ ...v, defaultObservationText: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1 h-16 resize-none" />
          </div>
          <button onClick={handleSaveDocs} disabled={savingDocs} className="inline-flex items-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
            {savingDocs ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{savingDocs ? 'Gravando...' : 'Salvar configurações reais'}</span>
          </button>
        </div>
      )}

      {/* IDENTIDADE COM IA */}
      {activeTab === 'identidade_ia' && (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-next-2xl p-6 next-brand-gradient-bg shadow-next-glow-purple-strong">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl pointer-events-none bg-white/10" />
            <div className="relative z-10 flex items-center gap-4">
              <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center text-white border border-white/20 flex-shrink-0">
                <Wand2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-base font-black text-white tracking-tight flex items-center gap-2 flex-wrap">
                  Identidade da Clínica com IA
                  <span className="text-[9.5px] bg-white/20 font-extrabold uppercase px-2 py-0.5 rounded-full text-white tracking-widest">ELIZA AI Center</span>
                </h3>
                <p className="text-white/80 text-[11px] mt-1">Envie a logomarca, um cartão de visita ou papel timbrado — a Eliza lê a imagem de verdade e sugere nome, CNPJ/CPF, endereço e contato. Nada é salvo sem sua confirmação campo a campo.</p>
              </div>
            </div>
          </div>

          <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
            <input ref={iaFileInputRef} type="file" accept="image/*" onChange={handleIaFileSelected} className="hidden" />
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-2xl bg-slate-900/60 border border-dashed border-next-border flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer" onClick={() => iaFileInputRef.current?.click()}>
                {iaLogoFile ? <img src={iaLogoFile.dataUrl} alt={iaLogoFile.name} className="w-full h-full object-contain" /> : <Camera className="w-6 h-6 text-slate-600" />}
              </div>
              <div className="space-y-2">
                <button onClick={() => iaFileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-next-purple-light bg-next-purple-neon/15 border border-next-purple-neon/30 px-2.5 py-1.5 rounded-lg">
                  <Upload className="w-3.5 h-3.5" /> {iaLogoFile ? 'Trocar imagem' : 'Enviar imagem'}
                </button>
                <p className="text-[10px] text-slate-600">Até 900KB. Logo, cartão de visita ou papel timbrado com os dados legíveis.</p>
                {iaLogoFile && (
                  <button onClick={handleExtractIdentity} disabled={iaExtracting} className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-50">
                    {iaExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    <span>{iaExtracting ? 'A Eliza está lendo a imagem...' : 'Analisar com a Eliza'}</span>
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-slate-600 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 flex-shrink-0" /> Chama a IA real (mesmo Gateway do app, OpenAI com fallback Gemini). Sem chave de API configurada neste ambiente, aparece um erro real — não é simulado.</p>

            {iaExtractError && (
              <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{iaExtractError}</p>
            )}
          </div>

          {iaExtracted && (
            <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Check className="w-4 h-4 text-next-green-success" /> Campos identificados — revise e confirme</h4>
              <div className="space-y-2">
                {(Object.keys(FIELD_LABELS) as (keyof ExtractedClinicFields)[]).map(k => (
                  <div key={k} className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={!!iaConfirmedFields[k]}
                      onChange={(e) => setIaConfirmedFields(v => ({ ...v, [k]: e.target.checked }))}
                      disabled={!iaExtracted[k]}
                      className="w-4 h-4 rounded flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <label className="text-[9.5px] font-mono text-slate-500 uppercase">{FIELD_LABELS[k]}</label>
                      <input
                        value={iaEditedValues[k] || ''}
                        onChange={(e) => setIaEditedValues(v => ({ ...v, [k]: e.target.value }))}
                        placeholder={iaExtracted[k] ? '' : 'não identificado na imagem'}
                        className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-0.5"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={handleApplyIaFields} disabled={applyingIa} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple-strong disabled:opacity-50">
                {applyingIa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{applyingIa ? 'Gravando...' : 'Aplicar campos confirmados + logo à clínica (real)'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* WHATSAPP / INTEGRAÇÕES */}
      {activeTab === 'integracoes' && (
        <div className="space-y-4">
          <div className="next-glass-panel rounded-next-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Smartphone className="w-4 h-4 text-next-purple-neon" /> Integração Oficial com WhatsApp</h3>
              {waStatus === 'conectado' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-next-green-success/10 border border-next-green-success/25 text-next-green-success">
                  <CheckCircle2 className="w-3 h-3" /> Conectado
                </span>
              ) : waStatus === 'erro' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-next-red-alert/10 border border-next-red-alert/25 text-next-red-alert">
                  <AlertTriangle className="w-3 h-3" /> Erro Conexão
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-800 border border-next-border text-slate-500">
                  <XCircle className="w-3 h-3" /> Não Conectado
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 -mt-2">Conecte via Meta WhatsApp Cloud API ou via Twilio (Sandbox ou número aprovado) para enviar e receber mensagens reais de pacientes.</p>

            {waLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-next-purple-neon" /></div>
            ) : (
              <form onSubmit={handleSaveWhatsApp} className="space-y-4">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase block mb-1.5">Provedor de Envio</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setWaProvider('meta')} className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${waProvider === 'meta' ? 'next-brand-gradient-bg border-transparent text-white' : 'bg-slate-900 border-next-border text-slate-400 hover:text-slate-200'}`}>Meta (WhatsApp Cloud API)</button>
                    <button type="button" onClick={() => setWaProvider('twilio')} className={`px-4 py-2.5 rounded-xl text-xs font-bold border transition-all ${waProvider === 'twilio' ? 'next-brand-gradient-bg border-transparent text-white' : 'bg-slate-900 border-next-border text-slate-400 hover:text-slate-200'}`}>Twilio</button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Nome de exibição da clínica</label>
                  <input value={waBusinessName} onChange={(e) => setWaBusinessName(e.target.value)} placeholder="Ex: Clínica Portella Sorrisos" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                </div>

                {waProvider === 'meta' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Número conectado (com DDI)</label>
                        <input value={waDisplayPhoneNumber} onChange={(e) => setWaDisplayPhoneNumber(e.target.value)} placeholder="Ex: 5511999999999" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Phone Number ID</label>
                        <input value={waPhoneNumberId} onChange={(e) => setWaPhoneNumberId(e.target.value)} placeholder="Painel de desenvolvedor Meta" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-mono text-slate-500 uppercase">WhatsApp Business Account ID (WABA)</label>
                        <input value={waWabaId} onChange={(e) => setWaWabaId(e.target.value)} placeholder="Painel do Meta" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Access Token Meta / Permanent Token</label>
                      <input value={waAccessToken} onChange={(e) => setWaAccessToken(e.target.value)} placeholder="Token de acesso permanente gerado na Meta" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-next-purple-neon/10 border border-next-purple-neon/20 rounded-xl p-3 text-[11px] text-slate-300 leading-relaxed">
                      <strong className="text-next-purple-light">Sandbox do Twilio:</strong> use o número <span className="font-mono font-bold">{TWILIO_SANDBOX_NUMBER}</span> pra testar sem aprovação da Meta. Cada pessoa que for receber mensagem precisa mandar, uma única vez, <span className="font-mono font-bold">"join &lt;código&gt;"</span> pra esse número pelo WhatsApp dela — o código aparece no console do Twilio (Messaging → Try it out → Send a WhatsApp message). Quando tiver um número de produção aprovado, é só trocar aqui.
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Account SID</label>
                        <input value={waTwilioAccountSid} onChange={(e) => setWaTwilioAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                      <div>
                        <label className="text-[10px] font-mono text-slate-500 uppercase">Número do WhatsApp (Twilio)</label>
                        <input value={waTwilioWhatsAppNumber} onChange={(e) => setWaTwilioWhatsAppNumber(e.target.value)} placeholder={TWILIO_SANDBOX_NUMBER} required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-mono text-slate-500 uppercase">Auth Token</label>
                      <input value={waTwilioAuthToken} onChange={(e) => setWaTwilioAuthToken(e.target.value)} placeholder="Insira o Auth Token do console do Twilio" required className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                    </div>
                  </>
                )}

                {waProvider === 'meta' ? (
                  <div className="bg-slate-900/60 border border-next-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase block">Segurança do Webhook (Verify Token)</span>
                      <span className="font-mono text-xs text-slate-200 font-bold bg-slate-950 px-2 py-1 border border-next-border rounded mt-1 inline-block">{waVerifyToken}</span>
                    </div>
                    <p className="text-[9.5px] text-slate-500 leading-relaxed sm:max-w-xs">Este token é gerado aleatoriamente e deve ser copiado para o painel da Meta ao configurar o Webhook para autenticar a conexão.</p>
                  </div>
                ) : (
                  <div className="bg-slate-900/60 border border-next-border rounded-xl p-3">
                    <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1">Segurança do Webhook (Twilio)</span>
                    <p className="text-[9.5px] text-slate-500 leading-relaxed">O Twilio não usa verify token — cada mensagem recebida vem assinada com o Auth Token acima (cabeçalho X-Twilio-Signature), validado automaticamente no servidor. Não precisa configurar nada extra além da URL do webhook abaixo.</p>
                  </div>
                )}

                <div className="pt-4 border-t border-next-border flex items-center justify-between gap-4">
                  {waStatus === 'conectado' && (
                    <button type="button" onClick={handleDisconnectWhatsApp} disabled={waSaving} className="px-3.5 py-2.5 text-xs font-bold bg-next-red-alert/10 border border-next-red-alert/20 text-next-red-alert rounded-xl disabled:opacity-60">
                      Desconectar
                    </button>
                  )}
                  <button type="submit" disabled={waSaving} className="ml-auto inline-flex items-center gap-2 px-3.5 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                    {waSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{waSaving ? 'Gravando...' : 'Salvar parâmetros reais'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {!waLoading && (
            <>
              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">Multi-números & Comportamento de Ficha</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Número oficial API WhatsApp (DDI + DDD)</label>
                    <input value={waApiNumber} onChange={(e) => setWaApiNumber(e.target.value)} placeholder="Ex: 5511999999999" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Número conectado legado / antigo (DDI + DDD)</label>
                    <input value={waLegacyClinicNumber} onChange={(e) => setWaLegacyClinicNumber(e.target.value)} placeholder="Ex: 5511988888888" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Canal de envio padrão na ficha</label>
                    <select value={waDefaultSendMode} onChange={(e) => setWaDefaultSendMode(e.target.value as any)} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2 mt-1">
                      <option value="eliza_api">Enviar pela ELIZA (Cloud API)</option>
                      <option value="open_whatsapp">Abrir WhatsApp Legado da Clínica (wa.me)</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2.5 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={waAllowOpenExternalWhatsApp} onChange={(e) => setWaAllowOpenExternalWhatsApp(e.target.checked)} className="w-4 h-4 rounded flex-shrink-0" />
                  <div>
                    <p className="text-[10.5px] font-bold text-slate-300">Permitir escolher abrir no WhatsApp externo da clínica na ficha</p>
                    <p className="text-[9.5px] text-slate-500">Se marcado, os usuários poderão escolher entre Enviar pela ELIZA ou abrir no WhatsApp Web externo.</p>
                  </div>
                </label>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <h3 className="text-xs font-bold text-slate-200">Automação de IA (ELIZA)</h3>
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <p className="text-[10.5px] font-bold text-slate-300">Ativar Assistência de IA da ELIZA nas conversas</p>
                    <p className="text-[9.5px] text-slate-500 mt-0.5">Quando habilitada, a IA analisa mensagens recebidas e prescreve sugestões de ação.</p>
                  </div>
                  <button type="button" onClick={() => setWaAiEnabled(v => !v)} className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${waAiEnabled ? 'next-brand-gradient-bg' : 'bg-slate-800 border border-next-border'}`}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${waAiEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </label>
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <p className="text-[10.5px] font-bold text-slate-300">Homologação manual de respostas recomendadas (Modo Seguro)</p>
                    <p className="text-[9.5px] text-slate-500 mt-0.5">Garante que a ELIZA nunca envie respostas ao WhatsApp sem o clique de aprovação de um funcionário humano no painel.</p>
                  </div>
                  <button type="button" onClick={() => setWaHumanApprovalRequired(v => !v)} className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${waHumanApprovalRequired ? 'next-brand-gradient-bg' : 'bg-slate-800 border border-next-border'}`}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${waHumanApprovalRequired ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </label>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3 border-next-purple-neon/20">
                <h3 className="text-xs font-bold text-slate-200">Endereço Webhook Oficial</h3>
                <p className="text-[11px] text-slate-500">Copie a URL de webhook abaixo e configure-a nas configurações de WhatsApp do desenvolvedor Meta (ou no console do Twilio) para ativar a escuta e reflexo instantâneo de mensagens.</p>
                <div className="bg-slate-950 border border-next-border rounded-xl p-3 relative">
                  <span className="text-[8px] font-black uppercase text-next-purple-light tracking-wider">Callback URL</span>
                  <p className="font-mono text-[10px] text-slate-300 break-all font-semibold leading-normal mt-1 pr-8">{waWebhookUrl}</p>
                  <button type="button" onClick={copyWaWebhookUrl} className="absolute top-2.5 right-2.5 text-slate-500 hover:text-slate-200 p-1 rounded">
                    {waCopied ? <Check className="w-3.5 h-3.5 text-next-green-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {waProvider === 'meta' ? (
                  <>
                    <div>
                      <span className="text-[9px] font-black uppercase text-next-purple-light tracking-wider block mb-1">Campos a assinar (Webhook Fields)</span>
                      <div className="text-[10px] font-mono font-bold bg-slate-900/60 p-2 border border-next-border rounded text-slate-300">- messages</div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed"><strong className="text-slate-300">Instruções Meta:</strong> use a validação hub.challenge e o Verify Token exposto acima.</p>
                  </>
                ) : (
                  <p className="text-[10px] text-slate-500 leading-relaxed">Configure esta mesma URL como "WHEN A MESSAGE COMES IN" no console do Twilio (Sandbox settings do WhatsApp). A assinatura é validada automaticamente com o Auth Token acima.</p>
                )}
              </div>

              {waStatus === 'conectado' && (
                <div className="next-glass-panel rounded-next-2xl p-5 space-y-3 border-next-green-success/20">
                  <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2"><Smartphone className="w-4 h-4 text-next-green-success" /> Testador de Comunicação</h3>
                  <p className="text-[11px] text-slate-500">Envie uma mensagem instantânea diretamente para um número qualquer de teste, usando o provedor configurado acima.</p>
                  <button type="button" onClick={handleWaTestSend} disabled={waTestSending} className="inline-flex items-center gap-2 px-4 py-2.5 bg-next-green-success text-white font-bold text-xs rounded-xl disabled:opacity-60">
                    {waTestSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Testar Envio Instantâneo</span>
                  </button>
                  {waTestResult && (
                    <div className={`p-3 rounded-xl text-xs border ${waTestResult.success ? 'bg-next-green-success/10 text-next-green-success border-next-green-success/20' : 'bg-next-red-alert/10 text-next-red-alert border-next-red-alert/20'}`}>
                      {waTestResult.message}
                    </div>
                  )}
                </div>
              )}

              <div className="next-glass-panel rounded-next-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-200">Logs de Integração</h3>
                  <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Histórico recente</span>
                </div>
                {waLogs.length === 0 ? (
                  <p className="text-[10px] text-slate-500 text-center py-6">Nenhum log operacional gerado ainda.</p>
                ) : (
                  <div className="space-y-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {waLogs.map(log => (
                      <div key={log.id} className="bg-slate-900/40 border border-next-border rounded-lg p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="font-black text-slate-400 uppercase tracking-tight">{log.action || 'Sincronização'}</span>
                          <span className={`px-1.5 py-0.5 rounded uppercase font-black tracking-widest text-[7px] ${log.status === 'success' ? 'bg-next-green-success/15 text-next-green-success' : 'bg-next-red-alert/15 text-next-red-alert'}`}>
                            {log.status === 'success' ? 'OK' : 'FALHA'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed">{log.message}</p>
                        <span className="text-[8px] text-slate-600 block font-mono">
                          {log.createdAt ? new Date(log.createdAt.toDate ? log.createdAt.toDate() : log.createdAt).toLocaleString('pt-BR') : 'Agora'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* NEW MEMBER MODAL */}
      <AnimatePresence>
        {isAddMemberOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !creatingMember && setIsAddMemberOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><UserCog className="w-4 h-4 text-next-purple-neon" /> Adicionar membro da equipe</h3>
                <button onClick={() => !creatingMember && setIsAddMemberOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-amber-400/90 mb-4 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Isto cria um login real (Firebase Auth) com acesso a esta clínica.</p>

              <form onSubmit={handleCreateMember} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Nome completo *</label>
                  <input autoFocus value={newMember.name} onChange={(e) => setNewMember(v => ({ ...v, name: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">E-mail *</label>
                  <input type="email" value={newMember.email} onChange={(e) => setNewMember(v => ({ ...v, email: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Senha temporária *</label>
                  <div className="relative mt-1">
                    <input type={showPassword ? 'text' : 'password'} value={newMember.password} onChange={(e) => setNewMember(v => ({ ...v, password: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 pr-9" />
                    <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[9.5px] text-slate-600 mt-1">Mínimo 6 caracteres. Compartilhe com o profissional após criar.</p>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Cargo / Função</label>
                  <select value={newMember.role} onChange={(e) => setNewMember(v => ({ ...v, role: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <label className="flex items-center gap-2.5 bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={newMember.isClinicalProvider} onChange={(e) => setNewMember(v => ({ ...v, isClinicalProvider: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase text-next-purple-light tracking-wider">Atendimento Clínico</p>
                    <p className="text-[9.5px] text-slate-400">Este profissional atende pacientes e aparece na Agenda</p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 bg-slate-900/50 border border-next-border rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={newMember.isAdminRole} onChange={(e) => setNewMember(v => ({ ...v, isAdminRole: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-300 tracking-wider">Administrador</p>
                    <p className="text-[9.5px] text-slate-500">Acesso ao Painel Admin e a ações restritas (excluir, configurar)</p>
                  </div>
                </label>

                <div className="pt-2 border-t border-next-border">
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-2">O que este membro pode ver no sistema</p>
                  <div className="space-y-1.5">
                    {PERMISSION_FIELDS.map(f => (
                      <label key={f.key} className="flex items-center gap-2.5 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={newMember[f.key]} onChange={(e) => setNewMember(v => ({ ...v, [f.key]: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10.5px] font-bold text-slate-300">{f.label}</p>
                          <p className="text-[9.5px] text-slate-500 truncate">{f.desc}</p>
                        </div>
                      </label>
                    ))}
                    {clinicForm.academyEnabled && (
                      <label className="flex items-center gap-2.5 bg-next-ia-blue/10 border border-next-ia-blue/25 rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={newMember.accessCourses} onChange={(e) => setNewMember(v => ({ ...v, accessCourses: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10.5px] font-bold text-next-ia-blue-light">Eliza Academy</p>
                          <p className="text-[9.5px] text-slate-500">Acesso ao painel de cursos</p>
                        </div>
                      </label>
                    )}
                    {clinicForm.academyEnabled && newMember.accessCourses && (
                      <select value={newMember.courseRole} onChange={(e) => setNewMember(v => ({ ...v, courseRole: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2">
                        {COURSE_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                {createMemberError && <p className="text-[11px] text-next-red-alert bg-next-red-alert/10 border border-next-red-alert/20 rounded-lg p-2">{createMemberError}</p>}
                <button type="submit" disabled={creatingMember} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                  {creatingMember ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCog className="w-3.5 h-3.5" />}
                  <span>{creatingMember ? 'Criando conta real...' : 'Criar login real'}</span>
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* EDIT MEMBER PERMISSIONS MODAL */}
      <AnimatePresence>
        {editingMember && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingMemberPermissions && setEditingMember(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Pencil className="w-4 h-4 text-next-purple-neon" /> Permissões de {editingMember.name}</h3>
                <button onClick={() => !savingMemberPermissions && setEditingMember(null)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Cargo / Função</label>
                  <select value={editMemberForm.role} onChange={(e) => setEditMemberForm(v => ({ ...v, role: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                    {ROLE_OPTIONS.concat(editMemberForm.role === 'admin' ? ['admin'] : []).map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <label className="flex items-center gap-2.5 bg-next-purple-neon/10 border border-next-purple-neon/25 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={editMemberForm.isClinicalProvider} onChange={(e) => setEditMemberForm(v => ({ ...v, isClinicalProvider: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase text-next-purple-light tracking-wider">Atendimento Clínico</p>
                    <p className="text-[9.5px] text-slate-400">Aparece na Agenda para atendimento</p>
                  </div>
                </label>

                <div className="pt-2 border-t border-next-border">
                  <p className="text-[10px] font-mono text-slate-500 uppercase mb-2">O que este membro pode ver no sistema</p>
                  <div className="space-y-1.5">
                    {PERMISSION_FIELDS.map(f => (
                      <label key={f.key} className="flex items-center gap-2.5 bg-slate-900/40 border border-next-border rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={editMemberForm[f.key]} onChange={(e) => setEditMemberForm(v => ({ ...v, [f.key]: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10.5px] font-bold text-slate-300">{f.label}</p>
                          <p className="text-[9.5px] text-slate-500 truncate">{f.desc}</p>
                        </div>
                      </label>
                    ))}
                    {clinicForm.academyEnabled && (
                      <label className="flex items-center gap-2.5 bg-next-ia-blue/10 border border-next-ia-blue/25 rounded-lg px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={editMemberForm.accessCourses} onChange={(e) => setEditMemberForm(v => ({ ...v, accessCourses: e.target.checked }))} className="w-4 h-4 rounded flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10.5px] font-bold text-next-ia-blue-light">Eliza Academy</p>
                          <p className="text-[9.5px] text-slate-500">Acesso ao painel de cursos</p>
                        </div>
                      </label>
                    )}
                    {clinicForm.academyEnabled && editMemberForm.accessCourses && (
                      <select value={editMemberForm.courseRole} onChange={(e) => setEditMemberForm(v => ({ ...v, courseRole: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2">
                        {COURSE_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <button onClick={handleSaveMemberPermissions} disabled={savingMemberPermissions} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60" style={{ minHeight: '40px' }}>
                  {savingMemberPermissions ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{savingMemberPermissions ? 'Gravando...' : 'Salvar permissões reais'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* WHATSAPP TEST SEND MODAL */}
      <AnimatePresence>
        {isWaTestModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !waTestSending && setIsWaTestModalOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Smartphone className="w-4 h-4 text-next-green-success" /> Número de Teste</h3>
                <button onClick={() => !waTestSending && setIsWaTestModalOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-[11px] text-slate-500 mb-4">{waProvider === 'twilio' ? 'Twilio' : 'WhatsApp Cloud API'}</p>

              <form onSubmit={submitWaTestSend} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Número de telefone destinatário</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="Ex: 5511999999999"
                    value={waTestPhoneInput}
                    onChange={(e) => setWaTestPhoneInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1 font-mono"
                  />
                  <p className="text-[9.5px] text-slate-600 mt-1">DDI (55 para o Brasil) + DDD + número do celular.</p>
                </div>
                <div className="flex gap-2.5 pt-1">
                  <button type="button" onClick={() => setIsWaTestModalOpen(false)} className="flex-1 px-4 py-2.5 bg-slate-900 border border-next-border text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-wider">
                    Cancelar
                  </button>
                  <button type="submit" disabled={waTestSending} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-next-green-success text-white rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-60">
                    {waTestSending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</> : <><Send className="w-3.5 h-3.5" /> Enviar Mensagem</>}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Clínica, equipe (com login real), documentos, identidade e WhatsApp gravam de verdade nesta clínica</span>
        </span>
      </div>
    </div>
  );
}
