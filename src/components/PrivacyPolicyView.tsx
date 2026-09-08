/**
 * Política de Privacidade pública (`/privacy`) — conteúdo/layout/CSS
 * copiados literalmente do pacote premium aprovado
 * (eliza-premium-entrega/app/privacy/page.tsx), fonte canônica. Rota
 * preservada, pública, sem autenticação.
 *
 * Correções de texto autorizadas (rodada de refinamento pré-deploy):
 * Seção 3 — WABA ID/Phone Number ID reenquadrados como "identificadores
 * técnicos da integração" (com Business ID), em vez de categoria solta;
 * Seção 4 — acrescentada frase neutra permitindo outras permissões
 * técnicas além de `whatsapp_business_messaging`/`_management`, sem
 * afirmar que só essas duas existirão sempre; Seção 10 — não afirma mais
 * revogação automática de token ("...armazenados de forma protegida e
 * revogados quando a conexão for encerrada" implicava automação que não
 * existe); Seção 11 — mantida (já corrigida numa rodada anterior): o
 * pacote original afirmava que a ELIZA "revoga ou elimina credenciais
 * técnicas" ao desconectar — o backend real (POST
 * /api/whatsapp/manual-disconnect) só apaga o documento da integração no
 * Firestore; revogação/eliminação real do token é procedimento
 * administrativo manual, nunca automático nesse momento. Nenhum outro
 * trecho, seção, layout ou link foi alterado.
 *
 * Adaptação técnica: `next/link` → `Link` do react-router; wrapper
 * `.eliza-premium-landing` (ver publicLandingLegal.css).
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
function Callout({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="legal-callout"><strong>{title}</strong><p>{children}</p></aside>;
}
function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return <section><h2><span>{n.padStart(2, "0")}</span>{title}</h2>{children}</section>;
}
function Footer() {
  return (
    <footer className="info-footer">
      <span>ELIZA Clínica Inteligente</span>
      <nav><Link to="/company">A empresa</Link><Link to="/terms">Termos</Link><Link to="/data-deletion">Exclusão de dados</Link></nav>
    </footer>
  );
}

export default function PrivacyPolicyView() {
  return (
    <main className="eliza-premium-landing info-page">
      <Header />
      <article className="info-content wide-legal">
        <p className="section-kicker">PRIVACIDADE • LGPD • META PLATFORM DATA</p>
        <h1>Política de Privacidade</h1>
        <p className="info-lead">Como a ELIZA trata dados de clínicas, profissionais e pacientes, inclusive informações processadas por meio da WhatsApp Business Platform.</p>

        <Callout title="Identificação do operador">ELIZA Clínica Inteligente, operada por JANIO TEIXEIRA DA SILVA JUNIOR LTDA, CNPJ 37.421.772/0001-07, Rua Pedro Celestino, 949, Centro, Fátima do Sul – MS, CEP 79700-000. Contato de privacidade: <a href="mailto:admin@elizaclinic.com.br">admin@elizaclinic.com.br</a>.</Callout>

        <Section n="1" title="Papéis e responsabilidades"><p>Para dados de pacientes, a clínica contratante atua, em regra, como controladora e a ELIZA como operadora, tratando dados sob instruções documentadas da clínica. Para cadastro, autenticação, segurança, suporte, contratação e faturamento dos próprios usuários da plataforma, a ELIZA atua como controladora.</p></Section>

        <Section n="2" title="Categorias de dados">
          <ul>
            <li>Identificação e contato: nome, telefone, e-mail, endereço e dados cadastrais.</li>
            <li>Dados clínicos e sensíveis: anamnese, histórico, exames, fotografias, planejamento, diagnóstico, termos e evoluções.</li>
            <li>Dados financeiros administrativos: lançamentos, cobranças e situação de pagamentos.</li>
            <li>Dados de usuários: nome, e-mail, função, clínica, permissões e registros de autenticação.</li>
            <li>Dados técnicos: IP, dispositivo, logs de segurança, eventos, falhas e auditoria.</li>
          </ul>
        </Section>

        <Section n="3" title="Dados recebidos da Meta e do WhatsApp">
          <p>Quando uma clínica conecta sua conta por fluxo autorizado da Meta, a ELIZA poderá processar, conforme as funções ativadas:</p>
          <ul>
            <li>identificadores técnicos da integração, incluindo Business ID, WABA ID e Phone Number ID;</li>
            <li>nome, número e informações do perfil comercial conectado;</li>
            <li>modelos de mensagem, categorias, idiomas e status de aprovação;</li>
            <li>conteúdo de mensagens enviadas e recebidas, número do remetente/destinatário, nome de perfil informado, data e contexto da conversa;</li>
            <li>mídias e documentos enviados na conversa, quando a clínica habilitar esse processamento;</li>
            <li>status de envio, entrega, leitura, falha e eventos recebidos por webhook;</li>
            <li>tokens e credenciais técnicas necessários à integração, protegidos e com acesso restrito.</li>
          </ul>
        </Section>

        <Section n="4" title="Permissões da Meta">
          <div className="permission-grid">
            <div><code>whatsapp_business_messaging</code><p>Usada para receber mensagens, responder pacientes, enviar templates aprovados e apresentar status de entrega dentro da clínica autorizada.</p></div>
            <div><code>whatsapp_business_management</code><p>Usada para conectar e administrar, em nome da clínica, WABAs, números, perfis, templates e configurações necessárias ao serviço contratado.</p></div>
          </div>
          <p>A ELIZA solicita apenas permissões necessárias às funções oferecidas. A autorização não transfere à ELIZA a propriedade da conta, do número ou do relacionamento da clínica com seus pacientes.</p>
          <p>Outras permissões técnicas poderão ser utilizadas quando necessárias para conectar, administrar e monitorar a solução autorizada pela clínica, sempre limitadas às funcionalidades efetivamente oferecidas e às autorizações concedidas.</p>
        </Section>

        <Section n="5" title="Finalidades e limitações de uso"><p>Os dados são usados para operar agenda, prontuário, atendimento, comunicação autorizada, automações, segurança, suporte e gestão da clínica. Dados obtidos da Meta não são vendidos, licenciados para publicidade, usados para criar perfis publicitários independentes nem empregados para finalidades incompatíveis com o serviço autorizado. A ELIZA não fala em nome da Meta e não representa vínculo de patrocínio ou afiliação.</p></Section>

        <Section n="6" title="Consentimento, mensagens e atendimento humano"><p>A clínica é responsável por possuir base legal, fornecer avisos e obter o opt-in exigido antes de iniciar comunicações. Pedidos de interrupção ou opt-out devem ser respeitados. Fora da janela de atendimento aplicável, mensagens iniciadas pela clínica devem utilizar templates aprovados. Automações devem oferecer caminho claro para atendimento humano por conversa, telefone, e-mail ou suporte web.</p></Section>

        <Section n="7" title="Inteligência artificial"><p>Recursos de IA podem estruturar rascunhos, organizar informações, sinalizar pendências e resumir dados. Sugestões que resultem em registro clínico exigem revisão e confirmação de profissional habilitado. A ELIZA não realiza diagnóstico ou decisão clínica autônoma. Quando fornecedores de IA forem utilizados, o processamento deve permanecer limitado ao serviço contratado, com salvaguardas técnicas e contratuais.</p></Section>

        <Section n="8" title="Compartilhamento e suboperadores"><p>A ELIZA pode utilizar provedores de infraestrutura em nuvem, Meta/WhatsApp, mensageria, inteligência artificial, monitoramento, suporte e pagamentos, sempre no limite necessário à operação. A lista aplicável poderá variar conforme módulos contratados. Não comercializamos dados pessoais.</p></Section>

        <Section n="9" title="Transferência internacional"><p>Alguns fornecedores podem processar dados fora do Brasil. Quando aplicável, a transferência observará a LGPD, a regulamentação da ANPD e mecanismos contratuais adequados de proteção.</p></Section>

        <Section n="10" title="Segurança"><p>Aplicamos controle de acesso por função, criptografia em trânsito, segregação lógica por clínica, trilhas de auditoria e restrição de acesso humano. Tokens e credenciais de integração são armazenados de forma protegida, deixam de ser utilizados pela ELIZA após a desconexão e seguem o procedimento de segurança e encerramento aplicável. Nenhum sistema é imune a riscos; incidentes relevantes serão tratados e comunicados nos termos legais aplicáveis.</p></Section>

        <Section n="11" title="Retenção, desconexão e exclusão"><p>Dados permanecem apenas pelo período necessário às finalidades, ao contrato e às obrigações legais. Ao desconectar a integração Meta, a ELIZA interrompe novas coletas e desativa webhooks sob seu controle; a revogação ou eliminação das credenciais técnicas envolvidas é conduzida por procedimento administrativo separado, ainda não automatizado no momento da desconexão. Mensagens incorporadas a prontuários ou registros sujeitos a guarda legal podem permanecer restritas até o término do prazo aplicável. Solicitações seguem a página de <Link to="/data-deletion">Exclusão de dados</Link>.</p></Section>

        <Section n="12" title="Direitos dos titulares"><p>O titular pode solicitar confirmação, acesso, correção, anonimização, bloqueio, portabilidade, informação sobre compartilhamentos, revogação de consentimento e eliminação quando aplicável. Pacientes devem preferencialmente procurar a clínica controladora; a ELIZA prestará o suporte técnico necessário.</p></Section>

        <Section n="13" title="Crianças e adolescentes"><p>A plataforma é destinada a profissionais adultos. Dados de pacientes menores podem ser tratados no contexto assistencial sob responsabilidade da clínica e com as autorizações exigidas pela legislação.</p></Section>

        <Section n="14" title="Atualizações e contato"><p>Alterações materiais serão comunicadas pelos canais disponíveis. Dúvidas, solicitações e incidentes: <a href="mailto:admin@elizaclinic.com.br">admin@elizaclinic.com.br</a>. Versão atualizada em 31 de agosto de 2026.</p></Section>
      </article>
      <Footer />
    </main>
  );
}
