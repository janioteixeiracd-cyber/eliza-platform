import type { CollectionReference, DocumentSnapshot, FieldPath as FieldPathType } from "firebase-admin/firestore";

/**
 * Read-only state export for the Simples Dental Bridge — `GET
 * /api/bridge/state/patients`. Returns only what matching/reconciliation
 * needs: identity fields. Never prontuário, evolução clínica, endereço,
 * observações or financeiro — this is a minimized view, not the patient
 * document.
 *
 * `name` is returned as stored, never normalized here. Name normalization
 * is a policy decision (accent-stripping, casing, punctuation) that the
 * Bridge already owns as its single canonical implementation
 * (normalizeAuditKey) — duplicating that logic server-side would create
 * two normalization policies that can silently drift apart with no way to
 * detect it from either side. Digit-stripping cpf/phone, by contrast, is
 * lossless and unambiguous (there is only one reasonable definition of
 * "just the digits"), so it happens here to keep the payload predictable.
 */

export interface BridgePatientStateItemV1 {
  id: string;
  name: string;
  documentDigits: string | null;
  phoneDigits: string | null;
  source: string | null;
  updatedAt: string;
}

export interface BridgePatientStateResponseV1 {
  schemaVersion: "1.0.0";
  clinicId: string;
  items: BridgePatientStateItemV1[];
  nextPageToken: string | null;
}

export const DEFAULT_PAGE_SIZE = 500;
export const MAX_PAGE_SIZE = 1000;

export function resolvePageSize(requested: unknown): number {
  const parsed = typeof requested === "string" ? Number.parseInt(requested, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function onlyDigitsOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function toIso(value: unknown): string {
  if (value && typeof value === "object" && typeof (value as any).toDate === "function") {
    return (value as any).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

/** Pure — takes already-fetched doc data, no Firestore coupling. Easy to test with a fake doc. */
export function toPatientStateItem(id: string, data: Record<string, unknown> | undefined): BridgePatientStateItemV1 {
  const d = data || {};
  return {
    id,
    name: typeof d.name === "string" ? d.name : "",
    documentDigits: onlyDigitsOrNull(d.cpf ?? d.document ?? null),
    phoneDigits: onlyDigitsOrNull(d.phone ?? null),
    source: typeof d.source === "string" ? d.source : null,
    updatedAt: toIso(d.updated_at ?? d.imported_at ?? null),
  };
}

/**
 * Real, deterministic, cursor-based pagination — ordered by document ID
 * (stable regardless of concurrent writes elsewhere in the collection),
 * never loads the full collection into memory. `pageToken` is just the
 * last-seen document ID from the previous page; resolving it back to a
 * DocumentSnapshot is required because Firestore's `startAfter` needs the
 * snapshot, not a bare ID string.
 */
export async function fetchBridgePatientState(
  patientsCollection: CollectionReference,
  fieldPath: typeof FieldPathType,
  clinicId: string,
  pageSizeRaw: unknown,
  pageToken: string | undefined
): Promise<BridgePatientStateResponseV1> {
  const pageSize = resolvePageSize(pageSizeRaw);

  let query = patientsCollection.orderBy(fieldPath.documentId()).limit(pageSize);
  if (pageToken) {
    const cursorDoc = await patientsCollection.doc(pageToken).get();
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc as DocumentSnapshot);
    }
  }

  const snap = await query.get();
  const items = snap.docs.map((doc) => toPatientStateItem(doc.id, doc.data()));
  const nextPageToken = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1]!.id : null;

  return { schemaVersion: "1.0.0", clinicId, items, nextPageToken };
}
