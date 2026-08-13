import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, serverTimestamp, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  Package, 
  Search, 
  Plus, 
  Filter, 
  AlertTriangle, 
  ArrowRight, 
  History, 
  Tag, 
  ChevronRight,
  TrendingDown,
  ShoppingCart,
  ScrollText,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SmartInventoryEntry from './SmartInventoryEntry';

interface Item {
  id: string;
  name: string;
  category: string;
  stock: number;
  minStock: number;
  unit: string;
  expiry: string;
  status: 'ok' | 'warning' | 'critical';
}

export default function InventoryView() {
  const { clinic } = useAuth();
  const [viewMode, setViewMode] = useState<'registry' | 'smart_entry'>('registry');
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [inventory, setInventory] = useState<Item[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [newItem, setNewItem] = useState({
    name: '',
    category: 'Consumíveis',
    stock: 0,
    minStock: 0,
    unit: 'unid',
    expiry: ''
  });

  useEffect(() => {
    if (!clinic) {
      console.log("[ELIZA] inventory wait state: clinic not yet loaded");
      return;
    }
    console.log("[ELIZA] entering inventory bootstrap");
    const path = `clinics/${clinic.id}/inventory`;
    console.log(`[ELIZA] loading inventory query for ${path}...`);
    const q = query(collection(db, 'clinics', clinic.id, 'inventory'), limit(200));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`[ELIZA] inventory loaded: ${snapshot.size} docs`);
      const list: Item[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const status = data.stock <= (data.minStock / 2) ? 'critical' : data.stock <= data.minStock ? 'warning' : 'ok';
        list.push({ id: doc.id, ...data, status } as Item);
      });
      setInventory(list);
    }, (err) => {
      console.error(`[ELIZA] ERROR in inventory: ${err.message}`);
      handleFirestoreError(err, OperationType.LIST, path);
    });
    return () => {
      console.log("[ELIZA] exiting inventory bootstrap");
      unsubscribe();
    };
  }, [clinic]);

  const handleAddItem = async () => {
    if (!newItem.name || !clinic) return;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'inventory'), {
        ...newItem,
        createdAt: serverTimestamp()
      });
      setIsAddModalOpen(false);
      setNewItem({ name: '', category: 'Consumíveis', stock: 0, minStock: 0, unit: 'unid', expiry: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clinics/${clinic.id}/inventory`);
    }
  };

  const handleAdjustStock = async (id: string, current: number) => {
    if (!clinic) return;
    const amount = window.prompt('Nova quantidade em estoque:', current.toString());
    if (amount === null) return;
    const newVal = parseInt(amount);
    if (isNaN(newVal)) return;

    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(db, 'clinics', clinic.id, 'inventory', id), {
        stock: newVal,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("[ELIZA] Error adjusting stock:", err);
    }
  };

  const filteredData = inventory.filter(item => {
    const matchesFilter = filter === 'all' || item.status === filter;
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const criticalCount = inventory.filter(i => i.status === 'critical').length;
  const warningCount = inventory.filter(i => i.status === 'warning').length;
  
  // Estimate suggested purchase cost (mock rule: each critical item costs average R$ 150 to restock)
  const suggestedPurchase = criticalCount * 150 + warningCount * 50;

  return (
    <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 bg-white border-b border-slate-200 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Package className="w-5 h-5 text-teal-600" />
            Controle de Estoque
          </h2>
          <p className="text-xs text-slate-500 font-medium">Gestão inteligente de suprimentos e materiais clínicos.</p>
        </div>
        <div className="flex items-center gap-3">
          {viewMode === 'registry' ? (
            <>
              <button 
                onClick={() => setViewMode('smart_entry')}
                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-600 border border-amber-200 px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 shadow-sm text-nowrap cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
                Entrada Inteligente (IA)
              </button>
              <button 
                onClick={() => setIsAddModalOpen(true)}
                className="bg-teal-600 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-teal-600/20 hover:bg-teal-700 transition-all flex items-center gap-2 text-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Novo Item
              </button>
            </>
          ) : (
            <button 
              onClick={() => setViewMode('registry')}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 text-nowrap cursor-pointer"
            >
              <Package className="w-4 h-4" />
              Visualizar Estoque
            </button>
          )}
        </div>
      </header>

      {viewMode === 'smart_entry' ? (
        <SmartInventoryEntry 
          existingItems={inventory} 
          onSuccess={() => setViewMode('registry')} 
          onCancel={() => setViewMode('registry')} 
        />
      ) : (
        <>
          {/* Stats Summary */}
          <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 flex items-center gap-4 shadow-sm">
               <div className="w-12 h-12 bg-rose-50 rounded-2xl flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-rose-500" />
               </div>
               <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Itens Críticos</p>
                  <p className="text-2xl font-bold text-slate-900">{criticalCount.toString().padStart(2, '0')}</p>
               </div>
               <button 
                 onClick={() => setFilter('critical')}
                 className="ml-auto p-2 hover:bg-slate-50 rounded-xl transition-colors">
                  <ArrowRight className="w-4 h-4 text-slate-400" />
               </button>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 flex items-center gap-4 shadow-sm">
               <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center">
                  <TrendingDown className="w-6 h-6 text-amber-500" />
               </div>
               <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Abaixo do Mínimo</p>
                  <p className="text-2xl font-bold text-slate-900">{warningCount.toString().padStart(2, '0')}</p>
               </div>
               <button 
                 onClick={() => setFilter('warning')}
                 className="ml-auto p-2 hover:bg-slate-50 rounded-xl transition-colors">
                  <ArrowRight className="w-4 h-4 text-slate-400" />
               </button>
            </div>
            <div className="bg-slate-900 p-6 rounded-3xl flex items-center gap-4 shadow-xl text-white">
               <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                  <ShoppingCart className="w-6 h-6 text-teal-400" />
               </div>
               <div>
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Sugerido p/ Compra</p>
                  <p className="text-2xl font-bold">R$ {suggestedPurchase.toLocaleString()}</p>
               </div>
               <ChevronRight className="ml-auto w-4 h-4 text-white/30" />
            </div>
          </div>

          {/* Toolbar */}
          <div className="px-8 pb-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
               <button 
                 onClick={() => setFilter('all')}
                 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'all' ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/10' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50' }`}
                >
                 Todos
               </button>
               <button 
                 onClick={() => setFilter('critical')}
                 className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'critical' ? 'bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-600/10' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50' }`}
                >
                 Críticos
               </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                  type="text" 
                  placeholder="Filtro rápido..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-teal-600/10 focus:border-teal-600 outline-none transition-all w-48 font-medium"
                />
              </div>
              <button className="hidden lg:flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all">
                 <History className="w-4 h-4" />
                 Histórico
              </button>
            </div>
          </div>

          {/* Inventory List */}
          <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredData.map((item, idx) => (
                <motion.div
                  layout
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className={`p-3 rounded-2xl ${
                      item.status === 'critical' ? 'bg-rose-50' : 
                      item.status === 'warning' ? 'bg-amber-50' : 'bg-teal-50'
                    }`}>
                      <Tag className={`w-5 h-5 ${
                        item.status === 'critical' ? 'text-rose-500' : 
                        item.status === 'warning' ? 'text-amber-500' : 'text-teal-500'
                      }`} />
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Status</p>
                       <span className={`text-[10px] font-bold uppercase ${
                         item.status === 'critical' ? 'text-rose-600' : 
                         item.status === 'warning' ? 'text-amber-600' : 'text-emerald-600'
                       }`}>
                         {item.status.toUpperCase()}
                       </span>
                    </div>
                  </div>

                  <h4 className="text-base font-bold text-slate-900 group-hover:text-teal-700 transition-colors mb-2">{item.name}</h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.category}</p>

                  <div className="mt-8 grid grid-cols-2 gap-4">
                     <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Estoque Atual</p>
                        <p className="text-sm font-bold text-slate-900">{item.stock} {item.unit}</p>
                     </div>
                     <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-1">Qtd Mínima</p>
                        <p className="text-sm font-bold text-slate-900">{item.minStock} {item.unit}</p>
                     </div>
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                     <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 bg-slate-200 rounded-full"></div>
                        <span className="text-[10px] text-slate-400 font-medium truncate max-w-[100px]">Val: {item.expiry || '--/--'}</span>
                     </div>
                     <button 
                       onClick={() => handleAdjustStock(item.id, item.stock)}
                       className="text-[10px] font-bold text-teal-600 uppercase tracking-widest flex items-center gap-1 hover:underline active:scale-95"
                     >
                        Ajustar
                        <ScrollText className="w-3" />
                     </button>
                  </div>
                </motion.div>
              ))}
              {filteredData.length === 0 && (
                <div className="col-span-full py-20 text-center text-slate-400 italic">Nenhum item encontrado no estoque.</div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal: Novo Item */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsAddModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl p-10">
              <h3 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
                <Package className="w-5 h-5 text-teal-600" /> Novo Material
              </h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nome do Item</label>
                  <input value={newItem.name} onChange={(e) => setNewItem({...newItem, name: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" placeholder="Ex: Luvas de Procedimento" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estoque Atual</label>
                    <input type="number" value={newItem.stock} onChange={(e) => setNewItem({...newItem, stock: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unidade (unid/caixa)</label>
                    <input value={newItem.unit} onChange={(e) => setNewItem({...newItem, unit: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estoque Mínimo</label>
                    <input type="number" value={newItem.minStock} onChange={(e) => setNewItem({...newItem, minStock: Number(e.target.value)})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Caterogia</label>
                    <input value={newItem.category} onChange={(e) => setNewItem({...newItem, category: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                  </div>
                </div>
                 <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data de Validade</label>
                  <input type="date" value={newItem.expiry} onChange={(e) => setNewItem({...newItem, expiry: e.target.value})} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:border-teal-600" />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button onClick={() => setIsAddModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-400">Cancelar</button>
                <button onClick={handleAddItem} className="flex-1 py-3 bg-teal-600 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-teal-600/20">Cadastrar Item</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
