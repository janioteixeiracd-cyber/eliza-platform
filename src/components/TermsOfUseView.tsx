/**
 * Termos de Uso públicos (`/terms`) — conteúdo/layout/CSS copiados
 * literalmente do pacote premium aprovado
 * (eliza-premium-entrega/app/terms/page.tsx), fonte canônica. Rota
 * preservada, pública, sem autenticação. Correções da rodada de
 * refinamento pré-deploy: Seção 4 — acrescentada frase neutra permitindo
 * outras permissões técnicas além de `whatsapp_business_messaging`/
 * `_management`, sem sugerir que só essas duas existirão sempre; Seção 8
 * — vedação de telemedicina ampliada explicitamente pra telessaúde/
 * teleodontologia (mesma vedação, só nomeada com mais precisão — não
 * restringe comunicação legítima de atendimento odontológico/
 * administrativo, que nunca foi o alvo da vedação). Nenhum outro trecho,
 * seção, layout ou link foi alterado. Adaptação técnica: `next/link` →
 * `Link` do react-router; wrapper `.eliza-premium-landing` (ver
 * publicLandingLegal.css).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './publicLandingLegal.css';

function Header() {
  return (
    <header className="info-nav">
      <Link to="/"><img src="/eliza-wordmark.png" alt="ELIZA" /></Link>
      <Link to="/" className="info-back">← Voltar ao início</Link>
    </header>
  );
}
function S({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return <section><h2><span>{n.padStart(2, "0")}</span>{title}</h2>{children}</section>;
}
function Callout({ children }: { children: ReactNode }) {
  return <aside className="legal-callout"><p>{children}</p></aside>;
}
function Footer() {
  return (
    <footer className="info-footer">
      <span>ELIZA Clínica Inteligente</span>
      <nav><Link to="/company">A empresa</Link><Link to="/privacy">Privacidade</Link><Link to="/data-deletion">Exclusão de dados</Link></nav>
    </footer>
  );
}

export default function TermsOfUseView() {
  return (
    <main className="eliza-premium-landing info-page">
      <Header />
      <article className="info-content wide-legal">
        <p className="section-kicker">SOFTWARE • WHATSAPP • TECH PROVIDER</p>
        <h1>Termos de Uso</h1>
        <p className="info-lead">Condições para utilização da ELIZA Clínica Inteligente e de suas integrações, inclusive a WhatsApp Business Platform.</p>

        <Callout><strong>Importante:</strong> ao criar uma conta, contratar um plano ou conectar uma conta Meta, a clínica declara que leu e concordou com estes Termos e com a Política de Privacidade.</Callout>

        <S n="1" title="Identificação e objeto"><p>A ELIZA é operada por JANIO TEIXEIRA DA SILVA JUNIOR LTDA, CNPJ 37.421.772/0001-07. O serviço oferece licença limitada, revogável, não exclusiva e intransferível para uso de módulos de gestão clínica, agenda, prontuário, financeiro, relacionamento, inteligência e integrações autorizadas.</p></S>
        <S n="2" title="Conta e usuários autorizados"><p>A clínica deve fornecer dados verdadeiros, manter suas informações atualizadas, administrar permissões da equipe e proteger credenciais. Acesso é pessoal. É proibido compartilhar senhas, tokens, códigos de autenticação ou contornar controles de segurança.</p></S>
        <S n="3" title="Papel da ELIZA como provedora de tecnologia"><p>A ELIZA permite que clínicas conectem suas próprias contas e números da WhatsApp Business Platform por mecanismos autorizados, como Embedded Signup. A ELIZA atua tecnicamente em nome da clínica e somente dentro das permissões concedidas. A clínica mantém a titularidade da WABA, do número, dos templates, das mensagens e do relacionamento com seus pacientes.</p></S>
        <S n="4" title="Autorização Meta e permissões"><p>Ao conectar a Meta, a clínica autoriza o uso das permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code> apenas para as funções apresentadas durante a conexão. Outras permissões técnicas poderão ser solicitadas quando necessárias à solução oferecida, sempre limitadas ao uso efetivamente demonstrado e autorizado pela clínica durante a conexão. A clínica pode revogar o acesso ou solicitar desconexão. A perda ou revogação da autorização poderá interromper funções dependentes da integração.</p></S>
        <S n="5" title="Consentimento e opt-in"><p>A clínica é responsável por possuir o número do destinatário, base legal adequada e consentimento válido quando exigido antes de iniciar mensagens ou ligações. Deve manter evidências do opt-in e respeitar imediatamente pedidos de bloqueio, interrupção, descadastro ou mudança de preferências.</p></S>
        <S n="6" title="Templates e janela de atendimento"><p>Conversas iniciadas pela clínica fora da janela de atendimento aplicável devem usar templates aprovados pela Meta e somente para sua finalidade autorizada. A aprovação de um template não elimina a responsabilidade da clínica pelo conteúdo, contexto, público e frequência de envio.</p></S>
        <S n="7" title="Automação e atendimento humano"><p>Automações podem apoiar respostas e triagem, mas a clínica deve manter opção clara e direta de atendimento humano, inclusive por transferência na conversa, telefone, e-mail, formulário ou suporte web. A ELIZA não deve ser configurada para enganar o usuário quanto à natureza automatizada de uma interação.</p></S>
        <S n="8" title="Saúde, prontuário e responsabilidade profissional"><p>Profissionais e clínicas são responsáveis por registros, decisões, diagnósticos, prescrições, consentimentos e obrigações de guarda. Recursos inteligentes são apoio, não substituem julgamento profissional. É vedado utilizar a integração para prestação de serviços de telessaúde, teleodontologia, telemedicina ou transmissão de informações de saúde quando a legislação aplicável ou os requisitos técnicos não permitirem.</p></S>
        <S n="9" title="Conteúdo e dados proibidos"><p>É proibido solicitar ou transmitir desnecessariamente cartões completos, contas financeiras, documentos de identidade integrais, senhas, códigos de autenticação ou outros dados altamente sensíveis. Também é proibido compartilhar informações de uma conversa com outro paciente sem base legal e autorização.</p></S>
        <S n="10" title="Uso proibido e qualidade">
          <ul>
            <li>spam, listas adquiridas ou disparo em massa sem autorização;</li>
            <li>fraude, assédio, conteúdo enganoso ou violação de direitos;</li>
            <li>produtos, serviços ou organizações proibidos pelas políticas aplicáveis;</li>
            <li>tentativas de burlar limites, templates, análise, qualidade ou segurança;</li>
            <li>uso que gere quantidade relevante de bloqueios, denúncias ou feedback negativo.</li>
          </ul>
          <p>A ELIZA poderá limitar ou suspender automações para proteger usuários, clínicas e a integridade da plataforma.</p>
        </S>
        <S n="11" title="Políticas de terceiros"><p>O uso da integração está sujeito também aos Termos da Plataforma Meta, Termos de Serviço do WhatsApp Business, Política de Mensagens do WhatsApp Business, Diretrizes de Mensagens e documentação técnica aplicável. Meta e WhatsApp são terceiros independentes e podem alterar, restringir ou descontinuar seus serviços.</p></S>
        <S n="12" title="Dados, privacidade e suboperadores"><p>O tratamento de dados segue a <Link to="/privacy">Política de Privacidade</Link>. A clínica, como controladora dos dados de pacientes, deve fornecer instruções lícitas, atender direitos dos titulares e garantir base legal. A ELIZA pode usar suboperadores necessários à infraestrutura, mensageria, IA, suporte e pagamentos, sob obrigações compatíveis.</p></S>
        <S n="13" title="Planos, cobrança e limites"><p>Valores, módulos, cotas, eventuais custos de mensageria e condições comerciais são definidos na contratação. Tarifas cobradas por Meta, WhatsApp ou outros provedores podem ser repassadas ou faturadas separadamente, conforme informado. Inadimplência pode resultar em limitação ou suspensão, respeitada a legislação.</p></S>
        <S n="14" title="Disponibilidade, alterações e suporte"><p>A ELIZA poderá receber atualizações e manutenções. Não garantimos operação ininterrupta de serviços externos. Canais de suporte e mudanças materiais serão informados pelos meios disponíveis. Incidentes devem ser reportados para admin@elizaclinic.com.br.</p></S>
        <S n="15" title="Suspensão e encerramento"><p>A conta ou integração poderá ser suspensa por risco de segurança, violação legal ou de políticas, fraude, uso abusivo, exigência de terceiro ou falta de pagamento. A clínica poderá solicitar encerramento, exportação quando disponível e exclusão conforme a página de <Link to="/data-deletion">Exclusão de dados</Link>.</p></S>
        <S n="16" title="Propriedade intelectual"><p>A marca, interface, código, documentação e modelos próprios da ELIZA são protegidos. A licença não transfere propriedade intelectual. Conteúdos e dados inseridos pela clínica permanecem de seus respectivos titulares.</p></S>
        <S n="17" title="Limitação e legislação aplicável"><p>Dentro dos limites legais, a ELIZA não responde por falhas atribuíveis à clínica, usuários, conexão, APIs externas ou uso em desconformidade com estes Termos. Aplicam-se as leis brasileiras, sem prejuízo dos direitos assegurados por normas de proteção do consumidor e de dados.</p></S>
        <S n="18" title="Contato e vigência"><p>Contato: <a href="mailto:admin@elizaclinic.com.br">admin@elizaclinic.com.br</a>. Estes Termos vigoram a partir da aceitação e foram atualizados em 31 de agosto de 2026.</p></S>
      </article>
      <Footer />
    </main>
  );
}
