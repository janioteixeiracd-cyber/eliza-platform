import React, { useState, useEffect } from 'react';
import { 
  GraduationCap, 
  Layers, 
  Users, 
  HeartPulse, 
  BrainCircuit, 
  FileText, 
  Award, 
  Settings, 
  UserCheck, 
  ShieldAlert, 
  Calendar,
  Sparkles,
  ClipboardCheck,
  Check,
  Activity,
  LogOut,
  FolderLock,
  FileCheck,
  ClipboardList,
  Camera,
  MessageSquare,
  Clock,
  Plus,
  Eye,
  Trash2,
  Lock,
  Compass,
  PenTool,
  DollarSign
} from 'lucide-react';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  updateDoc, 
  serverTimestamp,
  where,
  getDocs,
  collectionGroup
} from 'firebase/firestore';

import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { getGenAI } from '../lib/gemini';

// Components imports
import EducationDashboard from './education/EducationDashboard';
import CourseManager from './education/CourseManager';
import ModelPatientManager from './education/ModelPatientManager';
import StudentManager from './education/StudentManager';
import EducationAI from './education/EducationAI';
import DocumentsCertificates from './education/DocumentsCertificates';
import InteractivePlanningCanvas from './education/InteractivePlanningCanvas';
import StudentCasesManager from './education/StudentCasesManager';
import StudentSimulationPortal from './education/StudentSimulationPortal';
import ProfessorPlanningDemo from './education/ProfessorPlanningDemo';
import EducationScheduler from './education/EducationScheduler';
import EducationFinancePanel from './education/EducationFinancePanel';

