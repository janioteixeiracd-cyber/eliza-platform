import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  setLogLevel,
  connectFirestoreEmulator
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Enable debug logging to help diagnose connection issues in the browser console if debug mode is active
const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
setLogLevel(isDebugActive ? 'debug' : 'error');

// Centralized initialization
if (isDebugActive) {
  console.log("[Firebase] Initializing Project:", firebaseConfig.projectId, "AppId:", firebaseConfig.appId);
}
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Simplified Database Identification
// Overriding to '(default)' as requested by the user to connect to historical clinics, patients, and appointments
const configDbId = '(default)';
export const FIRESTORE_DATABASE_ID = configDbId;

// Global Firestore Instance
export const db = (configDbId === '(default)' || configDbId === '')
  ? getFirestore(app) 
  : getFirestore(app, configDbId);

if (isDebugActive) {
  console.log(`[Firebase] Firestore initialized on database: ${configDbId}`);
  console.log(`[Firebase] Internal Database ID:`, (db as any)._databaseId);
  console.log(`[Firebase] Rules path would be: projects/${firebaseConfig.projectId}/databases/${configDbId}/documents`);
}

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Local emulator connection: only when explicitly opted in via
// VITE_USE_FIREBASE_EMULATOR=true (never touches the real elisa-494703
// project). Guarded against HMR re-execution, which would otherwise throw
// "emulator already connected".
const useEmulator = (import.meta as any).env?.VITE_USE_FIREBASE_EMULATOR === 'true';
if (useEmulator && !(globalThis as any).__ELIZA_EMULATOR_CONNECTED__) {
  (globalThis as any).__ELIZA_EMULATOR_CONNECTED__ = true;
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  console.log('[Firebase] Connected to LOCAL EMULATORS (Firestore :8080, Auth :9099) — not touching production elisa-494703 data.');
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const err = error as any;
  console.error('[Firestore Error Trace]:', err.stack);
  const errInfo: FirestoreErrorInfo = {
    error: err?.message || String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  const errString = JSON.stringify(errInfo);
  console.error('[Firestore Error Details]:', errString);
  throw new Error(errString);
}

// Environment check
export const IS_STUDIO_PREVIEW = 
  window.location.hostname.includes("studio") || 
  window.location.hostname.includes("localhost") ||
  window.location.hostname.includes("run.app");

// Query logging helper
export const logQuery = (screen: string, collection: string, filters: any = {}, limitCount?: number) => {
  const isDebugActive = (import.meta as any).env?.VITE_DEBUG_FIREBASE === 'true';
  const isCountQuery = collection.includes('count') || filters === 'count' || (typeof filters === 'object' && filters?.type === 'count') || (collection === 'patients' && filters === 'count');
  
  if (isDebugActive) {
    console.log(`[Firestore Query] ${screen} | ${collection} | Filters:`, filters, `| Limit: ${limitCount || 'NONE'}`);
  }
  
  if (!limitCount && !isCountQuery) {
    console.warn(`[Firestore Warning] Query without limit detected in ${screen} on ${collection}. Fix to avoid excessive reads.`);
  }
};

// Perform initial connection test
// testConnection(); // Disabled as per user request to stabilize clinical environment

export default app;
