import { collection, query, where, getDocs, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { CommissionRule, TeamMember } from '../types/finance';

/**
 * Generates commissions for a financial entry based on active rules.
 */
export async function generateCommissionsForEntry(clinicId: string, entry: any) {
  if (entry.type !== 'receita' && entry.type !== 'income') return;
  const statusStr = String(entry.status || '').toLowerCase();
  if (statusStr !== 'pago' && statusStr !== 'paid' && statusStr !== 'parcial' && statusStr !== 'partial') return;

  try {
    // 1. Fetch active rules
    const rulesSnap = await getDocs(query(collection(db, 'clinics', clinicId, 'commission_rules'), where('active', '==', true)));
    const rules = rulesSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // 2. Fetch team members (active)
    const membersSnap = await getDocs(query(collection(db, 'clinics', clinicId, 'team_members'), where('active', '==', true)));
    const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // Determine responsible professional
    const responsibleId = entry.procedure_responsible_id || entry.professionalId || entry.sale_responsible_id || entry.collection_responsible_id || entry.responsible_id || entry.member_id;
    let memberToCredit = members.find(m => m.id === responsibleId);

    const generatedIds: string[] = [];

    // Check if we matched an active, commissionable professional
    if (memberToCredit) {
      const isProf = memberToCredit.isProfessional ?? (memberToCredit.role === 'dentist' || memberToCredit.role === 'doctor');
      const isComm = memberToCredit.isCommissionable ?? (memberToCredit.commission_enabled !== false);
      
      if (isProf && isComm) {
        // Find professional-specific rules
        const profRules = rules.filter(r => r.active === true && (r.professionalId === memberToCredit!.id || r.member_id === memberToCredit!.id));
        
        let commissionPercent = -1;
        let ruleIdUsed: string | null = null;
        let ruleNameUsed = 'Comissão Padrão do Profissional';

        const norm = (s: string) => String(s || '').toLowerCase().trim();
        const procNameInput = entry.procedureName || entry.description || entry.procedure_name || '';

        // Prioridade 1: Regra por Procedimento Específico
        const procRule = profRules.find(r => r.ruleType === 'procedure' && r.procedureName && norm(r.procedureName) === norm(procNameInput));
        
        if (procRule) {
          commissionPercent = procRule.commissionPercent !== undefined ? procRule.commissionPercent : (procRule.percentage || 0);
          ruleIdUsed = procRule.id;
          ruleNameUsed = `Regra Procedimento: ${procRule.procedureName}`;
        } else {
          // Prioridade 2: Regra por Categoria
          const catRule = profRules.find(r => r.ruleType === 'category' && r.category && norm(r.category) === norm(entry.category));
          if (catRule) {
            commissionPercent = catRule.commissionPercent !== undefined ? catRule.commissionPercent : (catRule.percentage || 0);
            ruleIdUsed = catRule.id;
            ruleNameUsed = `Regra Categoria: ${catRule.category}`;
          } else {
            // Prioridade 3: Regra Padrão do Profissional (ruleType === 'default')
            const defRule = profRules.find(r => r.ruleType === 'default');
            if (defRule) {
              commissionPercent = defRule.commissionPercent !== undefined ? defRule.commissionPercent : (defRule.percentage || 0);
              ruleIdUsed = defRule.id;
              ruleNameUsed = `Regra Padrão do Profissional`;
            } else if (typeof memberToCredit.defaultCommissionPercent === 'number') {
              // Prioridade 4: Comissão padrão no cadastro do profissional (Part 1)
              commissionPercent = memberToCredit.defaultCommissionPercent;
              ruleNameUsed = `Comissão Padrão do Colaborador (${commissionPercent}%)`;
            } else if (typeof memberToCredit.percentage === 'number') {
              // Legacy percentage helper
              commissionPercent = memberToCredit.percentage;
              ruleNameUsed = `Comissão Especial do Colaborador (${commissionPercent}%)`;
            }
          }
        }

        // If a valid rule or default percent is found, generate the commission
        if (commissionPercent >= 0) {
          const commissionAmount = (entry.amount * commissionPercent) / 100;
          
          const commRef = await addDoc(collection(db, 'clinics', clinicId, 'commissions'), {
            member_id: memberToCredit.id,
            member_name: memberToCredit.displayName || memberToCredit.name,
            financial_entry_id: entry.id,
            patient_id: entry.patientId || null,
            patient_name: entry.patient_name || entry.patientName || null,
            commission_type: 'procedure',
            rule_id: ruleIdUsed,
            base_amount: entry.amount,
            percentage: commissionPercent,
            commission_amount: commissionAmount,
            status: 'pending',
            source: 'automatic',
            payment_method: entry.paymentMethod || entry.payment_method || null,
            generated_at: serverTimestamp(),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            notes: `Calculado via prioridades: ${ruleNameUsed}`
          });

          generatedIds.push(commRef.id);
        }
      }
    }

    // Fallback: If no professional commission was generated, try the legacy rules loop for backwards compatibility
    if (generatedIds.length === 0) {
      for (const rule of rules) {
        let matchedMember: TeamMember | undefined;

        if (rule.member_id) {
          matchedMember = members.find(m => m.id === rule.member_id);
        } else if (rule.role_target) {
          if (rule.commission_type === 'sale') {
            matchedMember = members.find(m => m.id === entry.sale_responsible_id && m.role === rule.role_target);
          } else if (rule.commission_type === 'recovery') {
            matchedMember = members.find(m => m.id === entry.collection_responsible_id && m.role === rule.role_target);
          } else if (rule.commission_type === 'procedure') {
            matchedMember = members.find(m => m.id === entry.procedure_responsible_id && m.role === rule.role_target);
          }
        }

        if (!matchedMember) continue;

        let commissionAmount = 0;
        const rulePct = rule.commissionPercent !== undefined ? rule.commissionPercent : (rule.percentage || 0);
        if (rulePct) {
          commissionAmount = (entry.amount * rulePct) / 100;
        } else if (rule.fixed_amount) {
          commissionAmount = rule.fixed_amount;
        }

        if (commissionAmount <= 0) continue;

        const commRef = await addDoc(collection(db, 'clinics', clinicId, 'commissions'), {
          member_id: matchedMember.id,
          member_name: matchedMember.name,
          financial_entry_id: entry.id,
          patient_id: entry.patientId || null,
          patient_name: entry.patient_name || entry.patientName || null,
          commission_type: rule.commission_type || 'custom',
          rule_id: rule.id,
          base_amount: entry.amount,
          percentage: rulePct || null,
          fixed_amount: rule.fixed_amount || null,
          commission_amount: commissionAmount,
          status: 'pending',
          source: 'automatic',
          payment_method: entry.paymentMethod || entry.payment_method || null,
          generated_at: serverTimestamp(),
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          notes: 'Calculado via regras globais herdadas'
        });

        generatedIds.push(commRef.id);
      }
    }

    // Update entry to mark as commission generated
    if (generatedIds.length > 0) {
      await updateDoc(doc(db, 'clinics', clinicId, 'financial_entries', entry.id), {
        commission_generated: true,
        commission_ids: generatedIds
      });
    }

    return generatedIds;
  } catch (err) {
    console.error('Error generating commissions:', err);
    throw err;
  }
}
