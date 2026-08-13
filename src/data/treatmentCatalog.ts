export interface TreatmentCatalogItem {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  defaultPrice: number;
  baseValue?: number; // compatilidade
  description: string;
  estimatedDuration: number;
  requiresFaces: boolean;
  requiresRegion: boolean;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export const TREATMENT_CATEGORIES = [
  'Harmonização Facial',
  'Procedimentos Odontológicos',
  'Cirurgias',
  'Implantes e Próteses',
  'Avaliações e Consultas',
  'Outros'
];

export const DEFAULT_TREATMENT_CATALOG: TreatmentCatalogItem[] = [
  // Harmonização Facial
  { id: 'def-tox-bot', name: 'Toxina Botulínica', category: 'Harmonização Facial', subcategory: 'Toxina', defaultPrice: 1200, baseValue: 1200, description: 'Aplicação de toxina botulínica para rugas de expressão.', estimatedDuration: 30, requiresFaces: true, requiresRegion: false, active: true },
  { id: 'def-pre-lab', name: 'Preenchimento Labial', category: 'Harmonização Facial', subcategory: 'Ácido Hialurônico', defaultPrice: 1500, baseValue: 1500, description: 'Preenchimento labial para volume e contorno.', estimatedDuration: 40, requiresFaces: true, requiresRegion: false, active: true },
  { id: 'def-pre-mal', name: 'Preenchimento Malar', category: 'Harmonização Facial', subcategory: 'Ácido Hialurônico', defaultPrice: 1800, baseValue: 1800, description: 'Preenchimento da região malar para sustentação.', estimatedDuration: 40, requiresFaces: true, requiresRegion: false, active: true },
  { id: 'def-bio-col', name: 'Bioestimulador de Colágeno', category: 'Harmonização Facial', subcategory: 'Bioestimulador', defaultPrice: 2200, baseValue: 2200, description: 'Aplicação de bioestimulador para firmeza da pele.', estimatedDuration: 45, requiresFaces: true, requiresRegion: false, active: true },
  { id: 'def-fio-pdo', name: 'Fios de PDO', category: 'Harmonização Facial', subcategory: 'Fios', defaultPrice: 1500, baseValue: 1500, description: 'Inserção de fios de PDO para sustentação facial.', estimatedDuration: 60, requiresFaces: true, requiresRegion: false, active: true },
  { id: 'def-lipo-pap', name: 'Lipo de Papada Enzimática', category: 'Harmonização Facial', subcategory: 'Lipo Enzimática', defaultPrice: 400, baseValue: 400, description: 'Redução de papada através de enzimas.', estimatedDuration: 30, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-rinom', name: 'Rinomodelação', category: 'Harmonização Facial', subcategory: 'Ácido Hialurônico', defaultPrice: 2000, baseValue: 2000, description: 'Modelagem nasal com preenchedor.', estimatedDuration: 40, requiresFaces: true, requiresRegion: false, active: true },

  // Procedimentos Odontológicos
  { id: 'def-cons-aval', name: 'Consulta Inicial / Avaliação', category: 'Procedimentos Odontológicos', subcategory: 'Avaliação', defaultPrice: 150, baseValue: 150, description: 'Consulta inicial de avaliação e planejamento.', estimatedDuration: 30, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-profi', name: 'Profilaxia', category: 'Procedimentos Odontológicos', subcategory: 'Limpeza', defaultPrice: 250, baseValue: 250, description: 'Limpeza profissional, tartrectomia e polimento.', estimatedDuration: 40, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-rest', name: 'Restauração', category: 'Procedimentos Odontológicos', subcategory: 'Dentística', defaultPrice: 180, baseValue: 180, description: 'Restauração de dente em resina composta.', estimatedDuration: 45, requiresFaces: true, requiresRegion: true, active: true },
  { id: 'def-clare', name: 'Clareamento', category: 'Procedimentos Odontológicos', subcategory: 'Estética', defaultPrice: 800, baseValue: 800, description: 'Clareamento dental supervisionado.', estimatedDuration: 30, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-canal', name: 'Tratamento Canal', category: 'Procedimentos Odontológicos', subcategory: 'Endodontia', defaultPrice: 900, baseValue: 900, description: 'Tratamento de canais radiculares.', estimatedDuration: 60, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-exod', name: 'Exodontia', category: 'Procedimentos Odontológicos', subcategory: 'Cirurgia Oral', defaultPrice: 350, baseValue: 350, description: 'Extração simples de dente.', estimatedDuration: 45, requiresFaces: false, requiresRegion: true, active: true },

  // Cirurgias
  { id: 'def-bich', name: 'Bichectomia', category: 'Cirurgias', subcategory: 'Estética', defaultPrice: 3500, baseValue: 3500, description: 'Remoção parcial das bolas de Bichat.', estimatedDuration: 60, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-lipl', name: 'Liplift', category: 'Cirurgias', subcategory: 'Estética', defaultPrice: 4500, baseValue: 4500, description: 'Encurtamento cirúrgico do lábio superior.', estimatedDuration: 90, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-blef', name: 'Blefaroplastia', category: 'Cirurgias', subcategory: 'Estética', defaultPrice: 6000, baseValue: 6000, description: 'Cirurgia plástica das pálpebras.', estimatedDuration: 120, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-fren', name: 'Frenectomia', category: 'Cirurgias', subcategory: 'Cirurgia Oral', defaultPrice: 400, baseValue: 400, description: 'Remoção do freio labial ou lingual.', estimatedDuration: 30, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-ciri-per', name: 'Cirurgia Periodontal', category: 'Cirurgias', subcategory: 'Periodontia', defaultPrice: 800, baseValue: 800, description: 'Tratamento cirúrgico de gengivas e tecidos.', estimatedDuration: 60, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-ext-siso', name: 'Extração de Siso', category: 'Cirurgias', subcategory: 'Cirurgia Oral', defaultPrice: 600, baseValue: 600, description: 'Extração cirúrgica de dente siso.', estimatedDuration: 60, requiresFaces: false, requiresRegion: true, active: true },

  // Implantes e Próteses
  { id: 'def-impl-un', name: 'Implante Unitário', category: 'Implantes e Próteses', subcategory: 'Implante', defaultPrice: 2500, baseValue: 2500, description: 'Instalação de implante dentário unitário.', estimatedDuration: 60, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-prot-col', name: 'Prótese Protocolo', category: 'Implantes e Próteses', subcategory: 'Prótese', defaultPrice: 15000, baseValue: 15000, description: 'Reabilitação total sobre implantes.', estimatedDuration: 120, requiresFaces: false, requiresRegion: false, active: true },
  { id: 'def-coro-impl', name: 'Coroa sobre Implante', category: 'Implantes e Próteses', subcategory: 'Prótese', defaultPrice: 2000, baseValue: 2000, description: 'Instalação de coroa definitiva sobre implante.', estimatedDuration: 45, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-enx-os', name: 'Enxerto Ósseo', category: 'Implantes e Próteses', subcategory: 'Cirurgia Reconstrutiva', defaultPrice: 1800, baseValue: 1800, description: 'Reconstrução de volume ósseo.', estimatedDuration: 60, requiresFaces: false, requiresRegion: true, active: true },
  { id: 'def-provi', name: 'Provisório', category: 'Implantes e Próteses', subcategory: 'Prótese', defaultPrice: 300, baseValue: 300, description: 'Coroa ou prótese provisória.', estimatedDuration: 30, requiresFaces: false, requiresRegion: true, active: true },
];
