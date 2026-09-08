/**
 * PlanningCore — the template registry behind Planejamento IA.
 *
 * Framework-free (no React, no Firestore SDK) so it can be imported as-is by
 * both the client bundle (`NextPlanningAI.tsx`, via Vite) and the server
 * bundle (`server.ts`, via esbuild) — same pattern already used by
 * `procedureTaxonomy.ts`. This is the single place that knows what makes one
 * clinical procedure's planning flow different from another's. Adding a new
 * procedure means adding one entry here (plus one Catálogo Clínico doc
 * pointing `templateId` at it) — never a new screen, never a branch on
 * `procedureId` in `NextPlanningAI.tsx` or `server.ts`.
 *
 * Every field a template can define:
 * - `procedureId` / `specialty` — which real Catálogo Clínico procedure and
 *   taxonomy category this template belongs to (traceability; the actual
 *   runtime link from a catalog doc to its template is still the doc's own
 *   `templateId` field, so a template is self-describing without requiring
 *   a Firestore read to know what it's for).
 * - `documentTypes` — which kinds of image/document this template accepts,
 *   in default order.
 * - `clinicalFields` — structured fields shown in addition to the
 *   always-present objective/clinicalEvaluation pair every template gets
 *   for free.
 * - `canvasTools` — subset of AcademyPlanningCanvas tool ids to show.
 * - `aiContext` — descriptive framing of what the AI is looking at and what
 *   this template covers. Purely informational — never the place a
 *   constraint lives, so it can't accidentally get diluted among framing text.
 * - `safetyRules` — explicit, enumerable constraints, rendered as their own
 *   non-negotiable block in the prompt, separate from `aiContext`.
 *   (2026-08-31, decisão explícita do usuário) A IA PODE sugerir valores
 *   clínicos (dose/volume/medida/técnica) como orientação — nunca proibido
 *   por padrão — mas toda sugestão precisa: (1) vir explicitamente marcada
 *   como sugestão (nunca como fato/medida real), (2) nunca ser aplicada
 *   automaticamente num campo, (3) permanecer sempre editável, exigindo
 *   confirmação humana antes de qualquer uso clínico real. Isso é
 *   consolidado aqui pra um revisor auditar a regra de cada template lendo
 *   só este arquivo.
 * - `outputSchema` — the categories the AI's structured response is split
 *   into. Both templates validated so far use `STANDARD_ANALYSIS_SCHEMA`
 *   (dado clínico / observação visual / informação do profissional /
 *   inferência / sugestão) — the field is real and both the prompt builder
 *   and the JSON parser on the server, and the render loop on the client,
 *   all read it instead of a hardcoded 5-key literal. A template is free to
 *   declare a different schema later; nothing assumes exactly 5 categories.
 * - `executionFields` / `executionCanvasTools` / `executionSafetyNotes` —
 *   same shape as their planning counterparts, but for Planejamento →
 *   Execução (what was actually done, recorded separately from the plan,
 *   never overwriting it). No AI is involved in execution, so
 *   `executionSafetyNotes` are plain UI copy, not prompt input. Empty until a
 *   template has real execution support — `toxina_botulinica` and
 *   `implante_unitario` both have it; `DEFAULT_TEMPLATE` stays empty, which is
 *   what gates "Executar planejamento" off for any procedure without a real
 *   template.
 */

export type DocumentType = 'fotografia_clinica' | 'radiografia' | 'tomografia' | 'outro_exame';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  fotografia_clinica: 'Fotografia clínica',
  radiografia: 'Radiografia',
  tomografia: 'Tomografia',
  outro_exame: 'Outro exame',
};

export interface ClinicalField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'boolean';
  options?: string[];
  placeholder?: string;
}

export interface AnalysisSchemaField {
  key: string;
  label: string;
  hint: string;
}

export type AnalysisOutputSchema = AnalysisSchemaField[];

// The one schema both validated templates use today. A future template with
// a genuinely different analytical shape would declare its own array here —
// nothing in the prompt builder, JSON parser, or client render loop assumes
// this exact schema, only that `outputSchema` is *some* non-empty array of
// {key,label,hint}.
export const STANDARD_ANALYSIS_SCHEMA: AnalysisOutputSchema = [
  { key: 'dadoClinico', label: 'Dado Clínico', hint: 'Já registrado no prontuário' },
  { key: 'observacaoVisual', label: 'Observação Visual', hint: 'O que a IA vê nas imagens selecionadas' },
  { key: 'informacaoProfissional', label: 'Informação do Profissional', hint: 'O que você informou' },
  { key: 'inferencia', label: 'Inferência', hint: 'Leitura da IA — não é fato' },
  { key: 'sugestao', label: 'Sugestão', hint: 'Para você considerar — decisão é sua' },
];

