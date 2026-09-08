// Preferências de cor-por-dose e dose sugerida por músculo, específicas do
// workspace de Toxina Botulínica (ficha + mapa de pontos). Documento único
// por clínica em `clinics/{clinicId}/settings/toxinaWorkspacePrefs` —
// compartilhado entre Academy e a ferramenta clínica real, já que é a mesma
// clínica/profissional. Sem doc gravado ainda → app usa DEFAULT_DOSE_COLOR_PREFS
// em memória, sem gravar nada até o usuário editar a paleta pela primeira vez.
//
// A dose sugerida por músculo segue o mesmo princípio geral do app
// (2026-08-31): a ELIZA PODE sugerir valores clínicos como orientação — ela
// reflete o PADRÃO PRÓPRIO do usuário, nunca é aplicada silenciosamente, e
// fica sempre editável no ponto marcado (ver `safetyRules` em
// `planningTemplates.ts` pela mesma regra aplicada à análise por IA).

export interface DoseColorRule {
  dose: number;
  color: string; // hex
}

export interface ToxinaWorkspacePrefs {
  colorRules: DoseColorRule[];
  muscleDefaults: Record<string, string>; // muscle name -> default dose (string, same shape as the point's "unidades" field)
}

export const DEFAULT_DOSE_COLOR_RULES: DoseColorRule[] = [
  { dose: 0.5, color: '#FBCFE8' }, // rosa claro
  { dose: 1, color: '#FDE047' }, // amarelo
  { dose: 2, color: '#60A5FA' }, // azul
  { dose: 3, color: '#4ADE80' }, // verde
  { dose: 4, color: '#FB923C' }, // laranja
  { dose: 5, color: '#F87171' }, // vermelho
];

// Só os músculos que o usuário informou explicitamente um padrão próprio —
// os demais ficam sem dose sugerida (o profissional digita normalmente).
export const DEFAULT_MUSCLE_DOSE_DEFAULTS: Record<string, string> = {
  'M. Prócero': '5',
  'M. Corrugador (esquerdo)': '5',
  'M. Corrugador (direito)': '5',
  'M. Frontal': '2',
  'M. Orbicular do Olho (esquerdo)': '2',
  'M. Orbicular do Olho (direito)': '2',
};

export const DEFAULT_DOSE_COLOR_PREFS: ToxinaWorkspacePrefs = {
  colorRules: DEFAULT_DOSE_COLOR_RULES,
  muscleDefaults: DEFAULT_MUSCLE_DOSE_DEFAULTS,
};

const NEUTRAL_POINT_COLOR = '#9CA3AF'; // cinza — dose sem regra de cor cadastrada, nunca interpolada/inventada

export function colorForDose(dose: number | string | null | undefined, rules: DoseColorRule[]): string {
  const numeric = typeof dose === 'string' ? Number(dose.replace(',', '.')) : dose;
  if (numeric === null || numeric === undefined || Number.isNaN(numeric)) return NEUTRAL_POINT_COLOR;
  const match = rules.find((r) => r.dose === numeric);
  return match ? match.color : NEUTRAL_POINT_COLOR;
}

export interface MuscleZone {
  muscle: string;
  x: number;
  y: number;
  radius: number;
}

// Chamado só para um ponto recém-criado (nunca para reescrever um já
// existente/editado) — resolve a zona mais próxima e, se o músculo tiver um
// padrão de dose configurado, já devolve os dois pré-preenchidos. Sem zona
// dentro do raio → null, ficha se comporta exatamente como antes (campo
// vazio, profissional preenche à mão).
export function prefillPointRecord(
  point: { x: number; y: number },
  zones: MuscleZone[] | undefined | null,
  muscleDefaults: Record<string, string>
): { muscle: string; unidades: string } | null {
  const zone = nearestMuscleZone(point, zones);
  if (!zone) return null;
  return { muscle: zone.muscle, unidades: muscleDefaults[zone.muscle] || '' };
}

// Zona mais próxima cujo raio contém o ponto (x,y normalizados 0..1) —
// geometria determinística, nunca "IA adivinhando". Sem zona nenhuma dentro
// do raio → null, e o app não pré-preenche nada.
export function nearestMuscleZone(
  point: { x: number; y: number },
  zones: MuscleZone[] | undefined | null
): MuscleZone | null {
  if (!zones || zones.length === 0) return null;
  let best: MuscleZone | null = null;
  let bestDist = Infinity;
  for (const zone of zones) {
    const dx = point.x - zone.x;
    const dy = point.y - zone.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= zone.radius && dist < bestDist) {
      best = zone;
      bestDist = dist;
    }
  }
  return best;
}
