import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Database, 
  Search, 
  ChevronRight, 
  ArrowRight,
  TrendingUp,
  CreditCard,
  UserCheck,
  AlertTriangle,
  Loader2,
  X,
  Trash2,
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  DollarSign,
  Zap
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { db, FIRESTORE_DATABASE_ID, handleFirestoreError, OperationType } from '../../lib/firebase';
import { 
  readExcelFile, 
  validateWorkbook, 
  parsePatientsSheet, 
  parseFinancialSheet,
  parseReviewSheets,
  importInBatches,
  deleteBatch
} from './importService';
import { 
  ImportedPatient, 
  ImportedFinancialEntry, 
  ImportBatch 
} from './types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  getDocs, 
  setDoc, 
  doc, 
  getDoc, 
  serverTimestamp 
} from 'firebase/firestore';

export default function ExcelImportPage() {
  const { clinic, user } = useAuth();
  
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [patients, setPatients] = useState<ImportedPatient[]>([]);
  const [financial, setFinancial] = useState<ImportedFinancialEntry[]>([]);
  const [reviewData, setReviewData] = useState<any>(null);
  const [auditData, setAuditData] = useState<any>(null);
  
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'success'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState({ type: '', count: 0, total: 0 });
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [permTest, setPermTest] = useState<{
    status: 'idle' | 'testing' | 'success' | 'error';
    data?: any;
  } | null>(null);

  // Load last batch on mount
  useEffect(() => {
    if (clinic) {
      const q = query(collection(db, 'clinics', clinic.id, 'import_batches'), orderBy('imported_at', 'desc'), limit(1));
      getDocs(q).then(snap => {
        if (!snap.empty) setLastBatchId(snap.docs[0].id);
      }).catch(err => {
        handleFirestoreError(err, OperationType.GET, `clinics/${clinic.id}/import_batches`);
      });
    }
  }, [clinic]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setError(null);
    setIsProcessing(true);
    setFile(selectedFile);
    
    try {
      const wb = await readExcelFile(selectedFile);
      const validation = validateWorkbook(wb);
      
      if (!validation.valid) {
        setError(validation.error || 'Erro na validação do arquivo.');
        setIsProcessing(false);
        return;
      }
      
      setWorkbook(wb);
      
      // Parse data
      const parsedPatients = parsePatientsSheet(wb);
      const parsedFinancial = parseFinancialSheet(wb);
      const reviewers = parseReviewSheets(wb);
      
      setPatients(parsedPatients);
      setFinancial(parsedFinancial);
      setReviewData(reviewers);
      setAuditData(validation.audit);
      
      setStep('preview');
    } catch (err: any) {
      console.error(err);
      setError('Erro ao ler o arquivo. Certifique-se de que é um Excel (.xlsx) válido.');
    } finally {
      setIsProcessing(false);
    }
  };

  const executeImport = async (mode: 'all' | 'patients' | 'financial' | 'test') => {
    if (!clinic || !user || !patients.length || !financial.length) return;
    
    setIsProcessing(true);
    setStep('importing');
    
    try {
      const isTest = mode === 'test';
      const patientsToImport = isTest ? patients.slice(0, 10) : (mode === 'financial' ? [] : patients);
      const financialToImport = isTest ? financial.slice(0, 20) : (mode === 'patients' ? [] : financial);

      const batchInfo: Partial<ImportBatch> = {
        file_name: file?.name || 'import.xlsx',
        imported_by: user.uid,
        status: 'validated',
        is_test_import: isTest,
        total_patients_in_file: patientsToImport.length,
        total_financial_entries_in_file: financialToImport.length,
        total_receitas: financialToImport.filter(f => f.type === 'receita').length,
        total_despesas: financialToImport.filter(f => f.type === 'despesa').length,
        total_receitas_vinculadas: financialToImport.filter(f => f.patient_id && f.type === 'receita').length,
        total_receitas_sem_vinculo: financialToImport.filter(f => !f.patient_id && f.type === 'receita').length,
        total_amount_receitas: financialToImport.filter(f => f.type === 'receita').reduce((acc, curr) => acc + curr.amount, 0),
        total_amount_despesas: financialToImport.filter(f => f.type === 'despesa').reduce((acc, curr) => acc + curr.amount, 0),
        warnings: [],
        errors: []
      };
      
      const batchId = await importInBatches(
        clinic.id, 
        patientsToImport, 
        financialToImport, 
        reviewData,
        batchInfo, 
        (type, count, total) => {
          setImportProgress({ type, count, total });
        }
      );
      
      setLastBatchId(batchId);
      setStep('success');
    } catch (err: any) {
      // Note: importInBatches already calls handleFirestoreError internally
      setError('Erro durante a gravação no banco de dados. ' + (err.message?.startsWith('{') ? 'Consulte o log para mais detalhes.' : err.message));
      setStep('preview');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteLastBatch = async () => {
    if (!lastBatchId || !clinic) return;
    if (!window.confirm(`Tem certeza que deseja excluir todos os dados do lote ${lastBatchId}?`)) return;

    setIsDeleting(true);
    try {
      await deleteBatch(clinic.id, lastBatchId);
      setLastBatchId(null);
      alert('Lote excluído com sucesso.');
    } catch (err: any) {
      // deleteBatch already calls handleFirestoreError internally
      alert('Erro ao excluir lote: ' + (err.message?.startsWith('{') ? 'Verifique as permissões.' : err.message));
    } finally {
      setIsDeleting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setWorkbook(null);
    setPatients([]);
    setFinancial([]);
    setStep('upload');
    setError(null);
    setPermTest(null);
  };

  const runPermissionTest = async () => {
    if (!clinic || !user) return;
    setPermTest({ status: 'testing' });
    const ts = Date.now();
    const path = `clinics/${clinic.id}/import_batches/PERMISSION_TEST_${ts}`;
    
    try {
      // Diagnostic read
      const memberRef = doc(db, 'clinics', clinic.id, 'members', user.uid);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.data();
      
      // Test write
      await setDoc(doc(db, path), {
        test: true,
        timestamp: serverTimestamp(),
        by: user.uid
      });
      
      setPermTest({ 
        status: 'success',
        data: { path, role: memberData?.role, active: memberData?.active }
      });
    } catch (err: any) {
      console.error("[PermTest] Error:", err);
      
      let roleFound = 'unknown (read block)';
      let activeFound = 'unknown (read block)';
      try {
         const snap = await getDoc(doc(db, 'clinics', clinic.id, 'members', user.uid));
         roleFound = snap.data()?.role;
         activeFound = snap.data()?.active;
      } catch(e) {}

      setPermTest({ 
        status: 'error',
        data: {
          uid: user.uid,
          email: user.email,
          clinicId: clinic.id,
          path,
          code: err.code || 'permission_denied',
          message: err.message,
          role: roleFound,
          active: activeFound
        }
      });
    }
  };

  const stats = {
    totalPatients: auditData?.pacientes_deduplicados_v2 || patients.length,
    readyPatients: auditData?.pacientes_prontos_para_importacao || patients.length,
    suspectPatients: auditData?.cadastros_de_paciente_para_revisao || reviewData?.suspects?.length || 0,
    totalEntries: auditData?.lancamentos_financeiros_brutos || financial.length,
    receitas: auditData?.receitas || financial.filter(f => f.type === 'receita').length,
    despesas: auditData?.despesas || financial.filter(f => f.type === 'despesa').length,
    unlinkedReceitas: auditData?.receitas_pendentes_de_revisao || financial.filter(f => !f.patient_id && f.type === 'receita').length,
    linkedReceitas: auditData?.receitas_vinculadas_automaticamente || financial.filter(f => f.patient_id && f.type === 'receita').length,
    totalReceitaAmount: financial.filter(f => f.type === 'receita').reduce((sum, f) => sum + f.amount, 0),
    totalAmountAudit: auditData?.receita_total || 0
  };

  const divergence = Math.abs(stats.totalReceitaAmount - stats.totalAmountAudit);
  const hasGraveDivergence = divergence > 100;

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC] font-sans overflow-hidden">
      {/* Premium Header */}
      <header className="px-10 py-8 bg-white border-b border-slate-200 shrink-0 flex items-center justify-between shadow-sm relative z-20">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-teal-600 text-white rounded-[20px] flex items-center justify-center shadow-lg shadow-teal-600/20 ring-4 ring-teal-50">
            <FileSpreadsheet className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tighter flex items-center gap-3">
              Motor de Importação ELIZA
              <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100 shadow-sm animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Produção Ativa
              </span>
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mt-1 italic">
              Conexão Segura: google-cloud/{FIRESTORE_DATABASE_ID}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={runPermissionTest}
            disabled={permTest?.status === 'testing'}
            className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border ${
              permTest?.status === 'success' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
              permTest?.status === 'error' ? 'bg-rose-50 text-rose-600 border-rose-100' :
              'bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200'
            }`}
          >
            {permTest?.status === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />}
            Testar Permissão
          </button>

          {lastBatchId && (
            <button 
              onClick={handleDeleteLastBatch}
              disabled={isDeleting}
              className="flex items-center gap-2 px-5 py-3 text-rose-500 hover:bg-rose-50 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border border-rose-100/50"
            >
              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Excluir Último Lote ({lastBatchId.split('_')[0]})
            </button>
          )}
          {step !== 'upload' && step !== 'importing' && (
            <button 
              onClick={reset}
              className="px-6 py-3 bg-slate-100 text-slate-500 hover:text-slate-900 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border border-slate-200"
            >
              Novo Arquivo
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
        <div className="max-w-7xl mx-auto space-y-10">
          
          {/* Permission Test Results Banner */}
          {permTest && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className={`p-6 rounded-[32px] border ${permTest.status === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-rose-50 border-rose-100 text-rose-900'}`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${permTest.status === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                  {permTest.status === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-black uppercase tracking-tight mb-2">
                    {permTest.status === 'success' ? 'Permissão de importação OK.' : 'Falha na Validação de Permissão'}
                  </h4>
                  {permTest.status === 'success' ? (
                    <p className="text-xs font-medium opacity-80">
                      O sistema conseguiu escrever no caminho <code className="bg-emerald-200/50 px-2 py-0.5 rounded">{permTest.data.path}</code>. 
                      Seu cargo foi identificado como: <span className="font-black uppercase">{permTest.data.role}</span>.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs font-bold opacity-80">As regras de segurança do Firestore impediram a operação. Detalhes técnicos:</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10px] font-mono leading-tight bg-white/50 p-4 rounded-2xl border border-rose-200/50">
                        <div className="space-y-1">
                          <p><span className="opacity-40 uppercase mr-2">UID:</span> {permTest.data?.uid}</p>
                          <p><span className="opacity-40 uppercase mr-2">Email:</span> {permTest.data?.email}</p>
                          <p><span className="opacity-40 uppercase mr-2">Clínica:</span> {permTest.data?.clinicId}</p>
                          <p><span className="opacity-40 uppercase mr-2">Papel:</span> <span className="font-black text-rose-600">{permTest.data?.role}</span></p>
                        </div>
                        <div className="space-y-1">
                          <p><span className="opacity-40 uppercase mr-2">Path:</span> {permTest.data?.path}</p>
                          <p><span className="opacity-40 uppercase mr-2">Code:</span> {permTest.data?.code}</p>
                          <p><span className="opacity-40 uppercase mr-2">Ativo:</span> {String(permTest.data?.active)}</p>
                          <p className="text-rose-600 truncate"><span className="opacity-40 uppercase mr-2 text-slate-900">Erro:</span> {permTest.data?.message}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => setPermTest(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5 opacity-40 hover:opacity-100" />
                </button>
              </div>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {step === 'upload' && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center justify-center pt-10"
              >
                <div className="w-full max-w-2xl bg-white p-16 rounded-[60px] shadow-2xl shadow-slate-200/50 border border-slate-100 text-center relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-3 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  
                  <div className="w-32 h-32 bg-emerald-50 text-emerald-600 rounded-[45px] flex items-center justify-center mx-auto mb-10 shadow-inner group-hover:scale-110 group-hover:rotate-3 transition-transform duration-500">
                    <Upload className="w-12 h-12" />
                  </div>
                  
                  <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4">Módulo de Sincronização Unificada</h2>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed mb-12 px-10">
                    Arraste ou selecione o arquivo <span className="text-slate-900 font-black italic">pacientes_financeiro_V2</span>. 
                    O motor processará automaticamente as abas de limpeza, auditoria e revisão pendente.
                  </p>
                  
                  <label className="relative inline-flex items-center gap-4 px-12 py-6 bg-slate-900 text-white rounded-[32px] font-black text-xs uppercase tracking-widest shadow-2xl shadow-slate-900/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer overflow-hidden group/btn">
                    <div className="absolute inset-0 bg-gradient-to-r from-teal-600/20 to-transparent opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".xlsx, .xls"
                      onChange={handleFileSelect}
                      disabled={isProcessing}
                    />
                    {isProcessing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Database className="w-6 h-6 text-teal-400" />}
                    {isProcessing ? 'Certificando Planilhas...' : 'Abrir Unificador Excel'}
                  </label>

                  {error && (
                    <motion.div 
                      key="error"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-12 p-6 bg-rose-50 border border-rose-100 rounded-[32px] flex items-start text-left gap-5"
                    >
                      <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center shrink-0">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-[10px] text-rose-700 font-black uppercase tracking-[0.2em] mb-1">Divergência Crítica</p>
                        <p className="text-xs text-rose-600 font-bold leading-relaxed">{error}</p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {step === 'preview' && (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-10 pb-20"
              >
                {/* Audit Performance Card */}
                {auditData && (
                  <div className={`p-10 rounded-[50px] border shadow-xl relative overflow-hidden ${hasGraveDivergence ? 'bg-rose-50 border-rose-100 shadow-rose-200/20' : 'bg-white border-slate-200 shadow-slate-200/20'}`}>
                    <div className="absolute top-0 right-0 p-10 opacity-5">
                      <BarChart3 className="w-48 h-48" />
                    </div>

                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10 relative z-10">
                      <div className="flex items-center gap-8">
                        <div className={`w-20 h-20 rounded-[30px] flex items-center justify-center shadow-inner ${hasGraveDivergence ? 'bg-rose-100 text-rose-600 rotate-12' : 'bg-emerald-100 text-emerald-600 shadow-emerald-500/10'}`}>
                          {hasGraveDivergence ? <AlertTriangle className="w-10 h-10" /> : <ClipboardCheck className="w-10 h-10" />}
                        </div>
                        <div>
                          <h4 className={`text-base font-black uppercase tracking-widest ${hasGraveDivergence ? 'text-rose-900' : 'text-slate-900'}`}>
                            Conferência de Integridade (Audit)
                          </h4>
                          <p className={`text-sm font-medium mt-1 ${hasGraveDivergence ? 'text-rose-600' : 'text-slate-500'}`}>
                             {hasGraveDivergence 
                               ? "Divergência encontrada. Revise a leitura da aba IMPORT_AUDIT e os cálculos do financeiro."
                               : "Conferência aprovada. Os valores do arquivo e do algoritmo ELIZA estão dentro da margem de segurança."}
                          </p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-2">
                             Diferença Apurada: R$ {divergence.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-8 bg-slate-50 p-6 rounded-[35px] border border-slate-100">
                        <div className="text-right">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">No Arquivo Excel</p>
                          <p className="text-2xl font-black text-slate-900 tabular-nums">R$ {stats.totalAmountAudit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-slate-300">
                          <ArrowRight className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Algoritmo ELIZA</p>
                          <p className={`text-2xl font-black tabular-nums ${hasGraveDivergence ? 'text-rose-600' : 'text-emerald-600'}`}>
                            R$ {stats.totalReceitaAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Stats Bento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100 hover:border-teal-200 transition-all">
                    <TrendingUp className="w-6 h-6 text-teal-500 mb-6" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Pacientes</p>
                    <p className="text-3xl font-black text-slate-900 leading-none">{stats.totalPatients}</p>
                    <div className="flex items-center gap-2 mt-4">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      <p className="text-[10px] text-emerald-600 font-black uppercase italic">{stats.readyPatients} Prontos</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
                      <p className="text-[10px] text-rose-600 font-black uppercase italic">{stats.suspectPatients} Revisão/Suspeitos</p>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-[40px] shadow-sm border border-slate-100">
                    <ClipboardList className="w-6 h-6 text-blue-500 mb-6" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Lançamentos</p>
                    <p className="text-3xl font-black text-slate-900 leading-none">{stats.totalEntries}</p>
                    <p className="text-[10px] text-slate-400 mt-4 font-bold uppercase tracking-widest italic">{stats.receitas} Rec / {stats.despesas} Desp</p>
                  </div>

                  <div className="bg-emerald-900 p-8 rounded-[40px] shadow-xl border border-emerald-800 text-white col-span-1 lg:col-span-2 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-700">
                      <DollarSign className="w-24 h-24" />
                    </div>
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">Volume Financeiro (Receitas)</p>
                    <p className="text-4xl font-black tracking-tighter">R$ {stats.totalReceitaAmount.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</p>
                    <p className="text-[10px] text-emerald-400/60 mt-6 font-bold uppercase tracking-widest italic flex items-center gap-2 text-glow">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 
                      {stats.linkedReceitas} pagamentos vinculados a prontuários
                    </p>
                  </div>

                  <div className="bg-amber-400 p-8 rounded-[40px] shadow-lg shadow-amber-400/20 border border-amber-300 text-amber-900 font-sans">
                    <AlertTriangle className="w-6 h-6 text-amber-900 mb-6" />
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-60 mb-2">Pendências de Vínculo</p>
                    <p className="text-3xl font-black leading-none">{stats.unlinkedReceitas}</p>
                    <p className="text-[10px] mt-4 font-black uppercase tracking-widest flex items-center gap-1.5 underline decoration-2 underline-offset-4">
                      Requerem Revisão
                    </p>
                  </div>
                </div>

                {/* Primary Action Zone */}
                <div className="bg-slate-900 p-12 rounded-[50px] shadow-2xl shadow-slate-900/40 relative overflow-hidden flex flex-col items-center text-center">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500" />
                  
                  <h3 className="text-2xl font-black text-white tracking-tight mb-4">Confirmar Sincronização em Lote</h3>
                  <p className="text-slate-400 font-medium max-w-xl mb-10 text-sm">
                    Recomendamos executar uma <span className="text-teal-400 font-black uppercase">amostra teste</span> primeiro para validar o comportamento dos IDs e vínculos de pacientes reais.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl">
                    <button 
                      onClick={() => executeImport('test')}
                      className="flex-1 px-8 py-5 bg-white/10 hover:bg-white/20 text-white rounded-[32px] font-black text-xs uppercase tracking-widest transition-all backdrop-blur-md border border-white/10 flex items-center justify-center gap-3 active:scale-95"
                    >
                      <Search className="w-5 h-5 text-teal-400" />
                      Testar Amostra (10p/20f)
                    </button>
                    <button 
                      onClick={() => executeImport('all')}
                      disabled={isProcessing || hasGraveDivergence}
                      className="flex-[2] px-10 py-5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-[32px] font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-emerald-500/40 transition-all flex items-center justify-center gap-3 disabled:opacity-30 disabled:grayscale disabled:scale-100 hover:scale-[1.02] active:scale-95"
                    >
                      <Zap className="w-5 h-5 fill-current" />
                      GRAVAR TUDO NA PRODUÇÃO
                    </button>
                  </div>

                  {hasGraveDivergence && (
                    <p className="mt-8 text-rose-400 text-[10px] font-black uppercase tracking-widest animate-bounce">
                      Importação bloqueada devido a divergência com IMPORT_AUDIT
                    </p>
                  )}
                </div>

                {/* Detailed Table Previews */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                   {/* Review Section */}
                   <div className="bg-white rounded-[50px] border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                      <div className="px-10 py-8 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                         <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shadow-sm">
                               <AlertCircle className="w-5 h-5" />
                            </div>
                            <div>
                               <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-800 leading-none mb-1">Audit: Receitas Sem Vínculo</h3>
                               <p className="text-[9px] text-slate-400 font-bold">Lançamentos encaminhados para a aba REVIEW</p>
                            </div>
                         </div>
                         <span className="px-4 py-1 bg-white border border-slate-200 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest">{reviewData?.receitas_sem_vinculo?.length || 0} intens</span>
                      </div>
                      <div className="h-[400px] overflow-y-auto px-10 pb-10">
                         <table className="w-full text-left">
                            <thead className="bg-white sticky top-0 z-10">
                               <tr>
                                  <th className="py-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Lançamento</th>
                                  <th className="py-5 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Valor Capturado</th>
                               </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                               {(reviewData?.receitas_sem_vinculo?.slice(0, 20) || []).map((r: any, i: number) => (
                                 <tr key={i} className="group hover:bg-slate-50 transition-colors">
                                    <td className="py-5 pr-4">
                                       <div className="flex items-center gap-3">
                                          <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                                          <div>
                                             <p className="text-xs font-black text-slate-900 group-hover:text-teal-700 transition-colors truncate max-w-[240px]">{r.description || r.descricao}</p>
                                             <p className="text-[9px] text-slate-400 font-bold mt-1 uppercase tracking-tight italic">{r.date || '---'}</p>
                                          </div>
                                       </div>
                                    </td>
                                    <td className="py-5 text-right">
                                       <p className="text-xs font-black text-slate-900 tabular-nums font-mono tracking-tight">R$ {parseCurrency(r.amount || r.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                    </td>
                                 </tr>
                               ))}
                            </tbody>
                         </table>
                         {(!reviewData?.receitas_sem_vinculo || reviewData.receitas_sem_vinculo.length === 0) && (
                           <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                              <CheckCircle2 className="w-12 h-12 mb-4 opacity-10" />
                              <p className="text-xs font-black uppercase tracking-widest">Nenhuma receita órfã detectada</p>
                           </div>
                         )}
                      </div>
                   </div>

                   {/* Suspect Section */}
                   <div className="bg-white rounded-[50px] border border-slate-200 overflow-hidden shadow-sm flex flex-col">
                      <div className="px-10 py-8 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                         <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shadow-sm">
                               <Search className="w-5 h-5" />
                            </div>
                            <div>
                               <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-800 leading-none mb-1">Audit: Pacientes Suspeitos</h3>
                               <p className="text-[9px] text-slate-400 font-bold">Identificados por nome genérico ou inconsistente</p>
                            </div>
                         </div>
                         <span className="px-4 py-1 bg-white border border-slate-200 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest">{reviewData?.suspects?.length || 0} alertas</span>
                      </div>
                      <div className="h-[400px] overflow-y-auto px-10 pb-10 flex flex-col">
                         { (reviewData?.suspects?.length > 0) ? (
                            <table className="w-full text-left">
                               <thead className="bg-white sticky top-0 z-10">
                                  <tr>
                                     <th className="py-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Candidato</th>
                                     <th className="py-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Motivo do Alerta</th>
                                  </tr>
                               </thead>
                               <tbody className="divide-y divide-slate-50">
                                  {reviewData.suspects.slice(0, 20).map((s: any, i: number) => (
                                    <tr key={i} className="group hover:bg-slate-50 transition-colors">
                                       <td className="py-5 pr-4">
                                          <p className="text-xs font-black text-slate-900 leading-none mb-1">{s.name}</p>
                                          <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest">ID no Excel: {s.patient_id || '---'}</p>
                                       </td>
                                       <td className="py-5">
                                          <span className="px-3 py-1 bg-rose-50 text-rose-600 rounded-lg text-[9px] font-black uppercase tracking-widest border border-rose-100 italic">
                                            {s.reason || 'Divergência Crítica'}
                                          </span>
                                       </td>
                                    </tr>
                                  ))}
                               </tbody>
                            </table>
                         ) : (
                           <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                              <UserCheck className="w-12 h-12 mb-4 opacity-10" />
                              <p className="text-xs font-black uppercase tracking-widest">Todos os pacientes parecem reais</p>
                           </div>
                         )}
                      </div>
                   </div>
                </div>
              </motion.div>
            )}

            {step === 'importing' && (
              <motion.div 
                key="importing"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center pt-10"
              >
                <div className="w-full max-w-2xl bg-white p-20 rounded-[60px] shadow-2xl shadow-slate-200/50 border border-slate-100 text-center relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-2 bg-slate-100" />
                  <div 
                    className="absolute top-0 left-0 h-2 bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-300"
                    style={{ width: `${(importProgress.count / (importProgress.total || 1)) * 100}%` }}
                  />

                  <div className="relative w-40 h-40 mx-auto mb-12">
                    <div className="absolute inset-0 rounded-[50px] border-8 border-slate-50" />
                    <div className="absolute inset-0 rounded-[50px] border-t-8 border-teal-500 animate-[spin_1.5s_linear_infinite]" />
                    <div className="absolute inset-0 flex items-center justify-center bg-white rounded-[45px] m-1 shadow-inner">
                      <Database className="w-12 h-12 text-teal-600 animate-pulse" />
                    </div>
                  </div>

                  <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-4">Sincronização em Lote</h2>
                  <p className="text-sm text-slate-400 font-bold uppercase tracking-[0.3em] mb-12">
                    Processando Bloco: {importProgress.type}
                  </p>

                  <div className="p-8 bg-slate-50 rounded-[40px] border border-slate-100 space-y-8">
                    <div className="flex justify-between items-end">
                      <div className="text-left">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-teal-500" />
                            Progresso Atual
                         </p>
                         <p className="text-3xl font-black text-slate-900 tabular-nums">
                            {importProgress.count} <span className="text-base text-slate-400">/ {importProgress.total}</span>
                         </p>
                      </div>
                      <div className="text-right">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Média Est.</p>
                         <p className="text-xs font-black text-teal-600 uppercase">400 docs/batch</p>
                      </div>
                    </div>
                    
                    <div className="h-4 bg-white rounded-full overflow-hidden p-1 shadow-inner border border-slate-100">
                      <div 
                        className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(20,184,166,0.3)]"
                        style={{ width: `${(importProgress.count / (importProgress.total || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 'success' && (
              <motion.div 
                key="success"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center pt-10 pb-20"
              >
                <div className="w-full max-w-5xl bg-white p-16 rounded-[70px] shadow-2xl shadow-emerald-200/40 border border-emerald-100 text-center relative overflow-hidden">
                  <div className="absolute -top-20 -right-20 p-20 opacity-5 rotate-12">
                    <CheckCircle2 className="w-96 h-96 text-emerald-600" />
                  </div>

                  <div className="w-32 h-32 bg-emerald-50 text-emerald-600 rounded-[45px] flex items-center justify-center mx-auto mb-10 shadow-inner group hover:scale-110 transition-transform duration-500 ring-8 ring-emerald-50/50">
                    <CheckCircle2 className="w-16 h-16" />
                  </div>

                  <h2 className="text-4xl font-black text-slate-900 tracking-tighter mb-4 italic">Sucesso Absoluto!</h2>
                  <p className="text-sm text-slate-500 font-medium mb-12 max-w-lg mx-auto leading-relaxed">
                    A estrutura de dados da clinica <span className="font-black text-slate-900 uppercase">{clinic?.name}</span> foi recalibrada com os dados do arquivo unificado V2.
                  </p>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-16 relative z-10">
                    <div className="bg-slate-50/80 backdrop-blur-sm p-8 rounded-[40px] border border-white shadow-sm hover:translate-y-[-4px] transition-transform">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Pacientes</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">{stats.totalPatients}</p>
                    </div>
                    <div className="bg-slate-50/80 backdrop-blur-sm p-8 rounded-[40px] border border-white shadow-sm hover:translate-y-[-4px] transition-transform">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Movimentações</p>
                      <p className="text-4xl font-black text-slate-900 tracking-tighter">{stats.totalEntries}</p>
                    </div>
                    <div className="bg-slate-50/80 backdrop-blur-sm p-8 rounded-[40px] border border-white shadow-sm hover:translate-y-[-4px] transition-transform">
                      <p className="text-[10px] font-black text-rose-400 uppercase tracking-[0.2em] mb-3">Em Revisão</p>
                      <p className="text-4xl font-black text-rose-600 tracking-tighter">{stats.unlinkedReceitas}</p>
                    </div>
                    <div className="bg-slate-900 p-8 rounded-[40px] border border-slate-800 shadow-xl shadow-slate-900/20 hover:translate-y-[-4px] transition-transform text-white">
                      <p className="text-[10px] font-black text-teal-400 uppercase tracking-[0.2em] mb-3">Captado</p>
                      <p className="text-3xl font-black tracking-tighter tabular-nums text-glow">R$ {stats.totalReceitaAmount.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-6 justify-center relative z-10">
                    <button 
                      onClick={reset}
                      className="px-12 py-6 bg-slate-100 text-slate-900 rounded-[30px] font-black text-xs uppercase tracking-[0.2em] hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"
                    >
                      Nova Importação
                    </button>
                    <button 
                      onClick={() => window.location.reload()}
                      className="px-12 py-6 bg-slate-900 text-white rounded-[30px] font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-slate-900/40 hover:scale-[1.05] active:scale-95 transition-all flex items-center gap-3 justify-center group"
                    >
                      Visualizar Radar
                      <ChevronRight className="w-5 h-5 text-teal-400 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  );

}

function parseCurrency(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return parseFloat(String(value).replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0;
}
