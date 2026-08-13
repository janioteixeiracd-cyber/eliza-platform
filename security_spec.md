# Security Specification - ELIZA

## Data Invariants
1. User profiles can only be created by the authenticated user themselves.
2. User profile updates are restricted to the owner.
3. Clinics can only be created by authenticated users.
4. Access to clinic data is restricted to members of that clinic.
5. Membership is checked by looking up `clinics/{clinicId}/members/{userId}`.
6. Invites can only be created by clinic admins/owners.

## The Dirty Dozen (Attack Payloads)

1. **Identity Theft**: Creating a UserProfile for a different UID.
   - `setDoc(doc(db, 'users', 'victim-uid'), { name: 'Attacker' })` -> DENIED
2. **Profile Hijacking**: Updating someone else's UserProfile.
   - `updateDoc(doc(db, 'users', 'victim-uid'), { role: 'admin' })` -> DENIED
3. **Ghost Clinic**: Creating a clinic with `ownerId` set to someone else.
   - `addDoc(collection(db, 'clinics'), { name: 'Evil', ownerId: 'victim-uid' })` -> DENIED
4. **Member Injection**: Adding oneself to a clinic's members list without permission.
   - `setDoc(doc(db, 'clinics', 'any-clinic', 'members', 'my-uid'), { role: 'owner' })` -> DENIED
5. **Unauthorized Scraping**: Listing all patients across all clinics.
   - `getDocs(collectionGroup(db, 'patients'))` -> DENIED
6. **Bypassing Membership**: Fetching a specific patient from a clinic I don't belong to.
   - `getDoc(doc(db, 'clinics', 'other-clinic', 'patients', 'p1'))` -> DENIED
7. **Invite Forgery**: Creating an invite for a clinic I'm not an admin of.
   - `addDoc(collection(db, 'clinics', 'c1', 'invites'), { status: 'pending' })` -> DENIED
8. **Financial Tampering**: Modifying financial entries in a clinic I'm just a guest of.
   - `updateDoc(doc(db, 'clinics', 'c1', 'financial_entries', 'f1'), { amount: 0 })` -> DENIED
9. **Role Escalation**: Changing one's own role from 'dentist' to 'owner'.
   - `updateDoc(doc(db, 'clinics', 'c1', 'members', 'my-uid'), { role: 'owner' })` -> DENIED
10. **System Field Pollution**: Modifying `createdAt` or `ownerId` on a clinic.
    - `updateDoc(doc(db, 'clinics', 'c1'), { ownerId: 'new-owner' })` -> DENIED
11. **Shadow Update**: Adding a `restricted: true` field to a patient.
    - `updateDoc(doc(db, 'clinics', 'c1', 'patients', 'p1'), { name: 'John', restricted: true })` -> DENIED
12. **PII Leakage**: Reading private data from `/users` collection without being the owner.
    - `getDoc(doc(db, 'users', 'other-user'))` -> DENIED (except for specific allowed public fields if implemented, but here all is private)

## Implementation Plan
1. Global deny.
2. Helper functions: `isSignedIn`, `isOwner`, `isValidId`, `isClinicMember`.
3. Strict schema validation for each write.
4. Action-based update patterns.
