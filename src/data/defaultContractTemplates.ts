export interface DefaultTemplate {
  id: string;
  name: string;
  type: 'contract';
  description: string;
  defaultContent: string;
  consentClause: string;
}

export const DEFAULT_CONTRACT_TEMPLATES: DefaultTemplate[] = [
  {
    id: 'toxina_botulinica',
    name: 'Contrato e TCLE - Toxina Botulínica',
    type: 'contract',
    description: 'Contrato específico para aplicação de toxina botulínica (Botox) com termo de consentimento e cuidados.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - TOXINA BOTULÍNICA:
O(A) PACIENTE declara-se ciente de que a Aplicação de Toxina Botulínica visa a atenuação temporária de rugas e marcas de expressão dinâmicas. O tempo estimado de durabilidade é de 3 (três) a 6 (seis) meses, variando conforme traços individuais, força muscular e metabolismo. Riscos e intercorrências possíveis incluem: dor leve no local, cefaleia transitória, pequenos hematomas, edema localizado, ptose palpebral ou supraciliar temporária, assimetrias reversíveis no período de retoque. O retoque, se necessário, deverá ser feito estritamente entre 15 e 21 dias pós-procedimento.`,
    defaultContent: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ESTÉTICA FACIAL E TERMO DE CONSENTIMENTO

A) IDENTIFICAÇÃO DAS PARTES

CONTRATANTE / PACIENTE:
Nome: {{nomePaciente}}
CPF: {{cpfPaciente}}
Data de Nascimento: {{dataNascimento}}
Telefone: {{telefonePaciente}}

CONTRATADA / CLÍNICA:
Clínica: {{nomeClinica}}
CNPJ: {{cnpjClinica}}
Responsável Técnico: {{profissionalResponsavel}}
CRO/CRM: {{croProfissional}}

B) OBJETO DO CONTRATO
Prestação de serviços de procedimentos estéticos / odontológicos de Harmonização Orofacial acordados e detalhados a seguir.

C) PLANO DE TRATAMENTO APROVADO
Procedimentos:
{{procedimentosAprovados}}

D) DESCRIÇÃO TÉCNICA E TERMO DE CONSENTIMENTO
{{consentimentoProcedimentos}}

E) DECLARAÇÃO DE ALTERNATIVAS, ESCLARECIMENTO E DÚVIDAS
O paciente declara que recebeu informações verbais completas sobre as alternativas para o seu caso clínico, teve a oportunidade de fazer perguntas, sanar todas as suas dúvidas e que concorda voluntariamente com a realização dos procedimentos listados.

G) RISCOS GERAIS E LIMITAÇÕES
Entende-se que a anatomia e metabolismo humanos são singulares. Pequenos hematomas, inchaço e vermelhidão temporários são reações naturais esperadas e transitórias.

H) CUIDADOS PRÉ E PÓS-PROCEDIMENTO
- Não deitar-se ou massagear a face nas 4 horas seguintes à aplicação.
- Evitar exercícios físicos intensos nas primeiras 24 horas.
- Usar protetor solar diariamente.

I) CONDIÇÕES FINANCEIRAS
O valor total deste ajuste é de R$ {{valorTotal}}, a ser adimplido através da seguinte forma de pagamento: {{formaPagamento}}.

J) POLÍTICA DE RETORNO E MANUTENÇÃO
O retorno para análise e eventuais retoques clínicos de ajuste deve ocorrer entre 15 e 21 dias. Decorrido este prazo, qualquer nova dose será cobrada individualmente.

K) TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
Mediante assinatura eletrônica ou física deste documento, declaro-me esclarecido(a) e concordo de maneira livre com o plano de tratamento estabelecido.

L) ASSINATURA DO PACIENTE:
______________________________________________
{{nomePaciente}}
CPF: {{cpfPaciente}}

M) ASSINATURA DO PROFISSIONAL RESPONSÁVEL:
______________________________________________
{{profissionalResponsavel}}
CRO/CRM: {{croProfissional}}
{{nomeClinica}}

Data de Aceite correspondente: {{dataAtual}}`
  },
  {
    id: 'acido_hialuronico',
    name: 'Contrato e TCLE - Preenchimento Facial',
    type: 'contract',
    description: 'Contrato para preenchimento de sulcos, lábios ou volumização com Ácido Hialurônico.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - PREENCHIMENTO COM ÁCIDO HIALURÔNICO:
O(A) PACIENTE declara-se ciente de que o preenchimento facial é realizado com Ácido Hialurônico (gel de preenchimento temporário e reabsorvível). A durabilidade esperada varia de 9 (nove) a 18 (dezoito) meses, dependendo da área tratada, marca do produto e resposta fisiológica. Intercorrências possíveis incluem: eritema, edema acentuado nos primeiros dias, pequenos nódulos palpáveis, assimetria temporária decorrente do inchaço, equimoses e, em casos raríssimos, compressão vascular local de tratamento imediato pelo profissional.`,
    defaultContent: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ESTÉTICA FACIAL E TERMO DE CONSENTIMENTO

A) IDENTIFICAÇÃO DAS PARTES
CONTRATANTE / PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CONTRATADA / CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}}

B) OBJETO DO CONTRATO
Realização de Preenchimento Cutâneo com Ácido Hialurônico e modelagem estética.

C) PLANO DE TRATAMENTO APROVADO
Procedimentos:
{{procedimentosAprovados}}

D) DESCRIÇÃO TÉCNICA E TERMO DE CONSENTIMENTO
{{consentimentoProcedimentos}}

E) ALTERNATIVAS E DÚVIDAS
O paciente declara ter tirado todas as dúvidas técnicas a respeito do uso de preenchedores na face e compreende que o resultado final se consolida após 30 dias do procedimento.

H) CUIDADOS PRÉ E PÓS-PROCEDIMENTO
- Não massagear as áreas preenchidas, exceto por orientação expressa do profissional.
- Evitar exposição direta ao sol e calor nos primeiros 3 dias.
- Aplicar gelo local com moderação se orientado.

I) CONDIÇÕES FINANCEIRAS
Valor Total: R$ {{valorTotal}} | Forma de pagamento: {{formaPagamento}}.

J) RETORNO E MANUTENÇÃO
Retornos após 15 a 30 dias para avaliação. Eventuais refinamentos serão discutidos na consulta de retorno.

L) ASSINATURA DO PACIENTE:
______________________________________________
{{nomePaciente}}

M) ASSINATURA DO PROFISSIONAL:
______________________________________________
{{profissionalResponsavel}}

Data: {{dataAtual}}`
  },
  {
    id: 'bioestimulador',
    name: 'Contrato e TCLE - Bioestimuladores de Colágeno',
    type: 'contract',
    description: 'Contrato para aplicação de Hidroxiapatita de Cálcio ou Ácido Poli-L-Lático.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - BIOESTIMULADORES DE COLÁGENO:
O(A) PACIENTE compreende que os Bioestimuladores de colágeno (como Sculptra ou Radiesse) agem estimulando a síntese de colágeno endógeno ao longo de 60 a 90 dias, e os resultados não são instantâneos. O plano pode prever de 1 a 3 sessões. Riscos incluem: formação de pequenos nódulos subdérmicos benignos, edema, sensibilidade dolorosa local, coceira ou hematomas. As massagens indicadas pelo protocolo pós-procedimento (regra dos 5: massajar 5 vezes ao dia, por 5 minutos, por 5 dias) são vitais para a distribuição uniforme do produto.`,
    defaultContent: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS E CONSENTIMENTO - BIOESTIMULADORES

A) IDENTIFICAÇÃO DAS PARTES
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}}

B) OBJETO DO CONTRATO
Sessões programadas de indução de colágeno facial/pescoço por via de injetáveis bioestimulantes.

C) PLANO DE TRATAMENTO APROVADO
{{procedimentosAprovados}}

D) DESCRIÇÃO TÉCNICA E TERMO DE CONSENTIMENTO
{{consentimentoProcedimentos}}

H) CUIDADOS ESPECÍFICOS PÓS-APLICAÇÃO
- Realizar massagens na região tratada de acordo com as instruções ("Regra dos 5").
- Não se expor ao sol durante o período de presença de hematomas.

I) CONDIÇÕES FINANCEIRAS
Valor da contratação: R$ {{valorTotal}} por {{formaPagamento}}.

J) POLÍTICA DE RETORNO E MANUTENÇÃO
Acompanhar a evolução estimulada em consultas periódicas a cada 30 ou 45 dias.

L) ASSINATURA DO PACIENTE:
______________________________________________
{{nomePaciente}}

M) ASSINATURA DO PROFISSIONAL:
______________________________________________
{{profissionalResponsavel}}

Data: {{dataAtual}}`
  },
  {
    id: 'fios_pdo',
    name: 'Contrato e TCLE - Fios de PDO',
    type: 'contract',
    description: 'Contrato para inserção de Fios de PDO de sustentação e estímulo.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - FIOS DE SUSTENTAÇÃO E ESTÍMULO DE PDO:
O(A) PACIENTE declara-se ciente de que a inserção de fios de Polidioxanona (PDO) destina-se ao estímulo de colágeno ou tração mecânica de tecidos flácidos. Os resultados de tração são imediatos, mas a acomodação definitiva do tecido se dá em até 30 dias. Os fios são totalmente reabsorvíveis em até 6 a 8 meses, embora o colágeno gerado persista. Riscos incluem: assimetria transitória, ondulação na pele (depressões temporárias), visualização da extremidade do fio, pontada dolorosa à mastigação ou expressão, inflamação local ou extrusão do fio.`,
    defaultContent: `CONTRATO E TCLE - INSERÇÃO DE FIOS DE POLIDIOXANONA (PDO)

A) IDENTIFICAÇÃO DAS PARTES
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}}

