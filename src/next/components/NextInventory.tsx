import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Package, Search, Plus, AlertTriangle, TrendingDown, Boxes, Tag, X, Sparkles,
  Upload, Camera, Loader2, CheckCircle2, Trash2, PlusCircle, Info, History, ChevronDown
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNextReadOnly } from '../context/NextReadOnlyContext';
import { secureGetDocs } from '../services/next-db';
import { collection, query, limit, addDoc, updateDoc, doc as fsDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getGenAI } from '../../lib/gemini';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  expiry: string;
  status: 'ok' | 'warning' | 'critical';
}

interface MovementRow {
  id: string;
  itemName: string;
  type: string;
  quantity: number;
  unit: string;
  previousQuantity: number;
  newQuantity: number;
  supplierName?: string;
  notes?: string;
  createdAt?: any;
}

interface ExtractedItem {
  rawName: string;
  suggestedName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  batch: string;
  expirationDate: string;
  category: string;
  matchedProductId: string;
  matchStatus: 'Encontrado no estoque' | 'Possível correspondência' | 'Novo item';
}

interface DocFile { id: string; name: string; mimeType: string; dataUrl: string; }

const CATEGORY_OPTIONS = ['Consumíveis', 'Descartáveis', 'Anestésicos', 'Implantes', 'Estética/Injetáveis', 'Ortodontia', 'Cirurgia', 'Equipamentos', 'Escritório', 'Outros'];

function statusOf(stock: number, minStock: number): 'ok' | 'warning' | 'critical' {
  if (stock <= minStock / 2) return 'critical';
  if (stock <= minStock) return 'warning';
  return 'ok';
}

