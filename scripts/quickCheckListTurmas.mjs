import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, getDocs } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();
const CLINIC = "qc-clinic";
const app = initializeApp(firebaseConfig, "qc1");
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);
let user;
try { user = (await createUserWithEmailAndPassword(auth, "qc.prof@verify.local", "TestPass123!")).user; }
catch (e) { user = (await signInWithEmailAndPassword(auth, "qc.prof@verify.local", "TestPass123!")).user; }
await adminDb.doc(`clinics/${CLINIC}/education_turmas/t1`).set({ id: "t1", clinicId: CLINIC, courseId: "c1", name: "T1", status: "em_andamento" });
await adminDb.doc(`clinics/${CLINIC}/education_turmas/t1/staff/${user.uid}`).set({ uid: user.uid, role: "professor", assignedBy: "admin", active: true });
await adminDb.doc(`clinics/${CLINIC}/education_turmas/t2`).set({ id: "t2", clinicId: CLINIC, courseId: "c1", name: "T2 (nao e staff dessa)", status: "em_andamento" });
try {
  const snap = await getDocs(collection(db, "clinics", CLINIC, "education_turmas"));
  console.log("list SUCCESS, docs:", snap.size, snap.docs.map(d=>d.id));
} catch (err) {
  console.log("list FAILED:", err.code, err.message);
}
process.exit(0);