B) OBJETO DO CONTRATO
Procedimento de lifting não-cirúrgico ou ancoragem dérmica com Fios de PDO.

C) PLANO DE TRATAMENTO
{{procedimentosAprovados}}

D) TERMO DE CONSENTIMENTO ESPECÍFICO
{{consentimentoProcedimentos}}

H) CUIDADOS PÓS-PROCEDIMENTO FIOS PDO
- Evitar mastigação vigorosa e alimentos de consistência excessivamente dura nos primeiros 7 dias.
- Não abrir exageradamente a boca e evitar expressões faciais abruptas.
- Repousar de barriga para cima por pelo menos 10 dias.

I) CONDIÇÕES FINANCEIRAS
Total investido: R$ {{valorTotal}} via {{formaPagamento}}.

L) ASSINATURA DO PACIENTE:
______________________________________________
{{nomePaciente}}

M) ASSINATURA DO PROFISSIONAL:
______________________________________________
{{profissionalResponsavel}}

Data: {{dataAtual}}`
  },
  {
    id: 'rinomodelacao',
    name: 'Contrato e TCLE - Rinomodelação',
    type: 'contract',
    description: 'Contrato focado em procedimentos estéticos não cirúrgicos no nariz.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - RINOMODELAÇÃO:
O(A) PACIENTE compreende que a rinomodelação com ácido hialurônico visa disfarçar imperfeições e empinar a ponta do nariz de forma não cirúrgica, não reduzindo as dimensões do nariz. Trata-se de uma região de vascularização terminal delicada. Riscos incluem: edema nítido, dor local, equimoses e, em escala de extrema relevância clínica, riscos vasculares obstrutivos que exigem pronto atendimento e aplicação urgente de hialuronidase pelo profissional assistente caso seja identificada isquemia ou alteração de coloração cutânea.`,
    defaultContent: `CONTRATO DE RINOMODELAÇÃO NÃO CIRÚRGICA E TERMO DE CONSENTIMENTO

A) IDENTIFICAÇÃO
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
PROFISSIONAL: {{profissionalResponsavel}} | CLÍNICA: {{nomeClinica}}

B) OBJETO
Modelagem não-cirúrgica nasal com preenchedores absorvíveis.

D) CONSENTIMENTO TÉCNICO E RISCOS
{{consentimentoProcedimentos}}

H) CUIDADOS ESPECIAIS
- Não tocar, apertar ou apoiar óculos de sol/grau sobre o nariz por 7 dias.
- Se houver dor severa desproporcional ou alteração de cor local (pele esbranquiçada ou roxa), avisar imediatamente a equipe clínica.

I) FINANCEIRO
Valor: R$ {{valorTotal}} nos termos de {{formaPagamento}}.

L) ASSINATURA DO PACIENTE:
______________________________________________

M) ASSINATURA DO PROFISSIONAL:
______________________________________________

Data: {{dataAtual}}`
  },
  {
    id: 'lipo_papada',
    name: 'Contrato e TCLE - Lipo de Papada / Estética Facial',
    type: 'contract',
    description: 'Contrato para lipoaspiração mecânica, química de papada ou cirurgia estética menor.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - LIPO QUÍMICA OU MECÂNICA DE PAPADA:
O(A) PACIENTE concorda com a realização da redução de gordura submentoniana (papada). Na lipo química (ácido deoxicólico), o resultado é paulatino e costuma inflamar consideravelmente nos primeiros 10 dias. Na lipoaspiração mecânica de consultório, há uso de cânula sob anestesia local. Intercorrências comuns: edema persistente, parestesia (dormência transitória na pele), nódulos cicatriciais de fibrose (tratáveis com drenagem), flacidez residual residual na pele e assimetria reversível no contorno mandibular.`,
    defaultContent: `CONTRATO E TERMO DE CONSENTIMENTO PARA LIPO DE PAPADA / SUBMENTONIANA

A) PARTES
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}}

