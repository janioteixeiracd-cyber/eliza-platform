import React, { useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, setDoc, addDoc, collection, serverTimestamp, updateDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

export default function OnboardingView() {
  const { user, profile, logout } = useAuth();
  const [clinicName, setClinicName] = useState('');
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverId, setRecoverId] = useState('');
  const [showRecover, setShowRecover] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRecover = async () => {
    if (!user || !recoverId) return;
    setIsRecovering(true);
    setErrorMsg(null);
    try {
      const id = recoverId.trim();
      console.log("[ACCESS_CHECK] auth uid:", user.uid);
      
      const memberRef = doc(db, 'clinics', id, 'members', user.uid);
      const memberDoc = await getDoc(memberRef);
      console.log("[ACCESS_CHECK] member exists:", memberDoc.exists());
      
      if (memberDoc.exists()) {
        const memberData = memberDoc.data();
        
        // Reparar automaticamente users/{uid}
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: memberData.name || user.displayName || user.email?.split('@')[0] || 'Usuário',
          email: user.email?.toLowerCase() || '',
          defaultClinicId: id,
          role: memberData.role || 'colaborador',
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        console.log("[ACCESS_CHECK] users profile repaired successfully. Reloading...");
        window.location.reload();
      } else {
        setErrorMsg("Seu usuário autenticado ainda não foi cadastrado como membro desta clínica.");
      }
    } catch (err: any) {
      console.error("[ACCESS_CHECK] Error:", err);
      setErrorMsg(`Erro ao vincular clínica: ${err.message}`);
    } finally {
      setIsRecovering(false);
    }
  };

  const handleFinish = async () => {
    if (!user || !clinicName) return;
    setIsCreating(true);
    try {
      console.log(`[Onboarding] Starting flow for: ${clinicName}`);
      
      // 1. Pre-generate clinic reference to get the ID
      const clinicsCol = collection(db, 'clinics');
      const clinicRef = doc(clinicsCol);
      const clinicId = clinicRef.id;
      
      console.log(`[Onboarding] Generated Clinic ID: ${clinicId}`);

      // 2. Create the clinic document
      await setDoc(clinicRef, {
        name: clinicName,
        slug: (clinicName || '').toLowerCase().replace(/\s+/g, '-'),
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        active: true,
        // Optional Fields
        cnpj: cnpj || '',
        phone: phone || '',
        whatsapp: whatsapp || '',
        email: email || '',
        city: city || '',
        state: state || '',
        address: (city && state) ? `${city} - ${state}` : '',
      });

      // 3. Create the member entry
      const memberRef = doc(db, 'clinics', clinicId, 'members', user.uid);
      await setDoc(memberRef, {
        uid: user.uid,
        role: 'owner',
        active: true,
        joinedAt: serverTimestamp()
      });

      // 4. Update the user profile with the new clinic as default
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || clinicName,
        defaultClinicId: clinicId,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 5. Register in Platform Global List (for SaaS admin)
      try {
        const { PlatformAdminService } = await import('../services/platformAdminService');
        await PlatformAdminService.syncClinicMetadata(clinicId, {
          name: clinicName,
          ownerEmail: user.email,
          planId: 'trial',
          status: 'trial',
          patientCount: 0,
          userCount: 1,
          createdAt: new Date().toISOString()
        });
      } catch (e) {
        console.warn("[Onboarding] Error syncing to platform global list:", e);
      }

      console.log("[Onboarding] Flow complete. Reloading...");
      window.location.reload();
    } catch (err: any) {
      console.error("[Onboarding] Fatal Error:", err);
      // Removed hardcoded 'clinics/onboarding'
      handleFirestoreError(err, OperationType.WRITE, `clinics/new`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-slate-900">
      {/* Quick Status Bar for Errors */}
      {user && (
         <div className="fixed top-4 left-4 right-4 z-[100] flex flex-col gap-2">
            {!profile?.uid && (
              <div className="bg-rose-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center justify-between">
                <span>⚠️ Erro de Sincronização de Perfil</span>
                <button onClick={() => window.location.reload()} className="bg-white/20 px-2 py-1 rounded">Recarregar</button>
              </div>
            )}
         </div>
      )}

      <div className="w-full max-w-md bg-white rounded-[2rem] border border-slate-100 shadow-xl p-8 overflow-hidden relative">
        <div className="mb-8 flex justify-between items-start gap-4">
          <div className="flex-1">
            <div className="w-12 h-12 bg-teal-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mb-6 shadow-lg shadow-teal-600/20">E</div>
            <h2 className="text-2xl font-black tracking-tight mb-2">Bem-vindo(a).</h2>
            <p className="text-slate-500 text-sm font-medium leading-relaxed">Sua conta foi identificada, mas ainda não encontramos uma clínica vinculada a você.</p>
          </div>
          <button 
            onClick={async () => {
              try {
                await logout();
              } catch (err) {
                console.error("Erro ao sair:", err);
              }
            }}
            className="shrink-0 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[10px] font-black uppercase tracking-wider px-3.5 py-2.5 rounded-xl transition-all border border-rose-100 hover:border-rose-200"
            title="Sair da Conta"
          >
            Sair
          </button>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-2xl text-[10px] font-bold text-rose-600 tracking-normal uppercase text-center leading-normal">
            {errorMsg}
          </div>
        )}

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nome da Nova Clínica</label>
            <input 
              autoFocus
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              placeholder="Ex: Consultório Odontológico"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold shadow-sm outline-none focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 transition-all font-sans"
            />
          </div>

          {/* Toggle para Personalização Opcional da Identidade */}
          <div className="border border-slate-150 rounded-2xl overflow-hidden bg-slate-50/55 p-4">
            <button
              type="button"
              onClick={() => setShowOptionalFields(!showOptionalFields)}
              className="w-full flex items-center justify-between text-left text-xs font-bold text-teal-700 uppercase tracking-wider"
            >
              <span>Personalização da Clínica (Opcional)</span>
              <span className="text-[10px] text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                {showOptionalFields ? "Esconder" : "Configurar agora"}
              </span>
            </button>
            
            {showOptionalFields && (
              <div className="mt-4 space-y-4 pt-4 border-t border-slate-100/75 text-slate-700 animate-none">
                <p className="text-[9px] font-bold text-amber-600 bg-amber-50 rounded-lg p-2.5 leading-normal uppercase">
                  ⚠️ Aviso: Você pode concluir esta personalização depois em Configurações &gt; Clínica.
                </p>
                
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">CNPJ / CPF do Responsável</label>
                  <input
                    type="text"
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    placeholder="Ex: 45.678.901/0001-23"
                    className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">Telefone Principal</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Ex: (11) 3456-7890"
                      className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">WhatsApp</label>
                    <input
                      type="text"
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      placeholder="Ex: (11) 99999-9999"
                      className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">E-mail Principal</label>
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Ex: contato@suaclinica.com.br"
                    className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">Cidade</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Ex: São Paulo"
                      className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-450 uppercase tracking-wider block">Estado (UF)</label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="Ex: SP"
                      className="w-full px-4 py-2.5 bg-white border border-slate-150 rounded-xl text-xs outline-none focus:border-teal-500 font-medium font-sans uppercase"
                      maxLength={2}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={handleFinish}
            disabled={!clinicName || isCreating}
            className={`w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg transition-all ${isCreating ? 'bg-slate-200 text-slate-400' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
          >
            {isCreating ? 'PROCESSANDO...' : 'CRIAR CLÍNICA AGORA'}
          </button>

          <div className="pt-8 border-t border-slate-100 space-y-4">
            <button 
              onClick={async () => {
                if (!user) return;
                setRecoverId('l9GzEcXT7uhcYHgRVVhe');
                setIsRecovering(true);
                setErrorMsg(null);
                
                try {
                  const id = 'l9GzEcXT7uhcYHgRVVhe';
                  console.log("[ACCESS_CHECK] auth uid:", user.uid);
                  
                  const memberRef = doc(db, 'clinics', id, 'members', user.uid);
                  const memberDoc = await getDoc(memberRef);
                  console.log("[ACCESS_CHECK] member exists:", memberDoc.exists());
                  
                  if (memberDoc.exists()) {
                    const memberData = memberDoc.data();
                    
                    // Reparar automaticamente users/{uid}
                    await setDoc(doc(db, 'users', user.uid), {
                      uid: user.uid,
                      name: memberData.name || user.displayName || user.email?.split('@')[0] || 'Usuário',
                      email: user.email?.toLowerCase() || '',
                      defaultClinicId: id,
                      role: memberData.role || 'colaborador',
                      updatedAt: serverTimestamp()
                    }, { merge: true });
                    
                    console.log("[ACCESS_CHECK] users profile repaired successfully. Reloading...");
                    window.location.reload();
                  } else {
                    setErrorMsg("Seu usuário autenticado ainda não foi cadastrado como membro desta clínica.");
                  }
                } catch (err: any) {
                  console.error("[ACCESS_CHECK] Error:", err);
                  setErrorMsg(`Erro ao acessar clínica: ${err.message}`);
                } finally {
                  setIsRecovering(false);
                }
              }}
              disabled={isRecovering}
              className="w-full py-4 bg-teal-50 text-teal-700 border border-teal-100 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <div className="w-2 h-2 bg-teal-500 rounded-full animate-pulse"></div>
              {isRecovering ? 'ACESSANDO...' : 'Acessar Clínica l9GzEcXT...Vhe'}
            </button>

            {!showRecover ? (
              <button 
                onClick={() => setShowRecover(true)}
                className="w-full text-center text-[10px] font-black text-slate-400 uppercase tracking-widest hover:underline"
              >
                Tem outro ID de clínica? Vincular
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID DA CLÍNICA</span>
                  <button onClick={() => setShowRecover(false)} className="text-[10px] text-rose-500 font-bold uppercase">Fechar</button>
                </div>
                <div className="flex gap-2">
                  <input 
                    value={recoverId}
                    onChange={(e) => setRecoverId(e.target.value)}
                    placeholder="Colar ID aqui..."
                    className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none font-mono"
                  />
                  <button 
                    onClick={handleRecover}
                    disabled={isRecovering || !recoverId}
                    className="px-6 py-3 bg-teal-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                  >
                    OK
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 p-4 bg-rose-50 border border-rose-100 rounded-2xl space-y-2">
            <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1 font-mono">Debug: {user?.email}</p>
            <button 
              onClick={async () => {
                try {
                  await logout();
                } catch (err) {
                  console.error("Erro ao deslogar:", err);
                }
              }}
              className="w-full py-2.5 bg-rose-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm hover:bg-rose-700 transition-all text-center"
            >
              SAIR DA CONTA / ENTRAR COM OUTRO E-MAIL
            </button>
            <button 
              onClick={() => {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
              }}
              className="w-full py-2.5 bg-white text-rose-600 border border-rose-100 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm hover:bg-rose-600 hover:text-white transition-all"
            >
              LIMPAR CACHE E RESETAR APP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
