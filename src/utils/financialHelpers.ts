/**
 * Helper to normalize dates to the America/Sao_Paulo timezone to avoid UTC shifts.
 * This guarantees consistent calendar dates regardless of client local time.
 */
export function normalizeLocalDate(val: any): Date {
  if (!val) return new Date();
  let date: Date;

  if (typeof val.toDate === 'function') {
    date = val.toDate();
  } else if (val.seconds !== undefined) {
    date = new Date(val.seconds * 1000);
  } else if (val instanceof Date) {
    date = val;
  } else if (typeof val === 'string') {
    // Check if it's a YYYY-MM-DD string
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      // Midday of that year/month/day in the local execution context prevents shift
      return new Date(year, month - 1, day, 12, 0, 0, 0);
    }
    date = new Date(val);
  } else {
    date = new Date(val);
  }

  if (isNaN(date.getTime())) {
    return new Date();
  }

  try {
    // Resolve exact day components in America/Sao_Paulo
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    
    // Midday protects from timezone shift adjustments
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  } catch (err) {
    // Fallback to local midday if Intl formatting is unsupported
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  }
}

/**
 * Transforms any financial entry raw object into the standard, audited ERP financial entry structure.
 */
export function normalizeFinancialEntry(doc: any): any {
  if (!doc) return null;

  // Amount conversion rule: amount -> totalAmount, value -> totalAmount
  let totalAmount = 0;
  if (doc.totalAmount !== undefined) {
    totalAmount = Number(doc.totalAmount);
  } else if (doc.amount !== undefined) {
    totalAmount = Number(doc.amount);
  } else if (doc.value !== undefined) {
    totalAmount = Number(doc.value);
  }

  // Paid conversion rule: paid -> paidAmount, otherwise check paidAmount
  let paidAmount = 0;
  let paidAmountIsSet = false;
  if (doc.paidAmount !== undefined) {
    paidAmount = Number(doc.paidAmount);
    paidAmountIsSet = true;
  } else if (doc.paid !== undefined) {
    paidAmount = Number(doc.paid);
    paidAmountIsSet = true;
  } else if (doc.paid_amount !== undefined) {
    paidAmount = Number(doc.paid_amount);
    paidAmountIsSet = true;
  }

  // Determine type: income | expense
  let type: "income" | "expense" = "income";
  const rawType = String(doc.type || "").toLowerCase().trim();
  if (rawType === "expense" || rawType === "despesa" || rawType === "saída" || rawType === "saida") {
    type = "expense";
  }

  // Deduce status: pending | partial | paid | cancelled
  let status: "pending" | "partial" | "paid" | "cancelled" = "pending";
  const rawStatus = String(doc.status || "").toLowerCase().trim();
  
  if (rawStatus === "pago" || rawStatus === "paid" || rawStatus === "received" || rawStatus === "recebido" || rawStatus === "bom") {
    status = "paid";
  } else if (rawStatus === "parcial" || rawStatus === "partial") {
    status = "partial";
  } else if (rawStatus === "cancelado" || rawStatus === "cancelled" || rawStatus === "cancel") {
    status = "cancelled";
  } else if (rawStatus === "pending" || rawStatus === "pendente") {
    status = "pending";
  } else {
    // Deduce logically
    if (paidAmount >= totalAmount && totalAmount > 0) {
      status = "paid";
    } else if (paidAmount > 0) {
      status = "partial";
    }
  }

  // Fallback: If status is paid but paidAmount is not set or is 0, make it equal to totalAmount
  if (status === "paid" && (!paidAmountIsSet || paidAmount === 0)) {
    paidAmount = totalAmount;
  }

  // Pending conversion rule: remainingAmount -> pendingAmount
  let pendingAmount = 0;
  if (doc.pendingAmount !== undefined) {
    pendingAmount = Number(doc.pendingAmount);
  } else if (doc.remainingAmount !== undefined) {
    pendingAmount = Number(doc.remainingAmount);
  } else if (doc.remaining_amount !== undefined) {
    pendingAmount = Number(doc.remaining_amount);
  } else {
    pendingAmount = status === "paid" ? 0 : Math.max(0, totalAmount - paidAmount);
  }

  // Extra standard fields
  const category = doc.category || "Geral";
  const subcategory = doc.subcategory || "";
  const description = doc.description || doc.name || doc.title || "Sem descrição";
  const title = doc.title || description || "Lançamento Financeiro";
  
  // Date Normalization
  const dueDate = doc.dueDate || doc.due_date || doc.date || null;
  const paidAt = doc.paidAt || doc.paymentDate || doc.payment_date || null;
  const createdAt = doc.createdAt || doc.created_at || null;
  const updatedAt = doc.updatedAt || doc.updated_at || null;

  const paymentMethod = doc.paymentMethod || doc.payment_method || doc.formaPagamento || "";

  // Assign standard source
  let source: "manual" | "quotation" | "imported" | "system" | "legacy" = "manual";
  const rawSrc = String(doc.source || "").toLowerCase().trim();
  if (["manual", "quotation", "imported", "system", "legacy"].includes(rawSrc)) {
    source = rawSrc as any;
  } else if (doc.importSource || doc.import_source) {
    source = "imported";
  } else if (doc.quotationId || doc.quotation_id) {
    source = "quotation";
  }

  return {
    id: doc.id,
    clinicId: doc.clinicId || "",
    patientId: doc.patientId || doc.patient_id || null,
    patientName: doc.patientName || doc.patient_name || null,
    // Optional, only ever set by explicit staff choice (see NextFinancial.tsx's
    // entry form) — never inferred. Absent on entries created before this field existed.
    professionalId: doc.professionalId || null,
    professionalName: doc.professionalName || null,
    type,
    category,
    subcategory,
    title,
    description,
    totalAmount,
    paidAmount,
    pendingAmount,
    status,
    dueDate,
    paidAt,
    createdAt,
    updatedAt,
    paymentMethod,
    source,
    quotationId: doc.quotationId || doc.quotation_id || null,
    installmentNumber: doc.installmentNumber ? Number(doc.installmentNumber) : (doc.installment_number ? Number(doc.installment_number) : null),
    totalInstallments: doc.totalInstallments ? Number(doc.totalInstallments) : (doc.total_installments ? Number(doc.total_installments) : null),
    archived: doc.archived || false,
    archivedReason: doc.archivedReason || null,
    // Fase C — sempre a pessoa logada no momento da confirmação, nunca escolhível. Ausente em lançamentos recebidos antes desta fase.
    receivedBy: doc.receivedBy || null,
    receivedByName: doc.receivedByName || null
  };
}
