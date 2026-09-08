import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Users, 
  Mail, 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ShieldCheck,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  writeBatch 
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';

export default function AcceptInviteView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const clinicId = searchParams.get('cid');

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadInvite() {
      if (!token || !clinicId) {
        setError('Link de convite inválido ou incompleto.');
        setLoading(false);
        return;
      }

      try {
        const inviteRef = doc(db, 'clinics', clinicId, 'invites', token);
        const inviteSnap = await getDoc(inviteRef);

        if (!inviteSnap.exists()) {
          setError('Este convite não existe ou já foi removido.');
          setLoading(false);
          return;
        }

        const data = inviteSnap.data();
        if (data.status !== 'pending') {
          setError(`Este convite já foi ${data.status === 'accepted' ? 'aceito' : 'cancelado'}.`);
          setLoading(false);
          return;
        }

        // Check expiration
        if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
          setError('Este convite expirou.');
          setLoading(false);
          return;
        }

        setInvite(data);
        setLoading(false);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `clinics/${clinicId}/invites/${token}`);
        setError('Ocorreu um erro ao carregar o convite.');
        setLoading(false);
      }
    }

    loadInvite();
  }, [token, clinicId]);

  const handleGoogleLogin = async () => {
    try {
      setProcessing(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setError('Erro ao autenticar com o Google.');
      setProcessing(false);
    }
  };

  const handleAcceptInvite = async () => {
    if (!user || !invite || !clinicId || !token) return;

    if ((user.email || '').toLowerCase() !== (invite.email || '').toLowerCase()) {
      setError(`Este convite foi enviado para ${invite.email}, mas você está logado como ${user.email}. Por favor, entre com a conta correta.`);
      return;
    }

    const path = `clinics/${clinicId}/accept_invite`;
    try {
      setProcessing(true);
      const batch = writeBatch(db);

      // 1. Create/Update User Profile
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        batch.set(userRef, {
          uid: user.uid,
          name: user.displayName || invite.name || 'Membro ELIZA',
          email: (user.email || '').toLowerCase(),
          photoURL: user.photoURL,
          defaultClinicId: clinicId,
          createdAt: serverTimestamp()
        });
      } else {
        batch.update(userRef, { defaultClinicId: clinicId });
      }

      // 2. Add as member to clinic
      const memberRef = doc(db, 'clinics', clinicId, 'members', user.uid);
      const isClinFallVal = ['dentist', 'dentist_gp', 'especialista', 'professional', 'clinical_professional', 'doctor', 'dentista', 'odontologista'].includes(invite.role?.toLowerCase() || '');
      batch.set(memberRef, {
        uid: user.uid,
        name: user.displayName || invite.name,
        email: (user.email || '').toLowerCase(),
        role: invite.role,
        joinedAt: serverTimestamp(),
        active: true,
        status: 'active',
        isClinicalProvider: invite.isClinicalProvider !== undefined ? invite.isClinicalProvider : isClinFallVal
      });

      // 2.5. Add as team_member to clinic
      const teamRef = doc(db, 'clinics', clinicId, 'team_members', user.uid);
      batch.set(teamRef, {
        id: user.uid,
        uid: user.uid,
        name: user.displayName || invite.name,
        displayName: user.displayName || invite.name,
        email: (user.email || '').toLowerCase(),
        role: invite.role,
        active: true,
        isClinicalProvider: invite.isClinicalProvider !== undefined ? invite.isClinicalProvider : isClinFallVal,
        isProfessional: invite.isClinicalProvider !== undefined ? invite.isClinicalProvider : isClinFallVal,
        isCommissionable: false,
        defaultCommissionPercent: 0,
        financial: {
          commissionPercent: 0,
          commissionEnabled: false,
          receiveFinancialSummary: false
        },
        attendance: {
          isProfessional: invite.isClinicalProvider !== undefined ? invite.isClinicalProvider : isClinFallVal
        },
        marketing: {
          enabled: false
        },
        secretary: {
          enabled: false
        },
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      });

      // 3. Mark invite as accepted
      const inviteRef = doc(db, 'clinics', clinicId, 'invites', token);
      batch.update(inviteRef, {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
        acceptedByUid: user.uid
      });

      await batch.commit();
      
      // Redirect to dashboard
      navigate(`/c/${invite.clinicSlug}/dashboard`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
      setError('Erro ao processar o aceite do convite.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Premium Header */}
      <nav className="p-8 flex justify-between items-center absolute top-0 w-full">
        <div className="flex items-center gap-3">
          <img src="/brand/eliza-wordmark-dark.png" alt="Eliza" className="h-9 w-auto object-contain" />
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center p-6 mt-12 mb-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl bg-white rounded-[3rem] shadow-2xl shadow-slate-200/50 border border-slate-100 overflow-hidden"
        >
          {error ? (
            <div className="p-12 text-center space-y-6">
              <div className="w-20 h-20 bg-rose-50 rounded-[2.5rem] flex items-center justify-center text-rose-500 mx-auto">
                <XCircle className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Ops! Algo deu errado</h2>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">{error}</p>
              <button 
                onClick={() => setError(null)}
                className="inline-flex items-center gap-2 text-teal-600 font-bold uppercase tracking-widest text-[10px] hover:underline"
              >
                Tentar carregar novamente
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Top Banner */}
              <div className="bg-teal-600 p-12 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                <div className="relative z-10">
                   <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[9px] font-bold uppercase tracking-widest mb-6">
                      <ShieldCheck className="w-3 h-3" /> Convite de Membro
                   </div>
                   <h1 className="text-3xl font-black tracking-tight leading-tight">
                     Você foi convidado para a equipe da <span className="text-teal-200">{invite.clinicName}</span>
                   </h1>
                </div>
              </div>

              <div className="p-12 space-y-10">
                {/* Info Card */}
                <div className="flex items-start gap-6 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Users className="w-8 h-8 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">{invite.name}</h3>
                    <p className="text-xs text-slate-500 font-medium mb-3">{invite.email}</p>
                    <div className="flex items-center gap-2 px-2 py-1 bg-teal-100/50 text-teal-700 rounded-lg w-fit">
                      <CheckCircle2 className="w-3 h-3" />
                      <span className="text-[9px] font-black uppercase tracking-widest">{invite.role}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Para continuar, autentique sua conta</p>
                  
                  {!user ? (
                    <div className="space-y-3">
                      <button 
                        onClick={handleGoogleLogin}
                        disabled={processing}
                        className="w-full flex items-center justify-center gap-4 bg-white border border-slate-200 p-4 rounded-2xl shadow-sm hover:bg-slate-50 transition-all group"
                      >
                         <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                         <span className="text-xs font-bold text-slate-700">Continuar com Google</span>
                         <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-teal-600 group-hover:translate-x-1 transition-all" />
                      </button>
                      <button 
                        disabled={processing}
                        className="w-full p-4 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        Ou crie conta com e-mail e senha
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="p-6 border-2 border-teal-600/20 bg-teal-50/30 rounded-3xl flex items-center justify-between">
                         <div className="flex items-center gap-4">
                           {user.photoURL ? (
                             <img src={user.photoURL} className="w-12 h-12 rounded-2xl border-2 border-white shadow-sm" alt="Avatar" />
                           ) : (
                             <div className="w-12 h-12 bg-teal-600 rounded-2xl flex items-center justify-center text-white font-black">
                               {user.displayName?.charAt(0) || user.email?.charAt(0)}
                             </div>
                           )}
                           <div>
                             <p className="text-xs font-black text-slate-900">{user.displayName || 'Usuário ELIZA'}</p>
                             <p className="text-[10px] text-slate-500 font-medium">{user.email}</p>
                           </div>
                         </div>
                         <button 
                          onClick={() => signOut(auth)}
                          className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-rose-500 transition-all"
                         >
                           <LogOut className="w-4 h-4" />
                         </button>
                      </div>

                      <button 
                        onClick={handleAcceptInvite}
                        disabled={processing}
                        className="w-full bg-slate-900 text-white p-5 rounded-[1.5rem] font-black text-[11px] uppercase tracking-widest shadow-xl hover:bg-slate-800 transition-all flex items-center justify-center gap-3 active:scale-95"
                      >
                        {processing ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <>
                            Aceitar Convite e Acessar Plataforma
                            <ChevronRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-slate-100 flex items-center justify-center gap-3">
                  <ShieldCheck className="w-4 h-4 text-teal-600" />
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Ambiente Seguro & Criptografado</p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </main>

      <footer className="p-8 text-center">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">© 2026 ELIZA Intelligence Systems</p>
      </footer>
    </div>
  );
}
