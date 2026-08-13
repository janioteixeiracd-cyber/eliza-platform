export interface DefaultPrescription {
  id: string;
  name: string;
  type: 'prescription';
  description: string;
  defaultContent: string;
}

export const DEFAULT_PRESCRIPTION_TEMPLATES: DefaultPrescription[] = [
  {
    id: 'pos_toxina',
    name: 'Prescrição Pós-Toxina Botulínica (Botox)',
    type: 'prescription',
    description: 'Recomendações e controle de dor analgésica para pós-aplicação de toxina botulínica.',
    defaultContent: `RECEITUÁRIO CLÍNICO DE SUPORTE - PÓS-TOXINA BOTULÍNICA

PACIENTE: {{nomePaciente}}
CPF: {{cpfPaciente}}
DATA: {{dataAtual}}

USO VIA ORAL:
1. Dipirona Monoidratada 500mg ou Paracetamol 750mg
   - Tomar 1 comprimido via oral em caso de cefaleia ou desconforto leve local.
   - Intervalo mínimo de 6 em 6 horas. Se não houver dor, não é necessário tomar.

RECOMENDAÇÕES E ORIENTAÇÕES PÓS-PROCEDIMENTO (CUIDADOS VITAIS):
- Não massagear a face ou realizar movimentos vigorosos nas áreas tratadas pelas próximas 4 horas (evita migração da toxina).
- Permanecer em posição vertical (não se deitar de barriga para baixo ou de lado) por no mínimo 4 horas pós-procedimento.
- Suspender atividades físicas intensas e exposição solar direta nas primeiras 24 horas.
- Não aplicar maquiagem ou produtos abrasivos na face no dia da aplicação.
- Retorno agendado rigorosamente entre 15 e 21 dias para avaliação clínica de retoques e simetria muscular.

PROFISSIONAL RESPONSÁVEL: {{profissionalResponsavel}}
CLÍNICA: {{nomeClinica}}`
  },
  {
    id: 'pos_preenchimento',
    name: 'Prescrição Pós-Preenchimento Ácido Hialurônico',
    type: 'prescription',
    description: 'Controle de dor, corticosteroide preventivo contra edema severo e pomada para hematomas.',
    defaultContent: `RECEITUÁRIO CLÍNICO DE SUPORTE - PÓS-PREENCHIMENTO FACIAL

PACIENTE: {{nomePaciente}}
CPF: {{cpfPaciente}}
DATA: {{dataAtual}}

USO VIA ORAL:
1. Dipirona Monoidratada 505mg ------ Tomar 1 comprimido de 6h em 6h caso sinta dor ou sensibilidade local.
2. Prednisolona 20mg (Em caso de edema severo/inchaço acentuado)
   - Tomar 1 comprimido via oral pela manhã, por 3 dias consecutivos.

USO TÓPICO:
3. Arnica para uso tópico ou Gel de Alergia (ex: Hirudoid)
   - Aplicar uma fina camada sobre as áreas com pequenas equimoses (roxinhos) ou inchaço local.
   - Massagear suavemente 2 a 3 vezes ao dia até completa absorção.

RECOMENDAÇÕES PÓS-PROCEDIMENTO:
- Aplicação de compressas frias locais (sem pressionar excessivamente) nas primeiras 24 horas por 10 minutos.
- Evitar massagear energicamente o local preenchido para não deslocar o material modelador.
- Evitar exposição solar direta nos pontos que apresentarem hematomas (prevenção de manchas definitivas).
- Evitar mastigação vigorosa de alimentos duros no caso de preenchimento labial ou mentoniano nas primeiras 48h.

PROFISSIONAL RESPONSÁVEL: {{profissionalResponsavel}}
CLÍNICA: {{nomeClinica}}`
  },
  {
    id: 'pos_bioestimulador_fios',
    name: 'Prescrição Pós-Bioestimulador de Colágeno / Fios de PDO',
    type: 'prescription',
    description: 'Protocolo completo com antibiótico preventivo, anti-inflamatório analgésico e cuidados recomendados.',
    defaultContent: `RECEITUÁRIO CLÍNICO - PROTOCOLO PÓS-BIOESTIMULADOR & FIOS DE PDO

PACIENTE: {{nomePaciente}}
CPF: {{cpfPaciente}}
DATA: {{dataAtual}}

USO VIA ORAL:
1. Cefalexina 500mg (Antibiótico preventivo de infecção local)
   - Tomar 1 comprimido via oral de 6h em 6h por 5 a 7 dias. (A critério e indicação cirúrgica).
2. Nimesulida 100mg (Anti-inflamatório estrutural contra dor intensa)
   - Tomar 1 comprimido via oral de 12h em 12h, após as refeições, por no máximo 3 dias.
3. Paracetamol 750mg (Analgésico de resgate)
   - Tomar 1 comprimido via oral em caso de dor intercorrente de 8h em 8h.

RECOMENDAÇÕES ESPECÍFICAS EXTREMAMENTE IMPORTANTES:
- BIOESTIMULADOR: Realizar massagem suave diária na zona tratada ("Regra dos 5": massagear 5x ao dia, por 5 minutos, por 5 dias consecutivos) para evitar a formação de aglomerados de produto dérmico (nódulos).
- FIOS DE PDO: NÃO massagear, não realizar expressões abruptas, não mastigar alimentos excessivamente duros ou abrir exageradamente a boca nos primeiros 10 dias.
- Repousar com a cabeceira da cama levemente elevada e evitar dormir de lado nos primeiros 7 dias.
- Se houver calor intenso, vermelhidão espalhada ou secreção purulenta na área tratada, contate urgentemente nossa equipe clínica.

PROFISSIONAL RESPONSÁVEL: {{profissionalResponsavel}}
CLÍNICA: {{nomeClinica}}`
  },
  {
    id: 'preventivo_herpes',
    name: 'Prescrição de Controle Clínico Preventivo de Herpes',
    type: 'prescription',
    description: 'Protocolo de prevenção antiviral pré/pós-procedimento para microagulhamento ou preenchimento labial.',
    defaultContent: `RECEITUÁRIO CLÍNICO DE CONTROLADO - PREVENÇÃO ANTIVIRAL (HERPES SIMPLEX)

PACIENTE: {{nomePaciente}}
CPF: {{cpfPaciente}}
DATA: {{dataAtual}}

USO VIA ORAL:
1. Aciclovir 400mg (Antiviral preventivo de recidivas)
   - Tomar 1 comprimido via oral, de 12h em 12h (2 vezes ao dia), por 5 dias consecutivos.
   - Idealmente iniciar o uso 1 a 2 dias antes da realização do procedimento de microagulhamento profundo ou preenchimento de lábios.

DETALHES DO TRATAMENTO:
- A manipulação e inserção de cânulas na área perilabial pode estimular e desencadear a erupção do vírus do herpes em pacientes portadores. O protocolo preventivo visa mitigar as chances desta desagradável intercorrência clínica.

PROFISSIONAL RESPONSÁVEL: {{profissionalResponsavel}}
CLÍNICA: {{nomeClinica}}`
  }
];
