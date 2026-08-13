export function parseCurrency(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  const cleanValue = String(value)
    .replace('R$', '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();
    
  const num = parseFloat(cleanValue);
  return isNaN(num) ? 0 : num;
}

export function normalizeAuditKey(text: any): string {
  if (!text) return "";
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "");
}

export function normalizeStatus(status: any): "pago" | "aberto" | "cancelado" | "pendente" | "outro" {
  if (!status) return "outro";
  const s = String(status).toLowerCase().trim();
  
  if (s.includes('pago') || s.includes('recebido') || s.includes('quitado')) return "pago";
  if (s.includes('aberto')) return "aberto";
  if (s.includes('pendente')) return "pendente";
  if (s.includes('cancelado') || s.includes('estornado')) return "cancelado";
  
  return "outro";
}

export function normalizeType(type: any): "receita" | "despesa" | "outro" {
  if (!type) return "outro";
  const t = String(type).toLowerCase().trim();
  
  if (t === 'receita' || t === 'entrada' || t === 'pagamento' || t.includes('recebimento')) return "receita";
  if (t === 'despesa' || t === 'saída' || t === 'saida' || t === 'custo' || t.includes('pagamento_fornecedor')) return "despesa";
  
  return "outro";
}

export function parseExcelDate(excelDate: any): string {
  if (!excelDate) return '';
  
  // If it's a number (Excel serial date)
  if (typeof excelDate === 'number') {
    // Excel dates are number of days since 1899-12-30
    const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  // If it's a Date object
  if (excelDate instanceof Date) {
    if (!isNaN(excelDate.getTime())) {
      return excelDate.toISOString().split('T')[0];
    }
  }
  
  // If it's a string, try to parse various formats
  if (typeof excelDate === 'string') {
    const s = excelDate.trim();
    // Try DD/MM/YYYY
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) {
      return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    }
    
    // Try YYYY-MM-DD
    const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd) {
      return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    }

    const date = new Date(s);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return String(excelDate);
}

export function getCompetenceMonth(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}`; // YYYY-MM
  }
  return '';
}

export function generateEntryId(row: any): string {
  // Use explicit entry_id if available, otherwise generate stable hash
  if (row.entry_id) return String(row.entry_id);
  
  const base = `${row.date || ''}_${row.amount || 0}_${row.type || ''}_${row.description || ''}_${row.patient_id || 'sem_paciente'}_${row.original_row_index || 0}`;
  
  // FNV-1a like hash
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(36);
}

export function isSuspectName(name: string): boolean {
  if (!name) return true;
  const n = name.toLowerCase();
  const suspectKeywords = [
    'maquininha', 'caixa', 'teste', 'sem nome', 'ajuste', 'saldo', 'transferência', 'venda externa', 'diversos'
  ];
  return suspectKeywords.some(kw => n.includes(kw)) || n.length < 3;
}