C) PROCEDIMENTO
{{procedimentosAprovados}}

D) DETALHES TÉCNICOS E RISCOS
{{consentimentoProcedimentos}}

H) CUIDADOS PÓS-OPERATÓRIOS / PÓS-PROCEDIMENTO
- Uso de faixa compressiva mentoniana conforme prescrição do profissional.
- Realização de sessões de drenagem ou ultrassom pós-operatório para prevenção de excesso de fibrose.
- Evitar exposição solar intensa.

I) FINANCEIRO
Valor: R$ {{valorTotal}} via {{formaPagamento}}.

L) ASSINATURA DO PACIENTE:
______________________________________________

M) ASSINATURA DO PROFISSIONAL:
______________________________________________

Data: {{dataAtual}}`
  },
  {
    id: 'full_face',
    name: 'Contrato e TCLE - Plano Full Face Combinado',
    type: 'contract',
    description: 'Contrato abrangente para múltiplos procedimentos HOF conjugados no mesmo plano.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - PLANO FULL FACE COMBINADO (MÚLTIPLOS PROCEDIMENTOS):
O(A) PACIENTE optou por um planejamento terapêutico integrativo (Full Face), que combina diferentes técnicas (por exemplo: toxina botulínica, preenchedores, bioestimuladores e/ou fios) para reestruturação global da face. O paciente entende que a somatória das técnicas pode induzir um período de recuperação (downtime) com edema e equimoses mais evidentes e distribuídos. No entanto, o planejamento conjunto visa a máxima harmonia, respeitando os cuidados individuais e o plano cronológico de sessões traçado.`,
    defaultContent: `CONTRATO DE PLANEJAMENTO INTEGRADO HARMONIZAÇÃO FACIAL ESTÉTICA (FULL FACE)

A) IDENTIFICAÇÃO DAS PARTES
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}}

C) CRONOGRAMA DE PROCEDIMENTOS COMBINADOS
Aprovados:
{{procedimentosAprovados}}

D) TERMO DE CONSENTIMENTO E CLAÚSULAS TÉCNICAS
Os atos e técnicas serão desenvolvidos de forma sinérgica. Abaixo constam os termos de concordância das técnicas empregadas:
{{consentimentoProcedimentos}}

H) ORIENTAÇÕES DE RECOVERY E CUIDADOS GERAIS
- Seguir estritamente a sequência de aplicação recomendada para cada sessão.
- Evitar qualquer manipulação excessiva do rosto.
- Uso de medicamentos pós-procedimento conforme prescrição médica/odontológica fornecida.

I) CONDIÇÕES FINANCEIRAS
Valor global do plano: R$ {{valorTotal}} | Condição comercial: {{formaPagamento}}.

L) ASSINATURA DO PACIENTE:
______________________________________________

M) ASSINATURA DO PROFISSIONAL:
______________________________________________

Data: {{dataAtual}}`
  },
  {
    id: 'odonto_geral',
    name: 'Contrato e TCLE - Procedimentos Odontológicos Gerais',
    type: 'contract',
    description: 'Contrato padrão para tratamentos odontológicos como implantes, próteses, clareamento ou geral.',
    consentClause: `CLÁUSULA DE CONSENTIMENTO - PROCEDIMENTOS ODONTOLÓGICOS GERAIS:
O(A) PACIENTE expressa aceite em relação aos procedimentos odontológicos listados no plano. Declara saber que tratamentos como restaurações, coroas, implantes, clareamento, endodontia (canal), ortodontia ou cirurgias orais menores envolvem aplicação de anestésico local. Riscos compreendem sensibilidade dentária pós-térmica temporária, dor em região alveolar, trismo temporário, sangramento gengival natural e necessidade eventual de retratamentos devido a fatores mastigatórios, oclusais ou de higiene do próprio paciente.`,
    defaultContent: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ODONTOLÓGICOS E CONSENTIMENTO CLÍNICO

A) IDENTIFICAÇÃO DAS PARTES
PACIENTE: {{nomePaciente}} | CPF: {{cpfPaciente}}
CLÍNICA: {{nomeClinica}} | CNPJ: {{cnpjClinica}} | Responsável CRO: {{croProfissional}}

C) PLANO DE TRATAMENTO ODONTOLÓGICO
Proposta aprovada:
{{procedimentosAprovados}}

D) CONSENTIMENTO TÉCNICO DOS PROCEDIMENTOS ODONTOLÓGICOS
{{consentimentoProcedimentos}}

H) RECOMENDAÇÕES PÓS-TRATAMENTO
- Seguir a risca a rotina de tripla higiene bucal (fio dental, escova macia e dentifrício).
- Abster-se de fumar ou consumir alimentos altamente corantes se em tratamento clareador.

I) INVESTIMENTO ODONTOLÓGICO
Valor total e condições: R$ {{valorTotal}} por meio de {{formaPagamento}}.

L) ASSINATURA DO PACIENTE:
______________________________________________

M) ASSINATURA DO PROFISSIONAL RESPONSÁVEL (CRO):
______________________________________________

Data: {{dataAtual}}`
  }
];
