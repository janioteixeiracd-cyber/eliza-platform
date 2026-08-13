/**
 * Seeds fictitious data into the LOCAL Firebase emulators (Firestore + Auth)
 * for viewing the ELIZA app in dev mode. Never touches the real elisa-494703
 * production project -- only runs against 127.0.0.1 when
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set.
 *
 * Run with:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node scripts/seedEmulator.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST not set. This script only runs against local emulators.");
  process.exit(1);
}

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "elisa-494703";
initializeApp({ projectId: PROJECT_ID });

const db = getFirestore();
const auth = getAuth();

const CLINIC_ID = "demo-clinic-001";
const DEMO_EMAIL = "demo@eliza.local";
const DEMO_PASSWORD = "DemoEliza123!";

async function main() {
  console.log(`[seed] Using project "${PROJECT_ID}" against emulators (Firestore ${process.env.FIRESTORE_EMULATOR_HOST}, Auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST})`);

  // 1. Auth user
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(DEMO_EMAIL);
    console.log(`[seed] Auth user already exists: ${userRecord.uid}`);
  } catch {
    userRecord = await auth.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      displayName: "Dra. Ana Demo",
      emailVerified: true,
    });
    console.log(`[seed] Created auth user: ${userRecord.uid}`);
  }
  const uid = userRecord.uid;

  const now = Timestamp.now();

  // 2. Clinic
  await db.doc(`clinics/${CLINIC_ID}`).set({
    name: "Clínica Demo ELIZA",
    slug: "clinica-demo-eliza",
    cnpj: "00.000.000/0001-00",
    address: "Rua Fictícia, 123 - Centro",
    ownerId: uid,
    aiProviderPrincipal: "gemini",
    aiProviderFallback: "openai",
    createdAt: now,
  }, { merge: true });
  console.log(`[seed] Clinic ${CLINIC_ID} created/updated`);

  // 3. Membership
  await db.doc(`clinics/${CLINIC_ID}/members/${uid}`).set({
    uid,
    clinicId: CLINIC_ID,
    name: "Dra. Ana Demo",
    email: DEMO_EMAIL,
    role: "owner",
    active: true,
    status: "active",
    joinedAt: now,
  }, { merge: true });
  console.log(`[seed] Membership created for ${uid}`);

  // 4. User profile
  await db.doc(`users/${uid}`).set({
    uid,
    name: "Dra. Ana Demo",
    email: DEMO_EMAIL,
    defaultClinicId: CLINIC_ID,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  console.log(`[seed] User profile created for ${uid}`);

  // 5. Team member entry (owner)
  await db.doc(`clinics/${CLINIC_ID}/team_members/${uid}`).set({
    name: "Dra. Ana Demo",
    role: "Cirurgiã-Dentista",
    commission_enabled: false,
    active: true,
  }, { merge: true });

  // 6. Patients
  const patients = [
    { id: "patient-001", name: "João Pereira da Silva", cpf: "111.111.111-11", birthDate: "1985-04-12", phone: "5511999990001", email: "joao.silva@example.com", address: "Av. Paulista, 1000" },
    { id: "patient-002", name: "Maria Oliveira Souza", cpf: "222.222.222-22", birthDate: "1992-09-30", phone: "5511999990002", email: "maria.souza@example.com", address: "Rua Augusta, 500" },
    { id: "patient-003", name: "Carlos Eduardo Santos", cpf: "333.333.333-33", birthDate: "1978-01-20", phone: "5511999990003", email: "carlos.santos@example.com", address: "Rua Oscar Freire, 200" },
  ];
  for (const p of patients) {
    await db.doc(`clinics/${CLINIC_ID}/patients/${p.id}`).set({
      name: p.name,
      cpf: p.cpf,
      birthDate: p.birthDate,
      phone: p.phone,
      email: p.email,
      address: p.address,
      status: "active",
      createdAt: now,
    }, { merge: true });
  }
  console.log(`[seed] ${patients.length} patients created`);

  // 7. Appointments (today + next few days) -- CalendarView.tsx expects
  // date as a local "YYYY-MM-DD" string + a separate "time" string, not a
  // Firestore Timestamp.
  const getLocalDateString = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const dayMs = 24 * 60 * 60 * 1000;
  const appointments = [
    { id: "appt-001", patientId: "patient-001", patientName: "João Pereira da Silva", procedure: "Limpeza + Avaliação", offsetDays: 0, time: "09:00" },
    { id: "appt-002", patientId: "patient-002", patientName: "Maria Oliveira Souza", procedure: "Restauração", offsetDays: 0, time: "14:00" },
    { id: "appt-003", patientId: "patient-003", patientName: "Carlos Eduardo Santos", procedure: "Retorno pós-operatório", offsetDays: 2, time: "10:00" },
  ];
  for (const a of appointments) {
    const dateObj = new Date(Date.now() + a.offsetDays * dayMs);
    await db.doc(`clinics/${CLINIC_ID}/appointments/${a.id}`).set({
      patientId: a.patientId,
      patientName: a.patientName,
      date: getLocalDateString(dateObj),
      time: a.time,
      status: "confirmado",
      procedure: a.procedure,
      staffId: uid,
      staffName: "Dra. Ana Demo",
      duration: 60,
      createdAt: now,
    }, { merge: true });
  }
  console.log(`[seed] ${appointments.length} appointments created`);

  // 8. Financial entries
  const financialEntries = [
    { id: "fin-001", description: "Limpeza - João Silva", amount: 150, type: "receita", status: "pago", patientId: "patient-001" },
    { id: "fin-002", description: "Restauração - Maria Souza", amount: 380, type: "receita", status: "pendente", patientId: "patient-002" },
    { id: "fin-003", description: "Material odontológico", amount: 220, type: "despesa", status: "pago" },
  ];
  for (const f of financialEntries) {
    await db.doc(`clinics/${CLINIC_ID}/financial_entries/${f.id}`).set({
      description: f.description,
      amount: f.amount,
      type: f.type,
      status: f.status,
      patientId: f.patientId || null,
      date: new Date().toISOString().slice(0, 10),
      createdAt: now,
    }, { merge: true });
  }
  console.log(`[seed] ${financialEntries.length} financial entries created`);

  console.log("\n[seed] DONE. Login credentials for the emulator:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  clinicId: ${CLINIC_ID}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