// Clinical Learning Workspace (2026-08-29) — the visual ficha + interactive
// anatomical map used by Eliza Academy (and, in a later phase, the real
// clinical Planejamento/Execução screens). Optional: only templates with a
// point-map workflow declare this; others keep rendering the plain field
// list they already had.
export interface ClinicalWorkspaceConfig {
  // Fixed, standardized list of selectable region/muscle names for the
  // point table's dropdown — confirmed fixed for MVP (not editable by the
  // professor). Points themselves are still created freely by clicking the
  // canvas (AcademyPlanningCanvas's existing 'point' tool); this only
  // constrains what each point can be labeled as. Omitted (e.g.
  // Preenchimento) → the point table falls back to a free-text região field
  // per point instead of a fixed dropdown — there's no equivalent
  // standardized catalog for filler zones the way there is for the 20
  // named muscles on the Toxina ficha.
  muscleCatalog?: string[];
  anatomicalAssetUrl: string;
  anatomicalAssetUrlAlt?: string; // e.g. a male variant, user-selectable
  // The per-point measurement means something different per procedure
  // (Toxina: units applied; Preenchimento: volume in ml) — never hardcode
  // "Unidades" as if it were universal. Defaults to 'Unidades' when omitted.
  pointValueLabel?: string;
  pointValuePlaceholder?: string;
  // Zonas fixas de músculo/região desenhadas à mão sobre a imagem de
  // referência (2026-08-30) — geometria determinística, nunca "IA
  // adivinhando": ao criar um ponto NOVO, o app resolve a zona mais próxima
  // dentro do raio e pré-preenche o nome do músculo — sempre editável pelo
  // profissional depois. Coordenadas normalizadas (0..1) na imagem de
  // referência (`anatomicalAssetUrl`/`anatomicalAssetUrlAlt`, que têm o
  // mesmo enquadramento). Omitido (ex. Preenchimento, sem catálogo fixo) →
  // nenhuma sugestão automática, comportamento igual a antes.
  muscleZones?: { muscle: string; x: number; y: number; radius: number }[];
}

export interface ProcedureTemplate {
  templateId: string;
  procedureId: string;
  specialty: string;
  documentTypes: DocumentType[];
  clinicalFields: ClinicalField[];
  canvasTools: string[];
  aiContext: string;
  safetyRules: string[];
  outputSchema: AnalysisOutputSchema;
  // Execução (Planejamento → Execução) — reaproveita o mesmo tipo `ClinicalField`
  // e o mesmo `AcademyPlanningCanvas` do planejamento, num contexto separado
  // (o que foi realmente feito, não o que foi planejado). Vazio até o template
  // ganhar suporte real à execução — nenhum código de execução deve assumir
  // que esses arrays não estão vazios.
  executionFields: ClinicalField[];
  executionCanvasTools: string[];
  // Avisos exibidos só na UI da execução — a execução nunca chama IA, então
  // isso nunca vira prompt (ao contrário de `safetyRules`).
  executionSafetyNotes: string[];
  // Present only for templates with the visual point-map workspace.
  clinicalWorkspace?: ClinicalWorkspaceConfig;
}

// Os 20 músculos da ficha real de aplicação de Toxina Botulínica já usada
// pela clínica (Harmo Orofacial) — lista fixa e padronizada (decisão do
// usuário: não editável por professor nesta rodada), vira o catálogo de
// nomes selecionáveis pra cada ponto que a aluna/profissional marcar no mapa.
export const TOXINA_MUSCLE_CATALOG: string[] = [
  'M. Frontal', 'M. Prócero', 'M. Corrugador (esquerdo)', 'M. Corrugador (direito)',
  'M. Orbicular do Olho (esquerdo)', 'M. Orbicular do Olho (direito)', 'M. Nasal',
  'M. Depressor do Septo Nasal', 'M. Levantador do Ângulo da Boca', 'M. Platisma',
  'M. Temporal', 'M. Masseter', 'M. Bucinador', 'M. Risório', 'M. Orbicular da Boca',
  'M. Zigomático Maior', 'M. Zigomático Menor', 'M. Levantador do Lábio Superior',
  'M. Depressor do Ângulo da Boca', 'M. Mental / Depressor do Lábio Inferior',
];

// Every template accepts the same base pair (objetivo do paciente / avaliação
// clínica do profissional) — that's not part of `clinicalFields`, it's
// rendered unconditionally by NextPlanningAI.tsx for every template.

