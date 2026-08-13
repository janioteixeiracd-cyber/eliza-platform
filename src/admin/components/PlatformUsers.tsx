import React, { useState } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { Search, Users, ShieldAlert, UserCheck, UserX, UserMinus } from 'lucide-react';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export default function PlatformUsers() {
  const { users, clinics, isLoading } = useAdmin();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClinic, setSelectedClinic] = useState('');

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          u.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesClinic = !selectedClinic || u.defaultClinicId === selectedClinic;
    return matchesSearch && matchesClinic;
  });

  const toggleUserStatus = async (userDoc: any) => {
    try {
      const newStatus = userDoc.active === false ? true : false;
      await updateDoc(doc(db, 'users', userDoc.id), {
        active: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (e: any) {
      console.error("[PlatformUsers] Failed to toggle user status:", e);
    }
  };

  const getClinicName = (clinicId: string) => {
    if (!clinicId) return 'Nenhuma';
    const c = clinics.find(cl => cl.id === clinicId);
    return c ? c.name : clinicId;
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Usuários Globais</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Controle de acessos e perfis na plataforma ELIZA</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <select 
            value={selectedClinic}
            onChange={(e) => setSelectedClinic(e.target.value)}
            className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all cursor-pointer"
          >
            <option value="">TODAS AS CLÍNICAS</option>
            {clinics.map(c => (
              <option key={c.id} value={c.id}>{c.name.toUpperCase()}</option>
            ))}
          </select>
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="PESQUISAR NOME OU E-MAIL..."
              className="pl-11 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-teal-500 focus:ring-4 focus:ring-teal-50 transition-all w-full"
            />
          </div>
        </div>
      </header>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Usuário', 'Vínculo Clínica', 'Função Clínica', 'Platform Role', 'Status', 'Ações'].map((h) => (
                  <th key={h} className="px-8 py-5 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length > 0 ? filteredUsers.map((u, i) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center font-black text-teal-600 text-xs">
                        {u.name ? u.name[0]?.toUpperCase() : u.email?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{u.name || 'Sem Nome'}</p>
                        <p className="text-[10px] text-slate-500 font-medium">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{getClinicName(u.defaultClinicId)}</p>
                    <p className="text-[9px] text-slate-400 font-mono">{u.defaultClinicId || 'Nenhum'}</p>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-3 py-1 bg-teal-50 text-[9px] font-black uppercase text-teal-600 rounded-lg">{u.role || 'Membro'}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-3 py-1 text-[9px] font-black uppercase rounded-lg ${u.platformRole === 'super_admin' ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-slate-100 text-slate-500'}`}>
                      {u.platformRole || 'Usuário'}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${u.active !== false ? 'bg-emerald-500' : 'bg-rose-500'} animate-pulse`}></div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${u.active !== false ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {u.active !== false ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <button 
                      onClick={() => toggleUserStatus(u)}
                      className={`p-2 rounded-lg border transition-all flex items-center gap-2 text-[9px] font-black uppercase tracking-wider ${
                        u.active !== false 
                        ? 'border-rose-100 hover:border-rose-200 text-rose-500 hover:bg-rose-50/50' 
                        : 'border-emerald-100 hover:border-emerald-200 text-emerald-600 hover:bg-emerald-50/50'
                      }`}
                    >
                      {u.active !== false ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      {u.active !== false ? 'Desativar' : 'Ativar'}
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-8 py-20 text-center opacity-30">
                    <Users className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nenhum usuário encontrado</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
