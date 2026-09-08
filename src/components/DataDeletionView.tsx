/**
 * Exclusão e desconexão públicas (`/data-deletion`) — conteúdo/layout/CSS
 * copiados literalmente do pacote premium aprovado
 * (eliza-premium-entrega/app/data-deletion/page.tsx), fonte canônica.
 * Rota preservada, pública, sem autenticação.
 *
 * Correções de texto: Seção 5 (rodada anterior, mesma divergência da
 * Política de Privacidade) — "tokens e credenciais sob controle da ELIZA
 * são revogados ou eliminados" afirmava automação que o backend real
 * ainda não executa (`manual-disconnect` só apaga o documento da
 * integração; a revogação/eliminação da credencial em si continua
 * procedimento administrativo manual) — mantida como está, correta.
 * Rodada de refinamento pré-deploy: Seção 2 — card "Integração Meta"
 * reescrito pra não sugerir que a ELIZA apaga a própria WABA do lado da
 * Meta (é uma desconexão da integração, não da conta); Seção 6 — WABA
 * ID/Phone Number ID reenquadrados como "identificadores técnicos da
 * integração"; callout e Seção 4 — não prometem mais "protocolo"
 * (inexistente hoje — nenhuma geração formal de número de protocolo no
 * backend, `grep` confirmado em server.ts), trocado por "referência de
 * acompanhamento da solicitação". Nenhum outro trecho, seção, layout ou
 * link foi alterado.
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
function S({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return <section><h2><span>{n.padStart(2, "0")}</span>{title}</h2>{children}</section>;
}
function Footer() {
  return (
    <footer className="info-footer">
      <span>ELIZA Clínica Inteligente</span>
      <nav><Link to="/company">A empresa</Link><Link to="/privacy">Privacidade</Link><Link to="/terms">Termos</Link></nav>
    </footer>
  );
}

export default function DataDeletionView() {
  return (
    <main className="eliza-premium-landing info-page">
      <Header />
      <article className="info-content wide-legal">
        <p className="section-kicker">META PLATFORM DATA • LGPD</p>
        <h1>Exclusão e desconexão</h1>
        <p className="info-lead">Instruções públicas para excluir dados pessoais, encerrar uma conta ou remover uma integração com a Meta e o WhatsApp.</p>

        <aside className="legal-callout"><strong>Canal oficial</strong><p>Envie a solicitação para <a href="mailto:admin@elizaclinic.com.br?subject=Solicitação de exclusão de dados">admin@elizaclinic.com.br</a>. Você receberá confirmação de recebimento e uma referência de acompanhamento da solicitação.</p></aside>

        <S n="1" title="Quem pode solicitar">
          <ul>
            <li>pacientes atendidos por uma clínica usuária da ELIZA;</li>
            <li>pessoas que conversaram por WhatsApp com uma clínica conectada;</li>
            <li>profissionais, colaboradores e administradores cadastrados;</li>
            <li>representantes autorizados da clínica controladora.</li>
          </ul>
        </S>

        <S n="2" title="Escolha o tipo de solicitação">
          <div className="request-grid">
            <div><strong>Dados pessoais</strong><p>Acesso, correção, anonimização, bloqueio ou exclusão dos dados associados ao titular.</p></div>
            <div><strong>Conta da clínica</strong><p>Encerramento do acesso e exclusão ou exportação dos dados, respeitando guarda legal e contrato.</p></div>
            <div><strong>Integração Meta</strong><p>Desconexão da integração da ELIZA com a conta WhatsApp Business, seus números, webhooks e credenciais associadas, sem necessariamente excluir os demais dados da clínica.</p></div>
            <div><strong>Mensagens do WhatsApp</strong><p>Exclusão do histórico associado ao número informado, quando não houver obrigação de retenção.</p></div>
          </div>
        </S>

        <S n="3" title="Como solicitar">
          <ol>
            <li>Use o assunto "Solicitação de exclusão de dados".</li>
            <li>Informe seu nome e a clínica relacionada.</li>
            <li>Informe o e-mail da conta ou, para conversas do WhatsApp, o número utilizado.</li>
            <li>Indique claramente o escopo: dados pessoais, conta, integração Meta ou mensagens.</li>
          </ol>
          <p>Solicitaremos somente informações necessárias para confirmar identidade e legitimidade. Não envie senha, token, código de autenticação, documento completo ou dado clínico no primeiro contato.</p>
        </S>

        <S n="4" title="Prazos e confirmação"><p>Confirmaremos o recebimento e forneceremos uma referência de acompanhamento da solicitação em até 5 dias úteis. Após validação, a execução ocorrerá em até 15 dias úteis, salvo complexidade justificada ou obrigação legal. Ao concluir, enviaremos confirmação pelo canal validado.</p></S>

        <S n="5" title="O que acontece ao desconectar a Meta">
          <ul>
            <li>novas mensagens e eventos deixam de ser coletados pela integração;</li>
            <li>webhooks controlados pela ELIZA são desativados;</li>
            <li>tokens e credenciais sob controle da ELIZA são marcados para revogação e eliminação por procedimento administrativo, ainda não automatizado no momento da desconexão;</li>
            <li>a ELIZA deixa de administrar WABA, número, templates e perfil comercial;</li>
            <li>os ativos continuam pertencendo à clínica e à sua conta Meta.</li>
          </ul>
          <p>A desconexão não remove automaticamente mensagens já incorporadas ao histórico autorizado da clínica. Para isso, solicite também a exclusão dos dados correspondentes.</p>
        </S>

        <S n="6" title="Dados recebidos da Meta"><p>A solicitação poderá abranger identificadores técnicos da integração, como WABA ID e Phone Number ID, além de informações do perfil comercial, templates, eventos de webhook, status de mensagens, conteúdo e mídia armazenados pela ELIZA. A exclusão em nossos sistemas não controla cópias mantidas diretamente pela Meta, pelo WhatsApp, pela clínica ou pelo aparelho do destinatário, que seguem suas próprias políticas.</p></S>

        <S n="7" title="Retenção obrigatória e backups"><p>Prontuários, registros fiscais, evidências de consentimento, auditoria e outros dados podem precisar ser retidos por obrigação legal, regulatória ou defesa de direitos. Nesses casos, permanecem bloqueados para outras finalidades e com acesso restrito. Cópias residuais em backups protegidos são eliminadas conforme o ciclo técnico aplicável e não voltam ao ambiente ativo.</p></S>

        <S n="8" title="Solicitações de pacientes"><p>Como a clínica é, em regra, controladora dos dados de seus pacientes, o caminho mais rápido é solicitar diretamente a ela. Se a solicitação chegar à ELIZA, encaminharemos e apoiaremos a clínica na execução técnica, mantendo o titular informado.</p></S>

        <S n="9" title="Outros direitos"><p>Além da exclusão, você pode solicitar confirmação, acesso, correção, portabilidade, informação sobre compartilhamento, revogação de consentimento e revisão de decisões automatizadas, quando aplicável. Consulte a <Link to="/privacy">Política de Privacidade</Link>.</p></S>

        <a className="info-action" href="mailto:admin@elizaclinic.com.br?subject=Solicitação de exclusão de dados">Iniciar solicitação por e-mail →</a>
        <p className="legal-version">Versão atualizada em 31 de agosto de 2026.</p>
      </article>
      <Footer />
    </main>
  );
}