export const PLANNING_TEMPLATES: Record<string, ProcedureTemplate> = {
  toxina_botulinica: {
    templateId: 'toxina_botulinica',
    procedureId: 'hof_toxina_botulinica',
    specialty: 'harmonizacao_orofacial',
    documentTypes: ['fotografia_clinica'],
    clinicalFields: [],
    // Reduzido a só 'point' + 'eraser' (2026-08-30) — o fluxo real é marcar
    // pontos rápido, não desenhar livremente; Desfazer é botão fixo do
    // cabeçalho do canvas, continua disponível sem precisar estar na lista.
    canvasTools: ['point', 'eraser'],
    aiContext:
      'Você está analisando fotografia(s) clínica(s) para apoio ao planejamento de toxina botulínica. Descreva apenas o que é visualmente observável (simetria, linhas de expressão, volume aparente, textura).',
    safetyRules: [
      'Pode sugerir uma dose/quantidade típica (unidades) por região, como orientação — sempre deixando claro que é uma sugestão editável, nunca uma prescrição pronta; a decisão final e a confirmação do valor são sempre do profissional.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    executionFields: [
      // 'regiao' (livre) e 'unidadesTotais' (digitado) ficam mantidos aqui só
      // por compatibilidade com o formulário genérico antigo (ainda usado por
      // templates sem `clinicalWorkspace`) — o Clinical Learning Workspace os
      // substitui pela tabela de pontos (região = músculo do ponto) e pelo
      // total calculado deterministicamente a partir dela; ver ClinicalFichaPanel.
      { key: 'regiao', label: 'Região(ões) tratada(s)', type: 'textarea', placeholder: 'Ex: Frontal, Glabela, Pés de galinha (bilateral)...' },
      { key: 'produto', label: 'Produto', type: 'text', placeholder: 'Ex: Botox, Dysport, Xeomin...' },
      { key: 'lote', label: 'Lote', type: 'text' },
      { key: 'validade', label: 'Validade', type: 'text', placeholder: 'DD/MM/AAAA' },
      { key: 'dataDiluicao', label: 'Data de diluição', type: 'text', placeholder: 'DD/MM/AAAA' },
      { key: 'volumeDiluicao', label: 'Volume de diluição', type: 'text', placeholder: 'Ex: 2,5 ml' },
      { key: 'unidadesTotais', label: 'Unidades totais aplicadas', type: 'text', placeholder: 'Sugestão da ELIZA quando disponível — sempre editável e confirmada por você' },
    ],
    executionCanvasTools: ['point', 'eraser'],
    executionSafetyNotes: [
      'A ELIZA pode sugerir uma dose/unidades típica — o valor final acima é sempre revisado, confirmado ou editado por você antes de salvar.',
    ],
    clinicalWorkspace: {
      muscleCatalog: TOXINA_MUSCLE_CATALOG,
      anatomicalAssetUrl: '/academy/anatomia-facial-feminino.png',
      anatomicalAssetUrlAlt: '/academy/anatomia-facial-masculino.png',
      // Zonas estimadas visualmente sobre as duas imagens de referência
      // (mesmo enquadramento nas duas) — convenção fotográfica padrão, NÃO
      // espelhada: o lado esquerdo do paciente aparece do lado direito da
      // imagem, então "esquerdo" sempre leva x > 0.5. Só resolve o músculo
      // ao criar um ponto NOVO dentro do raio; sempre corrigível depois.
      muscleZones: [
        { muscle: 'M. Frontal', x: 0.5, y: 0.2, radius: 0.06 },
        { muscle: 'M. Frontal', x: 0.62, y: 0.21, radius: 0.06 },
        { muscle: 'M. Frontal', x: 0.38, y: 0.21, radius: 0.06 },
        { muscle: 'M. Prócero', x: 0.5, y: 0.37, radius: 0.045 },
        { muscle: 'M. Corrugador (esquerdo)', x: 0.57, y: 0.36, radius: 0.04 },
        { muscle: 'M. Corrugador (direito)', x: 0.43, y: 0.36, radius: 0.04 },
        { muscle: 'M. Orbicular do Olho (esquerdo)', x: 0.72, y: 0.45, radius: 0.05 },
        { muscle: 'M. Orbicular do Olho (direito)', x: 0.28, y: 0.45, radius: 0.05 },
        { muscle: 'M. Nasal', x: 0.55, y: 0.58, radius: 0.035 },
        { muscle: 'M. Nasal', x: 0.45, y: 0.58, radius: 0.035 },
        { muscle: 'M. Depressor do Septo Nasal', x: 0.5, y: 0.65, radius: 0.03 },
        { muscle: 'M. Levantador do Ângulo da Boca', x: 0.6, y: 0.7, radius: 0.035 },
        { muscle: 'M. Levantador do Ângulo da Boca', x: 0.4, y: 0.7, radius: 0.035 },
        { muscle: 'M. Platisma', x: 0.65, y: 0.92, radius: 0.06 },
        { muscle: 'M. Platisma', x: 0.35, y: 0.92, radius: 0.06 },
        { muscle: 'M. Temporal', x: 0.8, y: 0.3, radius: 0.05 },
        { muscle: 'M. Temporal', x: 0.2, y: 0.3, radius: 0.05 },
        { muscle: 'M. Masseter', x: 0.78, y: 0.72, radius: 0.05 },
        { muscle: 'M. Masseter', x: 0.22, y: 0.72, radius: 0.05 },
        { muscle: 'M. Bucinador', x: 0.68, y: 0.68, radius: 0.04 },
        { muscle: 'M. Bucinador', x: 0.32, y: 0.68, radius: 0.04 },
        { muscle: 'M. Risório', x: 0.62, y: 0.76, radius: 0.03 },
        { muscle: 'M. Risório', x: 0.38, y: 0.76, radius: 0.03 },
        { muscle: 'M. Orbicular da Boca', x: 0.5, y: 0.77, radius: 0.05 },
        { muscle: 'M. Zigomático Maior', x: 0.7, y: 0.62, radius: 0.04 },
        { muscle: 'M. Zigomático Maior', x: 0.3, y: 0.62, radius: 0.04 },
        { muscle: 'M. Zigomático Menor', x: 0.66, y: 0.58, radius: 0.035 },
        { muscle: 'M. Zigomático Menor', x: 0.34, y: 0.58, radius: 0.035 },
        { muscle: 'M. Levantador do Lábio Superior', x: 0.58, y: 0.68, radius: 0.03 },
        { muscle: 'M. Levantador do Lábio Superior', x: 0.42, y: 0.68, radius: 0.03 },
        { muscle: 'M. Depressor do Ângulo da Boca', x: 0.6, y: 0.8, radius: 0.03 },
        { muscle: 'M. Depressor do Ângulo da Boca', x: 0.4, y: 0.8, radius: 0.03 },
        { muscle: 'M. Mental / Depressor do Lábio Inferior', x: 0.5, y: 0.87, radius: 0.05 },
      ],
    },
  },
  preenchimento_facial: {
    templateId: 'preenchimento_facial',
    procedureId: 'hof_preenchimento_facial',
    specialty: 'harmonizacao_orofacial',
    documentTypes: ['fotografia_clinica'],
    clinicalFields: [
      { key: 'regiao', label: 'Região a ser preenchida', type: 'text', placeholder: 'Ex: Sulco nasogeniano, lábios, região malar...' },
    ],
    canvasTools: ['point', 'eraser'],
    aiContext:
      'Você está analisando fotografia(s) clínica(s) para apoio ao planejamento de preenchimento facial com ácido hialurônico ou similar. Descreva apenas o que é visualmente observável (volume, sulcos, assimetria, contorno).',
    safetyRules: [
      'Pode sugerir um volume/quantidade típico (ml/seringas) por região, como orientação editável — nunca uma prescrição pronta; a decisão final e a confirmação do valor são sempre do profissional.',
      'Nunca sugira produto ou marca específica — neutralidade comercial é mantida mesmo com a sugestão de volume liberada.',
      'Pode sugerir uma técnica de aplicação típica (cânula, agulha, bolus, retroinjeção, leque etc.) como orientação — decisão final sempre do profissional.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    // `regiao` reuses the exact same key as clinicalFields above — mesmo
    // padrão do Implante Unitário, permite comparação real Planejado × Realizado.
    executionFields: [
      { key: 'regiao', label: 'Região efetivamente tratada', type: 'text', placeholder: 'Ex: Sulco nasogeniano' },
      { key: 'produto', label: 'Produto', type: 'text', placeholder: 'Ex: ácido hialurônico, marca/linha' },
      { key: 'lote', label: 'Lote', type: 'text' },
      { key: 'validade', label: 'Validade', type: 'text', placeholder: 'DD/MM/AAAA' },
      { key: 'volumeTotal', label: 'Volume total aplicado (ml)', type: 'text', placeholder: 'Sugestão da ELIZA quando disponível — sempre editável e confirmada por você' },
      { key: 'tecnica', label: 'Técnica utilizada', type: 'select', options: ['Cânula', 'Agulha', 'Retroinjeção', 'Bolus', 'Leque', 'Outra'] },
    ],
    executionCanvasTools: ['point', 'eraser'],
    executionSafetyNotes: [
      'A ELIZA pode sugerir um volume/técnica típica — o produto continua sempre escolhido por você, e o valor final acima é sempre revisado, confirmado ou editado antes de salvar.',
    ],
    clinicalWorkspace: {
      // No fixed catalog on purpose — filler zones (sulco nasogeniano,
      // malar, lábios...) aren't a standardized numbered list the way the
      // 20 Toxina muscles are; each point's "região" stays free text.
      anatomicalAssetUrl: '/academy/anatomia-facial-feminino.png',
      anatomicalAssetUrlAlt: '/academy/anatomia-facial-masculino.png',
      pointValueLabel: 'Volume (ml)',
      pointValuePlaceholder: 'Ex: 0,5',
    },
  },
  implante_unitario: {
    templateId: 'implante_unitario',
    procedureId: 'implantodontia_implante_unitario',
    specialty: 'implantodontia',
    documentTypes: ['radiografia', 'tomografia', 'fotografia_clinica', 'outro_exame'],
    clinicalFields: [
      { key: 'regiao', label: 'Região/elemento dentário', type: 'text', placeholder: 'Ex: 36' },
      { key: 'condicaoDente', label: 'Dente ausente ou indicado para extração', type: 'select', options: ['Ausente', 'Indicado para extração', 'Não se aplica'] },
      { key: 'condicaoEspaco', label: 'Condição do espaço', type: 'textarea', placeholder: 'Ex: espaço protético adequado, sem colapso' },
      { key: 'infoOssea', label: 'Informações ósseas disponíveis', type: 'textarea', placeholder: 'Só o que já foi medido/relatado em exame real — nunca invente' },
      { key: 'tecidoMole', label: 'Tecido mole', type: 'textarea', placeholder: 'Ex: mucosa ceratinizada adequada' },
      { key: 'examesDisponiveis', label: 'Exames disponíveis', type: 'text', placeholder: 'Ex: radiografia panorâmica, tomografia CBCT' },
      { key: 'tomografiaDisponivel', label: 'Tomografia disponível', type: 'boolean' },
    ],
    canvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    aiContext:
      'Este é um planejamento de Implante Unitário — as imagens podem ser radiografia, tomografia ou fotografia clínica, cada uma com um tipo declarado que você deve respeitar (nunca leia uma radiografia/tomografia como se fosse foto de rosto/pele).',
    safetyRules: [
      'Pode sugerir uma faixa/valor de referência típico de diâmetro, comprimento, sistema de implante ou torque como orientação geral — sempre deixando explícito que é uma sugestão editável, nunca uma medida real; o valor final exige confirmação por medição/calibração real do profissional, nunca estimada só pela imagem.',
      'Pode sugerir a necessidade de enxerto ósseo ou uma posição 3D de referência como orientação a ser avaliada — nunca como decisão fechada; sempre deixando claro que depende de exame real e do julgamento do profissional.',
      'Comentar altura/espessura óssea ou distância a estruturas anatômicas (canal mandibular, seio maxilar) é permitido como leitura/sugestão a partir da imagem, mas sempre com a ressalva de que não substitui medição calibrada — nunca apresente esse número como um dado medido real.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    // `regiao` reuses the exact same key as the planning template's
    // clinicalFields entry above — it's the one field where planning and
    // execution genuinely ask the same question ("qual dente/região"), so
    // computePlannedVsRealized() in NextMedicalRecord.tsx can produce a real
    // matched/changed comparison instead of the "sem equivalente" fallback
    // Toxina gets. Every other key here is execution-only on purpose.
    executionFields: [
      { key: 'regiao', label: 'Região/elemento dentário efetivamente tratado', type: 'text', placeholder: 'Ex: 36' },
      { key: 'procedimentoRealizado', label: 'Procedimento efetivamente realizado', type: 'text', placeholder: 'Ex: Instalação de implante unitário' },
      { key: 'sistemaMarca', label: 'Sistema/marca do implante', type: 'text' },
      { key: 'implanteUtilizado', label: 'Implante utilizado', type: 'text', placeholder: 'Referência/modelo' },
      { key: 'diametro', label: 'Diâmetro informado', type: 'text', placeholder: 'Ex: 4.1mm — valor real do ato; uma sugestão da ELIZA pode orientar, mas a confirmação é sempre sua' },
      { key: 'comprimento', label: 'Comprimento informado', type: 'text', placeholder: 'Ex: 10mm — valor real do ato; uma sugestão da ELIZA pode orientar, mas a confirmação é sempre sua' },
      { key: 'torque', label: 'Torque informado', type: 'text', placeholder: 'Ex: 35 Ncm' },
      { key: 'enxertoRealizado', label: 'Enxerto ósseo realizado', type: 'boolean' },
      { key: 'biomaterial', label: 'Biomaterial utilizado (quando aplicável)', type: 'text' },
    ],
    executionCanvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    executionSafetyNotes: [
      'Diâmetro, comprimento e torque final são sempre os valores realmente utilizados/medidos no ato cirúrgico, confirmados por você — uma sugestão da ELIZA pode orientar a faixa esperada, mas nunca substitui a medição/calibração real.',
    ],
  },
  dentistica_restauradora: {
    templateId: 'dentistica_restauradora',
    procedureId: 'dentistica_restauracao',
    specialty: 'dentistica_restauradora',
    documentTypes: ['fotografia_clinica', 'radiografia', 'outro_exame'],
    clinicalFields: [
      { key: 'dente', label: 'Dente (numeração FDI)', type: 'text', placeholder: 'Ex: 26' },
      { key: 'faces', label: 'Face(s) acometida(s)', type: 'text', placeholder: 'Ex: Oclusal e mesial (OM)' },
      { key: 'classificacaoCavidade', label: 'Classificação da cavidade (Black)', type: 'select', options: ['Classe I', 'Classe II', 'Classe III', 'Classe IV', 'Classe V', 'Classe VI', 'Não se aplica'] },
      { key: 'profundidadeEstimada', label: 'Profundidade estimada', type: 'select', options: ['Superficial (esmalte)', 'Média (dentina superficial)', 'Profunda (próxima à polpa)', 'Não avaliável pela imagem'] },
      { key: 'sensibilidadeRelatada', label: 'Sensibilidade relatada pelo paciente', type: 'textarea', placeholder: 'Ex: sensibilidade ao frio, esporádica' },
      { key: 'materialSugerido', label: 'Material sugerido', type: 'select', options: ['Resina composta', 'Ionômero de vidro', 'Cerâmica (indireta)', 'A definir'] },
    ],
    canvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    aiContext:
      'Este é um planejamento de Dentística/Restauradora — as imagens podem ser fotografia clínica intraoral ou radiografia, cada uma com um tipo declarado que você deve respeitar. Descreva apenas o que é visualmente observável (extensão aparente da lesão de cárie ou restauração antiga, comprometimento de face, cor/textura do dente e do tecido adjacente).',
    safetyRules: [
      'Pode sugerir uma classificação de cavidade (Black) ou profundidade estimada como orientação a partir da imagem — sempre deixando claro que é uma leitura visual, nunca um diagnóstico fechado; a confirmação depende de exame clínico real (sonda, exploração) do profissional.',
      'Pode sugerir um material restaurador típico para o caso descrito, como orientação editável — nunca uma prescrição pronta; a escolha final é sempre do profissional.',
      'Nunca infira proximidade pulpar real ou necessidade de tratamento endodôntico a partir só da imagem — pode mencionar como possibilidade a ser avaliada clinicamente, nunca como conclusão.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    // `dente` reuses the exact same key as the planning template's
    // clinicalFields entry — mesmo padrão do Implante Unitário, permite
    // comparação real Planejado × Realizado em computePlannedVsRealized().
    executionFields: [
      { key: 'dente', label: 'Dente efetivamente tratado', type: 'text', placeholder: 'Ex: 26' },
      { key: 'materialUtilizado', label: 'Material efetivamente utilizado', type: 'select', options: ['Resina composta', 'Ionômero de vidro', 'Cerâmica (indireta)', 'Outro'] },
      { key: 'corResina', label: 'Cor (escala VITA, quando aplicável)', type: 'text', placeholder: 'Ex: A2' },
      { key: 'tecnicaAdesiva', label: 'Técnica adesiva utilizada', type: 'text', placeholder: 'Ex: condicionamento total, sistema adesivo universal' },
      { key: 'necessitouForramento', label: 'Necessitou forramento/proteção pulpar', type: 'boolean' },
      { key: 'observacoes', label: 'Observações do ato', type: 'textarea' },
    ],
    executionCanvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    executionSafetyNotes: [
      'Material, cor e técnica adesiva final são sempre os efetivamente utilizados no ato, confirmados por você — uma sugestão da ELIZA pode orientar o planejamento, mas nunca substitui a decisão clínica real.',
    ],
  },
  endodontia_tratamento_canal: {
    templateId: 'endodontia_tratamento_canal',
    procedureId: 'endodontia_tratamento_canal',
    specialty: 'endodontia',
    documentTypes: ['radiografia', 'tomografia', 'fotografia_clinica', 'outro_exame'],
    clinicalFields: [
      { key: 'dente', label: 'Dente (numeração FDI)', type: 'text', placeholder: 'Ex: 46' },
      { key: 'diagnosticoPulpar', label: 'Diagnóstico pulpar', type: 'select', options: ['Polpa normal', 'Pulpite reversível', 'Pulpite irreversível', 'Necrose pulpar', 'Não avaliável clinicamente'] },
      { key: 'diagnosticoPeriapical', label: 'Diagnóstico periapical', type: 'select', options: ['Sem alterações periapicais', 'Periodontite apical sintomática', 'Periodontite apical assintomática', 'Abscesso apical agudo', 'Abscesso apical crônico', 'Não avaliável pela imagem'] },
      { key: 'numeroCanaisEstimado', label: 'Número de canais estimado (anatomia típica)', type: 'text', placeholder: 'Ex: 3 — estimativa pela anatomia do dente, sempre confirmada na exploração real' },
      { key: 'sintomatologia', label: 'Sintomatologia relatada', type: 'textarea', placeholder: 'Ex: dor espontânea, dor à percussão, sensibilidade térmica prolongada...' },
    ],
    canvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    aiContext:
      'Este é um planejamento de Endodontia (Tratamento de Canal) — as imagens costumam ser radiografia periapical/panorâmica ou tomografia, cada uma com um tipo declarado que você deve respeitar. Descreva apenas o que é visualmente observável (radiolucidez periapical, amplitude/calcificação do canal radicular, reabsorções, extensão de lesão de cárie visível).',
    safetyRules: [
      'Pode sugerir um diagnóstico pulpar ou periapical como leitura a partir da imagem e da sintomatologia relatada, sempre marcado como sugestão — nunca fato; o diagnóstico definitivo depende de testes clínicos reais (percussão, palpação, teste térmico/elétrico) do profissional.',
      'Pode sugerir o número de canais esperado com base na anatomia típica do dente/grupo dentário, como orientação — nunca como contagem real; a contagem definitiva só é confirmada na exploração do canal durante o ato.',
      'Nunca sugira um comprimento de trabalho (odontometria) — esse valor exige medição real (localizador apical e/ou radiografia com lima em posição) e nunca deve ser estimado a partir de uma imagem estática.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    // `dente` reuses the exact same key as the planning template's
    // clinicalFields entry — mesmo padrão dos templates anteriores, permite
    // comparação real Planejado × Realizado em computePlannedVsRealized().
    executionFields: [
      { key: 'dente', label: 'Dente efetivamente tratado', type: 'text', placeholder: 'Ex: 46' },
      { key: 'numeroCanaisTratados', label: 'Número de canais efetivamente tratados', type: 'text', placeholder: 'Valor real confirmado na exploração' },
      { key: 'comprimentoTrabalho', label: 'Comprimento de trabalho (odontometria)', type: 'textarea', placeholder: 'Valor real medido por canal (localizador apical/radiografia) — nunca estimado' },
      { key: 'materialObturador', label: 'Material obturador', type: 'text', placeholder: 'Ex: guta-percha + cimento resinoso' },
      { key: 'tecnicaObturadora', label: 'Técnica obturadora', type: 'select', options: ['Condensação lateral', 'Técnica híbrida', 'Cone único', 'Termoplastificada', 'Outra'] },
      { key: 'intercorrencias', label: 'Intercorrências', type: 'textarea', placeholder: 'Ex: fratura de instrumento, perfuração, degrau — deixe em branco se não houve' },
    ],
    executionCanvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    executionSafetyNotes: [
      'Número de canais e comprimento de trabalho final são sempre os valores reais medidos no ato (localizador apical/radiografia com lima), confirmados por você — nunca os valores estimados no planejamento a partir da imagem.',
    ],
  },
  protese_reabilitacao: {
    templateId: 'protese_reabilitacao',
    procedureId: 'protese_reabilitacao',
    specialty: 'protese',
    documentTypes: ['fotografia_clinica', 'radiografia', 'outro_exame'],
    clinicalFields: [
      { key: 'tipoProtese', label: 'Tipo de prótese', type: 'select', options: ['Coroa unitária', 'Prótese parcial fixa (ponte)', 'Prótese parcial removível', 'Prótese total (dentadura)', 'Prótese sobre implante', 'Faceta/laminado', 'Outra'] },
      { key: 'dentesRegiao', label: 'Dente(s)/região', type: 'text', placeholder: 'Ex: 11, 21 ou "Arcada superior completa"' },
      { key: 'corVita', label: 'Cor prevista (escala VITA)', type: 'text', placeholder: 'Ex: A2' },
      { key: 'materialPrevisto', label: 'Material previsto', type: 'select', options: ['Cerâmica pura (dissilicato de lítio/zircônia)', 'Metalocerâmica', 'Resina acrílica', 'Resina composta (faceta)', 'A definir'] },
      { key: 'tipoMoldagem', label: 'Tipo de moldagem previsto', type: 'select', options: ['Convencional (moldeira/silicone)', 'Digital (escaneamento intraoral)', 'Não se aplica'] },
    ],
    canvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    aiContext:
      'Este é um planejamento de Prótese/Reabilitação — as imagens costumam ser fotografia clínica intraoral, eventualmente radiografia. Descreva apenas o que é visualmente observável (espaço protético, desgaste, cor/tonalidade aparente, contorno gengival, estado dos dentes remanescentes ou pilares).',
    safetyRules: [
      'Pode sugerir uma cor (escala VITA) e um material como orientação a partir da imagem, sempre marcado como sugestão — nunca definitivo; iluminação e câmera alteram muito a percepção de cor, então a confirmação real exige comparação com escala física sob luz padronizada, feita pelo profissional.',
      'Pode sugerir tipo de prótese e tipo de moldagem como orientação — a decisão final depende do exame clínico real e é sempre do profissional.',
      'Nunca garanta ajuste oclusal, encaixe ou adaptação da prótese a partir só da imagem — isso só é confirmado na prova clínica real.',
    ],
    outputSchema: STANDARD_ANALYSIS_SCHEMA,
    // `dentesRegiao` reuses the exact same key as the planning template's
    // clinicalFields entry — mesmo padrão dos templates anteriores, permite
    // comparação real Planejado × Realizado em computePlannedVsRealized().
    executionFields: [
      { key: 'dentesRegiao', label: 'Dente(s)/região efetivamente tratada', type: 'text', placeholder: 'Ex: 11, 21' },
      { key: 'tipoInstalado', label: 'Tipo de prótese efetivamente instalada', type: 'text' },
      { key: 'materialFinal', label: 'Material final utilizado', type: 'text' },
      { key: 'corFinal', label: 'Cor final (escala VITA)', type: 'text', placeholder: 'Confirmada na prova/instalação — sempre o valor real' },
      { key: 'ajustesRealizados', label: 'Ajustes realizados', type: 'textarea', placeholder: 'Ex: desgaste oclusal seletivo, alívio de borda...' },
    ],
    executionCanvasTools: ['point', 'line', 'arrow', 'area', 'text'],
    executionSafetyNotes: [
      'Material e cor final são sempre os efetivamente confirmados na prova/instalação, definidos por você — uma sugestão da ELIZA no planejamento pode orientar, mas nunca substitui a confirmação real com o paciente presente.',
    ],
  },
};

// Rótulo em português exibido em toda a UI (formulário do Catálogo de
// Procedimentos, listagens etc.) — fonte única, substitui o antigo `if/else`
// hardcoded que existia em `NextProcedureCatalogAdmin.tsx`. Ao adicionar um
// template novo, o rótulo já aparece em todo lugar sem tocar outro arquivo.
export const TEMPLATE_LABELS: Record<string, string> = {
  toxina_botulinica: 'Toxina Botulínica',
  preenchimento_facial: 'Preenchimento Facial',
  implante_unitario: 'Implante Unitário',
  dentistica_restauradora: 'Dentística/Restauradora',
  endodontia_tratamento_canal: 'Endodontia (Tratamento de Canal)',
  protese_reabilitacao: 'Prótese/Reabilitação',
};

export const DEFAULT_TEMPLATE: ProcedureTemplate = {
  templateId: 'generico',
  procedureId: '',
  specialty: 'outro',
  documentTypes: ['fotografia_clinica', 'radiografia', 'tomografia', 'outro_exame'],
  clinicalFields: [],
  canvasTools: ['pen', 'line', 'arrow', 'circle', 'point', 'area', 'text', 'eraser', 'move'],
  aiContext: 'Descreva apenas o que é visualmente observável nas imagens fornecidas, respeitando o tipo declarado de cada uma.',
  safetyRules: [
    'Pode sugerir uma dose/medida/especificação técnica típica como orientação editável — nunca como prescrição pronta; a decisão final e a confirmação do valor são sempre do profissional.',
  ],
  outputSchema: STANDARD_ANALYSIS_SCHEMA,
  executionFields: [],
  executionCanvasTools: [],
  executionSafetyNotes: [],
};

export function getTemplateForId(templateId: string | undefined | null): ProcedureTemplate {
  return (templateId && PLANNING_TEMPLATES[templateId]) || DEFAULT_TEMPLATE;
}
