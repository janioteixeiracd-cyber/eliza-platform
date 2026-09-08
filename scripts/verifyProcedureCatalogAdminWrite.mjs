/**
 * Prova, contra a regra REAL de firestore.rules (já existente, não tocada
 * nesta rodada — linhas 361-364, achada numa rodada anterior só pelo bug de
 * list() com wildcard recursivo, nunca usada por nenhuma tela até agora),
 * que a nova tela NextProcedureCatalogAdmin.tsx escreve exatamente no
 * formato que o consumidor real (NextPlanningAI.tsx:358) espera:
 *
 *  1. Membro comum: permission-denied ao escrever em procedure_catalog.
 *  2. Admin/Owner: escreve com sucesso (mesmo payload que a tela grava).
 *  3. Qualquer membro consegue LER a coleção (list), incluindo o doc novo.
 *  4. A MESMA query que NextPlanningAI.tsx roda de verdade
 *     (where('category','==',X), where('active','==',true)) devolve o doc
 *     recém-criado — não só "a escrita funciona", mas "o formato bate com
 *     quem consome".
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/verifyProcedureCatalogAdminWrite.mjs
 */
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocs, query, collection, where, serverTimestamp } from "firebase/firestore";
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
  const app = initializeApp(firebaseConfig, `PC_${email.replace(/[^a-zA-Z0-9]/g, "_")}_${apps.length}`);
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
  const CLINIC = "proccat-clinic-" + Date.now();

  console.log("=== Seeding fixtures ===");
  const admin1 = await clientAs("proccat.admin@verify.local");
  const member = await clientAs("proccat.member@verify.local");

  await adminDb.doc(`clinics/${CLINIC}`).set({ name: "Clínica Catálogo Procedimentos", ownerId: admin1.uid });
  await adminDb.doc(`clinics/${CLINIC}/members/${admin1.uid}`).set({ uid: admin1.uid, role: "admin", status: "active", active: true, name: "Admin" });
  await adminDb.doc(`clinics/${CLINIC}/members/${member.uid}`).set({ uid: member.uid, role: "member", status: "active", active: true, name: "Secretária" });

  console.log("\n--- 1. Membro comum NÃO pode escrever em procedure_catalog ---");
  await expectDenied(
    setDoc(doc(member.db, "clinics", CLINIC, "procedure_catalog", "proc-denied"), {
      procedureId: "proc-denied", name: "Tentativa negada", category: "harmonizacao_orofacial", templateId: null, aliases: [], active: true,
    }),
    "Membro comum: setDoc em procedure_catalog"
  );

  console.log("\n--- 2. Admin/Owner escreve com sucesso — mesmo payload da tela nova ---");
  const procId = "proc-toxina-testauto";
  await expectAllowed(
    setDoc(doc(admin1.db, "clinics", CLINIC, "procedure_catalog", procId), {
      procedureId: procId,
      name: "Toxina Botulínica (Testauto)",
      category: "harmonizacao_orofacial",
      templateId: "toxina_botulinica",
      aliases: ["botox", "toxina"],
      active: true,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy: admin1.uid,
    }),
    "Admin: setDoc em procedure_catalog"
  );

  console.log("\n--- 3. Qualquer membro consegue LER a coleção (list) ---");
  const listSnap = await getDocs(collection(member.db, "clinics", CLINIC, "procedure_catalog"));
  check("Membro comum: list() em procedure_catalog não é negado", listSnap.size >= 1, `got ${listSnap.size} docs`);

  console.log("\n--- 4. A MESMA query real de NextPlanningAI.tsx retorna o doc novo ---");
  const realQuery = query(
    collection(member.db, "clinics", CLINIC, "procedure_catalog"),
    where("category", "==", "harmonizacao_orofacial"),
    where("active", "==", true)
  );
  const realSnap = await getDocs(realQuery);
  const found = realSnap.docs.find(d => d.id === procId);
  check("Query real (category+active) encontra o doc recém-criado", !!found, `docs encontrados: ${realSnap.docs.map(d => d.id).join(", ") || "nenhum"}`);
  check("Doc encontrado carrega templateId correto", found?.data()?.templateId === "toxina_botulinica", `got ${found?.data()?.templateId}`);
  check("Doc encontrado carrega procedureId igual ao id do doc", found?.data()?.procedureId === procId, `got ${found?.data()?.procedureId}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
