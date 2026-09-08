import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, query, where, orderBy, getDocs } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();
const CLINIC = "dbg2-clinic";
const TURMA = "dbg2-turma";
const ACT = "act1";
const app = initializeApp(firebaseConfig, "dbg2");
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
let user;
try { user = (await createUserWithEmailAndPassword(auth, "dbg2.student@verify.local", "TestPass123!")).user; }
catch (e) { user = (await signInWithEmailAndPassword(auth, "dbg2.student@verify.local", "TestPass123!")).user; }

await adminDb.doc(`clinics/${CLINIC}/education_turmas/${TURMA}`).set({ id: TURMA, clinicId: CLINIC, courseId: "c1", name: "T", status: "em_andamento" });
await adminDb.doc(`clinics/${CLINIC}/education_enrollments/${TURMA}_${user.uid}`).set({ clinicId: CLINIC, studentId: user.uid, turmaId: TURMA, courseId: "c1", status: "ativa" });
await adminDb.doc(`clinics/${CLINIC}/education_activities/${ACT}`).set({ clinicId: CLINIC, turmaId: TURMA, courseId: "c1", templateId: "toxina_botulinica", title: "A1", status: "published" });
await adminDb.doc(`clinics/${CLINIC}/education_activities/${ACT}/attempts/att1`).set({ clinicId: CLINIC, activityId: ACT, turmaId: TURMA, studentId: user.uid, status: "draft", createdAt: new Date() });

try {
  const snap = await getDocs(query(collection(db, "clinics", CLINIC, "education_activities", ACT, "attempts"), where("studentId", "==", user.uid), orderBy("createdAt", "desc")));
  console.log("LIST SUCCESS:", snap.size);
} catch (err) {
  console.log("LIST FAILED:", err.code, "|", err.message);
}
process.exit(0);