function statusMeta(status: 'ok' | 'warning' | 'critical') {
  if (status === 'critical') return { bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400', label: 'CRÍTICO' };
  if (status === 'warning') return { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', label: 'ABAIXO DO MÍNIMO' };
  return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', label: 'OK' };
}

function blankExtractedItem(): ExtractedItem {
  return {
    rawName: '', suggestedName: 'Novo Material', quantity: 1, unit: 'unid', unitPrice: 0, totalPrice: 0,
    batch: '', expirationDate: '', category: 'Consumíveis', matchedProductId: '', matchStatus: 'Novo item',
  };
}

export default function NextInventory() {
  const { clinic } = useAuth();
  const { addAuditLog } = useNextReadOnly();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'list' | 'entry'>('list');
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', category: 'Consumíveis', stock: 0, minStock: 0, unit: 'unid', expiry: '' });
  const [savingItem, setSavingItem] = useState(false);

  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);

  const loadData = async () => {
    if (!clinic?.id) return;
    setLoading(true);
    try {
      const invSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'inventory'), limit(300)), 'inventory', { addAuditLog });
      const list: InventoryItem[] = invSnap.docs.map(d => {
        const data: any = d.data();
        const stock = Number(data.stock) || 0;
        const minStock = Number(data.minStock) || 0;
        return { id: d.id, name: data.name || 'Item sem nome', category: data.category || 'Outros', stock, minStock, unit: data.unit || 'unid', expiry: data.expiry || '', status: statusOf(stock, minStock) };
      });
      setItems(list);

      const movSnap = await secureGetDocs(query(collection(db, 'clinics', clinic.id, 'inventory_movements'), limit(30)), 'inventory_movements', { addAuditLog });
      const movs: MovementRow[] = movSnap.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id, itemName: data.itemName || list.find(i => i.id === data.itemId)?.name || 'Item removido',
          type: data.type || 'entrada', quantity: Number(data.quantity) || 0, unit: data.unit || 'unid',
          previousQuantity: Number(data.previousQuantity) || 0, newQuantity: Number(data.newQuantity) || 0,
          supplierName: data.supplierName, notes: data.notes, createdAt: data.createdAt,
        };
      });
      movs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setMovements(movs);

      addAuditLog({ collection: 'inventory', action: 'QUERY', status: 'SUCCESS', details: `Estoque carregou ${list.length} itens reais e ${movs.length} movimentações recentes desta clínica.` });
    } catch (err) {
      console.error('Failed to load real inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clinic?.id]);

  const showMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(null), 4500); };

  const criticalCount = items.filter(i => i.status === 'critical').length;
  const warningCount = items.filter(i => i.status === 'warning').length;

  const filteredItems = items.filter(item => {
    const matchesFilter = filter === 'all' || item.status === filter;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // ---- REAL WRITES: manual item creation, stock adjustment, and the AI
  // smart-entry confirmation all write directly to this clinic's real
  // `inventory` / `inventory_movements` collections — by explicit product
  // decision, same as Agenda/Prontuário/Financeiro. Every write is logged.

  const handleAddItem = async () => {
    if (!clinic?.id || !newItem.name.trim()) return;
    setSavingItem(true);
    try {
      const payload = { name: newItem.name.trim(), category: newItem.category, stock: Number(newItem.stock) || 0, minStock: Number(newItem.minStock) || 0, unit: newItem.unit.trim() || 'unid', expiry: newItem.expiry, createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db, 'clinics', clinic.id, 'inventory'), payload);
      setItems(prev => [...prev, { id: ref.id, ...payload, status: statusOf(payload.stock, payload.minStock) } as InventoryItem]);
      addAuditLog({ collection: 'inventory', action: 'WRITE', status: 'SUCCESS', details: `Item "${payload.name}" cadastrado manualmente no estoque real (escrita real no Firestore).` });
      setIsAddOpen(false);
      setNewItem({ name: '', category: 'Consumíveis', stock: 0, minStock: 0, unit: 'unid', expiry: '' });
      showMessage(`"${payload.name}" adicionado ao estoque real.`);
    } catch (err: any) {
      console.error('Failed to add inventory item:', err);
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingItem(false);
    }
  };

  const openAdjust = (item: InventoryItem) => { setAdjustingId(item.id); setAdjustValue(String(item.stock)); };

  const handleSaveAdjust = async (item: InventoryItem) => {
    if (!clinic?.id) return;
    const newVal = Number(adjustValue);
    if (isNaN(newVal) || newVal < 0) return;
    setSavingAdjust(true);
    try {
      await updateDoc(fsDoc(db, 'clinics', clinic.id, 'inventory', item.id), { stock: newVal, updatedAt: serverTimestamp() });
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, stock: newVal, status: statusOf(newVal, i.minStock) } : i));
      const movRef = await addDoc(collection(db, 'clinics', clinic.id, 'inventory_movements'), {
        itemId: item.id, itemName: item.name, type: 'ajuste', quantity: newVal - item.stock, unit: item.unit,
        previousQuantity: item.stock, newQuantity: newVal, createdAt: serverTimestamp(), notes: 'Ajuste manual de estoque',
      });
      setMovements(prev => [{ id: movRef.id, itemName: item.name, type: 'ajuste', quantity: newVal - item.stock, unit: item.unit, previousQuantity: item.stock, newQuantity: newVal, createdAt: { seconds: Date.now() / 1000 } }, ...prev]);
      addAuditLog({ collection: 'inventory', action: 'WRITE', status: 'SUCCESS', details: `Estoque de "${item.name}" ajustado de ${item.stock} para ${newVal} ${item.unit} (escrita real).` });
      showMessage(`Estoque de "${item.name}" atualizado para ${newVal} ${item.unit}.`);
      setAdjustingId(null);
    } catch (err: any) {
      console.error('Failed to adjust stock:', err);
      showMessage(`Falha ao gravar: ${err?.message || err}`);
    } finally {
      setSavingAdjust(false);
    }
  };

  // ---- SMART ENTRY (AI) -------------------------------------------------

  const [step, setStep] = useState<'upload' | 'processing' | 'review' | 'success'>('upload');
  const [source, setSource] = useState<'invoice' | 'quote' | 'purchase_list'>('invoice');
  const [docFile, setDocFile] = useState<DocFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const [supplierName, setSupplierName] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [reviewItems, setReviewItems] = useState<ExtractedItem[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const totalAmount = useMemo(() => reviewItems.reduce((sum, it) => sum + (it.totalPrice || 0), 0), [reviewItems]);

  const resetEntry = () => {
    setStep('upload'); setDocFile(null); setAiError(null); setSupplierName(''); setDocumentDate(''); setInvoiceNumber(''); setReviewItems([]);
  };

  const processFile = (file: File) => {
    if (!clinic?.id) return;
    if (file.size > 4_000_000) { showMessage('Arquivo grande demais — use uma foto/PDF menor que 4MB.'); return; }
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setDocFile({ id: `doc-${Date.now()}`, name: file.name, mimeType: file.type || 'image/jpeg', dataUrl });
      setStep('processing');
      setAiError(null);
      setLoadingMsg('A Eliza está lendo o documento e identificando os itens...');

      try {
        const currentInventoryText = items.map(i => `ID: ${i.id} | Nome: ${i.name} | Categoria: ${i.category} | Unidade: ${i.unit}`).join('\n') || 'Estoque vazio no momento.';
        const sourceLabel = source === 'invoice' ? 'nota fiscal' : source === 'quote' ? 'orçamento' : 'lista de compras';

        const prompt = `Você é a Eliza, assistente de estoque de uma clínica odontológica/estética. Leia a imagem/documento anexado, que é um(a) ${sourceLabel}, e extraia os itens de materiais clínicos, odontológicos ou estéticos presentes nele.

Você entende terminologia clínica: ácido hialurônico, toxina botulínica, implantes, anestésicos/anestesia (ex: lidocaína, articaína), resinas, luvas, sugadores, fios de sutura, brocas, agulhas, entre outros materiais odontológicos e de estética injetável.

Itens já cadastrados no estoque desta clínica (para você tentar casar com o que já existe):
=== ESTOQUE ATUAL ===
${currentInventoryText}
=== FIM DO ESTOQUE ATUAL ===

Extraia:
1. Nome do fornecedor (supplierName), data do documento (documentDate em AAAA-MM-DD ou ""), número do documento (invoiceNumber ou "").
2. Todos os itens/materiais visíveis. Para cada um: nome original lido (rawName), nome sugerido limpo (suggestedName), quantidade (quantity, número), unidade (unit), preço unitário (unitPrice, número), preço total (totalPrice, número — calcule se não estiver explícito), lote (batch ou ""), validade (expirationDate em AAAA-MM-DD ou ""), categoria (category — uma de: ${CATEGORY_OPTIONS.join(', ')}).
3. Para cada item, compare com o estoque atual acima: se corresponder a um item existente (mesmo com nome levemente diferente), preencha "matchedProductId" com o ID exato dele e "matchStatus" como "Encontrado no estoque" (correspondência clara) ou "Possível correspondência" (correspondência incerta). Se for um item novo, "matchedProductId" deve ser "" e "matchStatus" deve ser "Novo item".

Não invente valores que não estejam legíveis — nesse caso, deixe o campo vazio ou 0 e mantenha o nome indicando que precisa revisão.

Responda ESTRITAMENTE em JSON válido, sem markdown, exatamente neste formato:
{"supplierName":"","documentDate":"","invoiceNumber":"","items":[{"rawName":"","suggestedName":"","quantity":0,"unit":"","unitPrice":0,"totalPrice":0,"batch":"","expirationDate":"","category":"","matchedProductId":"","matchStatus":"Novo item"}]}`;

        const base64Data = dataUrl.split(',')[1] || '';
        const ai = getGenAI();
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: file.type || 'image/jpeg', data: base64Data } }] }],
          taskType: 'inventory_document_extraction',
          clinicId: clinic.id,
        });

        const rawText: string = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('A Eliza respondeu, mas não em formato reconhecível. Tente uma foto mais nítida ou insira manualmente.');
        const parsed = JSON.parse(jsonMatch[0]);

        const extracted: ExtractedItem[] = Array.isArray(parsed.items) ? parsed.items.map((it: any) => ({
          rawName: String(it?.rawName || ''),
          suggestedName: String(it?.suggestedName || it?.rawName || 'Item sem nome'),
          quantity: Number(it?.quantity) || 1,
          unit: String(it?.unit || 'unid'),
          unitPrice: Number(it?.unitPrice) || 0,
          totalPrice: Number(it?.totalPrice) || (Number(it?.quantity) || 1) * (Number(it?.unitPrice) || 0),
          batch: String(it?.batch || ''),
          expirationDate: /^\d{4}-\d{2}-\d{2}$/.test(it?.expirationDate) ? it.expirationDate : '',
          category: CATEGORY_OPTIONS.includes(it?.category) ? it.category : 'Consumíveis',
          matchedProductId: items.some(i => i.id === it?.matchedProductId) ? it.matchedProductId : '',
          matchStatus: items.some(i => i.id === it?.matchedProductId) ? (it?.matchStatus === 'Encontrado no estoque' ? 'Encontrado no estoque' : 'Possível correspondência') : 'Novo item',
        })) : [];

        setSupplierName(String(parsed.supplierName || ''));
        setDocumentDate(/^\d{4}-\d{2}-\d{2}$/.test(parsed.documentDate) ? parsed.documentDate : '');
        setInvoiceNumber(String(parsed.invoiceNumber || ''));
        setReviewItems(extracted);

        addAuditLog({ collection: 'inventory', action: 'READ', status: 'SUCCESS', details: `Eliza leu 1 ${sourceLabel} e sugeriu ${extracted.length} item(ns) — aguardando confirmação do gestor antes de gravar.` });
        setStep('review');
      } catch (err: any) {
        console.error('Failed to analyze inventory document:', err);
        setAiError(err?.message || 'Falha ao consultar a Eliza AI.');
        setStep('upload');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.[0]) processFile(e.target.files[0]); e.target.value = ''; };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]); };

  const handleManualInsert = () => {
    setSupplierName(''); setDocumentDate(''); setInvoiceNumber('');
    setReviewItems([blankExtractedItem()]);
    setStep('review');
  };

  const updateReviewItem = (index: number, field: keyof ExtractedItem, value: any) => {
    setReviewItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value } as ExtractedItem;
      if (field === 'quantity' || field === 'unitPrice') {
        updated[index].totalPrice = Number((Number(updated[index].quantity) * Number(updated[index].unitPrice)).toFixed(2));
      }
      if (field === 'matchedProductId') {
        const match = items.find(i => i.id === value);
        if (match) {
          updated[index].matchStatus = 'Encontrado no estoque';
          updated[index].suggestedName = match.name;
          updated[index].category = match.category;
          updated[index].unit = match.unit;
        } else {
          updated[index].matchStatus = 'Novo item';
        }
      }
      return updated;
    });
  };

  const removeReviewItem = (index: number) => setReviewItems(prev => prev.filter((_, i) => i !== index));
  const addReviewRow = () => setReviewItems(prev => [...prev, blankExtractedItem()]);

  const handleConfirmEntry = async () => {
    if (!clinic?.id || reviewItems.length === 0) return;
    setSavingEntry(true);
    try {
      let created = 0;
      for (const item of reviewItems) {
        if (!item.suggestedName.trim()) continue;
        let finalItemId = item.matchedProductId;
        let prevQty = 0;
        let newQty = item.quantity;

        if (item.matchedProductId) {
          const existing = items.find(i => i.id === item.matchedProductId);
          if (existing) {
            prevQty = existing.stock;
            newQty = prevQty + Number(item.quantity);
            await updateDoc(fsDoc(db, 'clinics', clinic.id, 'inventory', existing.id), { stock: newQty, expiry: item.expirationDate || existing.expiry, updatedAt: serverTimestamp() });
          }
        } else {
          const newDocRef = await addDoc(collection(db, 'clinics', clinic.id, 'inventory'), {
            name: item.suggestedName.trim(), category: item.category || 'Consumíveis', stock: Number(item.quantity),
            minStock: Number(item.quantity) > 5 ? 5 : 2, unit: item.unit || 'unid', expiry: item.expirationDate || '', createdAt: serverTimestamp(),
          });
          finalItemId = newDocRef.id;
        }

        await addDoc(collection(db, 'clinics', clinic.id, 'inventory_movements'), {
          itemId: finalItemId, itemName: item.suggestedName.trim(), type: 'entrada', quantity: Number(item.quantity), unit: item.unit || 'unid',
          previousQuantity: prevQty, newQuantity: newQty, unitPrice: Number(item.unitPrice), totalPrice: Number(item.totalPrice),
          supplierName: supplierName || 'Não informado', sourceDocumentId: invoiceNumber || 'Não informado',
          createdAt: serverTimestamp(), notes: `Entrada Inteligente (Eliza AI)${item.batch ? ` | Lote: ${item.batch}` : ''}`,
        });
        created++;
      }

      addAuditLog({ collection: 'inventory', action: 'WRITE', status: 'SUCCESS', details: `Entrada confirmada pelo gestor: ${created} item(ns) gravados no estoque real (escrita real no Firestore, revisados antes de salvar).` });
      setSavedCount(created);
      setStep('success');
      await loadData();
    } catch (err: any) {
      console.error('Failed to confirm inventory entry:', err);
      setAiError(`Falha ao gravar: ${err?.message || err}`);
      setStep('review');
    } finally {
      setSavingEntry(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-16 space-y-6 font-sans">

      {/* HEADER */}
      <div className="relative overflow-hidden next-glass-panel rounded-next-2xl p-6">
        <div className="absolute top-0 right-0 w-80 h-80 bg-next-purple-neon/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative space-y-3 z-10">
          <div className="inline-flex items-center gap-2 bg-next-purple-neon/10 border border-next-purple-neon/20 px-3 py-1 rounded-full text-next-purple-light text-[10.5px] font-mono tracking-wider">
            <Boxes className="w-3.5 h-3.5 text-next-purple-neon" />
            <span>ESTOQUE</span>
          </div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight font-sans">Estoque Inteligente</h1>
          <p className="text-slate-400 text-xs md:text-sm max-w-2xl leading-relaxed">
            Itens reais desta clínica. Cadastre manualmente ou envie uma foto de nota fiscal, orçamento ou lista de compras — a Eliza lê e sugere os itens, mas nada é gravado sem sua confirmação.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setMode('list')} className={`px-3 py-2 rounded-lg text-[11px] font-bold ${mode === 'list' ? 'next-brand-gradient-bg text-white' : 'bg-slate-900/60 text-slate-400 border border-next-border'}`}>Itens em Estoque</button>
        <button onClick={() => { setMode('entry'); resetEntry(); }} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold ${mode === 'entry' ? 'next-brand-gradient-bg text-white' : 'bg-slate-900/60 text-slate-400 border border-next-border'}`}>
          <Sparkles className="w-3.5 h-3.5" /> Entrada Inteligente (IA)
        </button>
      </div>

      <AnimatePresence>
        {message && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-next-green-success/10 border border-next-green-success/20 rounded-next-xl p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-next-green-success flex-shrink-0" />
            <p className="text-[11px] font-bold text-slate-200">{message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2 next-glass-panel rounded-next-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-next-purple-neon" />
          <span className="text-xs font-mono">Carregando estoque real...</span>
        </div>
      ) : mode === 'list' ? (
        <>
          {/* KPI CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={`next-glass-panel rounded-next-2xl p-5 flex items-center gap-4 cursor-pointer ${filter === 'critical' ? 'ring-2 ring-rose-500/40' : ''}`} onClick={() => setFilter(filter === 'critical' ? 'all' : 'critical')}>
              <div className="w-11 h-11 bg-rose-500/10 rounded-2xl flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-5 h-5 text-rose-400" /></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Itens Críticos</p><p className="text-2xl font-bold text-slate-100">{criticalCount}</p></div>
            </div>
            <div className={`next-glass-panel rounded-next-2xl p-5 flex items-center gap-4 cursor-pointer ${filter === 'warning' ? 'ring-2 ring-amber-500/40' : ''}`} onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')}>
              <div className="w-11 h-11 bg-amber-500/10 rounded-2xl flex items-center justify-center flex-shrink-0"><TrendingDown className="w-5 h-5 text-amber-400" /></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Abaixo do Mínimo</p><p className="text-2xl font-bold text-slate-100">{warningCount}</p></div>
            </div>
            <div className="next-glass-panel rounded-next-2xl p-5 flex items-center gap-4">
              <div className="w-11 h-11 bg-next-purple-neon/10 rounded-2xl flex items-center justify-center flex-shrink-0"><Package className="w-5 h-5 text-next-purple-neon" /></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total de Itens</p><p className="text-2xl font-bold text-slate-100">{items.length}</p></div>
            </div>
          </div>

          {/* TOOLBAR */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setFilter('all')} className={`px-3 py-2 rounded-lg text-[11px] font-bold border ${filter === 'all' ? 'next-brand-gradient-bg text-white border-transparent' : 'bg-slate-900/60 text-slate-400 border-next-border'}`}>Todos</button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar item..." className="pl-9 pr-3 py-2 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 w-48" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowHistory(v => !v)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900/60 border border-next-border text-slate-300 font-bold text-[11px] rounded-lg">
                <History className="w-3.5 h-3.5" /> Histórico <ChevronDown className={`w-3 h-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
              </button>
              <button onClick={() => setIsAddOpen(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple">
                <Plus className="w-3.5 h-3.5" /> Novo Item
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showHistory && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="next-glass-panel rounded-next-2xl overflow-hidden">
                <div className="p-4 divide-y divide-next-border/60">
                  {movements.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">Nenhuma movimentação real registrada ainda.</p>
                  ) : movements.map(m => (
                    <div key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-200 truncate">{m.itemName}</p>
                        <p className="text-[10.5px] text-slate-500">{m.type === 'entrada' ? 'Entrada' : m.type === 'ajuste' ? 'Ajuste manual' : m.type} · {m.previousQuantity} → {m.newQuantity} {m.unit}{m.supplierName ? ` · ${m.supplierName}` : ''}</p>
                      </div>
                      <span className={`font-mono font-bold flex-shrink-0 ${m.newQuantity >= m.previousQuantity ? 'text-emerald-400' : 'text-rose-400'}`}>{m.newQuantity >= m.previousQuantity ? '+' : ''}{m.newQuantity - m.previousQuantity} {m.unit}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ITEM GRID */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredItems.map(item => {
              const meta = statusMeta(item.status);
              const isAdjusting = adjustingId === item.id;
              return (
                <div key={item.id} className={`next-glass-panel rounded-next-2xl p-5 border ${meta.border}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className={`p-2.5 rounded-xl ${meta.bg}`}><Tag className={`w-4 h-4 ${meta.text}`} /></div>
                    <span className={`text-[9.5px] font-bold uppercase tracking-wider ${meta.text}`}>{meta.label}</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100">{item.name}</h4>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">{item.category}</p>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="p-2.5 bg-slate-900/60 rounded-xl border border-next-border/60">
                      <p className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Estoque Atual</p>
                      <p className="text-sm font-bold text-slate-100">{item.stock} {item.unit}</p>
                    </div>
                    <div className="p-2.5 bg-slate-900/60 rounded-xl border border-next-border/60">
                      <p className="text-[8.5px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Qtd Mínima</p>
                      <p className="text-sm font-bold text-slate-100">{item.minStock} {item.unit}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{item.expiry ? `Val: ${item.expiry}` : 'Sem validade informada'}</span>
                    {!isAdjusting && (
                      <button onClick={() => openAdjust(item)} className="text-[10px] font-bold text-next-purple-light uppercase tracking-wider hover:underline">Ajustar</button>
                    )}
                  </div>

                  {isAdjusting && (
                    <div className="mt-3 pt-3 border-t border-next-border flex items-center gap-2">
                      <input type="number" min={0} value={adjustValue} onChange={(e) => setAdjustValue(e.target.value)} className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-2.5 py-1.5" />
                      <button disabled={savingAdjust} onClick={() => handleSaveAdjust(item)} className="px-2.5 py-1.5 next-brand-gradient-bg text-white font-bold text-[10.5px] rounded-lg disabled:opacity-50">{savingAdjust ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Salvar'}</button>
                      <button onClick={() => setAdjustingId(null)} className="p-1.5 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredItems.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-500 next-glass-panel rounded-next-2xl">
                <p className="text-xs font-semibold">Nenhum item encontrado no estoque real desta clínica.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        // ---- SMART ENTRY (AI) ----
        <div className="space-y-5">
          {aiError && (
            <div className="p-3.5 bg-next-red-alert/10 border border-next-red-alert/20 rounded-xl text-next-red-alert flex items-start gap-2 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{aiError}</span>
            </div>
          )}

          {step === 'upload' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 next-glass-panel rounded-next-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Origem do Documento</label>
                  <div className="flex bg-slate-900 p-0.5 rounded-lg ml-auto border border-next-border">
                    {(['invoice', 'quote', 'purchase_list'] as const).map(s => (
                      <button key={s} onClick={() => setSource(s)} className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${source === s ? 'next-brand-gradient-bg text-white' : 'text-slate-400'}`}>
                        {s === 'invoice' ? 'Nota Fiscal' : s === 'quote' ? 'Orçamento' : 'Lista de Compras'}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center flex flex-col items-center justify-center min-h-[280px] transition-all ${isDragging ? 'border-next-purple-neon bg-next-purple-neon/5' : 'border-next-border hover:border-next-border-glow'}`}
                >
                  <div className="w-14 h-14 bg-next-purple-neon/10 text-next-purple-neon rounded-full flex items-center justify-center mb-4 border border-next-purple-neon/20">
                    <Upload className="w-7 h-7" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-200 mb-1">Arraste o documento ou foto aqui</h4>
                  <p className="text-xs text-slate-500 mb-6 max-w-sm">Envie uma foto (JPG/PNG) ou PDF de nota fiscal, orçamento, cupom ou lista de compras.</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple"><Upload className="w-4 h-4" /> Enviar arquivo / Foto</button>
                    <button onClick={() => cameraInputRef.current?.click()} className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 text-slate-200 font-bold text-xs rounded-xl border border-next-border"><Camera className="w-4 h-4" /> Tirar foto agora</button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileChange} />
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />
                </div>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 text-next-purple-light text-xs font-bold uppercase tracking-wider mb-3"><Sparkles className="w-4 h-4" /> Como funciona</div>
                  <ul className="space-y-3 text-xs text-slate-400 leading-relaxed">
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-next-purple-neon flex-shrink-0 mt-0.5" /><span>A Eliza lê o documento e reconhece itens clínicos (anestésicos, ácido hialurônico, implantes, resinas, luvas, etc).</span></li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-next-purple-neon flex-shrink-0 mt-0.5" /><span>Ela tenta casar cada item com o que já existe no seu estoque real.</span></li>
                    <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-next-purple-neon flex-shrink-0 mt-0.5" /><span>Nada é gravado até você revisar, editar e confirmar cada campo.</span></li>
                  </ul>
                </div>
                <button onClick={handleManualInsert} className="mt-6 w-full bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-xs border border-next-border">Inserir Itens Manualmente</button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="py-16 text-center max-w-md mx-auto flex flex-col items-center next-glass-panel rounded-next-2xl">
              <Loader2 className="w-10 h-10 text-next-purple-neon animate-spin mb-4" />
              <h4 className="text-sm font-bold text-slate-200 mb-2">Processando com IA...</h4>
              <p className="text-xs text-slate-500">{loadingMsg}</p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              <div className="p-4 bg-next-purple-neon/10 border border-next-purple-neon/20 rounded-2xl flex items-start gap-3 text-next-purple-light">
                <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-wide">Revisão necessária antes de gravar</p>
                  <p className="text-xs opacity-90 mt-0.5">A Eliza sugeriu os itens abaixo. Edite qualquer campo e confirme para gravar de verdade no estoque desta clínica.</p>
                </div>
              </div>

              <div className="next-glass-panel rounded-next-2xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Fornecedor</label>
                  <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Nº Documento</label>
                  <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Data</label>
                  <input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className="w-full mt-1 px-3 py-2 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Total Apurado</label>
                  <div className="w-full mt-1 px-3 py-2 bg-slate-900/60 border border-next-border rounded-lg text-xs font-bold text-slate-200">R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                </div>
              </div>

              {/* DESKTOP TABLE */}
              <div className="hidden md:block next-glass-panel rounded-next-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-900/60 border-b border-next-border">
                        <th className="p-3 pl-5 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest">Item / Vínculo com Estoque</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-center w-16">Qtd</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-center w-20">Unid</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-right w-24">Vl Unit</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-right w-24">Total</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-center w-28">Lote/Validade</th>
                        <th className="p-3 text-[9.5px] font-bold text-slate-500 uppercase tracking-widest text-center w-14"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-next-border/60">
                      {reviewItems.map((item, index) => (
                        <tr key={index}>
                          <td className="p-3 pl-5 space-y-1.5">
                            <input value={item.suggestedName} onChange={(e) => updateReviewItem(index, 'suggestedName', e.target.value)} className="w-full bg-transparent border-b border-transparent hover:border-next-border focus:border-next-purple-neon outline-none text-xs font-bold text-slate-200 py-0.5" />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${item.matchStatus === 'Encontrado no estoque' ? 'bg-emerald-500/10 text-emerald-400' : item.matchStatus === 'Possível correspondência' ? 'bg-amber-500/10 text-amber-400' : 'bg-sky-500/10 text-sky-400'}`}>{item.matchStatus}</span>
                              <select value={item.matchedProductId} onChange={(e) => updateReviewItem(index, 'matchedProductId', e.target.value)} className="text-[10px] font-bold text-slate-400 bg-slate-900 border border-next-border rounded px-1.5 py-0.5 max-w-[160px] truncate">
                                <option value="">-- Criar como novo --</option>
                                {items.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock} {p.unit})</option>)}
                              </select>
                            </div>
                          </td>
                          <td className="p-3 text-center"><input type="number" value={item.quantity} onChange={(e) => updateReviewItem(index, 'quantity', Number(e.target.value))} className="w-14 px-1.5 py-1 bg-slate-900 border border-next-border rounded text-center text-xs text-slate-200" /></td>
                          <td className="p-3 text-center"><input value={item.unit} onChange={(e) => updateReviewItem(index, 'unit', e.target.value)} className="w-14 px-1.5 py-1 bg-slate-900 border border-next-border rounded text-center text-xs text-slate-200" /></td>
                          <td className="p-3 text-right"><input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateReviewItem(index, 'unitPrice', Number(e.target.value))} className="w-20 px-1.5 py-1 bg-slate-900 border border-next-border rounded text-right text-xs text-slate-200" /></td>
                          <td className="p-3 text-right text-xs font-bold text-slate-300">R$ {item.totalPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="p-3 space-y-1">
                            <input placeholder="Lote" value={item.batch} onChange={(e) => updateReviewItem(index, 'batch', e.target.value)} className="w-full px-1.5 py-1 bg-slate-900 border border-next-border rounded text-center text-[10px] text-slate-200" />
                            <input type="date" value={item.expirationDate} onChange={(e) => updateReviewItem(index, 'expirationDate', e.target.value)} className="w-full px-1.5 py-1 bg-slate-900 border border-next-border rounded text-center text-[10px] text-slate-200" />
                          </td>
                          <td className="p-3 text-center"><button onClick={() => removeReviewItem(index)} className="p-1 text-slate-500 hover:text-next-red-alert"><Trash2 className="w-3.5 h-3.5" /></button></td>
                        </tr>
                      ))}
                      {reviewItems.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-500 text-xs">Nenhum item na lista.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE CARDS */}
              <div className="md:hidden space-y-3">
                {reviewItems.map((item, index) => {
                  const isExpanded = expandedIndex === index;
                  return (
                    <div key={index} className={`next-glass-panel rounded-2xl p-4 border ${isExpanded ? 'border-next-purple-neon/40' : 'border-next-border'}`}>
                      <div className="flex justify-between items-start gap-2">
                        <input value={item.suggestedName} onChange={(e) => updateReviewItem(index, 'suggestedName', e.target.value)} className="flex-1 bg-slate-900 border border-next-border rounded-lg text-xs font-bold text-slate-200 px-2 py-1.5" />
                        <button onClick={() => removeReviewItem(index)} className="p-1.5 text-slate-500 hover:text-next-red-alert flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <select value={item.matchedProductId} onChange={(e) => updateReviewItem(index, 'matchedProductId', e.target.value)} className="mt-2 w-full text-[10px] font-bold text-slate-400 bg-slate-900 border border-next-border rounded-lg px-2 py-1">
                        <option value="">-- Criar como novo --</option>
                        {items.map(p => <option key={p.id} value={p.id}>{p.name} ({p.stock} {p.unit})</option>)}
                      </select>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div><p className="text-[8px] font-bold text-slate-500 uppercase mb-1 text-center">Qtd</p><input type="number" value={item.quantity} onChange={(e) => updateReviewItem(index, 'quantity', Number(e.target.value))} className="w-full text-center py-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" /></div>
                        <div><p className="text-[8px] font-bold text-slate-500 uppercase mb-1 text-center">Unid</p><input value={item.unit} onChange={(e) => updateReviewItem(index, 'unit', e.target.value)} className="w-full text-center py-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" /></div>
                        <div><p className="text-[8px] font-bold text-slate-500 uppercase mb-1 text-center">R$ Unit</p><input type="number" value={item.unitPrice} onChange={(e) => updateReviewItem(index, 'unitPrice', Number(e.target.value))} className="w-full text-center py-1 bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200" /></div>
                      </div>
                      <button onClick={() => setExpandedIndex(isExpanded ? null : index)} className="mt-3 text-[9px] font-black uppercase text-slate-500 flex items-center gap-1">{isExpanded ? 'Fechar detalhes' : 'Ver lote / validade'} <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></button>
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-dashed border-next-border grid grid-cols-2 gap-2">
                          <input placeholder="Lote" value={item.batch} onChange={(e) => updateReviewItem(index, 'batch', e.target.value)} className="text-xs py-1.5 bg-slate-900 border border-next-border rounded-lg px-2 text-slate-200" />
                          <input type="date" value={item.expirationDate} onChange={(e) => updateReviewItem(index, 'expirationDate', e.target.value)} className="text-xs py-1.5 bg-slate-900 border border-next-border rounded-lg px-2 text-slate-200" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-between pt-2 border-t border-next-border">
                <button onClick={addReviewRow} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-slate-800 border border-next-border text-slate-300 font-bold text-xs rounded-xl"><PlusCircle className="w-4 h-4" /> Adicionar Item Manual</button>
                <div className="flex gap-3">
                  <button onClick={() => setStep('upload')} className="px-4 py-2.5 border border-next-border text-slate-400 font-bold text-[10.5px] uppercase rounded-xl">Refazer Envio</button>
                  <button disabled={reviewItems.length === 0 || savingEntry} onClick={handleConfirmEntry} className="inline-flex items-center gap-2 px-5 py-2.5 next-brand-gradient-bg text-white font-bold text-[10.5px] uppercase rounded-xl shadow-next-glow-purple disabled:opacity-50">
                    {savingEntry ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {savingEntry ? 'Gravando...' : 'Confirmar e Gravar no Estoque'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="py-16 text-center max-w-sm mx-auto flex flex-col items-center next-glass-panel rounded-next-2xl">
              <div className="w-14 h-14 bg-next-green-success/10 text-next-green-success rounded-full flex items-center justify-center mb-5 border border-next-green-success/20"><CheckCircle2 className="w-7 h-7" /></div>
              <h4 className="text-base font-bold text-slate-100 mb-2">Entrada gravada de verdade</h4>
              <p className="text-xs text-slate-500 leading-relaxed mb-7">{savedCount} item(ns) confirmados por você foram gravados no estoque real desta clínica, com movimentação registrada.</p>
              <div className="space-y-2.5 w-full">
                <button onClick={() => { setMode('list'); resetEntry(); }} className="w-full next-brand-gradient-bg text-white py-3 rounded-xl font-bold text-xs">Voltar ao Estoque</button>
                <button onClick={resetEntry} className="w-full bg-slate-800 text-slate-300 py-3 rounded-xl font-bold text-xs border border-next-border">Lançar Outro Documento</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MANUAL ADD MODAL */}
      <AnimatePresence>
        {isAddOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingItem && setIsAddOpen(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md next-glass-panel rounded-next-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Package className="w-4 h-4 text-next-purple-neon" /> Novo Item</h3>
                <button onClick={() => !savingItem && setIsAddOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Nome do Item *</label>
                  <input value={newItem.name} onChange={(e) => setNewItem(v => ({ ...v, name: e.target.value }))} placeholder="Ex: Luvas de Procedimento" className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Estoque Atual</label>
                    <input type="number" value={newItem.stock} onChange={(e) => setNewItem(v => ({ ...v, stock: Number(e.target.value) }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Unidade</label>
                    <input value={newItem.unit} onChange={(e) => setNewItem(v => ({ ...v, unit: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Estoque Mínimo</label>
                    <input type="number" value={newItem.minStock} onChange={(e) => setNewItem(v => ({ ...v, minStock: Number(e.target.value) }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-slate-500 uppercase">Categoria</label>
                    <select value={newItem.category} onChange={(e) => setNewItem(v => ({ ...v, category: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1">
                      {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono text-slate-500 uppercase">Data de Validade</label>
                  <input type="date" value={newItem.expiry} onChange={(e) => setNewItem(v => ({ ...v, expiry: e.target.value }))} className="w-full bg-slate-900 border border-next-border rounded-lg text-xs text-slate-200 px-3 py-2.5 mt-1" />
                </div>
              </div>
              <button disabled={savingItem || !newItem.name.trim()} onClick={handleAddItem} className="mt-5 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 next-brand-gradient-bg text-white font-bold text-xs rounded-xl shadow-next-glow-purple disabled:opacity-60">
                {savingItem ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {savingItem ? 'Gravando...' : 'Cadastrar Item Real'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900 border border-next-border rounded-full text-[10px] font-mono text-slate-500">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          <span>Cadastro, ajuste de estoque e confirmação de entrada gravam de verdade nesta clínica</span>
        </span>
      </div>
    </div>
  );
}
