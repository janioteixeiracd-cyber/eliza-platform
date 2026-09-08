/**
 * Fase C (recebimento parcial com split automático + "quem recebeu") —
 * verificação contra o Firestore emulator via client SDK.
 *
 * A lógica de negócio (limiar total vs. parcial, direção do split, sempre
 * a pessoa logada) vive inteira nos componentes React (client-side) —
 * este script só prova que a REGRA do Firestore permite os padrões de
 * escrita novos. Não substitui o teste manual (ver plano).
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyFaseCPartialReceiptAndReceivedBy.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, collection, serverTimestamp } from "firebase/firestore";
import admin from "firebase-admin";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: emulator env vars not set.");
  process.exit(1);
}

admin.initializeApp({ projectId: firebaseConfig.projectId });
const adminDb = admin.firestore();

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { console.log(`  OK  ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); fail++; }
}

const apps = [];
async function clientAs(email) {
  const app = initializeApp(firebaseConfig, `FC_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  let user;
  try { user = (await createUserWithEmailAndPassword(auth, email, "TestPass123!")).user; }
  catch (err) {
    if (err.code === "auth/email-already-in-use") user = (await signInWithEmailAndPassword(auth, email, "TestPass123!")).user;
    else throw err;
  }
  return { db, uid: user.uid };
}
async function expectDenied(promise, label) {
  try { await promise; check(label, false); }
  catch (err) { check(`${label} (${err.code || err.message})`, err.code === "permission-denied" || /permission/i.test(String(err.message))); }
}
async function expectAllowed(promise, label) {
  try { await promise; check(label, true); }
  catch (err) { check(`${label} — unexpected error: ${err.code || err.message}`, false); }
}

async function main() {
  const CLINIC = "fasec-clinic-" + Date.now();

  console.log("=== Seeding fixtures ===");
  const member = await clientAs("fasec.member@verify.local");
  const outsider = await clientAs("fasec.outsider@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Fase C" });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true, name: "Dra. Ana" });
  await adminDb.doc(`clinics/${CLINIC}/financial_entries/entry-full`).set({
    patientId: "patient-1", patientName: "Paciente Teste", description: "Restauração",
    type: "income", category: "Clínico", amount: 200, paidAmount: 0, pendingAmount: 200, status: "pending",
    date: new Date().toISOString(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await adminDb.doc(`clinics/${CLINIC}/financial_entries/entry-split`).set({
    patientId: "patient-1", patientName: "Paciente Teste", description: "Plano de Tratamento",
    type: "income", category: "Orçamento/Tratamento", amount: 1500, paidAmount: 0, pendingAmount: 1500, status: "pending",
    date: new Date().toISOString(), createdAt: admin.firestore.FieldValue.serverTimestamp(),
    professionalUid: member.uid, professionalName: "Dra. Ana", quotationRef: { quotationId: "q-1", itemIndex: 0 },
  });

  console.log("\n--- 1. Membro comum marca pagamento TOTAL com receivedBy/receivedByName ---");
  const fullRef = doc(member.db, "clinics", CLINIC, "financial_entries", "entry-full");
  await expectAllowed(
    updateDoc(fullRef, {
      status: "paid", paidAmount: 200, pendingAmount: 0, paidAt: serverTimestamp(),
      receivedBy: member.uid, receivedByName: "Dra. Ana",
    }),
    "Update total com receivedBy/receivedByName"
  );
  const fullSnap = await getDoc(fullRef);
  check("receivedByName persistido", fullSnap.data()?.receivedByName === "Dra. Ana");

  console.log("\n--- 2. Membro comum faz o SPLIT (reduz original + cria doc-resto com ID auto) ---");
  const splitRef = doc(member.db, "clinics", CLINIC, "financial_entries", "entry-split");
  await expectAllowed(
    updateDoc(splitRef, {
      amount: 500, paidAmount: 500, pendingAmount: 0, status: "paid",
      paidAt: serverTimestamp(), receivedBy: member.uid, receivedByName: "Dra. Ana", groupId: "fin-split-entry-split-1",
    }),
    "Reduz o doc original pro valor recebido"
  );
  const remainderRef = doc(collection(member.db, "clinics", CLINIC, "financial_entries"));
  await expectAllowed(
    setDoc(remainderRef, {
      patientId: "patient-1", patientName: "Paciente Teste", description: "Plano de Tratamento",
      type: "income", category: "Orçamento/Tratamento", amount: 1000, paidAmount: 0, pendingAmount: 1000, status: "pending",
      date: new Date().toISOString(), groupId: "fin-split-entry-split-1",
      professionalUid: member.uid, professionalName: "Dra. Ana", quotationRef: { quotationId: "q-1", itemIndex: 0 },
      createdAt: serverTimestamp(), createdBy: member.uid,
    }),
    "Cria doc-resto com ID auto-gerado, propagando groupId/quotationRef/professionalUid"
  );
  const remainderSnap = await getDoc(remainderRef);
  check("doc-resto existe", remainderSnap.exists());
  check("doc-resto sem receivedBy", remainderSnap.data()?.receivedBy === undefined);
  check("doc-resto propagou quotationRef", remainderSnap.data()?.quotationRef?.quotationId === "q-1");
  const originalSnap = await getDoc(splitRef);
  check("doc original virou o recibo de R$500", originalSnap.data()?.amount === 500 && originalSnap.data()?.status === "paid");

  console.log("\n--- 3. Não-membro é negado nos dois padrões ---");
  const fullAsOutsider = doc(outsider.db, "clinics", CLINIC, "financial_entries", "entry-full");
  await expectDenied(updateDoc(fullAsOutsider, { status: "paid", receivedBy: outsider.uid }), "Não-membro atualiza financial_entries");
  const newAsOutsider = doc(collection(outsider.db, "clinics", CLINIC, "financial_entries"));
  await expectDenied(
    setDoc(newAsOutsider, { patientId: "patient-1", description: "x", amount: 100, status: "pending" }),
    "Não-membro cria financial_entries"
  );

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
