import admin from 'firebase-admin';

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'elisa-494703',
});

const db = admin.firestore();
const clinicId = 'l9GzEcXT7uhcYHgRVVhe';

async function main() {
  const convosSnap = await db.collection(`clinics/${clinicId}/whatsapp_conversations`).get();
  for (const c of convosSnap.docs) {
    const msgsSnap = await db.collection(`clinics/${clinicId}/whatsapp_conversations/${c.id}/messages`).orderBy('timestamp', 'desc').limit(10).get();
    console.log(`=== conversation ${c.id} (${c.data().patientName || ''}) ===`);
    msgsSnap.docs.reverse().forEach(m => {
      const d = m.data();
      console.log(`  [${d.direction}] sentBy=${d.sentBy} aiGenerated=${d.aiGenerated} status=${d.status} text="${(d.text||'').slice(0,60)}" at=${d.timestamp?.toDate?.()}`);
    });
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
