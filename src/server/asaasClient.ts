/**
 * Minimal Asaas API v3 client — native `fetch`, no SDK (matches the rest of
 * this codebase's convention of not adding an HTTP client dependency when
 * `fetch` already covers it).
 *
 * Base URL switches on ASAAS_ENV ('sandbox' | 'production', default
 * 'sandbox' — safer default than accidentally hitting production before
 * credentials are confirmed). Requires ASAAS_API_KEY (Secret Manager, same
 * pattern as OPENAI_API_KEY/GEMINI_API_KEY).
 *
 * NOT yet exercised against a real Asaas account — the shapes below follow
 * Asaas's documented v3 contract, but this needs a real sandbox key to
 * verify before it's trusted in production. Flag any mismatch found during
 * that first real test rather than assuming this file is exactly right.
 */

const ASAAS_BASE_URL = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';

function getApiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error('ASAAS_API_KEY não configurada.');
  return key;
}

async function asaasFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: getApiKey(),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.errors?.[0]?.description || data?.message || `Asaas API error (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export interface AsaasCustomerInput {
  name: string;
  email: string;
  cpfCnpj: string;
  phone?: string;
  externalReference?: string; // we set this to the Firebase uid
}

/**
 * Asaas doesn't have a native "upsert customer" endpoint — a customer is
 * looked up by cpfCnpj first (a person/company can only exist once), and
 * only created if not found. Safe to call repeatedly (e.g. on checkout
 * retry) without creating duplicates.
 */
export async function findOrCreateAsaasCustomer(input: AsaasCustomerInput): Promise<{ id: string }> {
  const existing = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(input.cpfCnpj)}`);
  if (existing?.data?.length > 0) {
    return { id: existing.data[0].id };
  }
  const created = await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
      mobilePhone: input.phone,
      externalReference: input.externalReference,
    }),
  });
  return { id: created.id };
}

export interface AsaasSubscriptionInput {
  customerId: string;
  valueCents: number;
  description: string;
  externalReference: string; // uid — how the webhook finds signups/{uid} back
}

export interface AsaasSubscriptionResult {
  subscriptionId: string;
  checkoutUrl: string;
}

/**
 * `billingType: 'UNDEFINED'` is what makes this a hosted checkout — Asaas
 * generates a payment page where the customer picks PIX/boleto/card
 * themselves, instead of committing to one method up front.
 */
export async function createAsaasSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscriptionResult> {
  const today = new Date().toISOString().slice(0, 10);
  const subscription = await asaasFetch('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerId,
      billingType: 'UNDEFINED',
      cycle: 'MONTHLY',
      value: input.valueCents / 100,
      nextDueDate: today,
      description: input.description,
      externalReference: input.externalReference,
    }),
  });

  // The subscription itself has no direct checkout link — its first
  // generated payment does (`invoiceUrl`). A freshly created subscription
  // should have exactly one payment at this point.
  const payments = await asaasFetch(`/payments?subscription=${subscription.id}&limit=1`);
  const firstPayment = payments?.data?.[0];
  if (!firstPayment?.invoiceUrl) {
    throw new Error('Assinatura criada no Asaas, mas não foi possível obter o link de pagamento.');
  }

  return { subscriptionId: subscription.id, checkoutUrl: firstPayment.invoiceUrl };
}
