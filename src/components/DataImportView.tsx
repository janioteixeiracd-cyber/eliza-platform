import React, { useState } from 'react';
import { 
  Upload, 
  FileText, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight,
  Database,
  Loader2,
  Table as TableIcon,
  X,
  FileSpreadsheet
} from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { collection, addDoc, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';

type ImportType = 'patients' | 'financial';

interface ColumnMapping {
  csvField: string;
  targetField: string;
}

export default function DataImportView() {
  const { clinic } = useAuth();
  const [activeTab, setActiveTab] = useState<ImportType>('patients');
  const [isUploading, setIsUploading] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawData, setRawData] = useState<any[]>([]);

  const patientFields = [
    { key: 'name', label: 'Nome Completo', required: true },
    { key: 'email', label: 'E-mail', required: false },
    { key: 'phone', label: 'Telefone/WhatsApp', required: false },
    { key: 'document', label: 'CPF', required: false },
    { key: 'birthDate', label: 'Data de Nascimento', required: false },
    { key: 'gender', label: 'Gênero', required: false },
  ];

  const financialFields = [
    { key: 'description', label: 'Descrição/Título', required: true },
    { key: 'amount', label: 'Valor (R$)', required: true },
    { key: 'date', label: 'Data de Pagamento', required: false },
    { key: 'dueDate', label: 'Data de Vencimento', required: false },
    { key: 'type', label: 'Tipo (Receita/Despesa)', required: true },
    { key: 'category', label: 'Categoria', required: false },
    { key: 'status', label: 'Status (Pago/Pendente)', required: false },
    { key: 'paymentMethod', label: 'Forma de Pagamento', required: false },
    { key: 'account', label: 'Caixa/Conta', required: false },
  ];

  const currentFields = activeTab === 'patients' ? patientFields : financialFields;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setRawData(results.data);
          processRawData(results.data, results.meta.fields || []);
        }
      });
    } else if (extension === 'xlsx' || extension === 'xls') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (data.length > 0) {
          const headers = data[0] as string[];
          const rows = data.slice(1).map(row => {
            const obj: any = {};
            (row as any[]).forEach((val, idx) => {
              if (headers[idx]) obj[headers[idx]] = val;
            });
            return obj;
          });
          setRawData(rows);
          processRawData(rows, headers);
        }
      };
      reader.readAsBinaryString(file);
    }
  };

  const processRawData = (data: any[], csvHeaders: string[]) => {
    setPreviewData(data.slice(0, 10));
    setHeaders(csvHeaders);
    
    // Auto-match fields
    const initialMappings: Record<string, string> = {};
    
    currentFields.forEach(field => {
      const match = csvHeaders.find(h => 
        (h || '').toLowerCase().includes((field.label || '').toLowerCase()) || 
        (h || '').toLowerCase().includes((field.key || '').toLowerCase())
      );
      if (match) initialMappings[field.key] = match;
    });
    
    setMappings(initialMappings);
  };

  const handleImport = async () => {
    if (!clinic || rawData.length === 0) return;

    setIsUploading(true);
    setImportProgress(0);

    const total = rawData.length;
    const batchSize = 100;
    let processed = 0;
    const collPath = activeTab === 'patients' 
      ? `clinics/${clinic.id}/patients` 
      : `clinics/${clinic.id}/transactions`;

    try {
      for (let i = 0; i < rawData.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = rawData.slice(i, i + batchSize);

        chunk.forEach((row: any) => {
          const cleanedData: any = {
            clinicId: clinic.id,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            importSource: 'external_system',
            importDate: new Date().toISOString()
          };

          let rawAmount: number | null = null;
          let detectedType: 'income' | 'expense' | null = null;

          currentFields.forEach(field => {
            const csvHeader = mappings[field.key];
            if (csvHeader && row[csvHeader] !== undefined) {
              let value = row[csvHeader];
              
              if (field.key === 'amount' && (typeof value === 'string' || typeof value === 'number')) {
                if (typeof value === 'string') {
                  const cleanValue = value.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
                  rawAmount = parseFloat(cleanValue);
                } else {
                  rawAmount = value;
                }

                if (rawAmount !== null && !isNaN(rawAmount)) {
                  // If it has a minus sign, it's an expense
                  if (rawAmount < 0) {
                    detectedType = 'expense';
                  } else if (rawAmount > 0) {
                    detectedType = 'income';
                  }
                  value = Math.abs(rawAmount);
                }
              }

              if (field.key === 'date' && value) {
                // Generate competence_month (YYYY-MM)
                try {
                  const dateStr = String(value);
                  const parsedDate = new Date(dateStr);
                  if (!isNaN(parsedDate.getTime())) {
                    cleanedData.competence_month = `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}`;
                  }
                } catch (e) {
                  console.warn("Could not parse date for competence_month:", value);
                }
              }

              if (field.key === 'type' && value && typeof value === 'string' && !detectedType) {
                const val = (value || '').toLowerCase();
                if (val.includes('receita') || val.includes('income') || val.includes('entrada')) detectedType = 'income';
                if (val.includes('despesa') || val.includes('expense') || val.includes('saída') || val.includes('saida')) detectedType = 'expense';
              }

              if (field.key === 'status' && value && typeof value === 'string') {
                const val = (value || '').toLowerCase();
                if (val.includes('pago') || val.includes('paid') || val.includes('recebido')) value = 'paid';
                if (val.includes('pendente') || val.includes('pending')) value = 'pending';
              }
              
              cleanedData[field.key] = value;
            }
          });

          // Skip if amount is 0 or invalid
          if (rawAmount === 0 || rawAmount === null || isNaN(rawAmount)) return;

          // Apply smart categorization for expenses
          if (detectedType === 'expense') {
            cleanedData.type = 'expense';
            // User request: "a descricao é como se fosse a categoria dessa dispesa"
            if (!cleanedData.category || cleanedData.category === 'Geral') {
              cleanedData.category = cleanedData.description;
            }
          } else {
            cleanedData.type = 'income';
          }

          // Ensure basic defaults
          if (activeTab === 'patients') {
            if (!cleanedData.status) cleanedData.status = 'active';
          } else {
            if (!cleanedData.status) cleanedData.status = 'paid';
            if (!cleanedData.category) cleanedData.category = 'Geral';
          }

          const collPath = activeTab === 'patients' 
            ? `clinics/${clinic.id}/patients` 
            : `clinics/${clinic.id}/transactions`;
          
          const docRef = doc(collection(db, collPath));
          batch.set(docRef, cleanedData);
        });

        await batch.commit();
        processed += chunk.length;
        setImportProgress(Math.round((processed / total) * 100));
      }

      alert('Importação concluída com sucesso!');
      setPreviewData([]);
      setRawData([]);
      setFileName(null);
      setMappings({});
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, collPath);
      alert('Erro ao importar dados. Verifique sua conexão e tente novamente.');
    } finally {
      setIsUploading(false);
      setImportProgress(0);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden font-sans">
      <header className="px-8 py-6 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Database className="w-5 h-5 text-teal-600" />
              Importar Dados do Sistema Anterior
            </h2>
            <p className="text-xs text-slate-500 font-medium">Traga seus pacientes e registros financeiros para o ELIZA de forma rápida.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-5xl mx-auto space-y-8">
          {/* Progress Overlay */}
          <AnimatePresence>
            {isUploading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md"
              >
                <div className="bg-white p-12 rounded-[3rem] shadow-2xl text-center space-y-6 max-w-md w-full mx-4">
                  <div className="relative w-24 h-24 mx-auto">
                    <svg className="w-full h-full" viewBox="0 0 100 100">
                      <circle className="text-slate-100 stroke-current" strokeWidth="8" fill="transparent" r="40" cx="50" cy="50" />
                      <circle 
                        className="text-teal-600 stroke-current transition-all duration-500" 
                        strokeWidth="8" 
                        strokeLinecap="round" 
                        fill="transparent" 
                        r="40" 
                        cx="50" 
                        cy="50" 
                        style={{ strokeDasharray: 251.2, strokeDashoffset: 251.2 * (1 - importProgress / 100) }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-xl font-black text-slate-900">
                      {importProgress}%
                    </div>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Importando Registros</h3>
                    <p className="text-xs text-slate-400 font-medium mt-2">Por favor, não feche esta janela enquanto processamos seus dados.</p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-bold text-teal-600 uppercase tracking-widest justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sincronizando com a Nuvem
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Config */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-6">
                <div className="flex p-1 bg-slate-100 rounded-2xl">
                  <button 
                    onClick={() => { setActiveTab('patients'); setPreviewData([]); setFileName(null); }}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'patients' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                  >
                    <FileText className="w-4 h-4" /> Pacientes
                  </button>
                  <button 
                    onClick={() => { setActiveTab('financial'); setPreviewData([]); setFileName(null); }}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'financial' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                  >
                    <DollarSign className="w-4 h-4" /> Financeiro
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-8 border-2 border-dashed border-slate-200 rounded-[2rem] text-center hover:border-teal-400 hover:bg-teal-50/30 transition-all cursor-pointer relative group">
                    <input 
                      type="file" 
                      id="file-upload"
                      accept=".csv,.xlsx,.xls"
                      onChange={handleFileUpload}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <Upload className="w-10 h-10 text-slate-300 group-hover:text-teal-500 mx-auto mb-3 transition-colors" />
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">
                      {fileName || 'Selecionar Arquivo CSV ou Excel'}
                    </p>
                    <p className="text-[9px] text-slate-400 font-medium mt-1">UTF-8 ou ISO-8859-1 suportados</p>
                  </div>
                </div>

                {previewData.length > 0 && (
                  <div className="space-y-4 pt-4 border-t border-slate-100">
                    <h4 className="text-[10px] font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                       Mapeamento de Colunas
                    </h4>
                    <div className="space-y-3">
                      {currentFields.map(field => (
                        <div key={field.key} className="space-y-1">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              {field.label} {field.required && <span className="text-rose-500">*</span>}
                            </label>
                            {mappings[field.key] && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                          </div>
                          <select 
                            value={mappings[field.key] || ''}
                            onChange={(e) => setMappings({...mappings, [field.key]: e.target.value})}
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600"
                          >
                            <option value="">Ignorar esta coluna</option>
                            {headers.map((h, idx) => (
                              <option key={`${h}-${idx}`} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {previewData.length > 0 && (
                <button 
                  onClick={handleImport}
                  className="w-full bg-slate-900 text-white py-4 rounded-[1.5rem] text-xs font-black uppercase tracking-[0.2em] shadow-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-3"
                >
                  <ArrowRight className="w-4 h-4" /> Confirmar e Importar
                </button>
              )}
            </div>

            {/* Right Column: Preview */}
            <div className="lg:col-span-8">
              {previewData.length > 0 ? (
                <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden h-full flex flex-col">
                  <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <TableIcon className="w-4 h-4 text-slate-400" />
                       <h3 className="text-xs font-bold text-slate-900 uppercase tracking-widest">Pré-visualização dos Dados</h3>
                     </div>
                     <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase">Top 5 Linhas</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          {headers.map((h, idx) => (
                            <th key={`${h}-${idx}`} className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            {headers.map((h, idx) => (
                              <td key={`${h}-${idx}`} className="px-6 py-4 text-xs font-medium text-slate-500 border-b border-slate-50 whitespace-nowrap">{row[h]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-8 bg-amber-50 border-t border-amber-100 flex gap-4">
                     <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                     <div>
                        <p className="text-xs font-bold text-amber-900 uppercase tracking-tight">Dica de Importação</p>
                        <p className="text-[10px] text-amber-700 font-medium leading-relaxed mt-1">
                          Certifique-se de que as colunas obrigatórias estão mapeadas corretamente. Se o seu arquivo tiver muitos dados, a importação pode levar alguns minutos.
                        </p>
                     </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Upload className="w-8 h-8 text-slate-200" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Aguardando Arquivo</h3>
                  <p className="text-xs text-slate-400 font-medium max-w-xs mt-2 mx-auto">
                    Faça o upload do seu arquivo de pacientes ou financeiro em formato CSV para iniciar o processo de mapeamento.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
