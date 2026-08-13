/**
 * Lazy accessors for the Firebase Admin SDK.
 *
 * getFirestore()/getAuth() must not run until server.ts has called
 * initializeApp(). Several modules used to call them at module top-level,
 * which executes during ES module import resolution -- before server.ts's
 * own initializeApp() call ever runs -- causing:
 * "FirebaseAppError: The default Firebase app does not exist."
 *
 * These wrappers defer the call to first actual use (inside a request
 * handler), by which point the app is guaranteed to be initialized.
 */
import { getFirestore as _getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth as _getAuth, Auth } from "firebase-admin/auth";

let dbInstance: Firestore | undefined;
export function getAdminDb(): Firestore {
  if (!dbInstance) dbInstance = _getFirestore();
  return dbInstance;
}

let authInstance: Auth | undefined;
export function getAdminAuth(): Auth {
  if (!authInstance) authInstance = _getAuth();
  return authInstance;
}
