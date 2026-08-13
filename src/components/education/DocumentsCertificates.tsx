import React, { useState } from 'react';
import { 
  FileText, 
  Award, 
  CheckCircle2, 
  AlertCircle, 
  Printer, 
  DownloadCloud, 
  Check, 
  DollarSign, 
  TrendingUp, 
  Users, 
  QrCode,
  FileSignature
} from 'lucide-react';

interface DocumentsCertificatesProps {
  courses: any[];
  students: any[];
  patients: any[];
  staff?: any[];
}

export default function DocumentsCertificates({
  courses,
  students,
  patients,
  staff
}: DocumentsCertificatesProps) {
  
  const [activeSubTab, setActiveSubTab] = useState<'terms' | 'certificates' | 'finance'>('terms');

  // Term Generator State
  const [selectedTermType, setSelectedTermType] = useState<string>('contrato_aluno');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [parsedDocument, setParsedDocument] = useState<string>('');

  // Certificate State
  const [certStudentId, setCertStudentId] = useState<string>('');
  const [certifiedOutput, setCertifiedOutput] = useState<any | null>(null);
  const [certErrors, setCertErrors] = useState<string[]>([]);

  const termTemplates: Record<string, string> = {
    contrato_aluno: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS EDUCACIONAIS
  Curso: {NOME_CURSO}
  Contratante: {NOME_ALUNO}, inscrito no CPF {CPF_ALUNO}, número de conselho profissional: {CONSELHO_ALUNO}.
  
  CLÁUSULA PRIMEIRA: O objeto deste contrato é a prestação de serviços educacionais do curso de aperfeiçoamento intitulado "{NOME_CURSO}", ministrado pelo professor {NOME_PROFESSOR}, com carga horária total de {CARGA_HORARIA} horas, abrangendo prática supervisionada em pacientes-modelo.
  
  CLÁUSULA SEGUNDA: É de responsabilidade do profissional contratante seguir as boas práticas recomendadas, portar sua paramentação cirúrgica completa e exercer apenas procedimentos previamente validados pelo professor supervisor dadas as normas do CRO/CRM vigente.

  CLÁUSULA TERCEIRA: O investimento financeiro acordado é de R$ {VALOR_CURSO}, quitado nas regras e parcelamentos estabelecidos na ficha acadêmica.`,

    termo_matricula: `TERMO DE MATRÍCULA E DECLARAÇÃO DE CIÊNCIA
  Declaro que eu, {NOME_ALUNO}, portador de registro profissional {CONSELHO_ALUNO}, matriculo-me voluntariamente na turma {TURMA_ALUNO} do curso "{NOME_CURSO}". 
  Compreendo que a realização de procedimentos em pacientes-modelo exige consentimento prévio e supervisão imediata dos docentes deste programa, Dr {NOME_PROFESSOR}.`,

    termo_responsabilidade: `TERMO DE RESPONSABILIDADE CLÍNICA E CONDUTA PROFISSIONAL
  Subscrito pelo profissional {NOME_ALUNO} ({CONSELHO_ALUNO}), na qualidade de profissional-aluno e cirurgião executor subordinado.
  Comprometo-me a seguir à risca o planejamento pré-procedimento proposto, atuar sob biosegurança ativa aplicável e responder individualmente perante meu conselho de ética por qualquer imperícia que desvie das instruções docentes da clínica-escola.`,

    termo_uso_imagem: `TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM (ALUNO E PACIENTE)
  Por meio deste documento, autorizo voluntariamente a ELIZA e Clínica-Escola a utilizar, divulgar e publicar registros visuais, fotografias clínicas pré/pós e gravações do meu rosto e procedimentos realizados durante o curso "{NOME_CURSO}".
  O uso é restrito a finalidades acadêmicas, de ensino, marketing institucional e portfólios profissionais, sem ônus financeiros de qualquer natureza.`,

    termo_paciente_modelo: `TERMO DE CONSTATAÇÃO E CADASTRAMENTO DE PACIENTE-MODELO
  Paciente: {NOME_PACIENTE}, CPF {CPF_PACIENTE}.
  Curso: {NOME_CURSO} | Módulo Prático de Harmonização Orofacial.
  Declaro-me ciente de que o procedimento de {QUEIXA_PACIENTE} será realizado em ambiente acadêmico por profissionais devidamente graduados e licenciados, que se encontram sob treinamento supervisionado do Dr. {NOME_PROFESSOR}. Aceito ser paciente-modelo sem direito a reclamação de honorários.`,

    tcle_procedimento: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE) - PACIENTE
  Eu, {NOME_PACIENTE}, declaro que fui esclarecido sobre as indicações, contraindicações de {QUEIXA_PACIENTE}, possíveis complicações imediatas ou tardias (eritema, edema, hematoma, necrose localizada e isquemia). Sei dos benefícios e concordo individualmente com a aplicação clínica durante o curso "{NOME_CURSO}" sob supervisão do professor principal.`
  };

  const handleParseDocument = () => {
    let template = termTemplates[selectedTermType] || '';
    if (!template) return;

    // Get selected student variables
    const student = students.find(s => s.id === selectedStudentId);
    // Get selected patient variables
    const patient = patients.find(p => p.id === selectedPatientId);
    
    // Pick first course or course linked to student
    const courseId = student ? student.courseId : (patient ? patient.courseId : courses[0]?.id);
    const course = courses.find(c => c.id === courseId);

    // Replace Placeholders
    let parsed = template;
    if (student) {
      parsed = parsed
        .replace(/{NOME_ALUNO}/g, student.name || '')
        .replace(/{CPF_ALUNO}/g, student.cpf || 'Não informado')
        .replace(/{CONSELHO_ALUNO}/g, student.councilNumber || 'Sem conselho')
        .replace(/{TURMA_ALUNO}/g, student.batchName || 'Turma geral');
    }
    if (patient) {
      parsed = parsed
        .replace(/{NOME_PACIENTE}/g, patient.name || '')
        .replace(/{CPF_PACIENTE}/g, patient.cpf || 'Não informado')
        .replace(/{QUEIXA_PACIENTE}/g, patient.desiredProcedure || 'Procedimentos clínicos');
    }
    if (course) {
      parsed = parsed
        .replace(/{NOME_CURSO}/g, course.name || '')
        .replace(/{NOME_PROFESSOR}/g, course.professorName || 'Doutor Supervisor')
        .replace(/{CARGA_HORARIA}/g, String(course.durationHours))
        .replace(/{VALOR_CURSO}/g, String(course.price || '0'));
    }

    setParsedDocument(parsed);
  };

  const handleIssueCertificate = () => {
    setCertErrors([]);
    setCertifiedOutput(null);

    const student = students.find(s => s.id === certStudentId);
    if (!student) {
      setCertErrors(["Selecione um profissional/aluno válido."]);
      return;
    }

    const course = courses.find(c => c.id === student.courseId);
    if (!course) {
      setCertErrors(["Nenhum curso associado encontrado para este aluno."]);
      return;
    }

    // Process validations
    const errors: string[] = [];
    if (course.status !== 'finalizado') {
      errors.push("O curso não está com status 'finalizado'. Conclua as lições na grade de cursos antes de certificar!");
    }
    if (student.status !== 'concluído' && student.status !== 'ativo') {
      errors.push("O aluno não conta com matrícula consolidada ou concluída.");
    }
    if (!student.permDownloadCertificate) {
      errors.push("A permissão 'Liberado Emissão de Certificado Final' está desativada nas configurações do aluno.");
    }

    if (errors.length > 0) {
      setCertErrors(errors);
      return;
    }

    // Generate certificate simulated content
    const today = new Date().toLocaleDateString('pt-BR');
    const hash = `EZEDU-${course.id.slice(0,4).toUpperCase()}-${student.id.slice(0,4).toUpperCase()}`;

    setCertifiedOutput({
      studentName: student.name,
      courseName: course.name,
      durationHours: course.durationHours,
      professorName: course.professorName,
      dateIssued: today,
      hashValidationCode: hash
    });
  };

  return (
    <div className="bg-white rounded-[2rem] border border-slate-205 p-6 sm:p-8 space-y-6 text-left">
      
      {/* Tab controls */}
      <div className="flex border-b border-sidebar-100 pb-3 gap-6">
        {[
          { key: 'terms', label: 'Contratos e Termos' },
          { key: 'certificates', label: 'Certificados' },
          { key: 'finance', label: 'Estudo Financeiro de Turma' }
        ].map(tab => (
          <button 
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key as any)}
            className={`pb-2 text-xs font-black uppercase tracking-widest outline-none border-b-2 transition-all cursor-pointer ${
              activeSubTab === tab.key 
                ? 'text-teal-605 border-teal-605' 
                : 'text-slate-400 hover:text-slate-605 border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: TRADING CONTRACT GENERAL GENERATOR */}
      {activeSubTab === 'terms' && (
        <div className="space-y-6">
          <div className="bg-slate-900 text-white p-6 rounded-3xl text-left relative overflow-hidden">
            <span className="p-1 px-2.5 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-md font-bold text-[8px] uppercase tracking-wider">
              Gerador Automático de Termos
            </span>
            <h3 className="text-sm font-black uppercase mt-1">Preenchimento de Variáveis Educacionais</h3>
            <p className="text-[10px] text-slate-400 leading-normal max-w-xl mt-1">
              Escolha uma minuta para preenchê-la automaticamente com os CPF, nomes de pacientes, curso, comissões de professores e dados de CRO individuais.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-450 uppercase">Escolha a Minuta/Termo</label>
                <select 
                  value={selectedTermType}
                  onChange={(e) => setSelectedTermType(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none"
                >
                  <option value="contrato_aluno">Contrato Aluno de Prestação de Serviços</option>
                  <option value="termo_matricula">Termo de Matrícula de Declaração</option>
                  <option value="termo_responsabilidade">Termo de Responsabilidade e Ética Aluno</option>
                  <option value="termo_uso_imagem">Termo de Autorização de Imagem</option>
                  <option value="termo_paciente_modelo">Termo de Consentimento Paciente-Modelo</option>
                  <option value="tcle_procedimento">TCLE Consentimento Tratamento HOF</option>
                </select>
              </div>

              {/* Student selectors (only show if applicable) */}
              {['contrato_aluno', 'termo_matricula', 'termo_responsabilidade', 'termo_uso_imagem'].includes(selectedTermType) && (
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase">Selecione o Aluno</label>
                  <select 
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="">-- Escolha Aluno --</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.cpf})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Patient selectors */}
              {['termo_paciente_modelo', 'tcle_procedimento'].includes(selectedTermType) && (
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-450 uppercase">Selecione o Paciente-Modelo</label>
                  <select 
                    value={selectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none"
                  >
                    <option value="">-- Escolha Paciente-Modelo --</option>
                    {patients.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.desiredProcedure})</option>
                    ))}
                  </select>
                </div>
              )}

              <button 
                onClick={handleParseDocument}
                className="w-full py-3 bg-teal-655 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer mt-1"
              >
                Gerar com Variáveis
              </button>
            </div>

            {/* Parse output body */}
            <div className="lg:col-span-7 bg-slate-50 border border-slate-205 p-6 rounded-2xl flex flex-col justify-between space-y-4">
              <div className="border-b border-slate-200 pb-2.5 flex justify-between items-center text-[10px] font-bold text-slate-400">
                <span>PREVIEW DO TERMO PARSEADO</span>
                <button 
                  onClick={() => {
                    const printWind = window.open('', '_blank');
                    if (printWind) {
                      printWind.document.write(`<pre style="font-family: Arial; font-size:14px; padding:40px; white-space: pre-wrap;">${parsedDocument}</pre>`);
                      printWind.document.close();
                      printWind.print();
                    }
                  }}
                  disabled={!parsedDocument}
                  className="flex items-center gap-1 hover:text-slate-655 disabled:opacity-40"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir
                </button>
              </div>

              {parsedDocument ? (
                <div className="text-xs font-medium leading-relaxed whitespace-pre-line text-slate-700 max-h-[300px] overflow-y-auto custom-scrollbar">
                  {parsedDocument}
                </div>
              ) : (
                <div className="py-24 text-center italic text-slate-400 text-xs">
                  Aperte "Gerar com Variáveis" para processar a assinatura prévia do documento educativo.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: COMPLETION CERTIFICATE RELEASE CHECK */}
      {activeSubTab === 'certificates' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
            
            {/* Form requirements check */}
            <div className="space-y-5 bg-slate-50/50 p-6 rounded-2xl border border-slate-200">
              <div>
                <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Lançamento de Credencial de Conclusão</h4>
                <p className="text-[10px] text-slate-450 leading-normal font-semibold mt-1">O sistema confere e audita se o curso da turma foi finalizado e se as permissões acadêmicas contam com liberação.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-450 uppercase">Matrícula Profissional / Aluno</label>
                <select 
                  value={certStudentId}
                  onChange={(e) => setCertStudentId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none"
                >
                  <option value="">-- Selecione o Profissional Aluno --</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
                  ))}
                </select>
              </div>

              {certErrors.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2 text-rose-800 text-[10.5px]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold uppercase text-[9px] tracking-wider mb-1">Pendências Impedindo a Emissão:</p>
                    <ul className="list-disc pl-3.5 space-y-0.5">
                      {certErrors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <button 
                onClick={handleIssueCertificate}
                className="px-5 py-3.5 bg-teal-605 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest cursor-pointer w-full text-center"
              >
                Validar Requisitos e Emitir Certificado
              </button>
            </div>

            {/* Certificate visual viewport */}
            <div className="flex flex-col justify-center">
              {certifiedOutput ? (
                <div className="space-y-4">
                  
                  {/* Visual Premium Certificate frame */}
                  <div className="p-8 border-4 border-double border-teal-650 bg-teal-50/10 rounded-2xl relative text-center space-y-6 overflow-hidden">
                    {/* Background seals */}
                    <Award className="absolute -left-6 -bottom-6 w-24 h-24 text-teal-800/5 rotate-12" />
                    
                    <div className="space-y-1">
                      <span className="text-[8px] font-black uppercase tracking-[0.25em] text-teal-700 block">CERTIFICADO DE EXTENSÃO ACADÊMICA</span>
                      <h3 className="text-lg font-black tracking-tighter text-slate-800 uppercase mt-2">ELIZA EDUCATION</h3>
                    </div>

                    <p className="text-[11px] leading-relaxed text-slate-500 font-medium">
                      Certificamos para os devidos efeitos éticos que o profissional <span className="text-slate-900 font-extrabold uppercase">{certifiedOutput.studentName}</span> concluiu com aproveitamento e frequência integral o curso de treinamento prático e teórico <span className="text-slate-800 font-bold uppercase">"{certifiedOutput.courseName}"</span>, ministrado pela banca examinadora, com carga total de <span className="font-bold text-slate-900">{certifiedOutput.durationHours} horas</span> letivas.
                    </p>

                    <div className="grid grid-cols-2 gap-4 text-[10px] text-slate-400 font-bold uppercase pt-4 border-t border-slate-100">
                      <div>
                        <p className="text-slate-800">{certifiedOutput.professorName}</p>
                        <p className="text-[8px] tracking-wider border-t border-slate-200 pt-1 mt-0.5">PROFESSOR RESPONSÁVEL</p>
                      </div>
                      <div>
                        <p className="text-slate-805">{certifiedOutput.dateIssued}</p>
                        <p className="text-[8px] tracking-wider border-t border-slate-200 pt-1 mt-0.5">DATA DA OUTORGA</p>
                      </div>
                    </div>

                    {/* QR validator block */}
                    <div className="pt-2 flex justify-center items-center gap-4 text-left border-t border-dashed border-slate-150">
                      <QrCode className="w-10 h-10 text-slate-800" />
                      <div className="text-[9.5px]">
                        <p className="text-slate-450 font-black">VALIDADOR DIGITAL (QR-CODE ORIGINAL)</p>
                        <p className="font-mono text-slate-800 font-bold">{certifiedOutput.hashValidationCode}</p>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => alert(`Certificado ${certifiedOutput.hashValidationCode} exportado para fila de PDF!`)}
                    className="w-full py-2.5 border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-[#525252] hover:bg-slate-50 flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <DownloadCloud className="w-4 h-4" /> Baixar Certificado PDF
                  </button>
                </div>
              ) : (
                <div className="p-12 border border-dashed border-slate-200 rounded-2xl text-center text-slate-400 italic text-xs h-full flex flex-col justify-center items-center">
                  <Award className="w-10 h-10 text-slate-200 mb-2" />
                  <p>Aguardando validação para renderização da credencial em tempo real.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: TURMA FINANCIAL CASH CALCULATOR LEDGER */}
      {activeSubTab === 'finance' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-emerald-900 to-teal-800 text-white p-6 rounded-3xl relative overflow-hidden shadow-sm">
            <span className="p-1 px-2.5 bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 rounded-md font-bold text-[8px] uppercase tracking-wider inline-block">
              Inteligência Financeira de Cursos
            </span>
            <h3 className="text-sm font-black uppercase mt-2">DRE Sintética e Retorno por Turma</h3>
            <p className="text-[10px] text-slate-350 leading-normal font-semibold max-w-xl mt-1">
              Controle o custo de estoque operacional deduzido do faturamento com venda de matrículas de forma apartada do balancete clínico tradicional.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {courses.map((course, idx) => {
              // 1. Get students from the official education_students list (with fallback for orphaned or unassigned)
              const officialStudents = students.filter(s => 
                s.courseId === course.id || 
                (!s.courseId && idx === 0) || 
                (courses.findIndex(c => c.id === s.courseId) === -1 && idx === 0)
              );
              
              // 2. Add clinical team members who were registered in Team Settings as "Aluno/Residente"
              const staffStudents = (staff || []).filter(member => {
                const isStudent = member.role === 'aluno' || member.courseRole === 'aluno';
                const alreadyIncluded = officialStudents.some(s => s.email?.toLowerCase() === member.email?.toLowerCase());
                
                if (!isStudent || alreadyIncluded) return false;
                
                if (member.courseId) {
                  return member.courseId === course.id;
                }
                return idx === 0; // Default to first course as a fallback
              });

              const studentsInCourse = [...officialStudents, ...staffStudents];
              const coursePrice = parseFloat(course.price as any) || 0;
              const grossRevenue = studentsInCourse.length * coursePrice;
              
              // Simulate operational cost and comissao
              const costSupplies = course.durationHours * 90; // 90 BRL per hour of gloves, syringes, overhead
              const commissionDoc = grossRevenue * 0.3; // 30% professor commission
              const netProfit = grossRevenue - costSupplies - commissionDoc;

              return (
                <div key={course.id} className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 text-left space-y-4">
                  <div>
                    <span className="p-1 px-2 text-[8px] bg-slate-200 text-slate-800 rounded font-black uppercase tracking-wider">
                      {course.type}
                    </span>
                    <h4 className="text-xs font-black text-slate-800 uppercase mt-2 leading-none">{course.name}</h4>
                  </div>

                  <div className="space-y-2 border-t border-slate-100 pt-3">
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500">
                      <span>Alunos Matriculados:</span>
                      <span className="text-slate-800">{studentsInCourse.length}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] font-bold text-slate-500">
                      <span>Faturamento Bruto:</span>
                      <span className="text-slate-900 font-extrabold">R$ {grossRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-medium text-slate-450 uppercase tracking-tight">
                      <span>Custo de Insumos (Aud.):</span>
                      <span>R$ {costSupplies.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-medium text-slate-450 uppercase tracking-tight">
                      <span>Comissão Docente (30%):</span>
                      <span>R$ {commissionDoc.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    
                    <div className="flex justify-between items-center text-[11px] font-extrabold text-emerald-800 pt-2 border-t border-dashed border-slate-200">
                      <span>Resultado Turma Est.:</span>
                      <span className="bg-emerald-50 p-1 px-2.5 rounded-md">R$ {netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