export default function EducationView() {
  const { user, profile, clinic } = useAuth();
  
  // Tab control states
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  
  // Custom Persona Simulation (Simular visualização de aluno)
  const [isStudentSimulationActive, setIsStudentSimulationActive] = useState<boolean>(false);
  const [simulatedStudentId, setSimulatedStudentId] = useState<string>('');

  // Firestore real-time synchronized arrays
  const [courses, setCourses] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [procedures, setProcedures] = useState<any[]>([]);
  const [patients, setPatients] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [studentCases, setStudentCases] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);

  // Interactive drawings states
  const [activePlanningImage, setActivePlanningImage] = useState<{ id: string; category: string; url: string; item: any } | null>(null);

  // 1. Hook up active Firestore snapshot bindings when clinic mounts
  useEffect(() => {
    if (!clinic?.id) return;

    // Courses synchronization
    const unsubCourses = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_courses')), (snap) => {
      setCourses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded courses", err));

    // Modules synchronization
    const unsubModules = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_modules')), (snap) => {
      setModules(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded modules", err));

    // Procedures synchronization
    const unsubProcedures = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_procedures')), (snap) => {
      setProcedures(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded procedures", err));

    // Model Patients synchronization
    const unsubPatients = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_patients')), (snap) => {
      setPatients(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded model patients", err));

    // Students synchronization
    const unsubStudents = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_students')), (snap) => {
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded students", err));

    // Cases synchronization
    const unsubCases = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_student_cases')), (snap) => {
      setStudentCases(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded cases", err));

    // Audit logs synchronization
    const unsubLogs = onSnapshot(query(collection(db, 'clinics', clinic.id, 'education_logs')), (snap) => {
      setAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    }, (err) => console.error("Error loaded audit logs", err));

    // Regular clinic team members list
    const unsubStaff = onSnapshot(query(collection(db, 'clinics', clinic.id, 'members')), (snap) => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error("Error loaded team members", err));

    return () => {
      unsubCourses();
      unsubModules();
      unsubProcedures();
      unsubPatients();
      unsubStudents();
      unsubCases();
      unsubLogs();
      unsubStaff();
    };
  }, [clinic?.id]);

  // Log automated action helper
  const logEducationActivity = async (typeOrObj: any, maybeDetails?: string) => {
    if (!clinic?.id || !user) return;
    const type = typeof typeOrObj === 'object' ? typeOrObj.type : typeOrObj;
    const details = typeof typeOrObj === 'object' ? typeOrObj.details : maybeDetails;
    try {
      await addDoc(collection(db, 'clinics', clinic.id, 'education_logs'), {
        type,
        userId: user.uid,
        userName: profile?.name || user.email || 'Operador',
        userEmail: user.email || '',
        timestamp: serverTimestamp(),
        details: details || ''
      });
    } catch (err) {
      console.error("Error log education:", err);
    }
  };

  // ────────────────────────────────────────────────────────
  // DATABASE PERSISTENCE ROUTINES
  // ────────────────────────────────────────────────────────

  // Save/Edit Course
  const handleSaveCourse = async (coursePayload: any) => {
    if (!clinic?.id) return;
    try {
      const isNew = !coursePayload.id;
      const ref = isNew ? doc(collection(db, 'clinics', clinic.id, 'education_courses')) : doc(db, 'clinics', clinic.id, 'education_courses', coursePayload.id);
      
      const payload = {
        ...coursePayload,
        id: ref.id,
        createdAt: isNew ? serverTimestamp() : coursePayload.createdAt || null
      };

      await setDoc(ref, payload, { merge: true });
      await logEducationActivity(
        isNew ? '[COURSE_CREATED]' : '[COURSE_UPDATED]', 
        `${isNew ? 'Criou' : 'Editou'} o curso: ${payload.name}`
      );
    } catch (err) {
      console.error("Error saving course", err);
    }
  };

  // Delete Course
  const handleDeleteCourse = async (courseId: string) => {
    if (!clinic?.id) return;
    try {
      const course = courses.find(c => c.id === courseId);
      await deleteDoc(doc(db, 'clinics', clinic.id, 'education_courses', courseId));
      await logEducationActivity('[COURSE_ERROR]', `Excluiu o curso de ID ${courseId} (${course?.name || 'Não identificado'})`);
    } catch (err) {
      console.error("Error deleting course", err);
    }
  };

  // Save/Edit Module
  const handleSaveModule = async (modulePayload: any) => {
    if (!clinic?.id) return;
    try {
      const isNew = !modulePayload.id;
      const ref = isNew ? doc(collection(db, 'clinics', clinic.id, 'education_modules')) : doc(db, 'clinics', clinic.id, 'education_modules', modulePayload.id);

      const payload = {
        ...modulePayload,
        id: ref.id,
        createdAt: isNew ? serverTimestamp() : modulePayload.createdAt || null
      };

      await setDoc(ref, payload, { merge: true });
      await logEducationActivity(
        '[COURSE_MODULE_CREATED]', 
        `Adicionou/Editou módulo "${payload.name}" ao curso de ID: ${payload.courseId}`
      );
    } catch (err) {
      console.error("Error saving module", err);
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!clinic?.id) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'education_modules', moduleId));
      await logEducationActivity('[COURSE_ERROR]', `Excluiu o módulo acadêmico de ID ${moduleId}`);
    } catch (err) {
      console.error("Error deleting module", err);
    }
  };

  // Save/Edit Procedure
  const handleSaveProcedure = async (procPayload: any) => {
    if (!clinic?.id) return;
    try {
      const isNew = !procPayload.id;
      const ref = isNew ? doc(collection(db, 'clinics', clinic.id, 'education_procedures')) : doc(db, 'clinics', clinic.id, 'education_procedures', procPayload.id);

      const payload = {
        ...procPayload,
        id: ref.id,
        createdAt: isNew ? serverTimestamp() : procPayload.createdAt || null
      };

      await setDoc(ref, payload, { merge: true });
      await logEducationActivity(
        isNew ? '[COURSE_PROCEDURE_PLANNED]' : '[COURSE_PROCEDURE_COMPLETED]', 
        `${isNew ? 'Agendou' : 'Concluiu/Evoluiu'} prática de: ${payload.procedure} para paciente ${payload.patientName}`
      );
    } catch (err) {
      console.error("Error saving procedure", err);
    }
  };

  const handleDeleteProcedure = async (procId: string) => {
    if (!clinic?.id) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'education_procedures', procId));
    } catch (err) {
      console.error("Error deleting procedure", err);
    }
  };

  // Save/Edit Patient-Modelo
  const handleSavePatient = async (patPayload: any) => {
    if (!clinic?.id) return;
    try {
      const isNew = !patPayload.id;
      const ref = isNew ? doc(collection(db, 'clinics', clinic.id, 'education_patients')) : doc(db, 'clinics', clinic.id, 'education_patients', patPayload.id);

      const payload = {
        ...patPayload,
        id: ref.id,
        createdAt: isNew ? serverTimestamp() : patPayload.createdAt || null,
        updatedAt: serverTimestamp()
      };

      await setDoc(ref, payload, { merge: true });
      await logEducationActivity(
        isNew ? (payload.patientClinicId ? '[COURSE_PATIENT_LINKED_FROM_CLINIC]' : '[COURSE_PATIENT_CREATED]') : '[COURSE_UPDATED]', 
        `${isNew ? 'Vinculou' : 'Editou'} prontuário de paciente-modelo: ${payload.name}`
      );
    } catch (err) {
      console.error("Error saving patient-modelo", err);
    }
  };

  const handleDeletePatient = async (patientId: string) => {
    if (!clinic?.id) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'education_patients', patientId));
      await logEducationActivity('[COURSE_ERROR]', `Excluiu paciente-modelo de ID ${patientId}`);
    } catch (err) {
      console.error("Error deleting patient", err);
    }
  };

  // Save/Edit Student
  const handleSaveStudent = async (studentPayload: any) => {
    if (!clinic?.id) return;
    try {
      const isNew = !studentPayload.id;
      let tempPassword = studentPayload.tempPassword || '';
      let uid = studentPayload.id;

      if (!tempPassword) {
        const randomDigits = Math.floor(10000 + Math.random() * 90000);
        tempPassword = `Eliza${randomDigits}@`;
      }

      // Proactively resolve existing UID client-side to associate properly
      let resolvedExistingUid = studentPayload.authUid || studentPayload.id || '';
      if (!resolvedExistingUid && studentPayload.email) {
        try {
          const emailLower = studentPayload.email.trim().toLowerCase();
          const studentQ = query(
            collectionGroup(db, 'education_students'),
            where('emailLowercase', '==', emailLower)
          );
          const studentSnap = await getDocs(studentQ);
          if (!studentSnap.empty) {
            resolvedExistingUid = studentSnap.docs[0].id;
          } else {
            const usersQ = query(
              collection(db, 'users'),
              where('emailLowercase', '==', emailLower)
            );
            const usersSnap = await getDocs(usersQ);
            if (!usersSnap.empty) {
              resolvedExistingUid = usersSnap.docs[0].id;
            }
          }
        } catch (findErr) {
          console.warn("[STUDENT_AUTH] Optional lookup failed:", findErr);
        }
      }

      console.log("[STUDENT_AUTH] Triggering secure backend student get-or-create/sync for:", studentPayload.email);
      const res = await fetch('/api/education/student/get-or-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: studentPayload.email?.trim(),
          tempPassword: tempPassword,
          name: studentPayload.name,
          phone: studentPayload.phone || '',
          clinicId: clinic.id,
          existingUid: resolvedExistingUid
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Falha na resposta do servidor.');
      }

      const { authUid } = await res.json();
      console.log("[STUDENT_AUTH] Backend sync complete. Resolved UID:", authUid);
      uid = authUid;

      const ref = doc(db, 'clinics', clinic.id, 'education_students', uid);

      const payload = {
        ...studentPayload,
        id: uid,
        authUid: uid,
        emailLowercase: studentPayload.email?.trim()?.toLowerCase(),
        tempPassword,
        status: studentPayload.status || 'ativo',
        createdAt: isNew ? serverTimestamp() : studentPayload.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      await setDoc(ref, payload, { merge: true });

      // Align users/{uid} globally with aluno role so they can login securely
      try {
        const userRef = doc(db, 'users', uid);
        await setDoc(userRef, {
          uid: uid,
          name: studentPayload.name || studentPayload.email?.trim()?.split('@')[0] || '',
          email: studentPayload.email?.trim(),
          emailLowercase: studentPayload.email?.trim()?.toLowerCase(),
          phone: studentPayload.phone || '',
          role: 'aluno',
          defaultClinicId: clinic.id,
          tempPassword: tempPassword,
          status: studentPayload.status || 'ativo',
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log("[STUDENT_AUTH] Aligned /users profile client-side for Student UID:", uid);
      } catch (userProfileErr) {
        console.error("Failed to write user profile client-side:", userProfileErr);
      }

      // Delete old mismatched student document if ID changed during linking or edit
      if (studentPayload.id && studentPayload.id !== uid) {
        await deleteDoc(doc(db, 'clinics', clinic.id, 'education_students', studentPayload.id));
      }

      await logEducationActivity(
        isNew ? '[COURSE_STUDENT_CREATED]' : '[COURSE_STUDENT_LINKED]', 
        `${isNew ? 'Matriculou' : 'Atualizou permissões do'} Aluno: ${payload.name} com e-mail ${payload.email}`
      );

      // Present visual credentials modal alert
      if (isNew) {
        const shareMsg = encodeURIComponent(
          `Olá ${payload.name}!\nSeu acesso ao Portal do Aluno da ELIZA Education foi liberado!\n\n📧 Usuário: ${payload.email}\n🔑 Senha Temporária: ${tempPassword}\n\nAcesse agora e comece seus estudos!`
        );
        const waLink = `https://wa.me/${payload.phone?.replace(/[^0-9]/g, '')}?text=${shareMsg}`;
        
        const modalContainer = document.createElement('div');
        modalContainer.id = 'credentials-alert-modal';
        modalContainer.className = 'fixed inset-0 bg-slate-900/80 z-[110] flex items-center justify-center p-4 backdrop-blur-xs select-none';
        modalContainer.innerHTML = `
          <div class="bg-white rounded-[2rem] border border-slate-200 p-8 w-full max-w-sm text-center space-y-5 animate-fade-in text-slate-800">
            <div class="w-16 h-16 bg-teal-50 text-teal-600 rounded-3xl flex items-center justify-center text-3xl mx-auto shadow-sm">🎓</div>
            <div class="space-y-1">
              <h3 class="text-sm font-black uppercase tracking-wider text-slate-900">Acesso Criado com Sucesso!</h3>
              <p class="text-[11px] text-slate-500 font-bold uppercase">Credenciais do Aluno enviadas para o sistema</p>
            </div>
            
            <div class="bg-slate-50 border border-slate-150 p-4 rounded-2xl text-left text-xs font-semibold space-y-1.5">
              <p class="text-slate-400 text-[9px] uppercase tracking-widest leading-none mb-1">Dados de Acesso:</p>
              <p><span class="text-slate-450 uppercase">Nome:</span> <span class="font-extrabold text-slate-800">${payload.name}</span></p>
              <p><span class="text-slate-450 uppercase">Login:</span> <span class="font-extrabold text-teal-700">${payload.email}</span></p>
              <p><span class="text-slate-450 uppercase">Senha Prov.:</span> <span class="font-extrabold text-indigo-700">${tempPassword}</span></p>
            </div>

            <div class="flex flex-col gap-2">
              <a href="${waLink}" target="_blank" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest block text-center shadow">
                Enviar via WhatsApp
              </a>
              <button onclick="navigator.clipboard.writeText('Login: ${payload.email}\\nSenha: ${tempPassword}'); alert('Copiado para a área de transferência!');" class="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                Copiar Login & Senha
              </button>
              <button onclick="document.getElementById('credentials-alert-modal').remove()" class="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-[10px] text-slate-400 font-bold uppercase tracking-widest rounded-xl mt-1">
                Concluir
              </button>
            </div>
          </div>
        `;
        document.body.appendChild(modalContainer);
      } else {
        alert("Dados e permissões do aluno salvos com sucesso, e credenciais Firebase Auth sincronizadas!");
      }
    } catch (err: any) {
      console.error("[STUDENT_AUTH_ERR] Failed to save student:", err);
      alert(`Erro ao salvar dados do aluno e configurar credenciais Firebase: ${err.message}`);
    }
  };

  const handleRecreateStudentAccess = async (student: any) => {
    if (!clinic?.id || !student.email) return;
    try {
      console.log(`[EDUCATION_AUTH_CREATE_START] Recreating auth access for student:`, student.email);
      let tempPassword = student.tempPassword;
      if (!tempPassword) {
        const randomDigits = Math.floor(10000 + Math.random() * 90000);
        tempPassword = `Eliza${randomDigits}@`;
      }

      let existingUid = student.authUid || student.id || '';
      if (!existingUid) {
        try {
          const emailLower = student.email.trim().toLowerCase();
          const studentQ = query(
            collectionGroup(db, 'education_students'),
            where('emailLowercase', '==', emailLower)
          );
          const studentSnap = await getDocs(studentQ);
          if (!studentSnap.empty) {
            existingUid = studentSnap.docs[0].id;
          } else {
            const usersQ = query(
              collection(db, 'users'),
              where('emailLowercase', '==', emailLower)
            );
            const usersSnap = await getDocs(usersQ);
            if (!usersSnap.empty) {
              existingUid = usersSnap.docs[0].id;
            }
          }
        } catch (findErr) {
          console.warn("[STUDENT_AUTH] Optional lookup failed:", findErr);
        }
      }
      
      const res = await fetch('/api/education/student/get-or-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: student.email,
          tempPassword: tempPassword,
          name: student.name,
          phone: student.phone || '',
          clinicId: clinic.id,
          existingUid: existingUid
        })
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Erro na resposta do servidor.');
      }
      
      const { authUid } = await res.json();
      console.log(`[EDUCATION_STUDENT_AUTHUID_SAVED] User authUid mapped / recreated:`, authUid);
      
      // Update student document in Firestore to have correct authUid and lowercase email
      const ref = doc(db, 'clinics', clinic.id, 'education_students', authUid);
      await setDoc(ref, {
        ...student,
        id: authUid,
        authUid: authUid,
        emailLowercase: student.email.trim().toLowerCase(),
        tempPassword: tempPassword,
        status: 'ativo',
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Update high-level /users profile as well
      try {
        const userRef = doc(db, 'users', authUid);
        await setDoc(userRef, {
          uid: authUid,
          name: student.name,
          email: student.email,
          emailLowercase: student.email.trim().toLowerCase(),
          phone: student.phone || '',
          role: 'aluno',
          defaultClinicId: clinic.id,
          tempPassword: tempPassword,
          status: 'ativo',
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log("[STUDENT_AUTH] Aligned /users profile client-side for recreation");
      } catch (userErr) {
        console.error("Failed to write user profile client-side during recreate", userErr);
      }
      
      // Also delete the old mismatched/misaligned student document if its ID was different
      if (student.id !== authUid) {
        await deleteDoc(doc(db, 'clinics', clinic.id, 'education_students', student.id));
      }
      
      alert(`Acesso recriado com sucesso!\n\nEmail: ${student.email}\nSenha provisória: ${tempPassword}`);
    } catch (err: any) {
      console.error("Error recreating student access:", err);
      alert(`Falha ao recriar acesso: ${err.message}`);
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (!clinic?.id) return;
    try {
      await deleteDoc(doc(db, 'clinics', clinic.id, 'education_students', studentId));
      await logEducationActivity('[COURSE_ERROR]', `Excluiu cadastro de estudante ID ${studentId}`);
    } catch (err) {
      console.error("Error deleting student", err);
    }
  };

  // Save/Submit student case / photos (Base64 scaled formats fit in firestore snugly)
  const handleSaveStudentCase = async (casePayload: any) => {
    if (!clinic?.id || !user) return;
    try {
      const isNew = !casePayload.id;
      const ref = isNew ? doc(collection(db, 'clinics', clinic.id, 'education_student_cases')) : doc(db, 'clinics', clinic.id, 'education_student_cases', casePayload.id);
      
      const payload = {
        ...casePayload,
        id: ref.id,
        studentId: user?.uid,
        studentName: profile?.name || user?.email || 'Estudante',
        studentEmail: user?.email || '',
        status: casePayload.status || 'pending',
        createdAt: isNew ? serverTimestamp() : casePayload.createdAt || null,
        updatedAt: serverTimestamp()
      };

      await setDoc(ref, payload, { merge: true });
      await logEducationActivity('[CASE_SUBMITTED]', `Aluno ${payload.studentName} enviou/atualizou fotos do caso: ${payload.patientCode}`);
      alert("Caso Clínico escolar submetido com sucesso para auditoria do professor!");
    } catch (err: any) {
      console.error("Error saving student case", err);
      alert("Falha ao salvar caso: " + err.message);
    }
  };

  // Update student case status & feedback (professor grading / standard notes)
  const handleUpdateCaseStatus = async (caseId: string, status: 'pending' | 'approved' | 'adjust' | 'rejected', feedback: string) => {
    if (!clinic?.id) return;
    try {
      const ref = doc(db, 'clinics', clinic.id, 'education_student_cases', caseId);
      await updateDoc(ref, {
        status,
        professorFeedback: feedback,
        updatedAt: serverTimestamp()
      });
      await logEducationActivity('[CASE_AUDITED]', `Professor revisou caso clínico de ID: ${caseId} para status: ${status}`);
    } catch (err: any) {
      console.error("Error auditing student case", err);
      throw err;
    }
  };

  // Save interactive facial planning markings (individual or all image categories)
  const handleSaveCaseDrawing = async (caseId: string, category: string, drawingsJson: string, base64Overlay?: string) => {
    if (!clinic?.id) return;
    try {
      const ref = doc(db, 'clinics', clinic.id, 'education_student_cases', caseId);
      const drawingsKey = `drawings.${category}`;
      const overlayKey = `overlays.${category}`;
      
      const updatePayload: any = {
        [drawingsKey]: drawingsJson,
        updatedAt: serverTimestamp()
      };
      
      if (base64Overlay) {
        updatePayload[overlayKey] = base64Overlay;
      }

      await updateDoc(ref, updatePayload);
      await logEducationActivity('[CASE_PLANNING_SAVED]', `Salvou planejamento geométrico de HOF (${category}) no caso: ${caseId}`);
      alert("Planejamento Facial salvo com sucesso!");
    } catch (err: any) {
      console.error("Error saving case drawings:", err);
      alert("Falha ao salvar traçados: " + err.message);
    }
  };

  // ────────────────────────────────────────────────────────
  // METRICS COMPILER
  // ────────────────────────────────────────────────────────
  const activeCoursesCount = courses.filter(c => c.status === 'em_andamento').length;
  
  // Find next module by date
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const futureModules = modules
    .filter(m => m.date >= todayDateStr)
    .sort((a,b) => a.date.localeCompare(b.date));
  const nextModuleName = futureModules[0]?.name || '';
  const nextModuleDate = futureModules[0]?.date || '';

  const activeStudentsCount = students.filter(s => s.status === 'ativo').length;
  
  // Count patients/procedures selection matching today's modules
  const todayModules = modules.filter(m => m.date === todayDateStr);
  const todayModulesIds = todayModules.map(m => m.id);
  const patientsTodayCount = patients.filter(p => p.status === 'confirmado' && todayModulesIds.includes(p.moduleId)).length;
  
  const proceduresTodayCount = procedures.filter(p => todayModulesIds.includes(p.moduleId)).length;

  // Calculando pendências
  // Clinical pendings: Patient missing imageConsentSigned or tcleSigned
  const clinicalPendingsCount = patients.filter(p => !p.imageConsentSigned || !p.tcleSigned).length;
  // Admin pendings is mocked/compiled as a simulation matching student price comission boundaries
  const adminPendingsCount = students.filter(s => s.status === 'suspenso').length;

  // Recent logs list
  const recentLogs = auditLogs.slice(0, 12);

  // Simulated student details matching persona selection
  const currentSimulatedStudent = students.find(s => s.id === simulatedStudentId);

  // ────────────────────────────────────────────────────────
  // DETERMINING SYSTEM ACCESS GATES
  // �  // Render Student Panel UI separate
  if (isStudentSimulationActive) {
    const activeStudentObject = currentSimulatedStudent || students[0];
    
    // Fallback if no students enrolled
    if (!activeStudentObject) {
      return (
        <div className="bg-[#f8fafc] min-h-[80vh] p-8 sm:p-12 flex items-center justify-center">
          <div className="bg-white p-10 rounded-[2rem] border border-slate-205 max-w-md text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">Simulação Indisponível</h3>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">Nenhum profissional cadastrado como estudante nesta clínica-escola. Cadastre um aluno primeiro para liberar a simulação pedagógica!</p>
            <button 
              onClick={() => setIsStudentSimulationActive(false)}
              className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 cursor-pointer"
            >
              Voltar ao Painel
            </button>
          </div>
        </div>
      );
    }

    return (
      <StudentSimulationPortal
        activeStudentObject={activeStudentObject}
        students={students}
        courses={courses}
        modules={modules}
        procedures={procedures}
        studentCases={studentCases}
        setIsStudentSimulationActive={setIsStudentSimulationActive}
        setSimulatedStudentId={setSimulatedStudentId}
        handleSaveStudentCase={handleSaveStudentCase}
        handleSaveCaseDrawing={handleSaveCaseDrawing}
      />
    );
  }

  // Regular coordinates tabs
  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar scroll-smooth space-y-6 text-left max-w-7xl mx-auto pb-32 p-6 md:px-8">
      
      {/* Simulation persona setup block */}
      <div className="bg-white border border-slate-201 p-4 px-6 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-semibold">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-teal-650" />
          <span>Configuração de Perfil de Laboratório Pessoal</span>
        </div>

        <div className="flex gap-2 items-center">
          <select 
            value={simulatedStudentId}
            onChange={(e) => setSimulatedStudentId(e.target.value)}
            className="p-1 px-2 text-[10.5px] border border-slate-205 rounded bg-slate-50 outline-none"
          >
            <option value="">-- Escolher Aluno --</option>
            {students.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s?.batchName || 'Sem Turma'})</option>
            ))}
          </select>
          
          <button 
            type="button"
            onClick={() => {
              setIsStudentSimulationActive(true);
            }}
            disabled={!simulatedStudentId}
            className="p-1.5 px-3 bg-teal-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-teal-700 pointer transition-all shrink-0 disabled:opacity-50"
          >
            Simular Aluno
          </button>
        </div>
      </div>

      {/* Navigation tab selector */}
      <div className="flex border-b border-slate-200 pb-3 gap-6 overflow-x-auto select-none custom-scrollbar pb-1">
        {[
          { key: 'dashboard', label: 'Dashboard', icon: GraduationCap },
          { key: 'courses', label: 'Cursos & Grade', icon: Layers },
          { key: 'patients', label: 'Pacientes-Modelo', icon: HeartPulse },
          { key: 'students', label: 'Gestão Alunos', icon: Users },
          { key: 'student_cases', label: 'Casos dos Alunos', icon: FileCheck },
          { key: 'demo_planning', label: 'Lousa de Diagnóstico', icon: PenTool },
          { key: 'agenda', label: 'Agenda', icon: Calendar },
          { key: 'finance', label: 'Financeiro', icon: DollarSign },
          { key: 'ai_assistant', label: 'ELIZA IA', icon: BrainCircuit },
          { key: 'documents', label: 'Termos & Certidões', icon: FileText }
        ].map(tab => (
          <button 
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`pb-2.5 text-[11px] font-black uppercase tracking-widest outline-none border-b-2 transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === tab.key 
                ? 'text-teal-600 border-teal-600 font-black' 
                : 'text-slate-400 hover:text-slate-600 border-transparent'
            }`}
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab bodies switcher */}
      {activeTab === 'dashboard' && (
        <EducationDashboard 
          courses={courses}
          students={students}
          patients={patients}
          metrics={{
            activeCoursesCount,
            nextModuleDate,
            nextModuleName,
            activeStudentsCount,
            patientsTodayCount,
            proceduresTodayCount,
            clinicalPendingsCount,
            adminPendingsCount
          }}
          onNavigateTab={setActiveTab}
          recentLogs={recentLogs}
        />
      )}

      {activeTab === 'courses' && (
        <CourseManager 
          courses={courses}
          onSaveCourse={handleSaveCourse}
          onDeleteCourse={handleDeleteCourse}
          modules={modules}
          onSaveModule={handleSaveModule}
          onDeleteModule={handleDeleteModule}
          procedures={procedures}
          onSaveProcedure={handleSaveProcedure}
          onDeleteProcedure={handleDeleteProcedure}
          patients={patients}
          staff={staff}
        />
      )}

      {activeTab === 'patients' && (
        <ModelPatientManager 
          clinicId={clinic?.id || ''}
          patients={patients}
          courses={courses}
          modules={modules}
          onSavePatient={handleSavePatient}
          onDeletePatient={handleDeletePatient}
          isStudentMode={false}
        />
      )}

      {activeTab === 'students' && (
        <StudentManager 
          students={students}
          courses={courses}
          onSaveStudent={handleSaveStudent}
          onDeleteStudent={handleDeleteStudent}
          onRecreateStudentAccess={handleRecreateStudentAccess}
        />
      )}

      {activeTab === 'student_cases' && (
        <StudentCasesManager 
          cases={studentCases}
          courses={courses}
          onUpdateCaseStatus={handleUpdateCaseStatus}
          onTriggerProfessorDrawing={(item) => {
            setActivePlanningImage({ id: item.id, category: 'frontal', url: item.images.frontal, item });
          }}
        />
      )}

      {activeTab === 'agenda' && (
        <EducationScheduler 
          courses={courses}
          modules={modules}
          procedures={procedures}
          patients={patients}
          onNavigateTab={setActiveTab}
        />
      )}

      {activeTab === 'finance' && (
        <EducationFinancePanel 
          clinicId={clinic?.id || ''}
          staff={staff}
          educationPatients={patients}
          courses={courses}
        />
      )}

      {activeTab === 'ai_assistant' && (
        <EducationAI 
          clinicId={clinic?.id || ''}
          courses={courses}
          onLogAction={logEducationActivity}
        />
      )}

      {activeTab === 'demo_planning' && (
        <ProfessorPlanningDemo 
          onLogAction={logEducationActivity}
        />
      )}

      {activeTab === 'documents' && (
        <DocumentsCertificates 
          courses={courses}
          students={students}
          patients={patients}
          staff={staff}
        />
      )}

      {/* Interactive canvas editor portal overlay for professor */}
      {activePlanningImage && (
        <div className="fixed inset-0 bg-slate-950/95 z-[105] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-5xl">
            <InteractivePlanningCanvas 
              imageUrl={activePlanningImage.url}
              initialDrawingsJson={activePlanningImage.item.drawings?.[activePlanningImage.category]}
              onSavePlanning={(drawingsJson, base64Overlay) => {
                handleSaveCaseDrawing(activePlanningImage.id, activePlanningImage.category, drawingsJson, base64Overlay);
                setActivePlanningImage(null);
              }}
              onClose={() => setActivePlanningImage(null)}
            />
            
            {/* Image Category Switcher bottom list */}
            <div className="flex justify-center gap-3 mt-4 select-none">
              {Object.entries(activePlanningImage.item.images || {}).map(([cat, url]) => {
                if (!url) return null;
                const tags: Record<string, string> = {
                  frontal: 'Frontal',
                  profileRight: 'Perfil Dir.',
                  profileLeft: 'Perfil Esq.',
                  smile: 'Sorriso',
                  intraoral: 'Intraoral',
                  other: 'Outra'
                };
                return (
                  <button
                    key={cat}
                    onClick={() => setActivePlanningImage({ ...activePlanningImage, category: cat, url: url as string, item: activePlanningImage.item })}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all border cursor-pointer ${
                      activePlanningImage.category === cat 
                        ? 'bg-teal-600 text-white border-teal-500 shadow'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {tags[cat] || cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
