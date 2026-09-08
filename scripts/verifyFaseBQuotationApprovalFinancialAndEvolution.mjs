/**
 * Fase B (orçamento aprovado → financeiro automático; confirmação solta de
 * item → evolução) — verificação contra o Firestore emulator via client SDK.
 *
 * A lógica de negócio (idempotência na reaprovação, não sobrescrever um
 * lançamento já editado pelo financeiro, não duplicar evolução pra itens
 * de Planejamento IA) vive inteira no componente React (client-side) —
 * este script só prova que a REGRA do Firestore permite os padrões de
 * escrita que esse código faz. Não substitui o teste manual (ver plano).
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyFaseBQuotationApprovalFinancialAndEvolution.mjs
 */
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `FB_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
  const CLINIC = "faseb-clinic-" + Date.now();
  const OTHER_CLINIC = CLINIC + "-other";

  console.log("=== Seeding fixtures ===");
  const member = await clientAs("faseb.member@verify.local");
  const outsider = await clientAs("faseb.outsider@verify.local"); // signed in, no membership anywhere

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Fase B" });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true, name: "Dra. Ana", isClinicalProvider: true });
  await adminDb.doc(`clinics/${CLINIC}/patients/patient-1`).set({ name: "Paciente Teste" });

  const quotationRef = doc(member.db, "clinics", CLINIC, "patients", "patient-1", "quotations", "q-1");
  await adminDb.doc(`clinics/${CLINIC}/patients/patient-1/quotations/q-1`).set({
    title: "Plano de Tratamento", status: "draft", totalValue: 300,
    items: [
      { description: "Restauração", value: 200, quantity: 1, professionalUid: member.uid, professionalName: "Dra. Ana" },
      { description: "Profilaxia", value: 100, quantity: 1, professionalUid: member.uid, professionalName: "Dra. Ana" },
    ],
  });

  console.log("\n--- 1. Membro comum reescreve o array items inteiro (marcar executionStatus:'pending' na aprovação) ---");
  await expectAllowed(
    updateDoc(quotationRef, {
      status: "approved",
      approvedAt: serverTimestamp(),
      items: [
        { description: "Restauração", value: 200, quantity: 1, professionalUid: member.uid, professionalName: "Dra. Ana", executionStatus: "pending" },
        { description: "Profilaxia", value: 100, quantity: 1, professionalUid: member.uid, professionalName: "Dra. Ana", executionStatus: "pending" },
      ],
    }),
    "Aprova o orçamento com executionStatus por item"
  );

  console.log("\n--- 2. getDoc num financial_entries inexistente -> exists()===false (pré-condição da idempotência) ---");
  const entry0Ref = doc(member.db, "clinics", CLINIC, "financial_entries", "q-q-1-item-0");
  const beforeSnap = await getDoc(entry0Ref);
  check("Doc não existe antes da criação", beforeSnap.exists() === false);

  console.log("\n--- 3. Membro comum cria financial_entries com ID determinístico + campos novos da Fase B ---");
  await expectAllowed(
    setDoc(entry0Ref, {
      patientId: "patient-1", patientName: "Paciente Teste", description: "Restauração",
      type: "income", category: "Orçamento/Tratamento", amount: 200, paidAmount: 0, pendingAmount: 200,
      status: "pending", date: new Date().toISOString(), createdAt: serverTimestamp(), createdBy: member.uid,
      professionalUid: member.uid, professionalName: "Dra. Ana",
      quotationRef: { quotationId: "q-1", itemIndex: 0 },
    }),
    "Cria financial_entries/q-q-1-item-0"
  );
  const afterSnap = await getDoc(entry0Ref);
  check("Doc existe depois da criação (idempotência checável)", afterSnap.exists() === true);

  console.log("\n--- 4. Não-membro é negado nos dois padrões de escrita ---");
  const quotationAsOutsider = doc(outsider.db, "clinics", CLINIC, "patients", "patient-1", "quotations", "q-1");
  await expectDenied(updateDoc(quotationAsOutsider, { status: "approved" }), "Não-membro atualiza quotations");
  const entryAsOutsider = doc(outsider.db, "clinics", CLINIC, "financial_entries", "q-q-1-item-1");
  await expectDenied(
    setDoc(entryAsOutsider, { patientId: "patient-1", description: "Profilaxia", amount: 100, status: "pending" }),
    "Não-membro cria financial_entries"
  );

  console.log("\n--- 5. arrayUnion de Evolution com quotationRef (em vez de clinicalPlanRef) em treatments é aceito ---");
  const treatmentRef = doc(member.db, "clinics", CLINIC, "patients", "patient-1", "treatments", "gen-treat-1");
  await expectAllowed(
    setDoc(treatmentRef, { id: "gen-treat-1", description: "Prontuário Clínico Geral", status: "active", evolutions: [] }),
    "Cria o treatment 'Prontuário Clínico Geral'"
  );
  await expectAllowed(
    updateDoc(treatmentRef, {
      evolutions: arrayUnion({
        id: "evo-1", text: "Procedimento realizado — Restauração (orçamento aprovado em 04/09/2026).",
        date: new Date().toISOString(), professional: "Dra. Ana",
        quotationRef: { quotationId: "q-1", itemIndex: 0, description: "Restauração" },
      }),
    }),
    "arrayUnion de Evolution com quotationRef"
  );
  const treatmentSnap = await getDoc(treatmentRef);
  check("Evolução com quotationRef persistida", treatmentSnap.data()?.evolutions?.[0]?.quotationRef?.quotationId === "q-1");

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  for (const app of apps) await deleteApp(app).catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
