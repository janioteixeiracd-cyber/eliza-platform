/**
 * Página institucional pública (`/company`) — conteúdo/layout/CSS
 * copiados literalmente do pacote premium aprovado
 * (eliza-premium-entrega/app/company/page.tsx), fonte canônica. Rota
 * preservada, pública, sem autenticação.
 *
 * Correção de texto (rodada de refinamento pré-deploy): campo
 * "Atendimento" não promete mais "protocolo" — nenhuma geração formal de
 * número de protocolo existe hoje no backend (`grep` confirmado em
 * server.ts) — trocado por "confirmação de recebimento e acompanhamento
 * pelo canal informado". Nenhum outro trecho, seção ou layout alterado.
 *
 * Adaptação técnica: `next/link` → `Link` do react-router; wrapper
 * `.eliza-premium-landing` (ver publicLandingLegal.css) pros resets
 * escopados de link/tipografia.
 */
import { Link } from 'react-router-dom';
import './publicLandingLegal.css';

function Footer() {
  return (
    <footer className="info-footer">
      <span>ELIZA Clínica Inteligente</span>
      <nav><Link to="/privacy">Privacidade</Link><Link to="/terms">Termos</Link><Link to="/data-deletion">Exclusão de dados</Link></nav>
    </footer>
  );
}

export default function CompanyInfoView() {
  return (
    <main className="eliza-premium-landing info-page">
      <header className="info-nav">
        <Link to="/"><img src="/eliza-wordmark.png" alt="ELIZA" /></Link>
        <Link to="/" className="info-back">← Voltar ao início</Link>
      </header>
      <article className="info-content">
        <p className="section-kicker">EMPRESA • TECNOLOGIA • SUPORTE</p>
        <h1>ELIZA Clínica Inteligente</h1>
        <p className="info-lead">Plataforma brasileira de gestão e inteligência para clínicas, com tecnologia de comunicação integrada e foco em uma rotina mais conectada, segura e humana.</p>
        <section><h2><span>01</span>Quem somos</h2><p>A ELIZA conecta agenda, pacientes, prontuário, financeiro, relatórios, automações e inteligência aplicada à rotina. Nosso propósito é reduzir trabalho disperso e ajudar profissionais e equipes a perceberem o que exige atenção.</p></section>
        <section><h2><span>02</span>Provedora de tecnologia</h2><p>A ELIZA desenvolve integração para permitir que clínicas conectem suas próprias contas à WhatsApp Business Platform por fluxos autorizados da Meta. A clínica mantém a titularidade de sua conta, número e relacionamento com os pacientes. A ELIZA atua como provedora técnica dentro das permissões concedidas.</p></section>
        <section><h2><span>03</span>Independência de marcas</h2><p>Meta, WhatsApp e WhatsApp Business Platform são marcas e serviços de terceiros. A ELIZA não é controlada, patrocinada ou afiliada à Meta e utiliza essas denominações apenas para identificar integrações compatíveis.</p></section>
        <div className="company-data">
          <div><small>Marca / plataforma</small><strong>ELIZA CLÍNICA INTELIGENTE</strong></div>
          <div><small>Razão social</small><strong>JANIO TEIXEIRA DA SILVA JUNIOR LTDA</strong></div>
          <div><small>CNPJ</small><strong>37.421.772/0001-07</strong></div>
          <div><small>Sede oficial</small><strong>Rua Pedro Celestino, 949, Centro<br />Fátima do Sul – MS, CEP 79700-000</strong></div>
          <div><small>Suporte e privacidade</small><strong>admin@elizaclinic.com.br</strong></div>
          <div><small>Atendimento</small><strong>Solicitações recebidas por e-mail, com confirmação de recebimento e acompanhamento pelo canal informado.</strong></div>
        </div>
        <aside className="legal-callout">
          <strong>Documentos públicos</strong>
          <p>Consulte nossa <Link to="/privacy">Política de Privacidade</Link>, <Link to="/terms">Termos de Uso</Link> e <Link to="/data-deletion">Instruções de exclusão e desconexão</Link>.</p>
        </aside>
      </article>
      <Footer />
    </main>
  );
}
